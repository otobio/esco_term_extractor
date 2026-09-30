import type { EscoApiFetch } from '../../../src/occupation-esco-api-classifier/index.js';

const OCC = 'http://data.europa.eu/esco/occupation/';
const ISCO = 'http://data.europa.eu/esco/isco/C';
const PREF = 'http://www.w3.org/2008/05/skos-xl#prefLabel';
const ALT = 'http://www.w3.org/2008/05/skos-xl#altLabel';

type Hit = { id: string; code: string; title: string; en: string };
type Term = { concept: string; literal: string; type: string };
type Fixture = { hits: Hit[]; terms: Term[] };

const FIXTURES: Record<string, Fixture> = {
  'ro|ajutor bucătar': {
    hits: [
      { id: 'kitchen-assistant', code: '9412.1', title: 'ajutor de bucătar', en: 'kitchen assistant' },
      { id: 'cook', code: '5120.1', title: 'bucătar', en: 'cook' }
    ],
    terms: [
      { concept: `${OCC}kitchen-assistant`, literal: 'ajutor bucătar', type: ALT },
      { concept: 'http://data.europa.eu/esco/skill/knife', literal: 'ajutor bucătar', type: PREF }
    ]
  },
  'ro|Bucătari': {
    hits: [{ id: 'cook', code: '5120.1', title: 'bucătar', en: 'cook' }],
    terms: [{ concept: `${ISCO}512`, literal: 'Bucătari', type: PREF }]
  },
  'hu|könyvelő': {
    hits: [{ id: 'accountant', code: '2411.1', title: 'könyvelő', en: 'accountant' }],
    terms: [{ concept: `${OCC}accountant`, literal: 'könyvelő', type: PREF }]
  },
  'en|waiter': {
    hits: [{ id: 'waiter', code: '5131.1', title: 'waiter/waitress', en: 'waiter/waitress' }],
    terms: []
  },
  'en|Airline Compliance Auditors': {
    hits: [
      { id: 'pilot', code: '3153.2.2.1', title: 'airline transport pilot', en: 'airline transport pilot' },
      { id: 'financial-auditor', code: '2411.1.7', title: 'financial auditor', en: 'financial auditor' },
      { id: 'compliance-officer', code: '2411.2', title: 'compliance officer', en: 'compliance officer' }
    ],
    terms: [{ concept: `${OCC}financial-auditor`, literal: 'auditor', type: ALT }]
  },
  'hu|nurse nővér': { hits: [], terms: [] },
  'en|nurse nővér': {
    hits: [
      { id: 'nurse-a', code: '2221.1', title: 'specialist nurse', en: 'specialist nurse' },
      { id: 'nurse-b', code: '2221.2', title: 'nurse responsible for general care', en: 'nurse responsible for general care' }
    ],
    terms: [{ concept: `${OCC}nurse-b`, literal: 'nurse', type: ALT }]
  },
  'en|financial auditor': {
    hits: [
      { id: 'financial-auditor', code: '2411.1.7', title: 'financial auditor', en: 'financial auditor' },
      { id: 'accountant', code: '2411.1', title: 'accountant', en: 'accountant' }
    ],
    terms: [{ concept: `${OCC}financial-auditor`, literal: 'financial auditor', type: PREF }]
  },
  'ro|AJUTOR BUCATAR FAST FOOD': {
    hits: [{ id: 'kitchen-assistant', code: '9412.1', title: 'ajutor de bucătar', en: 'kitchen assistant' }],
    terms: [{ concept: `${OCC}kitchen-assistant`, literal: 'ajutor bucătar', type: ALT }]
  },
  'ro|LUCRATOR COMERCIAL': {
    hits: [{ id: 'shelf-filler', code: '9334.1', title: 'lucrător comercial', en: 'shelf filler' }],
    terms: [{ concept: `${OCC}shelf-filler`, literal: 'lucrător comercial', type: ALT }]
  }
};

const FAMILY_LABELS: Record<string, string> = { '241': 'Finance professionals', '512': 'Cooks', '941': 'Food preparation assistants', '222': 'Nursing professionals', '933': 'Transport and storage labourers', '513': 'Waiters and bartenders' };

function json(body: unknown): ReturnType<EscoApiFetch> {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

export const fakeFetch: EscoApiFetch = (url) => {
  const parsed = new URL(url);
  const path = parsed.pathname.split('/api/')[1];
  const language = parsed.searchParams.get('language') ?? 'en';
  const fixture = FIXTURES[`${language}|${parsed.searchParams.get('text') ?? ''}`] ?? { hits: [], terms: [] };

  if (path === 'search') {
    const results = fixture.hits.map((hit) => ({ uri: `${OCC}${hit.id}`, code: hit.code, title: hit.title, preferredLabel: { en: hit.en } }));
    return json({ _embedded: { results } });
  }

  if (path === 'terms') {
    const results = fixture.terms.map((term) => ({ concept: term.concept, literalForm: term.literal, hasLabelType: term.type }));
    return json({ _embedded: { results } });
  }

  const embedded = Object.fromEntries(
    parsed.searchParams.getAll('uris').map((uri) => {
      const code = uri.slice(ISCO.length);
      return [uri, { uri, code, title: FAMILY_LABELS[code] ?? code, preferredLabel: { en: FAMILY_LABELS[code] ?? code } }];
    })
  );
  return json({ _embedded: embedded });
};
