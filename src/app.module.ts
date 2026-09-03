import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { LabsModule } from './labs/labs.module';
import { OrdersModule } from './orders/orders.module';
import { PatientsModule } from './patients/patients.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SamplesModule } from './samples/samples.module';
import { TestsModule } from './tests/tests.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    LabsModule,
    UsersModule,
    PatientsModule,
    TestsModule,
    ReportsModule,
    OrdersModule,
    SamplesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
