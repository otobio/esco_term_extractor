/**
 * True when `span` (a normalized alias) occurs in `clause` immediately after a
 * negation cue (within {@link WINDOW} tokens). If the span itself starts with a
 * negation cue (e.g. the alias "no experience"), that leading cue is ignored.
 */
export declare function isNegated(clause: string, span: string): boolean;
