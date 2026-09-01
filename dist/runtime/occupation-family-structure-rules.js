import { occupationFamilies } from '../api/occupation-family-taxonomy.js';
import { tokenizeNormalizedText } from '../utils/texts.js';
import { familyStructureVocabularyMatchesForTokens, familyStructureVocabularyValuesByDimension } from './occupation-family-structure-vocabulary.js';
const RAW_FAMILY_STRUCTURE_TSV = String.raw `14659	Commissioned Armed Forces Officers	military_officer	officer, commander, commissioned officer	military, defence	military operations, units	armed forces	military personnel, public security	air, land, sea	military_rank, officer	command, lead, plan, protect	Reject for civilian roles unless query names armed forces/officer/commissioned command.
14662	Non Commissioned Armed Forces Officers	military_non_commissioned	sergeant, corporal, non-commissioned officer, warfare specialist	military, defence	military operations, units	armed forces	military personnel	air, land, sea	military_rank, supervisor	supervise, coordinate, protect	Reject for civilian officer/manager/worker roles without explicit armed-forces NCO signal.
14665	Armed Forces Occupations Other Ranks	military_other_rank	soldier, pilot, military engineer, bomb disposal technician, interceptor	military, defence	weapons, aircraft, communications, engineering systems	armed forces	military personnel	air, land, sea	military_rank, worker	operate, fight, repair, protect	Reject for civilian technician/pilot/engineer unless military context is explicit.
14669	Legislators And Senior Officials	executive_manager	legislator, official, minister, councillor, diplomat, governor	government, public administration, diplomacy	laws, public policy, institutions	government, embassy, public office	public, state		chief, director	govern, legislate, represent	Reject for ordinary manager/administrator unless query names senior public office or elected/official role.
14674	Managing Directors And Chief Executives	executive_manager	chief executive, CEO, COO, managing director, executive director	corporate leadership, organisation leadership	organisations, enterprises	corporate, public service, facility	organisation, workforce		chief, director	direct, govern, manage	Reject for department managers, supervisors, analysts, clerks, or workers unless query names chief/executive/director.
14677	Business Services And Administration Managers	executive_manager	manager, administration manager, business manager, branch manager, budget manager	business, administration, accounting, HR, facility services	business services, budgets, offices, branches	office, corporate, branch	employees, business clients		manager	manage, administer, coordinate	Reject for non-management admin/clerk/accounting roles unless query asks for manager.
14682	Sales Marketing And Development Managers	executive_manager	sales manager, marketing manager, product manager, advertising manager, business development manager	sales, marketing, advertising, product, business development	brands, campaigns, products, bids	corporate, agency, commercial	customers, market		manager	manage, develop, market, sell	Reject for sales agents/sellers/marketing specialists unless managerial authority is explicit.
14687	Production Managers In Agriculture Forestry And Fisheries	executive_manager	production manager, harvesting manager, husbandry manager, forester	agriculture, forestry, fisheries, aquaculture	crops, forests, fish, animals	farm, forest, aquaculture site	workers, production teams		manager	manage, produce, harvest	Reject for growers/labourers/technicians unless query asks for production management in green sectors.
14690	Manufacturing Mining Construction And Distribution Managers	executive_manager	production manager, distribution manager, construction manager, mining manager, plant manager	manufacturing, mining, construction, distribution, logistics	factories, mines, construction sites, goods, materials	plant, mine, construction site, warehouse	production workforce, logistics teams		manager	manage, produce, distribute, construct	Reject for operators/trades/labourers unless query names manager/director/supervisor-level production or distribution.
14695	Information And Communications Technology Service Managers	executive_manager	ICT manager, CIO, CTO, data officer, technology manager, operations manager	ict, data, information systems, technology services	ICT services, data, systems, documentation	office, data centre, enterprise	users, organisation		chief, manager	manage, govern, coordinate	Reject for developers, technicians, help desk, or analysts unless query asks for ICT service management/chief role.
14697	Professional Services Managers	executive_manager	professional services manager, director, publisher, bank manager, safety manager	professional services, aviation, finance, publishing, facility services	service organisations, projects, professional practices	office, bank, airspace, service facility	professional clients, staff	air	manager, director	manage, coordinate, direct	Reject for individual professional roles unless query names manager/director of a professional service.
14706	Hotel And Restaurant Managers	executive_manager	hotel manager, restaurant manager, accommodation manager, rooms division manager	hospitality, food service	accommodation, restaurant operations, rooms	hotel, restaurant, accommodation	guests, diners		manager	manage, host, operate venue	Reject for cooks/waiters/receptionists/cleaners unless managerial hospitality role is explicit.
14709	Retail And Wholesale Trade Managers	executive_manager	shop manager, retail manager, wholesale manager, store manager	retail, wholesale, trade	shops, stores, traded goods	shop, store, retail outlet, wholesale business	customers, sales staff		manager	manage, sell, trade	Reject for sellers/cashiers/sales assistants unless query asks for manager/supervisor/entrepreneur.
14711	Other Services Managers	executive_manager	service manager, salon manager, call centre manager, gambling manager, cultural facility manager	personal services, contact centre, gambling, cultural services	service venues, call centres, salons, facilities	salon, call centre, cultural centre, camping, betting venue	customers, visitors	telephone, chat	manager, director	manage, operate services	Reject for service workers/agents unless manager/director role is explicit.
14716	Physical And Earth Science Professionals	professional	scientist, chemist, physicist, geologist, meteorologist, tester	physical science, earth science, chemistry, astronomy, geology, meteorology	substances, environment, earth, climate, chemicals	laboratory, field, observatory	research clients, public	air	professional	analyse, research, test	Reject for technicians/operators unless professional scientist/chemist/geologist role is explicit.
14721	Mathematicians Actuaries And Statisticians	professional	mathematician, actuary, statistician, biometrician, demographer	mathematics, statistics, actuarial science, gambling analytics	data, risk models, statistics	office, research, insurance, gambling	business clients, public		professional	analyse, model, calculate	Reject for finance clerks/traders unless query names actuarial/statistical/mathematical professional.
14723	Life Science Professionals	professional	life scientist, biologist, agronomist, environmental analyst, nutritionist	biology, agriculture science, environment, animal science, aquaculture	organisms, crops, animals, environment, pollution	laboratory, farm, field, aquaculture site, airport environment	public, animals, ecosystems	air	professional	research, analyse, advise	Reject for life-science technicians/farm workers unless query asks for professional scientist/specialist.
14727	Engineering Professionals Excluding Electrotechnology	professional	engineer, architect-engineer, planner, designer, consultant	engineering, mechanical, civil, aerospace, agricultural, chemical, industrial	structures, machines, systems, materials, infrastructure	construction site, plant, office, airport	clients, public	air, road, rail, ship	professional	design, engineer, analyse, plan	Reject for technicians/mechanics/operators unless query names engineer/professional design role.
14735	Electrotechnology Engineers	professional	electrical engineer, electronics engineer, hardware engineer, power engineer, electromechanical engineer	electrical, electronics, power, hardware, electromagnetic	circuits, batteries, power systems, electronics, hardware	plant, laboratory, office	clients, users		professional	design, engineer, analyse, simulate	Reject for electricians/installers/repair technicians unless query names engineer/professional design role.
14739	Architects Planners Surveyors And Designers	professional	architect, planner, surveyor, designer, modeller, cartographer	architecture, planning, surveying, design, animation design	buildings, land, maps, models, designs	studio, office, construction site, field	clients, public	road, land	professional	design, plan, survey, model	Reject for construction trades/drafters unless query names architect/planner/surveyor/designer.
14747	Medical Doctors	professional	doctor, physician, general practitioner, specialist doctor	medicine, healthcare	diagnosis, treatment, patients	clinic, hospital, practice	patient		professional	diagnose, treat, prescribe	Reject for nurses, technicians, assistants, therapists unless query clearly names doctor/physician.
14750	Nursing And Midwifery Professionals	professional	nurse, midwife, nurse practitioner, specialist nurse	nursing, midwifery, healthcare	patient care, maternity care	hospital, clinic, community health	patient, mother, infant		professional	care, treat, support	Reject for nursing assistants/healthcare assistants unless professional nurse/midwife role is explicit.
14753	Traditional And Complementary Medicine Professionals	professional	acupuncturist, aromatherapist, homeopath, complementary therapist	complementary medicine, traditional medicine, therapy	treatment, wellbeing	clinic, therapy practice	patient, client		professional	treat, advise, care	Reject for conventional doctors/nurses/health technicians unless complementary medicine role is explicit.
14757	Veterinarians	professional	veterinarian, animal health professional, animal therapist	veterinary medicine, animal health	animals, animal treatment	clinic, farm, aquatic animal facility	animal, animal owner		professional	diagnose, treat, care	Reject for veterinary assistants/animal care workers unless veterinarian/professional animal health is explicit.
14759	Other Health Professionals	professional	therapist, physiotherapist, audiologist, biomedical scientist, psychologist, health professional, pharmacist, dentist	health, therapy, rehabilitation, diagnostics, biomedical science, pharmacy, dentistry	patients, treatment plans, diagnostics, medicines, dental care	hospital, clinic, laboratory, therapy practice, pharmacy, dental office	patient, client		professional	treat, diagnose, rehabilitate, analyse, dispense medicine	Reject for doctors/nurses/technicians/assistants when their specific family is compatible.
14769	University And Higher Education Teachers	professional	lecturer, professor, higher education teacher, academic teacher	higher education, academic disciplines	courses, research subjects	university, college	student		professional	teach, lecture, research	Reject for school/vocational teachers unless higher education/university is explicit.
14771	Vocational Education Teachers	professional	vocational teacher, instructor, trainer	vocational education, trade education, professional training	vocational subjects, practical skills	vocational school, training centre	student, trainee		professional	teach, train, instruct	Reject for university/primary/secondary teachers unless vocational/training context is explicit.
14773	Secondary Education Teachers	professional	secondary teacher, school teacher, subject teacher	secondary education, school subjects	curriculum, school subjects	secondary school, high school	student, adolescent		professional	teach	Reject for primary/early-years/university/vocational teachers unless secondary-school context is explicit.
14775	Primary School And Early Childhood Teachers	professional	primary teacher, early years teacher, Montessori teacher, Freinet teacher	primary education, early childhood education	curriculum, early learning	primary school, nursery, early-years school	child, pupil		professional	teach, care, develop	Reject for teacher aides/childcare workers/secondary teachers unless primary or early-years teacher is explicit.
14778	Other Teaching Professionals	professional	education officer, academic advisor, assessor, trainer, support teacher	education, learning support, admissions, assessment	courses, learning support, training	school, university, training centre	student, learner		professional	teach, advise, assess, support	Reject for ordinary teachers when a more specific teacher family matches; use as residual education professional family.
14787	Finance Professionals	professional	accountant, auditor, financial analyst, adviser, controller, risk manager	finance, accounting, audit, banking, investment, tax, insurance	accounts, budgets, investments, securities, taxes	office, bank, corporate finance	business clients, investors		professional	analyse, audit, advise, control	Reject for finance clerks/tellers/traders unless professional finance/accounting/audit role is explicit.
14791	Administration Professionals	professional	administrator, analyst, consultant, policy officer, HR professional, business analyst	administration, business, policy, HR, management consulting	policies, processes, business information	office, public administration, corporate	clients, workforce		professional	analyse, advise, administer, consult	Reject for clerks/secretaries/general office support unless professional administration/consulting role is explicit.
14796	Sales Marketing And Public Relations Professionals	professional	marketing professional, PR professional, sales professional, business developer, advertising specialist	sales, marketing, public relations, advertising, business development	campaigns, brands, markets, customers	office, agency, commercial	customers, market, public		professional	market, sell, develop, communicate	Reject for retail sellers/agents/managers unless professional marketing/PR/business development is explicit.
14802	Software And Applications Developers And Analysts	professional	developer, software engineer, application developer, analyst, architect, tester, data scientist	ict, software, applications, data, AI, cloud, games	software, applications, systems, data, code	office, remote, data centre	users, organisations		professional	develop, analyse, design, test	Reject for database/network professionals when query specifically names database/network/security/admin unless software/app development is also present.
14808	Database And Network Professionals	professional	database professional, network professional, administrator, architect, security specialist, ethical hacker	ict, database, network, cybersecurity, data warehouse, systems administration	databases, networks, security systems, data warehouses	office, data centre, network environment	users, organisations		professional	administer, secure, design, configure	Reject for generic software developer/application analyst when query lacks database/network/security terms.
14814	Legal Professionals	professional	lawyer, judge, coroner, legal_professional, legal officer, data protection officer	legal, judicial, compliance, human rights	laws, contracts, cases, rights	court, law office, government	clients, public		professional	advise, judge, represent, enforce law	Reject for legal clerks/associate professionals unless lawyer/judge/legal professional is explicit.
14818	Librarians Archivists And Curators	professional	librarian, archivist, curator, registrar, collection manager	library, archive, museum, curation, information management	collections, records, exhibits, archives	library, archive, museum, gallery	visitors, researchers, public		professional	curate, preserve, catalog, manage information	Reject for library assistants/cultural workers unless professional librarian/curator/archive role is explicit.
14821	Social And Religious Professionals	professional	social worker, counsellor, chaplain, researcher, religious professional	social work, religion, counselling, anthropology, archaeology, social science	social services, community support, research	community, care setting, religious institution	client, community, child, adult		professional	counsel, advise, support, research	Reject for clerical/legal associate/social care workers unless professional social/religious role is explicit.
14828	Authors Journalists And Linguists	professional	author, journalist, editor, writer, linguist, translator	media, journalism, publishing, language	texts, news, translations, publications	newsroom, publishing office, media	readers, audiences		professional	write, edit, translate, report	Reject for marketing copy/sales/media technicians unless author/journalist/linguist role is explicit.
14832	Creative And Performing Artists	professional	artist, actor, performer, director, painter, musician, dancer	arts, performing arts, creative production	performances, artworks, audio, theatre, animation	stage, studio, gallery, theatre	audience, visitors		professional	perform, create, direct, restore	Reject for cultural technicians/assistants unless creative artist/performer role is explicit.
14842	Physical And Engineering Science Technicians	associate_technical	technician, drafter, inspector, tester, laboratory technician	engineering, physical science, construction, aerospace, materials	equipment, samples, drawings, structures, engines	lab, plant, construction site, airport, field	engineers, clients	air, road, rail, ship	associate	test, inspect, draft, maintain, assist engineering	Reject for professional engineers/scientists or trades mechanics unless technician/drafter/tester role is explicit.
14852	Mining Manufacturing And Construction Supervisors	associate_technical	supervisor, foreman, team leader	mining, manufacturing, construction, assembly	worksites, production lines, crews, materials	mine, plant, construction site	workers, crews	air	supervisor	supervise, coordinate, inspect	Reject for managers, operators, labourers, trades workers unless supervision is explicit.
14856	Process Control Technicians	associate_technical	process control technician, controller, plant operator, distributor	process control, utilities, chemical processing, power, assembly lines	control rooms, plants, processes, energy systems	plant, control room, utility network	operations teams		associate	monitor, control, operate process	Reject for general machine operators or engineers unless process/control-room technician role is explicit.
14863	Life Science Technicians And Related Associate Professionals	associate_technical	life science technician, laboratory technician, site supervisor, agricultural technician	biology, agriculture, aquaculture, biotechnology	samples, crops, organisms, aquaculture sites	laboratory, farm, aquaculture site, field	scientists, animals, environment		associate	test, assist, supervise, analyse	Reject for professional life scientists/farm workers unless technician/associate role is explicit.
14867	Ship And Aircraft Controllers And Technicians	associate_technical	air traffic controller, aircraft pilot, ship officer, aviation technician, aircraft maintenance engineer	aviation, maritime, transport control	aircraft, ships, airspace, navigation, operations	airport, aircraft, ship, port, airspace	passengers, crew	air, ship	associate	control, pilot, navigate, maintain	Reject for domain-only aviation queries when role head is non-aviation (e.g. auditor/compliance) unless controller/pilot/ship/aircraft technician is explicit.
14874	Medical And Pharmaceutical Technicians	associate_technical	medical technician, pharmacy assistant, laboratory assistant, radiation therapist, prosthetist	medical, pharmaceutical, clinical, audiology	tests, prosthetics, pharmacy products, radiation equipment	hospital, clinic, laboratory, pharmacy	patient		associate	assist, test, dispense, treat	Reject for doctors/nurses/general health professionals unless technician/assistant/pharmacy/lab role is explicit.
14879	Nursing And Midwifery Associate Professionals	associate_technical	maternity support worker, nursing associate	nursing, midwifery, healthcare	patient care, maternity support	hospital, clinic, maternity setting	patient, mother, infant		associate, assistant_helper	support, care	Reject for professional nurses/midwives unless associate/support wording is explicit.
14882	Traditional And Complementary Medicine Associate Professionals	associate_technical	herbal therapist, complementary medicine associate	complementary medicine, herbal medicine	therapies, herbs	therapy practice, clinic	patient, client		associate	treat, support	Reject for professional complementary practitioners unless associate/herbal support role fits.
14884	Veterinary Technicians And Assistants	associate_technical	veterinary technician, veterinary nurse, animal assistant, insemination technician	veterinary, animal health	animals, veterinary treatment, reproduction	clinic, farm, animal facility	animal		associate, assistant_helper	assist, nurse, treat animals	Reject for veterinarians or general animal care workers unless veterinary technician/assistant is explicit.
14886	Other Health Associate Professionals	associate_technical	health associate, clinical coder, dental assistant, dietetic technician, assistant psychologist	health, clinical support, dental, dietetic, psychology	clinical records, treatment support, dental care, tests	hospital, clinic, dental office, community health	patient, client		associate, assistant_helper	assist, code, test, support care	Reject for doctors/nurses/health professionals when a specific family is compatible.
14897	Financial And Mathematical Associate Professionals	associate_technical	bookkeeper, credit analyst, broker, trader, appraiser, claims handler	finance, accounting, banking, trading, insurance, real estate, statistics	accounts, loans, securities, claims, property, trades	office, bank, exchange, insurance office	clients, investors		associate	calculate, trade, broker, appraise, administer finance	Reject for professional accountants/auditors/financial analysts unless associate/broker/trader/clerkish finance role is explicit.
14903	Sales And Purchasing Agents And Brokers	associate_technical	sales agent, purchasing agent, broker, buyer, trader, representative	sales, purchasing, brokerage, trade, insurance	commodities, products, contracts, traded goods	office, market, commercial field	customers, suppliers, clients		associate	sell, buy, broker, negotiate	Reject for retail shop sellers/managers/marketing professionals unless agent/broker/buyer role is explicit.
14908	Business Services Agents	associate_technical	agent, auctioneer, customs officer, employment agent, forwarding manager, event assistant	business services, customs, employment, real estate, events, logistics	services, events, freight, customs documents, property	office, customs, event venue, logistics	clients, applicants, shippers		associate	arrange, broker, administer services, coordinate	Reject for general business managers/professionals/clerks unless agent/service arrangement role is explicit.
14919	Regulatory Government Associate Professionals	associate_technical	inspector, investigator, customs officer, government associate, advisor	regulation, government, inspection, customs, fisheries, forestry	permits, goods, compliance cases, regulations	government office, field, border, industry site	public, businesses		associate	inspect, investigate, regulate, enforce	Reject for legal professionals/police/security unless regulatory/government inspector role is explicit.
14927	Legal Social And Religious Associate Professionals	associate_technical	legal associate, social associate, religious associate, clerk, care worker, bailiff	legal, social services, religious support	cases, care records, court documents, community support	court, care home, community, religious institution	client, adult, child, community		associate	support, administer cases, assist legal/social work	Reject for legal/social/religious professionals unless associate/support role is explicit.
14931	Sports And Fitness Workers	associate_technical	coach, instructor, fitness worker, activity leader	sports, fitness, recreation	exercise, sport, outdoor activities	gym, sports facility, outdoor venue	clients, athletes, children		worker, associate	coach, instruct, train, lead activities	Reject for professional artists/teachers/personal services unless sports/fitness role is explicit.
14935	Artistic Cultural And Culinary Associate Professionals	associate_technical	cultural associate, culinary associate, technician, stage assistant, librarian technician	arts, culture, culinary, broadcasting, archives	performances, cultural assets, food, audio/video	theatre, studio, archive, kitchen, cultural venue	audience, visitors, diners		associate	assist, produce, operate, prepare, curate support	Reject for creative professionals/cooks/technicians unless associate cultural/culinary role fits.
14942	Information And Communications Technology Operations And User Support Technicians	associate_technical	ICT technician, help desk agent, network technician, support technician, webmaster	ict, operations, user support, network, security	ICT systems, networks, help desk tickets, websites	office, data centre, support desk	users, customers	telephone, chat	associate	support, operate, maintain, troubleshoot	Reject for software/database/network professionals or ICT managers unless technician/support/operations role is explicit.
14947	Telecommunications And Broadcasting Technicians	associate_technical	telecom technician, broadcast technician, audiovisual technician, camera operator, recording technician	telecommunications, broadcasting, audiovisual, media production	telecom equipment, broadcast systems, cameras, audio/video	studio, broadcast site, performance venue, field	audience, users		associate	install, operate, record, broadcast	Reject for ICT support technicians or creative performers unless telecom/broadcast technical role is explicit.
14952	General Office Clerks	clerical	office clerk, administrator, membership administrator	office administration, general clerical	records, office documents, memberships	office	internal staff, customers		worker	file, administer, record	Reject for professional administrators/secretaries/data entry/specialised clerks when specific family matches.
14954	Secretaries General	clerical	secretary	secretarial, office support	correspondence, schedules, documents	office	managers, staff		worker	schedule, correspond, support	Reject for administrative assistants/specialised secretaries if query indicates specialised/admin assistant.
14956	Keyboard Operators	clerical	typist, data entry clerk, keyboard operator	data entry, typing, clerical	data, text, records	office	internal users		worker	type, enter data	Reject for general office clerks/IT/data analysts unless keyboard/data-entry role is explicit.
14960	Tellers Money Collectors And Related Clerks	clerical	teller, cashier, collector, gaming dealer, bookmaker	banking, money collection, gaming, debt collection	money, accounts, bets, debts, tickets	bank, casino, collection office	customers, debtors		worker	collect, pay, exchange, deal gaming	Reject for finance professionals/cashiers in shops unless teller/money collector/gaming clerk is explicit.
14965	Client Information Workers	clerical	receptionist, customer service representative, information clerk, switchboard operator, travel agent	customer service, reception, information, travel, contact centre	enquiries, bookings, tickets, customer information	reception, hotel, clinic, call centre, railway, travel office	customer, client, passenger, tourist, patient	telephone, chat, ticket, reception	worker	receive, inform, book, answer, route	Reject for sales agents/managers/clerks when query role is not reception/customer information/contact channel.
14975	Numerical Clerks	clerical	auditing clerk, billing clerk, payroll clerk, insurance clerk, back office clerk	accounting support, payroll, billing, insurance, financial markets support	invoices, payroll, accounts, financial records	office, back office, insurance office	internal staff, customers		worker	calculate, record, process accounts	Reject for finance professionals/bookkeepers/tellers unless clerical numerical support is explicit.
14979	Material Recording And Transport Clerks	clerical	logistics clerk, dispatcher, transport clerk, warehouse operator, cargo coordinator	logistics, transport administration, inventory, warehousing	shipments, cargo, inventory, schedules	warehouse, airport, transport office, bridge	shippers, passengers, drivers	air, road, rail, warehouse_transport	worker	dispatch, record, schedule, coordinate transport	Reject for drivers/operators/labourers unless clerical logistics/dispatch/recording role is explicit.
14984	Other Clerical Support Workers	clerical	assistant, file clerk, mail clerk, proofreader, post worker, HR assistant	clerical support, mail, files, HR support, correspondence	files, mail, documents, language correspondence	office, library, postal setting	internal staff, customers		worker, assistant_helper	support, file, mail, proofread	Reject for professional admin/secretarial roles when specific clerical family matches.
14914	Administrative And Specialised Secretaries	clerical	administrative assistant, specialised secretary, registrar, court reporter, supervisor	administrative support, call centre admin, legal admin, data entry supervision	records, calls, reports, registrations	office, court, call centre	managers, public, customers	telephone	worker, supervisor	administer, supervise clerical work, report	Reject for general secretaries or professional administrators unless specialised administrative support is explicit.
14994	Travel Attendants Conductors And Guides	service_sales	attendant, conductor, guide, steward, flight attendant, cabin crew	travel, tourism, passenger transport, environmental education	journeys, tickets, tours, cabins	aircraft, railway, ship, park, travel route	passenger, tourist, traveller	air, rail, ship, passenger_travel	worker, supervisor	guide, attend, conduct, assist passengers	Reject for drivers/pilots/customer service clerks unless attendant/conductor/guide role is explicit.
14998	Cooks	service_sales	cook, chef, pastry chef, industrial cook	food service, cooking, culinary	meals, food, pastry, fish, grill	kitchen, restaurant, industrial kitchen	diners, customers		worker, supervisor	cook, prepare_food	Reject for food processing operators/kitchen assistants/waiters unless cook/chef role is explicit.
15000	Waiters And Bartenders	service_sales	waiter, bartender, barista, sommelier, restaurant host	food service, beverage service, hospitality	drinks, tables, service orders	restaurant, bar, cafe	diner, customer, guest		worker, supervisor	serve, host, pour drinks	Reject for cooks/hotel reception/restaurant managers unless waiter/bartender/service role is explicit.
15003	Hairdressers Beauticians And Related Workers	service_sales	hairdresser, barber, beautician, aesthetician, makeup artist	beauty, grooming, personal care	hair, beauty treatments, cosmetics	salon, studio	client		worker, assistant_helper	cut, style, beautify, treat	Reject for salon managers/health therapists unless beauty/hair service worker is explicit.
15006	Building And Housekeeping Supervisors	service_sales	housekeeper, housekeeping supervisor, caretaker, butler, verger	housekeeping, building care, domestic service	buildings, rooms, households, facilities	hotel, domestic, building, bed and breakfast	guests, residents		supervisor, worker	supervise, clean, maintain premises	Reject for cleaners/helpers or facility managers unless housekeeping/building supervision/caretaker role is explicit.
15010	Other Personal Services Workers	service_sales	attendant, instructor, animal care attendant, groomer, astrologer, driving instructor	personal services, animal care, instruction, recreation	animals, personal services, lessons	service venue, animal shelter, vehicle training	client, animal, learner	road_light	worker	serve, instruct, care, groom	Reject for health care, sports fitness, protective, or sales roles when specific family fits.
15018	Street And Market Salespersons	service_sales	market vendor, street vendor, street food vendor	street sales, market sales, food vending	goods, food	street, market	customer, public		worker	sell, vend	Reject for shop sellers/sales agents unless street/market vending is explicit.
15021	Shop Salespersons	service_sales	shop assistant, specialised seller, retail salesperson, checkout supervisor, personal shopper	retail, specialised goods sales	shop goods, clothing, food, electronics, vehicles, books, medical goods	shop, store, retail outlet	customer		worker, supervisor	sell, advise customers, checkout	Reject for sales agents/brokers/managers unless shop/retail seller role is explicit.
15025	Cashiers And Ticket Clerks	service_sales	cashier, lottery cashier, ticket clerk	cash handling, ticketing, retail/service transactions	cash, tickets, lottery	shop, ticket counter, service counter	customer, passenger	ticket	worker	take payment, issue tickets	Reject for bank tellers/accounting clerks unless cashier/ticket clerk role is explicit.
15027	Other Sales Workers	service_sales	sales worker, call centre agent, demonstrator, door-to-door seller, model, fuel station seller	sales, promotion, customer contact, demonstration	products, fuel, promotions, services	call centre, street, fuel station, restaurant, event	customer	telephone, door, restaurant	worker, supervisor	sell, demonstrate, promote, serve	Reject for shop sellers/agents/managers unless residual sales worker/channel is explicit.
15036	Child Care Workers And Teachers Aides	service_sales	child care worker, nanny, babysitter, teaching assistant, au pair	child care, early education support	children, classroom support	home, school, nursery, bus	child, pupil	road_light	assistant_helper, worker	care, supervise children, assist teaching	Reject for professional teachers/social workers unless aide/child-care/support role is explicit.
15039	Personal Care Workers In Health Services	service_sales	healthcare assistant, home care aide, nurse assistant, hospital porter, phlebotomist	health care support, personal care	patients, sterile services, blood samples	hospital, home care, healthcare facility	patient		assistant_helper, worker	care, assist, transport patients, support clinical work	Reject for nurses/doctors/medical technicians unless personal care assistant/support role is explicit.
15044	Protective Services Workers	service_sales	security officer, guard, bodyguard, inspector, coastguard, crossing guard	security, public safety, protection, enforcement	people, property, borders, aircraft movement	airport, street, coast, public space, facility	public, passengers, animals	air, road	worker	protect, guard, enforce, inspect safety	Reject for military/police/regulatory roles unless protective service worker/security/guard role is explicit.
15052	Market Gardeners And Crop Growers	skilled_trades	gardener, crop grower, horticulture worker, arboriculturist	agriculture, horticulture, crop production	crops, fruit, vegetables, plants, trees	farm, garden, nursery, greenhouse	plants		worker, supervisor	grow, cultivate, harvest	Reject for farm labourers/agricultural scientists/managers unless skilled crop/garden role is explicit.
15057	Animal Producers	skilled_trades	breeder, animal producer, yard manager	animal production, livestock, breeding	animals, bees, cattle, horses, pigs, poultry	farm, yard, animal facility	animal		worker, supervisor	breed, raise animals	Reject for veterinarians/animal care attendants/farm labourers unless animal production/breeding is explicit.
15062	Mixed Crop And Animal Producers	skilled_trades	mixed farmer, farm manager	mixed farming, agriculture, animal production	crops, animals, farm operations	farm	animals, crops		worker, manager	farm, produce crops and animals	Reject when query is solely crop, animal, labourer, scientist, or manager without mixed-farm signal.
15065	Forestry And Related Workers	skilled_trades	forest ranger, forestry worker	forestry, conservation	forests, trees, woodland	forest	public, environment		worker	maintain, protect, manage forest	Reject for forestry labourers/scientists/managers unless skilled forestry worker/ranger role is explicit.
15067	Fishery Workers Hunters And Trappers	skilled_trades	fishery worker, hunter, trapper, aquaculture technician/worker	fisheries, aquaculture, hunting	fish, aquatic animals, cages, hatcheries	fishery, aquaculture site, sea, water	animals	ship	worker, supervisor	harvest, trap, fish, maintain aquaculture	Reject for marine crew/scientists/labourers unless fishery/hunting/aquaculture worker role is explicit.
15083	Building Frame And Related Trades Workers	skilled_trades	bricklayer, carpenter, scaffolder, demolition worker, installer, frame maker	construction, building frame	frames, bricks, concrete, scaffolds, doors, fireplaces	construction site, building	clients		worker	build, install, demolish	Reject for construction labourers/finishers/engineers unless skilled frame/building trade is explicit.
15090	Building Finishers And Related Trades Workers	skilled_trades	fitter, installer, technician, floor layer, HVAC installer, plumber-like finisher	construction finishing, building systems, HVAC, flooring	floors, ceilings, drains, gas, heating, ventilation, bathrooms	building, construction site, domestic	clients		worker	finish, fit, install, repair	Reject for frame trades/labourers/electricians unless finishing/building-system trade is explicit.
15098	Painters Building Structure Cleaners And Related Trades Workers	skilled_trades	painter, structure cleaner, chimney sweep, abatement worker, spray operator	painting, building cleaning, decontamination	building surfaces, paint, chimneys, asbestos	building, construction site, exterior, marine	clients	ship	worker, supervisor	paint, clean structures, decontaminate	Reject for elementary cleaners or construction trades unless painting/structure cleaning trade is explicit.
15103	Sheet And Structural Metal Workers Moulders And Welders And Related Workers	skilled_trades	welder, sheet metal worker, moulder, brazier, rigger, coppersmith	metal trades, welding, moulding, structural metal	metal, sheets, structures, moulds, containers	workshop, shipyard, plant, construction	clients, production teams	ship	worker	weld, mould, fabricate, assemble metal	Reject for metal machine operators/engineers unless skilled metal/welding trade is explicit.
15109	Blacksmiths Toolmakers And Related Trades Workers	skilled_trades	blacksmith, toolmaker, CNC operator, machine tool operator, mould maker	toolmaking, machining, forging, precision trades	tools, dies, moulds, metal parts, machines	workshop, plant	production teams		worker	forge, machine, make tools, operate CNC	Reject for generic machine operators/metal processing unless toolmaking/precision trade is explicit.
15114	Machinery Mechanics And Repairers	skilled_trades	mechanic, machinery technician, repairer, maintenance technician, fitter	machinery, vehicles, engines, maintenance, repair	machinery, engines, vehicles, cranes, industrial equipment	workshop, field, plant, aircraft, marine	equipment owners	air, ship, road_light, mobile_plant	worker, supervisor	repair, maintain, fit, overhaul	Reject for engineers/operators/installers unless mechanic/repair/maintenance role is explicit.
15120	Handicraft Workers	skilled_trades	craft worker, artisan, maker, restorer, weaver, watchmaker	handicraft, craft production, restoration	baskets, candles, carpets, ceramics, clocks, paper, crafts	workshop, studio	customers, collectors		worker	craft, make, restore	Reject for industrial operators/artists unless manual craft/handicraft worker is explicit.
15130	Printing Trades Workers	skilled_trades	printer, bindery operator, press operator, book restorer, imagesetter	printing, binding, publishing production	printed materials, books, presses, images	print shop, press room, bindery	publishing clients		worker	print, bind, restore books	Reject for authors/editors or machine operators unless printing trade is explicit.
15135	Electrical Equipment Installers And Repairers	skilled_trades	electrician, electrical installer, repair technician, line worker, meter technician	electrical, power, installation, repair	electrical equipment, cables, meters, batteries, lighting, lifts, appliances	building, domestic, industrial, street, marine, mine	customers, facilities	ship, rail, road_light	worker	install, repair, maintain electrical systems	Reject for electrotechnology engineers/electronics repair/ICT unless electrical installation/repair role is explicit.
15139	Electronics And Telecommunications Installers And Repairers	skilled_trades	electronics installer, telecom repairer, fibre installer, avionics technician, radio technician	electronics, telecommunications, repair, installation	electronics, telecom equipment, alarms, mobile devices, hardware	office, vehicle, marine, rail, home, telecom site	customers, users	air, ship, rail	worker	install, repair, maintain electronics/telecom	Reject for ICT support/professional network roles or electricians unless electronics/telecom installation/repair is explicit.
15143	Food Processing And Related Trades Workers	skilled_trades	baker, butcher, chocolatier, food maker, taster, curing worker	food processing, baking, butchery, confectionery	food, meat, dairy, beverages, chocolate	bakery, food plant, butcher shop	customers, production teams		worker	process food, bake, butcher, make products	Reject for cooks/food machine operators/kitchen assistants unless skilled food-processing trade is explicit.
15150	Wood Treaters Cabinet Makers And Related Trades Workers	skilled_trades	cabinet maker, wood treater, furniture restorer, cooper, wood machine worker	woodworking, furniture, wood treatment	wood, furniture, cabinets, barrels, models	workshop, factory	customers, production teams		worker	make, treat, restore wood products	Reject for carpenters/building trades/wood machine operators unless woodworking/cabinet trade is explicit.
15154	Garment And Related Trades Workers	skilled_trades	garment worker, footwear technician, patternmaker, tailor-like worker, costume maker	garment, clothing, footwear, textile craft	clothing, garments, footwear, costumes, patterns	workshop, factory, studio	customers, production teams	air	worker	cut, sew, grade, make garments	Reject for textile machine operators/fashion designers unless garment trade is explicit.
15161	Other Craft And Related Workers	skilled_trades	inspector, diver, test driver, quality inspector, craft worker	craft, quality inspection, assembly inspection, consumer goods	aircraft assemblies, batteries, cigars, clothing, consumer goods	plant, construction, workshop, underwater site	production teams, customers	air, road, ship	worker	inspect, test, craft, dive	Reject when a specific craft/trade family matches; use as residual craft/inspection family.
15169	Mining And Mineral Processing Plant Operators	plant_machine_operator	plant operator, driller, derrickhand, mining operator, processing operator	mining, mineral processing, asphalt, concrete, drilling	minerals, asphalt, concrete, drilling equipment	mine, quarry, plant, drilling site	production teams	mobile_plant	worker	operate plant, drill, process minerals	Reject for mining labourers/engineers/managers unless plant/operator role is explicit.
15174	Metal Processing And Finishing Plant Operators	plant_machine_operator	metal plant operator, grinder, caster, plating operator, coating operator	metal processing, finishing, plating, casting	metal, coatings, castings, surfaces	metal plant, workshop	production teams		worker	operate, grind, cast, finish metal	Reject for welders/toolmakers/metal trades unless plant/machine operation is explicit.
15177	Chemical And Photographic Products Plant And Machine Operators	plant_machine_operator	chemical machine operator, mixer, distillation operator, photographic products operator	chemical, photographic, cosmetics, fertiliser, digestion	chemicals, photographic products, cosmetics, fertiliser	chemical plant, production line	production teams		worker	operate machines, mix, distil, process chemicals	Reject for chemists/chemical engineers unless plant/machine operator is explicit.
15180	Rubber Plastic And Paper Products Machine Operators	plant_machine_operator	rubber machine operator, plastic machine operator, paper products operator	rubber, plastic, paper products manufacturing	rubber, plastic, paper, envelopes, corrugated products	factory, production line	production teams		worker	operate machines, mould, press, make products	Reject for skilled trades or assemblers unless rubber/plastic/paper machine operation is explicit.
15184	Textile Fur And Leather Products Machine Operators	plant_machine_operator	textile machine operator, leather machine operator, cutting operator, machinist	textile, fur, leather, clothing manufacturing	textiles, fur, leather, clothing, canvas	factory, production line	production teams		worker	operate machines, cut, sew, sample, process textile	Reject for garment trades/designers unless machine operation is explicit.
15193	Food And Related Products Machine Operators	plant_machine_operator	food machine operator, beverage technician, blending operator, brewing operator	food manufacturing, beverage, animal feed	food, beverages, dairy, meat, animal feed	food plant, brewery, production line	production teams		worker	operate machines, blend, fill, brew, process food	Reject for cooks/food trades/kitchen assistants unless food machine/plant operation is explicit.
15195	Wood Processing And Papermaking Plant Operators	plant_machine_operator	wood processing operator, papermaking operator, saw operator, debarker	wood processing, papermaking	wood, paper, boards, pulp	sawmill, paper mill, plant	production teams		worker	operate plant, saw, bleach, debark, process wood/paper	Reject for cabinet makers/carpenters unless wood/paper plant operation is explicit.
15198	Other Stationary Plant And Machine Operators	plant_machine_operator	plant operator, boiler operator, kiln burner, bottling operator, cylinder filler	stationary plant, machine operation, kiln, boiler, bottling	boilers, kilns, bottles, cylinders, clay, cigars	plant, factory, kiln, boiler room	production teams		worker	operate stationary plant/machines	Reject when a specific plant/operator family matches; use as residual stationary operator family.
15204	Assemblers	skilled_trades	assembler, panel assembler, instrument assembler, aircraft assembler	assembly, manufacturing	aircraft, batteries, bicycles, instruments, cables, panels	factory, assembly line, workshop	production teams	air, road_light	worker	assemble, fit components	Reject for machine operators/mechanics unless assembly role is explicit.
15209	Locomotive Engine Drivers And Related Workers	driver_transport	train driver, shunter, rail switchperson, train dispatcher, signalperson	rail transport	trains, rail switches, signals	railway, station, rail yard	passengers, freight	rail	worker	drive trains, dispatch, switch rail	Reject for road/ship/air/mobile-plant transport unless rail locomotive/rail operations are explicit.
15212	Car Van And Motorcycle Drivers	driver_transport	car driver, van driver, motorcycle courier, taxi driver, chauffeur	road transport, light vehicle driving	cars, vans, motorcycles, taxis	road, parking, delivery route	passenger, patient, customer	road_light	worker	drive, deliver, chauffeur	Reject for heavy truck/bus/train/mobile-plant drivers unless light road vehicle is explicit.
15215	Heavy Truck And Bus Drivers	driver_transport	truck driver, bus driver, cargo driver, dangerous goods driver, vehicle operator	road transport, heavy vehicle driving, bus transport	trucks, buses, cargo vehicles, pumps, emergency vehicles	road, bus route, cargo route	passengers, cargo, animals	road_heavy	worker	drive, transport cargo/passengers	Reject for car/van/motorcycle/train/mobile-plant drivers unless heavy truck/bus/cargo vehicle is explicit.
15218	Mobile Plant Operators	driver_transport	mobile plant operator, crane operator, excavator operator, forklift operator, bulldozer operator	mobile plant, construction equipment, forestry equipment, mining equipment	cranes, excavators, forklifts, bulldozers, graders	construction site, warehouse, mine, forest, plant	production teams	mobile_plant	worker, supervisor	operate mobile plant/equipment	Reject for vehicle drivers/stationary plant operators unless mobile plant/equipment operation is explicit.
15223	Ships Deck Crews And Related Workers	driver_transport	sailor, deckhand, boatswain, seaman, engine minder	maritime, ship deck operations, fisheries support	ships, decks, engines, fishing vessels	ship, vessel, sea, port	crew	ship	worker	crew, maintain deck, operate ship support	Reject for ship officers/controllers/fishery workers unless deck crew/seaman role is explicit.
15227	Domestic Hotel And Office Cleaners And Helpers	elementary	cleaner, helper, room attendant, toilet attendant, domestic cleaner	cleaning, housekeeping support	rooms, offices, hotels, domestic spaces, trains, aircraft interiors	domestic, hotel, office, train, aircraft, building, hospital, healthcare facility	guests, residents, staff, patients	air, rail	assistant_helper, worker	clean, help, tidy	Reject for housekeeping supervisors/building caretakers/structure cleaners unless elementary cleaner/helper role is explicit.
15230	Vehicle Window Laundry And Other Hand Cleaning Workers	elementary	vehicle cleaner, window cleaner, laundry worker, presser, attendant	hand cleaning, laundry, vehicle cleaning	vehicles, windows, laundry, apparel, carpets	laundry, vehicle facility, amusement facility, pool	customers	road_light	worker	clean by hand, launder, press	Reject for domestic/office cleaners or structure cleaners unless vehicle/window/laundry hand-cleaning is explicit.
15236	Agricultural Forestry And Fishery Labourers	elementary	labourer, farm worker, picker, forest worker, aquaculture worker	agriculture, forestry, fishery, aquaculture	crops, forests, fish, animals	farm, forest, fishery, aquaculture site	animals, plants	ship	worker	labour, harvest, pick, assist	Reject for skilled growers/producers/fishery workers/scientists unless labourer/helper role is explicit.
15244	Mining And Construction Labourers	elementary	labourer, construction worker, mining assistant, road worker, rail layer	mining, construction, civil works	construction materials, roads, rails, mines	construction site, mine, road, rail	crews	rail	worker	labour, assist, dig, build support	Reject for skilled trades/operators/engineers unless labourer/helper role is explicit.
15248	Manufacturing Labourers	elementary	factory hand, packer, finisher, caulker	manufacturing, packing, finishing	goods, clothing, wood products, packages	factory, production line	production teams		worker	pack, finish, assist manufacturing	Reject for machine operators/assemblers/trades unless manufacturing labourer/helper role is explicit.
15251	Transport And Storage Labourers	elementary	baggage handler, courier, material handler, mover, shelf filler, warehouse labourer, picker, packer	transport, storage, warehousing, material handling	baggage, materials, shelves, goods, parcels	airport, warehouse, distribution centre, road	shippers, passengers, customers	air, road_light, warehouse_transport	worker	handle, move, load, store	Reject for transport clerks/drivers/operators unless labour/material-handling role is explicit.
15257	Food Preparation Assistants	elementary	kitchen assistant, kitchen porter, pizzaiolo, fast food crew	food preparation, kitchen support, quick service	food, kitchen equipment, pizza	kitchen, restaurant, quick service restaurant	diners, customers		assistant_helper, worker	prepare_food, assist kitchen, clean kitchen	Reject for cooks/waiters/food processing unless assistant/crew/kitchen porter role is explicit.
15261	Street And Related Service Workers	elementary	leaflet distributor, street service worker	street services, promotion support	leaflets, public space services	street, public space	public		worker	distribute, provide street service	Reject for street vendors/sales/promoters unless non-sales street service is explicit.
15263	Street Vendors Excluding Food	elementary	hawker, street vendor	street vending, non-food sales	non-food goods	street, market	customer, public		worker	vend, sell	Reject for food vendors/shop sellers/market salespersons unless non-food street vendor is explicit.
15266	Refuse Workers	elementary	refuse collector, recycling worker, sorter labourer, street sweeper	waste, recycling, sanitation	refuse, recyclables, streets	street, waste facility, recycling facility	public	road_heavy	worker	collect waste, sort, sweep	Reject for cleaners/labourers unless refuse/recycling/sanitation role is explicit.
15270	Other Elementary Workers	elementary	attendant, installer, handyperson, porter, doorman, cloakroom attendant	elementary services, facility support, amusement, laundry, installation	facilities, attractions, rooms, laundry, advertising materials	hotel, amusement venue, recreation site, laundromat, building	guests, visitors, public		worker	assist, attend, install, handle	Reject when a more specific elementary/service/trade family matches; use as residual elementary family.`;
function parseList(value) {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
function parseRawRow(line, index) {
    const columns = line.split('\t');
    if (columns.length !== 12) {
        throw new Error(`Invalid family structure row at line ${index + 1}: expected 12 columns, got ${columns.length}.`);
    }
    const familyNodeId = Number.parseInt(columns[0] ?? '', 10);
    if (!Number.isInteger(familyNodeId) || familyNodeId <= 0) {
        throw new Error(`Invalid family structure row at line ${index + 1}: invalid family id.`);
    }
    return [
        familyNodeId,
        columns[1] ?? '',
        columns[2],
        columns[3] ?? '',
        columns[4] ?? '',
        columns[5] ?? '',
        columns[6] ?? '',
        columns[7] ?? '',
        columns[8] ?? '',
        columns[9] ?? '',
        columns[10] ?? '',
        columns[11] ?? ''
    ];
}
function buildFamilyStructureRules() {
    return RAW_FAMILY_STRUCTURE_TSV.split('\n').map((line, index) => {
        const [familyNodeId, familyLabel, occupationLevel, roleHeads, knowledgeDomains, workObjects, settings, populationOrChannel, transportMode, authorityBand, activities, hardRejectNotes] = parseRawRow(line, index);
        return {
            familyNodeId,
            familyLabel,
            occupationLevel,
            roleHeads: parseList(roleHeads),
            knowledgeDomains: parseList(knowledgeDomains),
            workObjects: parseList(workObjects),
            settings: parseList(settings),
            populationOrChannel: parseList(populationOrChannel),
            transportMode: parseList(transportMode),
            authorityBand: parseList(authorityBand),
            activities: parseList(activities),
            hardRejectNotes
        };
    });
}
export const FAMILY_STRUCTURE_RULES = buildFamilyStructureRules();
export const FAMILY_STRUCTURE_RULE_BY_ID = new Map(FAMILY_STRUCTURE_RULES.map((rule) => [rule.familyNodeId, rule]));
export function getFamilyStructureRule(familyNodeId) {
    return FAMILY_STRUCTURE_RULE_BY_ID.get(familyNodeId);
}
export function requireFamilyStructureRule(familyNodeId) {
    const rule = getFamilyStructureRule(familyNodeId);
    if (!rule) {
        throw new Error(`Missing family structure rule for family id ${familyNodeId}.`);
    }
    return rule;
}
export function buildFamilyStructureQueryProfile(tokens, locale = 'en') {
    const valuesByDimension = new Map();
    for (const [dimension, values] of familyStructureVocabularyValuesByDimension(tokens, locale)) {
        addDimensionValues(valuesByDimension, dimension, values);
    }
    addDimensionValues(valuesByDimension, 'role_heads', familyStructureVocabularyMatchesForTokens(tokens, locale)
        .filter((match) => match.dimension === 'role_heads')
        .flatMap((match) => [match.value, ...(match.matchedAlias.includes(' ') ? [] : roleComparableTokens(match.matchedAlias))]));
    const roleHeads = valuesByDimension.get('role_heads') ?? new Set();
    const authorityBands = valuesByDimension.get('authority_band') ?? new Set();
    if (roleHeads.has('manager') && authorityBands.has('supervisor')) {
        addDimensionValues(valuesByDimension, 'occupation_level', ['associate_technical']);
    }
    return {
        valuesByDimension: new Map(Array.from(valuesByDimension, ([dimension, values]) => [dimension, Array.from(values).sort()]))
    };
}
export function buildFamilyStructureProfile(rule) {
    const valuesByDimension = new Map();
    addDimensionValues(valuesByDimension, 'occupation_level', [rule.occupationLevel]);
    addDimensionValues(valuesByDimension, 'role_heads', rule.roleHeads.flatMap((value) => [value, ...roleComparableTokens(value)]));
    addDimensionValues(valuesByDimension, 'knowledge_domains', rule.knowledgeDomains);
    addDimensionValues(valuesByDimension, 'work_objects', rule.workObjects);
    addDimensionValues(valuesByDimension, 'settings', rule.settings);
    addDimensionValues(valuesByDimension, 'population_or_channel', rule.populationOrChannel);
    addDimensionValues(valuesByDimension, 'transport_mode', rule.transportMode);
    addDimensionValues(valuesByDimension, 'authority_band', rule.authorityBand);
    addDimensionValues(valuesByDimension, 'activities', rule.activities);
    const vocabularyProfile = familyStructureVocabularyValuesByDimension([
        rule.familyLabel,
        ...rule.roleHeads,
        ...rule.knowledgeDomains,
        ...rule.workObjects,
        ...rule.settings,
        ...rule.populationOrChannel,
        ...rule.transportMode,
        ...rule.authorityBand,
        ...rule.activities
    ].flatMap((value) => tokenizeNormalizedText(value)), 'en', { expandLocaleVariants: false });
    for (const [dimension, values] of vocabularyProfile) {
        if (dimension === 'occupation_level' || dimension === 'role_heads') {
            continue;
        }
        addDimensionValues(valuesByDimension, dimension, values);
    }
    return {
        valuesByDimension: new Map(Array.from(valuesByDimension, ([dimension, values]) => [dimension, Array.from(values).sort()]))
    };
}
export function compareFamilyStructureToQuery(family, queryTokens, locale = 'en') {
    const rule = typeof family === 'number' ? requireFamilyStructureRule(family) : family;
    const queryProfile = buildFamilyStructureQueryProfile(queryTokens, locale);
    const familyProfile = buildFamilyStructureProfile(rule);
    const comparedDimensions = compareFamilyStructureProfiles(queryProfile, familyProfile);
    const bridgedRoleHead = findRoleAuthorityBridge(comparedDimensions);
    const bridgedOccupationLevel = findOccupationLevelBridge(comparedDimensions);
    const bridgedTransportMode = findTransportModeBridge(comparedDimensions);
    const dimensions = applyDimensionBridges(comparedDimensions, {
        roleHeads: bridgedRoleHead,
        occupationLevel: bridgedOccupationLevel,
        transportMode: bridgedTransportMode
    });
    const alignedDimensions = dimensions.filter((dimension) => dimension.aligned).map((dimension) => dimension.dimension);
    const contradictedDimensions = dimensions.filter((dimension) => dimension.contradicted).map((dimension) => dimension.dimension);
    const unsupportedFamilySpecificityDimensions = dimensions
        .filter((dimension) => dimension.unsupportedFamilySpecificity)
        .map((dimension) => dimension.dimension);
    const reasons = [];
    const roleHeadComparison = dimensions.find((dimension) => dimension.dimension === 'role_heads');
    const roleHeadAligned = roleHeadComparison?.aligned ?? false;
    const roleHeadMissing = (roleHeadComparison?.queryValues.length ?? 0) > 0 && (roleHeadComparison?.familyValues.length ?? 0) > 0 && !roleHeadAligned;
    const hardRoleHeadMissing = roleHeadMissing && !bridgedRoleHead && hasHardRoleHeadMismatchEvidence(dimensions);
    if (hardRoleHeadMissing) {
        reasons.push(`role_heads mismatch: query=[${roleHeadComparison?.queryValues.join(', ') ?? ''}] family=[${roleHeadComparison?.familyValues.join(', ') ?? ''}]`);
    }
    for (const dimension of dimensions) {
        if (dimension.dimension === 'role_heads') {
            continue;
        }
        if (isHardContradiction(dimension)) {
            reasons.push(`${dimension.dimension} contradiction: query=[${dimension.queryValues.join(', ')}] family=[${dimension.familyValues.join(', ')}]`);
        }
    }
    return {
        familyNodeId: rule.familyNodeId,
        familyLabel: rule.familyLabel,
        queryProfile,
        familyProfile,
        dimensions,
        alignedDimensions,
        contradictedDimensions,
        unsupportedFamilySpecificityDimensions,
        roleHeadAligned,
        roleHeadMissing,
        hardRejected: hardRoleHeadMissing || reasons.length > 0,
        reasons
    };
}
export function shortlistFamilyStructureMatches(queryTokens, locale = 'en', options = {}) {
    const families = options.familyNodeIds
        ? options.familyNodeIds.map((familyNodeId) => requireFamilyStructureRule(familyNodeId))
        : FAMILY_STRUCTURE_RULES;
    const comparisons = families.map((family) => compareFamilyStructureToQuery(family, queryTokens, locale));
    const rejected = comparisons.filter((comparison) => comparison.hardRejected);
    const candidates = comparisons
        .filter((comparison) => !comparison.hardRejected)
        .map((comparison) => ({
        comparison,
        structuralScore: familyStructureSupportScore(comparison),
        supportDimensions: comparison.dimensions.filter((dimension) => dimension.aligned).map((dimension) => dimension.dimension),
        softContradictionDimensions: comparison.dimensions
            .filter((dimension) => dimension.contradicted && !isHardContradiction(dimension))
            .map((dimension) => dimension.dimension)
    }))
        .filter((candidate) => candidate.structuralScore > 0)
        .sort(compareShortlistCandidates);
    return {
        queryProfile: comparisons[0]?.queryProfile ?? buildFamilyStructureQueryProfile(queryTokens, locale),
        candidates: candidates.slice(0, options.limit ?? candidates.length),
        rejected
    };
}
function compareFamilyStructureProfiles(queryProfile, familyProfile) {
    return FAMILY_STRUCTURE_COMPARISON_DIMENSIONS.map((dimension) => {
        const queryValues = queryProfile.valuesByDimension.get(dimension) ?? [];
        const familyValues = familyProfile.valuesByDimension.get(dimension) ?? [];
        const sharedValues = queryValues.filter((value) => familyValues.includes(value));
        const roleHeadOnlySharesBroadValue = dimension === 'role_heads' &&
            sharedValues.length > 0 &&
            sharedValues.every((value) => BROAD_QUERY_ROLE_HEAD_VALUES.has(value) && !BROAD_SHARED_ROLE_HEAD_ALIGNMENT_VALUES.has(value));
        return {
            dimension,
            queryValues,
            familyValues,
            sharedValues,
            aligned: sharedValues.length > 0 && !roleHeadOnlySharesBroadValue,
            contradicted: queryValues.length > 0 && familyValues.length > 0 && (sharedValues.length === 0 || roleHeadOnlySharesBroadValue),
            unsupportedFamilySpecificity: queryValues.length === 0 && familyValues.length > 0
        };
    });
}
function findRoleAuthorityBridge(dimensions) {
    const roleHeads = dimensions.find((dimension) => dimension.dimension === 'role_heads');
    if (!roleHeads?.contradicted) {
        return null;
    }
    let bridge = null;
    if (roleHeads.sharedValues.some((value) => BROAD_CONTEXT_BRIDGE_ROLE_HEAD_VALUES.has(value))) {
        bridge = 'broad_role_context_bridge';
    }
    else if (dimensionHasQueryValue(roleHeads, 'supervisor')) {
        const familyCanBeOperationalManagement = roleHeads.familyValues.includes('manager') ||
            roleHeads.familyValues.includes('service manager') ||
            roleHeads.familyValues.some((value) => value.endsWith(' manager'));
        const familyCanBeHealthSupport = roleHeads.familyValues.includes('health associate') ||
            roleHeads.familyValues.includes('health') ||
            roleHeads.familyValues.includes('technician') ||
            roleHeads.familyValues.includes('assistant');
        const familyCanBeFoodService = roleHeads.familyValues.includes('cook') ||
            roleHeads.familyValues.includes('chef') ||
            dimensions.some((dimension) => dimension.dimension === 'work_objects' && dimension.sharedValues.some((value) => value === 'food_beverage' || value === 'food'));
        if (!familyCanBeOperationalManagement && !familyCanBeHealthSupport && !familyCanBeFoodService) {
            return null;
        }
        bridge = familyCanBeFoodService ? 'supervisor_food_service_bridge' : 'supervisor_context_bridge';
    }
    else if (dimensionHasQueryValue(roleHeads, 'assistant')) {
        if (dimensionHasQueryValue(roleHeads, 'nurse') && !roleHeads.familyValues.includes('nurse')) {
            return null;
        }
        const familyCanBeAssistantSupport = roleHeads.familyValues.includes('assistant') ||
            roleHeads.familyValues.includes('healthcare assistant') ||
            roleHeads.familyValues.includes('nurse assistant') ||
            roleHeads.familyValues.includes('aide') ||
            roleHeads.familyValues.includes('porter') ||
            roleHeads.familyValues.includes('secretary') ||
            roleHeads.familyValues.includes('clerk') ||
            roleHeads.familyValues.includes('shop assistant') ||
            roleHeads.familyValues.includes('salesperson') ||
            roleHeads.familyValues.includes('seller');
        if (!familyCanBeAssistantSupport) {
            return null;
        }
        bridge = 'assistant_support_bridge';
    }
    else if (dimensionHasQueryValue(roleHeads, 'operator')) {
        const familyCanBeAssembly = roleHeads.familyValues.includes('assembler') || roleHeads.familyValues.some((value) => value.endsWith(' assembler'));
        const queryNamesAssembly = roleHeads.queryValues.includes('assembler') || roleHeads.sharedValues.includes('assembler');
        const assemblyActivityAligned = dimensions.some((dimension) => dimension.dimension === 'activities' &&
            dimension.sharedValues.some((value) => value === 'assemble_make_process' || value === 'assembly'));
        const familyCanBeBillingClerk = (roleHeads.familyValues.includes('clerk') || roleHeads.familyValues.includes('billing clerk')) &&
            dimensions.some((dimension) => dimension.dimension === 'work_objects' &&
                dimension.sharedValues.some((value) => value === 'money_accounts' || value === 'accounts'));
        const familyCanBeCncToolmaking = (roleHeads.familyValues.includes('cnc') ||
            roleHeads.familyValues.includes('cnc operator') ||
            roleHeads.familyValues.includes('machine tool operator') ||
            roleHeads.familyValues.includes('toolmaker') ||
            roleHeads.familyValues.includes('mould maker')) &&
            dimensions.some((dimension) => dimension.aligned &&
                dimension.dimension === 'work_objects' &&
                dimension.sharedValues.includes('metal'));
        const familyCanBeLogisticsClerk = (roleHeads.familyValues.includes('warehouse operator') ||
            roleHeads.familyValues.includes('logistics clerk') ||
            roleHeads.familyValues.includes('transport clerk') ||
            roleHeads.familyValues.includes('dispatcher') ||
            roleHeads.familyValues.includes('cargo coordinator')) &&
            dimensions.some((dimension) => dimension.aligned &&
                ((dimension.dimension === 'knowledge_domains' && dimension.sharedValues.includes('transport_logistics')) ||
                    (dimension.dimension === 'settings' && dimension.sharedValues.some((value) => value === 'warehouse' || value === 'warehouse_logistics')) ||
                    (dimension.dimension === 'transport_mode' && dimension.sharedValues.includes('warehouse_transport'))));
        if (familyCanBeAssembly && queryNamesAssembly && assemblyActivityAligned) {
            bridge = 'operator_assembly_bridge';
        }
        else if (familyCanBeBillingClerk) {
            bridge = 'operator_billing_clerk_bridge';
        }
        else if (familyCanBeCncToolmaking) {
            bridge = 'operator_cnc_toolmaking_bridge';
        }
        else if (familyCanBeLogisticsClerk) {
            bridge = 'operator_logistics_clerk_bridge';
        }
        else {
            return null;
        }
    }
    else if (dimensionHasQueryValue(roleHeads, 'engineer')) {
        const familyCanBeProfessionalSales = (roleHeads.familyValues.includes('sales professional') ||
            roleHeads.familyValues.includes('business developer') ||
            roleHeads.familyValues.includes('marketing professional')) &&
            dimensions.some((dimension) => dimension.aligned &&
                ((dimension.dimension === 'knowledge_domains' &&
                    dimension.sharedValues.some((value) => value === 'sales_marketing' || value === 'sales')) ||
                    (dimension.dimension === 'activities' && dimension.sharedValues.some((value) => value === 'sell_trade' || value === 'sell'))));
        if (!familyCanBeProfessionalSales) {
            return null;
        }
        bridge = 'sales_engineer_professional_bridge';
    }
    else if (dimensionHasQueryValue(roleHeads, 'finance_professional') || dimensionHasQueryValue(roleHeads, 'advisor')) {
        const familyCanBeSalesAdvisor = (roleHeads.familyValues.includes('seller') ||
            roleHeads.familyValues.includes('salesperson') ||
            roleHeads.familyValues.includes('shop assistant') ||
            roleHeads.familyValues.includes('sales agent') ||
            roleHeads.familyValues.includes('representative')) &&
            dimensions.some((dimension) => dimension.aligned &&
                ((dimension.dimension === 'knowledge_domains' &&
                    dimension.sharedValues.some((value) => value === 'sales_marketing' || value === 'sales')) ||
                    (dimension.dimension === 'activities' && dimension.sharedValues.some((value) => value === 'sell_trade' || value === 'sell'))));
        if (!familyCanBeSalesAdvisor) {
            return null;
        }
        bridge = 'advisor_sales_role_bridge';
    }
    else if (dimensionHasQueryValue(roleHeads, 'seller')) {
        const familyCanBeSalesAgent = (roleHeads.familyValues.includes('agent') ||
            roleHeads.familyValues.includes('representative') ||
            roleHeads.familyValues.includes('sales agent') ||
            roleHeads.familyValues.includes('broker')) &&
            dimensions.some((dimension) => dimension.aligned &&
                ((dimension.dimension === 'knowledge_domains' &&
                    dimension.sharedValues.some((value) => value === 'sales_marketing' || value === 'sales')) ||
                    (dimension.dimension === 'activities' && dimension.sharedValues.some((value) => value === 'sell_trade' || value === 'sell'))));
        const familyCanBeSalesProfessional = (roleHeads.familyValues.includes('sales professional') ||
            roleHeads.familyValues.includes('business developer') ||
            roleHeads.familyValues.includes('marketing professional') ||
            roleHeads.familyValues.includes('advertising specialist')) &&
            dimensions.some((dimension) => dimension.aligned &&
                ((dimension.dimension === 'knowledge_domains' &&
                    dimension.sharedValues.some((value) => value === 'sales_marketing' || value === 'sales')) ||
                    (dimension.dimension === 'activities' && dimension.sharedValues.some((value) => value === 'sell_trade' || value === 'sell'))));
        if (!familyCanBeSalesAgent && !familyCanBeSalesProfessional) {
            return null;
        }
        bridge = familyCanBeSalesProfessional ? 'seller_sales_professional_bridge' : 'seller_sales_agent_bridge';
    }
    else if (dimensionHasQueryValue(roleHeads, 'manager')) {
        const familyCanBeClientInformation = (roleHeads.familyValues.includes('customer') ||
            roleHeads.familyValues.includes('customer service representative') ||
            roleHeads.familyValues.includes('information clerk') ||
            roleHeads.familyValues.includes('representative') ||
            roleHeads.familyValues.includes('agent')) &&
            dimensions.some((dimension) => dimension.dimension === 'population_or_channel' &&
                dimension.sharedValues.some((value) => value === 'customer_client' || value === 'client'));
        if (!familyCanBeClientInformation) {
            return null;
        }
        bridge = 'manager_client_information_bridge';
    }
    else {
        return null;
    }
    const hasConcreteContextAlignment = dimensions.some((dimension) => dimension.aligned &&
        (dimension.dimension === 'knowledge_domains' ||
            dimension.dimension === 'settings' ||
            dimension.dimension === 'work_objects' ||
            dimension.dimension === 'population_or_channel' ||
            dimension.dimension === 'activities'));
    if (!hasConcreteContextAlignment) {
        return null;
    }
    return bridge;
}
// Level compatibility is deliberately data-shaped instead of a chain of one-off fixes. The family
// table owns each family's level; this matrix says when a query-side level word may still be
// compatible with a different family level because role/domain/channel evidence proves the broader
// occupational intent. Exact level matches never reach this table because they are already aligned.
const OCCUPATION_LEVEL_COMPATIBILITY_RULES = [
    {
        bridge: 'client_information_associate_to_clerical',
        queryLevels: ['associate_technical'],
        familyLevels: ['clerical'],
        requiresRoleAlignment: true,
        sharedPopulationValues: ['client', 'customer_client', 'telephone_call_centre', 'ticket_reception_counter']
    },
    {
        bridge: 'client_information_manager_to_clerical',
        queryLevels: ['executive_manager'],
        familyLevels: ['clerical'],
        queryRoleValues: ['manager'],
        sharedPopulationValues: ['client', 'customer_client']
    },
    {
        bridge: 'assistant_to_clerical',
        queryLevels: ['associate_technical'],
        familyLevels: ['clerical'],
        queryRoleValues: ['assistant'],
        familyRoleValues: ['assistant', 'secretary', 'clerk']
    },
    {
        bridge: 'contact_agent_to_service_sales',
        queryLevels: ['associate_technical'],
        familyLevels: ['service_sales'],
        queryRoleValues: ['agent_broker'],
        sharedPopulationValues: ['customer', 'customer_client', 'telephone_call_centre'],
        familyActivityValues: ['sell', 'sell_trade', 'serve_customer', 'promote', 'demonstrate']
    },
    {
        bridge: 'protective_agent_to_service_sales',
        queryLevels: ['associate_technical'],
        familyLevels: ['service_sales'],
        queryRoleValues: ['agent_broker', 'guard'],
        sharedKnowledgeValues: ['protective_services'],
        sharedActivityValues: ['protect_enforce']
    },
    {
        bridge: 'sales_associate_to_service_sales',
        queryLevels: ['associate_technical'],
        familyLevels: ['service_sales'],
        queryRoleValues: ['assistant', 'seller', 'agent_broker'],
        sharedKnowledgeValues: ['sales', 'sales_marketing'],
        sharedActivityValues: ['sell', 'sell_trade', 'serve_customer']
    },
    {
        bridge: 'health_support_level',
        queryLevels: ['associate_technical', 'service_sales'],
        familyLevels: ['associate_technical', 'service_sales'],
        queryRoleValues: ['assistant', 'supervisor'],
        familyRoleValues: ['assistant', 'healthcare assistant', 'health associate', 'technician'],
        familyAuthorityValues: ['assistant_helper'],
        requiresKnowledgeAlignment: true,
        sharedKnowledgeValues: ['health']
    },
    {
        bridge: 'health_professional_level',
        queryLevels: ['associate_technical'],
        familyLevels: ['professional'],
        sharedRoleValues: ['nurse', 'doctor', 'physician'],
        sharedKnowledgeValues: ['health', 'medical']
    },
    {
        bridge: 'technician_to_trade',
        queryLevels: ['associate_technical'],
        familyLevels: ['skilled_trades'],
        queryRoleValues: ['technician'],
        requiresRoleAlignment: true,
        familyActivityValues: ['repair', 'maintain', 'install', 'repair_maintain_install']
    },
    {
        bridge: 'inspector_to_craft',
        queryLevels: ['associate_technical'],
        familyLevels: ['skilled_trades'],
        queryRoleValues: ['inspector'],
        familyRoleValues: ['inspector']
    },
    {
        bridge: 'production_technician_to_associate',
        queryLevels: ['plant_machine_operator'],
        familyLevels: ['associate_technical'],
        queryRoleValues: ['technician'],
        requiresRoleAlignment: true
    },
    {
        bridge: 'assistant_to_elementary_food_prep',
        queryLevels: ['associate_technical', 'service_sales'],
        familyLevels: ['elementary'],
        queryRoleValues: ['assistant', 'cook'],
        familyAuthorityValues: ['assistant_helper'],
        sharedWorkObjectValues: ['food', 'food_beverage'],
        sharedSettingValues: ['kitchen', 'restaurant', 'quick service restaurant', 'hotel_restaurant'],
        sharedActivityValues: ['prepare_food', 'clean_prepare_handle']
    },
    {
        bridge: 'worker_to_service_sales_context',
        queryLevels: ['elementary'],
        familyLevels: ['service_sales'],
        familyAuthorityValues: ['worker'],
        sharedRoleValues: ['seller', 'cashier', 'service_worker', 'care_worker', 'cook', 'cleaner'],
        sharedKnowledgeValues: ['sales', 'sales_marketing', 'food service', 'hospitality', 'health care'],
        sharedSettingValues: ['shop', 'store', 'retail outlet', 'hotel_restaurant', 'hospital_clinic_pharmacy'],
        sharedPopulationValues: ['customer', 'customer_client', 'patient']
    },
    {
        bridge: 'worker_to_skilled_trade_context',
        queryLevels: ['elementary'],
        familyLevels: ['skilled_trades'],
        familyAuthorityValues: ['worker'],
        sharedRoleValues: ['mechanic_repairer', 'installer', 'assembler', 'cleaner', 'labourer'],
        sharedKnowledgeValues: ['construction', 'manufacturing', 'forestry', 'agriculture'],
        sharedWorkObjectValues: ['machinery_equipment', 'electrical_equipment', 'metal', 'wood_paper', 'food_beverage'],
        sharedActivityValues: ['repair_maintain_install', 'assemble_make_process']
    },
    {
        bridge: 'operator_to_skilled_assembly_trade',
        queryLevels: ['plant_machine_operator'],
        familyLevels: ['skilled_trades'],
        queryRoleValues: ['operator'],
        familyRoleValues: ['assembler', 'installer', 'mechanic_repairer'],
        sharedWorkObjectValues: ['machinery_equipment', 'electrical_equipment', 'electronics_telecom', 'metal'],
        sharedActivityValues: ['assemble_make_process', 'repair_maintain_install']
    },
    {
        bridge: 'driver_to_transport_labour_context',
        queryLevels: ['driver_transport'],
        familyLevels: ['elementary'],
        familyAuthorityValues: ['worker'],
        sharedTransportValues: ['warehouse_transport', 'road_light'],
        sharedWorkObjectValues: ['goods_products', 'materials'],
        sharedActivityValues: ['clean_prepare_handle']
    }
];
function findOccupationLevelBridge(dimensions) {
    const occupationLevel = dimensions.find((dimension) => dimension.dimension === 'occupation_level');
    if (!occupationLevel?.contradicted) {
        return null;
    }
    for (const rule of OCCUPATION_LEVEL_COMPATIBILITY_RULES) {
        if (!dimensionContainsAny(occupationLevel.queryValues, rule.queryLevels)) {
            continue;
        }
        if (!dimensionContainsAny(occupationLevel.familyValues, rule.familyLevels)) {
            continue;
        }
        if ((rule.queryRoleValues || rule.queryAuthorityValues) &&
            !(dimensionContainsAny(dimensionValues(dimensions, 'role_heads', 'query'), rule.queryRoleValues ?? []) ||
                dimensionContainsAny(dimensionValues(dimensions, 'authority_band', 'query'), rule.queryAuthorityValues ?? rule.queryRoleValues ?? []))) {
            continue;
        }
        if ((rule.familyRoleValues || rule.familyAuthorityValues) &&
            !(dimensionContainsAny(dimensionValues(dimensions, 'role_heads', 'family'), rule.familyRoleValues ?? []) ||
                dimensionContainsAny(dimensionValues(dimensions, 'authority_band', 'family'), rule.familyAuthorityValues ?? rule.familyRoleValues ?? []))) {
            continue;
        }
        if (rule.sharedRoleValues && !dimensionContainsAny(dimensionValues(dimensions, 'role_heads', 'shared'), rule.sharedRoleValues)) {
            continue;
        }
        if (rule.sharedPopulationValues &&
            !dimensionContainsAny(dimensionValues(dimensions, 'population_or_channel', 'shared'), rule.sharedPopulationValues)) {
            continue;
        }
        if (rule.sharedTransportValues &&
            !dimensionContainsAny(dimensionValues(dimensions, 'transport_mode', 'shared'), rule.sharedTransportValues)) {
            continue;
        }
        if ((rule.sharedKnowledgeValues || rule.sharedWorkObjectValues || rule.sharedSettingValues || rule.sharedActivityValues) &&
            !(dimensionContainsAny(dimensionValues(dimensions, 'knowledge_domains', 'shared'), rule.sharedKnowledgeValues ?? []) ||
                dimensionContainsAny(dimensionValues(dimensions, 'work_objects', 'shared'), rule.sharedWorkObjectValues ?? []) ||
                dimensionContainsAny(dimensionValues(dimensions, 'settings', 'shared'), rule.sharedSettingValues ?? []) ||
                dimensionContainsAny(dimensionValues(dimensions, 'activities', 'shared'), rule.sharedActivityValues ?? []))) {
            continue;
        }
        if (rule.familyActivityValues &&
            !dimensionContainsAny(dimensionValues(dimensions, 'activities', 'family'), rule.familyActivityValues)) {
            continue;
        }
        if (rule.requiresRoleAlignment && !dimensionAligned(dimensions, 'role_heads')) {
            continue;
        }
        if (rule.requiresKnowledgeAlignment && !dimensionAligned(dimensions, 'knowledge_domains')) {
            continue;
        }
        return rule.bridge;
    }
    return null;
}
function dimensionValues(dimensions, dimensionName, side) {
    const dimension = dimensions.find((candidate) => candidate.dimension === dimensionName);
    if (!dimension) {
        return [];
    }
    if (side === 'query') {
        return dimension.queryValues;
    }
    if (side === 'family') {
        return dimension.familyValues;
    }
    return dimension.sharedValues;
}
function dimensionAligned(dimensions, dimensionName) {
    return dimensions.find((dimension) => dimension.dimension === dimensionName)?.aligned ?? false;
}
function dimensionContainsAny(values, expected) {
    return expected.length > 0 && expected.some((value) => values.includes(value));
}
function findTransportModeBridge(dimensions) {
    const transportMode = dimensions.find((dimension) => dimension.dimension === 'transport_mode');
    if (!transportMode?.contradicted) {
        return null;
    }
    const queryMobilePlant = transportMode.queryValues.includes('mobile_plant');
    const familyWarehouseTransport = transportMode.familyValues.includes('warehouse_transport');
    const queryPassengerTravel = transportMode.queryValues.includes('passenger_travel');
    const familyTelephoneChannel = transportMode.familyValues.includes('telephone');
    const materialHandlingAligned = dimensions.some((dimension) => (dimension.dimension === 'work_objects' || dimension.dimension === 'activities' || dimension.dimension === 'role_heads') &&
        dimension.aligned &&
        dimension.sharedValues.some((value) => value === 'goods_products' || value === 'materials' || value === 'clean_prepare_handle' || value === 'labourer'));
    if (queryMobilePlant && familyWarehouseTransport && materialHandlingAligned) {
        return 'mobile_plant_material_handling_bridge';
    }
    const callCentreTravelAligned = dimensions.some((dimension) => dimension.dimension === 'population_or_channel' &&
        dimension.sharedValues.some((value) => value === 'telephone_call_centre' || value === 'customer_client'));
    if (queryPassengerTravel && familyTelephoneChannel && callCentreTravelAligned) {
        return 'passenger_travel_contact_channel_bridge';
    }
    return null;
}
function applyDimensionBridges(dimensions, bridges) {
    return dimensions.map((dimension) => {
        const bridgeValue = dimension.dimension === 'role_heads'
            ? bridges.roleHeads
            : dimension.dimension === 'occupation_level'
                ? bridges.occupationLevel
                : dimension.dimension === 'transport_mode'
                    ? bridges.transportMode
                    : null;
        if (!bridgeValue) {
            return dimension;
        }
        return {
            ...dimension,
            sharedValues: [...dimension.sharedValues, bridgeValue],
            aligned: true,
            contradicted: false
        };
    });
}
function addDimensionValues(valuesByDimension, dimension, values) {
    let existing = valuesByDimension.get(dimension);
    if (!existing) {
        existing = new Set();
        valuesByDimension.set(dimension, existing);
    }
    for (const value of values) {
        const normalizedValue = value.trim().toLocaleLowerCase('en-US');
        if (normalizedValue.length > 0) {
            existing.add(normalizedValue);
        }
    }
}
const FAMILY_STRUCTURE_COMPARISON_DIMENSIONS = [
    'occupation_level',
    'role_heads',
    'knowledge_domains',
    'work_objects',
    'settings',
    'population_or_channel',
    'transport_mode',
    'authority_band',
    'activities'
];
const HARD_REJECTION_DIMENSIONS = new Set(['occupation_level', 'transport_mode']);
const FAMILY_STRUCTURE_DIMENSION_SUPPORT_WEIGHT = {
    occupation_level: 5,
    role_heads: 8,
    knowledge_domains: 3,
    work_objects: 3,
    settings: 2,
    population_or_channel: 2,
    transport_mode: 5,
    authority_band: 4,
    activities: 2
};
function isHardContradiction(dimension) {
    if (!dimension.contradicted) {
        return false;
    }
    if (HARD_REJECTION_DIMENSIONS.has(dimension.dimension)) {
        return true;
    }
    if (dimension.dimension !== 'authority_band') {
        return false;
    }
    const queryValues = new Set(dimension.queryValues);
    const familyValues = new Set(dimension.familyValues);
    const queryJuniorOrAssistant = queryValues.has('junior') || queryValues.has('assistant') || queryValues.has('assistant_helper');
    const queryManagerAuthority = queryValues.has('manager') || queryValues.has('director') || queryValues.has('chief');
    const familyManagerAuthority = familyValues.has('manager') || familyValues.has('director') || familyValues.has('chief');
    const familyAssistant = familyValues.has('assistant') || familyValues.has('assistant_helper');
    return (queryJuniorOrAssistant && familyManagerAuthority) || (queryManagerAuthority && familyAssistant);
}
function dimensionHasQueryValue(dimension, value) {
    return dimension.queryValues.includes(value);
}
const BROAD_QUERY_ROLE_HEAD_VALUES = new Set([
    'assistant',
    'asistent',
    'asistenta',
    'asistentă',
    'manager',
    'operator',
    'supervisor',
    'responsabil',
    'sef',
    'șef',
    'labourer',
    'muncitor',
    'worker',
    'lucrator',
    'lucrător',
    'service_worker',
    'agent_broker'
]);
const BROAD_SHARED_ROLE_HEAD_ALIGNMENT_VALUES = new Set(['manager', 'supervisor']);
const BROAD_CONTEXT_BRIDGE_ROLE_HEAD_VALUES = new Set(['labourer', 'worker', 'service_worker']);
function hasHardRoleHeadMismatchEvidence(dimensions) {
    const roleHeads = dimensions.find((dimension) => dimension.dimension === 'role_heads');
    if (!roleHeads?.contradicted) {
        return false;
    }
    const hasSpecificQueryRole = roleHeads.queryValues.some((value) => !BROAD_QUERY_ROLE_HEAD_VALUES.has(value));
    if (hasSpecificQueryRole) {
        return true;
    }
    return dimensions.some((dimension) => dimension.dimension !== 'role_heads' &&
        dimension.dimension !== 'occupation_level' &&
        dimension.dimension !== 'authority_band' &&
        dimension.dimension !== 'activities' &&
        dimension.queryValues.length > 0 &&
        dimension.contradicted &&
        !dimension.aligned);
}
export function familyStructureSupportScore(comparison) {
    let score = 0;
    for (const dimension of comparison.dimensions) {
        if (dimension.queryValues.length === 0 || dimension.familyValues.length === 0) {
            continue;
        }
        if (dimension.aligned) {
            score += FAMILY_STRUCTURE_DIMENSION_SUPPORT_WEIGHT[dimension.dimension];
            score += Math.min(dimension.sharedValues.length - 1, 3) * 0.5;
            continue;
        }
        if (dimension.contradicted) {
            score -= isHardContradiction(dimension) ? 100 : FAMILY_STRUCTURE_DIMENSION_SUPPORT_WEIGHT[dimension.dimension] * 0.6;
        }
    }
    return Number(score.toFixed(3));
}
function compareShortlistCandidates(left, right) {
    if (right.structuralScore !== left.structuralScore) {
        return right.structuralScore - left.structuralScore;
    }
    if (right.supportDimensions.length !== left.supportDimensions.length) {
        return right.supportDimensions.length - left.supportDimensions.length;
    }
    return left.comparison.familyNodeId - right.comparison.familyNodeId;
}
function roleComparableTokens(value) {
    const tokens = tokenizeNormalizedText(value);
    const comparable = new Set();
    for (const token of tokens) {
        const normalizedToken = token.trim().toLocaleLowerCase('en-US');
        if (normalizedToken.length === 0) {
            continue;
        }
        comparable.add(normalizedToken);
        if (normalizedToken.endsWith('s') && normalizedToken.length > 3) {
            comparable.add(normalizedToken.slice(0, -1));
        }
    }
    return Array.from(comparable);
}
export function validateFamilyStructureRules() {
    const expectedById = new Map(occupationFamilies.map((family) => [family.id, family.label]));
    const seen = new Set();
    for (const rule of FAMILY_STRUCTURE_RULES) {
        const expectedLabel = expectedById.get(rule.familyNodeId);
        if (!expectedLabel) {
            throw new Error(`Family structure rule references unknown family id ${rule.familyNodeId}.`);
        }
        if (expectedLabel !== rule.familyLabel) {
            throw new Error(`Family structure rule label mismatch for family id ${rule.familyNodeId}: expected "${expectedLabel}", got "${rule.familyLabel}".`);
        }
        if (seen.has(rule.familyNodeId)) {
            throw new Error(`Duplicate family structure rule for family id ${rule.familyNodeId}.`);
        }
        seen.add(rule.familyNodeId);
    }
    for (const family of occupationFamilies) {
        if (!seen.has(family.id)) {
            throw new Error(`Missing family structure rule for family id ${family.id} (${family.label}).`);
        }
    }
}
validateFamilyStructureRules();
