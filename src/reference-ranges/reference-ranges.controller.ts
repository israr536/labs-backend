import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ReferenceRangesService } from './reference-ranges.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('reference-ranges')
export class ReferenceRangesController {
  constructor(private readonly referenceRanges: ReferenceRangesService) {}

  @Get('parameters/:parameterId')
  list(@CurrentUser() user: AuthUser, @Param('parameterId') parameterId: string) {
    return this.referenceRanges.list(user, parameterId);
  }

  @Roles(UserRole.ADMIN)
  @Post('parameters/:parameterId')
  create(@CurrentUser() user: AuthUser, @Param('parameterId') parameterId: string, @Body() body: unknown) {
    return this.referenceRanges.create(user, parameterId, (body ?? {}) as Record<string, unknown>);
  }
}
