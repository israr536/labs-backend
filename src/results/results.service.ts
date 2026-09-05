import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, ParameterInputType, ResultFlag } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { arrayValue, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

interface ResultInput { parameterId?: unknown; value?: unknown; sampleId?: unknown; }
interface ResultsBody { results?: unknown; }
type ValidationRules = { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string };

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(currentUser: AuthUser, orderId: string, body: ResultsBody = {}) {
    const inputs = arrayValue<ResultInput>(body.results ?? [], 'results');
    const order = await this.getOrder(currentUser, orderId);
    const lockedStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.FINAL, OrderStatus.VERIFIED];
    if (lockedStatuses.includes(order.status)) throw new BadRequestException('Results cannot be edited after verification or finalization');
    if (!inputs.length) throw new BadRequestException('At least one result is required');

    const items = order.items.flatMap((item) => item.test.parameters.map((parameter) => ({ item, parameter })));
    const byParameter = new Map(items.map(({ parameter, item }) => [parameter.id, { parameter, item }]));
    const seen = new Set<string>();

    const normalized = inputs.map((input, index) => {
      const parameterId = requiredString(input.parameterId, `results.${index}.parameterId`);
      const rawValue = requiredString(input.value, `results.${index}.value`).trim();
      if (seen.has(parameterId)) throw new BadRequestException(`Duplicate result for parameter ${parameterId}`);
      seen.add(parameterId);
      const target = byParameter.get(parameterId);
      if (!target) throw new BadRequestException(`results.${index}.parameterId does not belong to this order`);
      const value = this.validateValue(target.parameter, rawValue, index);
      return { orderItemId: target.item.id, parameterId, sampleId: input.sampleId === undefined ? undefined : requiredString(input.sampleId, `results.${index}.sampleId`), value, flag: this.calculateFlag(target.parameter, value) };
    });

    for (const result of normalized) {
      if (!result.sampleId) continue;
      const sample = order.samples.find((item) => item.id === result.sampleId);
      if (!sample) throw new BadRequestException('sampleId does not belong to this order');
      if (sample.status !== 'PROCESSING' && sample.status !== 'COMPLETED') throw new BadRequestException('Results can only be linked to a processing or completed sample');
    }

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, revision: order.revision, status: { notIn: lockedStatuses } }, data: { revision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException('This order was updated by another user. Reload the order and try again.');
      for (const result of normalized) await tx.orderResult.upsert({ where: { orderItemId_parameterId: { orderItemId: result.orderItemId, parameterId: result.parameterId } }, create: result, update: { value: result.value, flag: result.flag, sampleId: result.sampleId, verifiedAt: null, verifiedById: null } });
      await tx.labOrder.update({ where: { id: order.id }, data: { status: OrderStatus.RESULT_ENTERED } });
    });
    return this.findOne(currentUser, orderId);
  }

  async findOne(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    return { id: order.id, orderNumber: order.orderNumber, status: order.status, revision: order.revision, patient: order.patient, samples: order.samples, items: order.items.map((item) => ({ id: item.id, test: { id: item.test.id, code: item.test.code, name: item.test.name }, results: item.results })) };
  }

  async verify(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    if (order.status !== OrderStatus.RESULT_ENTERED) throw new BadRequestException('Only orders with entered results can be verified');
    const missing: string[] = [];
    const resultIds: string[] = [];
    for (const item of order.items) for (const parameter of item.test.parameters) {
      const result = item.results.find((row) => row.parameterId === parameter.id);
      if (parameter.isRequired && (!result || !result.value.trim())) missing.push(`${item.test.name}: ${parameter.name}`);
      if (result) resultIds.push(result.id);
    }
    if (missing.length) throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);
    if (!resultIds.length) throw new BadRequestException('No results are available for verification');

    const verifiedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, revision: order.revision, status: OrderStatus.RESULT_ENTERED }, data: { status: OrderStatus.VERIFIED, revision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException('This order changed while you were verifying it. Reload and try again.');
      await tx.orderResult.updateMany({ where: { id: { in: resultIds }, verifiedAt: null }, data: { verifiedAt, verifiedById: currentUser.id } });
    });
    return this.findOne(currentUser, orderId);
  }

  private async getOrder(currentUser: AuthUser, orderId: string) {
    const order = await this.prisma.labOrder.findFirst({ where: { id: orderId, labId: currentUser.labId }, include: { patient: true, samples: true, items: { include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } }, results: true } } } });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  private validateValue(parameter: { inputType: ParameterInputType; decimalPlaces: number | null; options: unknown; validation: unknown }, value: string, index: number) {
    const rules = (parameter.validation && typeof parameter.validation === 'object' && !Array.isArray(parameter.validation)) ? parameter.validation as ValidationRules : {};
    if (rules.maxLength != null && value.length > rules.maxLength) throw new BadRequestException(`results.${index}.value exceeds the maximum length`);
    if (rules.minLength != null && value.length < rules.minLength) throw new BadRequestException(`results.${index}.value is shorter than the minimum length`);
    if (rules.pattern) { let matches = false; try { matches = new RegExp(rules.pattern).test(value); } catch { throw new BadRequestException('Invalid validation pattern for parameter'); } if (!matches) throw new BadRequestException(`results.${index}.value has an invalid format`); }
    if ([ParameterInputType.NUMBER, ParameterInputType.PERCENTAGE].includes(parameter.inputType)) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) throw new BadRequestException(`results.${index}.value must be numeric`);
      if (rules.min != null && numberValue < rules.min) throw new BadRequestException(`results.${index}.value is below the allowed minimum`);
      if (rules.max != null && numberValue > rules.max) throw new BadRequestException(`results.${index}.value exceeds the allowed maximum`);
      if (parameter.decimalPlaces != null) {
        if (!Number.isInteger(parameter.decimalPlaces) || parameter.decimalPlaces < 0 || parameter.decimalPlaces > 8) throw new BadRequestException('Parameter decimal precision is invalid');
        if ((value.split('.')[1] ?? '').length > parameter.decimalPlaces) throw new BadRequestException(`results.${index}.value allows at most ${parameter.decimalPlaces} decimal places`);
      }
    }
    if ([ParameterInputType.SELECT, ParameterInputType.QUALITATIVE].includes(parameter.inputType)) {
      if (!Array.isArray(parameter.options) || !parameter.options.length) throw new BadRequestException('Qualitative parameter has no configured options');
      const options = parameter.options.filter((option): option is string => typeof option === 'string');
      if (!options.includes(value)) throw new BadRequestException(`results.${index}.value must be one of the configured options`);
    }
    if (parameter.inputType === ParameterInputType.BOOLEAN && !['true', 'false', 'yes', 'no'].includes(value.toLowerCase())) throw new BadRequestException(`results.${index}.value must be boolean`);
    return value;
  }

  private calculateFlag(parameter: { inputType: ParameterInputType; normalMin: number | null; normalMax: number | null }, value: string): ResultFlag | undefined {
    if (parameter.inputType !== ParameterInputType.NUMBER && parameter.inputType !== ParameterInputType.PERCENTAGE) return undefined;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new BadRequestException('Numeric parameter requires a numeric value');
    if (parameter.normalMin !== null && numberValue < parameter.normalMin) return ResultFlag.LOW;
    if (parameter.normalMax !== null && numberValue > parameter.normalMax) return ResultFlag.HIGH;
    if (parameter.normalMin !== null || parameter.normalMax !== null) return ResultFlag.NORMAL;
    return undefined;
  }
}
