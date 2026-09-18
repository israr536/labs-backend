import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Response,
  UseGuards,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../auth/auth.types';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { ReportTemplateService } from './report-template.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService, private readonly reportTemplateService: ReportTemplateService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) { return this.reportsService.create(user, body ?? {}); }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('status') status?: string, @Query('search') search?: string, @Query('patientId') patientId?: string, @Query('testId') testId?: string, @Query('skip') skip?: string, @Query('take') take?: string, @Query('includeTotal') includeTotal?: string) {
    return this.reportsService.findAll(user, { status, search, patientId, testId, skip, take, includeTotal });
  }

  @Get('templates')
  templates() { return this.reportTemplateService.list(); }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.reportsService.findOne(user, id); }

  @Get(':id/generate')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.reportsService.generate(user, id); }

  @Get(':id/pdf')
  async generatePdf(@CurrentUser() user: AuthUser, @Param('id') id: string, @Query('template') template: string | undefined, @Response() res: ExpressResponse) {
    const data = await this.reportsService.generate(user, id);
    const buffer = await this.reportTemplateService.generatePdf(data, template);
    const selected = this.reportTemplateService.normalize(template);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename=report-${id}-${selected}.pdf`,
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
    });
    res.send(buffer);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) { return this.reportsService.update(user, id, body ?? {}); }

  @Roles(UserRole.ADMIN, UserRole.TECHNICIAN)
  @Post(':id/finalize')
  finalize(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.reportsService.finalize(user, id); }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.reportsService.remove(user, id); }
}
