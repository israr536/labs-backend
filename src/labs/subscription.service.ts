import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const SUBSCRIPTION_PLANS = {
  TRIAL: { name: 'Free Trial', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
  FREE: { name: 'Free Trial', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
  MONTHLY: { name: 'Monthly', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
  YEARLY: { name: 'Yearly', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
  STARTER: { name: 'Monthly', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
  PROFESSIONAL: { name: 'Yearly', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
  ENTERPRISE: { name: 'Yearly', maxUsers: null, maxPatients: null, maxTests: null, maxOrders: null },
} as const;

export type SubscriptionPlan = keyof typeof SUBSCRIPTION_PLANS;
export type UsageResource = 'users' | 'patients' | 'tests' | 'orders';
type PrismaTransaction = Prisma.TransactionClient;
type PrismaLike = PrismaService | PrismaTransaction;

@Injectable()
export class SubscriptionService {
  private readonly statusCache = new Map<string, { expiresAt: number; value: Awaited<ReturnType<SubscriptionService['loadStatus']>> }>();
  constructor(private readonly prisma: PrismaService) {}

  async getStatus(labId: string) {
    const cached = this.statusCache.get(labId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = await this.loadStatus(labId);
    this.statusCache.set(labId, { value, expiresAt: Date.now() + 15_000 });
    return value;
  }

  private async loadStatus(labId: string) {
    const lab = await this.prisma.lab.findUnique({ where: { id: labId }, select: { id: true, subscriptionPlan: true, subscriptionStartAt: true, subscriptionEndAt: true } });
    if (!lab) throw new NotFoundException('Lab not found');
    const plan = this.normalizePlan(lab.subscriptionPlan);
    const status = 'active' as const;
    return { plan, planName: SUBSCRIPTION_PLANS[plan].name, status, startsAt: lab.subscriptionStartAt, endsAt: lab.subscriptionEndAt, limits: SUBSCRIPTION_PLANS[plan], usage: await this.getUsage(labId) };
  }

  async assertWithinLimit(labId: string, resource: UsageResource, additional = 1, db: PrismaLike = this.prisma) {
    const lab = await db.lab.findUnique({ where: { id: labId }, select: { subscriptionPlan: true, subscriptionStartAt: true, subscriptionEndAt: true } });
    if (!lab) throw new NotFoundException('Lab not found');
    if (!lab.subscriptionPlan) return;
    const plan = this.normalizePlan(lab.subscriptionPlan);
    const limit = this.getLimit(plan, resource);
    if (limit === null) return;
    const usage = await this.getUsage(labId, db);
    if (usage[resource] + additional > limit) throw new ForbiddenException(`${resource} limit reached for the ${SUBSCRIPTION_PLANS[plan].name} plan`);
  }

  /** Hot-path order check: advisory lock, subscription data, and order count in one PostgreSQL round trip. */
  async lockAndAssertCanCreateOrder(db: PrismaTransaction, labId: string) {
    const result = await db.$queryRaw<Array<{ locked: boolean; subscriptionPlan: string | null; subscriptionStartAt: Date | null; subscriptionEndAt: Date | null; usage: bigint }>>`
      SELECT
        pg_try_advisory_xact_lock(hashtext(${`${labId}:orders`})) AS locked,
        l."subscriptionPlan" AS "subscriptionPlan",
        l."subscriptionStartAt" AS "subscriptionStartAt",
        l."subscriptionEndAt" AS "subscriptionEndAt",
        (SELECT COUNT(*) FROM "LabOrder" o WHERE o."labId" = ${labId}) AS usage
      FROM "Lab" l
      WHERE l.id = ${labId}
      LIMIT 1
    `;
    const row = result[0];
    if (!row) throw new NotFoundException('Lab not found');
    if (!row.locked) throw new ConflictException('Another report is being created for this laboratory. Please retry.');
    if (!row.subscriptionPlan) return;
    const plan = this.normalizePlan(row.subscriptionPlan);
    const limit = SUBSCRIPTION_PLANS[plan].maxOrders;
    if (limit !== null && Number(row.usage) + 1 > limit) throw new ForbiddenException(`orders limit reached for the ${SUBSCRIPTION_PLANS[plan].name} plan`);
  }

  async assertCanCreateOrder(labId: string, db: PrismaLike = this.prisma) {
    const lab = await db.lab.findUnique({ where: { id: labId }, select: { subscriptionPlan: true, subscriptionStartAt: true, subscriptionEndAt: true } });
    if (!lab) throw new NotFoundException('Lab not found');
    if (!lab.subscriptionPlan) return;
    const plan = this.normalizePlan(lab.subscriptionPlan);
    const limit = SUBSCRIPTION_PLANS[plan].maxOrders;
    if (limit === null) return;
    const usage = await db.labOrder.count({ where: { labId } });
    if (usage + 1 > limit) throw new ForbiddenException(`orders limit reached for the ${SUBSCRIPTION_PLANS[plan].name} plan`);
  }

  async lockLimit(db: PrismaTransaction, labId: string, resource: UsageResource) {
    const lockKey = `${labId}:${resource}`;
    const result = await db.$queryRaw<Array<{ locked: boolean }>>`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS locked`;
    if (!result[0]?.locked) throw new ConflictException('Another report is being created for this laboratory. Please retry.');
  }

  private async getUsage(labId: string, db: PrismaLike = this.prisma) {
    const [users, patients, tests, orders] = await Promise.all([
      db.user.count({ where: { labId, isActive: true } }),
      db.patient.count({ where: { labId } }),
      db.test.count({ where: { labId, scopeId: labId } }),
      db.labOrder.count({ where: { labId } }),
    ]);
    return { users, patients, tests, orders };
  }

  private getLimit(plan: SubscriptionPlan, resource: UsageResource) {
    const limitKey = `max${resource[0].toUpperCase()}${resource.slice(1)}` as keyof typeof SUBSCRIPTION_PLANS[SubscriptionPlan];
    return SUBSCRIPTION_PLANS[plan][limitKey] as number | null;
  }

  private normalizePlan(value: string | null): SubscriptionPlan {
    if (value && value in SUBSCRIPTION_PLANS) return value as SubscriptionPlan;
    return 'FREE';
  }
}
