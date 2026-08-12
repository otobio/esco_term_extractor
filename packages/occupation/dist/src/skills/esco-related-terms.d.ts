export type EscoSkillLabelRecord = {
    skillId: number;
    skillUri: string;
    label: string;
    labelType: 'preferred_label' | 'alt_label' | 'hidden_label';
    sourceLabel: string;
};
export type EscoSkillRelationRecord = {
    relationId: number;
    relationKind: 'skill_skill' | 'broader_skill';
    localeCode: string;
    sourceSkillId: number;
    sourceSkillUri: string;
    sourceLabel: string;
    relatedSkillId: number;
    relatedSkillUri: string;
    relatedLabel: string;
};
export type EscoTermInventoryRow = {
    term: string;
    occurrenceCount: number;
    skillCount: number;
    labelCount: number;
};
export type EscoVerbRelatedRow = {
    source_verb: string;
    related_verb: string;
    relationship_type: 'same_skill' | 'same_object' | 'esco_related_skill' | 'broader_skill' | 'narrower_skill';
    evidence_count: number;
    source_skill_ids: number[];
    related_skill_ids: number[];
    source_skill_uris: string[];
    related_skill_uris: string[];
    source_label_examples: string[];
    related_label_examples: string[];
};
export type EscoObjectRelatedRow = {
    source_object: string;
    related_object: string;
    relationship_type: 'same_skill' | 'same_verb' | 'esco_related_skill' | 'broader_skill' | 'narrower_skill';
    evidence_count: number;
    source_skill_ids: number[];
    related_skill_ids: number[];
    source_skill_uris: string[];
    related_skill_uris: string[];
    source_label_examples: string[];
    related_label_examples: string[];
};
export type EscoRelatedTermsDataset = {
    verbInventory: EscoTermInventoryRow[];
    objectInventory: EscoTermInventoryRow[];
    verbRelatedRows: EscoVerbRelatedRow[];
    objectRelatedRows: EscoObjectRelatedRow[];
};
export type EscoRelatedTermsBuildOptions = {
    minVerbOccurrences?: number;
    minObjectOccurrences?: number;
};
type LabelFact = {
    skillId: number;
    skillUri: string;
    label: string;
    labelType: EscoSkillLabelRecord['labelType'];
    normalizedLabel: string;
    verb: string | null;
    object: string | null;
};
export declare function buildEscoRelatedTermsDataset(labels: EscoSkillLabelRecord[], relations?: EscoSkillRelationRecord[], options?: EscoRelatedTermsBuildOptions): EscoRelatedTermsDataset;
export declare function buildEscoVerbInventory(labels: EscoSkillLabelRecord[], minOccurrences?: number): EscoTermInventoryRow[];
export declare function buildEscoObjectInventory(labels: EscoSkillLabelRecord[], minOccurrences?: number): EscoTermInventoryRow[];
export declare function extractEscoLabelFact(label: string): Pick<LabelFact, 'normalizedLabel' | 'verb' | 'object'> | null;
export {};
