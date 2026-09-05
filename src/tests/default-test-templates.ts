export interface DefaultParameterTemplate {
  name: string;
  inputType: string;
  unit?: string;
  normalMin?: number;
  normalMax?: number;
  decimalPlaces?: number;
  isRequired?: boolean;
  displayOrder: number;
}

export interface DefaultTestTemplate {
  code: string;
  name: string;
  category: string;
  department: string;
  sampleType: string;
  method?: string;
  tat?: number;
  parameters: DefaultParameterTemplate[];
}

/** Starter templates used to provision a laboratory with immediately usable tests. */
export const DEFAULT_TEST_TEMPLATES: DefaultTestTemplate[] = [
  {
    code: 'CBC', name: 'Complete Blood Count', category: 'Hematology', department: 'Hematology',
    sampleType: 'EDTA Whole Blood', method: 'Automated Hematology Analyzer', tat: 6,
    parameters: [
      ['Hemoglobin','NUMBER','g/dL',13,17,1], ['RBC Count','NUMBER','million/µL',4.5,5.5,2],
      ['WBC Count','NUMBER','cells/µL',4000,11000,0], ['Platelet Count','NUMBER','lakh/µL',1.5,4.5,2],
      ['Hematocrit (PCV)','NUMBER','%',40,50,1], ['MCV','NUMBER','fL',83,101,1],
      ['MCH','NUMBER','pg',27,32,1], ['MCHC','NUMBER','g/dL',31,36,1],
      ['RDW-CV','NUMBER','%',11.5,14.5,1], ['Neutrophils','NUMBER','%',40,80,1],
      ['Lymphocytes','NUMBER','%',20,40,1], ['Eosinophils','NUMBER','%',1,6,1],
      ['Monocytes','NUMBER','%',2,10,1], ['Basophils','NUMBER','%',0,2,1],
    ].map(([name,inputType,unit,normalMin,normalMax,decimalPlaces], i) => ({name: name as string,inputType: inputType as string,unit: unit as string,normalMin: normalMin as number,normalMax: normalMax as number,decimalPlaces: decimalPlaces as number,isRequired:true,displayOrder:i})),
  },
  {
    code:'FBS', name:'Fasting Blood Sugar', category:'Biochemistry', department:'Biochemistry', sampleType:'Fluoride Plasma', method:'Hexokinase', tat:4,
    parameters:[{name:'Glucose',inputType:'NUMBER',unit:'mg/dL',normalMin:70,normalMax:99,decimalPlaces:0,isRequired:true,displayOrder:0}],
  },
  {
    code:'PPBS', name:'Post Prandial Blood Sugar', category:'Biochemistry', department:'Biochemistry', sampleType:'Fluoride Plasma', method:'Hexokinase', tat:4,
    parameters:[{name:'Glucose',inputType:'NUMBER',unit:'mg/dL',normalMin:70,normalMax:140,decimalPlaces:0,isRequired:true,displayOrder:0}],
  },
  {
    code:'HBA1C', name:'HbA1c', category:'Biochemistry', department:'Biochemistry', sampleType:'EDTA Whole Blood', method:'HPLC', tat:8,
    parameters:[{name:'HbA1c',inputType:'NUMBER',unit:'%',normalMin:4,normalMax:5.6,decimalPlaces:1,isRequired:true,displayOrder:0}],
  },
  {
    code:'VITD25OH', name:'Vitamin D, 25-OH', category:'Biochemistry', department:'Biochemistry', sampleType:'Serum', method:'CLIA', tat:24,
    parameters:[{name:'25-OH Vitamin D',inputType:'NUMBER',unit:'ng/mL',normalMin:30,normalMax:100,decimalPlaces:1,isRequired:true,displayOrder:0}],
  },
];
