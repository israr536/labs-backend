import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, OrderStatus, ParameterInputType, Prisma, ResultFlag } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { arrayValue, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { ReferenceRangesService, ResolvedReferenceRange } from '../reference-ranges/reference-ranges.service';

interface ResultInput { parameterId?: unknown; value?: unknown; sampleId?: unknown; analyzer?: unknown; }
interface ResultsBody { results?: unknown; }
type ValidationRules = { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string };

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly referenceRanges: ReferenceRangesService,
    private readonly audit: AuditService,
  ) {}

  async save(currentUser: AuthUser, orderId: string, body: ResultsBody = {}) {
    const inputs = arrayValue<ResultInput>(body.results ?? [], 'results');
    const order = await this.getOrder(currentUser, orderId);
    const lockedStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.FINAL, OrderStatus.VERIFIED];
    if (lockedStatuses.includes(order.status)) throw new BadRequestException('Results cannot be edited after verification or finalization');
    if (!inputs.length) throw new BadRequestException('At least one result is required');

    const items = order.items.flatMap((item) => item.test.parameters.map((parameter) => ({ item, parameter })));
    const byParameter = new Map(items.map(({ parameter, item }) => [parameter.id, { parameter, item }]));
    const samplesById = new Map(order.samples.map((sample) => [sample.id, sample]));
    const existingByParameter = new Map(order.items.flatMap((item) => item.results.map((result) => [result.parameterId, result] as const)));
    const seen = new Set<string>();
    const changedParameterIds: string[] = [];
    const createdParameterIds: string[] = [];

    const normalized = await Promise.all(inputs.map(async (input, index) => {
      const parameterId = requiredString(input.parameterId, `results.${index}.parameterId`);
      const target = byParameter.get(parameterId);
      if (!target) throw new BadRequestException(`results.${index}.parameterId does not belong to this order`);
      if (seen.has(parameterId)) throw new BadRequestException(`Duplicate result for parameter ${parameterId}`);
      seen.add(parameterId);

      const rawValue = input.value === undefined || input.value === null ? '' : String(input.value).trim();
      if (!rawValue && target.parameter.isRequired) throw new BadRequestException(`results.${index}.value is required`);

      const existing = existingByParameter.get(parameterId);
      if (existing?.verifiedAt) {
        throw new BadRequestException(`Result for ${target.parameter.name} has already been verified and cannot be changed`);
      }
      if (existing) changedParameterIds.push(parameterId);
      else createdParameterIds.push(parameterId);

      const value = rawValue ? this.validateValue(target.parameter, rawValue, index) : '';
      const sampleId = input.sampleId === undefined ? undefined : requiredString(input.sampleId, `results.${index}.sampleId`);
      if (sampleId) {
        const sample = samplesById.get(sampleId);
        if (!sample) throw new BadRequestException('sampleId does not belong to this order');
        if (sample.status !== 'PROCESSING' && sample.status !== 'COMPLETED') throw new BadRequestException('Results can only be linked to a processing or completed sample');
      }

      const analyzer = input.analyzer === undefined ? null : requiredString(input.analyzer, `results.${index}.analyzer`);
      const range = value ? await this.resolveReferenceRange(parameterId, order.patient, target.item.test.method, analyzer) : null;
      return {
        orderItemId: target.item.id,
        parameterId,
        sampleId,
        value,
        flag: value ? this.calculateFlag(target.parameter, value, range) : undefined,
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
          create: {
            orderItemId: result.orderItemId,
            parameterId: result.parameterId,
            sampleId: result.sampleId,
            value: result.value,
            flag: result.flag,
            referenceRangeId: result.referenceRangeId,
            referenceRangeSnapshot: result.referenceRangeSnapshot,
          },
          update: {
            value: result.value,
            flag: result.flag,
            sampleId: result.sampleId,
            verifiedAt: null,
            verifiedById: null,
            referenceRangeId: result.referenceRangeId,
            referenceRangeSnapshot: result.referenceRangeSnapshot,
          },
        });
      }
      await tx.labOrder.update({ where: { id: order.id }, data: { status: OrderStatus.RESULT_ENTERED } });
      await tx.auditLog.create({
        data: {
          labId: currentUser.labId,
          actorId: currentUser.id,
          action: AuditAction.UPDATE,
          entity: 'LabOrderResults',
          entityId: order.id,
          metadata: {
            operation: 'SAVE_RESULTS',
            orderRevision: order.revision + 1,
            createdCount: createdParameterIds.length,
            updatedCount: changedParameterIds.length,
            createdParameterIds,
            updatedParameterIds: changedParameterIds,
          },
        },
      });
    });
    return this.findOne(currentUser, orderId);
  }

  async findOne(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    return { id: order.id, orderNumber: order.orderNumber, status: order.status, revision: order.revision, patient: order.patient, samples: order.samples, items: order.items.map((item) => ({ id: item.id, test: { id: item.test.id, code: item.test.code, name: item.test.name }, results: item.results.map((result) => ({ ...result, referenceRangeSnapshot: result.referenceRangeSnapshot ?? null })) })) };
  }

  async verify(currentUser: AuthUser, orderId: string) {
    const order = await this.getOrder(currentUser, orderId);
    if (order.status !== OrderStatus.RESULT_ENTERED) throw new BadRequestException('Only orders with entered results can be verified');
    const missing: string[] = [];
    const resultIds: string[] = [];
    for (const item of order.items) {
      const resultsByParameter = new Map(item.results.map((row) => [row.parameterId, row]));
      for (const parameter of item.test.parameters) {
        const result = resultsByParameter.get(parameter.id);
        if (parameter.isRequired && (!result || !result.value.trim())) missing.push(`${item.test.name}: ${parameter.name}`);
        if (result) {
          if (result.verifiedAt) throw new BadRequestException(`Result for ${parameter.name} has already been verified`);
          resultIds.push(result.id);
        }
      }
    }
    if (missing.length) throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);
    if (!resultIds.length) throw new BadRequestException('No results are available for verification');

    const verifiedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, revision: order.revision, status: OrderStatus.RESULT_ENTERED }, data: { status: OrderStatus.VERIFIED, revision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException('This order changed while you were verifying it. Reload the order and try again.');
      const verified = await tx.orderResult.updateMany({ where: { id: { in: resultIds }, verifiedAt: null }, data: { verifiedAt, verifiedById: currentUser.id } });
      if (verified.count !== resultIds.length) throw new ConflictException('One or more results changed while verification is in progress. Reload the order and try again.');
      await tx.auditLog.create({
        data: {
          labId: currentUser.labId,
          actorId: currentUser.id,
          action: AuditAction.VERIFY,
          entity: 'LabOrderResults',
          entityId: order.id,
          metadata: { operation: 'VERIFY_RESULTS', resultCount: resultIds.length, resultIds },
        },
      });
    });
    return this.findOne(currentUser, orderId);
  }

  private async resolveReferenceRange(parameterId: string, patient: { dateOfBirth: Date | null; age: number | null; gender: any }, method?: string | null, analyzer?: string | null, at = new Date()) {
    const age = this.calculateAge(patient.dateOfBirth, patient.age);
    const rows = await this.prisma.$queryRaw<ResolvedReferenceRange[]>(Prisma.sql`
      SELECT "id", "version", "gender", "ageMinYears"::double precision, "ageMaxYears"::double precision,
             "method", "analyzer", "low", "high", "displayRange", "unit", "effectiveFrom", "effectiveTo"
      FROM "TestParameterReferenceRange"
      WHERE "parameterId" = ${parameterId}
        AND "effectiveFrom" <= ${at}
        AND ("effectiveTo" IS NULL OR "effectiveTo" > ${at})
        AND ("gender" IS NULL OR "gender" = ${patient.gender}::"Gender")
        AND ("ageMinYears" IS NULL OR "ageMinYears" <= ${age})
        AND ("ageMaxYears" IS NULL OR "ageMaxYears" >= ${age})
        AND ("method" IS NULL OR "method" = ${method})
        AND ("analyzer" IS NULL OR "analyzer" = ${analyzer})
      ORDER BY
        CASE WHEN "gender" IS NULL THEN 1 ELSE 0 END,
        CASE WHEN "analyzer" IS NULL THEN 1 ELSE 0 END,
        CASE WHEN "method" IS NULL THEN 1 ELSE 0 END,
        CASE WHEN "ageMinYears" IS NULL AND "ageMaxYears" IS NULL THEN 1 ELSE 0 END,
        COALESCE("ageMaxYears", 1000) - COALESCE("ageMinYears", 0),
        "version" DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
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

  private calculateAge(dateOfBirth: Date | null, storedAge: number | null) {
    if (!dateOfBirth) return Math.max(0, storedAge ?? 0);
    const now = new Date();
    let age = now.getFullYear() - dateOfBirth.getFullYear();
    const beforeBirthday = now.getMonth() < dateOfBirth.getMonth() || (now.getMonth() === dateOfBirth.getMonth() && now.getDate() < dateOfBirth.getDate());
    if (beforeBirthday) age -= 1;
    return Math.max(0, age);
  }
}