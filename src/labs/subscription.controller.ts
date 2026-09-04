import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SubscriptionService } from './subscription.service';

@UseGuards(AuthGuard)
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  @Get('status')
  getStatus(@CurrentUser() user: AuthUser) {
    return this.subscriptionService.getStatus(user.labId);
  }
}
