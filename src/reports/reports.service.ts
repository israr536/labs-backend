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
  optionalEnumValue,
  optionalString,
  requiredString,
} from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

interface ReportBody {
  patientId?: unknown;
  testId?: unknown;
  remarks?: unknown;
  doctorNotes?: unknown;
  results?: unknown;
}

interface UpdateReportBody {
  remarks?: unknown;
  doctorNotes?: unknown;
  results?: unknown;
}

interface ReportResultBody {
  parameterId?: unknown;
  value?: unknown;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(currentUser: AuthUser, body: ReportBody) {
    const patientId = requiredString(body.patientId, 'patientId');
    const testId = requiredString(body.testId, 'testId');
    const [lab, patient, test] = await Promise.all([
      this.prisma.lab.findUnique({ where: { id: currentUser.labId } }),
      this.prisma.patient.findFirst({
        where: { id: patientId, labId: currentUser.labId },
      }),
      this.prisma.test.findFirst({
        where: { id: testId, labId: currentUser.labId, isActive: true },
        include: { parameters: true },
      }),
    ]);

    if (!lab) {
      throw new NotFoundException('Lab not found');
    }

    if (!patient) {
      throw new NotFoundException('Patient not found');
    }

    if (!test) {
      throw new NotFoundException('Test not found');
    }

    const parsedResults = this.parseResults(body.results);
    const results = this.buildResults(parsedResults, test.parameters);

    const report = await this.prisma.report.create({
      data: {
        labId: currentUser.labId,
        patientId,
        testId,
        reportNumber: this.createReportNumber(lab.code),
        createdById: currentUser.id,
        remarks: optionalString(body.remarks, 'remarks'),
        doctorNotes: optionalString(body.doctorNotes, 'doctorNotes'),
        results: results.length ? { create: results } : undefined,
      },
      include: this.reportInclude(),
    });

    return report;
  }

