import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { LabsService } from './labs.service';

@UseGuards(AuthGuard, RolesGuard)
@Controller('lab')
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.labsService.getSettings(user);
  }

  @Roles(UserRole.ADMIN)
  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.labsService.updateSettings(user, body ?? {});
  }
}
