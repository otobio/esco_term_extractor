export class LeafSelectionEvidenceRanker {
    rank(input) {
        const reasons = [];
        const exactAlias = hasEvidence(input.evidence, 'exact_alias');
        const foldedAlias = hasEvidence(input.evidence, 'folded_alias');
        const strongPhrase = hasStrongPreparedPhraseEvidence(input.evidence) || hasEvidence(input.evidence, 'ngram_alias');
        const capabilityTask = hasEvidence(input.evidence, 'capability_task');
        if (exactAlias || input.closeness?.exactNormalizedLabel) {
            reasons.push(exactAlias ? 'leaf has exact alias evidence' : 'leaf canonical label exactly matches query');
            return evidence('exact_alias', reasons);
        }
        if (foldedAlias || input.closeness?.exactFoldedLabel) {
            reasons.push(foldedAlias ? 'leaf has folded alias evidence' : 'leaf canonical label exactly matches folded query');
            return evidence('folded_alias', reasons);
        }
        if (strongPhrase) {
            reasons.push(hasEvidence(input.evidence, 'ngram_alias')
                ? 'leaf has ngram alias evidence'
                : 'leaf has prepared multi-token phrase-window evidence');
            return evidence('strong_phrase', reasons);
        }
        if (input.familyScopedFit?.tier === 'exact' || input.familyScopedFit?.tier === 'alias_aligned') {
            reasons.push(`family-scoped leaf fit is ${input.familyScopedFit.tier}`);
            return evidence('alias_aligned', reasons);
        }
        if (capabilityTask ||
            input.familyScopedFit?.tier === 'capability_aligned' ||
            ((input.capabilityFit?.tier === 'strong' || input.capabilityFit?.tier === 'partial') &&
                (input.familyScopedFit?.matchedTerms?.length ?? 0) > 0)) {
            reasons.push(capabilityAlignmentReason(capabilityTask, input.capabilityFit?.tier ?? null));
            return evidence('capability_aligned', reasons);
        }
        if (input.familyScopedFit?.tier === 'semantic_aligned') {
            reasons.push('semantic evidence agrees with family-scoped leaf terms');
            return evidence('semantic_aligned', reasons);
        }
        reasons.push('leaf has no trusted selection evidence');
        return evidence('weak', reasons);
    }
}
function capabilityAlignmentReason(capabilityTask, capabilityFitTier) {
    if (capabilityFitTier === 'strong') {
        return 'leaf capability labels cover all family-scoped query terms';
    }
    if (capabilityFitTier === 'partial') {
        return 'leaf capability labels cover some family-scoped query terms';
    }
    return capabilityTask ? 'leaf has capability/task retrieval evidence' : 'family-scoped capability labels align with query';
}
function hasEvidence(evidenceRecords, channel) {
    return evidenceRecords.some((record) => record.channel === channel);
}
function hasStrongPreparedPhraseEvidence(evidenceRecords) {
    return evidenceRecords.some((record) => {
        if (record.channel !== 'opensearch_lexical') {
            return false;
        }
        const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];
        return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
    });
}
function isPreparedPhraseWindowQuery(value) {
    const match = value.match(/^authority_(?:010|020|030|040|050)_prepared_.+_phrase_window_len_(\d+)_idx_\d+$/u);
    return match ? Number.parseInt(match[1] ?? '0', 10) >= 2 : false;
}
function evidence(tier, reasons) {
    return {
        tier,
        tierRank: tierRank(tier),
        reasons
    };
}
function tierRank(tier) {
    if (tier === 'exact_alias') {
        return 1;
    }
    if (tier === 'folded_alias') {
        return 2;
    }
    if (tier === 'strong_phrase') {
        return 3;
    }
    if (tier === 'alias_aligned') {
        return 4;
    }
    if (tier === 'capability_aligned') {
        return 5;
    }
    if (tier === 'semantic_aligned') {
        return 6;
    }
    return 7;
}
