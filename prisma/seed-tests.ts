import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { MASTER_TESTS, MASTER_TEST_CATALOG_VERSION } from '../master-tests/catalog';

const connectionString = process.env.DATABASE_URL;
const useSsl = process.env.DATABASE_SSL === 'true';

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
  }),
});

async function resolveLabs() {
  const requestedLabId = process.env.SEED_LAB_ID?.trim();

  if (requestedLabId) {
    const lab = await prisma.lab.findUnique({ where: { id: requestedLabId } });
    if (!lab) throw new Error(`Lab ${requestedLabId} was not found`);
    return [lab];
  }

  if (process.env.SEED_ALL_LABS === 'true') {
    return prisma.lab.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  }

  throw new Error('Set SEED_LAB_ID=<lab-id> or SEED_ALL_LABS=true before seeding the test catalog');
}

async function seedLab(labId: string) {
  let createdTests = 0;
  let updatedTests = 0;
  let createdParameters = 0;
  let updatedParameters = 0;
  let skippedParameterUpdates = 0;

  for (const definition of MASTER_TESTS) {
    const existing = await prisma.test.findUnique({
      where: { labId_code: { labId, code: definition.code } },
      include: { parameters: true },
    });

    const test = existing
      ? await prisma.test.update({
          where: { id: existing.id },
          data: {
            shortName: definition.shortName,
            name: definition.name,
            category: definition.category,
            department: definition.department,
            sampleType: definition.sampleType,
            method: definition.method,
            tat: definition.tat,
            isActive: true,
          },
        })
      : await prisma.test.create({
          data: {
            labId,
            code: definition.code,
            shortName: definition.shortName,
            name: definition.name,
            category: definition.category,
            department: definition.department,
            sampleType: definition.sampleType,
            method: definition.method,
            tat: definition.tat,
            isActive: true,
          },
        });

    if (existing) updatedTests += 1;
    else createdTests += 1;

    for (const parameter of definition.parameters) {
      const current = existing?.parameters.find((item) => item.name === parameter.name);

      const data = {
        inputType: parameter.inputType,
        unit: parameter.unit ?? null,
        normalMin: parameter.normalMin ?? null,
        normalMax: parameter.normalMax ?? null,
        referenceRange: parameter.referenceRange ?? undefined,
        options: parameter.options ?? undefined,
        displayOrder: parameter.displayOrder ?? 0,
        isRequired: parameter.isRequired ?? true,
        remarks: parameter.remarks ?? null,
      };

      if (!current) {
        await prisma.testParameter.create({
          data: {
            testId: test.id,
            name: parameter.name,
            ...data,
          },
        });
        createdParameters += 1;
        continue;
      }

      const [reportResultCount, orderResultCount] = await Promise.all([
        prisma.reportResult.count({ where: { parameterId: current.id } }),
        prisma.orderResult.count({ where: { parameterId: current.id } }),
      ]);

      if (reportResultCount > 0 || orderResultCount > 0) {
        skippedParameterUpdates += 1;
        continue;
      }

      await prisma.testParameter.update({ where: { id: current.id }, data });
      updatedParameters += 1;
    }
  }

  return { labId, createdTests, updatedTests, createdParameters, updatedParameters, skippedParameterUpdates };
}

async function main() {
  const labs = await resolveLabs();
  console.log(`Seeding laboratory test catalog v${MASTER_TEST_CATALOG_VERSION} (${MASTER_TESTS.length} tests)`);

  for (const lab of labs) {
    const result = await seedLab(lab.id);
    console.log(`${lab.code}: ${JSON.stringify(result)}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
