import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, ParameterInputType, Prisma, ResultFlag } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { arrayValue, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceRangesService } from '../reference-ranges/reference-ranges.service';

interface ResultInput { parameterId?: unknown; value?: unknown; sampleId?: unknown; analyzer?: unknown; }
interface ResultsBody { results?: unknown; }
type ValidationRules = { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string };

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService, private readonly referenceRanges: ReferenceRangesService) {}

  async save(currentUser: AuthUser, orderId: string, body: ResultsBody = {}) {
    const inputs = arrayValue<ResultInput>(body.results ?? [], 'results');
    const order = await this.getOrder(currentUser, orderId);
    const lockedStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.FINAL, OrderStatus.VERIFIED];
    if (lockedStatuses.includes(order.status)) throw new BadRequestException('Results cannot be edited after verification or finalization');
    if (!inputs.length) throw new BadRequestException('At least one result is required');

    const items = order.items.flatMap((item) => item.test.parameters.map((parameter) => ({ item, parameter })));
    const byParameter = new Map(items.map(({ parameter, item }) => [parameter.id, { parameter, item }]));
    const seen = new Set<string>();

    const normalized = await Promise.all(inputs.map(async (input, index) => {
      const parameterId = requiredString(input.parameterId, `results.${index}.parameterId`);
      const rawValue = requiredString(input.value, `results.${index}.value`).trim();
      if (seen.has(parameterId)) throw new BadRequestException(`Duplicate result for parameter ${parameterId}`);
      seen.add(parameterId);
      const target = byParameter.get(parameterId);
      if (!target) throw new BadRequestException(`results.${index}.parameterId does not belong to this order`);
      const value = this.validateValue(target.parameter, rawValue, index);
      const sampleId = input.sampleId === undefined ? undefined : requiredString(input.sampleId, `results.${index}.sampleId`);
      if (sampleId) {
        const sample = order.samples.find((item) => item.id === sampleId);
        if (!sample) throw new BadRequestException('sampleId does not belong to this order');
        if (sample.status !== 'PROCESSING' && sample.status !== 'COMPLETED') throw new BadRequestException('Results can only be linked to a processing or completed sample');
      }

      const analyzer = input.analyzer === undefined ? null : requiredString(input.analyzer, `results.${index}.analyzer`);
      const range = await this.referenceRanges.resolve(currentUser, parameterId, order.patient, target.item.test.method, analyzer);
      return {
        orderItemId: target.item.id,
        parameterId,
        sampleId,
        value,
        flag: this.calculateFlag(target.parameter, value, range),
        referenceRangeId: range?.id ?? null,
        referenceRangeSnapshot: range ? {
          id: range.id,
          version: range.version,
          gender: range.gender,
          ageMinYears: range.ageMinYears,
          ageMaxYears: range.ageMaxYears,
          method: range.method,
          analyzer: range.analyzer,
          low: range.low,
          high: range.high,
          displayRange: range.displayRange,
          unit: range.unit,
          effectiveFrom: range.effectiveFrom,
          effectiveTo: range.effectiveTo,
        } : null,
      };
    }));

    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, revision: order.revision, status: { notIn: lockedStatuses } }, data: { revision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException('This order was updated by another user. Reload the order and try again.');
      for (const result of normalized) {
        await tx.orderResult.upsert({
          where: { orderItemId_parameterId: { orderItemId: result.orderItemId, parameterId: result.parameterId } },
          create: { orderItemId: result.orderItemId, parameterId: result.parameterId, sampleId: result.sampleId, value: result.value, flag: result.flag },
          update: { value: result.value, flag: result.flag, sampleId: result.sampleId, verifiedAt: null, verifiedById: null },
        });
        await tx.$executeRaw(Prisma.sql`
          UPDATE "OrderResult"
          SET "referenceRangeId" = ${result.referenceRangeId}::uuid,
              "referenceRangeSnapshot" = ${result.referenceRangeSnapshot ? JSON.stringify(result.referenceRangeSnapshot) : null}::jsonb
          WHERE "orderItemId" = ${result.orderItemId}::uuid AND "parameterId" = ${result.parameterId}::uuid
        `);
      }
      await tx.labOrder.update({ where: { id: order.id }, data: { status: OrderStatus.RESULT_ENTERED } });
    });
    return this.findOne(currentUser, orderId);
  }

  async findOne(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    const referenceSnapshots = await this.getReferenceSnapshots(order.items.flatMap((item) => item.results.map((result) => result.id)));
    return { id: order.id, orderNumber: order.orderNumber, status: order.status, revision: order.revision, patient: order.patient, samples: order.samples, items: order.items.map((item) => ({ id: item.id, test: { id: item.test.id, code: item.test.code, name: item.test.name }, results: item.results.map((result) => ({ ...result, referenceRangeSnapshot: referenceSnapshots.get(result.id) ?? null })) })) };
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

  private async getReferenceSnapshots(resultIds: string[]) {
    if (!resultIds.length) return new Map<string, unknown>();
    const rows = await this.prisma.$queryRaw<Array<{ id: string; referenceRangeSnapshot: unknown }>>(Prisma.sql`
      SELECT "id", "referenceRangeSnapshot"
      FROM "OrderResult"
      WHERE "id" IN (${Prisma.join(resultIds.map((id) => Prisma.sql`${id}::uuid`))})
    `);
    return new Map(rows.map((row) => [row.id, row.referenceRangeSnapshot]));
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
    if (parameter.inputType === ParameterInputType.NUMBER || parameter.inputType === ParameterInputType.PERCENTAGE) {
      const numberValue = Number(value);
      if (!Number.isFinite(numberValue)) throw new BadRequestException(`results.${index}.value must be numeric`);
      if (rules.min != null && numberValue < rules.min) throw new BadRequestException(`results.${index}.value is below the allowed minimum`);
      if (rules.max != null && numberValue > rules.max) throw new BadRequestException(`results.${index}.value exceeds the allowed maximum`);
      if (parameter.decimalPlaces != null) {
        if (!Number.isInteger(parameter.decimalPlaces) || parameter.decimalPlaces < 0 || parameter.decimalPlaces > 8) throw new BadRequestException('Parameter decimal precision is invalid');
        if ((value.split('.')[1] ?? '').length > parameter.decimalPlaces) throw new BadRequestException(`results.${index}.value allows at most ${parameter.decimalPlaces} decimal places`);
      }
    }
    if (parameter.inputType === ParameterInputType.SELECT || parameter.inputType === ParameterInputType.QUALITATIVE) {
      if (!Array.isArray(parameter.options) || !parameter.options.length) throw new BadRequestException('Qualitative parameter has no configured options');
      const options = parameter.options.filter((option): option is string => typeof option === 'string');
      if (!options.includes(value)) throw new BadRequestException(`results.${index}.value must be one of the configured options`);
    }
    if (parameter.inputType === ParameterInputType.BOOLEAN && !['true', 'false', 'yes', 'no'].includes(value.toLowerCase())) throw new BadRequestException(`results.${index}.value must be boolean`);
    return value;
  }

  private calculateFlag(parameter: { inputType: ParameterInputType; normalMin: number | null; normalMax: number | null }, value: string, range: { low: number | null; high: number | null } | null): ResultFlag | undefined {
    if (parameter.inputType !== ParameterInputType.NUMBER && parameter.inputType !== ParameterInputType.PERCENTAGE) return undefined;
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) throw new BadRequestException('Numeric parameter requires a numeric value');
    const low = range?.low ?? parameter.normalMin;
    const high = range?.high ?? parameter.normalMax;
    if (low !== null && numberValue < low) return ResultFlag.LOW;
    if (high !== null && numberValue > high) return ResultFlag.HIGH;
    if (low !== null || high !== null) return ResultFlag.NORMAL;
    return undefined;
  }
}
