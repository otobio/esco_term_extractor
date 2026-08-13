import assert from 'node:assert/strict';
import { test } from 'node:test';
import { peelOccupationTitleNoise } from '../../src/query/occupation-noise-peeling.js';
test('noise peeler removes only matched employment phrases, not the whole chunk', () => {
    assert.equal(peelOccupationTitleNoise('Lucrator comercial Full Time - Hervis Alba Iulia', 'ro'), 'Lucrator comercial - Hervis Alba Iulia');
    assert.equal(peelOccupationTitleNoise('Manipulant Marfa - NON BAT - Timisoara', 'ro'), 'Manipulant Marfa - NON BAT - Timisoara');
});
test('noise peeler removes only matched brand, identifier, and hour substrings inline', () => {
    assert.equal(peelOccupationTitleNoise('Consultant IT SAP IS-U(244347)', 'ro'), 'Consultant IT SAP IS-U');
    assert.equal(peelOccupationTitleNoise('Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'ro'), 'Sales Advisor Nespresso Boutique Afi Cotroceni');
    assert.equal(peelOccupationTitleNoise('Sef tura patiserie Delissima Bakery', 'ro'), 'Sef tura patiserie');
});
test('noise peeler applies longer rules before shorter prefixes', () => {
    assert.equal(peelOccupationTitleNoise('Account Manager salary range', 'ro'), 'Account Manager');
});
test('noise peeler removes known CTA and brand phrases without occupation heuristics', () => {
    assert.equal(peelOccupationTitleNoise('Cautam colegi pentru Pizza Hut!', 'ro'), 'pentru');
    assert.equal(peelOccupationTitleNoise('Cautam / Electrician naval', 'ro'), 'Electrician naval');
});
test('noise peeler handles phrase variants with punctuation tolerance', () => {
    assert.equal(peelOccupationTitleNoise('Contabil / full-time', 'ro'), 'Contabil');
    assert.equal(peelOccupationTitleNoise('Proiectant (m/f) [Full-Time]', 'ro'), 'Proiectant');
    assert.equal(peelOccupationTitleNoise('Analist financiar with English', 'ro'), 'Analist financiar');
});
test('noise peeler preserves untouched separators and brackets', () => {
    assert.equal(peelOccupationTitleNoise('Antrenor / instructor pentru gimnastica ritmica', 'ro'), 'Antrenor / instructor pentru gimnastica ritmica');
    assert.equal(peelOccupationTitleNoise('Sofer C + E cu experienta', 'ro'), 'Sofer C + E cu experienta');
    assert.equal(peelOccupationTitleNoise('Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI', 'ro'), 'Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI');
});
test('noise peeler removes explicit experience, hashtag, compensation, language, and location noise', () => {
    assert.equal(peelOccupationTitleNoise('Inginer Tehnolog-Industria Cărnii (Experienta min. 5 ani)', 'ro'), 'Inginer Tehnolog-Industria Cărnii');
    assert.equal(peelOccupationTitleNoise('KFC Bran cauta colegi! Hai intr-o echipa #pebune!', 'ro'), 'KFC Bran Hai intr-o echipa');
    assert.equal(peelOccupationTitleNoise('Game Presenter / Crupier–3000 lei+400 lei tichete masa+ 1000 lei BONUS, Pipera-București', 'ro'), 'Game Presenter / Crupier, Pipera-București');
    assert.equal(peelOccupationTitleNoise('Vopsitor industrial - 2 schimburi', 'ro'), 'Vopsitor industrial');
    assert.equal(peelOccupationTitleNoise('Lucrător comercial Legume-Fructe | 2 zile lucrate/2 libere', 'ro'), 'Lucrător comercial Legume-Fructe');
    assert.equal(peelOccupationTitleNoise('Senior Consultant SAP SD (m/w/d) S/4HANA Sales', 'ro'), 'Senior Consultant SAP SD S/4HANA Sales');
    assert.equal(peelOccupationTitleNoise('_Agent Servicii Clienti_Limba Italiana', 'ro'), 'Agent Servicii Clienti_Limba Italiana');
    assert.equal(peelOccupationTitleNoise('Vopsitor Auto - Germania, cazare asigurată (f/m/x)', 'ro'), 'Vopsitor Auto - Germania');
    assert.equal(peelOccupationTitleNoise('Sales Representative with German & English (Hybrid)', 'ro'), 'Sales Representative');
    assert.equal(peelOccupationTitleNoise('Personal de Serviciu Codlea, part-time 4 ore (f/m)', 'ro'), 'Personal de Serviciu Codlea');
    assert.equal(peelOccupationTitleNoise('Mecanic auto - Sect. 6', 'ro'), 'Mecanic auto');
    assert.equal(peelOccupationTitleNoise('Asistent Vânzări full-time CCC Balotesti DN1 (F/M/D)', 'ro'), 'Asistent Vânzări CCC Balotesti');
    assert.equal(peelOccupationTitleNoise('Billing Specialist (German)', 'ro'), 'Billing Specialist');
    assert.equal(peelOccupationTitleNoise('Inginer Constructor 10000RON NET-URZICENI/ ODORHEIU SECUIESC', 'ro'), 'Inginer Constructor URZICENI/ ODORHEIU SECUIESC');
    assert.equal(peelOccupationTitleNoise('Collections Process Expert with Polish / Czech', 'ro'), 'Collections Process Expert');
    assert.equal(peelOccupationTitleNoise('Manipulant marfa - Aricestii Rahtivani (Engleza mediu)', 'ro'), 'Manipulant marfa - Aricestii Rahtivani');
    assert.equal(peelOccupationTitleNoise('HSE Specialist (Huedin, Jud. Cluj)', 'ro'), 'HSE Specialist');
    assert.equal(peelOccupationTitleNoise('Operátor gyártás (Budapest, Pest megye)', 'hu'), 'Operátor gyártás');
});
