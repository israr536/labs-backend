import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { FinalReportsService } from './final-reports.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('orders')
export class FinalReportsController {
  constructor(private readonly finalReportsService: FinalReportsService) {}

  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Post(':orderId/finalize')
  finalize(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.finalReportsService.finalize(user, orderId);
  }

  @Get(':orderId/report')
  getReport(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.finalReportsService.getReport(user, orderId);
  }

  @Get(':orderId/report/versions')
  listVersions(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.finalReportsService.listVersions(user, orderId);
  }

  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Post(':orderId/report/amend')
  amend(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: { reason?: unknown },
  ) {
    return this.finalReportsService.amend(user, orderId, body?.reason);
  }

  @Get(':orderId/report/pdf')
  async getPdf(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Res() response: Response,
  ) {
    const pdf = await this.finalReportsService.generatePdf(user, orderId);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="lab-report.pdf"',
      'Content-Length': pdf.length.toString(),
      'Cache-Control': 'private, no-store',
    });
    response.end(pdf);
  }
}
