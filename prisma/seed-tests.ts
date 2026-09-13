import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { MASTER_TESTS, MASTER_TEST_CATALOG_VERSION } from '../master-tests/catalog';
import { EXPANDED_TESTS } from '../master-tests/expanded-catalog';
import { EXPANDED_TESTS_2 } from '../master-tests/expanded-catalog-2';
import { enrichCatalogTests } from '../master-tests/catalog-enrichment';
import { enrichCorePanels } from '../master-tests/panel-enrichment';
import { enrichSpecialtyPanels } from '../master-tests/specialty-panel-enrichment';
import { validateCatalog } from '../master-tests/catalog-validator';
import { buildCatalogCompletenessReport } from '../master-tests/catalog-completeness';

const CATALOG_TESTS = enrichSpecialtyPanels(enrichCorePanels(enrichCatalogTests([...MASTER_TESTS, ...EXPANDED_TESTS, ...EXPANDED_TESTS_2])));
if (CATALOG_TESTS.length < 1000) throw new Error(`Master test catalog must contain at least 1000 tests; found ${CATALOG_TESTS.length}`);

const catalogValidation = validateCatalog(CATALOG_TESTS);
const completeness = buildCatalogCompletenessReport(CATALOG_TESTS, catalogValidation);
console.log('\n=== Master Laboratory Catalog Readiness ===');
console.log(`Catalog version: ${MASTER_TEST_CATALOG_VERSION}`);
console.log(`Total tests: ${completeness.totalTests}`);
console.log(`Ready tests: ${completeness.readyTests}`);
console.log(`Tests requiring clinical/reference review: ${completeness.testsRequiringClinicalReview}`);
console.log(`Blocked tests: ${completeness.blockedTests}`);
console.log(`Test readiness coverage: ${completeness.readinessPercent}%`);
console.log(`Total parameters: ${catalogValidation.totalParameters}`);
console.log(`Parameter unit coverage: ${completeness.parameterUnitCoveragePercent}%`);
console.log(`Parameter reference-data coverage: ${completeness.parameterReferenceCoveragePercent}%`);
console.log(`Parameter input coverage: ${completeness.parameterInputCoveragePercent}%`);
console.log(`Multi-parameter tests/panels: ${catalogValidation.testsWithMultipleParameters}`);
console.log(`Blocking catalog issues: ${completeness.blockingIssues.length}`);
console.log(`Clinical/reference review items: ${completeness.clinicalReviewIssues.length}`);
if (completeness.blockingIssues.length) {
  console.error('\nBlocking catalog issues:');
  for (const issue of completeness.blockingIssues.slice(0, 100)) console.error(`- ${issue.code} | ${issue.name} | ${issue.parameter ?? '-'} | ${issue.issue}`);
  if (completeness.blockingIssues.length > 100) console.error(`...and ${completeness.blockingIssues.length - 100} more`);
  throw new Error(`Catalog validation failed with ${completeness.blockingIssues.length} blocking issue(s)`);
}
if (completeness.clinicalReviewIssues.length) {
  console.warn('\nReference-data review items (non-blocking):');
  for (const issue of completeness.clinicalReviewIssues.slice(0, 50)) console.warn(`- ${issue.code} | ${issue.name} | ${issue.parameter ?? '-'} | ${issue.issue}`);
  if (completeness.clinicalReviewIssues.length > 50) console.warn(`...and ${completeness.clinicalReviewIssues.length - 50} more`);
  console.warn('These ranges require laboratory/method/age/sex/population validation before clinical use.');
}
console.log('\n=== Readiness by Category ===');
for (const category of completeness.categoryReadiness) console.log(`${category.category}: ${category.tests} tests | ready ${category.ready} | clinical review ${category.clinicalReview} | blocked ${category.blocked}`);

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === 'true';
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, ssl: useSsl ? { rejectUnauthorized: false } : false }) });

type RichParameter = { validation?: unknown; criticalLow?: number; criticalHigh?: number; decimalPlaces?: number; defaultValue?: string; formula?: string };
type RichDefinition = { container?: string; fasting?: boolean; sampleHandling?: string; stability?: string; rejectionCriteria?: string; description?: string; synonyms?: unknown; externalCodes?: unknown };

