import type { ClassifierPipelineStageName, DebugTrace } from './types.js';
export type ClassifierTrace = {
    call<Args extends readonly unknown[], Output>(realCall: (...args: Args) => Output | Promise<Output>, args: Args, name: ClassifierPipelineStageName): Promise<Output>;
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
export declare function createNoopClassifierTrace(): ClassifierTrace;
export declare function createClassifierDebugTrace(options?: ClassifierDebugTraceOptions): ClassifierTrace;
