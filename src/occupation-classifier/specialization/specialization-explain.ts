import {
  SPECIALIZATION_EVIDENCE_DIMENSIONS,
  type QuerySpecializationClassification,
  type SpecializationEvidenceDimension
} from './specialization-dimension-mapper.js';

export type SpecializationConceptExplain = {
  conceptId: string;
  tokens: string[];
};

export type SpecializationStructuralCombinationExplain = {
  concepts: Array<{
    conceptId: string;
    dimension: SpecializationEvidenceDimension;
    tokens: string[];
  }>;
  derivedRoleHeads: string[];
  id: string;
  roleHeads: string[];
};

export type SpecializationExplain = {
  conceptsByDimension: Partial<Record<SpecializationEvidenceDimension, SpecializationConceptExplain[]>>;
  noopConcepts: SpecializationConceptExplain[];
  roleHeads: string[];
  structuralCombinations: SpecializationStructuralCombinationExplain[];
};

export function explainSpecializationClassification(classification: QuerySpecializationClassification): SpecializationExplain {
  const conceptsByDimension: SpecializationExplain['conceptsByDimension'] = {};

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
