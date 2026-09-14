import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(currentUser: AuthUser) {
    const labId = currentUser.labId;
    const [totalPatients, totalReports, completedReports, pendingReports] = await Promise.all([
      this.prisma.patient.count({ where: { labId } }),
      this.prisma.labOrder.count({ where: { labId } }),
      this.prisma.labOrder.count({ where: { labId, status: OrderStatus.FINAL } }),
      this.prisma.labOrder.count({ where: { labId, status: { notIn: [OrderStatus.FINAL, OrderStatus.CANCELLED] } } }),
    ]);

    return {
      totalPatients,
      totalReports,
      completedReports,
      pendingReports,
      criticalReports: 0,
    };
  }
}
