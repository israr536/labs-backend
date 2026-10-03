import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async track(body: { sessionId?: unknown; event?: unknown; path?: unknown; metadata?: unknown }) {
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim().slice(0, 100) : '';
    const event = typeof body.event === 'string' ? body.event.trim().slice(0, 100) : '';
    if (!sessionId || !event) return { success: false };
    const path = typeof body.path === 'string' ? body.path.slice(0, 300) : undefined;
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;
    await this.prisma.funnelEvent.create({ data: { sessionId, event, path, metadata: metadata as any } });
    return { success: true };
  }

  async summary() {
    const events = await this.prisma.funnelEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 50000, select: { sessionId: true, event: true } });
    const unique = new Map<string, Set<string>>();
    for (const item of events) { if (!unique.has(item.event)) unique.set(item.event, new Set()); unique.get(item.event)!.add(item.sessionId); }
    return Object.fromEntries([...unique.entries()].map(([event, sessions]) => [event, sessions.size]));
  }
}
