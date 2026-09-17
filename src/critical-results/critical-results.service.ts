import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const METHODS = ['PHONE', 'IN_PERSON', 'ELECTRONIC', 'OTHER'] as const;
type NotificationMethod = (typeof METHODS)[number];
type CriticalResultRecord = Record<string, unknown> & {
  status: string;
  notificationAttempts: Record<string, unknown>[];
};

@Injectable()
export class CriticalResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Critical thresholds are laboratory-configured; this service never invents them. */
  async listPending(labId: string) {
    return this.prisma.$queryRaw<CriticalResultRecord[]>(Prisma.sql`
      SELECT
        cr."id", cr."orderResultId", cr."patientId", cr."testId", cr."parameterId",
        cr."occurrence", cr."value", cr."unit", cr."direction", cr."criticalThreshold",
        cr."referenceRangeSnapshot", cr."status", cr."detectedAt", cr."notifiedAt",
        cr."notifiedTo", cr."acknowledgedAt", cr."acknowledgementNote",
        p."name" AS "patientName", t."name" AS "testName", tp."name" AS "parameterName",
        COALESCE((
          SELECT json_agg(json_build_object(
            'id', a."id", 'method', a."method", 'attemptedAt', a."attemptedAt",
            'contactedName', a."contactedName", 'contactDetails', a."contactDetails",
            'successful', a."successful", 'readBackConfirmed', a."readBackConfirmed",
            'notes', a."notes", 'attemptedById', a."attemptedById"
          ) ORDER BY a."attemptedAt" DESC)
          FROM "CriticalNotificationAttempt" a
          WHERE a."criticalResultId" = cr."id" AND a."labId" = cr."labId"
        ), '[]'::json) AS "notificationAttempts"
      FROM "CriticalResult" cr
      JOIN "Patient" p ON p."id" = cr."patientId"
      JOIN "Test" t ON t."id" = cr."testId"
      JOIN "TestParameter" tp ON tp."id" = cr."parameterId"
      WHERE cr."labId" = ${labId}::uuid
        AND cr."isCurrent" = true
        AND cr."status" IN ('PENDING', 'NOTIFIED')
      ORDER BY cr."detectedAt" ASC
      LIMIT 100
    `);
  }

  async getOne(labId: string, id: string): Promise<CriticalResultRecord> {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT cr.*, p."name" AS "patientName", t."name" AS "testName",
             tp."name" AS "parameterName", tp."unit" AS "parameterUnit"
      FROM "CriticalResult" cr
      JOIN "Patient" p ON p."id" = cr."patientId"
      JOIN "Test" t ON t."id" = cr."testId"
      JOIN "TestParameter" tp ON tp."id" = cr."parameterId"
      WHERE cr."id" = ${id}::uuid AND cr."labId" = ${labId}::uuid
      LIMIT 1
    `);
    if (!rows.length) throw new NotFoundException('Critical result not found');
    const attempts = await this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
      SELECT "id", "method", "attemptedAt", "contactedName", "contactDetails",
             "successful", "readBackConfirmed", "notes", "attemptedById"
      FROM "CriticalNotificationAttempt"
      WHERE "criticalResultId" = ${id}::uuid AND "labId" = ${labId}::uuid
      ORDER BY "attemptedAt" DESC
    `);
    return { ...rows[0], notificationAttempts: attempts } as CriticalResultRecord;
  }

  async acknowledge(labId: string, id: string, userId: string, note?: string) {
    const result = await this.getOne(labId, id);
    if (result.status === 'ACKNOWLEDGED') return result;
    if (result.status !== 'NOTIFIED') {
      throw new BadRequestException('A critical result must have a successful notification before acknowledgement');
    }
    const noteValue = note?.trim() || null;
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.$executeRaw(Prisma.sql`
        UPDATE "CriticalResult"
        SET "status" = 'ACKNOWLEDGED', "acknowledgedAt" = CURRENT_TIMESTAMP,
            "acknowledgedById" = ${userId}::uuid, "acknowledgementNote" = ${noteValue}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${id}::uuid AND "labId" = ${labId}::uuid
          AND "isCurrent" = true AND "status" = 'NOTIFIED'
      `);
      if (changed !== 1) throw new BadRequestException('Critical result changed while acknowledgement was being recorded');
      await tx.auditLog.create({
        data: {
          labId,
          actorId: userId,
          action: AuditAction.UPDATE,
          entity: 'CriticalResult',
          entityId: id,
          metadata: { operation: 'CRITICAL_RESULT_ACKNOWLEDGED', note: noteValue },
        },
      });
    });
    return this.getOne(labId, id);
  }

  async recordNotificationAttempt(
    labId: string,
    id: string,
    userId: string,
    data: {
      method: string;
      contactedName?: string;
      contactDetails?: string;
      successful: boolean;
      readBackConfirmed?: boolean;
      notes?: string;
    },
  ) {
    const result = await this.getOne(labId, id);
    if (!['PENDING', 'NOTIFIED'].includes(result.status)) {
      throw new BadRequestException('This critical result is no longer open');
    }
    if (!METHODS.includes(data.method as NotificationMethod)) {
      throw new BadRequestException('Invalid notification method');
    }
    if (data.successful && (data.method === 'PHONE' || data.method === 'ELECTRONIC') && !data.readBackConfirmed) {
      throw new BadRequestException('Read-back or receipt confirmation is required for successful phone/electronic notification');
    }
    if (data.successful && !data.contactedName?.trim()) {
      throw new BadRequestException('Contacted person is required for a successful notification');
    }

    const attemptedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CriticalNotificationAttempt" (
          "id", "criticalResultId", "labId", "method", "attemptedAt", "contactedName",
          "contactDetails", "successful", "readBackConfirmed", "notes", "attemptedById"
        ) VALUES (
          gen_random_uuid(), ${id}::uuid, ${labId}::uuid, ${data.method}::"CriticalNotificationMethod",
          ${attemptedAt}, ${data.contactedName?.trim() || null}, ${data.contactDetails?.trim() || null},
          ${data.successful}, ${data.readBackConfirmed ?? false}, ${data.notes?.trim() || null}, ${userId}::uuid
        )
      `);
      if (data.successful) {
        const changed = await tx.$executeRaw(Prisma.sql`
          UPDATE "CriticalResult"
          SET "status" = 'NOTIFIED', "notifiedAt" = ${attemptedAt},
              "notifiedTo" = ${data.contactedName?.trim() || null}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}::uuid AND "labId" = ${labId}::uuid
            AND "isCurrent" = true AND "status" = 'PENDING'
        `);
        if (changed !== 1) throw new BadRequestException('Critical result was already completed by another request');
      }
      await tx.auditLog.create({
        data: {
          labId,
          actorId: userId,
          action: AuditAction.UPDATE,
          entity: 'CriticalResult',
          entityId: id,
          metadata: {
            operation: 'CRITICAL_NOTIFICATION_ATTEMPT',
            method: data.method,
            successful: data.successful,
            contactedName: data.contactedName?.trim() || null,
          },
        },
      });
    });
    return this.getOne(labId, id);
  }
}
