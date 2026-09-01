import type { CoreResult, DebugResult, RuntimeResult, SimpleClassificationInput } from './types.js';
export declare function classifyOccupationCore(input: SimpleClassificationInput): Promise<CoreResult>;
export declare function classifyOccupationTitle(input: SimpleClassificationInput): Promise<RuntimeResult>;
export declare function classifyOccupationTitleDebug(input: SimpleClassificationInput): Promise<DebugResult>;
