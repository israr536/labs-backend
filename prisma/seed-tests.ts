import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { MASTER_TESTS, MASTER_TEST_CATALOG_VERSION } from '../master-tests/catalog';

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === 'true';
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl: useSsl ? { rejectUnauthorized: false } : false }) });

async function seedDefinitions() {
  let count = 0;
  for (const definition of MASTER_TESTS) {
    const catalog = await prisma.testDefinition.upsert({
      where: { code: definition.code },
      update: { shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, specimenType: definition.sampleType, method: definition.method, tat: definition.tat, isActive: true },
      create: { code: definition.code, shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, specimenType: definition.sampleType, method: definition.method, tat: definition.tat, isActive: true },
    });
    for (const [index, parameter] of definition.parameters.entries()) {
      const source = parameter as typeof parameter & { validation?: unknown; criticalLow?: number; criticalHigh?: number; decimalPlaces?: number; defaultValue?: string; formula?: string };
      const code = `${definition.code}-P${index + 1}`;
      await prisma.testDefinitionParameter.upsert({
        where: { testDefinitionId_code: { testDefinitionId: catalog.id, code } },
        update: { name: parameter.name, inputType: parameter.inputType, unit: parameter.unit ?? null, normalMin: parameter.normalMin ?? null, normalMax: parameter.normalMax ?? null, referenceRange: parameter.referenceRange ?? undefined, options: parameter.options ?? undefined, validation: source.validation ?? undefined, criticalLow: source.criticalLow ?? null, criticalHigh: source.criticalHigh ?? null, decimalPlaces: source.decimalPlaces ?? null, defaultValue: source.defaultValue ?? null, formula: source.formula ?? null, displayOrder: parameter.displayOrder ?? index, isRequired: parameter.isRequired ?? true, remarks: parameter.remarks ?? null },
        create: { testDefinitionId: catalog.id, code, name: parameter.name, inputType: parameter.inputType, unit: parameter.unit ?? null, normalMin: parameter.normalMin ?? null, normalMax: parameter.normalMax ?? null, referenceRange: parameter.referenceRange ?? undefined, options: parameter.options ?? undefined, validation: source.validation ?? undefined, criticalLow: source.criticalLow ?? null, criticalHigh: source.criticalHigh ?? null, decimalPlaces: source.decimalPlaces ?? null, defaultValue: source.defaultValue ?? null, formula: source.formula ?? null, displayOrder: parameter.displayOrder ?? index, isRequired: parameter.isRequired ?? true, remarks: parameter.remarks ?? null },
      });
    }
    count += 1;
  }
  return count;
}

async function resolveLabs() {
  const requestedLabId = process.env.SEED_LAB_ID?.trim();
  if (requestedLabId) {
    const lab = await prisma.lab.findUnique({ where: { id: requestedLabId } });
    if (!lab) throw new Error(`Lab ${requestedLabId} was not found`);
    return [lab];
  }
  if (process.env.SEED_ALL_LABS === 'true') return prisma.lab.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return [];
}

async function seedLab(labId: string) {
  let createdTests = 0;
  let updatedTests = 0;
  for (const definition of MASTER_TESTS) {
    const catalog = await prisma.testDefinition.findUnique({ where: { code: definition.code }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
    if (!catalog) throw new Error(`Catalog definition ${definition.code} was not created`);
    const existing = await prisma.test.findUnique({ where: { labId_code: { labId, code: definition.code } }, include: { parameters: true } });
    const test = existing
      ? await prisma.test.update({ where: { id: existing.id }, data: { catalogId: catalog.id, shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, sampleType: definition.sampleType, method: definition.method, tat: definition.tat, isActive: true } })
      : await prisma.test.create({ data: { labId, catalogId: catalog.id, code: definition.code, shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, sampleType: definition.sampleType, method: definition.method, tat: definition.tat, isActive: true } });
    existing ? updatedTests++ : createdTests++;
    for (const parameter of catalog.parameters) {
      const current = existing?.parameters.find((item) => item.name === parameter.name);
      const data = { inputType: parameter.inputType, unit: parameter.unit, normalMin: parameter.normalMin, normalMax: parameter.normalMax, referenceRange: parameter.referenceRange ?? undefined, options: parameter.options ?? undefined, validation: parameter.validation ?? undefined, criticalLow: parameter.criticalLow, criticalHigh: parameter.criticalHigh, decimalPlaces: parameter.decimalPlaces, defaultValue: parameter.defaultValue, formula: parameter.formula, displayOrder: parameter.displayOrder, isRequired: parameter.isRequired, remarks: parameter.remarks };
      if (!current) { await prisma.testParameter.create({ data: { testId: test.id, name: parameter.name, ...data } }); continue; }
      const [reportResultCount, orderResultCount] = await Promise.all([prisma.reportResult.count({ where: { parameterId: current.id } }), prisma.orderResult.count({ where: { parameterId: current.id } })]);
      if (reportResultCount || orderResultCount) continue;
      await prisma.testParameter.update({ where: { id: current.id }, data });
    }
  }
  return { labId, createdTests, updatedTests };
}

async function main() {
  const catalogCount = await seedDefinitions();
  console.log(`Seeded global laboratory catalog v${MASTER_TEST_CATALOG_VERSION}: ${catalogCount} definitions`);
  const labs = await resolveLabs();
  if (!labs.length) console.log('No lab requested. Global catalog seed completed. Set SEED_LAB_ID or SEED_ALL_LABS=true to clone tests into labs.');
  for (const lab of labs) console.log(`${lab.code}: ${JSON.stringify(await seedLab(lab.id))}`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
