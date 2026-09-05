import type { CatalogParameter, CatalogTest } from './catalog';

const n = (name: string, unit: string, min: number, max: number, extra: Partial<CatalogParameter> = {}): CatalogParameter => ({
  name, inputType: 'NUMBER', unit, normalMin: min, normalMax: max, isRequired: true, ...extra,
});

const s = (name: string, options: string[], extra: Partial<CatalogParameter> = {}): CatalogParameter => ({
  name, inputType: 'SELECT', options, isRequired: true, ...extra,
});

const panels: Record<string, CatalogParameter[]> = {
  'complete blood count': [
    n('Hemoglobin', 'g/dL', 13.5, 17.5, { referenceRange: { MALE: '13.5-17.5', FEMALE: '12.0-15.5' } }), n('RBC Count', 'million/cumm', 4.5, 5.9, { displayOrder: 2, referenceRange: { MALE: '4.5-5.9', FEMALE: '4.1-5.1' } }), n('Total Leukocyte Count', 'cells/cumm', 4000, 11000, { displayOrder: 3 }), n('Platelet Count', 'lakhs/cumm', 1.5, 4.5, { displayOrder: 4 }), n('Hematocrit', '%', 40, 52, { displayOrder: 5 }), n('MCV', 'fL', 80, 100, { displayOrder: 6 }), n('MCH', 'pg', 27, 33, { displayOrder: 7 }), n('MCHC', 'g/dL', 32, 36, { displayOrder: 8 }), n('RDW-CV', '%', 11.5, 14.5, { displayOrder: 9 }), n('Neutrophils', '%', 40, 75, { displayOrder: 10 }), n('Lymphocytes', '%', 20, 45, { displayOrder: 11 }), n('Eosinophils', '%', 1, 6, { displayOrder: 12 }), n('Monocytes', '%', 2, 10, { displayOrder: 13 }), n('Basophils', '%', 0, 2, { displayOrder: 14 }),
  ],
  'liver function test': [n('Total Bilirubin', 'mg/dL', 0.2, 1.2), n('Direct Bilirubin', 'mg/dL', 0, 0.3, { displayOrder: 2 }), n('AST / SGOT', 'U/L', 10, 40, { displayOrder: 3 }), n('ALT / SGPT', 'U/L', 7, 56, { displayOrder: 4 }), n('Alkaline Phosphatase', 'U/L', 44, 147, { displayOrder: 5 }), n('Total Protein', 'g/dL', 6, 8.3, { displayOrder: 6 }), n('Albumin', 'g/dL', 3.5, 5, { displayOrder: 7 }), n('Globulin', 'g/dL', 2, 3.5, { displayOrder: 8 }), n('GGT', 'U/L', 9, 48, { displayOrder: 9 })],
  'renal function test': [n('Urea', 'mg/dL', 15, 45), n('Creatinine', 'mg/dL', 0.6, 1.3, { displayOrder: 2 }), n('Uric Acid', 'mg/dL', 3.5, 7.2, { displayOrder: 3 }), n('Sodium', 'mmol/L', 135, 145, { displayOrder: 4 }), n('Potassium', 'mmol/L', 3.5, 5.1, { displayOrder: 5 }), n('Chloride', 'mmol/L', 98, 107, { displayOrder: 6 }), n('Bicarbonate', 'mmol/L', 22, 29, { displayOrder: 7 })],
  'lipid profile': [n('Total Cholesterol', 'mg/dL', 0, 199), n('Triglycerides', 'mg/dL', 0, 149, { displayOrder: 2 }), n('HDL Cholesterol', 'mg/dL', 40, 100, { displayOrder: 3 }), n('LDL Cholesterol', 'mg/dL', 0, 99, { displayOrder: 4 }), n('VLDL Cholesterol', 'mg/dL', 5, 40, { displayOrder: 5 }), n('Non-HDL Cholesterol', 'mg/dL', 0, 129, { displayOrder: 6 })],
  'thyroid profile': [n('Total T3', 'ng/dL', 80, 200), n('Total T4', 'µg/dL', 4.5, 11.7, { displayOrder: 2 }), n('TSH', 'µIU/mL', 0.3, 4.2, { displayOrder: 3 })],
  'thyroid profile free': [n('Free T3', 'pg/mL', 2, 4.4), n('Free T4', 'ng/dL', 0.9, 1.7, { displayOrder: 2 }), n('TSH', 'µIU/mL', 0.3, 4.2, { displayOrder: 3 })],
  'diabetes profile': [n('Fasting Glucose', 'mg/dL', 70, 99), n('Post Prandial Glucose', 'mg/dL', 70, 140, { displayOrder: 2 }), n('HbA1c', '%', 4, 5.6, { displayOrder: 3 }), n('Estimated Average Glucose', 'mg/dL', 70, 117, { displayOrder: 4 })],
  'cardiac biomarkers panel': [n('Troponin I', 'ng/mL', 0, 0.04), n('CK-MB', 'ng/mL', 0, 5, { displayOrder: 2 }), n('Myoglobin', 'ng/mL', 25, 72, { displayOrder: 3 }), n('BNP', 'pg/mL', 0, 100, { displayOrder: 4 })],
  'iron profile': [n('Serum Iron', 'µg/dL', 60, 170), n('TIBC', 'µg/dL', 250, 450, { displayOrder: 2 }), n('Ferritin', 'ng/mL', 24, 336, { displayOrder: 3 }), n('Transferrin Saturation', '%', 20, 50, { displayOrder: 4 })],
  'torch profile': [s('Toxoplasma IgM', ['Negative', 'Positive', 'Equivocal']), s('Toxoplasma IgG', ['Negative', 'Positive', 'Equivocal'], { displayOrder: 2 }), s('Rubella IgM', ['Negative', 'Positive', 'Equivocal'], { displayOrder: 3 }), s('Rubella IgG', ['Negative', 'Positive', 'Equivocal'], { displayOrder: 4 }), s('CMV IgM', ['Negative', 'Positive', 'Equivocal'], { displayOrder: 5 }), s('CMV IgG', ['Negative', 'Positive', 'Equivocal'], { displayOrder: 6 })],
  'urine routine examination': [
    s('Color', ['Pale Yellow', 'Yellow', 'Dark Yellow', 'Amber', 'Red', 'Brown', 'Other']), s('Appearance', ['Clear', 'Slightly Turbid', 'Turbid'], { displayOrder: 2 }), s('Reaction / pH', ['Acidic', 'Neutral', 'Alkaline'], { displayOrder: 3 }), s('Protein', ['Negative', 'Trace', '1+', '2+', '3+', '4+'], { displayOrder: 4 }), s('Glucose', ['Negative', 'Trace', '1+', '2+', '3+', '4+'], { displayOrder: 5 }), s('Ketone Bodies', ['Negative', 'Trace', '1+', '2+', '3+'], { displayOrder: 6 }), s('Bilirubin', ['Negative', 'Positive'], { displayOrder: 7 }), s('Urobilinogen', ['Normal', 'Increased', 'Decreased'], { displayOrder: 8 }), s('Blood / Hemoglobin', ['Negative', 'Trace', '1+', '2+', '3+'], { displayOrder: 9 }), s('Nitrite', ['Negative', 'Positive'], { displayOrder: 10 }), s('Leukocyte Esterase', ['Negative', 'Trace', '1+', '2+', '3+'], { displayOrder: 11 }), s('Specific Gravity', ['1.005-1.010', '1.011-1.020', '1.021-1.030', 'Other'], { displayOrder: 12 }), s('RBC / HPF', ['Nil', '1-2', '3-5', '6-10', '>10'], { displayOrder: 13 }), s('WBC / HPF', ['Nil', '1-2', '3-5', '6-10', '>10'], { displayOrder: 14 }), s('Epithelial Cells', ['Nil', 'Few', 'Moderate', 'Many'], { displayOrder: 15 }), s('Casts', ['Nil', 'Hyaline', 'Granular', 'RBC', 'WBC', 'Other'], { displayOrder: 16 }), s('Crystals', ['Nil', 'Calcium Oxalate', 'Uric Acid', 'Triple Phosphate', 'Other'], { displayOrder: 17 }), s('Bacteria', ['Nil', 'Few', 'Moderate', 'Many'], { displayOrder: 18 }),
  ],
  'electrolyte panel': [n('Sodium', 'mmol/L', 135, 145), n('Potassium', 'mmol/L', 3.5, 5.1, { displayOrder: 2 }), n('Chloride', 'mmol/L', 98, 107, { displayOrder: 3 }), n('Bicarbonate', 'mmol/L', 22, 29, { displayOrder: 4 })],
  'coagulation profile': [n('Prothrombin Time', 'seconds', 10, 14, { displayOrder: 1 }), n('INR', 'ratio', 0.8, 1.2, { displayOrder: 2 }), n('aPTT', 'seconds', 25, 35, { displayOrder: 3 }), n('Fibrinogen', 'mg/dL', 200, 400, { displayOrder: 4 }), n('D-Dimer', 'mg/L FEU', 0, 0.5, { displayOrder: 5 })],
  'semen analysis': [
    s('Abstinence Period', ['2-3 days', '3-5 days', '5-7 days', 'Other']), s('Color', ['Whitish Grey', 'Grey', 'Yellowish', 'Other'], { displayOrder: 2 }), s('Liquefaction', ['Complete', 'Incomplete', 'Delayed'], { displayOrder: 3 }), s('Viscosity', ['Normal', 'Increased', 'Decreased'], { displayOrder: 4 }), n('Volume', 'mL', 1.4, 6.0, { displayOrder: 5 }), n('Sperm Concentration', 'million/mL', 15, 200, { displayOrder: 6 }), n('Total Sperm Number', 'million/ejaculate', 39, 600, { displayOrder: 7 }), n('Progressive Motility', '%', 30, 100, { displayOrder: 8 }), n('Non-Progressive Motility', '%', 0, 70, { displayOrder: 9 }), n('Immotile', '%', 0, 70, { displayOrder: 10 }), n('Normal Morphology', '%', 4, 100, { displayOrder: 11 }), s('Agglutination', ['Absent', 'Present'], { displayOrder: 12 }), s('Round Cells', ['Nil', 'Few', 'Moderate', 'Many'], { displayOrder: 13 }), s('Pus Cells', ['Nil', 'Few', 'Moderate', 'Many'], { displayOrder: 14 }),
  ],
  'differential leukocyte count': [n('Neutrophils', '%', 40, 75), n('Lymphocytes', '%', 20, 45, { displayOrder: 2 }), n('Monocytes', '%', 2, 10, { displayOrder: 3 }), n('Eosinophils', '%', 1, 6, { displayOrder: 4 }), n('Basophils', '%', 0, 2, { displayOrder: 5 })],
  'absolute neutrophil count': [n('Absolute Neutrophil Count', 'cells/cumm', 1500, 8000)],
};

const aliases: Record<string, string> = {
  'lft': 'liver function test', 'liver function test lft': 'liver function test',
  'rft': 'renal function test', 'kft': 'renal function test', 'kidney function test': 'renal function test',
  'urinalysis': 'urine routine examination', 'routine urine examination': 'urine routine examination', 'urine routine': 'urine routine examination',
  'electrolytes': 'electrolyte panel', 'electrolyte': 'electrolyte panel',
  'pt inr aptt': 'coagulation profile', 'coagulation profile': 'coagulation profile',
  'semen analysis': 'semen analysis', 'semen examination': 'semen analysis',
  'dlc': 'differential leukocyte count', 'anc': 'absolute neutrophil count',
};

const normalize = (value: string) => value.toLowerCase().replace(/[()\[\],:/-]/g, ' ').replace(/\s+/g, ' ').trim();

export const enrichCorePanels = (tests: CatalogTest[]): CatalogTest[] => tests.map((test) => {
  const normalized = normalize(test.name);
  const key = panels[normalized] ? normalized : aliases[normalized];
  const parameters = key ? panels[key] : undefined;
  if (!parameters) return test;
  return { ...test, parameters: parameters.map((parameter) => ({ ...parameter })) };
});
