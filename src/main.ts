import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const express = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
  };

  // Do not advertise the underlying Express implementation.
  express.disable?.('x-powered-by');

  const configuredOrigins = process.env.FRONTEND_URL
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !configuredOrigins?.length) {
    throw new Error('FRONTEND_URL must be configured in production');
  }

  app.enableCors({
    origin: configuredOrigins?.length ? configuredOrigins : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidUnknownValues: false,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port');
  }

  await app.listen(port, '0.0.0.0');
}

void bootstrap();
