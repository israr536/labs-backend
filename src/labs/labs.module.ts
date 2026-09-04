import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LabsController } from './labs.controller';
import { LabsService } from './labs.service';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [AuthModule],
  controllers: [LabsController, SubscriptionController],
  providers: [LabsService, SubscriptionService],
  exports: [SubscriptionService],
})
export class LabsModule {}
