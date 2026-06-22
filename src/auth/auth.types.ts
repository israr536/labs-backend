import { UserRole } from '@prisma/client';

export interface AuthUser {
  id: string;
  labId: string;
  username: string;
  role: UserRole;
}

export interface TokenPayload extends AuthUser {
  sub: string;
  type: 'access';
  iat: number;
  exp: number;
}
