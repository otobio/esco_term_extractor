// --- ENUMS & TYPES ---

export type OccupationGroup =
  | 'military'
  | 'executive'
  | 'professional'
  | 'technical'
  | 'clerical'
  | 'service_and_sales'
  | 'skilled_trades'
  | 'elementary';

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

export const occupationFamilies: OccupationFamily[] = [
  {
    id: 14659,
    slug: 'commissioned_armed_forces_officers',
    label: 'Commissioned Armed Forces Officers',
    group: 'military',
    collarKind: 'grey',
    collarTraits: ['protective']
  },
  {
    id: 14662,
    slug: 'non_commissioned_armed_forces_officers',
    label: 'Non Commissioned Armed Forces Officers',
    group: 'military',
    collarKind: 'grey',
    collarTraits: ['protective']
  },
  {
    id: 14665,
    slug: 'armed_forces_occupations_other_ranks',
    label: 'Armed Forces Occupations Other Ranks',
    group: 'military',
    collarKind: 'grey',
    collarTraits: ['protective']
  },
  {
    id: 14669,
    slug: 'legislators_and_senior_officials',
    label: 'Legislators And Senior Officials',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14674,
    slug: 'managing_directors_and_chief_executives',
    label: 'Managing Directors And Chief Executives',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14677,
    slug: 'business_services_and_administration_managers',
    label: 'Business Services And Administration Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14682,
    slug: 'sales_marketing_and_development_managers',
    label: 'Sales Marketing And Development Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14687,
    slug: 'production_managers_in_agriculture_forestry_and_fisheries',
    label: 'Production Managers In Agriculture Forestry And Fisheries',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14690,
    slug: 'manufacturing_mining_construction_and_distribution_managers',
    label: 'Manufacturing Mining Construction And Distribution Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14695,
    slug: 'information_and_communications_technology_service_managers',
    label: 'Information And Communications Technology Service Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14697,
    slug: 'professional_services_managers',
    label: 'Professional Services Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14706,
    slug: 'hotel_and_restaurant_managers',
    label: 'Hotel And Restaurant Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14709,
    slug: 'retail_and_wholesale_trade_managers',
    label: 'Retail And Wholesale Trade Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14711,
    slug: 'other_services_managers',
    label: 'Other Services Managers',
    group: 'executive',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14716,
    slug: 'physical_and_earth_science_professionals',
    label: 'Physical And Earth Science Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14721,
    slug: 'mathematicians_actuaries_and_statisticians',
    label: 'Mathematicians Actuaries And Statisticians',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14723,
    slug: 'life_science_professionals',
    label: 'Life Science Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14727,
    slug: 'engineering_professionals_excluding_electrotechnology',
    label: 'Engineering Professionals Excluding Electrotechnology',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14735,
    slug: 'electrotechnology_engineers',
    label: 'Electrotechnology Engineers',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14739,
    slug: 'architects_planners_surveyors_and_designers',
    label: 'Architects Planners Surveyors And Designers',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['creative']
  },
  {
    id: 14747,
    slug: 'medical_doctors',
    label: 'Medical Doctors',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14750,
    slug: 'nursing_and_midwifery_professionals',
    label: 'Nursing And Midwifery Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['pink']
  },
  {
    id: 14753,
    slug: 'traditional_and_complementary_medicine_professionals',
    label: 'Traditional And Complementary Medicine Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['pink']
  },
  {
    id: 14757,
    slug: 'veterinarians',
    label: 'Veterinarians',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14759,
    slug: 'other_health_professionals',
    label: 'Other Health Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['pink']
  },
  {
    id: 14769,
    slug: 'university_and_higher_education_teachers',
    label: 'University And Higher Education Teachers',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14771,
    slug: 'vocational_education_teachers',
    label: 'Vocational Education Teachers',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14773,
    slug: 'secondary_education_teachers',
    label: 'Secondary Education Teachers',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14775,
    slug: 'primary_school_and_early_childhood_teachers',
    label: 'Primary School And Early Childhood Teachers',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14778,
    slug: 'other_teaching_professionals',
    label: 'Other Teaching Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14787,
    slug: 'finance_professionals',
    label: 'Finance Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14791,
    slug: 'administration_professionals',
    label: 'Administration Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14796,
    slug: 'sales_marketing_and_public_relations_professionals',
    label: 'Sales Marketing And Public Relations Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14802,
    slug: 'software_and_applications_developers_and_analysts',
    label: 'Software And Applications Developers And Analysts',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14808,
    slug: 'database_and_network_professionals',
    label: 'Database And Network Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14814,
    slug: 'legal_professionals',
    label: 'Legal Professionals',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['gold']
  },
  {
    id: 14818,
    slug: 'librarians_archivists_and_curators',
    label: 'Librarians Archivists And Curators',
    group: 'professional',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14821,
    slug: 'social_and_religious_professionals',
    label: 'Social And Religious Professionals',
    group: 'professional',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14828,
    slug: 'authors_journalists_and_linguists',
    label: 'Authors Journalists And Linguists',
    group: 'professional',
    collarKind: 'white',
    collarTraits: ['creative']
  },
  {
    id: 14832,
    slug: 'creative_and_performing_artists',
    label: 'Creative And Performing Artists',
    group: 'professional',
    collarKind: 'grey',
    collarTraits: ['creative']
  },
  {
    id: 14842,
    slug: 'physical_and_engineering_science_technicians',
    label: 'Physical And Engineering Science Technicians',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14852,
    slug: 'mining_manufacturing_and_construction_supervisors',
    label: 'Mining Manufacturing And Construction Supervisors',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14856,
    slug: 'process_control_technicians',
    label: 'Process Control Technicians',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14863,
    slug: 'life_science_technicians_and_related_associate_professionals',
    label: 'Life Science Technicians And Related Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14867,
    slug: 'ship_and_aircraft_controllers_and_technicians',
    label: 'Ship And Aircraft Controllers And Technicians',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14874,
    slug: 'medical_and_pharmaceutical_technicians',
    label: 'Medical And Pharmaceutical Technicians',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 14879,
    slug: 'nursing_and_midwifery_associate_professionals',
    label: 'Nursing And Midwifery Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 14882,
    slug: 'traditional_and_complementary_medicine_associate_professionals',
    label: 'Traditional And Complementary Medicine Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 14884,
    slug: 'veterinary_technicians_and_assistants',
    label: 'Veterinary Technicians And Assistants',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 14886,
    slug: 'other_health_associate_professionals',
    label: 'Other Health Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 14897,
    slug: 'financial_and_mathematical_associate_professionals',
    label: 'Financial And Mathematical Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14903,
    slug: 'sales_and_purchasing_agents_and_brokers',
    label: 'Sales And Purchasing Agents And Brokers',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14908,
    slug: 'business_services_agents',
    label: 'Business Services Agents',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14919,
    slug: 'regulatory_government_associate_professionals',
    label: 'Regulatory Government Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14927,
    slug: 'legal_social_and_religious_associate_professionals',
    label: 'Legal Social And Religious Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14931,
    slug: 'sports_and_fitness_workers',
    label: 'Sports And Fitness Workers',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14935,
    slug: 'artistic_cultural_and_culinary_associate_professionals',
    label: 'Artistic Cultural And Culinary Associate Professionals',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: ['creative']
  },
  {
    id: 14942,
    slug: 'information_and_communications_technology_operations_and_user_support_technicians',
    label: 'Information And Communications Technology Operations And User Support Technicians',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14947,
    slug: 'telecommunications_and_broadcasting_technicians',
    label: 'Telecommunications And Broadcasting Technicians',
    group: 'technical',
    collarKind: 'grey',
    collarTraits: []
  },
  {
    id: 14952,
    slug: 'general_office_clerks',
    label: 'General Office Clerks',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14954,
    slug: 'secretaries_general',
    label: 'Secretaries General',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14956,
    slug: 'keyboard_operators',
    label: 'Keyboard Operators',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14960,
    slug: 'tellers_money_collectors_and_related_clerks',
    label: 'Tellers Money Collectors And Related Clerks',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14965,
    slug: 'client_information_workers',
    label: 'Client Information Workers',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14975,
    slug: 'numerical_clerks',
    label: 'Numerical Clerks',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14979,
    slug: 'material_recording_and_transport_clerks',
    label: 'Material Recording And Transport Clerks',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14984,
    slug: 'other_clerical_support_workers',
    label: 'Other Clerical Support Workers',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14914,
    slug: 'administrative_and_specialised_secretaries',
    label: 'Administrative And Specialised Secretaries',
    group: 'clerical',
    collarKind: 'white',
    collarTraits: []
  },
  {
    id: 14994,
    slug: 'travel_attendants_conductors_and_guides',
    label: 'Travel Attendants Conductors And Guides',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 14998,
    slug: 'cooks',
    label: 'Cooks',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15000,
    slug: 'waiters_and_bartenders',
    label: 'Waiters And Bartenders',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15003,
    slug: 'hairdressers_beauticians_and_related_workers',
    label: 'Hairdressers Beauticians And Related Workers',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15006,
    slug: 'building_and_housekeeping_supervisors',
    label: 'Building And Housekeeping Supervisors',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15010,
    slug: 'other_personal_services_workers',
    label: 'Other Personal Services Workers',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15018,
    slug: 'street_and_market_salespersons',
    label: 'Street And Market Salespersons',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15021,
    slug: 'shop_salespersons',
    label: 'Shop Salespersons',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15025,
    slug: 'cashiers_and_ticket_clerks',
    label: 'Cashiers And Ticket Clerks',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15027,
    slug: 'other_sales_workers',
    label: 'Other Sales Workers',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15036,
    slug: 'child_care_workers_and_teachers_aides',
    label: 'Child Care Workers And Teachers Aides',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15039,
    slug: 'personal_care_workers_in_health_services',
    label: 'Personal Care Workers In Health Services',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink']
  },
  {
    id: 15044,
    slug: 'protective_services_workers',
    label: 'Protective Services Workers',
    group: 'service_and_sales',
    collarKind: 'grey',
    collarTraits: ['pink', 'protective']
  },
  {
    id: 15052,
    slug: 'market_gardeners_and_crop_growers',
    label: 'Market Gardeners And Crop Growers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: ['green']
  },
  {
    id: 15057,
    slug: 'animal_producers',
    label: 'Animal Producers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: ['green']
  },
  {
    id: 15062,
    slug: 'mixed_crop_and_animal_producers',
    label: 'Mixed Crop And Animal Producers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: ['green']
  },
  {
    id: 15065,
    slug: 'forestry_and_related_workers',
    label: 'Forestry And Related Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: ['green']
  },
  {
    id: 15067,
    slug: 'fishery_workers_hunters_and_trappers',
    label: 'Fishery Workers Hunters And Trappers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: ['green']
  },
  {
    id: 15083,
    slug: 'building_frame_and_related_trades_workers',
    label: 'Building Frame And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15090,
    slug: 'building_finishers_and_related_trades_workers',
    label: 'Building Finishers And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15098,
    slug: 'painters_building_structure_cleaners_and_related_trades_workers',
    label: 'Painters Building Structure Cleaners And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15103,
    slug: 'sheet_and_structural_metal_workers_moulders_and_welders_and_related_workers',
    label: 'Sheet And Structural Metal Workers Moulders And Welders And Related Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15109,
    slug: 'blacksmiths_toolmakers_and_related_trades_workers',
    label: 'Blacksmiths Toolmakers And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15114,
    slug: 'machinery_mechanics_and_repairers',
    label: 'Machinery Mechanics And Repairers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15120,
    slug: 'handicraft_workers',
    label: 'Handicraft Workers',
    group: 'skilled_trades',
    collarKind: 'grey',
    collarTraits: ['creative']
  },
  {
    id: 15130,
    slug: 'printing_trades_workers',
    label: 'Printing Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15135,
    slug: 'electrical_equipment_installers_and_repairers',
    label: 'Electrical Equipment Installers And Repairers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15139,
    slug: 'electronics_and_telecommunications_installers_and_repairers',
    label: 'Electronics And Telecommunications Installers And Repairers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15143,
    slug: 'food_processing_and_related_trades_workers',
    label: 'Food Processing And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15150,
    slug: 'wood_treaters_cabinet_makers_and_related_trades_workers',
    label: 'Wood Treaters Cabinet Makers And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15154,
    slug: 'garment_and_related_trades_workers',
    label: 'Garment And Related Trades Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15161,
    slug: 'other_craft_and_related_workers',
    label: 'Other Craft And Related Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15169,
    slug: 'mining_and_mineral_processing_plant_operators',
    label: 'Mining And Mineral Processing Plant Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15174,
    slug: 'metal_processing_and_finishing_plant_operators',
    label: 'Metal Processing And Finishing Plant Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15177,
    slug: 'chemical_and_photographic_products_plant_and_machine_operators',
    label: 'Chemical And Photographic Products Plant And Machine Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15180,
    slug: 'rubber_plastic_and_paper_products_machine_operators',
    label: 'Rubber Plastic And Paper Products Machine Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15184,
    slug: 'textile_fur_and_leather_products_machine_operators',
    label: 'Textile Fur And Leather Products Machine Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15193,
    slug: 'food_and_related_products_machine_operators',
    label: 'Food And Related Products Machine Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15195,
    slug: 'wood_processing_and_papermaking_plant_operators',
    label: 'Wood Processing And Papermaking Plant Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15198,
    slug: 'other_stationary_plant_and_machine_operators',
    label: 'Other Stationary Plant And Machine Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15204,
    slug: 'assemblers',
    label: 'Assemblers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15209,
    slug: 'locomotive_engine_drivers_and_related_workers',
    label: 'Locomotive Engine Drivers And Related Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15212,
    slug: 'car_van_and_motorcycle_drivers',
    label: 'Car Van And Motorcycle Drivers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15215,
    slug: 'heavy_truck_and_bus_drivers',
    label: 'Heavy Truck And Bus Drivers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15218,
    slug: 'mobile_plant_operators',
    label: 'Mobile Plant Operators',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15223,
    slug: 'ships_deck_crews_and_related_workers',
    label: 'Ships Deck Crews And Related Workers',
    group: 'skilled_trades',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15227,
    slug: 'domestic_hotel_and_office_cleaners_and_helpers',
    label: 'Domestic Hotel And Office Cleaners And Helpers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: ['pink']
  },
  {
    id: 15230,
    slug: 'vehicle_window_laundry_and_other_hand_cleaning_workers',
    label: 'Vehicle Window Laundry And Other Hand Cleaning Workers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: ['pink']
  },
  {
    id: 15236,
    slug: 'agricultural_forestry_and_fishery_labourers',
    label: 'Agricultural Forestry And Fishery Labourers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: ['green']
  },
  {
    id: 15244,
    slug: 'mining_and_construction_labourers',
    label: 'Mining And Construction Labourers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15248,
    slug: 'manufacturing_labourers',
    label: 'Manufacturing Labourers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15251,
    slug: 'transport_and_storage_labourers',
    label: 'Transport And Storage Labourers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15257,
    slug: 'food_preparation_assistants',
    label: 'Food Preparation Assistants',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: ['pink']
  },
  {
    id: 15261,
    slug: 'street_and_related_service_workers',
    label: 'Street And Related Service Workers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: ['pink']
  },
  {
    id: 15263,
    slug: 'street_vendors_excluding_food',
    label: 'Street Vendors Excluding Food',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15266,
    slug: 'refuse_workers',
    label: 'Refuse Workers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: []
  },
  {
    id: 15270,
    slug: 'other_elementary_workers',
    label: 'Other Elementary Workers',
    group: 'elementary',
    collarKind: 'blue',
    collarTraits: []
  }
];

