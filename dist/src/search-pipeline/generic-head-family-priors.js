import { foldSearchText } from '../utils/texts.js';
export function getGenericHeadFamilyPriors(roleHeadTokens, roleTokens, venueTokens, hasCuratedRolePhrase) {
    if (hasCuratedRolePhrase || roleHeadTokens.length === 0) {
        return [];
    }
    const headCarrier = normalizeGenericHeadCarrier(roleHeadTokens[roleHeadTokens.length - 1] ?? '');
    if (!headCarrier) {
        return [];
    }
    const profile = GENERIC_HEAD_FAMILY_PRIOR_PROFILES[headCarrier];
    if (!profile) {
        return [];
    }
    const context = deriveVenueCarrierSet(roleTokens, venueTokens);
    for (const rule of profile.rules ?? []) {
        if (matchesAnyVenueCarrier(context, rule.when)) {
            return rule.priors;
        }
    }
    return profile.default ?? [];
}
export function hasGenericHeadVenueContext(roleTokens, venueTokens) {
    return deriveVenueCarrierSet(roleTokens, venueTokens).size > 0;
}
const GENERIC_HEAD_FAMILY_PRIOR_PROFILES = {
    assistant: {
        rules: [
            {
                when: ['health'],
                priors: [
                    primary(15039, 'Personal care workers in health services'),
                    supporting(14886, 'Other health associate professionals'),
                    supporting(14791, 'Administration professionals')
                ]
            },
            {
                when: ['professional'],
                priors: [
                    primary(15036, "Child care workers and teachers' aides"),
                    supporting(14791, 'Administration professionals'),
                    supporting(15039, 'Personal care workers in health services')
                ]
            },
            {
                when: ['hospitality'],
                priors: [
                    primary(15257, 'Food preparation assistants'),
                    supporting(14791, 'Administration professionals'),
                    supporting(15021, 'Shop salespersons')
                ]
            },
            {
                when: ['retail'],
                priors: [
                    primary(15021, 'Shop salespersons'),
                    supporting(14791, 'Administration professionals'),
                    supporting(15257, 'Food preparation assistants')
                ]
            },
            {
                when: ['office'],
                priors: [
                    primary(14791, 'Administration professionals'),
                    supporting(14914, 'Administrative and specialised secretaries'),
                    supporting(15036, "Child care workers and teachers' aides")
                ]
            }
        ]
    },
    consultant: {
        rules: [
            {
                when: ['ict'],
                priors: [
                    primary(14695, 'Information and communications technology service managers'),
                    supporting(14802, 'Software and applications developers and analysts'),
                    supporting(14908, 'Business services agents')
                ]
            }
        ]
    },
    manager: {
        rules: [
            {
                when: ['hospitality'],
                priors: [
                    primary(14706, 'Hotel and restaurant managers'),
                    supporting(14709, 'Retail and wholesale trade managers'),
                    supporting(14677, 'Business services and administration managers')
                ]
            },
            {
                when: ['retail'],
                priors: [
                    primary(14709, 'Retail and wholesale trade managers'),
                    supporting(14677, 'Business services and administration managers'),
                    supporting(14706, 'Hotel and restaurant managers')
                ]
            },
            {
                when: ['industrial'],
                priors: [
                    primary(14690, 'Manufacturing, mining, construction, and distribution managers'),
                    supporting(14677, 'Business services and administration managers'),
                    supporting(14709, 'Retail and wholesale trade managers')
                ]
            },
            {
                when: ['health', 'professional'],
                priors: [
                    primary(14697, 'Professional services managers'),
                    supporting(14677, 'Business services and administration managers'),
                    supporting(14711, 'Other services managers')
                ]
            },
            {
                when: ['office'],
                priors: [
                    primary(14677, 'Business services and administration managers'),
                    supporting(14697, 'Professional services managers'),
                    supporting(14711, 'Other services managers')
                ]
            }
        ],
        default: [
            primary(14697, 'Professional services managers'),
            supporting(14677, 'Business services and administration managers'),
            supporting(14711, 'Other services managers')
        ]
    },
    officer: {
        rules: [
            {
                when: ['health'],
                priors: [
                    primary(14886, 'Other health associate professionals'),
                    supporting(14791, 'Administration professionals'),
                    supporting(15039, 'Personal care workers in health services')
                ]
            },
            {
                when: ['professional'],
                priors: [
                    primary(14791, 'Administration professionals'),
                    supporting(14914, 'Administrative and specialised secretaries'),
                    supporting(14927, 'Legal, social and religious associate professionals')
                ]
            },
            {
                when: ['office'],
                priors: [
                    primary(14791, 'Administration professionals'),
                    supporting(14919, 'Regulatory government associate professionals'),
                    supporting(14927, 'Legal, social and religious associate professionals')
                ]
            }
        ]
    },
    operator: {
        rules: [
            {
                when: ['process', 'process_plant'],
                priors: [
                    primary(14856, 'Process control technicians'),
                    supporting(15198, 'Other stationary plant and machine operators'),
                    supporting(14842, 'Physical and engineering science technicians')
                ]
            },
            {
                when: ['industrial_machine'],
                priors: [
                    primary(14842, 'Physical and engineering science technicians'),
                    supporting(15198, 'Other stationary plant and machine operators'),
                    supporting(14856, 'Process control technicians')
                ]
            },
            {
                when: ['ict'],
                priors: [
                    primary(14942, 'Information and communications technology operations and user support technicians'),
                    supporting(14842, 'Physical and engineering science technicians'),
                    supporting(14856, 'Process control technicians')
                ]
            },
            {
                when: ['telephony'],
                priors: [
                    primary(14965, 'Client information workers'),
                    supporting(14942, 'Information and communications technology operations and user support technicians'),
                    supporting(14842, 'Physical and engineering science technicians')
                ]
            }
        ],
        default: [
            primary(14856, 'Process control technicians'),
            supporting(14842, 'Physical and engineering science technicians'),
            supporting(14942, 'Information and communications technology operations and user support technicians')
        ]
    },
    specialist: {
        rules: [
            {
                when: ['communications'],
                priors: [
                    primary(14796, 'Sales, marketing and public relations professionals'),
                    supporting(14682, 'Sales, marketing and development managers'),
                    supporting(14828, 'Authors, journalists and linguists')
                ]
            }
        ]
    },
    supervisor: {
        rules: [
            {
                when: ['health'],
                priors: [
                    primary(14886, 'Other health associate professionals'),
                    supporting(14874, 'Medical and pharmaceutical technicians'),
                    supporting(14711, 'Other services managers')
                ]
            },
            {
                when: ['hospitality', 'retail'],
                priors: [primary(14706, 'Hotel and restaurant managers'), supporting(14711, 'Other services managers')]
            },
            {
                when: ['industrial'],
                priors: [primary(14852, 'Mining, manufacturing and construction supervisors'), supporting(14711, 'Other services managers')]
            }
        ],
        default: [
            primary(14852, 'Mining, manufacturing and construction supervisors'),
            supporting(14711, 'Other services managers'),
            supporting(14706, 'Hotel and restaurant managers')
        ]
    },
    technician: {
        rules: [
            {
                when: ['process'],
                priors: [
                    primary(14856, 'Process control technicians'),
                    supporting(14842, 'Physical and engineering science technicians'),
                    supporting(14942, 'Information and communications technology operations and user support technicians')
                ]
            },
            {
                when: ['ict'],
                priors: [
                    primary(14942, 'Information and communications technology operations and user support technicians'),
                    supporting(14842, 'Physical and engineering science technicians'),
                    supporting(14856, 'Process control technicians')
                ]
            },
            {
                when: ['health'],
                priors: [
                    primary(14874, 'Medical and pharmaceutical technicians'),
                    supporting(14842, 'Physical and engineering science technicians'),
                    supporting(14886, 'Other health associate professionals')
                ]
            },
            {
                when: ['life_science'],
                priors: [
                    primary(14863, 'Life science technicians and related associate professionals'),
                    supporting(14842, 'Physical and engineering science technicians'),
                    supporting(14874, 'Medical and pharmaceutical technicians')
                ]
            },
            {
                when: ['industrial', 'industrial_machine'],
                priors: [
                    primary(14842, 'Physical and engineering science technicians'),
                    supporting(14856, 'Process control technicians'),
                    supporting(14942, 'Information and communications technology operations and user support technicians')
                ]
            }
        ],
        default: [
            primary(14842, 'Physical and engineering science technicians'),
            supporting(14856, 'Process control technicians'),
            supporting(14942, 'Information and communications technology operations and user support technicians'),
            supporting(14874, 'Medical and pharmaceutical technicians'),
            supporting(14863, 'Life science technicians and related associate professionals')
        ]
    },
    worker: {
        rules: [
            {
                when: ['agriculture', 'life_science'],
                priors: [
                    primary(15236, 'Agricultural, forestry and fishery labourers'),
                    supporting(15270, 'Other elementary workers'),
                    supporting(15251, 'Transport and storage labourers')
                ]
            },
            {
                when: ['transport'],
                priors: [
                    primary(15251, 'Transport and storage labourers'),
                    supporting(15270, 'Other elementary workers'),
                    supporting(15244, 'Mining and construction labourers')
                ]
            },
            {
                when: ['construction'],
                priors: [
                    primary(15244, 'Mining and construction labourers'),
                    supporting(15248, 'Manufacturing labourers'),
                    supporting(15270, 'Other elementary workers')
                ]
            },
            {
                when: ['industrial', 'industrial_machine'],
                priors: [
                    primary(15248, 'Manufacturing labourers'),
                    supporting(15244, 'Mining and construction labourers'),
                    supporting(15270, 'Other elementary workers')
                ]
            },
            {
                when: ['hospitality'],
                priors: [
                    primary(15227, 'Domestic, hotel and office cleaners and helpers'),
                    supporting(15257, 'Food preparation assistants'),
                    supporting(15270, 'Other elementary workers')
                ]
            }
        ]
    }
};
const GENERIC_HEAD_SYNONYMS = {
    assistant: ['assistant', 'asistent', 'asszisztens'],
    consultant: ['consultant', 'konsultant', 'tanacsado'],
    manager: ['administrator', 'manager', 'menedzser', 'vezeto'],
    officer: ['ofiter', 'officer'],
    operator: ['operator'],
    specialist: ['specialist', 'szakerto'],
    supervisor: ['supervisor', 'supervizor'],
    technician: ['technik', 'tehnician', 'technician', 'technikus'],
    worker: ['dolgozo', 'lucrator', 'muncitor', 'munkas', 'munkatars', 'worker']
};
const GENERIC_HEAD_VENUE_SYNONYMS = {
    agriculture: ['agriculture', 'agricultural', 'farm', 'ferma', 'garden', 'ranch'],
    communications: [
        'communications',
        'comunicare',
        'comunicatii',
        'kommunikacio',
        'marketing',
        'media',
        'meedia',
        'pr',
        'social',
        'kozossegi',
        'sotsiaalne',
        'suhtlus',
        'kommunikatsioon',
        'turundus'
    ],
    construction: ['building', 'construction', 'santier'],
    health: [
        'clinic',
        'clinica',
        'farmacie',
        'gyogyszertar',
        'health',
        'hospital',
        'korhaz',
        'lab',
        'labor',
        'laborator',
        'laboratory',
        'medical',
        'pharmacy',
        'spital',
        'apteek',
        'haigla',
        'klinikai',
        'klinika',
        'kliinik'
    ],
    hospitality: ['bakery', 'brutarie', 'bucatarie', 'etterem', 'hotel', 'hotell', 'kitchen', 'restaurant', 'restoran'],
    ict: [
        'center',
        'centre',
        'computer',
        'data',
        'it',
        'network',
        'sap',
        'sistem',
        'sisteme',
        'software',
        'sustav',
        'system',
        'systems',
        'szoftver',
        'tarkvara',
        'telecom',
        'telecommunications',
        'rendszer',
        'susteem'
    ],
    industrial: [
        'airport',
        'aeroport',
        'assembly',
        'atelier',
        'depot',
        'factory',
        'fabrica',
        'gyar',
        'lennujaam',
        'maintenance',
        'manufacturing',
        'plant',
        'production',
        'refinery',
        'repuloter',
        'site',
        'tehas',
        'uzina',
        'warehouse'
    ],
    industrial_machine: ['assembly', 'engineering', 'machine', 'machinery', 'manufacturing', 'production'],
    life_science: ['agricultural', 'agriculture', 'aquaculture', 'forest', 'forestry', 'viticulture'],
    office: ['birou', 'branch', 'iroda', 'kontor', 'office'],
    process: ['chemical', 'power', 'process', 'refinery', 'waste', 'water'],
    process_plant: ['factory', 'plant'],
    professional: ['clinic', 'hospital', 'school', 'scoala', 'iskola'],
    retail: ['brutarie', 'magazin', 'retail', 'shop', 'store'],
    telephony: ['call', 'contact', 'switchboard', 'telephone'],
    transport: ['depot', 'depozit', 'logistics', 'raktar', 'transport', 'warehouse', 'ladu']
};
const GENERIC_HEAD_ALIAS_TO_CARRIER = buildAliasMap(GENERIC_HEAD_SYNONYMS);
const GENERIC_HEAD_VENUE_ALIAS_TO_CARRIERS = buildMultiAliasMap(GENERIC_HEAD_VENUE_SYNONYMS);
function primary(familyNodeId, familyLabel) {
    return {
        familyNodeId,
        familyLabel,
        strength: 'primary'
    };
}
function supporting(familyNodeId, familyLabel) {
    return {
        familyNodeId,
        familyLabel,
        strength: 'supporting'
    };
}
function deriveVenueCarrierSet(roleTokens, venueTokens) {
    const carriers = new Set();
    for (const token of [...roleTokens, ...venueTokens]) {
        for (const carrier of normalizeGenericHeadVenueCarriers(token)) {
            carriers.add(carrier);
        }
    }
    return carriers;
}
function matchesAnyVenueCarrier(context, carriers) {
    return carriers.some((carrier) => context.has(carrier));
}
function normalizeGenericHeadCarrier(value) {
    const normalized = normalizePriorToken(value);
    if (!normalized) {
        return undefined;
    }
    return GENERIC_HEAD_ALIAS_TO_CARRIER.get(normalized);
}
function normalizeGenericHeadVenueCarriers(value) {
    const normalized = normalizePriorToken(value);
    if (!normalized) {
        return [];
    }
    return GENERIC_HEAD_VENUE_ALIAS_TO_CARRIERS.get(normalized) ?? [];
}
function buildAliasMap(synonyms) {
    const aliases = new Map();
    for (const [carrier, variants] of Object.entries(synonyms)) {
        for (const variant of variants) {
            aliases.set(normalizePriorToken(variant), carrier);
        }
    }
    return aliases;
}
function buildMultiAliasMap(synonyms) {
    const aliases = new Map();
    for (const [carrier, variants] of Object.entries(synonyms)) {
        for (const variant of variants) {
            const key = normalizePriorToken(variant);
            const existing = aliases.get(key);
            if (existing) {
                existing.push(carrier);
            }
            else {
                aliases.set(key, [carrier]);
            }
        }
    }
    return aliases;
}
function normalizePriorToken(value) {
    return foldSearchText(value).trim();
}
