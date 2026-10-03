import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Post('funnel') track(@Body() body: unknown) { return this.analyticsService.track((body && typeof body === 'object' ? body : {}) as any); }
  @UseGuards(AuthGuard) @Get('funnel/summary') summary() { return this.analyticsService.summary(); }
}
