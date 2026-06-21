import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { AuthUser, TokenPayload } from './auth.types';

@Injectable()
export class TokenService {
  private readonly secret =
    process.env.ACCESS_TOKEN_SECRET ?? 'change-this-access-token-secret';
  private readonly accessTtlSeconds = Number(
    process.env.ACCESS_TOKEN_TTL ?? 900,
  );

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
    const [encodedHeader, encodedPayload, signature] = token.split('.');

    if (!encodedHeader || !encodedPayload || !signature) {
      throw new UnauthorizedException('Invalid token');
    }

    const expectedSignature = this.signature(
      `${encodedHeader}.${encodedPayload}`,
    );

    if (signature !== expectedSignature) {
      throw new UnauthorizedException('Invalid token');
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8'),
    ) as TokenPayload;

    if (
      payload.type !== 'access' ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      throw new UnauthorizedException('Token expired');
    }

    return payload;
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
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );

    return `${encodedHeader}.${encodedPayload}.${this.signature(
      `${encodedHeader}.${encodedPayload}`,
    )}`;
  }

  private signature(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }
}
