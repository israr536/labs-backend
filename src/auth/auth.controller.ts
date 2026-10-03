import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import type { AuthUser } from './auth.types';
import { PasswordResetService } from './password-reset.service';

const REFRESH_COOKIE = 'lab_refresh_token';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly passwordResetService: PasswordResetService) {}

  @Post('register-lab') registerLab(@Body() body: unknown) { return this.authService.registerLab(body ?? {}); }
  @Post('signup/request-otp') requestSignupOtp(@Body() body: unknown) { return this.authService.requestSignupOtp(body ?? {}); }
  @Post('signup/resend-otp') resendSignupOtp(@Body() body: unknown) { const requestId = body && typeof body === 'object' ? (body as { requestId?: unknown }).requestId : undefined; return this.authService.resendSignupOtp(requestId); }
  @Post('signup/verify-otp')
  async verifySignupOtp(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.verifySignupOtp(body ?? {});
    this.setRefreshCookie(response, result.refreshToken);
    return this.withoutRefreshToken(result);
  }

  @Post('forgot-password/request-otp') requestPasswordResetOtp(@Body() body: unknown) {
    const mobile = body && typeof body === 'object' ? (body as { mobile?: unknown }).mobile : undefined;
    return this.passwordResetService.requestOtp(mobile);
  }
  @Post('forgot-password/resend-otp') resendPasswordResetOtp(@Body() body: unknown) {
    const requestId = body && typeof body === 'object' ? (body as { requestId?: unknown }).requestId : undefined;
    return this.passwordResetService.resendOtp(requestId);
  }
  @Post('forgot-password/verify-otp') verifyPasswordResetOtp(@Body() body: unknown) {
    const value = body && typeof body === 'object' ? body as { requestId?: unknown; otp?: unknown } : {};
    return this.passwordResetService.verifyOtp(value.requestId, value.otp);
  }
  @Post('forgot-password/reset') resetPassword(@Body() body: unknown) {
    const value = body && typeof body === 'object' ? body as { requestId?: unknown; resetToken?: unknown; password?: unknown } : {};
    return this.passwordResetService.resetPassword(value.requestId, value.resetToken, value.password);
  }

  @Post('login')
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(body ?? {}); this.setRefreshCookie(response, result.refreshToken); return this.withoutRefreshToken(result);
  }
  @Post('refresh')
  async refresh(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = this.readRefreshCookie(request) ?? this.readBodyRefreshToken(body); const result = await this.authService.refresh({ refreshToken }); this.setRefreshCookie(response, result.refreshToken); return this.withoutRefreshToken(result);
  }
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = this.readRefreshCookie(request) ?? this.readBodyRefreshToken(body); if (refreshToken) await this.authService.logout({ refreshToken }); response.clearCookie(REFRESH_COOKIE, this.cookieOptions()); return { success: true };
  }
  @UseGuards(AuthGuard) @Get('me') me(@CurrentUser() user: AuthUser) { return this.authService.me(user.id); }

  private setRefreshCookie(response: Response, refreshToken: string) { const days = Number(process.env.REFRESH_TOKEN_DAYS ?? 365); response.cookie(REFRESH_COOKIE, refreshToken, { ...this.cookieOptions(), maxAge: days * 24 * 60 * 60 * 1000 }); }
  private cookieOptions() { const isProduction = process.env.NODE_ENV === 'production'; const sameSite = process.env.REFRESH_COOKIE_SAMESITE === 'none' ? 'none' : 'lax'; return { httpOnly: true, secure: isProduction || sameSite === 'none', sameSite: sameSite as 'lax' | 'none', path: '/auth' }; }
  private readRefreshCookie(request: Request) { const header = request.headers.cookie; if (!header) return undefined; const value = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${REFRESH_COOKIE}=`)); return value ? decodeURIComponent(value.slice(REFRESH_COOKIE.length + 1)) : undefined; }
  private readBodyRefreshToken(body: unknown) { if (!body || typeof body !== 'object') return undefined; const value = (body as { refreshToken?: unknown }).refreshToken; return typeof value === 'string' && value.trim() ? value : undefined; }
  private withoutRefreshToken<T extends { refreshToken: string }>(result: T) { const { refreshToken: _refreshToken, ...safeResult } = result; return safeResult; }
}
