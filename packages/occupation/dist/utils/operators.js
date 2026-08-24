export function compareBigInt(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
export function sortedIncludes(values, needle) {
    return sortedIndexOf(values, needle) !== -1;
}
export function sortedNumberIncludes(values, needle) {
    let left = 0;
    let right = values.length - 1;
    while (left <= right) {
        const middle = (left + right) >>> 1;
        const value = values[middle] ?? 0;
        if (value < needle) {
            left = middle + 1;
            continue;
        }
        if (value > needle) {
            right = middle - 1;
            continue;
        }
        return true;
    }
    return false;
}
export function lookupSortedPairValue(entries, key, fallback) {
    const index = sortedPairIndexOf(entries, key);
    return index === -1 ? fallback : (entries[index]?.[1] ?? fallback);
}
export function containsTokenPhrase(haystackPhrase, needleTokens) {
    if (needleTokens.length === 0) {
        return false;
    }
    return ` ${haystackPhrase} `.includes(` ${needleTokens.join(' ')} `);
}
export function uniqueSortedStrings(values) {
    return Array.from(new Set(values)).sort();
}
export function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
export function clampScore(value) {
    return roundScore(Math.max(0, Math.min(1, value)));
}
/**
 * Scans `items` for the maximum of `selector(item)` without allocating an intermediate
 * mapped array or spreading into Math.max, which are wasteful on large candidate/hit lists.
 */
export function maxOf(items, selector, fallback = 0) {
    let max = fallback;
    for (const item of items) {
        const value = selector(item);
        if (value > max) {
            max = value;
        }
    }
    return max;
}
function sortedIndexOf(values, needle) {
    let left = 0;
    let right = values.length - 1;
    while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        const value = values[middle] ?? '';
        const comparison = value.localeCompare(needle);
        if (comparison === 0) {
            return middle;
        }
        if (comparison < 0) {
            left = middle + 1;
        }
        else {
            right = middle - 1;
        }
    }
    return -1;
}
function sortedPairIndexOf(entries, key) {
    let left = 0;
    let right = entries.length - 1;
    while (left <= right) {
        const middle = Math.floor((left + right) / 2);
        const [middleKey] = entries[middle] ?? [''];
        const comparison = middleKey.localeCompare(key);
        if (comparison === 0) {
            return middle;
        }
        if (comparison < 0) {
            left = middle + 1;
        }
        else {
            right = middle - 1;
        }
    }
    return -1;
}
