import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('audit-logs')
@UseGuards(AuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Roles(UserRole.ADMIN)
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
  ) {
    return this.audit.list(user, {
      entity,
      entityId,
      limit: Number(limit),
      offset: Number(offset),
    });
  }
}
