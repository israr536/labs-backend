import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { RolesGuard } from './roles.guard';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    PasswordService,
    RolesGuard,
    TokenService,
  ],
  exports: [AuthGuard, AuthService, PasswordService, RolesGuard, TokenService],
})
export class AuthModule {}
