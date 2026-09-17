import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { TestsService } from './tests.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('tests')
export class TestsController {
  constructor(private readonly testsService: TestsService) {}

  @Roles(UserRole.ADMIN)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.testsService.create(user, body ?? {});
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.testsService.findAll(user, includeInactive);
  }

  @Get('report-entry')
  reportEntryCatalog(@CurrentUser() user: AuthUser) {
    return this.testsService.reportEntryCatalog(user);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testsService.findOne(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.testsService.update(user, id, body ?? {});
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.testsService.remove(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Post(':id/parameters')
  addParameter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.testsService.addParameter(user, id, body ?? {});
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id/parameters/:parameterId')
  updateParameter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('parameterId') parameterId: string,
    @Body() body: unknown,
  ) {
    return this.testsService.updateParameter(user, id, parameterId, body ?? {});
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/parameters/:parameterId')
  removeParameter(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('parameterId') parameterId: string,
  ) {
    return this.testsService.removeParameter(user, id, parameterId);
  }
}
