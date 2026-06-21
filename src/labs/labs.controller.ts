import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { LabsService } from './labs.service';

@UseGuards(AuthGuard)
@Controller('lab')
export class LabsController {
  constructor(private readonly labsService: LabsService) {}

  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.labsService.getSettings(user);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    if (!this.labsService.canManageSettings(user)) {
      throw new ForbiddenException('Only admins can update lab settings');
    }

    return this.labsService.updateSettings(user, body ?? {});
  }
}
