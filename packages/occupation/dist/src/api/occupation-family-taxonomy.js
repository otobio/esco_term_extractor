// --- ENUMS & TYPES ---
export const occupationFamilies = [
    {
        id: 21987,
        slug: 'commissioned_armed_forces_officers',
        label: 'Commissioned Armed Forces Officers',
        group: 'military',
        collarKind: 'grey',
        collarTraits: ['protective']
    },
    {
        id: 21990,
        slug: 'non_commissioned_armed_forces_officers',
        label: 'Non Commissioned Armed Forces Officers',
        group: 'military',
        collarKind: 'grey',
        collarTraits: ['protective']
    },
    {
        id: 21993,
        slug: 'armed_forces_occupations_other_ranks',
        label: 'Armed Forces Occupations Other Ranks',
        group: 'military',
        collarKind: 'grey',
        collarTraits: ['protective']
    },
    {
        id: 21997,
        slug: 'legislators_and_senior_officials',
        label: 'Legislators And Senior Officials',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22002,
        slug: 'managing_directors_and_chief_executives',
        label: 'Managing Directors And Chief Executives',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22005,
        slug: 'business_services_and_administration_managers',
        label: 'Business Services And Administration Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22010,
        slug: 'sales_marketing_and_development_managers',
        label: 'Sales Marketing And Development Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22015,
        slug: 'production_managers_in_agriculture_forestry_and_fisheries',
        label: 'Production Managers In Agriculture Forestry And Fisheries',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22018,
        slug: 'manufacturing_mining_construction_and_distribution_managers',
        label: 'Manufacturing Mining Construction And Distribution Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22023,
        slug: 'information_and_communications_technology_service_managers',
        label: 'Information And Communications Technology Service Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22025,
        slug: 'professional_services_managers',
        label: 'Professional Services Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22034,
        slug: 'hotel_and_restaurant_managers',
        label: 'Hotel And Restaurant Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22037,
        slug: 'retail_and_wholesale_trade_managers',
        label: 'Retail And Wholesale Trade Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22039,
        slug: 'other_services_managers',
        label: 'Other Services Managers',
        group: 'executive',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22044,
        slug: 'physical_and_earth_science_professionals',
        label: 'Physical And Earth Science Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22049,
        slug: 'mathematicians_actuaries_and_statisticians',
        label: 'Mathematicians Actuaries And Statisticians',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22051,
        slug: 'life_science_professionals',
        label: 'Life Science Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22055,
        slug: 'engineering_professionals_excluding_electrotechnology',
        label: 'Engineering Professionals Excluding Electrotechnology',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22063,
        slug: 'electrotechnology_engineers',
        label: 'Electrotechnology Engineers',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22067,
        slug: 'architects_planners_surveyors_and_designers',
        label: 'Architects Planners Surveyors And Designers',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['creative']
    },
    {
        id: 22075,
        slug: 'medical_doctors',
        label: 'Medical Doctors',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22078,
        slug: 'nursing_and_midwifery_professionals',
        label: 'Nursing And Midwifery Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['pink']
    },
    {
        id: 22081,
        slug: 'traditional_and_complementary_medicine_professionals',
        label: 'Traditional And Complementary Medicine Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['pink']
    },
    {
        id: 22085,
        slug: 'veterinarians',
        label: 'Veterinarians',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22087,
        slug: 'other_health_professionals',
        label: 'Other Health Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['pink']
    },
    {
        id: 22097,
        slug: 'university_and_higher_education_teachers',
        label: 'University And Higher Education Teachers',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22099,
        slug: 'vocational_education_teachers',
        label: 'Vocational Education Teachers',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22101,
        slug: 'secondary_education_teachers',
        label: 'Secondary Education Teachers',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22103,
        slug: 'primary_school_and_early_childhood_teachers',
        label: 'Primary School And Early Childhood Teachers',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22106,
        slug: 'other_teaching_professionals',
        label: 'Other Teaching Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22115,
        slug: 'finance_professionals',
        label: 'Finance Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22119,
        slug: 'administration_professionals',
        label: 'Administration Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22124,
        slug: 'sales_marketing_and_public_relations_professionals',
        label: 'Sales Marketing And Public Relations Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22130,
        slug: 'software_and_applications_developers_and_analysts',
        label: 'Software And Applications Developers And Analysts',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22136,
        slug: 'database_and_network_professionals',
        label: 'Database And Network Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold'],
        specializationTerms: ['database', 'network', 'ict', 'cyber', 'sql']
    },
    {
        id: 22142,
        slug: 'legal_professionals',
        label: 'Legal Professionals',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['gold']
    },
    {
        id: 22146,
        slug: 'librarians_archivists_and_curators',
        label: 'Librarians Archivists And Curators',
        group: 'professional',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22149,
        slug: 'social_and_religious_professionals',
        label: 'Social And Religious Professionals',
        group: 'professional',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22156,
        slug: 'authors_journalists_and_linguists',
        label: 'Authors Journalists And Linguists',
        group: 'professional',
        collarKind: 'white',
        collarTraits: ['creative']
    },
    {
        id: 22160,
        slug: 'creative_and_performing_artists',
        label: 'Creative And Performing Artists',
        group: 'professional',
        collarKind: 'grey',
        collarTraits: ['creative']
    },
    {
        id: 22170,
        slug: 'physical_and_engineering_science_technicians',
        label: 'Physical And Engineering Science Technicians',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22180,
        slug: 'mining_manufacturing_and_construction_supervisors',
        label: 'Mining Manufacturing And Construction Supervisors',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22184,
        slug: 'process_control_technicians',
        label: 'Process Control Technicians',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22191,
        slug: 'life_science_technicians_and_related_associate_professionals',
        label: 'Life Science Technicians And Related Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22195,
        slug: 'ship_and_aircraft_controllers_and_technicians',
        label: 'Ship And Aircraft Controllers And Technicians',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22202,
        slug: 'medical_and_pharmaceutical_technicians',
        label: 'Medical And Pharmaceutical Technicians',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22207,
        slug: 'nursing_and_midwifery_associate_professionals',
        label: 'Nursing And Midwifery Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22210,
        slug: 'traditional_and_complementary_medicine_associate_professionals',
        label: 'Traditional And Complementary Medicine Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22212,
        slug: 'veterinary_technicians_and_assistants',
        label: 'Veterinary Technicians And Assistants',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22214,
        slug: 'other_health_associate_professionals',
        label: 'Other Health Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22225,
        slug: 'financial_and_mathematical_associate_professionals',
        label: 'Financial And Mathematical Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22231,
        slug: 'sales_and_purchasing_agents_and_brokers',
        label: 'Sales And Purchasing Agents And Brokers',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22236,
        slug: 'business_services_agents',
        label: 'Business Services Agents',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22247,
        slug: 'regulatory_government_associate_professionals',
        label: 'Regulatory Government Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22255,
        slug: 'legal_social_and_religious_associate_professionals',
        label: 'Legal Social And Religious Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22259,
        slug: 'sports_and_fitness_workers',
        label: 'Sports And Fitness Workers',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22263,
        slug: 'artistic_cultural_and_culinary_associate_professionals',
        label: 'Artistic Cultural And Culinary Associate Professionals',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: ['creative']
    },
    {
        id: 22270,
        slug: 'information_and_communications_technology_operations_and_user_support_technicians',
        label: 'Information And Communications Technology Operations And User Support Technicians',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22275,
        slug: 'telecommunications_and_broadcasting_technicians',
        label: 'Telecommunications And Broadcasting Technicians',
        group: 'technical',
        collarKind: 'grey',
        collarTraits: []
    },
    {
        id: 22280,
        slug: 'general_office_clerks',
        label: 'General Office Clerks',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22282,
        slug: 'secretaries_general',
        label: 'Secretaries General',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22284,
        slug: 'keyboard_operators',
        label: 'Keyboard Operators',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22288,
        slug: 'tellers_money_collectors_and_related_clerks',
        label: 'Tellers Money Collectors And Related Clerks',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22293,
        slug: 'client_information_workers',
        label: 'Client Information Workers',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22303,
        slug: 'numerical_clerks',
        label: 'Numerical Clerks',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22307,
        slug: 'material_recording_and_transport_clerks',
        label: 'Material Recording And Transport Clerks',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22312,
        slug: 'other_clerical_support_workers',
        label: 'Other Clerical Support Workers',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22242,
        slug: 'administrative_and_specialised_secretaries',
        label: 'Administrative And Specialised Secretaries',
        group: 'clerical',
        collarKind: 'white',
        collarTraits: []
    },
    {
        id: 22322,
        slug: 'travel_attendants_conductors_and_guides',
        label: 'Travel Attendants Conductors And Guides',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22326,
        slug: 'cooks',
        label: 'Cooks',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22328,
        slug: 'waiters_and_bartenders',
        label: 'Waiters And Bartenders',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22331,
        slug: 'hairdressers_beauticians_and_related_workers',
        label: 'Hairdressers Beauticians And Related Workers',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22334,
        slug: 'building_and_housekeeping_supervisors',
        label: 'Building And Housekeeping Supervisors',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22338,
        slug: 'other_personal_services_workers',
        label: 'Other Personal Services Workers',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22346,
        slug: 'street_and_market_salespersons',
        label: 'Street And Market Salespersons',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22349,
        slug: 'shop_salespersons',
        label: 'Shop Salespersons',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22353,
        slug: 'cashiers_and_ticket_clerks',
        label: 'Cashiers And Ticket Clerks',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22355,
        slug: 'other_sales_workers',
        label: 'Other Sales Workers',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22364,
        slug: 'child_care_workers_and_teachers_aides',
        label: 'Child Care Workers And Teachers Aides',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22367,
        slug: 'personal_care_workers_in_health_services',
        label: 'Personal Care Workers In Health Services',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink']
    },
    {
        id: 22372,
        slug: 'protective_services_workers',
        label: 'Protective Services Workers',
        group: 'service_and_sales',
        collarKind: 'grey',
        collarTraits: ['pink', 'protective']
    },
    {
        id: 22380,
        slug: 'market_gardeners_and_crop_growers',
        label: 'Market Gardeners And Crop Growers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: ['green']
    },
    {
        id: 22385,
        slug: 'animal_producers',
        label: 'Animal Producers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: ['green']
    },
    {
        id: 22390,
        slug: 'mixed_crop_and_animal_producers',
        label: 'Mixed Crop And Animal Producers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: ['green']
    },
    {
        id: 22393,
        slug: 'forestry_and_related_workers',
        label: 'Forestry And Related Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: ['green']
    },
    {
        id: 22395,
        slug: 'fishery_workers_hunters_and_trappers',
        label: 'Fishery Workers Hunters And Trappers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: ['green']
    },
    {
        id: 22411,
        slug: 'building_frame_and_related_trades_workers',
        label: 'Building Frame And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22418,
        slug: 'building_finishers_and_related_trades_workers',
        label: 'Building Finishers And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22426,
        slug: 'painters_building_structure_cleaners_and_related_trades_workers',
        label: 'Painters Building Structure Cleaners And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22431,
        slug: 'sheet_and_structural_metal_workers_moulders_and_welders_and_related_workers',
        label: 'Sheet And Structural Metal Workers Moulders And Welders And Related Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22437,
        slug: 'blacksmiths_toolmakers_and_related_trades_workers',
        label: 'Blacksmiths Toolmakers And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22442,
        slug: 'machinery_mechanics_and_repairers',
        label: 'Machinery Mechanics And Repairers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22448,
        slug: 'handicraft_workers',
        label: 'Handicraft Workers',
        group: 'skilled_trades',
        collarKind: 'grey',
        collarTraits: ['creative']
    },
    {
        id: 22458,
        slug: 'printing_trades_workers',
        label: 'Printing Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22463,
        slug: 'electrical_equipment_installers_and_repairers',
        label: 'Electrical Equipment Installers And Repairers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22467,
        slug: 'electronics_and_telecommunications_installers_and_repairers',
        label: 'Electronics And Telecommunications Installers And Repairers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22471,
        slug: 'food_processing_and_related_trades_workers',
        label: 'Food Processing And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22478,
        slug: 'wood_treaters_cabinet_makers_and_related_trades_workers',
        label: 'Wood Treaters Cabinet Makers And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22482,
        slug: 'garment_and_related_trades_workers',
        label: 'Garment And Related Trades Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22489,
        slug: 'other_craft_and_related_workers',
        label: 'Other Craft And Related Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22497,
        slug: 'mining_and_mineral_processing_plant_operators',
        label: 'Mining And Mineral Processing Plant Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22502,
        slug: 'metal_processing_and_finishing_plant_operators',
        label: 'Metal Processing And Finishing Plant Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22505,
        slug: 'chemical_and_photographic_products_plant_and_machine_operators',
        label: 'Chemical And Photographic Products Plant And Machine Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22508,
        slug: 'rubber_plastic_and_paper_products_machine_operators',
        label: 'Rubber Plastic And Paper Products Machine Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22512,
        slug: 'textile_fur_and_leather_products_machine_operators',
        label: 'Textile Fur And Leather Products Machine Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22521,
        slug: 'food_and_related_products_machine_operators',
        label: 'Food And Related Products Machine Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22523,
        slug: 'wood_processing_and_papermaking_plant_operators',
        label: 'Wood Processing And Papermaking Plant Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22526,
        slug: 'other_stationary_plant_and_machine_operators',
        label: 'Other Stationary Plant And Machine Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22532,
        slug: 'assemblers',
        label: 'Assemblers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22537,
        slug: 'locomotive_engine_drivers_and_related_workers',
        label: 'Locomotive Engine Drivers And Related Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22540,
        slug: 'car_van_and_motorcycle_drivers',
        label: 'Car Van And Motorcycle Drivers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22543,
        slug: 'heavy_truck_and_bus_drivers',
        label: 'Heavy Truck And Bus Drivers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22546,
        slug: 'mobile_plant_operators',
        label: 'Mobile Plant Operators',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22551,
        slug: 'ships_deck_crews_and_related_workers',
        label: 'Ships Deck Crews And Related Workers',
        group: 'skilled_trades',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22555,
        slug: 'domestic_hotel_and_office_cleaners_and_helpers',
        label: 'Domestic Hotel And Office Cleaners And Helpers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: ['pink']
    },
    {
        id: 22558,
        slug: 'vehicle_window_laundry_and_other_hand_cleaning_workers',
        label: 'Vehicle Window Laundry And Other Hand Cleaning Workers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: ['pink']
    },
    {
        id: 22564,
        slug: 'agricultural_forestry_and_fishery_labourers',
        label: 'Agricultural Forestry And Fishery Labourers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: ['green']
    },
    {
        id: 22572,
        slug: 'mining_and_construction_labourers',
        label: 'Mining And Construction Labourers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22576,
        slug: 'manufacturing_labourers',
        label: 'Manufacturing Labourers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22579,
        slug: 'transport_and_storage_labourers',
        label: 'Transport And Storage Labourers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22585,
        slug: 'food_preparation_assistants',
        label: 'Food Preparation Assistants',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: ['pink']
    },
    {
        id: 22589,
        slug: 'street_and_related_service_workers',
        label: 'Street And Related Service Workers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: ['pink']
    },
    {
        id: 22591,
        slug: 'street_vendors_excluding_food',
        label: 'Street Vendors Excluding Food',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22594,
        slug: 'refuse_workers',
        label: 'Refuse Workers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: []
    },
    {
        id: 22598,
        slug: 'other_elementary_workers',
        label: 'Other Elementary Workers',
        group: 'elementary',
        collarKind: 'blue',
        collarTraits: []
    }
];
const OCCUPATION_FAMILY_BY_ID = new Map();
const OCCUPATION_FAMILY_BY_SLUG = new Map();
const OCCUPATION_FAMILY_BY_LABEL = new Map();
for (const family of occupationFamilies) {
    OCCUPATION_FAMILY_BY_ID.set(family.id, family);
    OCCUPATION_FAMILY_BY_SLUG.set(family.slug.trim().toLocaleLowerCase('en-US'), family);
    OCCUPATION_FAMILY_BY_LABEL.set(family.label.trim().toLocaleLowerCase('en-US'), family);
}
export function getOccupationFamilyContext(identifier) {
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
