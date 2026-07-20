import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import type { InferredTerm } from './shared.js';
export declare function inferCompanyType(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
