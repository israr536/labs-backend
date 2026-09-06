import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CriticalResultsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Critical intervals are laboratory-configured alert limits. This service
   * records the event and notification lifecycle; it does not invent clinical thresholds.
   */
  async listPending(labId: string) {
    const delegate = (this.prisma as any).criticalResult;
    if (!delegate) return [];
    return delegate.findMany({
      where: { labId, acknowledgedAt: null },
      orderBy: { detectedAt: 'asc' },
      take: 100,
    });
  }

  async acknowledge(labId: string, id: string, userId: string, note?: string) {
    const delegate = (this.prisma as any).criticalResult;
    if (!delegate) throw new BadRequestException('Critical-result storage is not configured');
    const record = await delegate.findFirst({ where: { id, labId } });
    if (!record) throw new NotFoundException('Critical result not found');
    if (record.acknowledgedAt) return record;
    return delegate.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId, acknowledgementNote: note?.trim() || null },
    });
  }

  async recordNotificationAttempt(
    labId: string,
    id: string,
    userId: string,
    data: { method: string; successful: boolean; recipient?: string; note?: string },
  ) {
    const delegate = (this.prisma as any).criticalResult;
    if (!delegate) throw new BadRequestException('Critical-result storage is not configured');
    const record = await delegate.findFirst({ where: { id, labId } });
    if (!record) throw new NotFoundException('Critical result not found');
    if (record.acknowledgedAt) throw new BadRequestException('Critical result is already acknowledged');

    const attempt = {
      attemptedAt: new Date(),
      attemptedById: userId,
      method: data.method,
      successful: data.successful,
      recipient: data.recipient || null,
      note: data.note?.trim() || null,
    };
    const attempts = Array.isArray(record.notificationAttempts) ? [...record.notificationAttempts, attempt] : [attempt];
    return delegate.update({
      where: { id },
      data: {
        notificationAttempts: attempts,
        lastNotifiedAt: data.successful ? attempt.attemptedAt : record.lastNotifiedAt,
        lastNotifiedById: data.successful ? userId : record.lastNotifiedById,
      },
    });
  }
}
