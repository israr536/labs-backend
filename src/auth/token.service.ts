import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AuthUser, TokenPayload } from './auth.types';

@Injectable()
export class TokenService {
  private readonly secret: string;
  private readonly accessTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL ?? 900);

  constructor() {
    const secret = process.env.ACCESS_TOKEN_SECRET;
    if (!secret || secret.length < 32) {
      throw new Error('ACCESS_TOKEN_SECRET must be configured and at least 32 characters long');
    }
    this.secret = secret;

    if (!Number.isInteger(this.accessTtlSeconds) || this.accessTtlSeconds <= 0) {
      throw new Error('ACCESS_TOKEN_TTL must be a positive integer');
    }
  }

  signAccessToken(user: AuthUser): string {
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = {
      ...user,
      sub: user.id,
      type: 'access',
      iat: now,
      exp: now + this.accessTtlSeconds,
    };

    return this.sign(payload);
  }

  verifyAccessToken(token: string): TokenPayload {
    try {
      const [encodedHeader, encodedPayload, signature] = token.split('.');
      if (!encodedHeader || !encodedPayload || !signature) {
        throw new Error('malformed');
      }

      const signingInput = `${encodedHeader}.${encodedPayload}`;
      const expectedSignature = this.signature(signingInput);
      const actual = Buffer.from(signature, 'base64url');
      const expected = Buffer.from(expectedSignature, 'base64url');

      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        throw new Error('signature');
      }

      const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as {
        alg?: string;
        typ?: string;
      };
      const payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as TokenPayload;

      const now = Math.floor(Date.now() / 1000);
      if (
        header.alg !== 'HS256' ||
        header.typ !== 'JWT' ||
        payload.type !== 'access' ||
        typeof payload.id !== 'string' ||
        typeof payload.labId !== 'string' ||
        typeof payload.role !== 'string' ||
        !Number.isFinite(payload.exp) ||
        payload.exp <= now
      ) {
        throw new Error('payload');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  createRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  private sign(payload: TokenPayload): string {
    const encodedHeader = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
    ).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

    return `${encodedHeader}.${encodedPayload}.${this.signature(`${encodedHeader}.${encodedPayload}`)}`;
  }

  private signature(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }
}
