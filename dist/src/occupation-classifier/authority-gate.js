import { LEAF_AUTHORITY_KINDS } from '../runtime/occupation-leaf-structure-contract.js';
import { tokenizeNormalizedText } from '../utils/texts.js';
// Same vocabulary leaves are already classified against (occupation-leaf-structure-contract.ts) --
// reuse it instead of maintaining a second, independent English word list here that can drift out
// of sync with what the leaf side actually recognizes.
const AUTHORITY_TOKEN_ORDER = LEAF_AUTHORITY_KINDS.filter((kind) => kind !== 'none');
export function detectAuthorityKind(tokens) {
    for (const token of AUTHORITY_TOKEN_ORDER) {
        if (tokens.includes(token)) {
            return token;
        }
    }
    return 'none';
}
export function detectQueryAuthorityKind(comparisonQuery) {
    return detectAuthorityKind(comparisonQuery.englishTokens);
}
export function detectCandidateAuthorityKind(canonicalWeakFolded) {
    return detectAuthorityKind(tokenizeNormalizedText(canonicalWeakFolded));
}
export function authorityContradicts(queryAuthority, candidateAuthority) {
    if (queryAuthority === candidateAuthority) {
        return false;
    }
    return queryAuthority !== 'none' || candidateAuthority !== 'none';
}
