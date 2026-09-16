import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { AuditAction, OrderStatus, Prisma, SampleStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { OutboxService } from '../audit/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';
import { TestsService } from '../tests/tests.service';
import { PatientsService } from '../patients/patients.service';
import { SamplesService } from '../samples/samples.service';
import { ResultsService } from '../results/results.service';
import { FinalReportsService } from '../final-reports/final-reports.service';
import { OrdersService, CompleteReportBody } from './orders.service';

@Injectable()
export class OptimizedOrdersService extends OrdersService {
  constructor(
    prisma: PrismaService,
    subscriptionService: SubscriptionService,
    testsService: TestsService,
    patientsService: PatientsService,
    resultsService: ResultsService,
    samplesService: SamplesService,
    finalReportsService: FinalReportsService,
    private readonly optimizedPrisma: PrismaService,
    private readonly optimizedPatients: PatientsService,
    private readonly optimizedSamples: SamplesService,
    private readonly optimizedResults: ResultsService,
    private readonly optimizedFinalReports: FinalReportsService,
    private readonly outbox: OutboxService,
  ) {
    super(prisma, subscriptionService, testsService, patientsService, samplesService, resultsService, finalReportsService);
  }

  async createCompleteReport(currentUser: AuthUser, body: CompleteReportBody) {
    const startedAt = performance.now();
    const mark = (stage: string) => console.info(JSON.stringify({ type: 'complete.performance', stage, durationMs: Math.round((performance.now() - startedAt) * 100) / 100 }));
    const idempotency = await this.beginIdempotency(currentUser, body.idempotencyKey);
    if (idempotency?.response) return idempotency.response;
    mark('started');
    const requestedStatus = typeof body.status === 'string' ? body.status.trim() : '';
    const shouldFinalize = requestedStatus === 'Completed' || requestedStatus === 'Critical';
    if (shouldFinalize && currentUser.role !== 'ADMIN' && currentUser.role !== 'TECHNICIAN') {
      throw new BadRequestException('Only an administrator or technician can complete and finalize a report');
    }

    const patient = await this.resolvePatientOptimized(currentUser, body);
    mark('patient-resolved');
    const base = this as any;
    const testIds = base.normalizeTestIds(body.testIds);
    if (!testIds.length) throw new BadRequestException('Please select at least one configured laboratory test.');

    const orderInput = { patientId: patient.id, testIds, referredBy: body.referredBy, clinicalNotes: body.clinicalNotes };
    const preparedOrder = await base.prepareCompleteOrder(currentUser, orderInput);
    mark('order-prepared');
    const specimenTypes = [...new Set(
      (preparedOrder.items as any[]).map((item) => item.test?.sampleType?.trim()).filter(Boolean),
    )] as string[];

    const resultInputs: Array<{ parameterId: string; value: string; sampleId?: string }> = [];
    const itemsByTestKey = new Map<string, any>();
    for (const item of preparedOrder.items as any[]) {
      for (const key of [item.test?.id, item.test?.catalogId, item.test?.code]) {
        if (typeof key === 'string' && key.trim()) itemsByTestKey.set(key.trim().toLowerCase(), item);
      }
    }
    for (const [testId, parameters] of Object.entries(body.parametersByTest ?? {})) {
      const item = itemsByTestKey.get(testId.trim().toLowerCase());
      if (!item) throw new BadRequestException(`Unable to map report results to selected test: ${testId}`);
      const byName = new Map((item.test.parameters ?? []).map((parameter: any) => [parameter.name.trim().toLowerCase(), parameter]));
      for (const input of parameters ?? []) {
        const name = typeof input?.name === 'string' ? input.name.trim().toLowerCase() : '';
        const parameter = byName.get(name) as any;
        const value = input?.value === undefined || input?.value === null ? '' : String(input.value).trim();
        if (parameter && value) resultInputs.push({ parameterId: parameter.id, value });
      }
    }

    const workflow = await this.optimizedPrisma.$transaction(async (tx) => {
      const order = await base.createFastCompleteOrder(currentUser, orderInput, tx, preparedOrder);
      const samples = await this.optimizedSamples.createCompletedForOrder(
        currentUser,
        order.id,
        { specimenTypes },
        tx,
        { assumeFreshOrder: true },
      );

      const samplesBySpecimen = new Map(samples.map((sample) => [sample.specimenType, sample.id]));
      const itemByParameterId = new Map<string, any>();
      for (const item of order.items as any[]) {
        for (const parameter of item.test.parameters ?? []) itemByParameterId.set(parameter.id, item);
      }
      const mappedResults = resultInputs.map((result) => {
        const item = itemByParameterId.get(result.parameterId);
        return { ...result, sampleId: result.sampleId ?? samplesBySpecimen.get(item?.test?.sampleType) ?? samples[0]?.id };
      });

      if (!mappedResults.length) {
        if (shouldFinalize) throw new BadRequestException('No report results were provided.');
        return { order, samples, normalized: [], revision: order.revision ?? 0, finalReport: null };
      }

      const saved = await this.optimizedResults.save(
        currentUser,
        order.id,
        { results: mappedResults },
        {
          reload: false,
          tx,
          skipAudit: true,
          loadedOrder: { ...order, patient, samples, status: OrderStatus.REGISTERED, results: [] },
        },
      ) as any;

      if (!shouldFinalize) {
        await this.enqueueAudit(tx, currentUser, AuditAction.UPDATE, 'LabOrderResults', order.id, { operation: 'SAVE_RESULTS', resultCount: mappedResults.length });
        return { order, samples, normalized: saved.normalized ?? [], revision: (order.revision ?? 0) + 1, finalReport: null };
      }

      if (!saved?.normalized?.length) throw new BadRequestException('No normalized report results were returned.');
      const normalized = saved.normalized as any[];
      const normalizedByItem = new Map<string, any[]>();
      for (const result of normalized) {
        const rows = normalizedByItem.get(result.orderItemId) ?? [];
        rows.push(result);
        normalizedByItem.set(result.orderItemId, rows);
      }
      const workflowItems = (order.items as any[]).map((item) => ({
        ...item,
        results: (normalizedByItem.get(item.id) ?? [])
          .map((result) => ({ ...result, id: undefined, verifiedAt: null })),
      }));
      const verificationOrder = {
        ...order,
        patient,
        samples,
        status: OrderStatus.RESULT_ENTERED,
        revision: (order.revision ?? 0) + 1,
        items: workflowItems,
      };

      await this.optimizedResults.verifyLoaded(currentUser, verificationOrder, { reload: false, tx, skipAudit: true });

      await this.enqueueAudit(tx, currentUser, AuditAction.UPDATE, 'LabOrderResults', order.id, { operation: 'SAVE_RESULTS', resultCount: mappedResults.length });
      await this.enqueueAudit(tx, currentUser, AuditAction.VERIFY, 'LabOrderResults', order.id, { operation: 'VERIFY_RESULTS', resultCount: normalized.length });

      const finalizedAt = new Date();
      const lab = (order as any).lab ?? preparedOrder.lab;
      if (!lab) throw new NotFoundException('Lab not found');
      const incompleteSamples = samples.filter((sample) => sample.status !== SampleStatus.COMPLETED);
      if (incompleteSamples.length) {
        throw new BadRequestException(
          `All samples must be completed before finalization: ${incompleteSamples.map((sample) => sample.accessionNumber).join(', ')}`,
        );
      }

      const finalOrder = {
        ...verificationOrder,
        status: OrderStatus.VERIFIED,
        revision: (order.revision ?? 0) + 2,
        items: (order.items as any[]).map((item) => ({
          ...item,
          results: (normalizedByItem.get(item.id) ?? [])
            .map((result) => ({ ...result, id: undefined, verifiedAt: finalizedAt })),
        })),
        lab,
      };

      const reportNumber = (this.optimizedFinalReports as any).createReportNumber(lab.code);
      const snapshot = (this.optimizedFinalReports as any).buildSnapshot(lab, finalOrder, finalizedAt);

      const created = await tx.finalReport.upsert({
        where: { orderId: order.id },
        create: {
          labId: currentUser.labId,
          orderId: order.id,
          reportNumber,
          finalizedById: currentUser.id,
          finalizedAt,
          snapshot,
          currentVersion: 1,
        },
        update: {},
      });

      await tx.finalReportVersion.upsert({
        where: { finalReportId_version: { finalReportId: created.id, version: 1 } },
        create: {
          finalReportId: created.id,
          version: 1,
          snapshot,
          amendmentReason: 'Initial finalization',
          createdById: currentUser.id,
        },
        update: {},
      });

      const finalized = await tx.labOrder.updateMany({
        where: { id: order.id, labId: currentUser.labId, status: OrderStatus.VERIFIED },
        data: { status: OrderStatus.FINAL },
      });
      if (finalized.count !== 1) throw new BadRequestException('Order could not be finalized because its status changed.');

      await this.enqueueAudit(tx, currentUser, AuditAction.FINALIZE, 'FinalReport', created.id, { orderId: order.id, reportNumber, version: 1 });

      return {
        order,
        samples,
        normalized,
        revision: (order.revision ?? 0) + 2,
        finalReport: {
          ...snapshot,
          id: created.id,
          reportNumber: created.reportNumber,
          version: created.currentVersion,
          finalizedAt: created.finalizedAt,
          finalizedBy: { id: currentUser.id, username: (currentUser as any).username, role: currentUser.role },
        },
      };
    }, { timeout: 30000 });
    mark('transaction-committed');

    const response = shouldFinalize ? workflow.finalReport : await this.optimizedResults.findOne(currentUser, workflow.order.id);
    if (idempotency) await this.completeIdempotency(idempotency.id, response);
    mark('response-ready');
    return response;
  }

  private async enqueueAudit(tx: Prisma.TransactionClient, user: AuthUser, action: AuditAction, entity: string, entityId: string, metadata: Prisma.InputJsonValue) {
    return this.outbox.enqueue(tx, user.labId, 'AUDIT_LOG', entity, entityId, { actorId: user.id, action, entity, entityId, metadata });
  }

  private async beginIdempotency(user: AuthUser, rawKey?: string) {
    const key = rawKey?.trim();
    if (!key) return null;
    if (key.length > 128) throw new BadRequestException('Idempotency-Key must be at most 128 characters');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      const created = await this.optimizedPrisma.idempotencyRecord.create({ data: { labId: user.labId, actorId: user.id, key, expiresAt } });
      return { id: created.id, response: null as unknown };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const existing = await this.optimizedPrisma.idempotencyRecord.findUnique({ where: { labId_key: { labId: user.labId, key } } });
      if (existing?.expiresAt && existing.expiresAt < new Date()) {
        await this.optimizedPrisma.idempotencyRecord.delete({ where: { id: existing.id } });
        return this.beginIdempotency(user, key);
      }
      if (existing?.status === 'COMPLETED' && existing.response) return { id: existing.id, response: existing.response };
      if (existing && existing.createdAt < new Date(Date.now() - 5 * 60 * 1000)) {
        const takeover = await this.optimizedPrisma.idempotencyRecord.update({ where: { id: existing.id }, data: { status: 'PROCESSING', response: Prisma.JsonNull, completedAt: null, expiresAt } });
        return { id: takeover.id, response: null as unknown };
      }
      throw new BadRequestException('A request with this Idempotency-Key is already being processed');
    }
  }

  private completeIdempotency(id: string, response: unknown) {
    return this.optimizedPrisma.idempotencyRecord.update({ where: { id }, data: { status: 'COMPLETED', response: response as Prisma.InputJsonValue, completedAt: new Date() } });
  }

  private async resolvePatientOptimized(currentUser: AuthUser, body: CompleteReportBody) {
    const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
    const payload = body.patient ?? {};
    if (patientId) {
      const hasPatientPayload = Object.values(payload).some(
        (value) => value !== undefined && value !== null && String(value).trim() !== '',
      );
      if (!hasPatientPayload) {
        const existing = await this.optimizedPrisma.patient.findFirst({
          where: { id: patientId, labId: currentUser.labId },
        });
        if (!existing) throw new NotFoundException('Patient not found');
        return existing;
      }
      return this.optimizedPatients.update(currentUser, patientId, payload);
    }

    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const mobile = typeof payload.mobile === 'string' ? payload.mobile.trim() : '';
    if (mobile) {
      const existing = await this.optimizedPrisma.patient.findFirst({
        where: {
          labId: currentUser.labId,
          mobile,
          ...(name ? { name: { equals: name, mode: 'insensitive' } } : {}),
        },
        select: { id: true },
      });
      if (existing) return this.optimizedPatients.update(currentUser, existing.id, payload);
    }
    return this.optimizedPatients.create(currentUser, payload);
  }
}
