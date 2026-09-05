import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ParameterInputType } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { arrayValue, enumValue, optionalBoolean, optionalInteger, optionalNumber, optionalString, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';
import { DEFAULT_TEST_TEMPLATES } from './default-test-templates';

interface TestBody { code?: unknown; shortName?: unknown; name?: unknown; category?: unknown; department?: unknown; sampleType?: unknown; price?: unknown; tat?: unknown; method?: unknown; remarks?: unknown; isActive?: unknown; parameters?: unknown }
interface ParameterBody { name?: unknown; inputType?: unknown; unit?: unknown; normalMin?: unknown; normalMax?: unknown; referenceRange?: unknown; options?: unknown; validation?: unknown; criticalLow?: unknown; criticalHigh?: unknown; decimalPlaces?: unknown; defaultValue?: unknown; formula?: unknown; displayOrder?: unknown; isRequired?: unknown; remarks?: unknown }

@Injectable()
export class TestsService {
  constructor(private readonly prisma: PrismaService, private readonly subscriptionService: SubscriptionService) {}

  async create(currentUser: AuthUser, body: TestBody) {
    const isActive = optionalBoolean(body.isActive, 'isActive') ?? true;
    const parameters = this.parseParameters(body.parameters, false);
    const data = { labId: currentUser.labId, code: requiredString(body.code, 'code'), shortName: optionalString(body.shortName, 'shortName'), name: requiredString(body.name, 'name'), category: optionalString(body.category, 'category'), department: optionalString(body.department, 'department'), sampleType: optionalString(body.sampleType, 'sampleType'), price: optionalNumber(body.price, 'price'), tat: optionalInteger(body.tat, 'tat'), method: optionalString(body.method, 'method'), remarks: optionalString(body.remarks, 'remarks'), isActive, parameters: parameters.length ? { create: parameters } : undefined };
    return this.prisma.$transaction(async (tx) => { if (isActive) { await this.subscriptionService.lockLimit(tx, currentUser.labId, 'tests'); await this.subscriptionService.assertWithinLimit(currentUser.labId, 'tests', 1, tx); } return tx.test.create({ data, include: { parameters: { orderBy: { displayOrder: 'asc' } } } }); });
  }

  async cloneFromCatalog(currentUser: AuthUser, catalogId: string, overrides: TestBody = {}) {
    const definition = await this.prisma.testDefinition.findFirst({ where: { id: catalogId, isActive: true }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
    if (!definition) throw new NotFoundException('Test catalog definition not found');
    const code = requiredString(overrides.code ?? definition.code, 'code');
    const readyTemplate = DEFAULT_TEST_TEMPLATES.find((template) => template.code === 'CBC' && definition.name.trim().toLowerCase() === 'complete blood count');
    const sourceParameters = readyTemplate?.parameters ?? definition.parameters;
    const existing = await this.prisma.test.findUnique({ where: { labId_code: { labId: currentUser.labId, code } }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });

    if (existing) {
      if (!readyTemplate || existing.parameters.length > 1) throw new BadRequestException(`Test code '${code}' already exists in this lab`);
      const [reportResultCount, orderResultCount] = await Promise.all([
        this.prisma.reportResult.count({ where: { parameter: { testId: existing.id } } }),
        this.prisma.orderResult.count({ where: { parameter: { testId: existing.id } } }),
      ]);
      if (reportResultCount || orderResultCount) throw new BadRequestException(`Test code '${code}' already exists and already has results`);
      return this.prisma.$transaction(async (tx) => tx.test.update({
        where: { id: existing.id },
        data: { parameters: { deleteMany: {}, create: sourceParameters.map((parameter, index) => this.toParameterCreateData(parameter, index)) } },
        include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true },
      }));
    }

    return this.prisma.$transaction(async (tx) => {
      await this.subscriptionService.lockLimit(tx, currentUser.labId, 'tests');
      await this.subscriptionService.assertWithinLimit(currentUser.labId, 'tests', 1, tx);
      return tx.test.create({
        data: {
          labId: currentUser.labId,
          catalogId: definition.id,
          code,
          shortName: optionalString(overrides.shortName ?? definition.shortName, 'shortName'),
          name: requiredString(overrides.name ?? definition.name, 'name'),
          category: optionalString(overrides.category ?? definition.category, 'category'),
          department: optionalString(overrides.department ?? definition.department, 'department'),
          sampleType: optionalString(overrides.sampleType ?? definition.specimenType, 'sampleType'),
          price: optionalNumber(overrides.price, 'price'),
          tat: optionalInteger(overrides.tat ?? definition.tat, 'tat'),
          method: optionalString(overrides.method ?? definition.method, 'method'),
          remarks: optionalString(overrides.remarks, 'remarks'),
          isActive: optionalBoolean(overrides.isActive, 'isActive') ?? true,
          parameters: { create: sourceParameters.map((parameter, index) => this.toParameterCreateData(parameter, index)) },
        },
        include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true },
      });
    });
  }

  private toParameterCreateData(parameter: any, index: number) {
    return {
      name: parameter.name,
      inputType: enumValue(ParameterInputType, parameter.inputType, `parameters.${index}.inputType`),
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
      displayOrder: parameter.displayOrder ?? index,
      isRequired: parameter.isRequired ?? true,
      remarks: parameter.remarks ?? null,
    };
  }

  findAll(currentUser: AuthUser, includeInactive?: string) { return this.prisma.test.findMany({ where: { labId: currentUser.labId, ...(includeInactive === 'true' ? {} : { isActive: true }) }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }); }
  async findOne(currentUser: AuthUser, id: string) { const test = await this.prisma.test.findFirst({ where: { id, labId: currentUser.labId }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } }); if (!test) throw new NotFoundException('Test not found'); return test; }

  async update(currentUser: AuthUser, id: string, body: TestBody) {
    await this.findOne(currentUser, id); const parameters = body.parameters === undefined ? undefined : this.parseParameters(body.parameters, true);
    if (parameters) { const resultCount = await this.prisma.reportResult.count({ where: { parameter: { testId: id } } }); const orderResultCount = await this.prisma.orderResult.count({ where: { parameter: { testId: id } } }); if (resultCount > 0 || orderResultCount > 0) throw new BadRequestException('Cannot replace parameters after results have been entered'); }
    return this.prisma.test.update({ where: { id }, data: { code: body.code === undefined ? undefined : requiredString(body.code, 'code'), shortName: optionalString(body.shortName, 'shortName'), name: body.name ? requiredString(body.name, 'name') : undefined, category: optionalString(body.category, 'category'), department: optionalString(body.department, 'department'), sampleType: optionalString(body.sampleType, 'sampleType'), price: optionalNumber(body.price, 'price'), tat: optionalInteger(body.tat, 'tat'), method: optionalString(body.method, 'method'), remarks: optionalString(body.remarks, 'remarks'), isActive: optionalBoolean(body.isActive, 'isActive'), ...(parameters ? { parameters: { deleteMany: {}, create: parameters } } : {}) }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
  }

  async addParameter(currentUser: AuthUser, testId: string, body: ParameterBody) { await this.findOne(currentUser, testId); return this.prisma.testParameter.create({ data: { testId, ...this.parseParameter(body, 0) } }); }
  async updateParameter(currentUser: AuthUser, testId: string, parameterId: string, body: ParameterBody) { await this.findOne(currentUser, testId); const parameter = await this.prisma.testParameter.findFirst({ where: { id: parameterId, testId } }); if (!parameter) throw new NotFoundException('Parameter not found'); const [reportResultCount, orderResultCount] = await Promise.all([this.prisma.reportResult.count({ where: { parameterId } }), this.prisma.orderResult.count({ where: { parameterId } })]); if (reportResultCount > 0 || orderResultCount > 0) throw new BadRequestException('Cannot change a parameter after results have been entered'); return this.prisma.testParameter.update({ where: { id: parameterId }, data: { name: body.name ? requiredString(body.name, 'name') : undefined, inputType: body.inputType ? enumValue(ParameterInputType, body.inputType, 'inputType') : undefined, unit: optionalString(body.unit, 'unit'), normalMin: optionalNumber(body.normalMin, 'normalMin'), normalMax: optionalNumber(body.normalMax, 'normalMax'), referenceRange: body.referenceRange == null ? undefined : body.referenceRange, options: body.options == null ? undefined : body.options, validation: body.validation == null ? undefined : body.validation, criticalLow: optionalNumber(body.criticalLow, 'criticalLow'), criticalHigh: optionalNumber(body.criticalHigh, 'criticalHigh'), decimalPlaces: optionalInteger(body.decimalPlaces, 'decimalPlaces'), defaultValue: optionalString(body.defaultValue, 'defaultValue'), formula: optionalString(body.formula, 'formula'), displayOrder: optionalInteger(body.displayOrder, 'displayOrder'), isRequired: optionalBoolean(body.isRequired, 'isRequired'), remarks: optionalString(body.remarks, 'remarks') } }); }
  async removeParameter(currentUser: AuthUser, testId: string, parameterId: string) { await this.findOne(currentUser, testId); const parameter = await this.prisma.testParameter.findFirst({ where: { id: parameterId, testId } }); if (!parameter) throw new NotFoundException('Parameter not found'); const [resultCount, orderResultCount] = await Promise.all([this.prisma.reportResult.count({ where: { parameterId } }), this.prisma.orderResult.count({ where: { parameterId } })]); if (resultCount > 0 || orderResultCount > 0) throw new BadRequestException('Cannot delete a parameter used in results'); await this.prisma.testParameter.delete({ where: { id: parameter.id } }); return { success: true }; }
  async remove(currentUser: AuthUser, id: string) { await this.findOne(currentUser, id); await this.prisma.test.update({ where: { id }, data: { isActive: false } }); return { success: true }; }

  private parseParameters(value: unknown, replace: boolean) { if (value === undefined || value === null) return []; const parameters = arrayValue<ParameterBody>(value, 'parameters'); if (replace && parameters.length === 0) return []; return parameters.map((parameter, index) => this.parseParameter(parameter, index)); }
  private parseParameter(parameter: ParameterBody, index: number) { return { name: requiredString(parameter.name, `parameters.${index}.name`), inputType: parameter.inputType === undefined ? ParameterInputType.NUMBER : enumValue(ParameterInputType, parameter.inputType, `parameters.${index}.inputType`), unit: optionalString(parameter.unit, `parameters.${index}.unit`), normalMin: optionalNumber(parameter.normalMin, `parameters.${index}.normalMin`), normalMax: optionalNumber(parameter.normalMax, `parameters.${index}.normalMax`), referenceRange: parameter.referenceRange == null ? undefined : parameter.referenceRange, options: parameter.options == null ? undefined : parameter.options, validation: parameter.validation == null ? undefined : parameter.validation, criticalLow: optionalNumber(parameter.criticalLow, `parameters.${index}.criticalLow`), criticalHigh: optionalNumber(parameter.criticalHigh, `parameters.${index}.criticalHigh`), decimalPlaces: optionalInteger(parameter.decimalPlaces, `parameters.${index}.decimalPlaces`), defaultValue: optionalString(parameter.defaultValue, `parameters.${index}.defaultValue`), formula: optionalString(parameter.formula, `parameters.${index}.formula`), displayOrder: optionalInteger(parameter.displayOrder, `parameters.${index}.displayOrder`) ?? index, isRequired: optionalBoolean(parameter.isRequired, `parameters.${index}.isRequired`) ?? true, remarks: optionalString(parameter.remarks, `parameters.${index}.remarks`) }; }
}
