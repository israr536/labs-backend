import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const METHODS = ['PHONE', 'IN_PERSON', 'ELECTRONIC', 'OTHER'] as const;
type NotificationMethod = (typeof METHODS)[number];

@Injectable()
export class CriticalResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Critical thresholds are laboratory-configured; this service never invents them. */
  async listPending(labId: string) {
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
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

  async getOne(labId: string, id: string) {
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
    return { ...rows[0], notificationAttempts: attempts };
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
      successful: boolean;
      recipient?: string;
      contactDetails?: string;
      readBackConfirmed?: boolean;
      note?: string;
    },
  ) {
    const method = data.method?.trim().toUpperCase() as NotificationMethod;
    if (!METHODS.includes(method)) throw new BadRequestException(`Unsupported notification method: ${data.method}`);
    if (typeof data.successful !== 'boolean') throw new BadRequestException('successful must be a boolean');

    const recipient = data.recipient?.trim() || null;
    const contactDetails = data.contactDetails?.trim() || null;
    const notes = data.note?.trim() || null;
    const readBackConfirmed = data.readBackConfirmed === true;

    if (data.successful && !recipient) throw new BadRequestException('Recipient name is required for a successful notification');
    if (data.successful && (method === 'PHONE' || method === 'ELECTRONIC') && !readBackConfirmed) {
      throw new BadRequestException('Read-back/receipt confirmation is required for successful phone or electronic notification');
    }

    await this.getOne(labId, id);
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.$queryRaw<Array<{ status: string; isCurrent: boolean }>>(Prisma.sql`
        SELECT "status", "isCurrent"
        FROM "CriticalResult"
        WHERE "id" = ${id}::uuid AND "labId" = ${labId}::uuid
        FOR UPDATE
      `);
      if (!current.length) throw new NotFoundException('Critical result not found');
      if (!current[0].isCurrent || current[0].status === 'SUPERSEDED') throw new BadRequestException('This critical result occurrence is no longer current');
      if (current[0].status === 'ACKNOWLEDGED') throw new BadRequestException('Critical result is already acknowledged');

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "CriticalNotificationAttempt"
          ("criticalResultId", "labId", "method", "contactedName", "contactDetails", "successful", "readBackConfirmed", "notes", "attemptedById")
        VALUES
          (${id}::uuid, ${labId}::uuid, ${method}::"CriticalNotificationMethod", ${recipient}, ${contactDetails}, ${data.successful}, ${readBackConfirmed}, ${notes}, ${userId}::uuid)
      `);

      if (data.successful) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "CriticalResult"
          SET "status" = 'NOTIFIED', "notifiedAt" = CURRENT_TIMESTAMP,
              "notifiedTo" = ${recipient}, "notifiedById" = ${userId}::uuid,
              "updatedAt" = CURRENT_TIMESTAMP
          WHERE "id" = ${id}::uuid AND "labId" = ${labId}::uuid
        `);
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
            method,
            successful: data.successful,
            recipient,
            readBackConfirmed,
          },
        },
      });
    });

    return this.getOne(labId, id);
  }
}
