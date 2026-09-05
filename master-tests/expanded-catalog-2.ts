import type { CatalogTest } from './catalog';

// Common specimen-specific laboratory offerings. No clinical reference intervals are
// embedded; intervals remain lab/method/analyzer/age/sex specific.
const analytes = [
  'Glucose','Urea','Creatinine','Uric Acid','Sodium','Potassium','Chloride','Bicarbonate','Calcium','Phosphorus','Magnesium','Total Protein','Albumin','Globulin','AST','ALT','Alkaline Phosphatase','GGT','Total Bilirubin','Direct Bilirubin','LDH','CK','CK-MB','Amylase','Lipase','Total Cholesterol','HDL Cholesterol','LDL Cholesterol','Triglycerides','Ferritin','Iron','TIBC','Transferrin','CRP','Procalcitonin','Apolipoprotein A1','Apolipoprotein B','Lipoprotein(a)','Lactate','Homocysteine','TSH','Free T4','Free T3','Total T3','Total T4','Thyroglobulin','Parathyroid Hormone','Calcitonin','Insulin','C-Peptide','Cortisol','ACTH','Aldosterone','Renin','Prolactin','FSH','LH','Estradiol','Progesterone','Testosterone','DHEA-S','AMH','Vitamin D','Vitamin B12','Folate','Vitamin A','Vitamin E','Vitamin K','Vitamin B1','Vitamin B6','Methylmalonic Acid','Hemoglobin','RBC Count','WBC Count','Platelet Count','Hematocrit','MCV','MCH','MCHC','RDW','Reticulocyte Count','Neutrophil Count','Lymphocyte Count','Monocyte Count','Eosinophil Count','Basophil Count','ESR','G6PD','HbA2','HbF','Prothrombin Time','INR','aPTT','Fibrinogen','D-Dimer','Thrombin Time','Factor VIII','Factor IX','Factor XI','Factor XII','Protein C','Protein S','Antithrombin III','Lupus Anticoagulant','Anticardiolipin IgG','Anticardiolipin IgM','Beta-2 Glycoprotein I IgG','Beta-2 Glycoprotein I IgM','von Willebrand Factor','Plasminogen','PSA','Free PSA','CEA','AFP','CA-125','CA 15-3','CA 19-9','CA 72-4','SCC Antigen','CYFRA 21-1','NSE','Chromogranin A','HE4','Beta-2 Microglobulin','ANA','Anti-dsDNA','Anti-Sm','Anti-RNP','Anti-SSA','Anti-SSB','Anti-Scl-70','Anti-Centromere','Anti-Jo-1','Rheumatoid Factor','Anti-CCP','C3','C4','CH50','IgG','IgA','IgM','IgE','Kappa Free Light Chain','Lambda Free Light Chain','HLA-B27','HBsAg','Anti-HBs','Anti-HBc','HBeAg','Anti-HBe','Anti-HCV','HIV Antigen/Antibody','VDRL','RPR','TPHA','Dengue NS1','Dengue IgM','Dengue IgG','Chikungunya IgM','Chikungunya IgG','Malaria Antigen','Widal','Leptospira IgM','Scrub Typhus IgM','Toxoplasma IgM','Toxoplasma IgG','Rubella IgM','Rubella IgG','CMV IgM','CMV IgG','HSV-1 IgG','HSV-2 IgG','EBV VCA IgM','EBV VCA IgG','Measles IgM','Measles IgG','Mumps IgM','Mumps IgG','Varicella IgM','Varicella IgG','Urine Protein','Urine Glucose','Urine Ketones','Urine Blood','Urine Bilirubin','Urine Urobilinogen','Urine Nitrite','Urine Leukocyte Esterase','Urine RBC','Urine WBC','Urine Epithelial Cells','Urine Casts','Urine Crystals','Urine Bacteria','Urine Albumin','Urine Creatinine','Urine Calcium','Urine Sodium','Urine Potassium','Urine Chloride','Urine Urea','Urine Uric Acid','Urine Phosphate','Urine Magnesium','Urine Citrate','Urine Oxalate','Urine Amylase','Urine Osmolality','CSF Protein','CSF Glucose','CSF Lactate','CSF Albumin','CSF IgG','CSF IgG Index','CSF Oligoclonal Bands','Pleural Fluid Protein','Pleural Fluid Glucose','Pleural Fluid LDH','Pleural Fluid Cell Count','Ascitic Fluid Protein','Ascitic Fluid Albumin','Ascitic Fluid Cell Count','Synovial Fluid Protein','Synovial Fluid Glucose','Synovial Fluid Cell Count','Pericardial Fluid Protein','Pericardial Fluid Glucose','Semen Count','Semen Motility','Semen Morphology','Semen Vitality','Stool Occult Blood','Stool Calprotectin','Stool Lactoferrin','Fecal Elastase','Fecal Fat','Stool Ova and Parasites','Total IgE','Tryptase','Specific IgE','Serum Protein Electrophoresis','Immunofixation','Alpha-1 Antitrypsin','Ceruloplasmin','Haptoglobin','Prealbumin','Beta-Trace Protein','Cystatin C','Osteocalcin','P1NP','Beta-CTX','IGF-1','IGFBP-3','Growth Hormone','SHBG','Androstenedione','17-OH Progesterone','Metanephrine','Normetanephrine','Catecholamines','Valproic Acid','Phenytoin','Carbamazepine','Phenobarbital','Digoxin','Lithium','Theophylline','Vancomycin','Gentamicin','Tobramycin','Amikacin','Methotrexate','Cyclosporine','Tacrolimus','Sirolimus','Everolimus','Mycophenolic Acid','Lamotrigine','Levetiracetam','Topiramate','Gabapentin','Pregabalin','Clobazam','Clonazepam','Diazepam','Midazolam',
] as const;

