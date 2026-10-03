import { BadRequestException } from '@nestjs/common';

const INDIA_LOCAL_PATTERN = /^\d{10}$/;
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

export function normalizePhoneNumber(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new BadRequestException('Mobile number is required');

  const compact = raw.replace(/[\s().-]/g, '');

  // Keep the current Indian signup experience: a 10-digit number is
  // interpreted as an Indian (+91) mobile number.
  if (INDIA_LOCAL_PATTERN.test(compact)) {
    return `+91${compact}`;
  }

  if (!E164_PATTERN.test(compact)) {
    throw new BadRequestException(
      'Enter a valid mobile number with country code, for example +1 415 555 2671',
    );
  }

  return compact;
}

export function phoneLookupVariants(value: unknown): string[] {
  const normalized = normalizePhoneNumber(value);
  if (!normalized.startsWith('+91')) return [normalized];

  const local = normalized.slice(3);
  return [normalized, `91${local}`, local];
}
