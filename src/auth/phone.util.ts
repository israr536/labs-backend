import { BadRequestException } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhoneNumber(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new BadRequestException('Mobile number is required');

  const compact = raw.replace(/[\s().-]/g, '');

  // No country selector is required:
  // - A bare 10-digit number is always treated as an Indian (+91) number.
  // - Every non-Indian number must include its +country calling code.
  const phone = /^\d{10}$/.test(compact)
    ? parsePhoneNumberFromString(compact, 'IN')
    : compact.startsWith('+')
      ? parsePhoneNumberFromString(compact)
      : undefined;

  if (!phone || !phone.isValid()) {
    throw new BadRequestException(
      'Enter a valid mobile number. India requires 10 digits; numbers from other countries must include the +country code.',
    );
  }

  return phone.number;
}

export function phoneLookupVariants(value: unknown): string[] {
  const normalized = normalizePhoneNumber(value);
  if (!normalized.startsWith('+91')) return [normalized];

  const local = normalized.slice(3);
  return [normalized, `91${local}`, local];
}
