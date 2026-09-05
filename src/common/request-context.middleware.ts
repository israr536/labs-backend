import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

export function requestContextMiddleware() {
  return (request: Request, response: Response, next: NextFunction) => {
    const incoming = request.header(REQUEST_ID_HEADER)?.trim();
    const requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
    response.setHeader(REQUEST_ID_HEADER, requestId);
    (request as Request & { requestId?: string }).requestId = requestId;
    next();
  };
}
