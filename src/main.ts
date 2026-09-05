import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { rateLimitMiddleware } from './common/rate-limit.middleware';
import { requestContextMiddleware } from './common/request-context.middleware';
import { SanitizedExceptionFilter } from './common/sanitized-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const express = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
    set?: (setting: string, value: unknown) => void;
    use?: (middleware: unknown) => void;
  };

  express.disable?.('x-powered-by');
  express.set?.('trust proxy', 1);

  const configuredOrigins = process.env.FRONTEND_URL
    ?.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction && !configuredOrigins?.length) {
    throw new Error('FRONTEND_URL must be configured in production');
  }

  // CORS must be registered before application middleware so OPTIONS
  // preflight requests receive the CORS headers before any middleware can
  // reject or otherwise short-circuit the request.
  app.enableCors({
    origin: configuredOrigins?.length ? configuredOrigins : true,
    credentials: true,
  });

  express.use?.(requestContextMiddleware());
  express.use?.(rateLimitMiddleware({ windowMs: 60_000, max: 120 }));

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidUnknownValues: false, transform: true }),
  );
  app.useGlobalFilters(new SanitizedExceptionFilter());
  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
