export declare const FINITE_VALUES: {
    readonly workplace: readonly ["remote", "hybrid", "onsite", "abroad", "field_based", "flexible"];
    readonly employment: readonly ["full_time", "part_time", "contract", "temporary", "seasonal", "per_diem", "internship"];
    readonly schedule: readonly ["9_to_5", "flexible_hours", "fixed_shift", "async", "day_shift", "swing_shift", "night_shift", "rotational_shift", "weekend_only", "split_shift", "4x10_schedule", "on_call", "24_7_standby"];
    readonly level: readonly ["entry_level", "junior", "mid_level", "senior", "lead", "manager", "director", "executive"];
    readonly company_size: readonly ["startup", "small", "mid_growing", "mid_stable", "large", "enterprise", "global"];
    readonly sector: readonly ["agriculture_agri_business", "automotive", "aviation", "banking_financial_services", "construction", "education", "energy", "food_beverage", "government", "hospital_healthcare", "hospitality", "industrial_services", "information_technology", "insurance", "manufacturing", "media_advertising", "nonprofit", "pharma_biotech", "professional_services", "real_estate_property", "retailer", "security", "telecom", "transportation", "utility_provider", "warehouse_logistics"];
    readonly job_function: readonly ["administration", "animal_care_childcare_cleaning", "architecture_design", "arts_entertainment", "banking", "business_development", "community_social_services", "consulting_strategy", "customer_support", "education_training", "engineering", "finance_accounting", "health_safety", "healthcare", "hospitality_food_service", "human_resources", "insurance", "it_software_data", "legal_compliance", "management", "marketing_communications", "mechanical_technical", "mining_natural_resources", "operations_logistics", "physical_manual_work", "procurement", "project_management", "quality_assurance", "research_development", "sales_commerce", "security", "skilled_trades", "transport_driving", "volunteering_internships"];
    readonly benefits: readonly ["meal_vouchers", "health_insurance", "tool_allowance", "life_insurance", "transport_allowance", "paid_training", "transport_provided", "paid_time_off", "company_car", "pension_scheme", "accommodation_provided", "phone_provided", "parental_leave", "uniform_provided", "laptop_provided", "employee_discount", "disability_insurance", "relocation_support", "uniform_cleaning", "wellness_allowance", "cafeteria", "flexible_stipends", "hsa_fsa"];
    readonly compensation: readonly ["equity", "stock_options", "rsus", "phantom_shares", "annual_bonus", "sign_on_bonus", "performance_bonus", "retention_bonus", "profit_sharing", "commission", "ote", "cash_tips", "pooled_tips", "shift_differential", "overtime_1_5x", "overtime_2x", "piece_rate", "daily_payout", "per_diem_pay", "on_call_standby_pay", "dispatch_bonus", "hazard_pay", "holiday_pay", "sunday_premium", "attendance_bonus", "call_out_pay", "christmas_bonus", "fourteenth_salary", "night_premium", "weekend_premium", "vacation_bonus"];
    readonly collar_kind: readonly ["white_collar", "blue_collar", "grey_collar"];
};
export declare const SECTOR_LABELS: {
    readonly agriculture_agri_business: "Agriculture & Agribusiness";
    readonly automotive: "Automotive";
    readonly aviation: "Aviation";
    readonly banking_financial_services: "Banking & Financial Services";
    readonly construction: "Construction";
    readonly education: "Education";
    readonly energy: "Energy";
    readonly food_beverage: "Food & Beverage";
    readonly government: "Public Sector";
    readonly hospital_healthcare: "Healthcare";
    readonly hospitality: "Hospitality";
    readonly industrial_services: "Industrial Services";
    readonly information_technology: "Information Technology";
    readonly insurance: "Insurance";
    readonly manufacturing: "Manufacturing";
    readonly media_advertising: "Media & Advertising";
    readonly nonprofit: "Nonprofit";
    readonly pharma_biotech: "Pharmaceuticals & Biotechnology";
    readonly professional_services: "Professional Services";
    readonly real_estate_property: "Real Estate & Property";
    readonly retailer: "Retail & Consumer Goods";
    readonly security: "Security";
    readonly telecom: "Telecommunications";
    readonly transportation: "Transportation";
    readonly utility_provider: "Utilities";
    readonly warehouse_logistics: "Warehousing & Logistics";
};
export type FiniteBucket = keyof typeof FINITE_VALUES;
export type FiniteValues = typeof FINITE_VALUES;
/**
 * ESCO occupation family taxonomy nodes (esco_1_2_1), copied from
 * packages/occupation/artifacts/runtime/occupation-family-token-relevance.esco_1_2_1.json
 * (familiesByLocale.en). `id` is the source `familyNodeId`; `slug` is its
 * normalized form. Not yet wired into FINITE_VALUES/BucketName.
 */
