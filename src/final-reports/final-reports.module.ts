import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { FinalReportsController } from './final-reports.controller';
import { FinalReportsService } from './final-reports.service';

@Module({ imports: [AuthModule, AuditModule], controllers: [FinalReportsController], providers: [FinalReportsService] })
export class FinalReportsModule {}
