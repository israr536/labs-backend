import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client';
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
  username?: unknown;
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

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly passwordService: PasswordService,
  ) {}

  async create(currentUser: AuthUser, body: CreateUserBody) {
    const username = requiredString(body.username, 'username');
    const existingUser = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existingUser) {
      throw new ConflictException('Username already exists');
    }

    const password = requiredString(body.password, 'password');

    if (password.length < 6) {
      throw new ConflictException('password must be at least 6 characters');
    }

    const user = await this.prisma.user.create({
      data: {
        labId: currentUser.labId,
        username,
        mobile: requiredString(body.mobile, 'mobile'),
        email: optionalString(body.email, 'email'),
        password: this.passwordService.hash(password),
        role: enumValue(UserRole, body.role, 'role'),
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
    await this.findOne(currentUser, id);

    const password = optionalString(body.password, 'password');
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        mobile: optionalString(body.mobile, 'mobile'),
        email: optionalString(body.email, 'email'),
        password: password ? this.passwordService.hash(password) : undefined,
        role: body.role ? enumValue(UserRole, body.role, 'role') : undefined,
        isActive: optionalBoolean(body.isActive, 'isActive'),
      },
    });

    return this.authService.safeUser(user);
  }
}
