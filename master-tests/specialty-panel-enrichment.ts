import type { CatalogParameter, CatalogTest } from './catalog';

const t = (name: string, extra: Partial<CatalogParameter> = {}): CatalogParameter => ({ name, inputType: 'TEXT', isRequired: true, ...extra });
const s = (name: string, options: string[], extra: Partial<CatalogParameter> = {}): CatalogParameter => ({ name, inputType: 'SELECT', options, isRequired: true, ...extra });
const n = (name: string, unit: string, min: number, max: number, extra: Partial<CatalogParameter> = {}): CatalogParameter => ({ name, inputType: 'NUMBER', unit, normalMin: min, normalMax: max, isRequired: true, ...extra });

const panels: Record<string, CatalogParameter[]> = {
  'hiv 1 2 screening': [s('HIV-1/2 Result', ['Non-Reactive', 'Reactive', 'Indeterminate'])],
  'hbsag': [s('HBsAg Result', ['Non-Reactive', 'Reactive', 'Indeterminate'])],
  'anti hcv': [s('Anti-HCV Result', ['Non-Reactive', 'Reactive', 'Indeterminate'])],
  'vdrl': [s('VDRL Result', ['Non-Reactive', 'Reactive']), t('Titer', { displayOrder: 2 })],
  'malaria parasite': [s('Plasmodium Result', ['Not Detected', 'P. falciparum', 'P. vivax', 'Mixed Infection', 'Other'], { displayOrder: 1 }), t('Parasitemia / Remarks', { displayOrder: 2 })],
  'blood group and rh typing': [s('ABO Group', ['A', 'B', 'AB', 'O']), s('Rh(D)', ['Positive', 'Negative'], { displayOrder: 2 })],
  'urine culture': [t('Specimen', { displayOrder: 1 }), t('Organism Isolated', { displayOrder: 2 }), t('Colony Count', { displayOrder: 3 }), t('Antibiotic Susceptibility', { displayOrder: 4 }), t('Interpretation', { displayOrder: 5 })],
  'blood culture': [t('Specimen', { displayOrder: 1 }), t('Organism Isolated', { displayOrder: 2 }), t('Growth', { displayOrder: 3 }), t('Antibiotic Susceptibility', { displayOrder: 4 }), t('Interpretation', { displayOrder: 5 })],
  'stool routine examination': [s('Color', ['Brown', 'Yellow', 'Green', 'Black', 'Other']), s('Consistency', ['Formed', 'Semi-formed', 'Loose', 'Watery', 'Mucoid'], { displayOrder: 2 }), s('Blood', ['Absent', 'Present'], { displayOrder: 3 }), s('Mucus', ['Absent', 'Present'], { displayOrder: 4 }), s('Ova / Cysts / Parasites', ['Not Seen', 'Seen'], { displayOrder: 5 }), t('Microscopy / Remarks', { displayOrder: 6 })],
  'histopathology': [t('Specimen / Site'), t('Gross Description', { displayOrder: 2 }), t('Microscopy', { displayOrder: 3 }), t('Diagnosis', { displayOrder: 4 }), t('Comment', { displayOrder: 5 })],
  'cytology': [t('Specimen / Site'), t('Adequacy', { displayOrder: 2 }), t('Microscopic Description', { displayOrder: 3 }), t('Diagnosis / Interpretation', { displayOrder: 4 }), t('Comment', { displayOrder: 5 })],
  'pap smear': [s('Specimen Adequacy', ['Satisfactory', 'Unsatisfactory']), t('Microscopic Findings', { displayOrder: 2 }), t('Bethesda Interpretation', { displayOrder: 3 }), t('Organisms / Other Findings', { displayOrder: 4 }), t('Comment', { displayOrder: 5 })],
  'blood bank antibody screen': [s('Antibody Screen', ['Negative', 'Positive', 'Indeterminate']), t('Antibody Identification', { displayOrder: 2 }), t('Remarks', { displayOrder: 3 })],
  'crossmatch': [s('Compatibility', ['Compatible', 'Incompatible']), t('Method', { displayOrder: 2 }), t('Remarks', { displayOrder: 3 })],
  'reticulocyte count': [n('Reticulocyte Percentage', '%', 0.5, 2.5)],
  'esr': [n('ESR', 'mm/hr', 0, 20)],
  'procalcitonin': [n('Procalcitonin', 'ng/mL', 0, 0.5)],
  'psa profile': [n('Total PSA', 'ng/mL', 0, 4), n('Free PSA', 'ng/mL', 0, 1, { displayOrder: 2 }), n('Free PSA Percentage', '%', 0, 100, { displayOrder: 3 })],
  'therapeutic drug monitoring': [t('Drug Name'), n('Drug Level', 'µg/mL', 0, 100, { displayOrder: 2 }), s('Interpretation', ['Within Therapeutic Range', 'Below Therapeutic Range', 'Above Therapeutic Range'], { displayOrder: 3 })],
};

const aliases: Record<string, string> = {
  'hiv': 'hiv 1 2 screening', 'hiv 1 2': 'hiv 1 2 screening', 'hiv screening': 'hiv 1 2 screening',
  'hepatitis b surface antigen': 'hbsag', 'hb surface antigen': 'hbsag', 'hepatitis c antibody': 'anti hcv',
  'anti hcv antibody': 'anti hcv', 'vdrl test': 'vdrl', 'malaria parasite test': 'malaria parasite',
  'abo rh typing': 'blood group and rh typing', 'blood group': 'blood group and rh typing',
  'urine culture and sensitivity': 'urine culture', 'urine c s': 'urine culture',
  'blood culture and sensitivity': 'blood culture', 'histopathology examination': 'histopathology',
  'cytology examination': 'cytology', 'pap smear test': 'pap smear', 'antibody screening': 'blood bank antibody screen',
  'cross match': 'crossmatch', 'cross matching': 'crossmatch', 'erythrocyte sedimentation rate': 'esr',
  'psa': 'psa profile', 'therapeutic drug monitoring tdm': 'therapeutic drug monitoring',
};

const normalize = (value: string) => value.toLowerCase().replace(/[()[\],:/-]/g, ' ').replace(/\s+/g, ' ').trim();

export const enrichSpecialtyPanels = (tests: CatalogTest[]): CatalogTest[] => tests.map((test) => {
  const normalized = normalize(test.name);
  const key = panels[normalized] ? normalized : aliases[normalized];
  const parameters = key ? panels[key] : undefined;
  if (!parameters) return test;
  return { ...test, parameters: parameters.map((parameter) => ({ ...parameter })) };
});
