export function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function isPositiveInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
export function isNonNegativeInteger(value) {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
export function isNullableInteger(value) {
    return value === null || isInteger(value);
}
export function isInteger(value) {
    return typeof value === 'number' && Number.isInteger(value);
}
export function isNullableString(value) {
    return value === null || typeof value === 'string';
}
export function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
export function safeFileSegment(value) {
    return value.trim().replace(/[^a-z0-9._-]+/giu, '_');
}
export function requirePositiveIntegerAtMost(value, max, label) {
    if (!Number.isInteger(value) || value <= 0 || value > max) {
        throw new Error(`${label} must be a positive integer no greater than ${max}. Received "${value}".`);
    }
    return value;
}
export function requireNonNegativeIntegerAtMost(value, max, label) {
    if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new Error(`${label} must be a non-negative integer no greater than ${max}. Received "${value}".`);
    }
    return value;
}
