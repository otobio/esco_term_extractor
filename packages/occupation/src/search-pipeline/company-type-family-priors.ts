export type CompanyTypeFamilyPriorStrength = 'primary' | 'supporting';

export type CompanyTypeFamilyPrior = {
  familyNodeId: number;
  familyLabel: string;
  strength: CompanyTypeFamilyPriorStrength;
};

const COMPANY_TYPE_PREFIX = 'company_type:';

const COMPANY_TYPE_FAMILY_PRIORS: Readonly<Record<string, readonly CompanyTypeFamilyPrior[]>> = {
  'company_type:agency': [
    primary(14908, 'Business services agents'),
    supporting(14677, 'Business services and administration managers'),
    supporting(14965, 'Client information workers')
  ],
  'company_type:agriculture_agri_business': [
    primary(15236, 'Agricultural, forestry and fishery labourers'),
    primary(15052, 'Market gardeners and crop growers'),
    primary(15057, 'Animal producers'),
    supporting(15062, 'Mixed crop and animal producers'),
    supporting(15065, 'Forestry and related workers'),
    supporting(15067, 'Fishery workers, hunters and trappers'),
    supporting(14687, 'Production managers in agriculture, forestry and fisheries')
  ],
  'company_type:automotive': [
    primary(15114, 'Machinery mechanics and repairers'),
    supporting(15212, 'Car, van and motorcycle drivers'),
    supporting(15204, 'Assemblers'),
    supporting(14842, 'Physical and engineering science technicians')
  ],
  'company_type:aviation': [
    primary(14867, 'Ship and aircraft controllers and technicians'),
    supporting(14994, 'Travel attendants, conductors and guides'),
    supporting(14727, 'Engineering professionals (excluding electrotechnology)'),
    supporting(14842, 'Physical and engineering science technicians')
  ],
  'company_type:banking_financial_services': [
    primary(14787, 'Finance professionals'),
    primary(14897, 'Financial and mathematical associate professionals'),
    supporting(14960, 'Tellers, money collectors and related clerks'),
    supporting(14975, 'Numerical clerks'),
    supporting(14903, 'Sales and purchasing agents and brokers')
  ],
  'company_type:cleaning_facilities': [
    primary(15227, 'Domestic, hotel and office cleaners and helpers'),
    supporting(15230, 'Vehicle, window, laundry and other hand cleaning workers'),
    supporting(15006, 'Building and housekeeping supervisors')
  ],
  'company_type:construction': [
    primary(15083, 'Building frame and related trades workers'),
    primary(15090, 'Building finishers and related trades workers'),
    primary(15244, 'Mining and construction labourers'),
    supporting(15098, 'Painters, building structure cleaners and related trades workers'),
    supporting(14852, 'Mining, manufacturing and construction supervisors'),
    supporting(14690, 'Manufacturing, mining, construction, and distribution managers'),
    supporting(14739, 'Architects, planners, surveyors and designers'),
    supporting(14727, 'Engineering professionals (excluding electrotechnology)'),
    supporting(14842, 'Physical and engineering science technicians')
  ],
  'company_type:education': [
    primary(14775, 'Primary school and early childhood teachers'),
    primary(14773, 'Secondary education teachers'),
    primary(14769, 'University and higher education teachers'),
    supporting(14771, 'Vocational education teachers'),
    supporting(14778, 'Other teaching professionals'),
    supporting(15036, 'Child care workers and teachers’ aides')
  ],
  'company_type:energy': [
    primary(14727, 'Engineering professionals (excluding electrotechnology)'),
    primary(14716, 'Physical and earth science professionals'),
    supporting(14842, 'Physical and engineering science technicians'),
    supporting(14856, 'Process control technicians'),
    supporting(15198, 'Other stationary plant and machine operators'),
    supporting(15135, 'Electrical equipment installers and repairers'),
    supporting(15169, 'Mining and mineral processing plant operators')
  ],
  'company_type:food_beverage': [
    primary(14998, 'Cooks'),
    primary(15257, 'Food preparation assistants'),
    primary(15143, 'Food processing and related trades workers'),
    supporting(15193, 'Food and related products machine operators'),
    supporting(15000, 'Waiters and bartenders'),
    supporting(14706, 'Hotel and restaurant managers')
  ],
  'company_type:government': [
    primary(14669, 'Legislators and senior officials'),
    primary(14919, 'Regulatory government associate professionals'),
    supporting(14791, 'Administration professionals'),
    supporting(14914, 'Administrative and specialised secretaries'),
    supporting(14952, 'General office clerks')
  ],
  'company_type:hospital_healthcare': [
    primary(14747, 'Medical doctors'),
    primary(14750, 'Nursing and midwifery professionals'),
    primary(14879, 'Nursing and midwifery associate professionals'),
    supporting(14759, 'Other health professionals'),
    supporting(14886, 'Other health associate professionals'),
    supporting(15039, 'Personal care workers in health services'),
    supporting(14874, 'Medical and pharmaceutical technicians')
  ],
  'company_type:hospitality': [
    primary(14706, 'Hotel and restaurant managers'),
    primary(15000, 'Waiters and bartenders'),
    primary(14998, 'Cooks'),
    supporting(14994, 'Travel attendants, conductors and guides'),
    supporting(15227, 'Domestic, hotel and office cleaners and helpers'),
    supporting(15006, 'Building and housekeeping supervisors'),
    supporting(15257, 'Food preparation assistants')
  ],
  'company_type:industrial_services': [
    primary(15114, 'Machinery mechanics and repairers'),
    primary(15135, 'Electrical equipment installers and repairers'),
    primary(15139, 'Electronics and telecommunications installers and repairers'),
    supporting(15109, 'Blacksmiths, toolmakers and related trades workers'),
    supporting(15103, 'Sheet and structural metal workers, moulders and welders, and related workers'),
    supporting(14842, 'Physical and engineering science technicians'),
    supporting(14856, 'Process control technicians'),
    supporting(14852, 'Mining, manufacturing and construction supervisors')
  ],
  'company_type:information_technology': [
    primary(14802, 'Software and applications developers and analysts'),
    primary(14808, 'Database and network professionals'),
    supporting(14942, 'Information and communications technology operations and user support technicians'),
    supporting(14695, 'Information and communications technology service managers')
  ],
  'company_type:insurance': [
    primary(14787, 'Finance professionals'),
    primary(14897, 'Financial and mathematical associate professionals'),
    supporting(14903, 'Sales and purchasing agents and brokers'),
    supporting(14960, 'Tellers, money collectors and related clerks')
  ],
  'company_type:manufacturing': [
    primary(15204, 'Assemblers'),
    primary(15248, 'Manufacturing labourers'),
    primary(14852, 'Mining, manufacturing and construction supervisors'),
    supporting(14690, 'Manufacturing, mining, construction, and distribution managers'),
    supporting(15177, 'Chemical and photographic products plant and machine operators'),
    supporting(15193, 'Food and related products machine operators'),
    supporting(15174, 'Metal processing and finishing plant operators'),
    supporting(15180, 'Rubber, plastic and paper products machine operators'),
    supporting(15184, 'Textile, fur and leather products machine operators'),
    supporting(15198, 'Other stationary plant and machine operators'),
    supporting(15195, 'Wood processing and papermaking plant operators')
  ],
  'company_type:media_advertising': [
    primary(14796, 'Sales, marketing and public relations professionals'),
    primary(14828, 'Authors, journalists and linguists'),
    primary(14832, 'Creative and performing artists'),
    supporting(14935, 'Artistic, cultural and culinary associate professionals'),
    supporting(14947, 'Telecommunications and broadcasting technicians'),
    supporting(14682, 'Sales, marketing and development managers')
  ],
  'company_type:nonprofit': [
    primary(14821, 'Social and religious professionals'),
    supporting(14927, 'Legal, social and religious associate professionals'),
    supporting(14791, 'Administration professionals'),
    supporting(14711, 'Other services managers')
  ],
  'company_type:outsourcing_shared_services': [
    primary(14965, 'Client information workers'),
    primary(14952, 'General office clerks'),
    supporting(14984, 'Other clerical support workers'),
    supporting(14791, 'Administration professionals'),
    supporting(14956, 'Keyboard operators')
  ],
  'company_type:pharma_biotech': [
    primary(14874, 'Medical and pharmaceutical technicians'),
    primary(14723, 'Life science professionals'),
    supporting(14863, 'Life science technicians and related associate professionals'),
    supporting(14759, 'Other health professionals'),
    supporting(15177, 'Chemical and photographic products plant and machine operators')
  ],
  'company_type:professional_services': [
    primary(14697, 'Professional services managers'),
    primary(14787, 'Finance professionals'),
    primary(14814, 'Legal professionals'),
    supporting(14791, 'Administration professionals'),
    supporting(14908, 'Business services agents'),
    supporting(14721, 'Mathematicians, actuaries and statisticians'),
    supporting(14927, 'Legal, social and religious associate professionals'),
    supporting(14919, 'Regulatory government associate professionals')
  ],
  'company_type:real_estate_property': [
    primary(14739, 'Architects, planners, surveyors and designers'),
    primary(14903, 'Sales and purchasing agents and brokers'),
    supporting(14682, 'Sales, marketing and development managers'),
    supporting(15027, 'Other sales workers')
  ],
  'company_type:retailer': [
    primary(15021, 'Shop salespersons'),
    primary(15025, 'Cashiers and ticket clerks'),
    primary(14709, 'Retail and wholesale trade managers'),
    supporting(15018, 'Street and market salespersons'),
    supporting(15027, 'Other sales workers')
  ],
  'company_type:security': [
    primary(15044, 'Protective services workers'),
    supporting(14665, 'Armed forces occupations, other ranks'),
    supporting(14659, 'Commissioned armed forces officers'),
    supporting(14662, 'Non-commissioned armed forces officers')
  ],
  'company_type:telecom': [
    primary(15139, 'Electronics and telecommunications installers and repairers'),
    primary(14947, 'Telecommunications and broadcasting technicians'),
    supporting(14942, 'Information and communications technology operations and user support technicians'),
    supporting(14808, 'Database and network professionals'),
    supporting(14735, 'Electrotechnology engineers')
  ],
  'company_type:transportation': [
    primary(15212, 'Car, van and motorcycle drivers'),
    primary(15215, 'Heavy truck and bus drivers'),
    primary(15251, 'Transport and storage labourers'),
    supporting(15209, 'Locomotive engine drivers and related workers'),
    supporting(15223, 'Ships’ deck crews and related workers'),
    supporting(14979, 'Material-recording and transport clerks'),
    supporting(14994, 'Travel attendants, conductors and guides'),
    supporting(14867, 'Ship and aircraft controllers and technicians')
  ],
  'company_type:utility_provider': [
    primary(15135, 'Electrical equipment installers and repairers'),
    primary(14735, 'Electrotechnology engineers'),
    supporting(14842, 'Physical and engineering science technicians'),
    supporting(14856, 'Process control technicians'),
    supporting(15198, 'Other stationary plant and machine operators')
  ],
  'company_type:warehouse_logistics': [
    primary(15251, 'Transport and storage labourers'),
    primary(14979, 'Material-recording and transport clerks'),
    supporting(15218, 'Mobile plant operators'),
    supporting(15215, 'Heavy truck and bus drivers'),
    supporting(14690, 'Manufacturing, mining, construction, and distribution managers')
  ]
} as const;

export function normalizeCompanyType(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/-/gu, '_') ?? '';

  if (!normalized) {
    return null;
  }

  return normalized.startsWith(COMPANY_TYPE_PREFIX)
    ? normalized
    : `${COMPANY_TYPE_PREFIX}${normalized}`;
}

export function getCompanyTypeFamilyPriors(value: string | undefined): readonly CompanyTypeFamilyPrior[] {
  const normalized = normalizeCompanyType(value);
  return normalized ? COMPANY_TYPE_FAMILY_PRIORS[normalized] ?? [] : [];
}

export function isKnownCompanyType(value: string | undefined): boolean {
  const normalized = normalizeCompanyType(value);
  return Boolean(normalized && normalized in COMPANY_TYPE_FAMILY_PRIORS);
}

function primary(familyNodeId: number, familyLabel: string): CompanyTypeFamilyPrior {
  return {
    familyNodeId,
    familyLabel,
    strength: 'primary'
  };
}

function supporting(familyNodeId: number, familyLabel: string): CompanyTypeFamilyPrior {
  return {
    familyNodeId,
    familyLabel,
    strength: 'supporting'
  };
}
