import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { ResultsService } from './results.service';

@UseGuards(AuthGuard)
@Controller('orders')
export class ResultsController {
  constructor(private readonly resultsService: ResultsService) {}

  @Get(':orderId/results')
  findOne(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.resultsService.findOne(user, orderId);
  }

  @Patch(':orderId/results')
  save(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string, @Body() body: unknown) {
    return this.resultsService.save(user, orderId, (body ?? {}) as { results?: unknown });
  }

  @Post(':orderId/verify')
  verify(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.resultsService.verify(user, orderId);
  }
}
