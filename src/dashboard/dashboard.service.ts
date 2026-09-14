import { Injectable } from '@nestjs/common';
import { ReportStatus } from '@prisma/client';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(currentUser: AuthUser) {
    const labId = currentUser.labId;
    const [totalPatients, totalReports, completedReports, pendingReports, criticalReports] = await Promise.all([
      this.prisma.patient.count({ where: { labId } }),
      this.prisma.report.count({ where: { labId } }),
      this.prisma.report.count({ where: { labId, status: ReportStatus.FINAL } }),
      this.prisma.report.count({ where: { labId, status: { in: [ReportStatus.DRAFT, ReportStatus.VERIFIED] } } }),
      this.prisma.report.count({ where: { labId, status: ReportStatus.CRITICAL } }),
    ]);

    return { totalPatients, totalReports, completedReports, pendingReports, criticalReports };
  }
}
