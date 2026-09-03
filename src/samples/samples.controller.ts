import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { SamplesService } from './samples.service';

@UseGuards(AuthGuard)
@Controller('samples')
export class SamplesController {
  constructor(private readonly samplesService: SamplesService) {}

  @Post('orders/:orderId')
  createForOrder(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: unknown,
  ) {
    return this.samplesService.createForOrder(user, orderId, (body ?? {}) as Record<string, unknown>);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('orderId') orderId?: string) {
    return this.samplesService.findAll(user, orderId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.samplesService.findOne(user, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const payload = (body ?? {}) as Record<string, unknown>;
    return this.samplesService.updateStatus(user, id, payload.status, payload.rejectedReason);
  }
}
