import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, ResultFlag, ParameterInputType } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { arrayValue, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

interface ResultInput { parameterId?: unknown; value?: unknown; sampleId?: unknown; }
interface ResultsBody { results?: unknown; }

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(currentUser: AuthUser, orderId: string, body: ResultsBody = {}) {
    const inputs = arrayValue<ResultInput>(body.results ?? [], 'results');
    const order = await this.getOrder(currentUser, orderId);
    if ([OrderStatus.CANCELLED, OrderStatus.FINAL].includes(order.status)) {
      throw new BadRequestException('Results cannot be entered for this order');
    }
    if (!inputs.length) throw new BadRequestException('At least one result is required');

    const items = order.items.flatMap((item) => item.test.parameters.map((parameter) => ({ item, parameter })));
    const byParameter = new Map(items.map(({ parameter, item }) => [parameter.id, { parameter, item }]));
    const seen = new Set<string>();

    const normalized = inputs.map((input, index) => {
      const parameterId = requiredString(input.parameterId, `results.${index}.parameterId`);
      const value = requiredString(input.value, `results.${index}.value`);
      if (seen.has(parameterId)) throw new BadRequestException(`Duplicate result for parameter ${parameterId}`);
      seen.add(parameterId);
      const target = byParameter.get(parameterId);
      if (!target) throw new BadRequestException(`results.${index}.parameterId does not belong to this order`);
      return {
        orderItemId: target.item.id,
        parameterId,
        sampleId: input.sampleId === undefined ? undefined : requiredString(input.sampleId, `results.${index}.sampleId`),
        value,
        flag: this.calculateFlag(target.parameter, value),
      };
    });

    for (const result of normalized) {
      if (result.sampleId) {
        const sample = order.samples.find((item) => item.id === result.sampleId);
        if (!sample) throw new BadRequestException('sampleId does not belong to this order');
        if (sample.status !== 'PROCESSING' && sample.status !== 'COMPLETED') {
          throw new BadRequestException('Results can only be linked to a processing or completed sample');
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const result of normalized) {
        await tx.orderResult.upsert({
          where: { orderItemId_parameterId: { orderItemId: result.orderItemId, parameterId: result.parameterId } },
          create: result,
          update: { value: result.value, flag: result.flag, sampleId: result.sampleId },
        });
      }
      await tx.labOrder.update({ where: { id: order.id }, data: { status: OrderStatus.RESULT_ENTERED } });
    });

    return this.findOne(currentUser, orderId);
  }

  async findOne(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      patient: order.patient,
      samples: order.samples,
      items: order.items.map((item) => ({
        id: item.id,
        test: { id: item.test.id, code: item.test.code, name: item.test.name },
        results: item.results,
      })),
    };
  }

  async verify(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.FINAL) {
      throw new BadRequestException('Order cannot be verified in its current status');
    }

    const missing: string[] = [];
    for (const item of order.items) {
      for (const parameter of item.test.parameters) {
        const result = item.results.find((row) => row.parameterId === parameter.id);
        if (parameter.isRequired && (!result || !result.value.trim())) missing.push(`${item.test.name}: ${parameter.name}`);
      }
    }
    if (missing.length) throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);

    await this.prisma.labOrder.update({ where: { id: order.id }, data: { status: OrderStatus.VERIFIED } });
    return this.findOne(currentUser, orderId);
  }

  private async getOrder(currentUser: AuthUser, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({
      where: { id: orderId, labId: currentUser.labId },
      include: {
        patient: true,
        samples: true,
        items: {
          include: {
            test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } },
            results: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private calculateFlag(parameter: { inputType: ParameterInputType; normalMin: number | null; normalMax: number | null }, value: string): ResultFlag | undefined {
    if (parameter.inputType !== ParameterInputType.NUMBER) return undefined;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new BadRequestException('Numeric parameter requires a numeric value');
    if (parameter.normalMin !== null && numberValue < parameter.normalMin) return ResultFlag.LOW;
    if (parameter.normalMax !== null && numberValue > parameter.normalMax) return ResultFlag.HIGH;
    if (parameter.normalMin !== null || parameter.normalMax !== null) return ResultFlag.NORMAL;
    return undefined;
  }
}
