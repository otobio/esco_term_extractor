import type { SupportedQueryLocale } from './query-preparation.js';
export declare function compareTokenPhraseWithOptionalLinkers(candidateTokens: string[], entryTokens: string[], locale: SupportedQueryLocale): {
    ok: boolean;
    approximate: boolean;
};
