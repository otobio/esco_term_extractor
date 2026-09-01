import type { ClassifierPipelineStageName, DebugPipelineStep, DebugTrace } from './types.js';

export type ClassifierTrace = {
  call<Args extends readonly unknown[], Output>(
    realCall: (...args: Args) => Output | Promise<Output>,
    args: Args,
    name: ClassifierPipelineStageName
  ): Promise<Output>;
  trace(): DebugTrace;
};

export type ClassifierTraceHook = <Args extends readonly unknown[]>(stage: {
  name: ClassifierPipelineStageName;
  args: Args;
}) => readonly unknown[] | Promise<readonly unknown[]>;

export type ClassifierTraceOutputHook = <Output>(stage: {
  name: ClassifierPipelineStageName;
  args: readonly unknown[];
  output: Output;
  durationMs: number;
}) => unknown | Promise<unknown>;

export type ClassifierDebugTraceOptions = {
  beforeCall?: ClassifierTraceHook;
  afterCall?: ClassifierTraceOutputHook;
};

export function createNoopClassifierTrace(): ClassifierTrace {
  return {
    async call(realCall, args, _name) {
      return realCall(...args);
    },
    trace() {
      return { pipeline: [] };
    }
  };
}

export function createClassifierDebugTrace(options: ClassifierDebugTraceOptions = {}): ClassifierTrace {
  const pipeline: DebugPipelineStep[] = [];

  return {
    async call(realCall, args, name) {
      const started = performance.now();
      const callArgs = (options.beforeCall ? await options.beforeCall({ name, args }) : args) as typeof args;
      const realOutput = await realCall(...callArgs);
      const durationMs = performance.now() - started;
      const output = (
        options.afterCall
          ? await options.afterCall({
              name,
              args: callArgs,
              output: realOutput,
              durationMs
            })
          : realOutput
      ) as typeof realOutput;

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

function toDebugArray(value: readonly unknown[]): unknown[] {
  return value.map((entryValue) => toDebugValue(entryValue));
}

function toDebugValue(value: unknown): unknown {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isRuntimeArtifactLike(value: unknown): value is {
  manifestPath?: string;
  artifactPath?: string;
  manifest?: { count?: number; sourceName?: string; schemaVersion?: number };
} {
  return isPlainObject(value) && (typeof value.manifestPath === 'string' || typeof value.artifactPath === 'string');
}
