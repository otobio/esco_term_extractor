import { describe, expect, it } from 'vitest';
import { classifyClause } from '../src/noise-guard.ts';
import { normalizeText, words } from '../src/normalize.ts';
import { parseDescriptionSections } from '../src/profiles/description.ts';
import { splitClauses } from '../src/tokenizer.ts';

describe('normalizeText', () => {
  it('lowercases, strips diacritics and punctuation', () => {
    expect(normalizeText('Cluj-Napoca, ROMÂNIA!')).toBe('cluj napoca romania');
  });
  it('collapses whitespace', () => {
    expect(normalizeText('  a   b\t c ')).toBe('a b c');
  });
  it('words() splits normalized tokens', () => {
    expect(words(normalizeText('Spring Boot'))).toEqual(['spring', 'boot']);
  });
});

describe('splitClauses', () => {
  it('splits on punctuation and and/or', () => {
    const clauses = splitClauses('Java and Python, SQL; Docker or Kubernetes', 'text').map((c) => c.text);
    expect(clauses).toEqual(['Java', 'Python', 'SQL', 'Docker', 'Kubernetes']);
  });
  it('splits multilingual conjunctions', () => {
    const clauses = splitClauses('remote și full-time', 'text').map((c) => c.text);
    expect(clauses).toContain('remote');
    expect(clauses).toContain('full-time');
  });
  it('drops empty fragments', () => {
    expect(splitClauses('...,,,', 'text')).toEqual([]);
  });
});

describe('classifyClause', () => {
  it('drops emails and application boilerplate', () => {
    expect(classifyClause('send your CV to jobs@acme.com').keep).toBe(false);
    expect(classifyClause('https://acme.com/careers').keep).toBe(false);
  });
  it('keeps real content', () => {
    expect(classifyClause('Senior Java Developer').keep).toBe(true);
  });
});

