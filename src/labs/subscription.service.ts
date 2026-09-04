import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const SUBSCRIPTION_PLANS = {
  TRIAL: { name: 'Trial', maxUsers: 3, maxPatients: 100, maxTests: 50, maxOrders: 250 },
  FREE: { name: 'Free', maxUsers: 2, maxPatients: 100, maxTests: 25, maxOrders: 100 },
  STARTER: { name: 'Starter', maxUsers: 5, maxPatients: 5000, maxTests: 500, maxOrders: 10000 },
  PROFESSIONAL: { name: 'Professional', maxUsers: 15, maxPatients: 25000, maxTests: 2000, maxOrders: 50000 },
  ENTERPRISE: { name: 'Enterprise', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;
export type UsageResource = 'users' | 'patients' | 'tests' | 'orders';
type PrismaTransaction = Prisma.TransactionClient;
type PrismaLike = PrismaService | PrismaTransaction;

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(labId: string) {
    const lab = await this.prisma.lab.findUnique({
      where: { id: labId },
      select: { id: true, subscriptionPlan: true, subscriptionStartAt: true, subscriptionEndAt: true },
    });
    if (!lab) throw new NotFoundException('Lab not found');

    const plan = this.normalizePlan(lab.subscriptionPlan);
    const now = Date.now();
    const startsAt = lab.subscriptionStartAt?.getTime();
    const endsAt = lab.subscriptionEndAt?.getTime();
    const status = startsAt && startsAt > now ? 'scheduled' : endsAt && endsAt <= now ? 'expired' : 'active';

    return {
      plan,
      planName: SUBSCRIPTION_PLANS[plan].name,
      status,
      startsAt: lab.subscriptionStartAt,
      endsAt: lab.subscriptionEndAt,
      limits: SUBSCRIPTION_PLANS[plan],
      usage: await this.getUsage(labId),
    };
  }

  async assertWithinLimit(labId: string, resource: UsageResource, additional = 1, db: PrismaLike = this.prisma) {
    const lab = await db.lab.findUnique({
      where: { id: labId },
      select: { subscriptionPlan: true, subscriptionStartAt: true, subscriptionEndAt: true },
    });
    if (!lab) throw new NotFoundException('Lab not found');

    const now = Date.now();
    if (lab.subscriptionStartAt && lab.subscriptionStartAt.getTime() > now) {
      throw new ForbiddenException('Subscription has not started yet');
    }
    if (lab.subscriptionEndAt && lab.subscriptionEndAt.getTime() <= now) {
      throw new ForbiddenException('Subscription has expired');
    }
    if (!lab.subscriptionPlan) return;

    const plan = this.normalizePlan(lab.subscriptionPlan);
    const limitKey = `max${resource[0].toUpperCase()}${resource.slice(1)}` as keyof typeof SUBSCRIPTION_PLANS[SubscriptionPlan];
    const limit = SUBSCRIPTION_PLANS[plan][limitKey] as number | null;
    if (limit === null) return;

    const usage = await this.getUsage(labId, db);
    if (usage[resource] + additional > limit) {
      throw new ForbiddenException(`${resource} limit reached for the ${SUBSCRIPTION_PLANS[plan].name} plan`);
    }
  }

  /**
   * Acquire a PostgreSQL transaction advisory lock for this lab/resource.
   * Call this inside the same transaction that creates the resource. This
   * serializes concurrent creates for the same subscription counter without
   * adding a usage-counter table or changing the Prisma schema.
   */
  async lockLimit(db: PrismaTransaction, labId: string, resource: UsageResource) {
    const lockKey = `${labId}:${resource}`;
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  private async getUsage(labId: string, db: PrismaLike = this.prisma) {
    const [users, patients, tests, orders] = await Promise.all([
      db.user.count({ where: { labId, isActive: true } }),
      db.patient.count({ where: { labId } }),
      db.test.count({ where: { labId } }),
      db.labOrder.count({ where: { labId } }),
    ]);
    return { users, patients, tests, orders };
  }

  private normalizePlan(value: string | null): SubscriptionPlan {
    if (value && value in SUBSCRIPTION_PLANS) return value as SubscriptionPlan;
    return 'FREE';
  }
}
