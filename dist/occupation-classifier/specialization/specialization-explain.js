import { SPECIALIZATION_EVIDENCE_DIMENSIONS } from './specialization-dimension-mapper.js';
export function explainSpecializationClassification(classification) {
    const conceptsByDimension = {};
    for (const dimension of SPECIALIZATION_EVIDENCE_DIMENSIONS) {
        const concepts = classification.concepts
            .filter((concept) => concept.dimension === dimension)
            .map((concept) => ({
            conceptId: concept.conceptId,
            tokens: concept.canonicalTokens
        }));
        if (concepts.length > 0) {
            conceptsByDimension[dimension] = concepts;
        }
    }
    return {
        conceptsByDimension,
        noopConcepts: classification.concepts
            .filter((concept) => concept.dimension === 'noop')
            .map((concept) => ({
            conceptId: concept.conceptId,
            tokens: concept.canonicalTokens
        })),
        roleHeads: classification.role_head,
        structuralCombinations: classification.structural_combination.map((combination) => ({
            concepts: combination.concepts.map((concept) => ({
                conceptId: concept.conceptId,
                dimension: concept.dimension,
                tokens: concept.canonicalTokens
            })),
            derivedRoleHeads: combination.derivedRoleHeads,
            id: combination.id,
            roleHeads: combination.roleHeads
        }))
    };
}
