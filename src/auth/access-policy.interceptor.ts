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
 * The subscription status endpoint remains available after expiry so the
 * frontend can explain the state and provide a renewal path.
 */
@Injectable()
export class AccessPolicyInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{ user?: AuthUser; path?: string }>();
    const user = request.user;
    if (!user) return next.handle();

    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        isActive: true,
        lab: {
          select: {
            isActive: true,
            subscriptionStartAt: true,
            subscriptionEndAt: true,
          },
        },
      },
    });

    if (!account?.isActive || !account.lab.isActive) {
      throw new UnauthorizedException('Account or laboratory is inactive');
    }

    // Allow the status endpoint through so expired users can still see their
    // plan state and reach the future billing/renewal flow.
    if (request.path?.endsWith('/subscription/status')) return next.handle();

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
