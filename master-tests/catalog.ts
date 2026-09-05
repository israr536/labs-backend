export type CatalogParameter = {
  name: string;
  inputType: 'NUMBER' | 'TEXT' | 'SELECT' | 'MULTILINE_TEXT' | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'TIME' | 'PERCENTAGE' | 'QUALITATIVE';
  unit?: string;
  normalMin?: number;
  normalMax?: number;
  referenceRange?: Record<string, string> | Record<string, unknown>;
  options?: string[];
  validation?: Record<string, unknown>;
  criticalLow?: number;
  criticalHigh?: number;
  decimalPlaces?: number;
  defaultValue?: string;
  formula?: string;
  displayOrder?: number;
  isRequired?: boolean;
  remarks?: string;
};

export type CatalogTest = {
  code: string;
  shortName: string;
  name: string;
  category: string;
  department: string;
  sampleType: string;
  method: string;
  tat: number;
  container?: string;
  fasting?: boolean;
  sampleHandling?: string;
  stability?: string;
  rejectionCriteria?: string;
  description?: string;
  synonyms?: string[];
  externalCodes?: Record<string, string>;
  parameters: CatalogParameter[];
};

const n = (name: string, unit: string, min: number, max: number, extra: Partial<CatalogParameter> = {}): CatalogParameter => ({ name, inputType: 'NUMBER', unit, normalMin: min, normalMax: max, ...extra });
const s = (name: string, options: string[], extra: Partial<CatalogParameter> = {}): CatalogParameter => ({ name, inputType: 'SELECT', options, ...extra });
const x = (name: string, extra: Partial<CatalogParameter> = {}): CatalogParameter => ({ name, inputType: 'TEXT', ...extra });

const single = (
  code: string,
  shortName: string,
  name: string,
  category: string,
  department: string,
  sampleType: string,
  unit: string,
  min: number,
  max: number,
  method = 'Automated / Standard Laboratory Method',
): CatalogTest => ({ code, shortName, name, category, department, sampleType, method, tat: 6, parameters: [n(name, unit, min, max)] });

