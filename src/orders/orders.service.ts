import { BadRequestException, NotFoundException, Injectable } from '@nestjs/common';
import { AuditAction, OrderStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { optionalString, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';
import { TestsService } from '../tests/tests.service';
import { PatientsService } from '../patients/patients.service';
import { SamplesService } from '../samples/samples.service';
import { ResultsService } from '../results/results.service';
import { FinalReportsService } from '../final-reports/final-reports.service';

interface CreateOrderBody { patientId?: unknown; testIds?: unknown; referredBy?: unknown; clinicalNotes?: unknown }
export interface CompleteReportBody { patientId?: unknown; patient?: { name?: unknown; dateOfBirth?: unknown; age?: unknown; gender?: unknown; mobile?: unknown; email?: unknown; address?: unknown }; testIds?: unknown; parametersByTest?: Record<string, Array<{ name?: unknown; value?: unknown }>>; referredBy?: unknown; clinicalNotes?: unknown; status?: unknown; }

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptionService: SubscriptionService, private readonly testsService: TestsService, private readonly patientsService: PatientsService, private readonly samplesService: SamplesService, private readonly resultsService: ResultsService, private readonly finalReportsService: FinalReportsService) {}

  async create(currentUser: AuthUser, body: CreateOrderBody) {
    const patientId = requiredString(body.patientId, 'patientId');
    if (!Array.isArray(body.testIds) || body.testIds.length === 0) throw new BadRequestException('testIds must contain at least one test');
    const testIds = [...new Set(body.testIds.map((value, index) => requiredString(value, `testIds.${index}`)))];
    const [patient, tests, lab] = await Promise.all([
      this.prisma.patient.findFirst({ where: { id: patientId, labId: currentUser.labId }, select: { id: true } }),
      this.testsService.resolveForUse(currentUser, testIds),
      this.prisma.lab.findUnique({ where: { id: currentUser.labId }, select: { code: true } }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (tests.length !== testIds.length) throw new BadRequestException('One or more tests are invalid or inactive');
    if (!lab) throw new NotFoundException('Lab not found');
    return this.prisma.$transaction(async (tx) => {
      await this.subscriptionService.lockLimit(tx, currentUser.labId, 'orders');
      await this.subscriptionService.assertWithinLimit(currentUser.labId, 'orders', 1, tx);
      const orderNumber = this.createOrderNumber(currentUser.labId, lab.code);
      return tx.labOrder.create({ data: { labId: currentUser.labId, patientId, orderNumber, status: OrderStatus.REGISTERED, referredBy: optionalString(body.referredBy, 'referredBy'), clinicalNotes: optionalString(body.clinicalNotes, 'clinicalNotes'), createdById: currentUser.id, items: { create: tests.map((test) => ({ testId: test.id, price: test.price ?? 0 })) } }, include: { patient: true, items: { include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } } } }, samples: true } });
    }, { timeout: 10000 });
  }

  async createCompleteReport(currentUser: AuthUser, body: CompleteReportBody) {
    const requestedStatus = typeof body.status === 'string' ? body.status.trim() : '';
    const shouldFinalize = requestedStatus === 'Completed' || requestedStatus === 'Critical';
    if (shouldFinalize && currentUser.role !== 'ADMIN' && currentUser.role !== 'TECHNICIAN') throw new BadRequestException('Only an administrator or technician can complete and finalize a report');

    const patient = await this.resolvePatient(currentUser, body);
    if (!patient) throw new NotFoundException('Patient not found');
    const testIds = this.normalizeTestIds(body.testIds);
    if (!testIds.length) throw new BadRequestException('Please select at least one configured laboratory test.');

    const orderInput = { patientId: patient.id, testIds, referredBy: body.referredBy, clinicalNotes: body.clinicalNotes };
    const preparedOrder = await this.prepareCompleteOrder(currentUser, orderInput);
    const specimenTypes = [...new Set((preparedOrder.items as any[]).map((item) => item.test?.sampleType?.trim()).filter(Boolean))] as string[];
    const resultInputs: Array<{ parameterId: string; value: string; sampleId?: string }> = [];
    const itemsByTestKey = new Map<string, any>();
    for (const item of preparedOrder.items as any[]) for (const key of [item.test?.id, item.test?.catalogId, item.test?.code]) if (typeof key === 'string' && key.trim()) itemsByTestKey.set(key.trim().toLowerCase(), item);
    for (const [testId, parameters] of Object.entries(body.parametersByTest ?? {})) {
      const item = itemsByTestKey.get(testId.trim().toLowerCase());
      if (!item) throw new BadRequestException(`Unable to map report results to selected test: ${testId}`);
      const byName = new Map((item.test.parameters ?? []).map((parameter: any) => [parameter.name.trim().toLowerCase(), parameter]));
      for (const input of parameters ?? []) {
        const name = typeof input?.name === 'string' ? input.name.trim().toLowerCase() : '';
        const parameter = byName.get(name) as any;
        const value = input?.value === undefined || input?.value === null ? '' : String(input.value).trim();
        if (parameter && value) resultInputs.push({ parameterId: parameter.id, value, sampleId: undefined });
      }
    }

    const workflow = await this.prisma.$transaction(async (tx) => {
      const order = await this.createFastCompleteOrder(currentUser, orderInput, tx, preparedOrder);
      const samples = await this.samplesService.createCompletedForOrder(currentUser, order.id, { specimenTypes }, tx);

      const samplesBySpecimen = new Map(samples.map((sample) => [sample.specimenType, sample.id]));
      const mappedResults = resultInputs.map((result) => {
        const item = (order.items as any[]).find((candidate) => (candidate.test?.parameters ?? []).some((parameter: any) => parameter.id === result.parameterId));
        return { ...result, sampleId: result.sampleId ?? samplesBySpecimen.get(item?.test?.sampleType) ?? samples[0]?.id };
      });

      if (!mappedResults.length) return { order, samples, normalized: [], revision: order.revision ?? 0 };

      const saved = await this.resultsService.save(currentUser, order.id, { results: mappedResults }, { reload: false, tx, loadedOrder: { ...order, patient, samples, status: OrderStatus.REGISTERED, results: [] } }) as any;

      if (!shouldFinalize) return { order, samples, normalized: saved.normalized ?? [], revision: (order.revision ?? 0) + 1 };
      if (!saved?.normalized?.length) throw new BadRequestException('No normalized report results were returned.');

      const normalized = saved.normalized as any[];
      const workflowItems = (order.items as any[]).map((item) => ({ ...item, id: item.id, results: normalized.filter((result) => result.orderItemId === item.id).map((result) => ({ ...result, id: undefined, verifiedAt: null })) }));
      const verificationOrder = { ...order, patient, samples, status: OrderStatus.RESULT_ENTERED, revision: ((order as any).revision ?? 0) + 1, items: workflowItems };
      await this.resultsService.verifyLoaded(currentUser, verificationOrder, { reload: false, tx });
      return { order, samples, normalized, revision: ((order as any).revision ?? 0) + 2 };
    }, { timeout: 30000 });

    if (!shouldFinalize) return this.resultsService.findOne(currentUser, workflow.order.id);

    const verificationOrder = {
      ...workflow.order,
      patient,
      samples: workflow.samples,
      status: OrderStatus.VERIFIED,
      revision: workflow.revision,
      items: (workflow.order.items as any[]).map((item) => ({
        ...item,
        results: workflow.normalized.filter((result: any) => result.orderItemId === item.id).map((result: any) => ({ ...result, id: undefined, verifiedAt: new Date() })),
      })),
      lab: (workflow.order as any).lab,
    };
    return this.finalReportsService.finalize(currentUser, workflow.order.id, verificationOrder);
  }

  private async prepareCompleteOrder(currentUser: AuthUser, body: CreateOrderBody) {
    const patientId = requiredString(body.patientId, 'patientId');
    if (!Array.isArray(body.testIds) || body.testIds.length === 0) throw new BadRequestException('testIds must contain at least one test');
    const testIds = [...new Set(body.testIds.map((value, index) => requiredString(value, `testIds.${index}`)))];
    const [actualTests, lab] = await Promise.all([
      this.prisma.test.findMany({
        where: { id: { in: testIds }, labId: currentUser.labId, isActive: true },
        select: {
          id: true, catalogId: true, code: true, name: true, category: true, department: true,
          sampleType: true, price: true, method: true, remarks: true,
          parameters: {
            orderBy: { displayOrder: 'asc' },
            select: {
              id: true, name: true, inputType: true, unit: true, normalMin: true, normalMax: true,
              referenceRange: true, options: true, validation: true, criticalLow: true, criticalHigh: true,
              decimalPlaces: true, defaultValue: true, formula: true, displayOrder: true,
              isRequired: true, remarks: true,
            },
          },
        },
      }),
      this.prisma.lab.findUnique({
        where: { id: currentUser.labId },
        select: { id: true, code: true, name: true, mobile: true, email: true, address: true, icon: true },
      }),
    ]);
    const actualById = new Map(actualTests.map((test) => [test.id, test]));
    const missingIds = testIds.filter((id) => !actualById.has(id));
    const fallbackTests = missingIds.length ? await this.testsService.resolveForUse(currentUser, missingIds) : [];
    const fallbackByRequestedId = new Map<string, any>();
    for (let index = 0; index < missingIds.length; index += 1) { const resolved = fallbackTests[index]; if (resolved) fallbackByRequestedId.set(missingIds[index], resolved); }
    const tests = testIds.map((id) => actualById.get(id) ?? fallbackByRequestedId.get(id)).filter(Boolean) as any[];
    if (tests.length !== testIds.length) throw new BadRequestException('One or more tests are invalid or inactive');
    if (!lab) throw new NotFoundException('Lab not found');
    return { lab, items: tests.map((test) => ({ test: { ...test, parameters: test.parameters ?? [] } })) };
  }

  private async createFastCompleteOrder(currentUser: AuthUser, body: CreateOrderBody, tx?: Prisma.TransactionClient, prepared?: any) {
    const patientId = requiredString(body.patientId, 'patientId');
    if (!Array.isArray(body.testIds) || body.testIds.length === 0) throw new BadRequestException('testIds must contain at least one test');
    const testIds = [...new Set(body.testIds.map((value, index) => requiredString(value, `testIds.${index}`)))];
    const source = prepared ?? await this.prepareCompleteOrder(currentUser, body);
    const tests = source.items.map((item: any) => item.test);
    const run = async (db: Prisma.TransactionClient) => {
      await this.subscriptionService.lockAndAssertCanCreateOrder(db, currentUser.labId);
      const orderNumber = this.createOrderNumber(currentUser.labId, source.lab.code);
      const created = await db.labOrder.create({ data: { labId: currentUser.labId, patientId, orderNumber, status: OrderStatus.REGISTERED, referredBy: optionalString(body.referredBy, 'referredBy'), clinicalNotes: optionalString(body.clinicalNotes, 'clinicalNotes'), createdById: currentUser.id, items: { create: tests.map((test: any) => ({ testId: test.id, price: test.price ?? 0 })) } }, select: { id: true, orderNumber: true, status: true, patientId: true, revision: true, items: { select: { id: true, testId: true } } } });
      const itemIdByTestId = new Map(created.items.map((item) => [item.testId, item.id]));
      return { ...created, lab: source.lab, items: tests.map((test: any) => ({ id: itemIdByTestId.get(test.id) ?? '', testId: test.id, test: { id: test.id, catalogId: test.catalogId, code: test.code, name: test.name, category: test.category, department: test.department, sampleType: test.sampleType, method: test.method, remarks: test.remarks, parameters: test.parameters }, results: [] })) };
    };
    if (tx) return run(tx);
    return this.prisma.$transaction(run, { timeout: 10000 });
  }

  private normalizeTestIds(value: unknown) { return !Array.isArray(value) ? [] as string[] : [...new Set(value.map((item, index) => requiredString(item, `testIds.${index}`)))]; }

  private async resolvePatient(currentUser: AuthUser, body: CompleteReportBody) {
    const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
    const payload = body.patient ?? {};
    if (patientId) return this.patientsService.update(currentUser, patientId, payload);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const mobile = typeof payload.mobile === 'string' ? payload.mobile.trim() : '';
    if (mobile) { const existing = await this.prisma.patient.findFirst({ where: { labId: currentUser.labId, mobile, ...(name ? { name: { equals: name, mode: 'insensitive' } } : {}) }, select: { id: true } }); if (existing) return this.patientsService.update(currentUser, existing.id, payload); }
    return this.patientsService.create(currentUser, payload);
  }

  private async auditWorkflow(currentUser: AuthUser, orderId: string, finalized: boolean, resultCount: number, normalizedCount: number) {
    console.info(`[PERF] complete:workflow-committed order=${orderId} results=${resultCount} normalized=${normalizedCount} finalized=${finalized}`);
  }

  async updateReport(currentUser: AuthUser, orderId: string, body: Record<string, unknown>) {
    const order = await this.resultsService.getOrderForWorkflow(currentUser, orderId) as any;
    if (order.status === OrderStatus.FINAL || order.status === OrderStatus.VERIFIED) throw new BadRequestException('Finalized or verified reports cannot be edited');
    const expectedRevision = body.revision === undefined ? order.revision : Number(body.revision);
    if (!Number.isInteger(expectedRevision) || expectedRevision !== order.revision) throw new BadRequestException('The report revision is stale. Reload the report and try again.');
    const patient = body.patient && typeof body.patient === 'object' ? body.patient as Record<string, unknown> : undefined;
    const results = Array.isArray(body.results) ? body.results : [];
    const requestedStatus = typeof body.status === 'string' ? body.status.trim() : '';
    const shouldFinalize = requestedStatus === 'Completed' || requestedStatus === 'Critical' || requestedStatus === OrderStatus.FINAL;
    if (shouldFinalize && currentUser.role !== 'ADMIN' && currentUser.role !== 'TECHNICIAN') throw new BadRequestException('Only an administrator or technician can complete and finalize a report');

    const transactionResult = await this.prisma.$transaction(async (tx) => {
      let updatedPatient = order.patient;
      if (patient) {
        const updateData = {
          name: typeof patient.name === 'string' ? patient.name.trim() : undefined,
          age: patient.age === undefined ? undefined : Number(patient.age),
          gender: typeof patient.gender === 'string' ? patient.gender : undefined,
          mobile: typeof patient.mobile === 'string' ? patient.mobile.trim() : undefined,
          email: typeof patient.email === 'string' ? patient.email.trim() || null : undefined,
          address: typeof patient.address === 'string' ? patient.address.trim() || null : undefined,
        };
        const rows = await tx.patient.updateManyAndReturn({ where: { id: order.patientId, labId: currentUser.labId }, data: updateData as any });
        if (rows.length !== 1) throw new NotFoundException('Patient not found');
        updatedPatient = rows[0];
      }
      await tx.labOrder.updateMany({ where: { id: orderId, labId: currentUser.labId, revision: expectedRevision, status: { notIn: [OrderStatus.FINAL, OrderStatus.VERIFIED] } }, data: { referredBy: typeof body.referredBy === 'string' ? body.referredBy.trim() : undefined, clinicalNotes: typeof body.clinicalNotes === 'string' ? body.clinicalNotes.trim() : undefined } });
      if (results.length) {
        const saved = await this.resultsService.save(currentUser, orderId, { results }, { reload: false, tx, loadedOrder: order, skipAudit: true }) as any;
        return { patient: updatedPatient, normalized: saved.normalized ?? [] };
      }
      return { patient: updatedPatient, normalized: [] };
    }, { timeout: 30000 });

    if (shouldFinalize) {
      const refreshed = await this.resultsService.getOrderForWorkflow(currentUser, orderId) as any;
      if (refreshed.status !== OrderStatus.RESULT_ENTERED) throw new BadRequestException('Results are required before finalization');
      await this.resultsService.verify(currentUser, orderId);
      return this.finalReportsService.finalize(currentUser, orderId);
    }
    return this.resultsService.findOne(currentUser, orderId);
  }


  async findOne(currentUser: AuthUser, id: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id, labId: currentUser.labId },
      include: {
        patient: true,
        items: { include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } }, results: true } },
        samples: true,
        createdBy: { select: { id: true, username: true, role: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return { ...order, results: order.items.flatMap((item) => item.results) };
  }

  async findAll(currentUser: AuthUser, skip = 0, take = 20, search?: string, status?: OrderStatus, patientId?: string, testId?: string) {
    if (!Number.isInteger(skip) || skip < 0) throw new BadRequestException('skip must be >= 0');
    if (!Number.isInteger(take) || take < 1 || take > 100) throw new BadRequestException('take must be between 1 and 100');
    const where: Prisma.LabOrderWhereInput = {
      labId: currentUser.labId,
      ...(status ? { status } : {}),
      ...(patientId ? { patientId } : {}),
      ...(testId ? { items: { some: { testId } } } : {}),
      ...(search ? { OR: [{ orderNumber: { contains: search, mode: 'insensitive' } }, { patient: { name: { contains: search, mode: 'insensitive' } } }, { patient: { mobile: { contains: search, mode: 'insensitive' } } }] } : {}),
    };
    const [total, data] = await Promise.all([this.prisma.labOrder.count({ where }), this.prisma.labOrder.findMany({ where, select: { id: true, orderNumber: true, status: true, createdAt: true, patient: { select: { id: true, name: true, mobile: true } }, items: { select: { id: true, testId: true } } }, orderBy: { createdAt: 'desc' }, skip, take })]);
    return { data, pagination: { total, skip, take, page: Math.floor(skip / take) + 1, pages: Math.ceil(total / take) } };
  }

  private createOrderNumber(labId: string, labCode: string) { const date = new Date().toISOString().slice(0, 10).replace(/-/g, ''); const suffix = Math.floor(100000 + Math.random() * 900000); return `${labCode}-ORD-${date}-${suffix}`; }
}
