import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TestsModule } from '../tests/tests.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { PdfService } from './pdf.service';
import { ReportTemplateService } from './report-template.service';

@Module({
  imports: [AuthModule, TestsModule],
  controllers: [ReportsController],
  providers: [ReportsService, PdfService, ReportTemplateService],
})
export class ReportsModule {}
