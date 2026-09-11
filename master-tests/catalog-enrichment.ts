import { MASTER_TESTS, type CatalogParameter, type CatalogTest } from './catalog';

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/[()\[\],/]/g, ' ')
  .replace(/\b(serum|plasma|whole blood|edta blood|fluoride plasma|citrated plasma|arterial blood)\b/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const aliases: Record<string, string> = {
  'glucose fasting': 'fasting blood glucose',
  'glucose random': 'random blood glucose',
  'glucose 2 hour post prandial': 'post prandial blood glucose',
  'calcium': 'total calcium',
  'vitamin d': '25-oh vitamin d',
  '25 oh vitamin d': '25-oh vitamin d',
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

type ParameterProfile = Pick<CatalogParameter, 'inputType' | 'unit' | 'normalMin' | 'normalMax' | 'options' | 'remarks'>;

// Standard defaults are deliberately limited to commonly used, broadly applicable
// adult intervals. They are starter/reference data, not a substitute for the lab's
// validated analyzer-, method-, age-, sex-, pregnancy- or population-specific range.
const profiles: Record<string, ParameterProfile> = {
  glucose: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 70, normalMax: 99 },
  urea: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 15, normalMax: 45 },
  creatinine: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 0.6, normalMax: 1.3 },
  'uric acid': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 3.5, normalMax: 7.2 },
  sodium: { inputType: 'NUMBER', unit: 'mmol/L', normalMin: 135, normalMax: 145 },
  potassium: { inputType: 'NUMBER', unit: 'mmol/L', normalMin: 3.5, normalMax: 5.1 },
  chloride: { inputType: 'NUMBER', unit: 'mmol/L', normalMin: 98, normalMax: 107 },
  bicarbonate: { inputType: 'NUMBER', unit: 'mmol/L', normalMin: 22, normalMax: 29 },
  'total calcium': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 8.5, normalMax: 10.5 },
  phosphorus: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 2.5, normalMax: 4.5 },
  magnesium: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 1.7, normalMax: 2.4 },
  'total protein': { inputType: 'NUMBER', unit: 'g/dL', normalMin: 6, normalMax: 8.3 },
  albumin: { inputType: 'NUMBER', unit: 'g/dL', normalMin: 3.5, normalMax: 5 },
  globulin: { inputType: 'NUMBER', unit: 'g/dL', normalMin: 2.0, normalMax: 3.5 },
  ast: { inputType: 'NUMBER', unit: 'U/L', normalMin: 10, normalMax: 40 },
  alt: { inputType: 'NUMBER', unit: 'U/L', normalMin: 7, normalMax: 56 },
  'alkaline phosphatase': { inputType: 'NUMBER', unit: 'U/L', normalMin: 44, normalMax: 147 },
  ggt: { inputType: 'NUMBER', unit: 'U/L', normalMin: 9, normalMax: 48 },
  'total bilirubin': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 0.2, normalMax: 1.2 },
  'direct bilirubin': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 0, normalMax: 0.3 },
  ldh: { inputType: 'NUMBER', unit: 'U/L', normalMin: 140, normalMax: 280 },
  ck: { inputType: 'NUMBER', unit: 'U/L', normalMin: 20, normalMax: 200 },
  'ck total': { inputType: 'NUMBER', unit: 'U/L', normalMin: 20, normalMax: 200 },
  amylase: { inputType: 'NUMBER', unit: 'U/L', normalMin: 30, normalMax: 110 },
  lipase: { inputType: 'NUMBER', unit: 'U/L', normalMin: 13, normalMax: 60 },
  'total cholesterol': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 0, normalMax: 199 },
  'hdl cholesterol': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 40, normalMax: 100 },
  'ldl cholesterol': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 0, normalMax: 99 },
  triglycerides: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 0, normalMax: 149 },
  'vldl cholesterol': { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 5, normalMax: 40 },
  ferritin: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 24, normalMax: 336 },
  'serum iron': { inputType: 'NUMBER', unit: 'µg/dL', normalMin: 60, normalMax: 170 },
  'total iron binding capacity': { inputType: 'NUMBER', unit: 'µg/dL', normalMin: 250, normalMax: 450 },
  transferrin: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 200, normalMax: 360 },
  crp: { inputType: 'NUMBER', unit: 'mg/L', normalMin: 0, normalMax: 5 },
  'procalcitonin': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 0.5 },
  tsh: { inputType: 'NUMBER', unit: 'µIU/mL', normalMin: 0.3, normalMax: 4.2 },
  'free t4': { inputType: 'NUMBER', unit: 'ng/dL', normalMin: 0.9, normalMax: 1.7 },
  'free t3': { inputType: 'NUMBER', unit: 'pg/mL', normalMin: 2, normalMax: 4.4 },
  'total t3': { inputType: 'NUMBER', unit: 'ng/dL', normalMin: 80, normalMax: 200 },
  'total t4': { inputType: 'NUMBER', unit: 'µg/dL', normalMin: 4.5, normalMax: 11.7 },
  'parathyroid hormone': { inputType: 'NUMBER', unit: 'pg/mL', normalMin: 15, normalMax: 65 },
  prolactin: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 4, normalMax: 23 },
  'vitamin d': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 30, normalMax: 100 },
  '25-oh vitamin d': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 30, normalMax: 100 },
  'vitamin b12': { inputType: 'NUMBER', unit: 'pg/mL', normalMin: 200, normalMax: 900 },
  folate: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 3.1, normalMax: 17.5 },
  hemoglobin: { inputType: 'NUMBER', unit: 'g/dL', normalMin: 13.5, normalMax: 17.5 },
  'rbc count': { inputType: 'NUMBER', unit: 'million/cumm', normalMin: 4.5, normalMax: 5.9 },
  'wbc count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 4000, normalMax: 11000 },
  'total leukocyte count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 4000, normalMax: 11000 },
  'platelet count': { inputType: 'NUMBER', unit: 'lakhs/cumm', normalMin: 1.5, normalMax: 4.5 },
  hematocrit: { inputType: 'NUMBER', unit: '%', normalMin: 40, normalMax: 52 },
  'mcv': { inputType: 'NUMBER', unit: 'fL', normalMin: 80, normalMax: 100 },
  'mch': { inputType: 'NUMBER', unit: 'pg', normalMin: 27, normalMax: 33 },
  'mchc': { inputType: 'NUMBER', unit: 'g/dL', normalMin: 32, normalMax: 36 },
  rdw: { inputType: 'NUMBER', unit: '%', normalMin: 11.5, normalMax: 14.5 },
  'reticulocyte count': { inputType: 'NUMBER', unit: '%', normalMin: 0.5, normalMax: 2.5 },
  'neutrophil count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 1500, normalMax: 8000 },
  'lymphocyte count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 1000, normalMax: 4000 },
  'monocyte count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 200, normalMax: 1000 },
  'eosinophil count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 40, normalMax: 400 },
  'basophil count': { inputType: 'NUMBER', unit: 'cells/cumm', normalMin: 0, normalMax: 100 },
  esr: { inputType: 'NUMBER', unit: 'mm/hr', normalMin: 0, normalMax: 15 },
  'prothrombin time': { inputType: 'NUMBER', unit: 'sec', normalMin: 10, normalMax: 14 },
  inr: { inputType: 'NUMBER', unit: 'ratio', normalMin: 0.8, normalMax: 1.2 },
  'aptt': { inputType: 'NUMBER', unit: 'sec', normalMin: 25, normalMax: 35 },
  fibrinogen: { inputType: 'NUMBER', unit: 'mg/dL', normalMin: 200, normalMax: 400 },
  'd-dimer': { inputType: 'NUMBER', unit: 'µg/mL FEU', normalMin: 0, normalMax: 0.5 },
  'total psa': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 4 },
  psa: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 4 },
  'free psa': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 1 },
  afp: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 10 },
  cea: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 5 },
  'cancer antigen 125': { inputType: 'NUMBER', unit: 'U/mL', normalMin: 0, normalMax: 35 },
  'cancer antigen 15-3': { inputType: 'NUMBER', unit: 'U/mL', normalMin: 0, normalMax: 30 },
  'cancer antigen 19-9': { inputType: 'NUMBER', unit: 'U/mL', normalMin: 0, normalMax: 37 },
  'urine specific gravity': { inputType: 'NUMBER', unit: 'ratio', normalMin: 1.005, normalMax: 1.03 },
  'urine ph': { inputType: 'NUMBER', unit: 'pH', normalMin: 4.5, normalMax: 8 },
  'urine rbc': { inputType: 'NUMBER', unit: '/HPF', normalMin: 0, normalMax: 2 },
  'urine wbc': { inputType: 'NUMBER', unit: '/HPF', normalMin: 0, normalMax: 5 },
  'urine albumin/creatinine ratio': { inputType: 'NUMBER', unit: 'mg/g', normalMin: 0, normalMax: 30 },
  'urine protein/creatinine ratio': { inputType: 'NUMBER', unit: 'mg/g', normalMin: 0, normalMax: 200 },
  'valproic acid': { inputType: 'NUMBER', unit: 'µg/mL', normalMin: 50, normalMax: 100 },
  phenytoin: { inputType: 'NUMBER', unit: 'µg/mL', normalMin: 10, normalMax: 20 },
  carbamazepine: { inputType: 'NUMBER', unit: 'µg/mL', normalMin: 4, normalMax: 12 },
  digoxin: { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0.5, normalMax: 2 },
  lithium: { inputType: 'NUMBER', unit: 'mEq/L', normalMin: 0.6, normalMax: 1.2 },
  'troponin i': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 0.04 },
  'troponin t': { inputType: 'NUMBER', unit: 'ng/L', normalMin: 0, normalMax: 14 },
  'ck-mb': { inputType: 'NUMBER', unit: 'ng/mL', normalMin: 0, normalMax: 5 },
  pco2: { inputType: 'NUMBER', unit: 'mmHg', normalMin: 35, normalMax: 45 },
  po2: { inputType: 'NUMBER', unit: 'mmHg', normalMin: 80, normalMax: 100 },
  ph: { inputType: 'NUMBER', unit: 'pH', normalMin: 7.35, normalMax: 7.45 },
};

