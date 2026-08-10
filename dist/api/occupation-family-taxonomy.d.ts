export type OccupationGroup = 'military' | 'executive' | 'professional' | 'technical' | 'clerical' | 'service_and_sales' | 'skilled_trades' | 'elementary';
export type CollarKind = 'white' | 'blue' | 'grey';
export type CollarTrait = 'pink' | 'green' | 'gold' | 'creative' | 'protective';
export type OccupationFamily = {
    id: number;
    slug: string;
    label: string;
    group: OccupationGroup;
    collarKind: CollarKind;
    collarTraits: CollarTrait[];
};
export declare const occupationFamilies: OccupationFamily[];
export declare function getOccupationFamilyContext(identifier: string | number): OccupationFamily | undefined;
