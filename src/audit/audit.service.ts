import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    currentUser: AuthUser,
    action: AuditAction,
    entity: string,
    entityId?: string,
    metadata?: Prisma.InputJsonValue,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    return db.auditLog.create({
      data: { labId: currentUser.labId, actorId: currentUser.id, action, entity, entityId, metadata },
    });
  }

  async list(currentUser: AuthUser, params: { entity?: string; entityId?: string; limit?: number; offset?: number } = {}) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);
    return this.prisma.auditLog.findMany({
      where: { labId: currentUser.labId, ...(params.entity ? { entity: params.entity } : {}), ...(params.entityId ? { entityId: params.entityId } : {}) },
      include: { actor: { select: { id: true, username: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    });
  }
}