const quantitative: Array<[string,string,string,string,string,string,string,number,number]> = [
  ['BIO001','GLU-F','Fasting Blood Glucose','Diabetes','Biochemistry','Fluoride Plasma','mg/dL',70,99],
  ['BIO002','GLU-PP','Post Prandial Blood Glucose','Diabetes','Biochemistry','Fluoride Plasma','mg/dL',70,140],
  ['BIO003','GLU-R','Random Blood Glucose','Diabetes','Biochemistry','Fluoride Plasma','mg/dL',70,140],
  ['BIO004','HBA1C','HbA1c','Diabetes','Biochemistry','EDTA Blood','%',4,5.6],
  ['BIO005','UREA','Blood Urea','Renal Profile','Biochemistry','Serum','mg/dL',15,45],
  ['BIO006','CREAT','Creatinine','Renal Profile','Biochemistry','Serum','mg/dL',0.6,1.3],
  ['BIO007','UA','Uric Acid','Renal Profile','Biochemistry','Serum','mg/dL',3.5,7.2],
  ['BIO008','NA','Sodium','Electrolytes','Biochemistry','Serum','mmol/L',135,145],
  ['BIO009','K','Potassium','Electrolytes','Biochemistry','Serum','mmol/L',3.5,5.1],
  ['BIO010','CL','Chloride','Electrolytes','Biochemistry','Serum','mmol/L',98,107],
  ['BIO011','CAL','Total Calcium','Mineral Metabolism','Biochemistry','Serum','mg/dL',8.5,10.5],
  ['BIO012','PHOS','Phosphorus','Mineral Metabolism','Biochemistry','Serum','mg/dL',2.5,4.5],
  ['BIO013','MAG','Magnesium','Mineral Metabolism','Biochemistry','Serum','mg/dL',1.7,2.4],
  ['BIO014','AST','AST / SGOT','Liver Function','Biochemistry','Serum','U/L',10,40],
  ['BIO015','ALT','ALT / SGPT','Liver Function','Biochemistry','Serum','U/L',7,56],
  ['BIO016','ALP','Alkaline Phosphatase','Liver Function','Biochemistry','Serum','U/L',44,147],
  ['BIO017','GGT','Gamma Glutamyl Transferase','Liver Function','Biochemistry','Serum','U/L',9,48],
  ['BIO018','TBIL','Total Bilirubin','Liver Function','Biochemistry','Serum','mg/dL',0.2,1.2],
  ['BIO019','DBIL','Direct Bilirubin','Liver Function','Biochemistry','Serum','mg/dL',0,0.3],
  ['BIO020','TP','Total Protein','Liver Function','Biochemistry','Serum','g/dL',6,8.3],
  ['BIO021','ALB','Albumin','Liver Function','Biochemistry','Serum','g/dL',3.5,5],
  ['BIO022','LDH','Lactate Dehydrogenase','Enzymes','Biochemistry','Serum','U/L',140,280],
  ['BIO023','AMY','Amylase','Pancreatic Enzymes','Biochemistry','Serum','U/L',30,110],
  ['BIO024','LIP','Lipase','Pancreatic Enzymes','Biochemistry','Serum','U/L',13,60],
  ['BIO025','CRP','C-Reactive Protein','Inflammation','Biochemistry','Serum','mg/L',0,5],
  ['BIO026','HSCRP','High Sensitivity CRP','Cardiac Risk','Biochemistry','Serum','mg/L',0,3],
  ['LIP001','TC','Total Cholesterol','Lipid Profile','Biochemistry','Serum','mg/dL',0,199],
  ['LIP002','TG','Triglycerides','Lipid Profile','Biochemistry','Serum','mg/dL',0,149],
  ['LIP003','HDL','HDL Cholesterol','Lipid Profile','Biochemistry','Serum','mg/dL',40,100],
  ['LIP004','LDL','LDL Cholesterol','Lipid Profile','Biochemistry','Serum','mg/dL',0,99],
  ['LIP005','VLDL','VLDL Cholesterol','Lipid Profile','Biochemistry','Serum','mg/dL',5,40],
  ['LIP006','NON-HDL','Non-HDL Cholesterol','Lipid Profile','Biochemistry','Serum','mg/dL',0,129],
  ['HEM001','HB','Hemoglobin','Hematology','Hematology','Whole Blood','g/dL',13.5,17.5],
  ['HEM002','RBC','RBC Count','Hematology','Hematology','Whole Blood','million/cumm',4.5,5.9],
  ['HEM003','WBC','Total Leukocyte Count','Hematology','Hematology','Whole Blood','cells/cumm',4000,11000],
  ['HEM004','PLT','Platelet Count','Hematology','Hematology','Whole Blood','lakhs/cumm',1.5,4.5],
  ['HEM005','HCT','Hematocrit','Hematology','Hematology','Whole Blood','%',40,52],
  ['HEM006','MCV','Mean Corpuscular Volume','Hematology Indices','Hematology','Whole Blood','fL',80,100],
  ['HEM007','MCH','Mean Corpuscular Hemoglobin','Hematology Indices','Hematology','Whole Blood','pg',27,33],
  ['HEM008','MCHC','Mean Corpuscular Hb Concentration','Hematology Indices','Hematology','Whole Blood','g/dL',32,36],
  ['HEM009','RDW','RDW-CV','Hematology Indices','Hematology','Whole Blood','%',11.5,14.5],
  ['HEM010','MPV','Mean Platelet Volume','Hematology Indices','Hematology','Whole Blood','fL',7.5,11.5],
  ['HEM011','ESR','Erythrocyte Sedimentation Rate','Hematology','Hematology','Whole Blood','mm/hr',0,15],
  ['HEM012','ANC','Absolute Neutrophil Count','Hematology','Hematology','Whole Blood','cells/cumm',1500,8000],
  ['HEM013','ALC','Absolute Lymphocyte Count','Hematology','Hematology','Whole Blood','cells/cumm',1000,4000],
  ['HEM014','AEC','Absolute Eosinophil Count','Hematology','Hematology','Whole Blood','cells/cumm',40,400],
  ['HEM015','RETIC','Reticulocyte Count','Hematology','Hematology','Whole Blood','%',0.5,2.5],
  ['COA001','PT','Prothrombin Time','Coagulation','Hematology','Citrated Plasma','sec',10,14],
  ['COA002','INR','INR','Coagulation','Hematology','Citrated Plasma','ratio',0.8,1.2],
  ['COA003','APTT','Activated Partial Thromboplastin Time','Coagulation','Hematology','Citrated Plasma','sec',25,35],
  ['COA004','FIB','Fibrinogen','Coagulation','Hematology','Citrated Plasma','mg/dL',200,400],
  ['THY001','TSH','TSH','Thyroid','Endocrinology','Serum','µIU/mL',0.3,4.2],
  ['THY002','FT4','Free T4','Thyroid','Endocrinology','Serum','ng/dL',0.9,1.7],
  ['THY003','FT3','Free T3','Thyroid','Endocrinology','Serum','pg/mL',2,4.4],
  ['THY004','T3','Total T3','Thyroid','Endocrinology','Serum','ng/dL',80,200],
  ['THY005','T4','Total T4','Thyroid','Endocrinology','Serum','µg/dL',4.5,11.7],
  ['THY006','TPO','Anti-TPO Antibody','Thyroid Antibodies','Endocrinology','Serum','IU/mL',0,9],
  ['HOR001','FSH','Follicle Stimulating Hormone','Hormones','Endocrinology','Serum','mIU/mL',1.5,12.4],
  ['HOR002','LH','Luteinizing Hormone','Hormones','Endocrinology','Serum','mIU/mL',1.7,8.6],
  ['HOR003','PRL','Prolactin','Hormones','Endocrinology','Serum','ng/mL',4,23],
  ['HOR004','E2','Estradiol','Hormones','Endocrinology','Serum','pg/mL',10,50],
  ['HOR005','PROG','Progesterone','Hormones','Endocrinology','Serum','ng/mL',0.1,1.5],
  ['HOR006','TESTO','Total Testosterone','Hormones','Endocrinology','Serum','ng/dL',300,1000],
  ['HOR007','CORT-AM','Morning Cortisol','Hormones','Endocrinology','Serum','µg/dL',5,25],
  ['HOR008','PTH','Parathyroid Hormone','Hormones','Endocrinology','Serum','pg/mL',15,65],
  ['HOR009','AMH','Anti-Müllerian Hormone','Fertility','Endocrinology','Serum','ng/mL',0.5,6],
  ['VIT001','D25','25-OH Vitamin D','Vitamins','Biochemistry','Serum','ng/mL',30,100],
  ['VIT002','B12','Vitamin B12','Vitamins','Biochemistry','Serum','pg/mL',200,900],
  ['VIT003','FOLATE','Folate','Vitamins','Biochemistry','Serum','ng/mL',3.1,17.5],
  ['VIT004','FERRITIN','Ferritin','Iron Studies','Biochemistry','Serum','ng/mL',24,336],
  ['VIT005','IRON','Serum Iron','Iron Studies','Biochemistry','Serum','µg/dL',60,170],
  ['VIT006','TIBC','Total Iron Binding Capacity','Iron Studies','Biochemistry','Serum','µg/dL',250,450],
  ['CAR001','TNI','Troponin I','Cardiac Markers','Biochemistry','Serum','ng/mL',0,0.04],
  ['CAR002','TNT','Troponin T','Cardiac Markers','Biochemistry','Serum','ng/L',0,14],
  ['CAR003','CKMB','CK-MB','Cardiac Markers','Biochemistry','Serum','ng/mL',0,5],
  ['CAR004','MYO','Myoglobin','Cardiac Markers','Biochemistry','Serum','ng/mL',25,72],
  ['CAR005','BNP','BNP','Cardiac Markers','Biochemistry','Serum','pg/mL',0,100],
  ['CAR006','NTBNP','NT-proBNP','Cardiac Markers','Biochemistry','Serum','pg/mL',0,125],
  ['CAR007','DDIMER','D-Dimer','Coagulation/Cardiac','Hematology','Plasma','µg/mL FEU',0,0.5],
  ['TUM001','AFP','Alpha Fetoprotein','Tumor Markers','Oncology','Serum','ng/mL',0,10],
  ['TUM002','CEA','Carcinoembryonic Antigen','Tumor Markers','Oncology','Serum','ng/mL',0,5],
  ['TUM003','CA125','Cancer Antigen 125','Tumor Markers','Oncology','Serum','U/mL',0,35],
  ['TUM004','CA153','Cancer Antigen 15-3','Tumor Markers','Oncology','Serum','U/mL',0,30],
  ['TUM005','CA199','Cancer Antigen 19-9','Tumor Markers','Oncology','Serum','U/mL',0,37],
  ['TUM006','PSA','Total PSA','Tumor Markers','Oncology','Serum','ng/mL',0,4],
  ['URI001','SPGR','Urine Specific Gravity','Urine','Clinical Pathology','Urine','ratio',1.005,1.03],
  ['URI002','UR-PH','Urine pH','Urine','Clinical Pathology','Urine','pH',4.5,8],
  ['URI003','UR-RBC','Urine RBC','Urine Microscopy','Clinical Pathology','Urine','/HPF',0,2],
  ['URI004','UR-WBC','Urine WBC','Urine Microscopy','Clinical Pathology','Urine','/HPF',0,5],
  ['URI005','ACR','Urine Albumin/Creatinine Ratio','Urine Chemistry','Clinical Pathology','Urine','mg/g',0,30],
  ['URI006','PCR','Urine Protein/Creatinine Ratio','Urine Chemistry','Clinical Pathology','Urine','mg/g',0,200],
  ['TDM001','VALPROATE','Valproic Acid','Therapeutic Drug Monitoring','Clinical Chemistry','Serum','µg/mL',50,100],
  ['TDM002','PHENYTOIN','Phenytoin','Therapeutic Drug Monitoring','Clinical Chemistry','Serum','µg/mL',10,20],
  ['TDM003','CARBAMAZEPINE','Carbamazepine','Therapeutic Drug Monitoring','Clinical Chemistry','Serum','µg/mL',4,12],
  ['TDM004','DIGOXIN','Digoxin','Therapeutic Drug Monitoring','Clinical Chemistry','Serum','ng/mL',0.5,2],
  ['TDM005','LITHIUM','Lithium','Therapeutic Drug Monitoring','Clinical Chemistry','Serum','mEq/L',0.6,1.2],
  ['BG001','PH','pH','Blood Gas','Biochemistry','Arterial Blood','',7.35,7.45],
  ['BG002','PCO2','pCO2','Blood Gas','Biochemistry','Arterial Blood','mmHg',35,45],
  ['BG003','PO2','pO2','Blood Gas','Biochemistry','Arterial Blood','mmHg',80,100],
];

const quantitativeTests: CatalogTest[] = quantitative.map(([code, shortName, name, category, department, sampleType, unit, min, max]) => single(code, shortName, name, category, department, sampleType, unit, min, max));

export const MASTER_TESTS: CatalogTest[] = quantitativeTests;
export const MASTER_TEST_CATALOG_VERSION = '2026.09.05';
