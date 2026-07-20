import { performance } from 'node:perf_hooks';
export async function timed(work, ref, timings) {
    if (process.env.OSE_TIMINGS === '0') {
        return work();
    }
    const start = performance.now();
    try {
        return await work();
    }
    finally {
        addTiming(timings, ref, performance.now() - start);
    }
}
export function addTiming(timings, ref, elapsedMs) {
    timings[ref] = roundTiming((timings[ref] ?? 0) + elapsedMs);
}
export function mergeTimings(...sources) {
    const merged = {};
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
function roundTiming(value) {
    const rounded = Number(value.toFixed(3));
    return Object.is(rounded, -0) ? 0 : rounded;
}