  findAll(currentUser: AuthUser, status?: string) {
    return this.prisma.report.findMany({
      where: {
        labId: currentUser.labId,
        status: optionalEnumValue(ReportStatus, status, 'status'),
      },
      include: {
        patient: true,
        test: true,
        createdBy: { select: this.userSelect() },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(currentUser: AuthUser, id: string) {
    const report = await this.prisma.report.findFirst({
      where: { id, labId: currentUser.labId },
      include: this.reportInclude(),
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async update(currentUser: AuthUser, id: string, body: UpdateReportBody) {
    const report = await this.findOne(currentUser, id);

    if (report.status === ReportStatus.FINAL) {
      throw new BadRequestException('Final reports cannot be edited');
    }

    const parsedResults =
      body.results === undefined ? undefined : this.parseResults(body.results);
    const results = parsedResults
      ? this.buildResults(parsedResults, report.test.parameters)
      : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.report.update({
        where: { id },
        data: {
          remarks: optionalString(body.remarks, 'remarks'),
          doctorNotes: optionalString(body.doctorNotes, 'doctorNotes'),
        },
      });

      if (results) {
        for (const result of results) {
          await tx.reportResult.upsert({
            where: {
              reportId_parameterId: {
                reportId: id,
                parameterId: result.parameterId,
              },
            },
            create: {
              reportId: id,
              ...result,
            },
            update: {
              value: result.value,
              flag: result.flag,
            },
          });
        }
      }
    });

    return this.findOne(currentUser, id);
  }

  async finalize(currentUser: AuthUser, id: string) {
    const report = await this.findOne(currentUser, id);

    if (report.status === ReportStatus.FINAL) {
      return report;
    }

    const resultByParameter = new Map(
      report.results.map((result) => [result.parameterId, result]),
    );
    const missingRequired = report.test.parameters.filter(
      (parameter) =>
        parameter.isRequired &&
        !requiredReportValue(resultByParameter.get(parameter.id)?.value),
    );

    if (missingRequired.length > 0) {
      throw new BadRequestException(
        `Missing required results: ${missingRequired
          .map((parameter) => parameter.name)
          .join(', ')}`,
      );
    }

    await this.prisma.report.update({
      where: { id },
      data: {
        status: ReportStatus.FINAL,
        approvedBy: currentUser.id,
        reportedAt: new Date(),
      },
    });

    return this.findOne(currentUser, id);
  }

  async generate(currentUser: AuthUser, id: string) {
    const report = await this.findOne(currentUser, id);
    const resultByParameter = new Map(
      report.results.map((result) => [result.parameterId, result]),
    );

    return {
      report: {
        id: report.id,
        reportNumber: report.reportNumber,
        status: report.status,
        remarks: report.remarks,
        doctorNotes: report.doctorNotes,
        reportedAt: report.reportedAt,
        createdAt: report.createdAt,
      },
      lab: report.lab,
      patient: report.patient,
      test: {
        id: report.test.id,
        name: report.test.name,
        category: report.test.category,
      },
      results: report.test.parameters.map((parameter) => {
        const result = resultByParameter.get(parameter.id);

        return {
          parameterId: parameter.id,
          name: parameter.name,
          value: result?.value ?? null,
          unit: parameter.unit,
          normalMin: parameter.normalMin,
          normalMax: parameter.normalMax,
          normalRange: formatNormalRange(parameter),
          flag: result?.flag ?? null,
          inputType: parameter.inputType,
          displayOrder: parameter.displayOrder,
        };
      }),
      approval: {
        approvedBy: report.approvedBy,
        createdBy: {
          id: report.createdBy.id,
          username: report.createdBy.username,
          role: report.createdBy.role,
        },
      },
    };
  }

  async remove(currentUser: AuthUser, id: string) {
    const report = await this.findOne(currentUser, id);

    if (report.status === ReportStatus.FINAL) {
      throw new BadRequestException('Final reports cannot be deleted');
    }

    await this.prisma.report.delete({ where: { id } });

    return { success: true };
  }

  private parseResults(value: unknown): ReportResultBody[] {
    if (value === undefined || value === null) {
      return [];
    }

    return arrayValue<ReportResultBody>(value, 'results');
  }

  private buildResults(
    results: ReportResultBody[],
    parameters: TestParameter[],
  ) {
    const parameterById = new Map(
      parameters.map((parameter) => [parameter.id, parameter]),
    );

    return results.map((result, index) => {
      const parameterId = requiredString(
        result.parameterId,
        `results.${index}.parameterId`,
      );
      const value = requiredString(result.value, `results.${index}.value`);
      const parameter = parameterById.get(parameterId);

      if (!parameter) {
        throw new BadRequestException(
          `results.${index}.parameterId does not belong to this test`,
        );
      }

      return {
        parameterId,
        value,
        flag: this.calculateFlag(parameter, value),
      };
    });
  }

  private calculateFlag(
    parameter: TestParameter,
    value: string,
  ): ResultFlag | undefined {
    if (parameter.inputType !== ParameterInputType.NUMBER) {
      return undefined;
    }

    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      throw new BadRequestException(
        `${parameter.name} must be a numeric value`,
      );
    }

    if (parameter.normalMin !== null && numericValue < parameter.normalMin) {
      return ResultFlag.LOW;
    }

    if (parameter.normalMax !== null && numericValue > parameter.normalMax) {
      return ResultFlag.HIGH;
    }

    if (parameter.normalMin !== null || parameter.normalMax !== null) {
      return ResultFlag.NORMAL;
    }

    return undefined;
  }

  private createReportNumber(labCode: string): string {
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14);
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();

    return `${labCode}-${timestamp}-${random}`;
  }

  private reportInclude() {
    return {
      lab: true,
      patient: true,
      test: { include: { parameters: { orderBy: { displayOrder: 'asc' } } } },
      results: { include: { parameter: true } },
      createdBy: { select: this.userSelect() },
    } as const;
  }

  private userSelect() {
    return {
      id: true,
      labId: true,
      username: true,
      mobile: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}

function requiredReportValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function formatNormalRange(parameter: TestParameter): string | null {
  if (parameter.normalMin === null && parameter.normalMax === null) {
    return null;
  }

  if (parameter.normalMin !== null && parameter.normalMax !== null) {
    return `${parameter.normalMin} - ${parameter.normalMax}`;
  }

  if (parameter.normalMin !== null) {
    return `>= ${parameter.normalMin}`;
  }

  return `<= ${parameter.normalMax}`;
}