const slug = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 22);
const isText = (name: string) => /antibody|antigen|PCR|culture|smear|profile|panel|screen|typing|group|Widal|VDRL|RPR|TPHA|ANA|HLA|mutation|electrophoresis|immunofixation|IgG|IgM|IgA|IgE|specific IgE/i.test(name);
const method = (name: string) => /PCR/i.test(name) ? 'Molecular / PCR' : /culture/i.test(name) ? 'Culture' : /smear|electrophoresis|immunofixation/i.test(name) ? 'Microscopy / Electrophoresis' : /antibody|antigen|IgG|IgM|IgA|IgE|ANA|HLA/i.test(name) ? 'Immunoassay' : 'Automated / Standard Laboratory Method';

const variants = analytes.flatMap((name) => [`Serum ${name}`, `Plasma ${name}`]);
const seen = new Set<string>();

export const EXPANDED_TESTS_2: CatalogTest[] = variants.filter((name) => {
  const key = name.toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}).map((name, index) => {
  const isPlasma = name.startsWith('Plasma ');
  const cleanName = name.replace(/^(Serum|Plasma) /, '');
  const department = /TSH|T4|T3|hormone|Cortisol|ACTH|Aldosterone|Renin|Prolactin|FSH|LH|Estradiol|Progesterone|Testosterone|DHEA|AMH|Insulin|C-Peptide|IGF|Growth Hormone|SHBG|Metanephrine|Catecholamine/i.test(cleanName) ? 'Endocrinology' : /antibody|antigen|ANA|HLA|IgG|IgM|IgA|IgE|HBsAg|HCV|HIV|Dengue|Chikungunya|Malaria|Widal|Leptospira|Rubella|CMV|HSV|EBV|Measles|Mumps|Varicella/i.test(cleanName) ? 'Serology / Immunology' : /Factor|INR|aPTT|Fibrinogen|D-Dimer|Lupus Anticoagulant|Protein C|Protein S|Antithrombin|von Willebrand/i.test(cleanName) ? 'Coagulation' : /Hemoglobin|RBC|WBC|Platelet|Hematocrit|MCV|MCH|MCHC|RDW|Reticulocyte|Neutrophil|Lymphocyte|Monocyte|Eosinophil|Basophil|ESR|G6PD|HbA/i.test(cleanName) ? 'Hematology' : /PSA|CEA|AFP|CA-|SCC|CYFRA|NSE|Chromogranin|HE4|Beta-2 Microglobulin/i.test(cleanName) ? 'Oncology' : 'Biochemistry';
  return {
    code: `EXT2-${String(index + 1).padStart(4, '0')}-${slug(cleanName).slice(0, 14)}`,
    shortName: slug(`${isPlasma ? 'PL-' : 'SER-'}${cleanName}`).slice(0, 20),
    name,
    category: department,
    department,
    sampleType: isPlasma ? 'Plasma' : 'Serum',
    method: method(cleanName),
    tat: 8,
    parameters: [{ name, inputType: isText(cleanName) ? 'TEXT' : 'NUMBER', displayOrder: 1, isRequired: true }],
  };
});

export const EXPANDED_TEST_COUNT_2 = EXPANDED_TESTS_2.length;
