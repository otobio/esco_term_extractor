import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FAMILY_STRUCTURE_QUERY_VOCABULARY,
  familyStructureVocabularyMatchesForToken,
  familyStructureVocabularyValuesByDimension
} from '../../src/runtime/occupation-family-structure-vocabulary.js';

test('family structure query vocabulary exposes an explicit checklist', () => {
  assert.ok(FAMILY_STRUCTURE_QUERY_VOCABULARY.length > 250);
  assert.ok(FAMILY_STRUCTURE_QUERY_VOCABULARY.some((entry) => entry.dimension === 'transport_mode' && entry.value === 'road_heavy'));
  assert.ok(FAMILY_STRUCTURE_QUERY_VOCABULARY.some((entry) => entry.dimension === 'authority_band' && entry.value === 'manager'));
  assert.ok(FAMILY_STRUCTURE_QUERY_VOCABULARY.some((entry) => entry.dimension === 'knowledge_domains' && entry.value === 'ict'));
  assert.ok(FAMILY_STRUCTURE_QUERY_VOCABULARY.some((entry) => entry.dimension === 'settings' && entry.value === 'hotel'));
  assert.ok(FAMILY_STRUCTURE_QUERY_VOCABULARY.some((entry) => entry.dimension === 'work_objects' && entry.value === 'food'));
});

test('family structure vocabulary classifies representative query tokens by dimension', () => {
  const values = familyStructureVocabularyValuesByDimension(['truck', 'driver', 'network', 'security', 'receptionist', 'hospital']);

  assert.ok(values.get('transport_mode')?.includes('road_heavy'));
  assert.ok(values.get('role_heads')?.includes('driver'));
  assert.ok(values.get('knowledge_domains')?.includes('ict'));
  assert.ok(values.get('work_objects')?.includes('network_security_systems'));
  assert.ok(values.get('role_heads')?.includes('clerk'));
  assert.ok(values.get('settings')?.includes('hospital_clinic_pharmacy'));
  assert.ok(values.get('population_or_channel')?.includes('ticket_reception_counter'));
});

test('family structure vocabulary keeps folded lookup deterministic', () => {
  const ctoMatches = familyStructureVocabularyMatchesForToken('CTO');

  assert.ok(ctoMatches.some((match) => match.dimension === 'occupation_level' && match.value === 'executive_manager'));
  assert.ok(ctoMatches.some((match) => match.dimension === 'authority_band' && match.value === 'chief'));
});

test('family structure vocabulary reuses multilingual structural synonyms', () => {
  const romanian = familyStructureVocabularyValuesByDimension([
    'spital',
    'magazin',
    'aeroport',
    'alimente',
    'clienti',
    'telefonic',
    'junior'
  ]);

  assert.ok(romanian.get('settings')?.includes('hospital'));
  assert.ok(romanian.get('settings')?.includes('shop'));
  assert.ok(romanian.get('settings')?.includes('airport'));
  assert.ok(romanian.get('work_objects')?.includes('food'));
  assert.ok(romanian.get('population_or_channel')?.includes('client'));
  assert.ok(romanian.get('population_or_channel')?.includes('telephone'));
  assert.ok(romanian.get('authority_band')?.includes('junior'));

  const hungarian = familyStructureVocabularyValuesByDimension(['etterem', 'gyar', 'iskola', 'jarmuvek', 'ugyfel', 'telefonos', 'vezeto']);

  assert.ok(hungarian.get('settings')?.includes('restaurant'));
  assert.ok(hungarian.get('settings')?.includes('factory'));
  assert.ok(hungarian.get('settings')?.includes('school'));
  assert.ok(hungarian.get('work_objects')?.includes('vehicle'));
  assert.ok(hungarian.get('population_or_channel')?.includes('client'));
  assert.ok(hungarian.get('population_or_channel')?.includes('telephone'));
  assert.ok(hungarian.get('authority_band')?.includes('manager'));
});

test('family structure vocabulary resolves locale word variants before dimension lookup', () => {
  const romanianClient = familyStructureVocabularyMatchesForToken('clientii', 'ro');
  assert.ok(romanianClient.some((match) => match.dimension === 'population_or_channel' && match.value === 'client'));

  const romanianDriver = familyStructureVocabularyMatchesForToken('soferi', 'ro');
  assert.ok(romanianDriver.some((match) => match.dimension === 'role_heads' && match.value === 'driver'));

  const hungarianClient = familyStructureVocabularyMatchesForToken('ugyfelek', 'hu');
  assert.ok(hungarianClient.some((match) => match.dimension === 'population_or_channel' && match.value === 'client'));

  const estonianVehicle = familyStructureVocabularyMatchesForToken('autod', 'et');
  assert.ok(estonianVehicle.some((match) => match.dimension === 'work_objects' && match.value === 'vehicle'));
});

