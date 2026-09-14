import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, Sample, SampleStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { enumValue, optionalString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

interface CreateSamplesBody {
  specimenType?: unknown;
  container?: unknown;
}

const allowedTransitions: Record<SampleStatus, SampleStatus[]> = {
  PENDING: [SampleStatus.COLLECTED, SampleStatus.REJECTED],
  COLLECTED: [SampleStatus.RECEIVED, SampleStatus.REJECTED],
  RECEIVED: [SampleStatus.PROCESSING, SampleStatus.REJECTED],
  PROCESSING: [SampleStatus.COMPLETED, SampleStatus.REJECTED],
  COMPLETED: [],
  REJECTED: [],
};

@Injectable()
export class SamplesService {
  constructor(private readonly prisma: PrismaService) {}

  async createForOrder(currentUser: AuthUser, orderId: string, body: CreateSamplesBody = {}) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: { items: { include: { test: { select: { sampleType: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const terminalStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.FINAL];
    if (terminalStatuses.includes(order.status)) {
      throw new BadRequestException('Samples cannot be created for this order');
    }

    const explicitSpecimenType = optionalString(body.specimenType, 'specimenType');
    const explicitContainer = optionalString(body.container, 'container');
    const specimenTypes = [...new Set(order.items.map((item) => item.test.sampleType?.trim()).filter(Boolean))] as string[];
    if (explicitSpecimenType && !specimenTypes.includes(explicitSpecimenType)) {
      throw new BadRequestException('The requested specimen type is not configured for this order');
    }
    const types = explicitSpecimenType ? [explicitSpecimenType] : specimenTypes;
    if (types.length === 0) throw new BadRequestException('No specimen type is configured for the order tests');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sample.findMany({ where: { orderId: order.id }, select: { specimenType: true } });
      const existingTypes = new Set(existing.map((sample) => sample.specimenType));
      const typesToCreate = types.filter((type) => !existingTypes.has(type));
      if (typesToCreate.length === 0) throw new BadRequestException('Samples already exist for the requested specimen types');

      const samples: Sample[] = [];
      for (const specimenType of typesToCreate) {
        const accessionNumber = await this.createAccessionNumber(tx, currentUser.labId);
        samples.push(await tx.sample.create({
          data: { labId: currentUser.labId, orderId: order.id, accessionNumber, specimenType, container: explicitContainer },
        }));
      }
      return samples;
    });
  }

  /**
   * Fast path for the single-screen report workflow. A report that is entered
   * and completed immediately does not need four separate status transitions.
   * The normal sample APIs above keep their existing lifecycle semantics.
   */
  async createCompletedForOrder(currentUser: AuthUser, orderId: string, body: CreateSamplesBody = {}) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: { items: { include: { test: { select: { sampleType: true } } } } },
    });
    if (!order) throw new NotFoundException('Order not found');
    const terminalStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.FINAL];
    if (terminalStatuses.includes(order.status)) throw new BadRequestException('Samples cannot be created for this order');

    const explicitSpecimenType = optionalString(body.specimenType, 'specimenType');
    const explicitContainer = optionalString(body.container, 'container');
    const specimenTypes = [...new Set(order.items.map((item) => item.test.sampleType?.trim()).filter(Boolean))] as string[];
    if (explicitSpecimenType && !specimenTypes.includes(explicitSpecimenType)) {
      throw new BadRequestException('The requested specimen type is not configured for this order');
    }
    const types = explicitSpecimenType ? [explicitSpecimenType] : specimenTypes;
    if (types.length === 0) throw new BadRequestException('No specimen type is configured for the order tests');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.sample.findMany({ where: { orderId: order.id }, select: { specimenType: true } });
      const existingTypes = new Set(existing.map((sample) => sample.specimenType));
      const typesToCreate = types.filter((type) => !existingTypes.has(type));
      if (typesToCreate.length === 0) throw new BadRequestException('Samples already exist for the requested specimen types');

      const now = new Date();
      const samples: Sample[] = [];
      for (const specimenType of typesToCreate) {
        const accessionNumber = await this.createAccessionNumber(tx, currentUser.labId);
        samples.push(await tx.sample.create({
          data: {
            labId: currentUser.labId,
            orderId: order.id,
            accessionNumber,
            specimenType,
            container: explicitContainer,
            status: SampleStatus.COMPLETED,
            collectedAt: now,
            receivedAt: now,
          },
        }));
      }
      return samples;
    });
  }

  async findAll(currentUser: AuthUser, orderId?: string) {
    const where: Prisma.SampleWhereInput = { labId: currentUser.labId };
    if (orderId) where.orderId = orderId;
    return this.prisma.sample.findMany({
      where,
      include: { order: { select: { id: true, orderNumber: true, patient: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(currentUser: AuthUser, id: string) {
    const sample = await this.prisma.sample.findFirst({
      where: { id, labId: currentUser.labId },
      include: { order: { include: { patient: true, items: { include: { test: true } } } } },
    });
    if (!sample) throw new NotFoundException('Sample not found');
    return sample;
  }

  async updateStatus(currentUser: AuthUser, id: string, statusValue: unknown, rejectedReasonValue?: unknown) {
    const status = enumValue(SampleStatus, statusValue, 'status');
    const rejectedReason = optionalString(rejectedReasonValue, 'rejectedReason');
    const sample = await this.prisma.sample.findFirst({ where: { id, labId: currentUser.labId } });
    if (!sample) throw new NotFoundException('Sample not found');
    if (!allowedTransitions[sample.status].includes(status)) {
      throw new BadRequestException(`Invalid sample status transition: ${sample.status} -> ${status}`);
    }
    if (status === SampleStatus.REJECTED && !rejectedReason) {
      throw new BadRequestException('rejectedReason is required when rejecting a sample');
    }

    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.sample.update({
        where: { id: sample.id },
        data: {
          status,
          collectedAt: status === SampleStatus.COLLECTED && !sample.collectedAt ? now : undefined,
          receivedAt: status === SampleStatus.RECEIVED && !sample.receivedAt ? now : undefined,
          rejectedReason: status === SampleStatus.REJECTED ? rejectedReason : undefined,
        },
      });

      const orderSamples = await tx.sample.findMany({ where: { orderId: sample.orderId } });
      const activeSamples = orderSamples.filter((item) => item.status !== SampleStatus.REJECTED);
      let orderStatus: OrderStatus | undefined;
      if (activeSamples.length > 0 && activeSamples.every((item) => item.status !== SampleStatus.PENDING)) {
        if (activeSamples.some((item) => item.status === SampleStatus.PROCESSING)) orderStatus = OrderStatus.PROCESSING;
        else if (activeSamples.some((item) => item.status === SampleStatus.RECEIVED)) orderStatus = OrderStatus.PROCESSING;
        else if (activeSamples.every((item) => item.status === SampleStatus.COLLECTED || item.status === SampleStatus.COMPLETED)) orderStatus = OrderStatus.SAMPLE_COLLECTED;
      }
      if (orderStatus) await tx.labOrder.update({ where: { id: sample.orderId }, data: { status: orderStatus } });
      return updated;
    });
  }

  private async createAccessionNumber(tx: Prisma.TransactionClient, labId: string) {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = Math.floor(100000 + Math.random() * 900000);
      const candidate = `ACC-${date}-${suffix}`;
      const exists = await tx.sample.findFirst({ where: { labId, accessionNumber: candidate }, select: { id: true } });
      if (!exists) return candidate;
    }
    throw new BadRequestException('Unable to allocate a unique accession number');
  }
}
