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
import { PatientsService } from './patients.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('patients')
export class PatientsController {
  constructor(private readonly patientsService: PatientsService) {}

  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.patientsService.create(user, body ?? {});
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('search') search?: string) {
    return this.patientsService.findAll(user, search);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.patientsService.findOne(user, id);
  }

  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.patientsService.update(user, id, body ?? {});
  }

  @Roles(UserRole.ADMIN, UserRole.RECEPTIONIST)
  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.patientsService.remove(user, id);
  }
}
