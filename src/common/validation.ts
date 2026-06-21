import { BadRequestException } from '@nestjs/common';

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

export function optionalString(
  value: unknown,
  field: string,
): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }

  return value.trim();
}

export function optionalBoolean(
  value: unknown,
  field: string,
): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} must be a boolean`);
  }

  return value;
}

export function optionalNumber(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new BadRequestException(`${field} must be a number`);
  }

  return numberValue;
}

export function optionalInteger(
  value: unknown,
  field: string,
): number | undefined {
  const numberValue = optionalNumber(value, field);

  if (numberValue === undefined) {
    return undefined;
  }

  if (!Number.isInteger(numberValue)) {
    throw new BadRequestException(`${field} must be an integer`);
  }

  return numberValue;
}

export function optionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be an ISO date string`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be a valid date`);
  }

  return date;
}

export function enumValue<T extends Record<string, string>>(
  enumObject: T,
  value: unknown,
  field: string,
): T[keyof T] {
  if (typeof value !== 'string' || !Object.values(enumObject).includes(value)) {
    throw new BadRequestException(
      `${field} must be one of: ${Object.values(enumObject).join(', ')}`,
    );
  }

  return value as T[keyof T];
}

export function optionalEnumValue<T extends Record<string, string>>(
  enumObject: T,
  value: unknown,
  field: string,
): T[keyof T] | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return enumValue(enumObject, value, field);
}

export function arrayValue<T = unknown>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new BadRequestException(`${field} must be an array`);
  }

  return value as T[];
}
