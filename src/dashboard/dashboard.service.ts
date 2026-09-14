import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(currentUser: AuthUser) {
    const labId = currentUser.labId;
    const [totalPatients, totalReports, completedReports, pendingReports, criticalRows] = await Promise.all([
      this.prisma.patient.count({ where: { labId } }),
      this.prisma.labOrder.count({ where: { labId } }),
      this.prisma.labOrder.count({ where: { labId, status: OrderStatus.FINAL } }),
      this.prisma.labOrder.count({ where: { labId, status: { notIn: [OrderStatus.FINAL, OrderStatus.CANCELLED] } } }),
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
      totalReports,
      completedReports,
      pendingReports,
      criticalReports: Number(criticalRows[0]?.count ?? 0),
    };
  }
}
