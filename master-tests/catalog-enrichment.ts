import { MASTER_TESTS, type CatalogParameter, type CatalogTest } from './catalog';

/**
 * Normalizes names so an expanded catalog entry can reuse a curated master
 * definition when the same analyte/panel is already present there.
 */
const normalize = (value: string) => value
  .toLowerCase()
  .replace(/[()\[\],/]/g, ' ')
  .replace(/\b(serum|plasma|whole blood|edta blood|fluoride plasma|citrated plasma)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const aliases: Record<string, string> = {
  'glucose fasting': 'fasting blood glucose',
  'glucose random': 'random blood glucose',
  'glucose 2 hour post prandial': 'post prandial blood glucose',
  'hba1c': 'hba1c',
  'total calcium': 'total calcium',
  'calcium': 'total calcium',
  '25 oh vitamin d': '25-oh vitamin d',
  'vitamin d': '25-oh vitamin d',
  'vitamin b12': 'vitamin b12',
  'iron': 'serum iron',
  'tibc': 'total iron binding capacity',
  'ck': 'ck total',
  'ck mb': 'ck-mb',
  'psa': 'total psa',
  'ca 125': 'cancer antigen 125',
  'ca 15 3': 'cancer antigen 15-3',
  'ca 19 9': 'cancer antigen 19-9',
  'anti tpo antibody': 'anti-tpo antibody',
  'rheumatoid factor': 'rheumatoid factor',
  'anti ccp': 'anti-ccp antibody',
};

const masterByName = new Map<string, CatalogTest>();
for (const test of MASTER_TESTS) {
  masterByName.set(normalize(test.name), test);
  masterByName.set(normalize(test.shortName), test);
  for (const parameter of test.parameters) masterByName.set(normalize(parameter.name), test);
}

const findMaster = (name: string) => {
  const normalized = normalize(name);
  return masterByName.get(normalized) ?? masterByName.get(aliases[normalized] ?? '');
};

const cloneParameters = (parameters: CatalogParameter[]): CatalogParameter[] => parameters.map((parameter, index) => ({
  ...parameter,
  displayOrder: parameter.displayOrder ?? index + 1,
  isRequired: parameter.isRequired ?? true,
}));

/**
 * Enriches generated/expanded tests with the complete curated parameter
 * definition whenever the master catalog already knows that test.
 *
 * This is deliberately conservative: it never invents a reference interval.
 * Unknown assays keep their explicit result field, while known assays inherit
 * their validated catalog unit/range/options and multi-parameter panel layout.
 */
export const enrichCatalogTest = (test: CatalogTest): CatalogTest => {
  const master = findMaster(test.name);
  if (!master) return test;

  return {
    ...test,
    shortName: master.shortName || test.shortName,
    category: master.category || test.category,
    department: master.department || test.department,
    sampleType: master.sampleType || test.sampleType,
    method: master.method || test.method,
    tat: master.tat || test.tat,
    parameters: cloneParameters(master.parameters),
  };
};

export const enrichCatalogTests = (tests: CatalogTest[]): CatalogTest[] => tests.map(enrichCatalogTest);
