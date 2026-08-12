const GENERIC_HEAD_FAMILY_PRIORS = {
    assistant: [
        primary(14791, 'Administration professionals'),
        supporting(14914, 'Administrative and specialised secretaries'),
        supporting(14952, 'General office clerks')
    ],
    manager: [
        primary(14677, 'Business services and administration managers'),
        supporting(14697, 'Professional services managers'),
        supporting(14711, 'Other services managers')
    ],
    officer: [
        primary(14791, 'Administration professionals'),
        supporting(14927, 'Legal, social and religious associate professionals'),
        supporting(14919, 'Regulatory government associate professionals')
    ],
    operator: [
        primary(14856, 'Process control technicians'),
        supporting(14842, 'Physical and engineering science technicians'),
        supporting(14942, 'Information and communications technology operations and user support technicians')
    ],
    specialist: [],
    supervisor: [
        primary(14711, 'Other services managers'),
        supporting(14706, 'Hotel and restaurant managers'),
        supporting(14852, 'Mining, manufacturing and construction supervisors')
    ],
    technician: [
        primary(14842, 'Physical and engineering science technicians'),
        supporting(14856, 'Process control technicians'),
        supporting(14942, 'Information and communications technology operations and user support technicians'),
        supporting(14874, 'Medical and pharmaceutical technicians'),
        supporting(14863, 'Life science technicians and related associate professionals')
    ],
    worker: [
        primary(15270, 'Other elementary workers'),
        supporting(15227, 'Domestic, hotel and office cleaners and helpers'),
        supporting(15251, 'Transport and storage labourers')
    ]
};
export function getGenericHeadFamilyPriors(roleHeadTokens, roleTokens, venueTokens, hasCuratedRolePhrase) {
    if (hasCuratedRolePhrase || roleHeadTokens.length === 0) {
        return [];
    }
    const normalizedHead = normalizeGenericHead(roleHeadTokens[roleHeadTokens.length - 1] ?? '');
    if (!normalizedHead) {
        return [];
    }
    if (normalizedHead === 'supervisor') {
        return supervisorFamilyPriors(roleTokens, venueTokens);
    }
    if (normalizedHead === 'manager') {
        return managerFamilyPriors(roleTokens, venueTokens);
    }
    if (normalizedHead === 'assistant') {
        return assistantFamilyPriors(roleTokens, venueTokens);
    }
    if (normalizedHead === 'operator') {
        return operatorFamilyPriors(roleTokens, venueTokens);
    }
    if (normalizedHead === 'officer') {
        return officerFamilyPriors(roleTokens, venueTokens);
    }
    if (normalizedHead === 'technician') {
        return technicianFamilyPriors(roleTokens, venueTokens);
    }
    if (normalizedHead === 'worker') {
        return workerFamilyPriors(roleTokens, venueTokens);
    }
    if (!Object.prototype.hasOwnProperty.call(GENERIC_HEAD_FAMILY_PRIORS, normalizedHead)) {
        return [];
    }
    return GENERIC_HEAD_FAMILY_PRIORS[normalizedHead];
}
export function hasGenericHeadVenueContext(roleTokens, venueTokens) {
    return derivedVenueTokenSet(roleTokens, venueTokens).size > 0;
}
function supervisorFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const hasHealthVenue = venueSet.has('clinic') ||
        venueSet.has('farmacie') ||
        venueSet.has('health') ||
        venueSet.has('hospital') ||
        venueSet.has('laborator') ||
        venueSet.has('laboratory') ||
        venueSet.has('lab') ||
        venueSet.has('medical') ||
        venueSet.has('pharmacy') ||
        venueSet.has('spital');
    const hasHospitalityVenue = venueSet.has('restaurant') || venueSet.has('hotel') || venueSet.has('kitchen') || venueSet.has('shop') || venueSet.has('store');
    const hasIndustrialVenue = venueSet.has('factory') ||
        venueSet.has('warehouse') ||
        venueSet.has('plant') ||
        venueSet.has('depot') ||
        venueSet.has('site') ||
        venueSet.has('airport');
    if (hasHealthVenue) {
        return [
            primary(14886, 'Other health associate professionals'),
            supporting(14874, 'Medical and pharmaceutical technicians'),
            supporting(14711, 'Other services managers')
        ];
    }
    if (hasHospitalityVenue) {
        return [primary(14706, 'Hotel and restaurant managers'), supporting(14711, 'Other services managers')];
    }
    if (hasIndustrialVenue) {
        return [primary(14852, 'Mining, manufacturing and construction supervisors'), supporting(14711, 'Other services managers')];
    }
    return [
        primary(14711, 'Other services managers'),
        supporting(14706, 'Hotel and restaurant managers'),
        supporting(14852, 'Mining, manufacturing and construction supervisors')
    ];
}
function managerFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const hasHospitalityVenue = venueSet.has('restaurant') || venueSet.has('hotel') || venueSet.has('kitchen');
    const hasRetailVenue = venueSet.has('shop') || venueSet.has('store');
    const hasIndustrialVenue = venueSet.has('factory') ||
        venueSet.has('warehouse') ||
        venueSet.has('plant') ||
        venueSet.has('depot') ||
        venueSet.has('site') ||
        venueSet.has('airport');
    const hasProfessionalVenue = venueSet.has('hospital') || venueSet.has('clinic') || venueSet.has('school');
    const hasOfficeVenue = venueSet.has('office') || venueSet.has('branch');
    if (hasHospitalityVenue) {
        return [
            primary(14706, 'Hotel and restaurant managers'),
            supporting(14709, 'Retail and wholesale trade managers'),
            supporting(14677, 'Business services and administration managers')
        ];
    }
    if (hasRetailVenue) {
        return [
            primary(14709, 'Retail and wholesale trade managers'),
            supporting(14677, 'Business services and administration managers'),
            supporting(14706, 'Hotel and restaurant managers')
        ];
    }
    if (hasIndustrialVenue) {
        return [
            primary(14690, 'Manufacturing, mining, construction, and distribution managers'),
            supporting(14677, 'Business services and administration managers'),
            supporting(14709, 'Retail and wholesale trade managers')
        ];
    }
    if (hasProfessionalVenue) {
        return [
            primary(14697, 'Professional services managers'),
            supporting(14677, 'Business services and administration managers'),
            supporting(14711, 'Other services managers')
        ];
    }
    if (hasOfficeVenue) {
        return [
            primary(14677, 'Business services and administration managers'),
            supporting(14697, 'Professional services managers'),
            supporting(14711, 'Other services managers')
        ];
    }
    return [
        primary(14697, 'Professional services managers'),
        supporting(14677, 'Business services and administration managers'),
        supporting(14711, 'Other services managers')
    ];
}
function assistantFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const hasHealthVenue = venueSet.has('clinic') ||
        venueSet.has('farmacie') ||
        venueSet.has('health') ||
        venueSet.has('hospital') ||
        venueSet.has('laborator') ||
        venueSet.has('laboratory') ||
        venueSet.has('lab') ||
        venueSet.has('medical') ||
        venueSet.has('pharmacy') ||
        venueSet.has('spital');
    const hasEducationVenue = venueSet.has('school');
    const hasHospitalityVenue = venueSet.has('restaurant') || venueSet.has('hotel') || venueSet.has('kitchen');
    const hasRetailVenue = venueSet.has('shop') || venueSet.has('store');
    const hasOfficeVenue = venueSet.has('office') || venueSet.has('branch');
    if (hasHealthVenue) {
        return [
            primary(15039, 'Personal care workers in health services'),
            supporting(14886, 'Other health associate professionals'),
            supporting(14791, 'Administration professionals')
        ];
    }
    if (hasEducationVenue) {
        return [
            primary(15036, "Child care workers and teachers' aides"),
            supporting(14791, 'Administration professionals'),
            supporting(15039, 'Personal care workers in health services')
        ];
    }
    if (hasHospitalityVenue) {
        return [
            primary(15257, 'Food preparation assistants'),
            supporting(14791, 'Administration professionals'),
            supporting(15021, 'Shop salespersons')
        ];
    }
    if (hasRetailVenue) {
        return [
            primary(15021, 'Shop salespersons'),
            supporting(14791, 'Administration professionals'),
            supporting(15257, 'Food preparation assistants')
        ];
    }
    if (hasOfficeVenue) {
        return [
            primary(14791, 'Administration professionals'),
            supporting(14914, 'Administrative and specialised secretaries'),
            supporting(15036, "Child care workers and teachers' aides")
        ];
    }
    return [
        primary(14791, 'Administration professionals'),
        supporting(14914, 'Administrative and specialised secretaries'),
        supporting(15036, "Child care workers and teachers' aides")
    ];
}
function officerFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const hasHealthVenue = venueSet.has('clinic') ||
        venueSet.has('farmacie') ||
        venueSet.has('health') ||
        venueSet.has('hospital') ||
        venueSet.has('laborator') ||
        venueSet.has('laboratory') ||
        venueSet.has('lab') ||
        venueSet.has('medical') ||
        venueSet.has('pharmacy') ||
        venueSet.has('spital');
    const hasEducationVenue = venueSet.has('school');
    const hasOfficeVenue = venueSet.has('office') || venueSet.has('branch');
    if (hasHealthVenue) {
        return [
            primary(14886, 'Other health associate professionals'),
            supporting(14791, 'Administration professionals'),
            supporting(15039, 'Personal care workers in health services')
        ];
    }
    if (hasEducationVenue) {
        return [
            primary(14791, 'Administration professionals'),
            supporting(14914, 'Administrative and specialised secretaries'),
            supporting(14927, 'Legal, social and religious associate professionals')
        ];
    }
    if (hasOfficeVenue) {
        return [
            primary(14791, 'Administration professionals'),
            supporting(14919, 'Regulatory government associate professionals'),
            supporting(14927, 'Legal, social and religious associate professionals')
        ];
    }
    return [
        primary(14791, 'Administration professionals'),
        supporting(14919, 'Regulatory government associate professionals'),
        supporting(14927, 'Legal, social and religious associate professionals')
    ];
}
function operatorFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const hasProcessVenue = venueSet.has('factory') ||
        venueSet.has('plant') ||
        venueSet.has('refinery') ||
        venueSet.has('chemical') ||
        venueSet.has('water') ||
        venueSet.has('waste') ||
        venueSet.has('power') ||
        venueSet.has('process');
    const hasIndustrialMachineVenue = venueSet.has('machine') ||
        venueSet.has('machinery') ||
        venueSet.has('production') ||
        venueSet.has('assembly') ||
        venueSet.has('manufacturing');
    const hasICTVenue = venueSet.has('computer') || venueSet.has('data') || venueSet.has('network') || venueSet.has('centre') || venueSet.has('center');
    const hasCommunicationVenue = venueSet.has('telephone') || venueSet.has('contact') || venueSet.has('call') || venueSet.has('switchboard');
    if (hasProcessVenue) {
        return [
            primary(14856, 'Process control technicians'),
            supporting(15198, 'Other stationary plant and machine operators'),
            supporting(14842, 'Physical and engineering science technicians')
        ];
    }
    if (hasIndustrialMachineVenue) {
        return [
            primary(14842, 'Physical and engineering science technicians'),
            supporting(15198, 'Other stationary plant and machine operators'),
            supporting(14856, 'Process control technicians')
        ];
    }
    if (hasICTVenue) {
        return [
            primary(14942, 'Information and communications technology operations and user support technicians'),
            supporting(14842, 'Physical and engineering science technicians'),
            supporting(14856, 'Process control technicians')
        ];
    }
    if (hasCommunicationVenue) {
        return [
            primary(14965, 'Client information workers'),
            supporting(14942, 'Information and communications technology operations and user support technicians'),
            supporting(14842, 'Physical and engineering science technicians')
        ];
    }
    return [
        primary(14856, 'Process control technicians'),
        supporting(14842, 'Physical and engineering science technicians'),
        supporting(14942, 'Information and communications technology operations and user support technicians')
    ];
}
function technicianFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const tokenSet = normalizedTokenSet(roleTokens);
    const hasProcessVenue = venueSet.has('process') ||
        venueSet.has('refinery') ||
        venueSet.has('chemical') ||
        venueSet.has('water') ||
        venueSet.has('waste') ||
        venueSet.has('power');
    const hasIndustrialVenue = venueSet.has('factory') ||
        venueSet.has('plant') ||
        venueSet.has('warehouse') ||
        venueSet.has('depot') ||
        venueSet.has('site') ||
        venueSet.has('airport') ||
        venueSet.has('manufacturing') ||
        venueSet.has('production') ||
        venueSet.has('assembly') ||
        venueSet.has('machine') ||
        venueSet.has('machinery') ||
        venueSet.has('maintenance') ||
        venueSet.has('engineering');
    const hasICTVenue = venueSet.has('computer') ||
        venueSet.has('network') ||
        venueSet.has('telecom') ||
        venueSet.has('telecommunications') ||
        venueSet.has('data');
    const hasMedicalVenue = venueSet.has('medical') ||
        venueSet.has('health') ||
        venueSet.has('hospital') ||
        venueSet.has('clinic') ||
        venueSet.has('laboratory') ||
        venueSet.has('lab') ||
        venueSet.has('pharmacy');
    const hasLifeScienceVenue = venueSet.has('agricultural') ||
        venueSet.has('agriculture') ||
        venueSet.has('forestry') ||
        venueSet.has('forest') ||
        venueSet.has('aquaculture') ||
        venueSet.has('viticulture');
    if (hasProcessVenue) {
        return [
            primary(14856, 'Process control technicians'),
            supporting(14842, 'Physical and engineering science technicians'),
            supporting(14942, 'Information and communications technology operations and user support technicians')
        ];
    }
    if (hasICTVenue || tokenSet.has('computer')) {
        return [
            primary(14942, 'Information and communications technology operations and user support technicians'),
            supporting(14842, 'Physical and engineering science technicians'),
            supporting(14856, 'Process control technicians')
        ];
    }
    if (hasMedicalVenue || tokenSet.has('medical') || tokenSet.has('pharmacy')) {
        return [
            primary(14874, 'Medical and pharmaceutical technicians'),
            supporting(14842, 'Physical and engineering science technicians'),
            supporting(14886, 'Other health associate professionals')
        ];
    }
    if (hasLifeScienceVenue || tokenSet.has('agricultural') || tokenSet.has('forestry')) {
        return [
            primary(14863, 'Life science technicians and related associate professionals'),
            supporting(14842, 'Physical and engineering science technicians'),
            supporting(14874, 'Medical and pharmaceutical technicians')
        ];
    }
    if (hasIndustrialVenue) {
        return [
            primary(14842, 'Physical and engineering science technicians'),
            supporting(14856, 'Process control technicians'),
            supporting(14942, 'Information and communications technology operations and user support technicians')
        ];
    }
    return [
        primary(14842, 'Physical and engineering science technicians'),
        supporting(14856, 'Process control technicians'),
        supporting(14942, 'Information and communications technology operations and user support technicians'),
        supporting(14874, 'Medical and pharmaceutical technicians'),
        supporting(14863, 'Life science technicians and related associate professionals')
    ];
}
function workerFamilyPriors(roleTokens, venueTokens) {
    const venueSet = derivedVenueTokenSet(roleTokens, venueTokens);
    const hasAgricultureVenue = venueSet.has('farm') ||
        venueSet.has('agriculture') ||
        venueSet.has('agricultural') ||
        venueSet.has('forestry') ||
        venueSet.has('forest') ||
        venueSet.has('aquaculture') ||
        venueSet.has('garden') ||
        venueSet.has('ranch');
    const hasTransportVenue = venueSet.has('warehouse') || venueSet.has('depot') || venueSet.has('logistics') || venueSet.has('transport');
    const hasConstructionVenue = venueSet.has('site') || venueSet.has('construction') || venueSet.has('building');
    const hasIndustrialVenue = venueSet.has('factory') ||
        venueSet.has('plant') ||
        venueSet.has('manufacturing') ||
        venueSet.has('production') ||
        venueSet.has('assembly');
    const hasHospitalityVenue = venueSet.has('hotel') || venueSet.has('restaurant') || venueSet.has('kitchen');
    if (hasAgricultureVenue) {
        return [
            primary(15236, 'Agricultural, forestry and fishery labourers'),
            supporting(15270, 'Other elementary workers'),
            supporting(15251, 'Transport and storage labourers')
        ];
    }
    if (hasTransportVenue) {
        return [
            primary(15251, 'Transport and storage labourers'),
            supporting(15270, 'Other elementary workers'),
            supporting(15244, 'Mining and construction labourers')
        ];
    }
    if (hasConstructionVenue) {
        return [
            primary(15244, 'Mining and construction labourers'),
            supporting(15248, 'Manufacturing labourers'),
            supporting(15270, 'Other elementary workers')
        ];
    }
    if (hasIndustrialVenue) {
        return [
            primary(15248, 'Manufacturing labourers'),
            supporting(15244, 'Mining and construction labourers'),
            supporting(15270, 'Other elementary workers')
        ];
    }
    if (hasHospitalityVenue) {
        return [
            primary(15227, 'Domestic, hotel and office cleaners and helpers'),
            supporting(15257, 'Food preparation assistants'),
            supporting(15270, 'Other elementary workers')
        ];
    }
    return [
        primary(15270, 'Other elementary workers'),
        supporting(15244, 'Mining and construction labourers'),
        supporting(15251, 'Transport and storage labourers')
    ];
}
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
function derivedVenueTokenSet(roleTokens, venueTokens) {
    const venueSet = new Set(venueTokens.map((token) => token.trim().toLowerCase()));
    for (const token of roleTokens) {
        const normalized = token.trim().toLowerCase();
        if (GENERIC_HEAD_VENUE_MARKERS.has(normalized)) {
            venueSet.add(normalized);
        }
    }
    return venueSet;
}
function normalizedTokenSet(tokens) {
    const normalized = new Set();
    for (const token of tokens) {
        const value = token.trim().toLowerCase();
        if (value) {
            normalized.add(value);
        }
    }
    return normalized;
}
const GENERIC_HEAD_VENUE_MARKERS = new Set([
    'airport',
    'agriculture',
    'agricultural',
    'aquaculture',
    'building',
    'branch',
    'clinic',
    'clinica',
    'clinică',
    'construction',
    'computer',
    'depot',
    'depozit',
    'factory',
    'fabrica',
    'fabrică',
    'farm',
    'farmacie',
    'forest',
    'forestry',
    'garden',
    'health',
    'hospital',
    'hotel',
    'laborator',
    'kitchen',
    'lab',
    'laboratory',
    'logistics',
    'medical',
    'network',
    'office',
    'pharmacy',
    'plant',
    'production',
    'restaurant',
    'retail',
    'school',
    'spital',
    'shop',
    'site',
    'store',
    'transport',
    'telecom',
    'telecommunications',
    'warehouse'
]);
const GENERIC_HEAD_ALIASES = new Map([
    ['assistant', 'assistant'],
    ['lucrator', 'worker'],
    ['lucrător', 'worker'],
    ['manager', 'manager'],
    ['ofiter', 'officer'],
    ['ofițer', 'officer'],
    ['operator', 'operator'],
    ['specialist', 'specialist'],
    ['supervizor', 'supervisor'],
    ['supervisor', 'supervisor'],
    ['tehnician', 'technician'],
    ['worker', 'worker']
]);
function normalizeGenericHead(value) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
        return '';
    }
    return GENERIC_HEAD_ALIASES.get(normalized) ?? normalized;
}
