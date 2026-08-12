const JOB_FUNCTION_FAMILY_PRIORS = {
    administration: [
        primary(14791, 'Administration professionals'),
        primary(14952, 'General office clerks'),
        supporting(14914, 'Administrative and specialised secretaries'),
        supporting(14984, 'Other clerical support workers'),
        supporting(14954, 'Secretaries (general)')
    ],
    animal_care_childcare_cleaning: [
        primary(15036, 'Child care workers and teachers’ aides'),
        primary(15227, 'Domestic, hotel and office cleaners and helpers'),
        supporting(15230, 'Vehicle, window, laundry and other hand cleaning workers'),
        supporting(14884, 'Veterinary technicians and assistants'),
        supporting(14757, 'Veterinarians')
    ],
    architecture_design: [
        primary(14739, 'Architects, planners, surveyors and designers'),
        supporting(14832, 'Creative and performing artists'),
        supporting(14935, 'Artistic, cultural and culinary associate professionals')
    ],
    arts_entertainment: [
        primary(14832, 'Creative and performing artists'),
        primary(14935, 'Artistic, cultural and culinary associate professionals'),
        supporting(14828, 'Authors, journalists and linguists'),
        supporting(14931, 'Sports and fitness workers')
    ],
    banking: [
        primary(14787, 'Finance professionals'),
        primary(14897, 'Financial and mathematical associate professionals'),
        supporting(14960, 'Tellers, money collectors and related clerks'),
        supporting(14975, 'Numerical clerks')
    ],
    business_development: [
        primary(14682, 'Sales, marketing and development managers'),
        primary(14796, 'Sales, marketing and public relations professionals'),
        supporting(14903, 'Sales and purchasing agents and brokers'),
        supporting(14908, 'Business services agents')
    ],
    community_social_services: [
        primary(14821, 'Social and religious professionals'),
        primary(14927, 'Legal, social and religious associate professionals'),
        supporting(15039, 'Personal care workers in health services'),
        supporting(14711, 'Other services managers')
    ],
    consulting_strategy: [
        primary(14697, 'Professional services managers'),
        primary(14677, 'Business services and administration managers'),
        supporting(14908, 'Business services agents'),
        supporting(14791, 'Administration professionals')
    ],
    customer_support: [
        primary(14965, 'Client information workers'),
        supporting(14952, 'General office clerks'),
        supporting(14984, 'Other clerical support workers')
    ],
    education_training: [
        primary(14775, 'Primary school and early childhood teachers'),
        primary(14773, 'Secondary education teachers'),
        primary(14769, 'University and higher education teachers'),
        supporting(14771, 'Vocational education teachers'),
        supporting(14778, 'Other teaching professionals'),
        supporting(15036, 'Child care workers and teachers’ aides')
    ],
    engineering: [
        primary(14727, 'Engineering professionals (excluding electrotechnology)'),
        primary(14735, 'Electrotechnology engineers'),
        supporting(14842, 'Physical and engineering science technicians'),
        supporting(14856, 'Process control technicians')
    ],
    finance_accounting: [
        primary(14787, 'Finance professionals'),
        primary(14897, 'Financial and mathematical associate professionals'),
        supporting(14975, 'Numerical clerks'),
        supporting(14721, 'Mathematicians, actuaries and statisticians')
    ],
    health_safety: [
        primary(15044, 'Protective services workers'),
        supporting(14919, 'Regulatory government associate professionals'),
        supporting(14886, 'Other health associate professionals'),
        supporting(14759, 'Other health professionals')
    ],
    healthcare: [
        primary(14747, 'Medical doctors'),
        primary(14750, 'Nursing and midwifery professionals'),
        primary(14879, 'Nursing and midwifery associate professionals'),
        supporting(14759, 'Other health professionals'),
        supporting(14886, 'Other health associate professionals'),
        supporting(15039, 'Personal care workers in health services'),
        supporting(14874, 'Medical and pharmaceutical technicians')
    ],
    hospitality_food_service: [
        primary(14998, 'Cooks'),
        primary(15257, 'Food preparation assistants'),
        primary(15000, 'Waiters and bartenders'),
        supporting(14706, 'Hotel and restaurant managers'),
        supporting(15227, 'Domestic, hotel and office cleaners and helpers')
    ],
    human_resources: [
        primary(14677, 'Business services and administration managers'),
        supporting(14791, 'Administration professionals'),
        supporting(14908, 'Business services agents')
    ],
    insurance: [
        primary(14787, 'Finance professionals'),
        primary(14897, 'Financial and mathematical associate professionals'),
        supporting(14903, 'Sales and purchasing agents and brokers'),
        supporting(14960, 'Tellers, money collectors and related clerks')
    ],
    it_software_data: [
        primary(14802, 'Software and applications developers and analysts'),
        primary(14808, 'Database and network professionals'),
        supporting(14942, 'Information and communications technology operations and user support technicians'),
        supporting(14695, 'Information and communications technology service managers')
    ],
    legal_compliance: [
        primary(14814, 'Legal professionals'),
        primary(14927, 'Legal, social and religious associate professionals'),
        supporting(14919, 'Regulatory government associate professionals'),
        supporting(14697, 'Professional services managers')
    ],
    management: [
        primary(14674, 'Managing directors and chief executives'),
        primary(14677, 'Business services and administration managers'),
        primary(14697, 'Professional services managers'),
        supporting(14682, 'Sales, marketing and development managers'),
        supporting(14690, 'Manufacturing, mining, construction, and distribution managers'),
        supporting(14711, 'Other services managers')
    ],
    marketing_communications: [
        primary(14796, 'Sales, marketing and public relations professionals'),
        primary(14682, 'Sales, marketing and development managers'),
        supporting(14828, 'Authors, journalists and linguists'),
        supporting(14935, 'Artistic, cultural and culinary associate professionals')
    ],
    mechanical_technical: [
        primary(15114, 'Machinery mechanics and repairers'),
        primary(15135, 'Electrical equipment installers and repairers'),
        primary(15139, 'Electronics and telecommunications installers and repairers'),
        supporting(14842, 'Physical and engineering science technicians'),
        supporting(14856, 'Process control technicians'),
        supporting(15109, 'Blacksmiths, toolmakers and related trades workers')
    ],
    mining_natural_resources: [
        primary(15169, 'Mining and mineral processing plant operators'),
        primary(15244, 'Mining and construction labourers'),
        supporting(14716, 'Physical and earth science professionals'),
        supporting(14852, 'Mining, manufacturing and construction supervisors')
    ],
    operations_logistics: [
        primary(14979, 'Material-recording and transport clerks'),
        primary(15251, 'Transport and storage labourers'),
        supporting(15218, 'Mobile plant operators'),
        supporting(14690, 'Manufacturing, mining, construction, and distribution managers'),
        supporting(15215, 'Heavy truck and bus drivers')
    ],
    physical_manual_work: [
        primary(15248, 'Manufacturing labourers'),
        primary(15244, 'Mining and construction labourers'),
        supporting(15270, 'Other elementary workers'),
        supporting(15227, 'Domestic, hotel and office cleaners and helpers'),
        supporting(15251, 'Transport and storage labourers')
    ],
    procurement: [
        primary(14903, 'Sales and purchasing agents and brokers'),
        supporting(14979, 'Material-recording and transport clerks'),
        supporting(14908, 'Business services agents')
    ],
    project_management: [
        primary(14677, 'Business services and administration managers'),
        primary(14697, 'Professional services managers'),
        supporting(14690, 'Manufacturing, mining, construction, and distribution managers'),
        supporting(14682, 'Sales, marketing and development managers')
    ],
    quality_assurance: [
        primary(14856, 'Process control technicians'),
        primary(14842, 'Physical and engineering science technicians'),
        supporting(14919, 'Regulatory government associate professionals'),
        supporting(14852, 'Mining, manufacturing and construction supervisors')
    ],
    research_development: [
        primary(14723, 'Life science professionals'),
        primary(14716, 'Physical and earth science professionals'),
        supporting(14863, 'Life science technicians and related associate professionals'),
        supporting(14721, 'Mathematicians, actuaries and statisticians'),
        supporting(14842, 'Physical and engineering science technicians')
    ],
    sales_commerce: [
        primary(15021, 'Shop salespersons'),
        primary(14903, 'Sales and purchasing agents and brokers'),
        primary(14796, 'Sales, marketing and public relations professionals'),
        supporting(14709, 'Retail and wholesale trade managers'),
        supporting(15025, 'Cashiers and ticket clerks')
    ],
    security: [
        primary(15044, 'Protective services workers'),
        supporting(14665, 'Armed forces occupations, other ranks'),
        supporting(14659, 'Commissioned armed forces officers'),
        supporting(14662, 'Non-commissioned armed forces officers')
    ],
    skilled_trades: [
        primary(15083, 'Building frame and related trades workers'),
        primary(15090, 'Building finishers and related trades workers'),
        primary(15114, 'Machinery mechanics and repairers'),
        primary(15135, 'Electrical equipment installers and repairers'),
        supporting(15244, 'Mining and construction labourers'),
        supporting(15098, 'Painters, building structure cleaners and related trades workers'),
        supporting(15109, 'Blacksmiths, toolmakers and related trades workers'),
        supporting(15103, 'Sheet and structural metal workers, moulders and welders, and related workers'),
        supporting(15143, 'Food processing and related trades workers'),
        supporting(15150, 'Wood treaters, cabinet-makers and related trades workers')
    ],
    transport_driving: [
        primary(15212, 'Car, van and motorcycle drivers'),
        primary(15215, 'Heavy truck and bus drivers'),
        supporting(15209, 'Locomotive engine drivers and related workers'),
        supporting(15223, 'Ships’ deck crews and related workers'),
        supporting(14994, 'Travel attendants, conductors and guides'),
        supporting(14867, 'Ship and aircraft controllers and technicians')
    ],
    volunteering_internships: []
};
export function normalizeJobFunction(value) {
    const normalized = value?.trim().toLowerCase().replace(/-/gu, '_') ?? '';
    return normalized || null;
}
export function getJobFunctionFamilyPriors(value) {
    const normalized = normalizeJobFunction(value);
    if (!normalized || !Object.prototype.hasOwnProperty.call(JOB_FUNCTION_FAMILY_PRIORS, normalized)) {
        return [];
    }
    return JOB_FUNCTION_FAMILY_PRIORS[normalized];
}
export function isKnownJobFunction(value) {
    const normalized = normalizeJobFunction(value);
    return Boolean(normalized && normalized in JOB_FUNCTION_FAMILY_PRIORS);
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
