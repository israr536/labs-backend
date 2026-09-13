import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ParameterInputType,
  ReportStatus,
  ResultFlag,
  TestParameter,
} from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import {
  arrayValue,
  optionalDate,
  optionalEnumValue,
  optionalInteger,
  optionalString,
  requiredString,
} from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { TestsService } from '../tests/tests.service';
import { PdfService } from './pdf.service';

interface ReportBody { patientId?: unknown; testId?: unknown; remarks?: unknown; doctorNotes?: unknown; referredBy?: unknown; sampleCollectedAt?: unknown; results?: unknown; }
interface UpdateReportBody { remarks?: unknown; doctorNotes?: unknown; referredBy?: unknown; sampleCollectedAt?: unknown; results?: unknown; }
interface ReportResultBody { parameterId?: unknown; value?: unknown; }
interface FindAllOptions { status?: string; search?: string; patientId?: string; testId?: string; skip?: string; take?: string; }
type ValidationRule = { min?: number; max?: number; minLength?: number; maxLength?: number; pattern?: string };

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService, private readonly pdfService: PdfService, private readonly testsService: TestsService) {}

  async create(currentUser: AuthUser, body: ReportBody) {
    const patientId = requiredString(body.patientId, 'patientId');
    const testId = requiredString(body.testId, 'testId');
    const [lab, patient, resolvedTests] = await Promise.all([
      this.prisma.lab.findUnique({ where: { id: currentUser.labId } }),
      this.prisma.patient.findFirst({ where: { id: patientId, labId: currentUser.labId } }),
      this.testsService.resolveForUse(currentUser, [testId]),
    ]);
    const test = resolvedTests[0];
    if (!lab) throw new NotFoundException('Lab not found');
    if (!patient) throw new NotFoundException('Patient not found');
    if (!test) throw new NotFoundException('Test not found');

    const results = this.buildResults(this.parseResults(body.results), test.parameters);
    return this.prisma.report.create({
      data: {
        labId: currentUser.labId,
        patientId,
        testId,
        reportNumber: this.createReportNumber(lab.code),
        createdById: currentUser.id,
        remarks: optionalString(body.remarks, 'remarks'),
        doctorNotes: optionalString(body.doctorNotes, 'doctorNotes'),
        referredBy: optionalString(body.referredBy, 'referredBy'),
        sampleCollectedAt: optionalDate(body.sampleCollectedAt, 'sampleCollectedAt'),
        results: results.length ? { create: results } : undefined,
      },
      include: this.reportInclude(),
    });
  }

  async findAll(currentUser: AuthUser, options: FindAllOptions) {
    const skip = optionalInteger(options.skip, 'skip') ?? 0;
    const take = optionalInteger(options.take, 'take') ?? 20;
    if (skip < 0) throw new BadRequestException('skip must be >= 0');
    if (take < 1 || take > 100) throw new BadRequestException('take must be between 1 and 100');
    const status = optionalEnumValue(ReportStatus, options.status, 'status');
    const search = optionalString(options.search, 'search');
    const patientId = optionalString(options.patientId, 'patientId');
    const testId = optionalString(options.testId, 'testId');
    const where: any = { labId: currentUser.labId };
    if (status) where.status = status;
    if (patientId) where.patientId = patientId;
    if (testId) where.testId = testId;
    if (search) where.OR = [
      { reportNumber: { contains: search, mode: 'insensitive' as const } },
      { patient: { name: { contains: search, mode: 'insensitive' as const } } },
      { patient: { mobile: { contains: search, mode: 'insensitive' as const } } },
      { remarks: { contains: search, mode: 'insensitive' as const } },
    ];
    return this.prisma.$transaction(async (tx) => {
      const [total, reports] = await Promise.all([
        tx.report.count({ where }),
        tx.report.findMany({ where, include: this.reportInclude(), orderBy: { createdAt: 'desc' }, skip, take }),
      ]);
      return { data: reports, pagination: { total, skip, take, pages: Math.ceil(total / take) } };
    });
  }

  async findOne(currentUser: AuthUser, id: string) {
    const report = await this.prisma.report.findFirst({ where: { id, labId: currentUser.labId }, include: this.reportInclude() });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  async update(currentUser: AuthUser, id: string, body: UpdateReportBody) {
    const report = await this.findOne(currentUser, id);
    if (report.status === ReportStatus.FINAL) throw new BadRequestException('Final reports cannot be edited');
    const parsedResults = body.results === undefined ? undefined : this.parseResults(body.results);
    const results = parsedResults === undefined ? undefined : this.buildResults(parsedResults, report.test.parameters);
    await this.prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id },
        data: {
          remarks: body.remarks === undefined ? undefined : optionalString(body.remarks, 'remarks'),
          doctorNotes: body.doctorNotes === undefined ? undefined : optionalString(body.doctorNotes, 'doctorNotes'),
          referredBy: body.referredBy === undefined ? undefined : optionalString(body.referredBy, 'referredBy'),
          sampleCollectedAt: body.sampleCollectedAt === undefined ? undefined : optionalDate(body.sampleCollectedAt, 'sampleCollectedAt'),
        },
      });
      if (results !== undefined) {
        const submittedIds = new Set(results.map((result) => result.parameterId));
        await tx.reportResult.deleteMany({ where: { reportId: id, parameterId: { notIn: [...submittedIds] } } });
        for (const result of results) {
          await tx.reportResult.upsert({
            where: { reportId_parameterId: { reportId: id, parameterId: result.parameterId } },
            create: { reportId: id, ...result },
            update: { value: result.value, flag: result.flag },
          });
        }
      }
    });
    return this.findOne(currentUser, id);
  }

  async finalize(currentUser: AuthUser, id: string) {
    const report = await this.findOne(currentUser, id);
    if (report.status === ReportStatus.FINAL) return report;
    const resultByParameter = new Map(report.results.map((result) => [result.parameterId, result]));
    const missingRequired = report.test.parameters.filter((parameter) => parameter.isRequired && !requiredReportValue(resultByParameter.get(parameter.id)?.value));
    if (missingRequired.length) throw new BadRequestException(`Missing required results: ${missingRequired.map((p) => p.name).join(', ')}`);
    await this.prisma.report.update({ where: { id }, data: { status: ReportStatus.FINAL, approvedBy: currentUser.id, reportedAt: new Date() } });
    return this.findOne(currentUser, id);
  }

  async generate(currentUser: AuthUser, id: string) {
    const report = await this.findOne(currentUser, id);
    const resultByParameter = new Map(report.results.map((result) => [result.parameterId, result]));
    return {
      report: { id: report.id, reportNumber: report.reportNumber, status: report.status, remarks: report.remarks, doctorNotes: report.doctorNotes, referredBy: report.referredBy, sampleCollectedAt: report.sampleCollectedAt, reportedAt: report.reportedAt, createdAt: report.createdAt },
      lab: report.lab,
      patient: report.patient,
      test: { id: report.test.id, name: report.test.name, category: report.test.category },
      results: report.test.parameters.map((parameter) => {
        const result = resultByParameter.get(parameter.id);
        return { parameterId: parameter.id, name: parameter.name, value: result?.value ?? null, unit: parameter.unit, normalMin: parameter.normalMin, normalMax: parameter.normalMax, normalRange: formatNormalRange(parameter), referenceRange: parameter.referenceRange, inputType: parameter.inputType, options: parameter.options, decimalPlaces: parameter.decimalPlaces, criticalLow: parameter.criticalLow, criticalHigh: parameter.criticalHigh, formula: parameter.formula, flag: result?.flag ?? null, displayOrder: parameter.displayOrder, isRequired: parameter.isRequired };
      }),
      approval: { approvedBy: report.approvedBy, createdBy: { id: report.createdBy.id, username: report.createdBy.username, role: report.createdBy.role } },
    };
  }

  async generatePdf(currentUser: AuthUser, id: string): Promise<Buffer> {
    const data = await this.generate(currentUser, id);
    if (data.report.status !== ReportStatus.FINAL) throw new BadRequestException('Only final reports can be downloaded as PDF');
    return this.pdfService.generateReportPdf(data);
  }

  async remove(currentUser: AuthUser, id: string) {
    const report = await this.findOne(currentUser, id);
    if (report.status === ReportStatus.FINAL) throw new BadRequestException('Final reports cannot be deleted');
    await this.prisma.report.delete({ where: { id } });
    return { success: true };
  }

  private parseResults(value: unknown): ReportResultBody[] { return value === undefined || value === null ? [] : arrayValue<ReportResultBody>(value, 'results'); }

  private buildResults(results: ReportResultBody[], parameters: TestParameter[]) {
    const parameterById = new Map(parameters.map((parameter) => [parameter.id, parameter]));
    const seen = new Set<string>();
    const output: Array<{ parameterId: string; value: string; flag: ResultFlag | undefined }> = [];
    results.forEach((result, index) => {
      const parameterId = requiredString(result.parameterId, `results.${index}.parameterId`);
      if (seen.has(parameterId)) throw new BadRequestException(`Duplicate result for parameter ${parameterId}`);
      seen.add(parameterId);
      const parameter = parameterById.get(parameterId);
      if (!parameter) throw new BadRequestException(`results.${index}.parameterId does not belong to this test`);
      const value = normalizeResultValue(result.value, `results.${index}.value`);
      // Draft reports may omit required results; finalization enforces required fields.
      if (value === '') return;
      this.validateParameterValue(parameter, value, `results.${index}.value`);
      output.push({ parameterId, value, flag: this.calculateFlag(parameter, value) });
    });
    return output;
  }

  private validateParameterValue(parameter: TestParameter, value: string, path: string) {
    switch (parameter.inputType) {
      case ParameterInputType.NUMBER:
      case ParameterInputType.PERCENTAGE: {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) throw new BadRequestException(`${parameter.name} must be a numeric value`);
        break;
      }
      case ParameterInputType.BOOLEAN:
        if (!['true', 'false', 'yes', 'no', 'positive', 'negative'].includes(value.trim().toLowerCase())) throw new BadRequestException(`${parameter.name} must be a boolean value`);
        break;
      case ParameterInputType.DATE:
      case ParameterInputType.DATETIME:
      case ParameterInputType.TIME:
        if (Number.isNaN(Date.parse(value)) && parameter.inputType !== ParameterInputType.TIME) throw new BadRequestException(`${parameter.name} contains an invalid date/time value`);
        break;
      case ParameterInputType.SELECT:
      case ParameterInputType.QUALITATIVE: {
        const options = Array.isArray(parameter.options) ? parameter.options.filter((item): item is string => typeof item === 'string') : [];
        if (options.length && !options.includes(value)) throw new BadRequestException(`${parameter.name} must be one of the configured options`);
        break;
      }
      default:
        break;
    }

    const rules = isValidationRule(parameter.validation) ? parameter.validation : null;
    if (!rules) return;
    if (typeof rules.minLength === 'number' && value.length < rules.minLength) throw new BadRequestException(`${parameter.name} is shorter than the minimum length`);
    if (typeof rules.maxLength === 'number' && value.length > rules.maxLength) throw new BadRequestException(`${parameter.name} exceeds the maximum length`);
    const numeric = Number(value);
    if (typeof rules.min === 'number' && Number.isFinite(numeric) && numeric < rules.min) throw new BadRequestException(`${parameter.name} is below the configured minimum`);
    if (typeof rules.max === 'number' && Number.isFinite(numeric) && numeric > rules.max) throw new BadRequestException(`${parameter.name} exceeds the configured maximum`);
    if (typeof rules.pattern === 'string') {
      let regex: RegExp;
      try { regex = new RegExp(rules.pattern); } catch { throw new BadRequestException(`${parameter.name} has an invalid catalog validation rule`); }
      if (!regex.test(value)) throw new BadRequestException(`${parameter.name} has an invalid format`);
    }
  }

  private calculateFlag(parameter: TestParameter, value: string): ResultFlag | undefined {
    if (parameter.inputType !== ParameterInputType.NUMBER && parameter.inputType !== ParameterInputType.PERCENTAGE) return undefined;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) throw new BadRequestException(`${parameter.name} must be a numeric value`);
    if (parameter.normalMin !== null && numericValue < parameter.normalMin) return ResultFlag.LOW;
    if (parameter.normalMax !== null && numericValue > parameter.normalMax) return ResultFlag.HIGH;
    if (parameter.normalMin !== null || parameter.normalMax !== null) return ResultFlag.NORMAL;
    return undefined;
  }

  private createReportNumber(labCode: string): string {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${labCode}-${timestamp}-${random}`;
  }

  private reportInclude() {
    return { lab: true, patient: true, test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } }, results: { include: { parameter: true } }, createdBy: { select: this.userSelect() } } as const;
  }
  private userSelect() { return { id: true, labId: true, username: true, mobile: true, email: true, role: true, isActive: true, createdAt: true, updatedAt: true } as const; }
}

function requiredReportValue(value: string | undefined): boolean { return typeof value === 'string' && value.trim().length > 0; }
function normalizeResultValue(value: unknown, path: string): string { if (value === undefined || value === null) return ''; if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') throw new BadRequestException(`${path} must be a string, number, or boolean`); return String(value).trim(); }
function isValidationRule(value: unknown): value is ValidationRule { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function formatNormalRange(parameter: TestParameter): string | null {
  if (parameter.normalMin === null && parameter.normalMax === null) return null;
  if (parameter.normalMin !== null && parameter.normalMax !== null) return `${parameter.normalMin} - ${parameter.normalMax}`;
  if (parameter.normalMin !== null) return `>= ${parameter.normalMin}`;
  return `<= ${parameter.normalMax}`;
}
