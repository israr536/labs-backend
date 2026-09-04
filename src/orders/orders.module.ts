import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabsModule } from '../labs/labs.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, LabsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
