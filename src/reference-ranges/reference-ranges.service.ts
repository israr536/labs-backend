import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

interface RangeBody {
  gender?: unknown;
  ageMinYears?: unknown;
  ageMaxYears?: unknown;
  method?: unknown;
  analyzer?: unknown;
  low?: unknown;
  high?: unknown;
  displayRange?: unknown;
  unit?: unknown;
  effectiveFrom?: unknown;
}

export interface ResolvedReferenceRange {
  id: string;
  version: number;
  gender: Gender | null;
  ageMinYears: number | null;
  ageMaxYears: number | null;
  method: string | null;
  analyzer: string | null;
  low: number | null;
  high: number | null;
  displayRange: string | null;
  unit: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

@Injectable()
export class ReferenceRangesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(currentUser: AuthUser, parameterId: string) {
    await this.assertParameterBelongsToLab(currentUser, parameterId);
    return this.prisma.$queryRaw<ResolvedReferenceRange[]>(Prisma.sql`
      SELECT "id", "version", "gender", "ageMinYears"::double precision, "ageMaxYears"::double precision,
             "method", "analyzer", "low", "high", "displayRange", "unit", "effectiveFrom", "effectiveTo"
      FROM "TestParameterReferenceRange"
      WHERE "parameterId" = ${parameterId}::uuid
      ORDER BY "version" DESC
    `);
  }

