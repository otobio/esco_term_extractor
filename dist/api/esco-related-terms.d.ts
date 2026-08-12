export type EscoRelatedTermDirection = 'forward' | 'reverse';
export type EscoRelatedVerb = {
    queryVerb: string;
    relatedVerb: string;
    relationshipType: string;
    direction: EscoRelatedTermDirection;
    evidenceCount: number;
    sourceLabelExamples: string[];
    relatedLabelExamples: string[];
};
export type EscoRelatedObject = {
    queryObject: string;
    relatedObject: string;
    relationshipType: string;
    direction: EscoRelatedTermDirection;
    evidenceCount: number;
    sourceLabelExamples: string[];
    relatedLabelExamples: string[];
};
export type GiveVerbSynonymOptions = {
    sourceName?: string;
    locale?: string;
    limit?: number;
};
export type GiveObjectRelatedOptions = {
    sourceName?: string;
    locale?: string;
    limit?: number;
};
type RelatedTermInputRow = {
    source_term: string;
    related_term: string;
    relationship_type: string;
    evidence_count: number;
    direction: EscoRelatedTermDirection;
    source_skill_ids_json: string;
    related_skill_ids_json: string;
    source_skill_uris_json: string;
    related_skill_uris_json: string;
    source_label_examples_json: string;
    related_label_examples_json: string;
};
export declare function giveVerbSynonym(verb: string, options?: GiveVerbSynonymOptions): Promise<EscoRelatedVerb[]>;
export declare function giveObjectRelated(object: string, options?: GiveObjectRelatedOptions): Promise<EscoRelatedObject[]>;
export declare function mergeVerbRelatedRows(queryVerb: string, rows: RelatedTermInputRow[]): EscoRelatedVerb[];
export declare function mergeObjectRelatedRows(queryObject: string, rows: RelatedTermInputRow[]): EscoRelatedObject[];
export {};
