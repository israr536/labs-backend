import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.types';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register-lab')
  registerLab(@Body() body: unknown) {
    return this.authService.registerLab(body ?? {});
  }

  @Post('login')
  login(@Body() body: unknown) {
    return this.authService.login(body ?? {});
  }

  @Post('refresh')
  refresh(@Body() body: unknown) {
    return this.authService.refresh(body ?? {});
  }

  @Post('logout')
  logout(@Body() body: unknown) {
    return this.authService.logout(body ?? {});
  }

  @UseGuards(AuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.me(user.id);
  }
}
