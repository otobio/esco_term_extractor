import { performance } from 'node:perf_hooks';

export type TimingMap = Record<string, number>;

export async function timed<T>(work: () => T | Promise<T>, ref: string, timings: TimingMap): Promise<T> {
  if (process.env.OSE_TIMINGS === '0') {
    return work();
  }

  const start = performance.now();

  try {
    return await work();
  } finally {
    addTiming(timings, ref, performance.now() - start);
  }
}

export function addTiming(timings: TimingMap, ref: string, elapsedMs: number): void {
  timings[ref] = roundTiming((timings[ref] ?? 0) + elapsedMs);
}

export function mergeTimings(...sources: Array<TimingMap | undefined>): TimingMap {
  const merged: TimingMap = {};

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [ref, elapsedMs] of Object.entries(source)) {
      addTiming(merged, ref, elapsedMs);
    }
  }

  return merged;
}

function roundTiming(value: number): number {
  const rounded = Number(value.toFixed(3));
  return Object.is(rounded, -0) ? 0 : rounded;
}
