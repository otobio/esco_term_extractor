export function createNoopClassifierTrace() {
    return {
        async call(realCall, args, _name) {
            return realCall(...args);
        },
        trace() {
            return { pipeline: [] };
        }
    };
}
export function createClassifierDebugTrace(options = {}) {
    const pipeline = [];
    return {
        async call(realCall, args, name) {
            const started = performance.now();
            const callArgs = (options.beforeCall ? await options.beforeCall({ name, args }) : args);
            const realOutput = await realCall(...callArgs);
            const durationMs = performance.now() - started;
            const output = (options.afterCall
                ? await options.afterCall({
                    name,
                    args: callArgs,
                    output: realOutput,
                    durationMs
                })
                : realOutput);
            pipeline.push({
                name,
                args: toDebugArray(callArgs),
                output: toDebugValue(output),
                durationMs
            });
            return output;
        },
        trace() {
            return { pipeline };
        }
    };
}
function toDebugArray(value) {
    return value.map((entryValue) => toDebugValue(entryValue));
}
function toDebugValue(value) {
    if (typeof value === 'function') {
        return `[function ${value.name || 'anonymous'}]`;
    }
    if (Buffer.isBuffer(value)) {
        return { type: 'Buffer', byteLength: value.byteLength };
    }
    if (ArrayBuffer.isView(value)) {
        return {
            type: value.constructor.name,
            byteLength: value.byteLength
        };
    }
    if (value instanceof Map) {
        return [...value.entries()].map(([key, entryValue]) => [key, toDebugValue(entryValue)]);
    }
    if (value instanceof Set) {
        return [...value.values()].map((entryValue) => toDebugValue(entryValue));
    }
    if (Array.isArray(value)) {
        return value.map((entryValue) => toDebugValue(entryValue));
    }
    if (isRuntimeArtifactLike(value)) {
        return {
            type: 'runtime_artifact',
            manifestPath: value.manifestPath,
            artifactPath: value.artifactPath,
            count: value.manifest?.count ?? null,
            sourceName: value.manifest?.sourceName ?? null,
            schemaVersion: value.manifest?.schemaVersion ?? null
        };
    }
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, toDebugValue(entryValue)]));
    }
    if (value && typeof value === 'object') {
        return { type: value.constructor.name };
    }
    return value;
}
function isPlainObject(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function isRuntimeArtifactLike(value) {
    return isPlainObject(value) && (typeof value.manifestPath === 'string' || typeof value.artifactPath === 'string');
}
