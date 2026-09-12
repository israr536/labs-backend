import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CriticalResultsService } from './critical-results.service';

@Controller('critical-results')
@UseGuards(AuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.TECHNICIAN, UserRole.PATHOLOGIST)
export class CriticalResultsController {
  constructor(private readonly service: CriticalResultsService) {}

  @Get('pending')
  listPending(@CurrentUser() user: AuthUser) {
    return this.service.listPending(user.labId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user.labId, id);
  }

  @Patch(':id/acknowledge')
  acknowledge(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { note?: string }) {
    return this.service.acknowledge(user.labId, id, user.id, body?.note);
  }

  @Patch(':id/notification-attempt')
  notificationAttempt(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: {
      method: string;
      successful: boolean;
      recipient?: string;
      contactDetails?: string;
      readBackConfirmed?: boolean;
      note?: string;
    },
  ) {
    return this.service.recordNotificationAttempt(user.labId, id, user.id, { ...body, notes: body.note });
  }
}
