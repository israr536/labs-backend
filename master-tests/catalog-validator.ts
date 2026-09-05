import type { CatalogTest, CatalogParameter } from './catalog';

export type CatalogValidationIssue = {
  code: string;
  name: string;
  issue: string;
  parameter?: string;
};

export type CatalogValidationSummary = {
  totalTests: number;
  testsWithParameters: number;
  testsWithMultipleParameters: number;
  totalParameters: number;
  parametersWithUnits: number;
  parametersWithReferenceData: number;
  parametersWithInputConfiguration: number;
  issues: CatalogValidationIssue[];
};

const hasReferenceData = (parameter: CatalogParameter) =>
  parameter.referenceRange && Object.keys(parameter.referenceRange).length > 0 ||
  (typeof parameter.normalMin === 'number' && typeof parameter.normalMax === 'number');

const hasInputConfiguration = (parameter: CatalogParameter) => {
  if (parameter.inputType === 'SELECT') return Array.isArray(parameter.options) && parameter.options.length > 0;
  return parameter.inputType === 'NUMBER' || parameter.inputType === 'TEXT';
};

export const validateCatalog = (tests: CatalogTest[]): CatalogValidationSummary => {
  const issues: CatalogValidationIssue[] = [];
  let testsWithParameters = 0;
  let testsWithMultipleParameters = 0;
  let totalParameters = 0;
  let parametersWithUnits = 0;
  let parametersWithReferenceData = 0;
  let parametersWithInputConfiguration = 0;

  for (const test of tests) {
    if (!test.parameters.length) {
      issues.push({ code: test.code, name: test.name, issue: 'NO_PARAMETERS' });
      continue;
    }

    testsWithParameters += 1;
    if (test.parameters.length > 1) testsWithMultipleParameters += 1;

    for (const parameter of test.parameters) {
      totalParameters += 1;
      const prefix = { code: test.code, name: test.name, parameter: parameter.name };
      if (parameter.unit?.trim()) parametersWithUnits += 1;
      else if (parameter.inputType === 'NUMBER') issues.push({ ...prefix, issue: 'NUMERIC_PARAMETER_MISSING_UNIT' });

      if (hasReferenceData(parameter)) parametersWithReferenceData += 1;
      else if (parameter.inputType === 'NUMBER') issues.push({ ...prefix, issue: 'NUMERIC_PARAMETER_MISSING_REFERENCE_DATA' });

      if (hasInputConfiguration(parameter)) parametersWithInputConfiguration += 1;
      else issues.push({ ...prefix, issue: 'INPUT_CONFIGURATION_INCOMPLETE' });
    }
  }

  return {
    totalTests: tests.length,
    testsWithParameters,
    testsWithMultipleParameters,
    totalParameters,
    parametersWithUnits,
    parametersWithReferenceData,
    parametersWithInputConfiguration,
    issues,
  };
};