describe('parseDescriptionSections', () => {
  it('detects Romanian section headers', () => {
    const sections = parseDescriptionSections('Cerințe:\nPython\n\nBeneficii:\nabonament medical', 'ro');
    expect(sections.map((section) => section.kind)).toEqual(['requirements', 'benefits']);
    expect(sections[0]?.clauses).toEqual(['Python']);
  });

  it('detects Hungarian inline headers with content', () => {
    const sections = parseDescriptionSections('Amit kínálunk: Mobiltelefon', 'hu');
    expect(sections).toEqual([expect.objectContaining({ kind: 'benefits', clauses: ['Mobiltelefon'] })]);
  });

  it('detects common Hungarian board headers and splits requirement bullets cleanly', () => {
    const sections = parseDescriptionSections(
      [
        'Céginformáció',
        'Stabil háttér.',
        '',
        'Feladatok',
        'Raktári előkészítés',
        '',
        'Elvárások',
        'Minimum általános iskolai végzettség;',
        'Önálló, gyors és precíz munkavégzés;',
        'Magára és munkájára igényes hozzáállás.',
        '',
        'Előnyt jelent',
        'Targonca jogosítvány',
        '',
        'Amit kínálunk',
        'Mobiltelefon',
        '',
        'Jelentkezés módja',
        'Emailben',
      ].join('\n'),
      'hu',
    );
    expect(sections.map((section) => section.kind)).toEqual([
      'company',
      'responsibilities',
      'requirements',
      'benefits',
      'application',
    ]);
    expect(sections[2]?.clauses).toEqual([
      'Minimum általános iskolai végzettség',
      'Önálló, gyors és precíz munkavégzés',
      'Magára és munkájára igényes hozzáállás',
      'Targonca jogosítvány',
    ]);
  });

  it('detects common Romanian board headers and keeps newline bullets intact', () => {
    const sections = parseDescriptionSections(
      [
        'Candidatul Ideal',
        'Profilul pe care îl căutăm:',
        'Ești o persoană responsabilă și organizată;',
        'Ai atenție la detalii și spirit practic;',
        'Îți place să lucrezi în teren și să fii activ(ă);',
        'Experiența în merchandising, retail sau FMCG reprezintă un avantaj, dar nu este obligatorie;',
        'Ai studii medii finalizate.',
        '',
        'Descrierea jobului',
        'Ce vei face?',
        'Te vei asigura că produsele sunt expuse corect și atractiv la raft;',
        'Vei verifica stocurile, prețurile și disponibilitatea produselor;',
        '',
        'Ce îți oferim?',
        'Salariu net: 1.400 lei',
        'Tichete de masă: 30 lei/zi lucrată',
        'Abonament medical Regina Maria',
        'Program de lucru flexibil',
        '',
        'Descrierea companiei',
        'Companie națională de distribuție.',
      ].join('\n'),
      'ro',
    );
    expect(sections.map((section) => section.kind)).toEqual([
      'requirements',
      'responsibilities',
      'benefits',
      'company',
    ]);
    expect(sections[0]?.clauses).toEqual([
      'Ești o persoană responsabilă și organizată',
      'Ai atenție la detalii și spirit practic',
      'Îți place să lucrezi în teren și să fii activ(ă)',
      'Experiența în merchandising, retail sau FMCG reprezintă un avantaj, dar nu este obligatorie',
      'Ai studii medii finalizate',
    ]);
    expect(sections[2]?.clauses).toEqual([
      'Salariu net: 1.400 lei',
      'Tichete de masă: 30 lei/zi lucrată',
      'Abonament medical Regina Maria',
    ]);
    expect(sections[3]?.clauses).toEqual(['Companie națională de distribuție']);
  });

  it('detects Romanian requirement and offer headers from real marketplace formatting', () => {
    const sections = parseDescriptionSections(
      [
        'Candidatul Ideal',
        'Angajăm MERCHANDISERI (lucrători comerciali) care să se alăture echipei din zona Sibiu - Alba - Brasov.',
        'Angajatul sa fie cu domiciliul stabil in SIBIU',
        '',
        '*Cerinte:',
        'Bune abilitati de comunicare ; Buna organizare si gestionare a timpului; Atentie la detalii;',
        '',
        'Descrierea jobului',
        '- Vei aproviziona și vei aranja produsele la raft în scopul unei bune vizibilități.',
        '',
        'Program de lucru: Luni-Vineri Interval orar 08:30-17:00',
        '',
        '*Salarizare și beneficii:',
        '- Pachet salarial motivant (salariu fix+ bonus de performanta, tichete de masa)',
        '- Loc de muncă mobil, contract individual de muncă pe durata nedeterminată;',
        '- Masina + telefon de serviciu',
      ].join('\n'),
      'ro',
    );
    expect(sections.map((section) => section.kind)).toEqual(['requirements', 'responsibilities', 'benefits']);
    expect(sections[0]?.clauses).toEqual([
      'Angajăm MERCHANDISERI (lucrători comerciali) care să se alăture echipei din zona Sibiu - Alba - Brasov',
      'Angajatul sa fie cu domiciliul stabil in SIBIU',
      'Bune abilitati de comunicare',
      'Buna organizare si gestionare a timpului',
      'Atentie la detalii',
    ]);
    expect(sections[2]?.clauses).toEqual([
      'Luni-Vineri Interval orar 08:30-17:00',
      'Pachet salarial motivant (salariu fix+ bonus de performanta, tichete de masa)',
      'Loc de muncă mobil, contract individual de muncă pe durata nedeterminată',
    ]);
  });

  it('falls back to unknown for plain prose', () => {
    const sections = parseDescriptionSections('Lihtne kirjeldus ilma päisteta.', 'et');
    expect(sections).toEqual([
      expect.objectContaining({ kind: 'unknown', clauses: ['Lihtne kirjeldus ilma päisteta'] }),
    ]);
  });

  it('strips numbered and lettered list markers from clauses', () => {
    const sections = parseDescriptionSections(
      ['Cerinte:', '1. Python', '2) SQL', 'a) atentie la detalii'].join('\n'),
      'ro',
    );
    expect(sections[0]?.clauses).toEqual(['Python', 'SQL', 'atentie la detalii']);
  });

  it('bridges a short stray unclassified line between two same-kind sections', () => {
    const sections = parseDescriptionSections(
      ['Cerinte:', 'Python', '', 'Nota interna', '', 'Cerinte:', 'SQL'].join('\n'),
      'ro',
    );
    expect(sections.map((section) => section.kind)).toEqual(['requirements']);
    expect(sections[0]?.clauses).toEqual(['Python', 'Nota interna', 'SQL']);
  });

  it('joins soft-wrapped continuation lines into a single clause', () => {
    const sections = parseDescriptionSections(
      [
        'Requirements',
        'We are looking for a candidate with strong communication skills',
        'and a positive attitude.',
      ].join('\n'),
      'en',
    );
    expect(sections[0]?.clauses).toEqual([
      'We are looking for a candidate with strong communication skills and a positive attitude',
    ]);
  });
});
