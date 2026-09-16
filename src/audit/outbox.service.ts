import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AuditAction, OutboxStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AuditPayload = {
  actorId: string;
  action: AuditAction;
  entity: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
};

@Injectable()
export class OutboxService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    // Each instance may drain safely: claiming uses a conditional update.
    this.timer = setInterval(() => void this.drain(), 2000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  enqueue(db: Prisma.TransactionClient | PrismaService, labId: string, eventType: string, aggregateType: string, aggregateId: string, payload: AuditPayload) {
    return db.outboxEvent.create({
      data: { labId, eventType, aggregateType, aggregateId, payload: payload as unknown as Prisma.InputJsonValue },
    });
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      const event = await this.prisma.outboxEvent.findFirst({
        where: { status: OutboxStatus.PENDING, availableAt: { lte: new Date() } },
        orderBy: { createdAt: 'asc' },
      });
      if (!event) return;
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, status: OutboxStatus.PENDING },
        data: { status: OutboxStatus.PROCESSING, lockedAt: new Date(), attempts: { increment: 1 } },
      });
      if (claimed.count !== 1) return;
      try {
        const payload = event.payload as unknown as AuditPayload;
        await this.prisma.$transaction(async (tx) => {
          await tx.auditLog.create({
            data: {
              labId: event.labId,
              actorId: payload.actorId,
              action: payload.action,
              entity: payload.entity,
              entityId: payload.entityId,
              metadata: payload.metadata,
            },
          });
          await tx.outboxEvent.update({ where: { id: event.id }, data: { status: OutboxStatus.COMPLETED, processedAt: new Date(), lockedAt: null } });
        });
      } catch (error) {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: event.attempts >= 5 ? OutboxStatus.FAILED : OutboxStatus.PENDING, availableAt: new Date(Date.now() + Math.min(event.attempts * 5000, 60000)), lockedAt: null, lastError: error instanceof Error ? error.message.slice(0, 500) : 'Outbox processing failed' },
        });
      }
    } finally {
      this.draining = false;
    }
  }
}