test('family structure vocabulary covers Romanian real-title role and object terms', () => {
  const values = familyStructureVocabularyValuesByDimension(
    [
      'casier',
      'farmacist',
      'veterinar',
      'jurist',
      'tehnician',
      'manipulant',
      'marfuri',
      'vanzator',
      'asistent',
      'contabil',
      'facturare',
      'sef',
      'responsabil',
      'stivuitorist',
      'ambalator',
      'logistica',
      'patiserie',
      'procurement',
      'asistenta'
    ],
    'ro'
  );

  assert.ok(values.get('role_heads')?.includes('cashier'));
  assert.ok(values.get('role_heads')?.includes('pharmacist'));
  assert.ok(values.get('role_heads')?.includes('veterinarian'));
  assert.ok(values.get('role_heads')?.includes('legal_professional'));
  assert.ok(values.get('role_heads')?.includes('technician'));
  assert.ok(values.get('role_heads')?.includes('labourer'));
  assert.ok(values.get('role_heads')?.includes('seller'));
  assert.ok(values.get('role_heads')?.includes('assistant'));
  assert.ok(values.get('work_objects')?.includes('goods_products'));
  assert.ok(values.get('role_heads')?.includes('accountant'));
  assert.ok(values.get('role_heads')?.includes('clerk'));
  assert.ok(values.get('role_heads')?.includes('supervisor'));
  assert.ok(values.get('transport_mode')?.includes('mobile_plant'));
  assert.ok(values.get('role_heads')?.includes('labourer'));
  assert.ok(values.get('knowledge_domains')?.includes('transport_logistics'));
  assert.ok(values.get('work_objects')?.includes('food_beverage'));
  assert.ok(values.get('role_heads')?.includes('purchasing'));
  assert.ok(values.get('occupation_level')?.includes('associate_technical'));

  const processValues = familyStructureVocabularyValuesByDimension(['process'], 'en');
  assert.equal(processValues.get('occupation_level')?.includes('plant_machine_operator'), undefined);

  const productionValues = familyStructureVocabularyValuesByDimension(['productie'], 'ro');
  assert.ok(productionValues.get('knowledge_domains')?.includes('manufacturing'));
  assert.equal(productionValues.get('occupation_level')?.includes('plant_machine_operator') ?? false, false);
  assert.equal(productionValues.get('activities')?.includes('assemble_make_process') ?? false, false);
});

test('family structure vocabulary merges reviewed locale-scoped seed rows', () => {
  const romanian = familyStructureVocabularyValuesByDimension(
    ['gestionar', 'inginer', 'constructii', 'utilaje', 'coordonator', 'reparatii', 'manipulant'],
    'ro'
  );

  assert.ok(romanian.get('role_heads')?.includes('clerk'));
  assert.ok(romanian.get('role_heads')?.includes('handler'));
  assert.ok(romanian.get('role_heads')?.includes('engineer'));
  assert.ok(romanian.get('knowledge_domains')?.includes('construction'));
  assert.ok(romanian.get('work_objects')?.includes('machinery_equipment'));
  assert.ok(romanian.get('authority_band')?.includes('supervisor'));
  assert.ok(romanian.get('activities')?.includes('repair_maintain_install'));

  const english = familyStructureVocabularyValuesByDimension(['gestionar', 'coordonator', 'reparatii'], 'en');
  assert.equal(english.get('role_heads')?.includes('clerk') ?? false, false);
  assert.equal(english.get('authority_band')?.includes('supervisor') ?? false, false);
  assert.equal(english.get('activities')?.includes('repair_maintain_install') ?? false, false);
});

test('family structure vocabulary reads Romanian nursing phrases as role-level evidence', () => {
  const values = familyStructureVocabularyValuesByDimension(
    ['asistent', 'medical', 'generalist', 'asistent medical', 'asistent medical generalist'],
    'ro'
  );

  assert.ok(values.get('role_heads')?.includes('nurse'));
  assert.ok(values.get('occupation_level')?.includes('associate_technical'));
  assert.ok(values.get('knowledge_domains')?.includes('health'));
});

test('family structure vocabulary reads Romanian dentist phrases as health-professional role evidence', () => {
  const values = familyStructureVocabularyValuesByDimension(['medic', 'dentist', 'stomatolog', 'medic dentist', 'medic stomatolog'], 'ro');

  assert.ok(values.get('role_heads')?.includes('dentist'));
  assert.ok(values.get('knowledge_domains')?.includes('health'));
  assert.ok(values.get('occupation_level')?.includes('professional'));
});

