import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class SanitizedExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SanitizedExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { requestId?: string }>();
    const response = context.getResponse<Response>();
    const requestId = request.requestId ?? request.header('x-request-id') ?? 'unknown';

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error(`Unhandled request error [${requestId}] ${request.method} ${request.originalUrl}`, exception instanceof Error ? exception.stack : undefined);
    }

    const httpResponse = exception instanceof HttpException ? exception.getResponse() : null;
    const message = status >= 500
      ? 'Internal server error'
      : this.extractClientMessage(httpResponse);

    response.status(status).json({
      statusCode: status,
      message,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private extractClientMessage(value: string | object | null): string | string[] {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return 'Request failed';
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' || (Array.isArray(message) && message.every((item) => typeof item === 'string'))) {
      return message as string | string[];
    }
    return 'Request failed';
  }
}
