/**
 * Lightweight noise guard.
 *
 * Job posts are full of clauses that should never be matched to a canonical term:
 * contact details, application instructions, equal-opportunity boilerplate, URLs,
 * emails and phone numbers. Dropping them before embedding both speeds things up
 * and removes a large class of false positives.
 */
export interface NoiseVerdict {
    keep: boolean;
    reason?: 'contact_noise' | 'too_short';
}
export declare function classifyClause(text: string): NoiseVerdict;
