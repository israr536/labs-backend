import type { CatalogTest } from './catalog';
import type { CatalogValidationIssue, CatalogValidationSummary } from './catalog-validator';

export type CatalogReadinessStatus = 'READY' | 'READY_WITH_CLINICAL_REVIEW' | 'BLOCKED';

export type CatalogCategoryReadiness = {
  category: string;
  tests: number;
  ready: number;
  clinicalReview: number;
  blocked: number;
};

export type CatalogCompletenessReport = {
  totalTests: number;
  readyTests: number;
  testsRequiringClinicalReview: number;
  blockedTests: number;
  readinessPercent: number;
  parameterReferenceCoveragePercent: number;
  parameterUnitCoveragePercent: number;
  parameterInputCoveragePercent: number;
  blockingIssues: CatalogValidationIssue[];
  clinicalReviewIssues: CatalogValidationIssue[];
  categoryReadiness: CatalogCategoryReadiness[];
};

const blockingIssueCodes = new Set([
  'NO_PARAMETERS',
  'NUMERIC_PARAMETER_MISSING_UNIT',
  'INPUT_CONFIGURATION_INCOMPLETE',
]);

const getIssueStatus = (issues: CatalogValidationIssue[]): CatalogReadinessStatus => {
  if (issues.some((issue) => blockingIssueCodes.has(issue.issue))) return 'BLOCKED';
  if (issues.some((issue) => issue.issue === 'NUMERIC_PARAMETER_MISSING_REFERENCE_DATA')) return 'READY_WITH_CLINICAL_REVIEW';
  return 'READY';
};

export const buildCatalogCompletenessReport = (
  tests: CatalogTest[],
  validation: CatalogValidationSummary,
): CatalogCompletenessReport => {
  const issuesByCode = new Map<string, CatalogValidationIssue[]>();
  for (const issue of validation.issues) {
    const existing = issuesByCode.get(issue.code) ?? [];
    existing.push(issue);
    issuesByCode.set(issue.code, existing);
  }

  let readyTests = 0;
  let testsRequiringClinicalReview = 0;
  let blockedTests = 0;

  for (const test of tests) {
    const status = getIssueStatus(issuesByCode.get(test.code) ?? []);
    if (status === 'READY') readyTests += 1;
    else if (status === 'READY_WITH_CLINICAL_REVIEW') testsRequiringClinicalReview += 1;
    else blockedTests += 1;
  }

  const categories = new Map<string, CatalogCategoryReadiness>();
  for (const test of tests) {
    const category = test.category?.trim() || 'Uncategorized';
    const current = categories.get(category) ?? { category, tests: 0, ready: 0, clinicalReview: 0, blocked: 0 };
    current.tests += 1;
    const status = getIssueStatus(issuesByCode.get(test.code) ?? []);
    if (status === 'READY') current.ready += 1;
    else if (status === 'READY_WITH_CLINICAL_REVIEW') current.clinicalReview += 1;
    else current.blocked += 1;
    categories.set(category, current);
  }

  const totalParameters = validation.totalParameters || 0;
  const percentage = (value: number) => totalParameters ? Number(((value / totalParameters) * 100).toFixed(1)) : 100;

  return {
    totalTests: validation.totalTests,
    readyTests,
    testsRequiringClinicalReview,
    blockedTests,
    readinessPercent: validation.totalTests ? Number((((readyTests + testsRequiringClinicalReview) / validation.totalTests) * 100).toFixed(1)) : 100,
    parameterReferenceCoveragePercent: percentage(validation.parametersWithReferenceData),
    parameterUnitCoveragePercent: percentage(validation.parametersWithUnits),
    parameterInputCoveragePercent: percentage(validation.parametersWithInputConfiguration),
    blockingIssues: validation.issues.filter((issue) => blockingIssueCodes.has(issue.issue)),
    clinicalReviewIssues: validation.issues.filter((issue) => issue.issue === 'NUMERIC_PARAMETER_MISSING_REFERENCE_DATA'),
    categoryReadiness: [...categories.values()].sort((a, b) => b.tests - a.tests || a.category.localeCompare(b.category)),
  };
};
