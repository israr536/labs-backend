import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(currentUser: AuthUser) {
    const labId = currentUser.labId;
    const [totalPatients, orderCounts, criticalRows] = await Promise.all([
      this.prisma.patient.count({ where: { labId } }),
      this.prisma.$queryRaw<Array<{ totalReports: bigint; completedReports: bigint; pendingReports: bigint }>>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE "status" <> ${OrderStatus.CANCELLED}::"OrderStatus")::bigint AS "totalReports",
          COUNT(*) FILTER (WHERE "status" = ${OrderStatus.FINAL}::"OrderStatus")::bigint AS "completedReports",
          COUNT(*) FILTER (WHERE "status" IN (${OrderStatus.REGISTERED}::"OrderStatus", ${OrderStatus.SAMPLE_COLLECTED}::"OrderStatus", ${OrderStatus.PROCESSING}::"OrderStatus", ${OrderStatus.RESULT_ENTERED}::"OrderStatus", ${OrderStatus.VERIFIED}::"OrderStatus"))::bigint AS "pendingReports"
        FROM "LabOrder"
        WHERE "labId" = ${labId}::uuid
      `),
      this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "CriticalResult"
        WHERE "labId" = ${labId}::uuid
          AND "isCurrent" = true
          AND "status" IN ('PENDING', 'NOTIFIED')
      `),
    ]);

    return {
      totalPatients,
      totalReports: Number(orderCounts[0]?.totalReports ?? 0),
      completedReports: Number(orderCounts[0]?.completedReports ?? 0),
      pendingReports: Number(orderCounts[0]?.pendingReports ?? 0),
      criticalReports: Number(criticalRows[0]?.count ?? 0),
    };
  }
}
