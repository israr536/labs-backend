export type CatalogParameter = {
  name: string;
  inputType: 'NUMBER' | 'TEXT' | 'SELECT';
  unit?: string;
  normalMin?: number;
  normalMax?: number;
  referenceRange?: Record<string, string>;
  options?: string[];
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
  parameters: CatalogParameter[];
};

const n = (name: string, unit: string, min: number, max: number, extra: Partial<CatalogParameter> = {}): CatalogParameter => ({
  name, inputType: 'NUMBER', unit, normalMin: min, normalMax: max, ...extra,
});

const s = (name: string, options: string[], extra: Partial<CatalogParameter> = {}): CatalogParameter => ({
  name, inputType: 'SELECT', options, ...extra,
});

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
): CatalogTest => ({
  code, shortName, name, category, department, sampleType, method, tat: 6,
  parameters: [n(name, unit, min, max)],
});

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
  ['BG004','HCO3','Bicarbonate','Blood Gas','Biochemistry','Arterial Blood','mmol/L',22,29],
  ['BG005','SO2','Oxygen Saturation','Blood Gas','Biochemistry','Arterial Blood','%',95,100],
  ['BG006','BE','Base Excess','Blood Gas','Biochemistry','Arterial Blood','mmol/L',-2,2],
];

const baseTests: CatalogTest[] = quantitative.map(([code, shortName, name, category, department, sampleType, unit, min, max]) =>
  single(code, shortName, name, category, department, sampleType, unit, min, max),
);

const qualitativeTests: CatalogTest[] = [
  { code:'SER001',shortName:'HIV',name:'HIV 1 & 2 Antibody',category:'Infectious Serology',department:'Serology',sampleType:'Serum',method:'Immunoassay',tat:8,parameters:[s('HIV 1 & 2 Antibody',['Negative','Positive','Equivocal'])] },
  { code:'SER002',shortName:'HBSAG',name:'HBsAg',category:'Hepatitis',department:'Serology',sampleType:'Serum',method:'Immunoassay',tat:8,parameters:[s('HBsAg',['Negative','Positive','Equivocal'])] },
  { code:'SER003',shortName:'HCV',name:'Anti-HCV',category:'Hepatitis',department:'Serology',sampleType:'Serum',method:'Immunoassay',tat:8,parameters:[s('Anti-HCV',['Negative','Positive','Equivocal'])] },
  { code:'SER004',shortName:'DENGUE-NS1',name:'Dengue NS1 Antigen',category:'Dengue',department:'Serology',sampleType:'Serum',method:'Rapid/Immunoassay',tat:8,parameters:[s('Dengue NS1 Antigen',['Negative','Positive','Equivocal'])] },
  { code:'SER005',shortName:'DENGUE-IGM',name:'Dengue IgM',category:'Dengue',department:'Serology',sampleType:'Serum',method:'Immunoassay',tat:8,parameters:[s('Dengue IgM',['Negative','Positive','Equivocal'])] },
  { code:'SER006',shortName:'MALARIA',name:'Malaria Antigen',category:'Malaria',department:'Serology',sampleType:'Whole Blood',method:'Rapid Antigen Test',tat:8,parameters:[s('Malaria Antigen',['Negative','Positive'])] },
  { code:'SER007',shortName:'VDRL',name:'VDRL',category:'Syphilis',department:'Serology',sampleType:'Serum',method:'Flocculation',tat:8,parameters:[s('VDRL',['Non-reactive','Reactive'])] },
  { code:'BB001',shortName:'ABO',name:'ABO Blood Group',category:'Blood Bank',department:'Transfusion Medicine',sampleType:'Whole Blood',method:'Hemagglutination',tat:8,parameters:[s('ABO Group',['A','B','AB','O'])] },
  { code:'BB002',shortName:'RH',name:'Rh(D) Typing',category:'Blood Bank',department:'Transfusion Medicine',sampleType:'Whole Blood',method:'Hemagglutination',tat:8,parameters:[s('Rh(D)',['Positive','Negative'])] },
  { code:'BB003',shortName:'DAT',name:'Direct Antiglobulin Test',category:'Blood Bank',department:'Transfusion Medicine',sampleType:'Whole Blood',method:'Gel/Tube Method',tat:8,parameters:[s('DAT',['Negative','Positive'])] },
  { code:'MIC001',shortName:'URINE-CULT',name:'Urine Culture',category:'Microbiology',department:'Microbiology',sampleType:'Urine',method:'Culture',tat:48,parameters:[x('Organism / Result')] },
  { code:'MIC002',shortName:'BLOOD-CULT',name:'Blood Culture',category:'Microbiology',department:'Microbiology',sampleType:'Blood',method:'Automated Culture',tat:72,parameters:[x('Organism / Result')] },
  { code:'MIC003',shortName:'AFB',name:'AFB Smear',category:'Microbiology',department:'Microbiology',sampleType:'Sputum',method:'Ziehl-Neelsen Stain',tat:24,parameters:[x('Microscopy Result')] },
  { code:'MOL001',shortName:'TB-PCR',name:'Mycobacterium tuberculosis PCR',category:'Molecular Diagnostics',department:'Molecular Biology',sampleType:'Sputum',method:'PCR',tat:24,parameters:[s('Result',['Negative','Positive','Indeterminate'])] },
  { code:'MOL002',shortName:'HPV-PCR',name:'High Risk HPV DNA',category:'Molecular Diagnostics',department:'Molecular Biology',sampleType:'Cervical Swab',method:'PCR',tat:24,parameters:[s('Result',['Not Detected','Detected','Invalid'])] },
  { code:'PRE001',shortName:'PREG',name:'Pregnancy Test',category:'Prenatal',department:'Clinical Pathology',sampleType:'Urine',method:'Immunochromatography',tat:4,parameters:[s('Pregnancy Test',['Negative','Positive'])] },
  { code:'PAT001',shortName:'PAP',name:'Pap Smear Cytology',category:'Cytology',department:'Histopathology',sampleType:'Cervical Smear',method:'Cytology',tat:72,parameters:[x('Findings'),x('Impression',{displayOrder:2})] },
  { code:'PAT002',shortName:'FNAC',name:'Fine Needle Aspiration Cytology',category:'Cytology',department:'Histopathology',sampleType:'Aspirate',method:'Cytology',tat:48,parameters:[x('Findings'),x('Impression',{displayOrder:2})] },
];

