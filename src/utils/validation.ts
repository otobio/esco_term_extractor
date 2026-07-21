export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function isNullableInteger(value: unknown): value is number | null {
  return value === null || isInteger(value);
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function safeFileSegment(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/giu, '_');
}

export function requirePositiveIntegerAtMost(value: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new Error(`${label} must be a positive integer no greater than ${max}. Received "${value}".`);
  }

  return value;
}

export function requireNonNegativeIntegerAtMost(value: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${label} must be a non-negative integer no greater than ${max}. Received "${value}".`);
  }

  return value;
}
