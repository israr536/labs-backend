import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';

@Injectable()
export class PerformanceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ method: string; originalUrl?: string; headers: Record<string, string | undefined> }>();
    const response = context.switchToHttp().getResponse<{ setHeader: (name: string, value: string) => void; getHeader: (name: string) => unknown; statusCode: number }>();
    const requestId = request.headers['x-request-id'] ?? randomUUID();
    const started = process.hrtime.bigint();
    response.setHeader('x-request-id', requestId);
    return next.handle().pipe(tap(() => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const contentLength = response.getHeader('content-length');
      console.info(JSON.stringify({ type: 'http.performance', requestId, method: request.method, path: request.originalUrl, status: response.statusCode, durationMs: Math.round(durationMs * 100) / 100, responseBytes: contentLength ? Number(contentLength) : undefined }));
    }));
  }
}