const panels: CatalogTest[] = [
  { code:'PAN001',shortName:'CBC',name:'Complete Blood Count',category:'Hematology Panel',department:'Hematology',sampleType:'Whole Blood',method:'Automated Hematology Analyzer',tat:6,parameters:[
    n('Hemoglobin','g/dL',13.5,17.5,{referenceRange:{MALE:'13.5-17.5',FEMALE:'12.0-15.5'}}),n('Total Leukocyte Count','cells/cumm',4000,11000,{displayOrder:2}),n('RBC Count','million/cumm',4.5,5.9,{displayOrder:3,referenceRange:{MALE:'4.5-5.9',FEMALE:'4.1-5.1'}}),n('Platelet Count','lakhs/cumm',1.5,4.5,{displayOrder:4}),n('Hematocrit','%',40,52,{displayOrder:5}),n('MCV','fL',80,100,{displayOrder:6}),n('MCH','pg',27,33,{displayOrder:7}),n('MCHC','g/dL',32,36,{displayOrder:8}),n('RDW-CV','%',11.5,14.5,{displayOrder:9})
  ]},
  { code:'PAN002',shortName:'LFT',name:'Liver Function Test',category:'Liver Profile',department:'Biochemistry',sampleType:'Serum',method:'Automated Chemistry Analyzer',tat:6,parameters:[
    n('Total Bilirubin','mg/dL',0.2,1.2),n('Direct Bilirubin','mg/dL',0,0.3,{displayOrder:2}),n('AST / SGOT','U/L',10,40,{displayOrder:3}),n('ALT / SGPT','U/L',7,56,{displayOrder:4}),n('ALP','U/L',44,147,{displayOrder:5}),n('Total Protein','g/dL',6,8.3,{displayOrder:6}),n('Albumin','g/dL',3.5,5,{displayOrder:7})
  ]},
  { code:'PAN003',shortName:'RFT',name:'Renal Function Test',category:'Renal Profile',department:'Biochemistry',sampleType:'Serum',method:'Automated Chemistry Analyzer',tat:6,parameters:[
    n('Urea','mg/dL',15,45),n('Creatinine','mg/dL',0.6,1.3,{displayOrder:2}),n('Uric Acid','mg/dL',3.5,7.2,{displayOrder:3}),n('Sodium','mmol/L',135,145,{displayOrder:4}),n('Potassium','mmol/L',3.5,5.1,{displayOrder:5}),n('Chloride','mmol/L',98,107,{displayOrder:6})
  ]},
  { code:'PAN004',shortName:'LIPID',name:'Lipid Profile',category:'Lipid Profile',department:'Biochemistry',sampleType:'Serum',method:'Automated Chemistry Analyzer',tat:6,parameters:[
    n('Total Cholesterol','mg/dL',0,199),n('Triglycerides','mg/dL',0,149,{displayOrder:2}),n('HDL Cholesterol','mg/dL',40,100,{displayOrder:3}),n('LDL Cholesterol','mg/dL',0,99,{displayOrder:4}),n('VLDL Cholesterol','mg/dL',5,40,{displayOrder:5}),n('Non-HDL Cholesterol','mg/dL',0,129,{displayOrder:6})
  ]},
  { code:'PAN005',shortName:'THYROID',name:'Thyroid Profile',category:'Thyroid Profile',department:'Endocrinology',sampleType:'Serum',method:'Chemiluminescent Immunoassay',tat:8,parameters:[
    n('T3','ng/dL',80,200),n('T4','µg/dL',4.5,11.7,{displayOrder:2}),n('TSH','µIU/mL',0.3,4.2,{displayOrder:3})
  ]},
  { code:'PAN006',shortName:'FT-THYROID',name:'Thyroid Profile Free',category:'Thyroid Profile',department:'Endocrinology',sampleType:'Serum',method:'Chemiluminescent Immunoassay',tat:8,parameters:[
    n('Free T3','pg/mL',2,4.4),n('Free T4','ng/dL',0.9,1.7,{displayOrder:2}),n('TSH','µIU/mL',0.3,4.2,{displayOrder:3})
  ]},
  { code:'PAN007',shortName:'DIABETES',name:'Diabetes Profile',category:'Diabetes',department:'Biochemistry',sampleType:'Blood / Serum',method:'Chemistry + Immunoassay',tat:8,parameters:[
    n('Fasting Glucose','mg/dL',70,99),n('Post Prandial Glucose','mg/dL',70,140,{displayOrder:2}),n('HbA1c','%',4,5.6,{displayOrder:3}),n('Estimated Average Glucose','mg/dL',70,117,{displayOrder:4})
  ]},
  { code:'PAN008',shortName:'CARDIAC',name:'Cardiac Biomarkers Panel',category:'Cardiac Markers',department:'Biochemistry',sampleType:'Serum',method:'Immunoassay',tat:8,parameters:[
    n('Troponin I','ng/mL',0,0.04),n('CK-MB','ng/mL',0,5,{displayOrder:2}),n('Myoglobin','ng/mL',25,72,{displayOrder:3}),n('BNP','pg/mL',0,100,{displayOrder:4})
  ]},
  { code:'PAN009',shortName:'IRON',name:'Iron Profile',category:'Iron Studies',department:'Biochemistry',sampleType:'Serum',method:'Chemistry + Immunoassay',tat:8,parameters:[
    n('Serum Iron','µg/dL',60,170),n('TIBC','µg/dL',250,450,{displayOrder:2}),n('Ferritin','ng/mL',24,336,{displayOrder:3}),n('Transferrin Saturation','%',20,50,{displayOrder:4})
  ]},
  { code:'PAN010',shortName:'TORCH',name:'TORCH Profile',category:'Prenatal Screening',department:'Serology',sampleType:'Serum',method:'Immunoassay',tat:24,parameters:[
    s('Toxoplasma IgM',['Negative','Positive','Equivocal']),s('Toxoplasma IgG',['Negative','Positive','Equivocal'],{displayOrder:2}),s('Rubella IgM',['Negative','Positive','Equivocal'],{displayOrder:3}),s('Rubella IgG',['Negative','Positive','Equivocal'],{displayOrder:4}),s('CMV IgM',['Negative','Positive','Equivocal'],{displayOrder:5}),s('CMV IgG',['Negative','Positive','Equivocal'],{displayOrder:6})
  ]},
];

export const MASTER_TESTS: CatalogTest[] = [...baseTests, ...qualitativeTests, ...panels].map((test) => ({
  ...test,
  parameters: test.parameters.map((parameter, index) => ({
    ...parameter,
    displayOrder: parameter.displayOrder ?? index + 1,
    isRequired: parameter.isRequired ?? true,
  })),
}));

export const MASTER_TEST_CATALOG_VERSION = '2026.09.04';
