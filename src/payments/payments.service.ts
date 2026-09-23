import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import Razorpay from 'razorpay';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService } from '../labs/subscription.service';

const PLAN_PRICES: Record<string, { amount: number; label: string; days: number }> = {
  MONTHLY: { amount: 29900, label: 'PathMLT Monthly', days: 30 },
  YEARLY: { amount: 249900, label: 'PathMLT Yearly', days: 365 },
};

@Injectable()
export class PaymentsService {
  private readonly razorpay: Razorpay;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionService: SubscriptionService,
  ) {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured');
    }
    this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  async createOrder(labId: string, userId: string, planValue: unknown) {
    const plan = this.normalizePlan(planValue);
    const config = PLAN_PRICES[plan];
    const receipt = `pathmlt_${labId.slice(0, 8)}_${Date.now()}`;
    const order = await this.razorpay.orders.create({
      amount: config.amount,
      currency: 'INR',
      receipt,
      notes: { labId, userId, plan },
    });

    await this.prisma.payment.create({
      data: {
        labId,
        userId,
        providerOrderId: order.id,
        amount: config.amount,
        currency: 'INR',
        plan,
        status: 'CREATED',
        notes: { receipt, label: config.label },
      },
    });

    return {
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: config.amount,
      currency: 'INR',
      plan,
      name: 'PathMLT',
      description: config.label,
      prefill: await this.getPrefill(userId),
    };
  }

  async verifyPayment(labId: string, userId: string, body: Record<string, unknown>) {
    const orderId = this.required(body.razorpay_order_id, 'razorpay_order_id');
    const paymentId = this.required(body.razorpay_payment_id, 'razorpay_payment_id');
    const signature = this.required(body.razorpay_signature, 'razorpay_signature');

    const expected = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET ?? '')
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (expected !== signature) throw new BadRequestException('Invalid Razorpay payment signature');

    const result = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{
        id: string;
        labId: string;
        userId: string;
        providerPaymentId: string | null;
        status: string;
        plan: string;
      }>>`
        SELECT "id", "labId", "userId", "providerPaymentId", "status", "plan"
        FROM "Payment"
        WHERE "providerOrderId" = ${orderId}
          AND "labId" = ${labId}
          AND "userId" = ${userId}
        FOR UPDATE
      `;

      const payment = locked[0];
      if (!payment) throw new UnauthorizedException('Payment order not found');

      if (
        payment.providerPaymentId &&
        (payment.status === 'VERIFIED' || payment.status === 'CAPTURED')
      ) {
        const lab = await tx.lab.findUnique({
          where: { id: labId },
          select: {
            subscriptionPlan: true,
            subscriptionStartAt: true,
            subscriptionEndAt: true,
          },
        });
        return {
          success: true,
          paymentId: payment.providerPaymentId,
          orderId,
          status: payment.status,
          plan: payment.plan,
          subscriptionStartAt: lab?.subscriptionStartAt ?? null,
          subscriptionEndAt: lab?.subscriptionEndAt ?? null,
          activated: false,
        };
      }

      if (payment.status !== 'CREATED') {
        throw new BadRequestException('Payment is not in a verifiable state');
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { providerPaymentId: paymentId, signature, status: 'VERIFIED' },
      });

      const subscription = await this.subscriptionService.activatePaidSubscription(
        labId,
        payment.plan,
        tx,
      );

      return {
        success: true,
        paymentId,
        orderId,
        status: 'VERIFIED',
        plan: subscription.plan,
        subscriptionStartAt: subscription.subscriptionStartAt,
        subscriptionEndAt: subscription.subscriptionEndAt,
        activated: true,
      };
    });

    this.subscriptionService.invalidateStatusCache(labId);
    return result;
  }

  async webhook(
    rawBody: Buffer,
    signature: string | undefined,
    providerEventId: string | undefined,
  ) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signature) {
      throw new BadRequestException('Missing Razorpay webhook signature');
    }

    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (expected !== signature) {
      throw new UnauthorizedException('Invalid Razorpay webhook signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      payload?: {
        payment?: {
          entity?: {
            id?: string;
            order_id?: string;
            status?: string;
          };
        };
      };
    };

    const eventId =
      providerEventId?.trim() ||
      createHash('sha256').update(rawBody).digest('hex');
    const eventType = payload.event ?? 'unknown';
    const entity = payload.payload?.payment?.entity;
    const orderId = entity?.order_id;

    try {
      await this.prisma.$transaction(async (tx) => {
      await tx.razorpayWebhookEvent.create({
        data: {
          providerEventId: eventId,
          eventType,
          payload: payload as object,
        },
      });

      if (!orderId) {
        return;
      }

      const status =
        payload.event === 'payment.captured' || entity?.status === 'captured'
          ? 'CAPTURED'
          : payload.event === 'payment.failed'
            ? 'FAILED'
            : undefined;

      if (!status) return;

      const payment = await tx.payment.findUnique({
        where: { providerOrderId: orderId },
      });
      if (!payment) return;

      if (status === 'FAILED') {
        if (payment.status !== 'CAPTURED' && payment.status !== 'VERIFIED') {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              providerPaymentId: entity?.id ?? payment.providerPaymentId,
              status: 'FAILED',
            },
          });
        }
        return;
      }

      if (payment.status === 'CAPTURED' || payment.status === 'VERIFIED') {
        return;
      }

      const captured = await tx.payment.updateMany({
        where: { id: payment.id, status: 'CREATED' },
        data: {
          providerPaymentId: entity?.id ?? payment.providerPaymentId,
          status: 'CAPTURED',
        },
      });
      if (captured.count !== 1) return;

      await this.subscriptionService.activatePaidSubscription(
        payment.labId,
        payment.plan,
        tx,
      );
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { received: true, duplicate: true };
      }
      throw error;
    }

    if (orderId) {
      const payment = await this.prisma.payment.findUnique({
        where: { providerOrderId: orderId },
        select: { labId: true },
      });
      if (payment) this.subscriptionService.invalidateStatusCache(payment.labId);
    }

    return { received: true };
  }

  private async getPrefill(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, mobile: true, username: true },
    });
    return {
      name: user?.username ?? 'PathMLT User',
      email: user?.email ?? undefined,
      contact: user?.mobile ?? undefined,
    };
  }

  private normalizePlan(value: unknown) {
    const plan = typeof value === 'string' ? value.toUpperCase() : '';
    if (!PLAN_PRICES[plan]) throw new BadRequestException('Invalid payment plan');
    return plan;
  }

  private required(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }
}