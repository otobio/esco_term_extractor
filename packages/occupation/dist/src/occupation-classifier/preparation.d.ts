import { LeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { QuerySpecializationClassification } from './specialization/specialization-dimension-mapper.js';
import type { ClassifierSurface, CleanedTitle, NormalizedInput, SimpleClassificationInput, SupportedQueryLocale, TitleSpan } from './types.js';
export declare function normalizeInput(input: SimpleClassificationInput): NormalizedInput;
export declare function selectClassifierLocale(query: string, requestedLocale: SupportedQueryLocale, sourceName: string): Promise<SupportedQueryLocale>;
export declare function loadOrUseRuntime(options: NormalizedInput): Promise<OccupationRuntimeContext>;
export declare function splitIndependentSpans(cleanedTitle: CleanedTitle, _locale: NormalizedInput['locale']): TitleSpan[];
export declare function prepareClassifierSurface(span: TitleSpan): ClassifierSurface;
export type QueryStructuralProfile = {
    profile: QuerySpecializationClassification;
    authority: LeafLevelKind;
};
export declare function buildQueryStructuralProfile(query: string, locale?: SupportedQueryLocale): QueryStructuralProfile;
