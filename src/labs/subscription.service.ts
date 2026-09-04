import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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

  async assertWithinLimit(labId: string, resource: UsageResource, additional = 1) {
    const lab = await this.prisma.lab.findUnique({
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

    // Existing labs without subscription metadata remain compatible until migrated to a plan.
    if (!lab.subscriptionPlan) return;

    const plan = this.normalizePlan(lab.subscriptionPlan);
    const limitKey = `max${resource[0].toUpperCase()}${resource.slice(1)}` as keyof typeof SUBSCRIPTION_PLANS[SubscriptionPlan];
    const limit = SUBSCRIPTION_PLANS[plan][limitKey] as number | null;
    if (limit === null) return;

    const usage = await this.getUsage(labId);
    if (usage[resource] + additional > limit) {
      throw new ForbiddenException(`${resource} limit reached for the ${SUBSCRIPTION_PLANS[plan].name} plan`);
    }
  }

  private async getUsage(labId: string) {
    const [users, patients, tests, orders] = await Promise.all([
      this.prisma.user.count({ where: { labId, isActive: true } }),
      this.prisma.patient.count({ where: { labId } }),
      this.prisma.test.count({ where: { labId } }),
      this.prisma.labOrder.count({ where: { labId } }),
    ]);
    return { users, patients, tests, orders };
  }

  private normalizePlan(value: string | null): SubscriptionPlan {
    if (value && value in SUBSCRIPTION_PLANS) return value as SubscriptionPlan;
    return 'FREE';
  }
}