const qualitativeOptions = ['Negative', 'Positive', 'Equivocal'];
const textProfile = (remarks?: string): ParameterProfile => ({ inputType: 'SELECT', options: qualitativeOptions, remarks });

const findProfile = (name: string): ParameterProfile | undefined => {
  const normalized = normalize(name);
  const key = aliases[normalized] ?? normalized;
  if (profiles[key]) return profiles[key];
  if (/antibody|antigen|ana|hla|pcr|culture|screen|vdrl|rpr|tpha|widal|malaria antigen|dengue|chikungunya|leptospira|scrub typhus|toxoplasma|rubella|cmv|hsv|ebv|measles|mumps|varicella/i.test(normalized)) return textProfile('Default qualitative options; lab may replace with assay-specific reporting options.');
  if (/urine (protein|glucose|ketones|blood|bilirubin|nitrite|leukocyte esterase)/i.test(normalized)) return textProfile('Qualitative urine chemistry field.');
  return undefined;
};

const cloneParameters = (parameters: CatalogParameter[]): CatalogParameter[] => parameters.map((parameter, index) => ({
  ...parameter,
  displayOrder: parameter.displayOrder ?? index + 1,
  isRequired: parameter.isRequired ?? true,
}));

const applyProfile = (parameter: CatalogParameter): CatalogParameter => {
  const profile = findProfile(parameter.name);
  if (!profile) return {
    ...parameter,
    unit: parameter.inputType === 'NUMBER' && !parameter.unit ? 'Lab-specific' : parameter.unit,
    remarks: parameter.inputType === 'NUMBER' && !parameter.unit
      ? parameter.remarks ?? 'Unit and reference interval must be configured for the laboratory method before clinical use.'
      : parameter.remarks,
    displayOrder: parameter.displayOrder ?? 1,
    isRequired: parameter.isRequired ?? true,
  };
  return {
    ...parameter,
    inputType: parameter.inputType === 'SELECT' && parameter.options?.length ? parameter.inputType : profile.inputType,
    unit: parameter.unit?.trim() ? parameter.unit : profile.unit,
    normalMin: parameter.normalMin ?? profile.normalMin,
    normalMax: parameter.normalMax ?? profile.normalMax,
    options: parameter.options?.length ? parameter.options : profile.options,
    remarks: parameter.remarks ?? profile.remarks,
    displayOrder: parameter.displayOrder ?? 1,
    isRequired: parameter.isRequired ?? true,
  };
};

export const enrichCatalogTest = (test: CatalogTest): CatalogTest => {
  const master = findMaster(test.name);
  if (master) {
    return {
      ...test,
      shortName: master.shortName || test.shortName,
      category: master.category || test.category,
      department: master.department || test.department,
      sampleType: master.sampleType || test.sampleType,
      method: master.method || test.method,
      tat: master.tat || test.tat,
      parameters: cloneParameters(master.parameters).map(applyProfile),
    };
  }

  return { ...test, parameters: cloneParameters(test.parameters).map(applyProfile) };
};

export const enrichCatalogTests = (tests: CatalogTest[]): CatalogTest[] => tests.map(enrichCatalogTest);
