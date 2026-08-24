import { hasSupportAliasGrounding, isSupportingAliasRole } from '../retrieval/intent-support-grounding.js';
import { foldSearchText } from '../utils/texts.js';
export class RetrievalBoundaryDebugCollector {
    enabled;
    limit;
    aliasNgramRetained = [];
    aliasNgramSuppressed = [];
    lexicalContextOnlyAdmissions = [];
    lexicalContextOnlyAdmissionKeys = new Set();
    constructor(enabled, limit = 24) {
        this.enabled = enabled;
        this.limit = limit;
    }
    collectAliasNgramRetained(preparedQuery, entry) {
        if (!this.enabled || this.aliasNgramRetained.length >= this.limit) {
            return;
        }
        this.aliasNgramRetained.push({
            ...entry,
            ...classifyIntentMatch(preparedQuery, entry.aliasRole, entry.matchedTokens),
            suppressed: false,
            suppressionReason: null
        });
    }
    collectAliasNgramSuppressed(preparedQuery, entry) {
        if (!this.enabled || this.aliasNgramSuppressed.length >= this.limit) {
            return;
        }
        this.aliasNgramSuppressed.push({
            ...entry,
            ...classifyIntentMatch(preparedQuery, entry.aliasRole, entry.matchedTokens),
            score: 0,
            suppressed: true,
            suppressionReason: 'context_only_support_alias'
        });
    }
    collectLexicalAdmission(preparedQuery, hit) {
        if (!this.enabled || this.lexicalContextOnlyAdmissions.length >= this.limit) {
            return;
        }
        const matchedTokens = uniqueSorted(hit.matchedTokens);
        const classification = classifyIntentMatch(preparedQuery, 'combined', matchedTokens);
        if (!classification.contextOnly) {
            return;
        }
        const fields = uniqueSorted(hit.fieldSignals.map((signal) => signal.field));
        const supportFields = uniqueSorted(hit.fieldSignals
            .filter((signal) => signal.aliasRole && isSupportingAliasRole(signal.aliasRole))
            .map((signal) => `${signal.field}:${signal.aliasRole}`));
        const key = `${hit.graphNodeId}\0${matchedTokens.join(',')}\0${fields.join(',')}`;
        if (this.lexicalContextOnlyAdmissionKeys.has(key)) {
            return;
        }
        this.lexicalContextOnlyAdmissionKeys.add(key);
        this.lexicalContextOnlyAdmissions.push({
            canonicalLabel: hit.canonicalLabel,
            matchedTokens,
            matchedRoleTokens: classification.matchedRoleTokens,
            matchedDomainTokens: classification.matchedDomainTokens,
            roleGrounded: classification.roleGrounded,
            contextOnly: classification.contextOnly,
            fields,
            supportFields
        });
    }
    snapshot() {
        return {
            aliasNgram: {
                retained: [...this.aliasNgramRetained],
                suppressed: [...this.aliasNgramSuppressed]
            },
            lexicalAdmissions: {
                contextOnly: [...this.lexicalContextOnlyAdmissions]
            }
        };
    }
}
function classifyIntentMatch(preparedQuery, aliasRole, matchedTokens) {
    const roleTokenSet = new Set(preparedQuery.intent.roleTokens.map((token) => foldSearchText(token)).filter(Boolean));
    const domainTokenSet = new Set(preparedQuery.intent.domainTokens.map((token) => foldSearchText(token)).filter(Boolean));
    const foldedMatchedTokens = matchedTokens.map((token) => foldSearchText(token)).filter(Boolean);
    const matchedRoleTokens = uniqueSorted(foldedMatchedTokens.filter((token) => roleTokenSet.has(token)));
    const matchedDomainTokens = uniqueSorted(foldedMatchedTokens.filter((token) => domainTokenSet.has(token)));
    const roleGrounded = preparedQuery.intent.roleTokens.length === 0 || !isSupportingAliasRole(aliasRole)
        ? matchedRoleTokens.length > 0 || preparedQuery.intent.roleTokens.length === 0
        : hasSupportAliasGrounding(preparedQuery, matchedTokens);
    return {
        matchedRoleTokens,
        matchedDomainTokens,
        roleGrounded,
        contextOnly: matchedDomainTokens.length > 0 && matchedRoleTokens.length === 0
    };
}
function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort();
}
