import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { User, UserRole } from '../../generated/prisma/client';
import {
  optionalDate,
  optionalString,
  requiredString,
} from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

interface RegisterLabBody {
  code?: unknown;
  name?: unknown;
  mobile?: unknown;
  email?: unknown;
  address?: unknown;
  subscriptionPlan?: unknown;
  subscriptionStartAt?: unknown;
  subscriptionEndAt?: unknown;
  admin?: {
    username?: unknown;
    mobile?: unknown;
    email?: unknown;
    password?: unknown;
  };
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

interface RefreshBody {
  refreshToken?: unknown;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  async registerLab(body: RegisterLabBody) {
    const admin = body.admin ?? {};
    const labName = requiredString(body.name, 'name');
    const labCode =
      optionalString(body.code, 'code') ?? this.createLabCode(labName);
    const adminUsername = requiredString(admin.username, 'admin.username');
    const adminPassword = requiredString(admin.password, 'admin.password');

    if (adminPassword.length < 6) {
      throw new ConflictException(
        'admin.password must be at least 6 characters',
      );
    }

    const existingLab = await this.prisma.lab.findUnique({
      where: { code: labCode },
    });
    const existingUser = await this.prisma.user.findUnique({
      where: { username: adminUsername },
    });

    if (existingLab) {
      throw new ConflictException('Lab code already exists');
    }

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const lab = await tx.lab.create({
        data: {
          code: labCode,
          name: labName,
          mobile: requiredString(body.mobile, 'mobile'),
          email: optionalString(body.email, 'email'),
          address: optionalString(body.address, 'address'),
          subscriptionPlan: optionalString(
            body.subscriptionPlan,
            'subscriptionPlan',
          ),
          subscriptionStartAt: optionalDate(
            body.subscriptionStartAt,
            'subscriptionStartAt',
          ),
          subscriptionEndAt: optionalDate(
            body.subscriptionEndAt,
            'subscriptionEndAt',
          ),
        },
      });

      const user = await tx.user.create({
        data: {
          labId: lab.id,
          username: adminUsername,
          mobile: requiredString(admin.mobile, 'admin.mobile'),
          email: optionalString(admin.email, 'admin.email'),
          password: this.passwordService.hash(adminPassword),
          role: UserRole.ADMIN,
        },
      });

      return { lab, user };
    });

    return {
      lab: result.lab,
      user: this.safeUser(result.user),
      ...(await this.createTokens(result.user)),
    };
  }

  async login(body: LoginBody) {
    const username = requiredString(body.username, 'username');
    const password = requiredString(body.password, 'password');
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { lab: true },
    });

    if (
      !user ||
      !user.isActive ||
      !user.lab.isActive ||
      !this.passwordService.verify(password, user.password)
    ) {
      throw new UnauthorizedException('Invalid username or password');
    }

    return {
      user: this.safeUser(user),
      lab: user.lab,
      ...(await this.createTokens(user)),
    };
  }

  async refresh(body: RefreshBody) {
    const refreshToken = requiredString(body.refreshToken, 'refreshToken');
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: hashedToken },
      include: { user: { include: { lab: true } } },
    });

    if (
      !storedToken ||
      storedToken.expiresAt.getTime() < Date.now() ||
      !storedToken.user.isActive ||
      !storedToken.user.lab.isActive
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    await this.prisma.refreshToken.delete({ where: { id: storedToken.id } });

    return {
      user: this.safeUser(storedToken.user),
      lab: storedToken.user.lab,
      ...(await this.createTokens(storedToken.user)),
    };
  }

  async logout(body: RefreshBody) {
    const refreshToken = requiredString(body.refreshToken, 'refreshToken');
    const hashedToken = this.tokenService.hashRefreshToken(refreshToken);

    await this.prisma.refreshToken.deleteMany({
      where: { token: hashedToken },
    });

    return { success: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { lab: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      user: this.safeUser(user),
      lab: user.lab,
    };
  }

  safeUser<T extends { password: string }>(user: T) {
    const safeUser = { ...user };
    delete (safeUser as { password?: string }).password;

    return safeUser;
  }

  private async createTokens(user: User) {
    const refreshToken = this.tokenService.createRefreshToken();
    const refreshTokenDays = Number(process.env.REFRESH_TOKEN_DAYS ?? 30);
    const expiresAt = new Date(
      Date.now() + refreshTokenDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: this.tokenService.hashRefreshToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken: this.tokenService.signAccessToken({
        id: user.id,
        labId: user.labId,
        username: user.username,
        role: user.role,
      }),
      refreshToken,
      expiresIn: Number(process.env.ACCESS_TOKEN_TTL ?? 900),
    };
  }

  private createLabCode(name: string): string {
    const base = name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 12);

    return `${base || 'LAB'}-${Date.now().toString(36).toUpperCase()}`;
  }
}
