import { Injectable } from '@nestjs/common';
import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

@Injectable()
export class PasswordService {
  private readonly iterations = 100_000;
  private readonly keyLength = 64;
  private readonly digest = 'sha512';

  hash(password: string): string {
    const salt = randomBytes(16).toString('hex');
    const hash = pbkdf2Sync(
      password,
      salt,
      this.iterations,
      this.keyLength,
      this.digest,
    ).toString('hex');

    return `pbkdf2$${this.iterations}$${salt}$${hash}`;
  }

  verify(password: string, storedHash: string): boolean {
    const [algorithm, iterationsValue, salt, hash] = storedHash.split('$');

    if (algorithm !== 'pbkdf2' || !iterationsValue || !salt || !hash) {
      return false;
    }

    const candidate = pbkdf2Sync(
      password,
      salt,
      Number(iterationsValue),
      this.keyLength,
      this.digest,
    );
    const stored = Buffer.from(hash, 'hex');

    if (candidate.length !== stored.length) {
      return false;
    }

    return timingSafeEqual(candidate, stored);
  }
}
