import { type AuthorityKind } from './authority-gate.js';
import { type QuerySpecializationClassification } from './specialization/specialization-dimension-mapper.js';
import type { CanonicalComparisonQuery } from './types.js';
export type QueryStructuralProfile = {
    profile: QuerySpecializationClassification;
    authority: AuthorityKind;
};
export declare function buildQueryStructuralProfile(comparisonQuery: CanonicalComparisonQuery): QueryStructuralProfile;
