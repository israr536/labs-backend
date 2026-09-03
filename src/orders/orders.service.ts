import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { optionalString, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

interface CreateOrderBody {
  patientId?: unknown;
  testIds?: unknown;
  referredBy?: unknown;
  clinicalNotes?: unknown;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(currentUser: AuthUser, body: CreateOrderBody) {
    const patientId = requiredString(body.patientId, 'patientId');
    if (!Array.isArray(body.testIds) || body.testIds.length === 0) {
      throw new BadRequestException('testIds must contain at least one test');
    }
    const testIds = [...new Set(body.testIds.map((value, index) => requiredString(value, `testIds.${index}`)))];

    const [patient, tests] = await Promise.all([
      this.prisma.patient.findFirst({ where: { id: patientId, labId: currentUser.labId } }),
      this.prisma.test.findMany({ where: { id: { in: testIds }, labId: currentUser.labId, isActive: true }, select: { id: true, price: true } }),
    ]);
    if (!patient) throw new NotFoundException('Patient not found');
    if (tests.length !== testIds.length) throw new BadRequestException('One or more tests are invalid or inactive');

    const lab = await this.prisma.lab.findUnique({ where: { id: currentUser.labId }, select: { code: true } });
    if (!lab) throw new NotFoundException('Lab not found');

    const orderNumber = await this.createOrderNumber(currentUser.labId, lab.code);
    return this.prisma.labOrder.create({
      data: {
        labId: currentUser.labId,
        patientId,
        orderNumber,
        status: OrderStatus.REGISTERED,
        referredBy: optionalString(body.referredBy, 'referredBy'),
        clinicalNotes: optionalString(body.clinicalNotes, 'clinicalNotes'),
        createdById: currentUser.id,
        items: {
          create: tests.map((test) => ({ testId: test.id, price: test.price })),
        },
      },
      include: { patient: true, items: { include: { test: true } }, samples: true },
    });
  }

  async findOne(currentUser: AuthUser, id: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id, labId: currentUser.labId },
      include: { patient: true, items: { include: { test: { include: { parameters: true } } } }, samples: true, createdBy: { select: { id: true, username: true, role: true } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  async findAll(currentUser: AuthUser, skip = 0, take = 20) {
    if (!Number.isInteger(skip) || skip < 0) throw new BadRequestException('skip must be >= 0');
    if (!Number.isInteger(take) || take < 1 || take > 100) throw new BadRequestException('take must be between 1 and 100');
    const where: Prisma.LabOrderWhereInput = { labId: currentUser.labId };
    const [total, data] = await this.prisma.$transaction([
      this.prisma.labOrder.count({ where }),
      this.prisma.labOrder.findMany({ where, include: { patient: true, items: { include: { test: true } }, samples: true }, orderBy: { createdAt: 'desc' }, skip, take }),
    ]);
    return { data, pagination: { total, skip, take, pages: Math.ceil(total / take) } };
  }

  private async createOrderNumber(labId: string, labCode: string) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Math.floor(100000 + Math.random() * 900000);
      const candidate = `${labCode}-ORD-${date}-${suffix}`;
      const exists = await this.prisma.labOrder.findFirst({ where: { labId, orderNumber: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Unable to allocate a unique order number');
  }
}
