import { Injectable, NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { optionalString, requiredString } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';

interface UpdateLabSettingsBody {
  name?: unknown;
  mobile?: unknown;
  email?: unknown;
  address?: unknown;
  icon?: unknown;
}

@Injectable()
export class LabsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(currentUser: AuthUser) {
    const lab = await this.prisma.lab.findUnique({
      where: { id: currentUser.labId },
      select: this.settingsSelect(),
    });

    if (!lab) {
      throw new NotFoundException('Lab not found');
    }

    return lab;
  }

  async updateSettings(currentUser: AuthUser, body: UpdateLabSettingsBody) {
    const lab = await this.prisma.lab.update({
      where: { id: currentUser.labId },
      data: {
        name: body.name ? requiredString(body.name, 'name') : undefined,
        mobile: body.mobile ? requiredString(body.mobile, 'mobile') : undefined,
        email: optionalString(body.email, 'email'),
        address: optionalString(body.address, 'address'),
        icon: optionalString(body.icon, 'icon'),
      },
      select: this.settingsSelect(),
    });

    return lab;
  }

  canManageSettings(currentUser: AuthUser): boolean {
    return currentUser.role === UserRole.ADMIN;
  }

  private settingsSelect() {
    return {
      id: true,
      code: true,
      name: true,
      mobile: true,
      email: true,
      address: true,
      icon: true,
      isActive: true,
      subscriptionPlan: true,
      subscriptionStartAt: true,
      subscriptionEndAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }
}
