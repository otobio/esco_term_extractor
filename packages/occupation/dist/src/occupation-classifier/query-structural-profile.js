import { detectQueryAuthorityKind } from './authority-gate.js';
import { classifySpecializationQuery } from './specialization/specialization-dimension-mapper.js';
// The query's specialization profile (venue/channel/product/task/industry.. dimensions) and its
// authority kind (manager, chief, lead, ..) both describe the query itself, not any one candidate --
// compute them once here instead of inside the per-candidate assessment loop, so every candidate
// checks against the same shared profile instead of each one re-deriving it from scratch.
export function buildQueryStructuralProfile(comparisonQuery) {
    return {
        profile: classifySpecializationQuery(comparisonQuery.englishTokens.join(' ')),
        authority: detectQueryAuthorityKind(comparisonQuery)
    };
}