  async create(currentUser: AuthUser, parameterId: string, body: RangeBody) {
    await this.assertParameterBelongsToLab(currentUser, parameterId);
    const gender = this.optionalGender(body.gender);
    const ageMinYears = this.optionalNumber(body.ageMinYears, 'ageMinYears');
    const ageMaxYears = this.optionalNumber(body.ageMaxYears, 'ageMaxYears');
    const low = this.optionalNumber(body.low, 'low');
    const high = this.optionalNumber(body.high, 'high');
    if (ageMinYears != null && ageMaxYears != null && ageMinYears > ageMaxYears) throw new BadRequestException('ageMinYears cannot exceed ageMaxYears');
    if (low != null && high != null && low > high) throw new BadRequestException('low cannot exceed high');
    if (low == null && high == null && !this.optionalString(body.displayRange)) throw new BadRequestException('Configure a numeric range or displayRange');

    const method = this.optionalString(body.method);
    const analyzer = this.optionalString(body.analyzer);
    const displayRange = this.optionalString(body.displayRange);
    const unit = this.optionalString(body.unit);
    const effectiveFrom = body.effectiveFrom === undefined ? new Date() : this.parseDate(body.effectiveFrom, 'effectiveFrom');

    const existing = await this.prisma.$queryRaw<Array<{ version: number }>>(Prisma.sql`
      SELECT "version" FROM "TestParameterReferenceRange"
      WHERE "parameterId" = ${parameterId}::uuid
      ORDER BY "version" DESC LIMIT 1
    `);
    const version = (existing[0]?.version ?? 0) + 1;

    const conflicts = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "TestParameterReferenceRange"
      WHERE "parameterId" = ${parameterId}::uuid
        AND "effectiveFrom" <= ${effectiveFrom}
        AND ("effectiveTo" IS NULL OR "effectiveTo" > ${effectiveFrom})
        AND ("gender" IS NULL OR "gender" = ${gender}::"Gender")
        AND ("method" IS NULL OR "method" = ${method})
        AND ("analyzer" IS NULL OR "analyzer" = ${analyzer})
      LIMIT 1
    `);
    if (conflicts.length) throw new BadRequestException('An active reference range already covers this clinical scope at the effective date. Create a non-overlapping definition.');

    const created = await this.prisma.$queryRaw<ResolvedReferenceRange[]>(Prisma.sql`
      INSERT INTO "TestParameterReferenceRange"
        ("parameterId", "version", "gender", "ageMinYears", "ageMaxYears", "method", "analyzer", "low", "high", "displayRange", "unit", "effectiveFrom")
      VALUES
        (${parameterId}::uuid, ${version}, ${gender}::"Gender", ${ageMinYears}, ${ageMaxYears}, ${method}, ${analyzer}, ${low}, ${high}, ${displayRange}, ${unit}, ${effectiveFrom})
      RETURNING "id", "version", "gender", "ageMinYears"::double precision, "ageMaxYears"::double precision,
                "method", "analyzer", "low", "high", "displayRange", "unit", "effectiveFrom", "effectiveTo"
    `);
    return created[0];
  }

  async resolve(currentUser: AuthUser, parameterId: string, patient: { dateOfBirth: Date | null; age: number | null; gender: Gender }, method?: string | null, analyzer?: string | null, at = new Date()) {
    await this.assertParameterBelongsToLab(currentUser, parameterId);
    const age = this.calculateAge(patient.dateOfBirth, patient.age);
    const rows = await this.prisma.$queryRaw<ResolvedReferenceRange[]>(Prisma.sql`
      SELECT "id", "version", "gender", "ageMinYears"::double precision, "ageMaxYears"::double precision,
             "method", "analyzer", "low", "high", "displayRange", "unit", "effectiveFrom", "effectiveTo"
      FROM "TestParameterReferenceRange"
      WHERE "parameterId" = ${parameterId}::uuid
        AND "effectiveFrom" <= ${at}
        AND ("effectiveTo" IS NULL OR "effectiveTo" > ${at})
        AND ("gender" IS NULL OR "gender" = ${patient.gender}::"Gender")
        AND ("ageMinYears" IS NULL OR "ageMinYears" <= ${age})
        AND ("ageMaxYears" IS NULL OR "ageMaxYears" >= ${age})
        AND ("method" IS NULL OR "method" = ${method})
        AND ("analyzer" IS NULL OR "analyzer" = ${analyzer})
      ORDER BY
        CASE WHEN "gender" IS NULL THEN 1 ELSE 0 END,
        CASE WHEN "analyzer" IS NULL THEN 1 ELSE 0 END,
        CASE WHEN "method" IS NULL THEN 1 ELSE 0 END,
        CASE WHEN "ageMinYears" IS NULL AND "ageMaxYears" IS NULL THEN 1 ELSE 0 END,
        COALESCE("ageMaxYears", 1000) - COALESCE("ageMinYears", 0),
        "version" DESC
      LIMIT 1
    `);
    return rows[0] ?? null;
  }

  private async assertParameterBelongsToLab(currentUser: AuthUser, parameterId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p."id"
      FROM "TestParameter" p
      JOIN "Test" t ON t."id" = p."testId"
      WHERE p."id" = ${parameterId}::uuid AND t."labId" = ${currentUser.labId}::uuid
      LIMIT 1
    `);
    if (!rows.length) throw new NotFoundException('Test parameter not found');
  }

  private optionalString(value: unknown) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('Expected a string value');
    const trimmed = value.trim();
    return trimmed || null;
  }

  private optionalNumber(value: unknown, field: string) {
    if (value === undefined || value === null || value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new BadRequestException(`${field} must be a finite number`);
    return number;
  }

  private optionalGender(value: unknown): Gender | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string' || !Object.values(Gender).includes(value as Gender)) throw new BadRequestException('gender must be MALE, FEMALE, OTHER, or omitted');
    return value as Gender;
  }

  private parseDate(value: unknown, field: string) {
    if (typeof value !== 'string' && !(value instanceof Date)) throw new BadRequestException(`${field} must be a valid date`);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be a valid date`);
    return date;
  }

  private calculateAge(dateOfBirth: Date | null, storedAge: number | null) {
    if (!dateOfBirth) return Math.max(0, storedAge ?? 0);
    const now = new Date();
    let age = now.getFullYear() - dateOfBirth.getFullYear();
    const beforeBirthday = now.getMonth() < dateOfBirth.getMonth() || (now.getMonth() === dateOfBirth.getMonth() && now.getDate() < dateOfBirth.getDate());
    if (beforeBirthday) age -= 1;
    return Math.max(0, age);
  }
}
