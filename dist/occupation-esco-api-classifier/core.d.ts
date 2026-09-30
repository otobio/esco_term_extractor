import type { EscoApiClassification, EscoApiClassificationDebug, EscoApiClassificationInput } from './types.js';
export declare function classifyOccupationTitleViaEscoApi(input: EscoApiClassificationInput): Promise<EscoApiClassification>;
export declare function classifyOccupationTitleViaEscoApiDebug(input: EscoApiClassificationInput): Promise<EscoApiClassificationDebug>;
