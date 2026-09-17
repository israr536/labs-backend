import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const useSsl = process.env.DATABASE_SSL === 'true';
    const poolMax = Number(process.env.DB_POOL_MAX ?? 5);
    const connectionTimeoutMillis = Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? 5000);
    const idleTimeoutMillis = Number(process.env.DB_IDLE_TIMEOUT_MS ?? 30000);

    if (!connectionString) {
      throw new Error('DATABASE_URL is required');
    }

    super({
      adapter: new PrismaPg({
        connectionString,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: Number.isInteger(poolMax) && poolMax > 0 ? poolMax : 5,
        connectionTimeoutMillis:
          Number.isInteger(connectionTimeoutMillis) && connectionTimeoutMillis > 0
            ? connectionTimeoutMillis
            : 5000,
        idleTimeoutMillis:
          Number.isInteger(idleTimeoutMillis) && idleTimeoutMillis > 0
            ? idleTimeoutMillis
            : 30000,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