async function seedDefinitions() {
  let count = 0;
  for (const definition of CATALOG_TESTS) {
    const sourceDefinition = definition as typeof definition & RichDefinition;
    const catalog = await prisma.testDefinition.upsert({
      where: { code: definition.code },
      update: { shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, specimenType: definition.sampleType, container: sourceDefinition.container ?? null, method: definition.method, tat: definition.tat, fasting: sourceDefinition.fasting ?? false, sampleHandling: sourceDefinition.sampleHandling ?? null, stability: sourceDefinition.stability ?? null, rejectionCriteria: sourceDefinition.rejectionCriteria ?? null, description: sourceDefinition.description ?? null, synonyms: sourceDefinition.synonyms ?? undefined, externalCodes: sourceDefinition.externalCodes ?? undefined, isActive: true },
      create: { code: definition.code, shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, specimenType: definition.sampleType, container: sourceDefinition.container ?? null, method: definition.method, tat: definition.tat, fasting: sourceDefinition.fasting ?? false, sampleHandling: sourceDefinition.sampleHandling ?? null, stability: sourceDefinition.stability ?? null, rejectionCriteria: sourceDefinition.rejectionCriteria ?? null, description: sourceDefinition.description ?? null, synonyms: sourceDefinition.synonyms ?? undefined, externalCodes: sourceDefinition.externalCodes ?? undefined, isActive: true },
    });
    for (const [index, parameter] of definition.parameters.entries()) {
      const source = parameter as typeof parameter & RichParameter;
      const code = `${definition.code}-P${index + 1}`;
      const data = { name: parameter.name, inputType: parameter.inputType, unit: parameter.unit ?? null, normalMin: parameter.normalMin ?? null, normalMax: parameter.normalMax ?? null, referenceRange: parameter.referenceRange ?? undefined, options: parameter.options ?? undefined, validation: source.validation ?? undefined, criticalLow: source.criticalLow ?? null, criticalHigh: source.criticalHigh ?? null, decimalPlaces: source.decimalPlaces ?? null, defaultValue: source.defaultValue ?? null, formula: source.formula ?? null, displayOrder: parameter.displayOrder ?? index, isRequired: parameter.isRequired ?? true, remarks: parameter.remarks ?? null };
      await prisma.testDefinitionParameter.upsert({ where: { testDefinitionId_code: { testDefinitionId: catalog.id, code } }, update: data, create: { testDefinitionId: catalog.id, code, ...data } });
    }
    count += 1;
  }
  return count;
}

async function resolveLabs() {
  const requestedLabId = process.env.SEED_LAB_ID?.trim();
  if (requestedLabId) { const lab = await prisma.lab.findUnique({ where: { id: requestedLabId } }); if (!lab) throw new Error(`Lab ${requestedLabId} was not found`); return [lab]; }
  if (process.env.SEED_ALL_LABS === 'true') return prisma.lab.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return [];
}

async function seedLab(labId: string) {
  let createdTests = 0; let updatedTests = 0;
  for (const definition of CATALOG_TESTS) {
    const catalog = await prisma.testDefinition.findUnique({ where: { code: definition.code }, include: { parameters: { orderBy: { displayOrder: 'asc' } } } });
    if (!catalog) throw new Error(`Catalog definition ${definition.code} was not created`);
    const existing = await prisma.test.findUnique({ where: { labId_scopeId_code: { labId, scopeId: labId, code: definition.code } }, include: { parameters: true } });
    const test = existing ? await prisma.test.update({ where: { id: existing.id }, data: { catalogId: catalog.id, shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, sampleType: definition.sampleType, method: definition.method, tat: definition.tat, isActive: true } }) : await prisma.test.create({ data: { labId, scopeId: labId, catalogId: catalog.id, code: definition.code, shortName: definition.shortName, name: definition.name, category: definition.category, department: definition.department, sampleType: definition.sampleType, method: definition.method, tat: definition.tat, isActive: true } });
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
