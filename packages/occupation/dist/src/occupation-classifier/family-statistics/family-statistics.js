import statisticsJson from './family-statistics.json' with { type: 'json' };
const STATISTICS = statisticsJson;
const ROLE_WEIGHT = 0.32;
const CONCEPT_WEIGHT = 0.2;
const PAIR_WEIGHT = 0.48;
export function scoreFamilyStatisticalFit(familyNodeId, query) {
    let bestRole = 0;
    let bestConcept = 0;
    let bestPair = 0;
    const matchedFeatures = [];
    for (const roleHead of query.roleHeads) {
        const feature = `role:${roleHead}`;
        const value = normalizedLift(STATISTICS.features[feature]?.[String(familyNodeId)] ?? 0);
        if (value > bestRole) {
            bestRole = value;
        }
        if (value > 0) {
            matchedFeatures.push(feature);
        }
    }
    for (const [dimension, conceptIds] of query.conceptIdsByDimension) {
        for (const conceptId of conceptIds) {
            const conceptFeature = `concept:${dimension}:${conceptId}`;
            const conceptValue = normalizedLift(STATISTICS.features[conceptFeature]?.[String(familyNodeId)] ?? 0);
            if (conceptValue > bestConcept) {
                bestConcept = conceptValue;
            }
            if (conceptValue > 0) {
                matchedFeatures.push(conceptFeature);
            }
            for (const roleHead of query.roleHeads) {
                const pairFeature = `pair:${roleHead}|${dimension}:${conceptId}`;
                const pairValue = normalizedLift(STATISTICS.features[pairFeature]?.[String(familyNodeId)] ?? 0);
                if (pairValue > bestPair) {
                    bestPair = pairValue;
                }
                if (pairValue > 0) {
                    matchedFeatures.push(pairFeature);
                }
            }
        }
    }
    return {
        score: Math.min(1, ROLE_WEIGHT * bestRole + CONCEPT_WEIGHT * bestConcept + PAIR_WEIGHT * bestPair),
        features: matchedFeatures
    };
}
export function statisticalFamilyConfidence(structureDecision, fit) {
    if (structureDecision === 'reject' || fit.score <= 0) {
        return 0;
    }
    if (structureDecision === 'accept') {
        return 0.58 + 0.32 * fit.score;
    }
    return 0.35 + 0.2 * fit.score;
}
function normalizedLift(value) {
    if (value <= 0) {
        return 0;
    }
    return Math.min(1, value / 2.5);
}
