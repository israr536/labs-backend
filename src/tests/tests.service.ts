import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ParameterInputType, Prisma } from '@prisma/client';
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
    const data = {
      labId: currentUser.labId,
      scopeId: currentUser.labId,
      code: requiredString(body.code, 'code'),
      shortName: optionalString(body.shortName, 'shortName'),
      name: requiredString(body.name, 'name'),
      category: optionalString(body.category, 'category'),
      department: optionalString(body.department, 'department'),
      sampleType: optionalString(body.sampleType, 'sampleType'),
      price: optionalNumber(body.price, 'price'),
      tat: optionalInteger(body.tat, 'tat'),
      method: optionalString(body.method, 'method'),
      remarks: optionalString(body.remarks, 'remarks'),
      isActive,
      parameters: parameters.length ? { create: parameters } : undefined,
    };
    return this.prisma.$transaction(async (tx) => {
      if (isActive) {
        await this.subscriptionService.lockLimit(tx, currentUser.labId, 'tests');
        await this.subscriptionService.assertWithinLimit(currentUser.labId, 'tests', 1, tx);
      }
      return tx.test.create({ data, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
    });
  }

  /**
   * Resolve selected tests in batches. The report screen normally submits
   * materialized Test IDs, so one findMany replaces one DB query per test.
   * Catalog-only IDs still fall back to the existing materialization path.
   */
  async resolveForUse(currentUser: AuthUser, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return [];

    const actualRows = await this.prisma.test.findMany({
      where: { id: { in: uniqueIds }, labId: currentUser.labId },
      include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true },
    });
    const actualById = new Map(actualRows.map((row) => [row.id, row]));
    const missingIds = uniqueIds.filter((id) => !actualById.has(id));
    if (!missingIds.length) return uniqueIds.map((id) => actualById.get(id)!).filter(Boolean);

    const definitions = await this.prisma.testDefinition.findMany({
      where: { id: { in: missingIds }, isActive: true },
      include: { parameters: { orderBy: { displayOrder: 'asc' } } },
    });
    const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
    const codes = definitions.map((definition) => definition.code);
    const overrides = codes.length
      ? await this.prisma.test.findMany({
          where: { labId: currentUser.labId, OR: [{ catalogId: { in: definitions.map((definition) => definition.id) } }, { code: { in: codes } }] },
          include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true },
        })
      : [];
    const userOverrides = overrides.filter((row) => row.scopeId === currentUser.id);
    const labOverrides = overrides.filter((row) => row.scopeId === currentUser.labId);
    const overrideByCatalog = new Map<string, any>();
    const overrideByCode = new Map<string, any>();
    for (const row of [...labOverrides, ...userOverrides]) {
      if (row.catalogId) overrideByCatalog.set(row.catalogId, row);
      overrideByCode.set(row.code.toLowerCase(), row);
    }

    const resolvedMissing = await Promise.all(missingIds.map(async (id) => {
      const definition = definitionById.get(id);
      if (!definition) throw new NotFoundException('Test not found');
      const override = overrideByCatalog.get(definition.id) ?? overrideByCode.get(definition.code.toLowerCase());
      return override ?? this.materializeForUser(currentUser, this.virtualTest(currentUser.labId, definition));
    }));

    const resolvedById = new Map<string, any>(actualRows.map((row) => [row.id, row]));
    for (let index = 0; index < missingIds.length; index += 1) resolvedById.set(missingIds[index], resolvedMissing[index]);
    return uniqueIds.map((id) => resolvedById.get(id)).filter(Boolean);
  }

  async cloneFromCatalog(currentUser: AuthUser, catalogId: string, overrides: TestBody = {}) {
    const definition = await this.prisma.testDefinition.findFirst({ where: { id: catalogId, isActive: true }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
    if (!definition) throw new NotFoundException('Test catalog definition not found');
    const code = requiredString(overrides.code ?? definition.code, 'code');
    const readyTemplate = DEFAULT_TEST_TEMPLATES.find((template) => template.code === 'CBC' && definition.name.trim().toLowerCase() === 'complete blood count');
    const sourceParameters = readyTemplate?.parameters ?? definition.parameters;
    const existing = await this.prisma.test.findUnique({ where: { labId_scopeId_code: { labId: currentUser.labId, scopeId: currentUser.labId, code } }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });

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
          scopeId: currentUser.labId,
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

  async findAll(currentUser: AuthUser, includeInactive?: string) {
    const includeOff = includeInactive === 'true';
    const [userRows, labRows, definitions] = await Promise.all([
      this.prisma.test.findMany({ where: { labId: currentUser.labId, scopeId: currentUser.id }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      this.prisma.test.findMany({ where: { labId: currentUser.labId, scopeId: currentUser.labId }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
      this.prisma.testDefinition.findMany({ where: { isActive: true }, include: { parameters: { orderBy: { displayOrder: 'asc' } } }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }),
    ]);

    const userByCatalog = new Map(userRows.filter((row) => row.catalogId).map((row) => [row.catalogId as string, row]));
    const labByCatalog = new Map(labRows.filter((row) => row.catalogId).map((row) => [row.catalogId as string, row]));
    const userByCode = new Map(userRows.map((row) => [row.code.toLowerCase(), row]));
    const labByCode = new Map(labRows.map((row) => [row.code.toLowerCase(), row]));
    const result = [] as any[];
    const representedIds = new Set<string>();
    const representedCodes = new Set<string>();

    for (const definition of definitions) {
      const row = userByCatalog.get(definition.id) ?? userByCode.get(definition.code.toLowerCase()) ?? labByCatalog.get(definition.id) ?? labByCode.get(definition.code.toLowerCase());
      if (row) {
        representedIds.add(row.id);
        representedCodes.add(row.code.toLowerCase());
        if (includeOff || row.isActive) result.push(row);
        continue;
      }
      result.push(this.virtualTest(currentUser.labId, definition));
    }

    for (const row of [...labRows, ...userRows]) {
      if (representedIds.has(row.id)) continue;
      if (row.catalogId && definitions.some((definition) => definition.id === row.catalogId)) continue;
      if (representedCodes.has(row.code.toLowerCase())) continue;
      if (includeOff || row.isActive) result.push(row);
    }

    return result.sort((left, right) => `${left.category ?? ''}:${left.name}`.localeCompare(`${right.category ?? ''}:${right.name}`));
  }

  async reportEntryCatalog(currentUser: AuthUser) {
    return this.findAll(currentUser);
  }

  async findOne(currentUser: AuthUser, id: string) {
    const actual = await this.findActual(currentUser, id);
    if (actual) return actual;

    const definition = await this.prisma.testDefinition.findFirst({ where: { id, isActive: true }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
    if (!definition) throw new NotFoundException('Test not found');
    const userOverride = await this.prisma.test.findFirst({ where: { labId: currentUser.labId, scopeId: currentUser.id, OR: [{ catalogId: definition.id }, { code: definition.code }] }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
    if (userOverride) return userOverride;
    const labTest = await this.prisma.test.findFirst({ where: { labId: currentUser.labId, scopeId: currentUser.labId, OR: [{ catalogId: definition.id }, { code: definition.code }] }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
    return labTest ?? this.virtualTest(currentUser.labId, definition);
  }

  async resolveParameterId(currentUser: AuthUser, parameterId: string, materialize = false) {
    const direct = await this.prisma.testParameter.findUnique({ where: { id: parameterId }, include: { test: { include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } } } });
    if (direct && direct.test.labId === currentUser.labId) {
      if (!materialize || direct.test.scopeId === currentUser.id) return direct.id;
      const userTest = await this.materializeForUser(currentUser, direct.test);
      const matching = userTest.parameters.find((parameter: any) => parameter.name.trim().toLowerCase() === direct.name.trim().toLowerCase());
      if (matching) return matching.id;
    }

    const catalogParameter = await this.prisma.testDefinitionParameter.findUnique({ where: { id: parameterId }, include: { testDefinition: true } });
    if (!catalogParameter || !catalogParameter.testDefinition.isActive) throw new NotFoundException('Test parameter not found');
    const effective = await this.findOne(currentUser, catalogParameter.testDefinitionId);
    const target = materialize ? await this.materializeForUser(currentUser, effective) : effective;
    const matching = target.parameters.find((parameter: any) => parameter.name.trim().toLowerCase() === catalogParameter.name.trim().toLowerCase());
    if (!matching) throw new NotFoundException('Test parameter not found');
    return matching.id;
  }

  async update(currentUser: AuthUser, id: string, body: TestBody) {
    const test = await this.prepareForEdit(currentUser, id);
    const parameters = body.parameters === undefined ? undefined : this.parseParameters(body.parameters, true);
    if (parameters) {
      const resultCount = await this.prisma.reportResult.count({ where: { parameter: { testId: test.id } } });
      const orderResultCount = await this.prisma.orderResult.count({ where: { parameter: { testId: test.id } } });
      if (resultCount > 0 || orderResultCount > 0) throw new BadRequestException('Cannot replace parameters after results have been entered');
    }
    return this.prisma.test.update({ where: { id: test.id }, data: { code: body.code === undefined ? undefined : requiredString(body.code, 'code'), shortName: optionalString(body.shortName, 'shortName'), name: body.name ? requiredString(body.name, 'name') : undefined, category: optionalString(body.category, 'category'), department: optionalString(body.department, 'department'), sampleType: optionalString(body.sampleType, 'sampleType'), price: optionalNumber(body.price, 'price'), tat: optionalInteger(body.tat, 'tat'), method: optionalString(body.method, 'method'), remarks: optionalString(body.remarks, 'remarks'), isActive: optionalBoolean(body.isActive, 'isActive'), ...(parameters ? { parameters: { deleteMany: {}, create: parameters } } : {}) }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
  }

  async addParameter(currentUser: AuthUser, testId: string, body: ParameterBody) {
    const test = await this.prepareForEdit(currentUser, testId);
    return this.prisma.testParameter.create({ data: { testId: test.id, ...this.parseParameter(body, 0) } });
  }

  async updateParameter(currentUser: AuthUser, testId: string, parameterId: string, body: ParameterBody) {
    const test = await this.prepareForEdit(currentUser, testId);
    const resolvedParameterId = await this.resolveParameterId(currentUser, parameterId, true);
    const parameter = await this.prisma.testParameter.findFirst({ where: { id: resolvedParameterId, testId: test.id } });
    if (!parameter) throw new NotFoundException('Parameter not found');
    const [reportResultCount, orderResultCount] = await Promise.all([this.prisma.reportResult.count({ where: { parameterId: resolvedParameterId } }), this.prisma.orderResult.count({ where: { parameterId: resolvedParameterId } })]);
    if (reportResultCount > 0 || orderResultCount > 0) throw new BadRequestException('Cannot change a parameter after results have been entered');
    return this.prisma.testParameter.update({ where: { id: resolvedParameterId }, data: { name: body.name ? requiredString(body.name, 'name') : undefined, inputType: body.inputType ? enumValue(ParameterInputType, body.inputType, 'inputType') : undefined, unit: optionalString(body.unit, 'unit'), normalMin: optionalNumber(body.normalMin, 'normalMin'), normalMax: optionalNumber(body.normalMax, 'normalMax'), referenceRange: body.referenceRange == null ? undefined : body.referenceRange, options: body.options == null ? undefined : body.options, validation: body.validation == null ? undefined : body.validation, criticalLow: optionalNumber(body.criticalLow, 'criticalLow'), criticalHigh: optionalNumber(body.criticalHigh, 'criticalHigh'), decimalPlaces: optionalInteger(body.decimalPlaces, 'decimalPlaces'), defaultValue: optionalString(body.defaultValue, 'defaultValue'), formula: optionalString(body.formula, 'formula'), displayOrder: optionalInteger(body.displayOrder, 'displayOrder'), isRequired: optionalBoolean(body.isRequired, 'isRequired'), remarks: optionalString(body.remarks, 'remarks') } });
  }

  async removeParameter(currentUser: AuthUser, testId: string, parameterId: string) {
    const test = await this.prepareForEdit(currentUser, testId);
    const resolvedParameterId = await this.resolveParameterId(currentUser, parameterId, true);
    const parameter = await this.prisma.testParameter.findFirst({ where: { id: resolvedParameterId, testId: test.id } });
    if (!parameter) throw new NotFoundException('Parameter not found');
    const [resultCount, orderResultCount] = await Promise.all([this.prisma.reportResult.count({ where: { parameterId: resolvedParameterId } }), this.prisma.orderResult.count({ where: { parameterId: resolvedParameterId } })]);
    if (resultCount > 0 || orderResultCount > 0) throw new BadRequestException('Cannot delete a parameter used in results');
    await this.prisma.testParameter.delete({ where: { id: parameter.id } });
    return { success: true };
  }

  async remove(currentUser: AuthUser, id: string) {
    const test = await this.prepareForEdit(currentUser, id);
    await this.prisma.test.update({ where: { id: test.id }, data: { isActive: false } });
    return { success: true };
  }

  private async prepareForEdit(currentUser: AuthUser, id: string) {
    const actual = await this.findActual(currentUser, id);
    if (actual?.scopeId === currentUser.id) return actual;
    const effective = actual ?? await this.findOne(currentUser, id);
    return this.materializeForUser(currentUser, effective);
  }

  private async findActual(currentUser: AuthUser, id: string) {
    return this.prisma.test.findFirst({ where: { id, labId: currentUser.labId }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
  }

  private async materializeForUser(currentUser: AuthUser, source: any) {
    const existing = await this.prisma.test.findFirst({ where: { labId: currentUser.labId, scopeId: currentUser.id, OR: [{ catalogId: source.catalogId ?? source.id }, { code: source.code }] }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
    if (existing) return existing;

    try {
      return await this.prisma.test.create({
        data: {
          labId: currentUser.labId,
          scopeId: currentUser.id,
          catalogId: source.catalogId ?? (source.id === source.catalog?.id ? source.id : null),
          code: source.code,
          shortName: source.shortName ?? null,
          name: source.name,
          category: source.category ?? null,
          department: source.department ?? null,
          sampleType: source.sampleType ?? source.specimenType ?? null,
          price: source.price ?? null,
          tat: source.tat ?? null,
          method: source.method ?? null,
          remarks: source.remarks ?? null,
          isActive: source.isActive ?? true,
          parameters: source.parameters?.length ? { create: source.parameters.map((parameter: any, index: number) => this.toParameterCreateData(parameter, index)) } : undefined,
        },
        include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await this.prisma.test.findFirst({ where: { labId: currentUser.labId, scopeId: currentUser.id, code: source.code }, include: { parameters: { orderBy: { displayOrder: 'asc' } }, catalog: true } });
        if (raced) return raced;
      }
      throw error;
    }
  }

  private virtualTest(labId: string, definition: any) {
    return {
      ...definition,
      labId,
      scopeId: labId,
      catalogId: definition.id,
      sampleType: definition.specimenType,
      price: null,
      isActive: true,
      catalog: definition,
    };
  }

  private parseParameters(value: unknown, replace: boolean) { if (value === undefined || value === null) return []; const parameters = arrayValue<ParameterBody>(value, 'parameters'); if (replace && parameters.length === 0) return []; return parameters.map((parameter, index) => this.parseParameter(parameter, index)); }
  private parseParameter(parameter: ParameterBody, index: number) { return { name: requiredString(parameter.name, `parameters.${index}.name`), inputType: parameter.inputType === undefined ? ParameterInputType.NUMBER : enumValue(ParameterInputType, parameter.inputType, `parameters.${index}.inputType`), unit: optionalString(parameter.unit, `parameters.${index}.unit`), normalMin: optionalNumber(parameter.normalMin, `parameters.${index}.normalMin`), normalMax: optionalNumber(parameter.normalMax, `parameters.${index}.normalMax`), referenceRange: parameter.referenceRange == null ? undefined : parameter.referenceRange, options: parameter.options == null ? undefined : parameter.options, validation: parameter.validation == null ? undefined : parameter.validation, criticalLow: optionalNumber(parameter.criticalLow, `parameters.${index}.criticalLow`), criticalHigh: optionalNumber(parameter.criticalHigh, `parameters.${index}.criticalHigh`), decimalPlaces: optionalInteger(parameter.decimalPlaces, `parameters.${index}.decimalPlaces`), defaultValue: optionalString(parameter.defaultValue, `parameters.${index}.defaultValue`), formula: optionalString(parameter.formula, `parameters.${index}.formula`), displayOrder: optionalInteger(parameter.displayOrder, `parameters.${index}.displayOrder`) ?? index, isRequired: optionalBoolean(parameter.isRequired, `parameters.${index}.isRequired`) ?? true, remarks: optionalString(parameter.remarks, `parameters.${index}.remarks`) }; }
}
