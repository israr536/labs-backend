import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinalReportsController } from './final-reports.controller';
import { FinalReportsService } from './final-reports.service';

@Module({
  imports: [AuthModule],
  controllers: [FinalReportsController],
  providers: [FinalReportsService],
})
export class FinalReportsModule {}
