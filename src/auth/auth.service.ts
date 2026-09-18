import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User, UserRole } from '@prisma/client';
import { randomInt, randomUUID } from 'node:crypto';
import { optionalString, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { OtpDeliveryService } from './otp-delivery.service';
import { TokenService } from './token.service';

interface RegisterLabBody { code?: unknown; name?: unknown; mobile?: unknown; email?: unknown; address?: unknown; subscriptionPlan?: unknown; subscriptionStartAt?: unknown; subscriptionEndAt?: unknown; admin?: { mobile?: unknown; email?: unknown; password?: unknown } }
interface LoginBody { email?: unknown; password?: unknown }
interface RefreshBody { refreshToken?: unknown }
interface RequestSignupOtpBody extends RegisterLabBody {}
interface VerifySignupOtpBody { requestId?: unknown; otp?: unknown }
const MIN_PASSWORD_LENGTH = 8;
const TRIAL_DAYS = 14;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
    private readonly otpDelivery: OtpDeliveryService,
  ) {}

  async registerLab(_body: RegisterLabBody) { throw new GoneException('Direct lab registration is disabled. Use /auth/signup/request-otp and /auth/signup/verify-otp.'); }

  async requestSignupOtp(body: RequestSignupOtpBody) {
    const admin = body.admin ?? {};
    const labName = requiredString(body.name, 'name');
    const labCode = optionalString(body.code, 'code') ?? this.createLabCode(labName);
    const adminEmail = normalizeEmail(requiredString(admin.email, 'admin.email'));
    const adminPassword = requiredString(admin.password, 'admin.password');
    const adminMobile = requiredString(admin.mobile, 'admin.mobile');
    const labMobile = requiredString(body.mobile, 'mobile');
    this.validatePassword(adminPassword);
    const [existingLab, existingUser] = await Promise.all([
      this.prisma.lab.findUnique({ where: { code: labCode } }),
      this.prisma.user.findFirst({ where: { OR: [{ username: adminEmail }, { email: adminEmail }] } }),
    ]);
    if (existingLab) throw new ConflictException('Lab code already exists');
    if (existingUser) throw new ConflictException('Email already exists');

    await this.prisma.pendingLabRegistration.deleteMany({ where: { OR: [{ code: labCode }, { adminUsername: adminEmail }] } });
    const otp = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    const pending = await this.prisma.pendingLabRegistration.create({
      data: {
        code: labCode,
        name: labName,
        mobile: labMobile,
        email: optionalString(body.email, 'email'),
        address: optionalString(body.address, 'address'),
        adminUsername: adminEmail,
        adminMobile,
        adminEmail,
        adminPasswordHash: this.passwordService.hash(adminPassword),
        otpHash: this.passwordService.hash(otp),
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    });

    try {
      const delivery = await this.otpDelivery.sendSignupOtp(adminEmail, otp, expiresAt);
      return { requestId: pending.id, expiresAt: pending.expiresAt, delivery: delivery.mode, ...(process.env.NODE_ENV === 'production' ? {} : { devOtp: otp }) };
    } catch (error) {
      await this.prisma.pendingLabRegistration.delete({ where: { id: pending.id } }).catch(() => undefined);
      throw error;
    }
  }

  async resendSignupOtp(requestIdValue: unknown) {
    const requestId = requiredString(requestIdValue, 'requestId');
    const pending = await this.prisma.pendingLabRegistration.findUnique({ where: { id: requestId } });
    if (!pending) throw new BadRequestException('Signup request not found');
    if (pending.expiresAt.getTime() < Date.now()) {
      await this.prisma.pendingLabRegistration.delete({ where: { id: requestId } });
      throw new BadRequestException('Signup request expired. Please start signup again');
    }
    if (Date.now() - pending.updatedAt.getTime() < OTP_RESEND_COOLDOWN_MS) {
      throw new BadRequestException('Please wait before requesting another OTP');
    }
    const otp = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await this.prisma.pendingLabRegistration.update({ where: { id: pending.id }, data: { otpHash: this.passwordService.hash(otp), expiresAt, attempts: 0 } });
    try {
      const delivery = await this.otpDelivery.sendSignupOtp(pending.adminEmail ?? pending.adminUsername, otp, expiresAt);
      return { requestId: pending.id, expiresAt, delivery: delivery.mode, ...(process.env.NODE_ENV === 'production' ? {} : { devOtp: otp }) };
    } catch (error) {
      throw error;
    }
  }

  async verifySignupOtp(body: VerifySignupOtpBody) {
    const requestId = requiredString(body.requestId, 'requestId');
    const otp = requiredString(body.otp, 'otp');
    const pending = await this.prisma.pendingLabRegistration.findUnique({ where: { id: requestId } });
    if (!pending) throw new BadRequestException('Signup request not found');
    if (pending.expiresAt.getTime() < Date.now()) { await this.prisma.pendingLabRegistration.delete({ where: { id: requestId } }); throw new BadRequestException('OTP expired. Please request a new OTP'); }
    if (pending.attempts >= 5) { await this.prisma.pendingLabRegistration.delete({ where: { id: requestId } }); throw new BadRequestException('Too many OTP attempts. Please try again'); }
    if (!this.passwordService.verify(otp, pending.otpHash)) { await this.prisma.pendingLabRegistration.update({ where: { id: requestId }, data: { attempts: { increment: 1 } } }); throw new BadRequestException('Invalid OTP'); }
    const [existingLab, existingUser] = await Promise.all([
      this.prisma.lab.findUnique({ where: { code: pending.code } }),
      this.prisma.user.findFirst({ where: { OR: [{ username: pending.adminUsername }, { email: pending.adminEmail }] } }),
    ]);
    if (existingLab) throw new ConflictException('Lab code already exists');
    if (existingUser) throw new ConflictException('Email already exists');
    const result = await this.prisma.$transaction(async (tx) => {
      const trialStart = new Date();
      const trialEnd = new Date(trialStart.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
      const lab = await tx.lab.create({ data: { code: pending.code, name: pending.name, mobile: pending.mobile, email: pending.email, address: pending.address, subscriptionPlan: 'TRIAL', subscriptionStartAt: trialStart, subscriptionEndAt: trialEnd } });
      const user = await tx.user.create({ data: { labId: lab.id, username: pending.adminEmail ?? pending.adminUsername, mobile: pending.adminMobile, email: pending.adminEmail ?? pending.adminUsername, password: pending.adminPasswordHash, role: UserRole.ADMIN } });

      await tx.pendingLabRegistration.delete({ where: { id: pending.id } });
      return { lab, user };
    });
    return { success: true, lab: result.lab, user: this.safeUser(result.user), enabledTestCount: 0, message: `Signup completed. Your ${TRIAL_DAYS}-day trial is active. All active catalog tests are available by default; lab-specific copies are created only when needed.` };
  }

  async login(body: LoginBody) {
    const email = normalizeEmail(requiredString(body.email, 'email'));
    const password = requiredString(body.password, 'password');
    const user = await this.prisma.user.findFirst({ where: { OR: [{ username: email }, { email }] }, include: { lab: true } });
    if (!user || !user.isActive || !user.lab.isActive || !this.passwordService.verify(password, user.password)) throw new UnauthorizedException('Invalid email or password');
    return { user: this.safeUser(user), lab: user.lab, ...(await this.createTokens(user)) };
  }

  async refresh(body: RefreshBody) {
    const refreshToken = requiredString(body.refreshToken, 'refreshToken');
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({ where: { token: hashedToken }, include: { user: { include: { lab: true } } } });
    if (!storedToken || storedToken.expiresAt.getTime() < Date.now() || !storedToken.user.isActive || !storedToken.user.lab.isActive) throw new UnauthorizedException('Invalid refresh token');
    if (storedToken.revokedAt || storedToken.usedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: storedToken.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    const nextRefreshToken = this.tokenService.createRefreshToken();
    const refreshTokenDays = this.getRefreshTokenDays();
    const expiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);
    try {
      await this.prisma.$transaction(async (tx) => {
        const consumed = await tx.refreshToken.updateMany({ where: { id: storedToken.id, token: hashedToken, usedAt: null, revokedAt: null }, data: { usedAt: new Date() } });
        if (consumed.count !== 1) {
          await tx.refreshToken.updateMany({ where: { familyId: storedToken.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
          throw new UnauthorizedException('Refresh token reuse detected');
        }
        await tx.refreshToken.create({ data: { userId: storedToken.userId, token: this.tokenService.hashRefreshToken(nextRefreshToken), familyId: storedToken.familyId, expiresAt } });
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Unable to rotate refresh token');
    }
    return { user: this.safeUser(storedToken.user), lab: storedToken.user.lab, accessToken: this.tokenService.signAccessToken({ id: storedToken.user.id, labId: storedToken.user.labId, username: storedToken.user.username, role: storedToken.user.role }), refreshToken: nextRefreshToken, expiresIn: Number(process.env.ACCESS_TOKEN_TTL ?? 900) };
  }

  async logout(body: RefreshBody) {
    const refreshToken = requiredString(body.refreshToken, 'refreshToken');
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken);
    const token = await this.prisma.refreshToken.findUnique({ where: { token: hashedToken }, select: { familyId: true, userId: true, user: { select: { labId: true } } } });
    if (token) {
      const logoutAt = new Date();
      await this.prisma.$transaction(async (tx) => {
        await tx.refreshToken.updateMany({ where: { familyId: token.familyId, revokedAt: null }, data: { revokedAt: logoutAt } });
        await tx.auditLog.create({
          data: {
            labId: token.user.labId,
            actorId: token.userId,
            action: 'LOGOUT',
            entity: 'User',
            entityId: token.userId,
            metadata: { logoutAt: logoutAt.toISOString() },
          },
        });
      });
    }
    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { lab: true } });
    if (!user || !user.isActive || !user.lab.isActive) throw new UnauthorizedException('User account is inactive');
    return { user: this.safeUser(user), lab: user.lab };
  }

  safeUser<T extends { password: string }>(user: T) { const safeUser = { ...user }; delete (safeUser as { password?: string }).password; return safeUser; }

  private async createTokens(user: User) {
    const refreshToken = this.tokenService.createRefreshToken();
    const refreshTokenDays = this.getRefreshTokenDays();
    const expiresAt = new Date(Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({ data: { userId: user.id, token: this.tokenService.hashRefreshToken(refreshToken), familyId: randomUUID(), expiresAt } });
    return { accessToken: this.tokenService.signAccessToken({ id: user.id, labId: user.labId, username: user.username, role: user.role }), refreshToken, expiresIn: Number(process.env.ACCESS_TOKEN_TTL ?? 21600) };
  }

  private getRefreshTokenDays(): number {
    const refreshTokenDays = Number(process.env.REFRESH_TOKEN_DAYS ?? 365);
    if (!Number.isInteger(refreshTokenDays) || refreshTokenDays < 1 || refreshTokenDays > 365) throw new Error('REFRESH_TOKEN_DAYS must be an integer between 1 and 365');
    return refreshTokenDays;
  }

  private validatePassword(password: string) { if (password.length < MIN_PASSWORD_LENGTH) throw new ConflictException(`password must be at least ${MIN_PASSWORD_LENGTH} characters`); }
  private createLabCode(name: string): string { const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 12); return `${base || 'LAB'}-${Date.now().toString(36).toUpperCase()}`; }
}

function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
