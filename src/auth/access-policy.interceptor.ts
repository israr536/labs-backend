import {
  ForbiddenException,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';

/**
 * Runs after authentication guards and protects every authenticated route.
 * This keeps account/subscription enforcement centralized instead of relying
 * on individual controllers to remember to apply a billing guard.
 */
@Injectable()
export class AccessPolicyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;

    // Public endpoints (login, signup, refresh, etc.) have no authenticated user.
    if (!user) return next.handle();

    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        isActive: true,
        lab: {
          select: {
            isActive: true,
            subscriptionPlan: true,
            subscriptionStartAt: true,
            subscriptionEndAt: true,
          },
        },
      },
    });

    if (!account?.isActive || !account.lab.isActive) {
      throw new UnauthorizedException('Account or laboratory is inactive');
    }

    const now = Date.now();
    const startAt = account.lab.subscriptionStartAt?.getTime();
    const endAt = account.lab.subscriptionEndAt?.getTime();

    if (startAt !== undefined && startAt > now) {
      throw new ForbiddenException('Your subscription has not started yet');
    }

    if (endAt !== undefined && endAt <= now) {
      throw new ForbiddenException('Your subscription has expired. Please renew your plan');
    }

    return next.handle();
  }
}