export declare const OCCUPATION_FAMILIES: readonly [{
    readonly id: 14659;
    readonly slug: "commissioned_armed_forces_officers";
    readonly label: "Commissioned armed forces officers";
}, {
    readonly id: 14662;
    readonly slug: "non_commissioned_armed_forces_officers";
    readonly label: "Non-commissioned armed forces officers";
}, {
    readonly id: 14665;
    readonly slug: "armed_forces_occupations_other_ranks";
    readonly label: "Armed forces occupations, other ranks";
}, {
    readonly id: 14669;
    readonly slug: "legislators_and_senior_officials";
    readonly label: "Legislators and senior officials";
}, {
    readonly id: 14674;
    readonly slug: "managing_directors_and_chief_executives";
    readonly label: "Managing directors and chief executives";
}, {
    readonly id: 14677;
    readonly slug: "business_services_and_administration_managers";
    readonly label: "Business services and administration managers";
}, {
    readonly id: 14682;
    readonly slug: "sales_marketing_and_development_managers";
    readonly label: "Sales, marketing and development managers";
}, {
    readonly id: 14687;
    readonly slug: "production_managers_in_agriculture_forestry_and_fisheries";
    readonly label: "Production managers in agriculture, forestry and fisheries";
}, {
    readonly id: 14690;
    readonly slug: "manufacturing_mining_construction_and_distribution_managers";
    readonly label: "Manufacturing, mining, construction, and distribution managers";
}, {
    readonly id: 14695;
    readonly slug: "information_and_communications_technology_service_managers";
    readonly label: "Information and communications technology service managers";
}, {
    readonly id: 14697;
    readonly slug: "professional_services_managers";
    readonly label: "Professional services managers";
}, {
    readonly id: 14706;
    readonly slug: "hotel_and_restaurant_managers";
    readonly label: "Hotel and restaurant managers";
}, {
    readonly id: 14709;
    readonly slug: "retail_and_wholesale_trade_managers";
    readonly label: "Retail and wholesale trade managers";
}, {
    readonly id: 14711;
    readonly slug: "other_services_managers";
    readonly label: "Other services managers";
}, {
    readonly id: 14716;
    readonly slug: "physical_and_earth_science_professionals";
    readonly label: "Physical and earth science professionals";
}, {
    readonly id: 14721;
    readonly slug: "mathematicians_actuaries_and_statisticians";
    readonly label: "Mathematicians, actuaries and statisticians";
}, {
    readonly id: 14723;
    readonly slug: "life_science_professionals";
    readonly label: "Life science professionals";
}, {
    readonly id: 14727;
    readonly slug: "engineering_professionals_excluding_electrotechnology";
    readonly label: "Engineering professionals (excluding electrotechnology)";
}, {
    readonly id: 14735;
    readonly slug: "electrotechnology_engineers";
    readonly label: "Electrotechnology engineers";
}, {
    readonly id: 14739;
    readonly slug: "architects_planners_surveyors_and_designers";
    readonly label: "Architects, planners, surveyors and designers";
}, {
    readonly id: 14747;
    readonly slug: "medical_doctors";
    readonly label: "Medical doctors";
}, {
    readonly id: 14750;
    readonly slug: "nursing_and_midwifery_professionals";
    readonly label: "Nursing and midwifery professionals";
}, {
    readonly id: 14753;
    readonly slug: "traditional_and_complementary_medicine_professionals";
    readonly label: "Traditional and complementary medicine professionals";
}, {
    readonly id: 14757;
    readonly slug: "veterinarians";
    readonly label: "Veterinarians";
}, {
    readonly id: 14759;
    readonly slug: "other_health_professionals";
    readonly label: "Other health professionals";
}, {
    readonly id: 14769;
    readonly slug: "university_and_higher_education_teachers";
    readonly label: "University and higher education teachers";
}, {
    readonly id: 14771;
    readonly slug: "vocational_education_teachers";
    readonly label: "Vocational education teachers";
}, {
    readonly id: 14773;
    readonly slug: "secondary_education_teachers";
    readonly label: "Secondary education teachers";
}, {
    readonly id: 14775;
    readonly slug: "primary_school_and_early_childhood_teachers";
    readonly label: "Primary school and early childhood teachers";
}, {
    readonly id: 14778;
    readonly slug: "other_teaching_professionals";
    readonly label: "Other teaching professionals";
}, {
    readonly id: 14787;
    readonly slug: "finance_professionals";
    readonly label: "Finance professionals";
}, {
    readonly id: 14791;
    readonly slug: "administration_professionals";
    readonly label: "Administration professionals";
}, {
    readonly id: 14796;
    readonly slug: "sales_marketing_and_public_relations_professionals";
    readonly label: "Sales, marketing and public relations professionals";
}, {
    readonly id: 14802;
    readonly slug: "software_and_applications_developers_and_analysts";
    readonly label: "Software and applications developers and analysts";
}, {
    readonly id: 14808;
    readonly slug: "database_and_network_professionals";
    readonly label: "Database and network professionals";
}, {
    readonly id: 14814;
    readonly slug: "legal_professionals";
    readonly label: "Legal professionals";
}, {
    readonly id: 14818;
    readonly slug: "librarians_archivists_and_curators";
    readonly label: "Librarians, archivists and curators";
}, {
    readonly id: 14821;
    readonly slug: "social_and_religious_professionals";
    readonly label: "Social and religious professionals";
}, {
    readonly id: 14828;
    readonly slug: "authors_journalists_and_linguists";
    readonly label: "Authors, journalists and linguists";
}, {
    readonly id: 14832;
    readonly slug: "creative_and_performing_artists";
    readonly label: "Creative and performing artists";
}, {
    readonly id: 14842;
    readonly slug: "physical_and_engineering_science_technicians";
    readonly label: "Physical and engineering science technicians";
}, {
    readonly id: 14852;
    readonly slug: "mining_manufacturing_and_construction_supervisors";
    readonly label: "Mining, manufacturing and construction supervisors";
}, {
    readonly id: 14856;
    readonly slug: "process_control_technicians";
    readonly label: "Process control technicians";
}, {
    readonly id: 14863;
    readonly slug: "life_science_technicians_and_related_associate_professionals";
    readonly label: "Life science technicians and related associate professionals";
}, {
    readonly id: 14867;
    readonly slug: "ship_and_aircraft_controllers_and_technicians";
    readonly label: "Ship and aircraft controllers and technicians";
}, {
    readonly id: 14874;
    readonly slug: "medical_and_pharmaceutical_technicians";
    readonly label: "Medical and pharmaceutical technicians";
}, {
    readonly id: 14879;
    readonly slug: "nursing_and_midwifery_associate_professionals";
    readonly label: "Nursing and midwifery associate professionals";
}, {
    readonly id: 14882;
    readonly slug: "traditional_and_complementary_medicine_associate_professionals";
    readonly label: "Traditional and complementary medicine associate professionals";
}, {
    readonly id: 14884;
    readonly slug: "veterinary_technicians_and_assistants";
    readonly label: "Veterinary technicians and assistants";
}, {
    readonly id: 14886;
    readonly slug: "other_health_associate_professionals";
    readonly label: "Other health associate professionals";
}, {
    readonly id: 14897;
    readonly slug: "financial_and_mathematical_associate_professionals";
    readonly label: "Financial and mathematical associate professionals";
}, {
    readonly id: 14903;
    readonly slug: "sales_and_purchasing_agents_and_brokers";
    readonly label: "Sales and purchasing agents and brokers";
}, {
    readonly id: 14908;
    readonly slug: "business_services_agents";
    readonly label: "Business services agents";
}, {
    readonly id: 14914;
    readonly slug: "administrative_and_specialised_secretaries";
    readonly label: "Administrative and specialised secretaries";
}, {
    readonly id: 14919;
    readonly slug: "regulatory_government_associate_professionals";
    readonly label: "Regulatory government associate professionals";
}, {
    readonly id: 14927;
    readonly slug: "legal_social_and_religious_associate_professionals";
    readonly label: "Legal, social and religious associate professionals";
}, {
    readonly id: 14931;
    readonly slug: "sports_and_fitness_workers";
    readonly label: "Sports and fitness workers";
}, {
    readonly id: 14935;
    readonly slug: "artistic_cultural_and_culinary_associate_professionals";
    readonly label: "Artistic, cultural and culinary associate professionals";
}, {
    readonly id: 14942;
    readonly slug: "information_and_communications_technology_operations_and_user_support_technicians";
    readonly label: "Information and communications technology operations and user support technicians";
}, {
    readonly id: 14947;
    readonly slug: "telecommunications_and_broadcasting_technicians";
    readonly label: "Telecommunications and broadcasting technicians";
}, {
    readonly id: 14952;
    readonly slug: "general_office_clerks";
    readonly label: "General office clerks";
}, {
    readonly id: 14954;
    readonly slug: "secretaries_general";
    readonly label: "Secretaries (general)";
}, {
    readonly id: 14956;
    readonly slug: "keyboard_operators";
    readonly label: "Keyboard operators";
}, {
    readonly id: 14960;
    readonly slug: "tellers_money_collectors_and_related_clerks";
    readonly label: "Tellers, money collectors and related clerks";
}, {
    readonly id: 14965;
    readonly slug: "client_information_workers";
    readonly label: "Client information workers";
}, {
    readonly id: 14975;
    readonly slug: "numerical_clerks";
    readonly label: "Numerical clerks";
}, {
    readonly id: 14979;
    readonly slug: "material_recording_and_transport_clerks";
    readonly label: "Material-recording and transport clerks";
}, {
    readonly id: 14984;
    readonly slug: "other_clerical_support_workers";
    readonly label: "Other clerical support workers";
}, {
    readonly id: 14994;
    readonly slug: "travel_attendants_conductors_and_guides";
    readonly label: "Travel attendants, conductors and guides";
}, {
    readonly id: 14998;
    readonly slug: "cooks";
    readonly label: "Cooks";
}, {
    readonly id: 15000;
    readonly slug: "waiters_and_bartenders";
    readonly label: "Waiters and bartenders";
}, {
    readonly id: 15003;
    readonly slug: "hairdressers_beauticians_and_related_workers";
    readonly label: "Hairdressers, beauticians and related workers";
}, {
    readonly id: 15006;
    readonly slug: "building_and_housekeeping_supervisors";
    readonly label: "Building and housekeeping supervisors";
}, {
    readonly id: 15010;
    readonly slug: "other_personal_services_workers";
    readonly label: "Other personal services workers";
}, {
    readonly id: 15018;
    readonly slug: "street_and_market_salespersons";
    readonly label: "Street and market salespersons";
}, {
    readonly id: 15021;
    readonly slug: "shop_salespersons";
    readonly label: "Shop salespersons";
}, {
    readonly id: 15025;
    readonly slug: "cashiers_and_ticket_clerks";
    readonly label: "Cashiers and ticket clerks";
}, {
    readonly id: 15027;
    readonly slug: "other_sales_workers";
    readonly label: "Other sales workers";
}, {
    readonly id: 15036;
    readonly slug: "child_care_workers_and_teachers_aides";
    readonly label: "Child care workers and teachers’ aides";
}, {
    readonly id: 15039;
    readonly slug: "personal_care_workers_in_health_services";
    readonly label: "Personal care workers in health services";
}, {
    readonly id: 15044;
    readonly slug: "protective_services_workers";
    readonly label: "Protective services workers";
}, {
    readonly id: 15052;
    readonly slug: "market_gardeners_and_crop_growers";
    readonly label: "Market gardeners and crop growers";
}, {
    readonly id: 15057;
    readonly slug: "animal_producers";
    readonly label: "Animal producers";
}, {
    readonly id: 15062;
    readonly slug: "mixed_crop_and_animal_producers";
    readonly label: "Mixed crop and animal producers";
}, {
    readonly id: 15065;
    readonly slug: "forestry_and_related_workers";
    readonly label: "Forestry and related workers";
}, {
    readonly id: 15067;
    readonly slug: "fishery_workers_hunters_and_trappers";
    readonly label: "Fishery workers, hunters and trappers";
}, {
    readonly id: 15083;
    readonly slug: "building_frame_and_related_trades_workers";
    readonly label: "Building frame and related trades workers";
}, {
    readonly id: 15090;
    readonly slug: "building_finishers_and_related_trades_workers";
    readonly label: "Building finishers and related trades workers";
}, {
    readonly id: 15098;
    readonly slug: "painters_building_structure_cleaners_and_related_trades_workers";
    readonly label: "Painters, building structure cleaners and related trades workers";
}, {
    readonly id: 15103;
    readonly slug: "sheet_and_structural_metal_workers_moulders_and_welders_and_related_workers";
    readonly label: "Sheet and structural metal workers, moulders and welders, and related workers";
}, {
    readonly id: 15109;
    readonly slug: "blacksmiths_toolmakers_and_related_trades_workers";
    readonly label: "Blacksmiths, toolmakers and related trades workers";
}, {
    readonly id: 15114;
    readonly slug: "machinery_mechanics_and_repairers";
    readonly label: "Machinery mechanics and repairers";
}, {
    readonly id: 15120;
    readonly slug: "handicraft_workers";
    readonly label: "Handicraft workers";
}, {
    readonly id: 15130;
    readonly slug: "printing_trades_workers";
    readonly label: "Printing trades workers";
}, {
    readonly id: 15135;
    readonly slug: "electrical_equipment_installers_and_repairers";
    readonly label: "Electrical equipment installers and repairers";
}, {
    readonly id: 15139;
    readonly slug: "electronics_and_telecommunications_installers_and_repairers";
    readonly label: "Electronics and telecommunications installers and repairers";
}, {
    readonly id: 15143;
    readonly slug: "food_processing_and_related_trades_workers";
    readonly label: "Food processing and related trades workers";
}, {
    readonly id: 15150;
    readonly slug: "wood_treaters_cabinet_makers_and_related_trades_workers";
    readonly label: "Wood treaters, cabinet-makers and related trades workers";
}, {
    readonly id: 15154;
    readonly slug: "garment_and_related_trades_workers";
    readonly label: "Garment and related trades workers";
}, {
    readonly id: 15161;
    readonly slug: "other_craft_and_related_workers";
    readonly label: "Other craft and related workers";
}, {
    readonly id: 15169;
    readonly slug: "mining_and_mineral_processing_plant_operators";
    readonly label: "Mining and mineral processing plant operators";
}, {
    readonly id: 15174;
    readonly slug: "metal_processing_and_finishing_plant_operators";
    readonly label: "Metal processing and finishing plant operators";
}, {
    readonly id: 15177;
    readonly slug: "chemical_and_photographic_products_plant_and_machine_operators";
    readonly label: "Chemical and photographic products plant and machine operators";
}, {
    readonly id: 15180;
    readonly slug: "rubber_plastic_and_paper_products_machine_operators";
    readonly label: "Rubber, plastic and paper products machine operators";
}, {
    readonly id: 15184;
    readonly slug: "textile_fur_and_leather_products_machine_operators";
    readonly label: "Textile, fur and leather products machine operators";
}, {
    readonly id: 15193;
    readonly slug: "food_and_related_products_machine_operators";
    readonly label: "Food and related products machine operators";
}, {
    readonly id: 15195;
    readonly slug: "wood_processing_and_papermaking_plant_operators";
    readonly label: "Wood processing and papermaking plant operators";
}, {
    readonly id: 15198;
    readonly slug: "other_stationary_plant_and_machine_operators";
    readonly label: "Other stationary plant and machine operators";
}, {
    readonly id: 15204;
    readonly slug: "assemblers";
    readonly label: "Assemblers";
}, {
    readonly id: 15209;
    readonly slug: "locomotive_engine_drivers_and_related_workers";
    readonly label: "Locomotive engine drivers and related workers";
}, {
    readonly id: 15212;
    readonly slug: "car_van_and_motorcycle_drivers";
    readonly label: "Car, van and motorcycle drivers";
}, {
    readonly id: 15215;
    readonly slug: "heavy_truck_and_bus_drivers";
    readonly label: "Heavy truck and bus drivers";
}, {
    readonly id: 15218;
    readonly slug: "mobile_plant_operators";
    readonly label: "Mobile plant operators";
}, {
    readonly id: 15223;
    readonly slug: "ships_deck_crews_and_related_workers";
    readonly label: "Ships’ deck crews and related workers";
}, {
    readonly id: 15227;
    readonly slug: "domestic_hotel_and_office_cleaners_and_helpers";
    readonly label: "Domestic, hotel and office cleaners and helpers";
}, {
    readonly id: 15230;
    readonly slug: "vehicle_window_laundry_and_other_hand_cleaning_workers";
    readonly label: "Vehicle, window, laundry and other hand cleaning workers";
}, {
    readonly id: 15236;
    readonly slug: "agricultural_forestry_and_fishery_labourers";
    readonly label: "Agricultural, forestry and fishery labourers";
}, {
    readonly id: 15244;
    readonly slug: "mining_and_construction_labourers";
    readonly label: "Mining and construction labourers";
}, {
    readonly id: 15248;
    readonly slug: "manufacturing_labourers";
    readonly label: "Manufacturing labourers";
}, {
    readonly id: 15251;
    readonly slug: "transport_and_storage_labourers";
    readonly label: "Transport and storage labourers";
}, {
    readonly id: 15257;
    readonly slug: "food_preparation_assistants";
    readonly label: "Food preparation assistants";
}, {
    readonly id: 15261;
    readonly slug: "street_and_related_service_workers";
    readonly label: "Street and related service workers";
}, {
    readonly id: 15263;
    readonly slug: "street_vendors_excluding_food";
    readonly label: "Street vendors (excluding food)";
}, {
    readonly id: 15266;
    readonly slug: "refuse_workers";
    readonly label: "Refuse workers";
}, {
    readonly id: 15270;
    readonly slug: "other_elementary_workers";
    readonly label: "Other elementary workers";
}];
