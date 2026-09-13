import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { optionalString, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';
import { TestsService } from '../tests/tests.service';

interface CreateOrderBody { patientId?: unknown; testIds?: unknown; referredBy?: unknown; clinicalNotes?: unknown }

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptionService: SubscriptionService, private readonly testsService: TestsService) {}

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

  async findOne(currentUser: AuthUser, id: string) {
    const items = await this.prisma.orderItem.findMany({
      where: { orderId: id, order: { labId: currentUser.labId } },
      select: { testId: true, test: { select: { id: true, code: true, name: true, catalogId: true, parameters: true } } },
    });

    // Repair incomplete lab test panels on demand. We compare parameter names
    // rather than counts so partially configured tests are also repaired.
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
        await tx.testParameter.createMany({
          data: missing.map((parameter, index) => ({
            testId: test.id,
            name: parameter.name,
            inputType: parameter.inputType,
            unit: parameter.unit ?? null,
            normalMin: parameter.normalMin ?? null,
            normalMax: parameter.normalMax ?? null,
            referenceRange: parameter.referenceRange ?? undefined,
            options: parameter.options ?? undefined,
            validation: parameter.validation ?? undefined,
            criticalLow: parameter.criticalLow ?? null,
            criticalHigh: parameter.criticalHigh ?? null,
            decimalPlaces: parameter.decimalPlaces ?? null,
            defaultValue: parameter.defaultValue ?? null,
            formula: parameter.formula ?? null,
            displayOrder: parameter.displayOrder ?? (test.parameters.length + index),
            isRequired: parameter.isRequired ?? true,
            remarks: parameter.remarks ?? null,
          })),
          skipDuplicates: true,
        });
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
      this.prisma.labOrder.findMany({ where, include: { patient: true, items: { include: { test: true } }, samples: true }, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    return { data, pagination: { total, skip, take, page: Math.floor(skip / take) + 1, pages: Math.ceil(total / take) } };
  }

  private async createOrderNumber(db: Prisma.TransactionClient, labId: string, labCode: string) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Math.floor(100000 + Math.random() * 900000);
      const candidate = `${labCode}-ORD-${date}-${suffix}`;
      const exists = await db.labOrder.findFirst({ where: { labId, orderNumber: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Unable to allocate a unique order number');
  }
}
