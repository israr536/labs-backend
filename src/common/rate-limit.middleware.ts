import type { NextFunction, Request, Response } from 'express';
import { HttpException, HttpStatus } from '@nestjs/common';

/** Lightweight single-instance safety net; use Redis/API-gateway limits when horizontally scaled. */
export function rateLimitMiddleware(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, { startedAt: number; count: number }>();
  return (request: Request, response: Response, next: NextFunction) => {
    const key = request.ip || request.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = buckets.get(key);
    if (!current || now - current.startedAt >= options.windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return next();
    }
    current.count += 1;
    if (current.count > options.max) {
      response.setHeader('Retry-After', Math.ceil((options.windowMs - (now - current.startedAt)) / 1000));
      throw new HttpException('Too many requests. Please retry shortly.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return next();
  };
}
