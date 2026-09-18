export function uniqueSorted(tokens: readonly string[]): string[] {
  return [...new Set(tokens.filter(Boolean))].sort();
}

export function uniquePreservingOrder(tokens: readonly string[]): string[] {
  return [...new Set(tokens.filter(Boolean))];
}