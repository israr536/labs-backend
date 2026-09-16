import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FinalReportsModule } from '../final-reports/final-reports.module';
import { LabsModule } from '../labs/labs.module';
import { PatientsModule } from '../patients/patients.module';
import { ResultsModule } from '../results/results.module';
import { SamplesModule } from '../samples/samples.module';
import { TestsModule } from '../tests/tests.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, LabsModule, TestsModule, PatientsModule, SamplesModule, ResultsModule, FinalReportsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
