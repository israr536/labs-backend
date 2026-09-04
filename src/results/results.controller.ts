import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { ResultsService } from './results.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('orders')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get(':orderId/results')
  findOne(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.resultsService.findOne(user, orderId);
  }

  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Patch(':orderId/results')
  save(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.resultsService.save(user, orderId, (body ?? {}) as { results?: unknown });
  }

  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Post(':orderId/verify')
  verify(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.resultsService.verify(user, orderId);
  }
}
