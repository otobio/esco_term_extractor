export function compareBigInt(left: bigint, right: bigint): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortedIncludes(values: string[], needle: string): boolean {
  return sortedIndexOf(values, needle) !== -1;
}

export function sortedNumberIncludes(values: readonly number[], needle: number): boolean {
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

export function lookupSortedPairValue<T>(entries: Array<[string, T]>, key: string, fallback: T): T {
  const index = sortedPairIndexOf(entries, key);
  return index === -1 ? fallback : (entries[index]?.[1] ?? fallback);
}

export function containsTokenPhrase(haystackPhrase: string, needleTokens: string[]): boolean {
  if (needleTokens.length === 0) {
    return false;
  }

  return ` ${haystackPhrase} `.includes(` ${needleTokens.join(' ')} `);
}

export function uniqueSortedStrings(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort();
}

export function roundScore(value: number): number {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function clampScore(value: number): number {
  return roundScore(Math.max(0, Math.min(1, value)));
}

/**
 * Scans `items` for the maximum of `selector(item)` without allocating an intermediate
 * mapped array or spreading into Math.max, which are wasteful on large candidate/hit lists.
 */
export function maxOf<T>(items: readonly T[], selector: (item: T) => number, fallback = 0): number {
  let max = fallback;

  for (const item of items) {
    const value = selector(item);

    if (value > max) {
      max = value;
    }
  }

  return max;
}

function sortedIndexOf(values: string[], needle: string): number {
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
    } else {
      right = middle - 1;
    }
  }

  return -1;
}

function sortedPairIndexOf<T>(entries: Array<[string, T]>, key: string): number {
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
    } else {
      right = middle - 1;
    }
  }

  return -1;
}
