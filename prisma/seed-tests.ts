import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { MASTER_TESTS, MASTER_TEST_CATALOG_VERSION } from '../master-tests/catalog';
import { EXPANDED_TESTS } from '../master-tests/expanded-catalog';
import { EXPANDED_TESTS_2 } from '../master-tests/expanded-catalog-2';

const CATALOG_TESTS = [...MASTER_TESTS, ...EXPANDED_TESTS, ...EXPANDED_TESTS_2];
if (CATALOG_TESTS.length < 1000) throw new Error(`Master test catalog must contain at least 1000 tests; found ${CATALOG_TESTS.length}`);

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