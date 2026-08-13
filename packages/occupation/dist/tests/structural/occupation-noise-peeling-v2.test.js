import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peelOccupationTitleNoiseV2 } from '../../src/query/occupation-noise-peeling-v2.js';
test('noise peeler v2 removes only matched employment phrases, not the whole chunk', () => {
    assert.equal(peelOccupationTitleNoiseV2('Lucrator comercial Full Time - Hervis Alba Iulia', 'ro'), 'Lucrator comercial - Hervis Alba Iulia');
    assert.equal(peelOccupationTitleNoiseV2('Manipulant Marfa - NON BAT - Timisoara', 'ro'), 'Manipulant Marfa - NON BAT - Timisoara');
});
test('noise peeler v2 removes only matched brand, identifier, and hour substrings inline', () => {
    assert.equal(peelOccupationTitleNoiseV2('Consultant IT SAP IS-U(244347)', 'ro'), 'Consultant IT SAP IS-U');
    assert.equal(peelOccupationTitleNoiseV2('Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'ro'), 'Sales Advisor Nespresso Boutique Afi Cotroceni');
    assert.equal(peelOccupationTitleNoiseV2('Sef tura patiserie Delissima Bakery', 'ro'), 'Sef tura patiserie');
});
test('noise peeler v2 applies longer rules before shorter prefixes', () => {
    assert.equal(peelOccupationTitleNoiseV2('Account Manager salary range', 'ro'), 'Account Manager');
});
test('noise peeler v2 removes known CTA and brand phrases without occupation heuristics', () => {
    assert.equal(peelOccupationTitleNoiseV2('Cautam colegi pentru Pizza Hut!', 'ro'), 'pentru');
    assert.equal(peelOccupationTitleNoiseV2('Cautam / Electrician naval', 'ro'), 'Electrician naval');
});
test('noise peeler v2 handles phrase variants with punctuation tolerance', () => {
    assert.equal(peelOccupationTitleNoiseV2('Contabil / full-time', 'ro'), 'Contabil');
    assert.equal(peelOccupationTitleNoiseV2('Proiectant (m/f) [Full-Time]', 'ro'), 'Proiectant');
    assert.equal(peelOccupationTitleNoiseV2('Analist financiar with English', 'ro'), 'Analist financiar');
});
test('noise peeler v2 preserves untouched separators and brackets', () => {
    assert.equal(peelOccupationTitleNoiseV2('Antrenor / instructor pentru gimnastica ritmica', 'ro'), 'Antrenor / instructor pentru gimnastica ritmica');
    assert.equal(peelOccupationTitleNoiseV2('Sofer C + E cu experienta', 'ro'), 'Sofer C + E cu experienta');
    assert.equal(peelOccupationTitleNoiseV2('Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI', 'ro'), 'Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI');
});
test('noise peeler v2 removes explicit experience, hashtag, and compensation noise', () => {
    assert.equal(peelOccupationTitleNoiseV2('Inginer Tehnolog-Industria Cărnii (Experienta min. 5 ani)', 'ro'), 'Inginer Tehnolog-Industria Cărnii');
    assert.equal(peelOccupationTitleNoiseV2('KFC Bran cauta colegi! Hai intr-o echipa #pebune!', 'ro'), 'KFC Bran Hai intr-o echipa');
    assert.equal(peelOccupationTitleNoiseV2('Game Presenter / Crupier–3000 lei+400 lei tichete masa+ 1000 lei BONUS, Pipera-București', 'ro'), 'Game Presenter / Crupier, Pipera-București');
    assert.equal(peelOccupationTitleNoiseV2('Vopsitor industrial - 2 schimburi', 'ro'), 'Vopsitor industrial');
    assert.equal(peelOccupationTitleNoiseV2('Lucrător comercial Legume-Fructe | 2 zile lucrate/2 libere', 'ro'), 'Lucrător comercial Legume-Fructe');
    assert.equal(peelOccupationTitleNoiseV2('Senior Consultant SAP SD (m/w/d) S/4HANA Sales', 'ro'), 'Senior Consultant SAP SD S/4HANA Sales');
    assert.equal(peelOccupationTitleNoiseV2('_Agent Servicii Clienti_Limba Italiana', 'ro'), 'Agent Servicii Clienti_Limba Italiana');
    assert.equal(peelOccupationTitleNoiseV2('Vopsitor Auto - Germania, cazare asigurată (f/m/x)', 'ro'), 'Vopsitor Auto - Germania');
    assert.equal(peelOccupationTitleNoiseV2('Sales Representative with German & English (Hybrid)', 'ro'), 'Sales Representative');
    assert.equal(peelOccupationTitleNoiseV2('Personal de Serviciu Codlea, part-time 4 ore (f/m)', 'ro'), 'Personal de Serviciu Codlea');
    assert.equal(peelOccupationTitleNoiseV2('Mecanic auto - Sect. 6', 'ro'), 'Mecanic auto');
    assert.equal(peelOccupationTitleNoiseV2('Asistent Vânzări full-time CCC Balotesti DN1 (F/M/D)', 'ro'), 'Asistent Vânzări CCC Balotesti');
    assert.equal(peelOccupationTitleNoiseV2('Billing Specialist (German)', 'ro'), 'Billing Specialist');
    assert.equal(peelOccupationTitleNoiseV2('Inginer Constructor 10000RON NET-URZICENI/ ODORHEIU SECUIESC', 'ro'), 'Inginer Constructor URZICENI/ ODORHEIU SECUIESC');
    assert.equal(peelOccupationTitleNoiseV2('Collections Process Expert with Polish / Czech', 'ro'), 'Collections Process Expert');
    assert.equal(peelOccupationTitleNoiseV2('Manipulant marfa - Aricestii Rahtivani (Engleza mediu)', 'ro'), 'Manipulant marfa - Aricestii Rahtivani');
    assert.equal(peelOccupationTitleNoiseV2('HSE Specialist (Huedin, Jud. Cluj)', 'ro'), 'HSE Specialist');
    assert.equal(peelOccupationTitleNoiseV2('Operátor gyártás (Budapest, Pest megye)', 'hu'), 'Operátor gyártás');
});
