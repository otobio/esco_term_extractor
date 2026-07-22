export async function timed<T>(work: () => T | Promise<T>, label: string): Promise<T> {
  if (process.env.PERF_TIMING === '0') return work();
  const t0 = performance.now();
  try {
    return await work();
  } finally {
    console.error(`[perf] ${label} ${(performance.now() - t0).toFixed(1)}ms`);
  }
}