const OCCUPATION_FAMILY_BY_ID = new Map<number, OccupationFamily>();
const OCCUPATION_FAMILY_BY_SLUG = new Map<string, OccupationFamily>();
const OCCUPATION_FAMILY_BY_LABEL = new Map<string, OccupationFamily>();

for (const family of occupationFamilies) {
  OCCUPATION_FAMILY_BY_ID.set(family.id, family);
  OCCUPATION_FAMILY_BY_SLUG.set(family.slug.trim().toLocaleLowerCase('en-US'), family);
  OCCUPATION_FAMILY_BY_LABEL.set(family.label.trim().toLocaleLowerCase('en-US'), family);
}

export function getOccupationFamilyContext(identifier: string | number): OccupationFamily | undefined {
  if (typeof identifier === 'number' && Number.isFinite(identifier)) {
    return OCCUPATION_FAMILY_BY_ID.get(identifier);
  }

  const normalized = `${identifier}`.trim().toLocaleLowerCase('en-US');

  if (!normalized) {
    return undefined;
  }

  const numericIdentifier = Number.parseInt(normalized, 10);

  if (Number.isFinite(numericIdentifier) && `${numericIdentifier}` === normalized) {
    const byId = OCCUPATION_FAMILY_BY_ID.get(numericIdentifier);

    if (byId) {
      return byId;
    }
  }

  return OCCUPATION_FAMILY_BY_SLUG.get(normalized) ?? OCCUPATION_FAMILY_BY_LABEL.get(normalized);
}
