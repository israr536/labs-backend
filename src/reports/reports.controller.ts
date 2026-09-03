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
import type { AuthUser } from '../auth/auth.types';
import { ReportsService } from './reports.service';

@UseGuards(AuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.reportsService.create(user, body ?? {});
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('patientId') patientId?: string,
    @Query('testId') testId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.reportsService.findAll(user, {
      status,
      search,
      patientId,
      testId,
      skip,
      take,
    });
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reportsService.findOne(user, id);
  }

  @Get(':id/generate')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reportsService.generate(user, id);
  }

  @Get(':id/pdf')
  async generatePdf(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Response() res: ExpressResponse,
  ) {
    const buffer = await this.reportsService.generatePdf(user, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=report-${id}.pdf`,
    });
    res.send(buffer);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.reportsService.update(user, id, body ?? {});
  }

  @Post(':id/finalize')
  finalize(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reportsService.finalize(user, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.reportsService.remove(user, id);
  }
}
