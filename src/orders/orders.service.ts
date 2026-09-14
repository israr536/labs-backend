import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
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
export interface CompleteReportBody {
  patientId?: unknown;
  patient?: { name?: unknown; dateOfBirth?: unknown; age?: unknown; gender?: unknown; mobile?: unknown; email?: unknown; address?: unknown };
  testIds?: unknown;
  parametersByTest?: Record<string, Array<{ name?: unknown; value?: unknown }>>;
  referredBy?: unknown;
  clinicalNotes?: unknown;
  status?: unknown;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
    private readonly testsService: TestsService,
    private readonly patientsService: PatientsService,
    private readonly samplesService: SamplesService,
    private readonly resultsService: ResultsService,
    private readonly finalReportsService: FinalReportsService,
  ) {}

  async create(currentUser: AuthUser, body: CreateOrderBody) {
    const patientId = requiredString(body.patientId, 'patientId');
    if (!Array.isArray(body.testIds) || body.testIds.length === 0) throw new BadRequestException('testIds must contain at least one test');
    const testIds = [...new Set(body.testIds.map((value, index) => requiredString(value, `testIds.${index}`)))];
    const [patient, tests] = await Promise.all([
      this.prisma.patient.findFirst({ where: { id: patientId, labId: currentUser.labId } }),
      this.testsService.resolveForUse(currentUser, testIds),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (tests.length !== testIds.length) throw new BadRequestException('One or more tests are invalid or inactive');
    const lab = await this.prisma.lab.findUnique({ where: { id: currentUser.labId }, select: { code: true } });
    if (!lab) throw new NotFoundException('Lab not found');
    return this.prisma.$transaction(async (tx) => {
      await this.subscriptionService.lockLimit(tx, currentUser.labId, 'orders');
      await this.subscriptionService.assertWithinLimit(currentUser.labId, 'orders', 1, tx);
      const orderNumber = await this.createOrderNumber(tx, currentUser.labId, lab.code);
      return tx.labOrder.create({ data: {
        labId: currentUser.labId,
        patientId,
        orderNumber,
        status: OrderStatus.REGISTERED,
        referredBy: optionalString(body.referredBy, 'referredBy'),
        clinicalNotes: optionalString(body.clinicalNotes, 'clinicalNotes'),
        createdById: currentUser.id,
        items: { create: tests.map((test) => ({ testId: test.id, price: test.price ?? 0 })) },
      }, include: { patient: true, items: { include: { test: true } }, samples: true } });
    });
  }

  /** Creates the complete report workflow behind one HTTP request. Existing endpoints remain unchanged. */
  async createCompleteReport(currentUser: AuthUser, body: CompleteReportBody) {
    const patient = await this.resolvePatient(currentUser, body);
    const testIds = this.normalizeTestIds(body.testIds);
    if (!testIds.length) throw new BadRequestException('Please select at least one configured laboratory test.');
    const order = await this.create(currentUser, { patientId: patient.id, testIds, referredBy: body.referredBy, clinicalNotes: body.clinicalNotes });
    const samples = await this.samplesService.createForOrder(currentUser, order.id, {});
    for (const sample of samples) for (const status of ['COLLECTED', 'RECEIVED', 'PROCESSING', 'COMPLETED'] as const) await this.samplesService.updateStatus(currentUser, sample.id, status);
    const orderWithParameters = await this.resultsService.findOne(currentUser, order.id);
    const resultInputs: Array<{ parameterId: string; value: string; sampleId?: string }> = [];
    for (const [testId, parameters] of Object.entries(body.parametersByTest ?? {})) {
      const item = (orderWithParameters.items as any[]).find((candidate) => candidate.test?.id === testId);
      if (!item) continue;
      const byName = new Map((item.test.parameters ?? []).map((parameter: any) => [parameter.name.trim().toLowerCase(), parameter]));
      for (const input of parameters ?? []) {
        const name = typeof input?.name === 'string' ? input.name.trim().toLowerCase() : '';
        const parameter = byName.get(name) as any;
        const value = input?.value === undefined || input?.value === null ? '' : String(input.value).trim();
        if (parameter && value) resultInputs.push({ parameterId: parameter.id, value, sampleId: samples.find((sample) => sample.specimenType === item.test.sampleType)?.id ?? samples[0]?.id });
      }
    }
    if (resultInputs.length) await this.resultsService.save(currentUser, order.id, { results: resultInputs });
    const requestedStatus = typeof body.status === 'string' ? body.status.trim() : '';
    if (requestedStatus === 'Completed' || requestedStatus === 'Critical') {
      if (currentUser.role !== 'ADMIN' && currentUser.role !== 'TECHNICIAN') throw new BadRequestException('Only an administrator or technician can complete and finalize a report');
      await this.resultsService.verify(currentUser, order.id);
      return this.finalReportsService.finalize(currentUser, order.id);
    }
    return this.resultsService.findOne(currentUser, order.id);
  }

  private normalizeTestIds(value: unknown) {
    if (!Array.isArray(value)) return [] as string[];
    return [...new Set(value.map((item, index) => requiredString(item, `testIds.${index}`)))];
  }

  private async resolvePatient(currentUser: AuthUser, body: CompleteReportBody) {
    const patientId = typeof body.patientId === 'string' ? body.patientId.trim() : '';
    const payload = body.patient ?? {};
    if (patientId) return this.patientsService.update(currentUser, patientId, payload);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const mobile = typeof payload.mobile === 'string' ? payload.mobile.trim() : '';
    const search = mobile || name;
    if (search) {
      const existing = await this.patientsService.findAll(currentUser, search).catch(() => []);
      const match = existing.find((candidate) => candidate.mobile === mobile && candidate.name?.toLowerCase() === name.toLowerCase());
      if (match) return this.patientsService.update(currentUser, match.id, payload);
    }
    return this.patientsService.create(currentUser, payload);
  }

  async findOne(currentUser: AuthUser, id: string) {
    const items = await this.prisma.orderItem.findMany({ where: { orderId: id, order: { labId: currentUser.labId } }, select: { testId: true, test: { select: { id: true, code: true, name: true, catalogId: true, parameters: true } } } });
    for (const item of items) {
      const test = item.test;
      const definition = test.catalogId
        ? await this.prisma.testDefinition.findFirst({ where: { id: test.catalogId, isActive: true }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } })
        : await this.prisma.testDefinition.findFirst({ where: { code: test.code, isActive: true }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
      if (!definition || !definition.parameters.length) continue;
      const existingNames = new Set(test.parameters.map((parameter) => parameter.name.trim().toLowerCase()));
      const missing = definition.parameters.filter((parameter) => !existingNames.has(parameter.name.trim().toLowerCase()));
      if (!missing.length) {
        if (!test.catalogId) await this.prisma.test.update({ where: { id: test.id }, data: { catalogId: definition.id } });
        continue;
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.testParameter.createMany({ data: missing.map((parameter, index) => ({ testId: test.id, name: parameter.name, inputType: parameter.inputType, unit: parameter.unit ?? null, normalMin: parameter.normalMin ?? null, normalMax: parameter.normalMax ?? null, referenceRange: parameter.referenceRange ?? undefined, options: parameter.options ?? undefined, validation: parameter.validation ?? undefined, criticalLow: parameter.criticalLow ?? null, criticalHigh: parameter.criticalHigh ?? null, decimalPlaces: parameter.decimalPlaces ?? null, defaultValue: parameter.defaultValue ?? null, formula: parameter.formula ?? null, displayOrder: parameter.displayOrder ?? (test.parameters.length + index), isRequired: parameter.isRequired ?? true, remarks: parameter.remarks ?? null })), skipDuplicates: true });
        if (!test.catalogId) await tx.test.update({ where: { id: test.id }, data: { catalogId: definition.id } });
      });
    }
    const order = await this.prisma.labOrder.findFirst({ where: { id, labId: currentUser.labId }, include: { patient: true, items: { include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } }, results: true } }, samples: true, createdBy: { select: { id: true, username: true, role: true } } } });
    if (!order) throw new NotFoundException('Order not found');
    return { ...order, results: order.items.flatMap((item) => item.results) };
  }

  async findAll(currentUser: AuthUser, skip = 0, take = 20, search?: string, status?: OrderStatus) {
    if (!Number.isInteger(skip) || skip < 0) throw new BadRequestException('skip must be >= 0');
    if (!Number.isInteger(take) || take < 1 || take > 100) throw new BadRequestException('take must be between 1 and 100');
    const where: Prisma.LabOrderWhereInput = { labId: currentUser.labId, ...(status ? { status } : {}), ...(search ? { OR: [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { patient: { name: { contains: search, mode: 'insensitive' } } },
      { patient: { mobile: { contains: search, mode: 'insensitive' } } },
    ] } : {}) };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.labOrder.count({ where }),
      this.prisma.labOrder.findMany({
        where,
        include: {
          patient: true,
          items: {
            include: {
              test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } },
              results: true,
            },
          },
          samples: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    return { data, pagination: { total, skip, take, page: Math.floor(skip / take) + 1, pages: Math.ceil(total / take) } };
  }

  private async createOrderNumber(tx: Prisma.TransactionClient, labId: string, labCode: string) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const suffix = Math.floor(100000 + Math.random() * 900000);
      const candidate = `${labCode}-ORD-${date}-${suffix}`;
      const exists = await tx.labOrder.findFirst({ where: { labId, orderNumber: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Unable to allocate a unique order number');
  }
}