test('family structure vocabulary reads Romanian hospital disinfection terms as sanitation evidence', () => {
  const values = familyStructureVocabularyValuesByDimension(['dezinfectie', 'spitalicesc'], 'ro');

  assert.ok(values.get('role_heads')?.includes('cleaner'));
  assert.ok(values.get('knowledge_domains')?.includes('cleaning_sanitation'));
  assert.ok(values.get('knowledge_domains')?.includes('health'));
  assert.ok(values.get('settings')?.includes('hospital_clinic_pharmacy'));
  assert.ok(values.get('activities')?.includes('clean_prepare_handle'));
});

test('family structure vocabulary reads Romanian technical representative as professional sales evidence', () => {
  const values = familyStructureVocabularyValuesByDimension(['reprezentant tehnic'], 'ro');

  assert.ok(values.get('role_heads')?.includes('sales professional'));
});

test('family structure vocabulary seed supports hu and et entries without leaking across locales', () => {
  const hungarian = familyStructureVocabularyValuesByDimension(['vezető', 'ügyintéző', 'ügyfélszolgálat'], 'hu');
  assert.ok(hungarian.get('role_heads')?.includes('manager'));
  assert.ok(hungarian.get('role_heads')?.includes('clerk'));
  assert.ok(hungarian.get('population_or_channel')?.includes('customer_client'));

  const estonian = familyStructureVocabularyValuesByDimension(['tehnik', 'klienditeenindus'], 'et');
  assert.ok(estonian.get('role_heads')?.includes('technician'));
  assert.ok(estonian.get('population_or_channel')?.includes('customer_client'));

  const romanian = familyStructureVocabularyValuesByDimension(['ügyintéző', 'klienditeenindus'], 'ro');
  assert.equal(romanian.get('role_heads')?.includes('clerk') ?? false, false);
  assert.equal(romanian.get('population_or_channel')?.includes('customer_client') ?? false, false);
});

test('family structure vocabulary reviewed seed covers broader Romanian dataset terms', () => {
  const values = familyStructureVocabularyValuesByDimension(
    [
      'programator',
      'analist',
      'mecanic',
      'ajutor',
      'bucatar',
      'ospatar',
      'vopsitor',
      'tamplar',
      'curier',
      'paznic',
      'antrenor',
      'imobiliar',
      'sap',
      'utilaje',
      'drumuri',
      'pacienti',
      'farmaceutice',
      'birou',
      'bucatarie',
      'copii',
      'pasageri',
      'camion',
      'programare',
      'receptie',
      'paza',
      'ingrijire'
    ],
    'ro'
  );

  assert.ok(values.get('role_heads')?.includes('developer'));
  assert.ok(values.get('role_heads')?.includes('analyst'));
  assert.ok(values.get('role_heads')?.includes('mechanic'));
  assert.ok(values.get('role_heads')?.includes('assistant'));
  assert.ok(values.get('role_heads')?.includes('cook'));
  assert.ok(values.get('role_heads')?.includes('service_worker'));
  assert.ok(values.get('role_heads')?.includes('painter'));
  assert.ok(values.get('role_heads')?.includes('carpenter'));
  assert.ok(values.get('role_heads')?.includes('courier'));
  assert.ok(values.get('role_heads')?.includes('guard'));
  assert.ok(values.get('role_heads')?.includes('coach'));
  assert.ok(values.get('knowledge_domains')?.includes('business services'));
  assert.ok(values.get('work_objects')?.includes('software_data'));
  assert.ok(values.get('work_objects')?.includes('machinery_equipment'));
  assert.ok(values.get('work_objects')?.includes('buildings_structures'));
  assert.ok(values.get('work_objects')?.includes('patients_treatment'));
  assert.ok(values.get('work_objects')?.includes('chemical_photographic'));
  assert.ok(values.get('settings')?.includes('office'));
  assert.ok(values.get('settings')?.includes('hotel_restaurant'));
  assert.ok(values.get('population_or_channel')?.includes('child_student'));
  assert.ok(values.get('population_or_channel')?.includes('passenger_tourist'));
  assert.ok(values.get('transport_mode')?.includes('road_heavy'));
  assert.ok(values.get('occupation_level')?.includes('elementary'));
  assert.ok(values.get('authority_band')?.includes('assistant_helper'));
  assert.ok(values.get('activities')?.includes('develop_ict'));
  assert.ok(values.get('activities')?.includes('serve_customer'));
  assert.ok(values.get('activities')?.includes('protect_enforce'));
  assert.ok(values.get('activities')?.includes('care_treat'));
});
