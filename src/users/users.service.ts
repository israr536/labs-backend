import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  enumValue,
  optionalBoolean,
  optionalString,
  requiredString,
} from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { AuthUser } from '../auth/auth.types';

interface CreateUserBody {
  mobile?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  isActive?: unknown;
}

interface UpdateUserBody {
  mobile?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  isActive?: unknown;
}

const MIN_PASSWORD_LENGTH = 8;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
  ) {}

  async create(currentUser: AuthUser, body: CreateUserBody) {
    const email = normalizeEmail(requiredString(body.email, 'email'));
    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: email },
          { email },
        ],
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const password = requiredString(body.password, 'password');
    this.validatePassword(password);

    const role = enumValue(UserRole, body.role, 'role');
    const user = await this.prisma.user.create({
      data: {
        labId: currentUser.labId,
        username: email,
        mobile: requiredString(body.mobile, 'mobile'),
        email,
        password: this.passwordService.hash(password),
        role,
        isActive: optionalBoolean(body.isActive, 'isActive') ?? true,
      },
    });

    return this.authService.safeUser(user);
  }

  async findAll(currentUser: AuthUser) {
    const users = await this.prisma.user.findMany({
      where: { labId: currentUser.labId },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.authService.safeUser(user));
  }

  async findOne(currentUser: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, labId: currentUser.labId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.authService.safeUser(user);
  }

  async update(currentUser: AuthUser, id: string, body: UpdateUserBody) {
    const existing = await this.prisma.user.findFirst({
      where: { id, labId: currentUser.labId },
    });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    const nextRole = body.role === undefined
      ? existing.role
      : enumValue(UserRole, body.role, 'role');
    const nextActive = body.isActive === undefined
      ? existing.isActive
      : optionalBoolean(body.isActive, 'isActive');

    // An administrator must not be able to accidentally lock themselves out
    // or remove the final active administrator of a tenant.
    if (existing.id === currentUser.id && (nextRole !== UserRole.ADMIN || nextActive === false)) {
      throw new ConflictException('You cannot deactivate or remove your own administrator access');
    }

    if (existing.role === UserRole.ADMIN &&
        (nextRole !== UserRole.ADMIN || nextActive === false)) {
      const activeAdminCount = await this.prisma.user.count({
        where: {
          labId: currentUser.labId,
          role: UserRole.ADMIN,
          isActive: true,
          id: { not: existing.id },
        },
      });
      if (activeAdminCount === 0) {
        throw new ConflictException('The lab must have at least one active administrator');
      }
    }

    const nextEmail = body.email === undefined
      ? existing.email
      : normalizeEmail(optionalString(body.email, 'email') ?? '');

    if (!nextEmail) {
      throw new ConflictException('email cannot be empty');
    }

    if (nextEmail !== existing.email || nextEmail !== existing.username) {
      const duplicate = await this.prisma.user.findFirst({
        where: {
          id: { not: id },
          OR: [
            { username: nextEmail },
            { email: nextEmail },
          ],
        },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('Email already exists');
    }

    const password = body.password === undefined
      ? undefined
      : optionalString(body.password, 'password');
    if (password) this.validatePassword(password);

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        // username is the login identifier in the current data model, so it
        // must move together with email when an administrator changes it.
        username: nextEmail,
        email: nextEmail,
        mobile: body.mobile === undefined ? undefined : optionalString(body.mobile, 'mobile'),
        password: password ? this.passwordService.hash(password) : undefined,
        role: nextRole,
        isActive: nextActive,
      },
    });

    return this.authService.safeUser(user);
  }

  async remove(currentUser: AuthUser, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, labId: currentUser.labId },
    });

    if (!user) throw new NotFoundException('User not found');
    if (user.id === currentUser.id) {
      throw new ConflictException('Cannot delete your own user account');
    }

    if (user.role === UserRole.ADMIN && user.isActive) {
      const activeAdminCount = await this.prisma.user.count({
        where: {
          labId: currentUser.labId,
          role: UserRole.ADMIN,
          isActive: true,
          id: { not: id },
        },
      });
      if (activeAdminCount === 0) {
        throw new ConflictException('The lab must have at least one active administrator');
      }
    }

    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }

  private validatePassword(password: string) {
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ConflictException(
        `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
  }
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
