import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, OrderStatus, ParameterInputType, Prisma, ResultFlag } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth.types';
import { arrayValue, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { ResolvedReferenceRange } from '../reference-ranges/reference-ranges.service';

interface ResultInput { parameterId?: unknown; value?: unknown; sampleId?: unknown; analyzer?: unknown; }
interface ResultsBody { results?: unknown; }
type ValidationRules = { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string };

@Injectable()
export class ResultsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async save(currentUser: AuthUser, orderId: string, body: ResultsBody = {}, options: { reload?: boolean; loadedOrder?: any } = {}) {
    const inputs = arrayValue<ResultInput>(body.results ?? [], 'results');
    const order: any = options.loadedOrder ?? (await this.getOrder(currentUser, orderId));
    const lockedStatuses: OrderStatus[] = [OrderStatus.CANCELLED, OrderStatus.FINAL, OrderStatus.VERIFIED];
    if (lockedStatuses.includes(order.status)) throw new BadRequestException('Results cannot be edited after verification or finalization');
    if (!inputs.length) throw new BadRequestException('At least one result is required');
    const items: any[] = order.items.flatMap((item: any) => item.test.parameters.map((parameter: any) => ({ item, parameter })));
    const byParameter = new Map<string, any>(items.map(({ parameter, item }) => [parameter.id, { parameter, item }]));
    const samplesById = new Map<string, any>((order.samples ?? []).map((sample: any) => [sample.id, sample]));
    const existingByParameter = new Map<string, any>(order.items.flatMap((item: any) => (item.results ?? []).map((result: any) => [result.parameterId, result] as const)));
    const seen = new Set<string>();
    const createdParameterIds: string[] = [];
    const changedParameterIds: string[] = [];
    const parsed = inputs.map((input, index) => {
      const parameterId = requiredString(input.parameterId, `results.${index}.parameterId`);
      const target: any = byParameter.get(parameterId);
      if (!target) throw new BadRequestException(`results.${index}.parameterId does not belong to this order`);
      if (seen.has(parameterId)) throw new BadRequestException(`Duplicate result for parameter ${parameterId}`);
      seen.add(parameterId);
      const rawValue = input.value === undefined || input.value === null ? '' : String(input.value).trim();
      if (!rawValue && target.parameter.isRequired) throw new BadRequestException(`results.${index}.value is required`);
      const existing: any = existingByParameter.get(parameterId);
      if (existing?.verifiedAt) throw new BadRequestException(`Result for ${target.parameter.name} has already been verified and cannot be changed`);
      if (existing) changedParameterIds.push(parameterId); else createdParameterIds.push(parameterId);
      const value = rawValue ? this.validateValue(target.parameter, rawValue, index) : '';
      const sampleId = input.sampleId === undefined ? undefined : requiredString(input.sampleId, `results.${index}.sampleId`);
      if (sampleId) {
        const sample: any = samplesById.get(sampleId);
        if (!sample) throw new BadRequestException('sampleId does not belong to this order');
        if (sample.status !== 'PROCESSING' && sample.status !== 'COMPLETED') throw new BadRequestException('Results can only be linked to a processing or completed sample');
      }
      const analyzer = input.analyzer === undefined ? null : requiredString(input.analyzer, `results.${index}.analyzer`);
      return { orderItemId: target.item.id, parameterId, sampleId, value, analyzer, method: target.item.test.method, parameter: target.parameter };
    });
    const ranges = await this.resolveReferenceRanges([...new Set(parsed.filter((item) => item.value).map((item) => item.parameterId))], order.patient, new Map(parsed.map((item) => [item.parameterId, item.method ?? null])), new Map(parsed.map((item) => [item.parameterId, item.analyzer ?? null])));
    const normalized = parsed.map((item) => {
      const range = item.value ? ranges.get(item.parameterId) ?? null : null;
      return { orderItemId: item.orderItemId, parameterId: item.parameterId, sampleId: item.sampleId, value: item.value, flag: item.value ? this.calculateFlag(item.parameter, item.value, range) : undefined, referenceRangeId: range?.id ?? null, referenceRangeSnapshot: range ? { id: range.id, version: range.version, gender: range.gender, ageMinYears: range.ageMinYears, ageMaxYears: range.ageMaxYears, method: range.method, analyzer: range.analyzer, low: range.low, high: range.high, displayRange: range.displayRange, unit: range.unit, effectiveFrom: range.effectiveFrom, effectiveTo: range.effectiveTo } : null };
    });
    const revision = order.revision ?? 0;
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, revision, status: { notIn: lockedStatuses } }, data: { revision: { increment: 1 }, status: OrderStatus.RESULT_ENTERED } });
      if (locked.count !== 1) throw new ConflictException('This order was updated by another user. Reload the order and try again.');
      const allNew = normalized.length > 0 && createdParameterIds.length === normalized.length;
      if (allNew) {
        await tx.orderResult.createMany({ data: normalized.map((result) => ({ orderItemId: result.orderItemId, parameterId: result.parameterId, sampleId: result.sampleId ?? null, value: result.value, flag: result.flag, referenceRangeId: result.referenceRangeId, referenceRangeSnapshot: result.referenceRangeSnapshot ?? Prisma.JsonNull })) });
      } else {
        for (const result of normalized) await tx.orderResult.upsert({ where: { orderItemId_parameterId: { orderItemId: result.orderItemId, parameterId: result.parameterId } }, create: { orderItemId: result.orderItemId, parameterId: result.parameterId, sampleId: result.sampleId, value: result.value, flag: result.flag, referenceRangeId: result.referenceRangeId, referenceRangeSnapshot: result.referenceRangeSnapshot ?? Prisma.JsonNull }, update: { value: result.value, flag: result.flag, sampleId: result.sampleId, verifiedAt: null, verifiedById: null, referenceRangeId: result.referenceRangeId, referenceRangeSnapshot: result.referenceRangeSnapshot ?? Prisma.JsonNull } });
      }
    });
    await this.audit.record(currentUser, AuditAction.UPDATE, 'LabOrderResults', order.id, { operation: 'SAVE_RESULTS', orderRevision: revision + 1, createdCount: createdParameterIds.length, updatedCount: changedParameterIds.length, createdParameterIds, updatedParameterIds: changedParameterIds });
    if (options.reload === false) return { normalized };
    return this.findOne(currentUser, orderId);
  }

  async findOne(currentUser: AuthUser, orderId: string) {
    const order: any = await this.getOrder(currentUser, orderId);
    return { id: order.id, orderNumber: order.orderNumber, status: order.status, revision: order.revision, patient: order.patient, samples: order.samples, items: order.items.map((item: any) => ({ id: item.id, test: { id: item.test.id, code: item.test.code, name: item.test.name }, results: item.results.map((result: any) => ({ ...result, referenceRangeSnapshot: result.referenceRangeSnapshot ?? null })) })) };
  }

  async verify(currentUser: AuthUser, orderId: string, options: { reload?: boolean } = {}) { return this.verifyLoaded(currentUser, await this.getOrder(currentUser, orderId), options); }
  async getOrderForWorkflow(currentUser: AuthUser, orderId: string) { return this.getOrder(currentUser, orderId); }

  async verifyLoaded(currentUser: AuthUser, order: any, options: { reload?: boolean } = {}) {
    if (order.status !== OrderStatus.RESULT_ENTERED) throw new BadRequestException('Only orders with entered results can be verified');
    const missing: string[] = [];
    const resultIds: string[] = [];
    const resultKeys: Array<{ orderItemId: string; parameterId: string }> = [];
    for (const item of order.items as any[]) {
      const resultsByParameter = new Map<string, any>((item.results ?? []).map((row: any) => [row.parameterId, row]));
      for (const parameter of item.test.parameters as any[]) {
        const result: any = resultsByParameter.get(parameter.id);
        if (parameter.isRequired && (!result || !String(result.value ?? '').trim())) missing.push(`${item.test.name}: ${parameter.name}`);
        if (result) {
          if (result.verifiedAt) throw new BadRequestException(`Result for ${parameter.name} has already been verified`);
          if (result.id) resultIds.push(result.id);
          resultKeys.push({ orderItemId: item.id, parameterId: parameter.id });
        }
      }
    }
    if (missing.length) throw new BadRequestException(`Missing required results: ${missing.join(', ')}`);
    if (!resultKeys.length) throw new BadRequestException('No results are available for verification');
    const verifiedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.labOrder.updateMany({ where: { id: order.id, labId: currentUser.labId, revision: order.revision, status: OrderStatus.RESULT_ENTERED }, data: { status: OrderStatus.VERIFIED, revision: { increment: 1 } } });
      if (locked.count !== 1) throw new ConflictException('This order changed while you were verifying it. Reload the order and try again.');
      const resultWhere: any = resultIds.length === resultKeys.length ? { id: { in: resultIds }, verifiedAt: null } : { OR: resultKeys.map((key) => ({ orderItemId: key.orderItemId, parameterId: key.parameterId })), verifiedAt: null };
      const verified = await tx.orderResult.updateMany({ where: resultWhere, data: { verifiedAt, verifiedById: currentUser.id } });
      if (verified.count !== resultKeys.length) throw new ConflictException('One or more results changed while verification is in progress. Reload the order and try again.');
    });
    await this.audit.record(currentUser, AuditAction.VERIFY, 'LabOrderResults', order.id, { operation: 'VERIFY_RESULTS', resultCount: resultKeys.length, resultIds, resultKeys });
    if (options.reload === false) return { id: order.id, status: OrderStatus.VERIFIED, revision: order.revision + 1 };
    return this.findOne(currentUser, order.id);
  }

  private async resolveReferenceRanges(parameterIds: string[], patient: { dateOfBirth: Date | null; age: number | null; gender: any }, methodByParameter: Map<string, string | null>, analyzerByParameter: Map<string, string | null>, at = new Date()) {
    if (!parameterIds.length) return new Map<string, ResolvedReferenceRange>();
    const age = this.calculateAge(patient.dateOfBirth, patient.age);
    const rows = await this.prisma.testParameterReferenceRange.findMany({ where: { parameterId: { in: parameterIds }, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] } });
    const best = new Map<string, ResolvedReferenceRange>();
    const scores = new Map<string, number[]>();
    const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i += 1) { if (a[i] !== b[i]) return a[i] < b[i]; } return false; };
    for (const row of rows) {
      if (row.gender !== null && row.gender !== patient.gender) continue;
      if (row.ageMinYears !== null && Number(row.ageMinYears) > age) continue;
      if (row.ageMaxYears !== null && Number(row.ageMaxYears) < age) continue;
      const method = methodByParameter.get(row.parameterId) ?? null;
      const analyzer = analyzerByParameter.get(row.parameterId) ?? null;
      if (row.method !== null && row.method !== method) continue;
      if (row.analyzer !== null && row.analyzer !== analyzer) continue;
      const score = [row.gender === patient.gender ? 0 : 1, row.analyzer === analyzer && analyzer !== null ? 0 : row.analyzer === null ? 1 : 99, row.method === method && method !== null ? 0 : row.method === null ? 1 : 99, row.ageMinYears === null && row.ageMaxYears === null ? 10000 : Number(row.ageMaxYears ?? 1000) - Number(row.ageMinYears ?? 0), -(row.version ?? 0), -new Date(row.effectiveFrom).getTime()];
      const current = scores.get(row.parameterId);
      if (!current || better(score, current)) { best.set(row.parameterId, row as ResolvedReferenceRange); scores.set(row.parameterId, score); }
    }
    return best;
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
    const dob = new Date(dateOfBirth);
    let age = now.getFullYear() - dob.getFullYear();
    const month = now.getMonth() - dob.getMonth();
    if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age -= 1;
    return Math.max(0, age);
  }
}