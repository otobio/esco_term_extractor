import { createHash } from 'node:crypto';
const HASH_PROJECTIONS_PER_TOKEN = 4;
export function embedTextWithLocalHash(text, modelKey, dimensions) {
    const tokens = tokenize(text);
    const tokenCounts = countTokens(tokens.length > 0 ? tokens : [normalizeForTokenization(text)]);
    const vector = new Array(dimensions).fill(0);
    for (const [token, count] of tokenCounts.entries()) {
        const tokenWeight = Math.sqrt(count);
        for (let projection = 0; projection < HASH_PROJECTIONS_PER_TOKEN; projection += 1) {
            const digest = createHash('sha256').update(`${modelKey}\0${dimensions}\0${projection}\0${token}`).digest();
            const index = digest.readUInt32BE(0) % dimensions;
            const sign = digest[4] % 2 === 0 ? 1 : -1;
            const magnitude = 0.75 + digest[5] / 510;
            vector[index] += (sign * tokenWeight * magnitude) / Math.sqrt(HASH_PROJECTIONS_PER_TOKEN);
        }
    }
    const rawNorm = computeVectorNorm(vector);
    if (rawNorm === 0) {
        return {
            vector,
            vectorNorm: 0
        };
    }
    const normalizedVector = vector.map((value) => roundVectorValue(value / rawNorm));
    return {
        vector: normalizedVector,
        vectorNorm: roundVectorValue(computeVectorNorm(normalizedVector))
    };
}
export function computeDotProduct(left, right) {
    const length = Math.min(left.length, right.length);
    let score = 0;
    for (let index = 0; index < length; index += 1) {
        score += (left[index] ?? 0) * (right[index] ?? 0);
    }
    return score;
}
export function computeCosineSimilarity(left, right, leftNorm = computeVectorNorm(left), rightNorm = computeVectorNorm(right)) {
    if (leftNorm === 0 || rightNorm === 0) {
        return 0;
    }
    return computeDotProduct(left, right) / (leftNorm * rightNorm);
}
export function computeVectorNorm(vector) {
    return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}
export function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex');
}
function tokenize(text) {
    const normalized = normalizeForTokenization(text);
    return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}
function normalizeForTokenization(text) {
    return text
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .trim();
}
function countTokens(tokens) {
    const counts = new Map();
    for (const token of tokens) {
        if (!token) {
            continue;
        }
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return counts;
}
function roundVectorValue(value) {
    const rounded = Number(value.toFixed(8));
    return Object.is(rounded, -0) ? 0 : rounded;
}
