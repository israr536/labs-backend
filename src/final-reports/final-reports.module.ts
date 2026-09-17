import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../prisma/prisma.module';
import { FinalReportsController } from './final-reports.controller';
import { FinalReportWorkflowService } from './final-report-workflow.service';
import { FinalReportsService } from './final-reports.service';

@Module({
  imports: [AuthModule, AuditModule, PrismaModule],
  controllers: [FinalReportsController],
  providers: [FinalReportsService, FinalReportWorkflowService],
  exports: [FinalReportsService],
})
export class FinalReportsModule {}
