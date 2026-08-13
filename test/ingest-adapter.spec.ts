import { describe, expect, it } from 'vitest';
import { CollarMap } from '../src/derive/collar.ts';
import { setOccupationResolver } from '../src/inference/occupation.ts';
import {
  analyzeJobListing,
  type CanonicalMatch,
  derive,
  deriveMany,
  explicitBuckets,
  type Runtime,
} from '../src/ingest/index.ts';
import type { OpenSearchClient } from '../src/matchers/types.ts';
import type { DictionaryTerm } from '../src/types.ts';
import { buildLexicalIndex } from './support/lexical.ts';

/** Fake OS client: resolves every surface to `<bucket>:resolved` (bucket read off the query filter). */
function bucketOf(query: Record<string, unknown>): string {
  const filters = (query as any)?.query?.bool?.filter ?? [];
  return filters.find((f: any) => f?.term?.bucket)?.term?.bucket ?? 'occupation';
}
const fakeClient: OpenSearchClient = {
  queryModelId: async () => null,
  msearch: async (queries) =>
    queries.map((q) => ({
      hits: {
        hits: [
          {
            _score: 80,
            _source: { canonical_key: `${bucketOf(q)}:resolved`, value: 'x', language_code: 'en', aliases: [] },
          },
        ],
      },
    })),
};

const sparseClient: OpenSearchClient = {
  queryModelId: async () => null,
  msearch: async (queries) =>
    queries.map((q) => {
      const bucket = bucketOf(q);
      const hitsByBucket: Record<string, unknown[]> = {
        location: [],
        workplace: [],
        employment: [
          {
            _score: 80,
            _source: {
              canonical_key: 'employment:full_time',
              value: 'full time',
              language_code: 'en',
              aliases: [],
            },
          },
        ],
        level: [
          {
            _score: 80,
            _source: {
              canonical_key: 'level:mid_level',
              value: 'mid level',
              language_code: 'en',
              aliases: [],
            },
          },
        ],
      };

      return {
        hits: {
          hits: hitsByBucket[bucket] ?? [],
        },
      };
    }),
};

function term(
  canonicalKey: string,
  bucket: DictionaryTerm['bucket'],
  languageCode: DictionaryTerm['languageCode'],
  displayName: string,
  aliases: string[] = [],
): DictionaryTerm {
  return { canonicalKey, bucket, termType: 'canonical', displayName, value: displayName, languageCode, aliases };
}

const FINITE_TERMS: DictionaryTerm[] = [
  term('capability:knowledge:sql', 'capabilities', 'en', 'SQL', ['sql']),
  term('capability:knowledge:python_computer_programming', 'capabilities', 'en', 'Python', ['python']),
  term('employment:full_time', 'employment', 'en', 'Full Time', ['full time', 'full-time']),
  term('level:senior', 'level', 'en', 'Senior', ['senior']),
  term('level:mid_level', 'level', 'en', 'Mid level', ['mid level']),
  term('level:lead', 'level', 'en', 'Lead', ['lead']),
  term('workplace:flexible', 'workplace', 'hu', 'Flexible', ['Terület/régió']),
  term('schedule:fixed_shift', 'schedule', 'hu', 'Kötött', ['Kötött munkarend']),
  term('schedule:flexible_hours', 'schedule', 'hu', 'Kötetlen', ['Kötetlen munkarend']),
  term('benefits:phone_provided', 'benefits', 'hu', 'Mobiltelefon', ['Mobiltelefon']),
  term('benefits:company_car', 'benefits', 'hu', 'Céges autó', ['Céges autó']),
  term('benefits:health_insurance', 'benefits', 'hu', 'Egészségbiztosítás', ['Egészségbiztosítás']),
  term('benefits:health_insurance', 'benefits', 'hu', 'Egészségpénztár', ['Egészségpénztár']),
  term('benefits:pension_scheme', 'benefits', 'hu', 'Nyugdíjpénztár', ['Nyugdíjpénztár']),
  term('qualification:education_requirement:1c_degree', 'qualifications', 'hu', 'Főiskola', ['Főiskola']),
  term('qualification:language_requirement:german', 'qualifications', 'hu', 'Német', ['Német']),
  term('qualification:license:driving_license_b', 'qualifications', 'en', 'Driving Licence B', ['driving licence B']),
  term('sector:banking_financial_services', 'sector', 'en', 'Banking, Finance & Insurance', [
    'Banking, Finance & Insurance',
  ]),
  term('sector:construction', 'sector', 'hu', 'Építő munka, Földmunka', ['Építő munka, Földmunka']),
  term('sector:food_beverage', 'sector', 'ro', 'Alimentație / HoReCa', ['Alimentație / HoReCa']),
  term('job_function:sales_commerce', 'job_function', 'hu', 'Értékesítés, Kereskedelem', ['Értékesítés, Kereskedelem']),
];
const finiteLexical = buildLexicalIndex(FINITE_TERMS);
/** Fake gazetteer: resolves any non-empty text to `location:resolved` (structured or
 *  unstructured), so the gazetteer-owned location path is exercised without real data. */
const fakeGazetteer = {
  resolve: (clauses: { text: string }[], structured?: string, country?: string) => {
    const text = structured ?? clauses.map((c) => c.text).join(' ');
    if (!text.trim()) return [];
    return [
      {
        canonicalKey: 'location:resolved',
        displayName: 'Resolved',
        termType: 'city',
        languageCode: country ?? 'ro',
        score: 0.95,
        method: 'gazetteer',
        evidence: [{ clause: structured ?? text, method: 'gazetteer', score: 0.95 }],
      },
    ];
  },
} as any;

const runtime: Runtime = {
  client: fakeClient,
  lexical: async () => finiteLexical,
  gazetteer: async () => fakeGazetteer,
  displayTitles: async () => undefined,
  collar: async () => undefined,
  capabilities: async () => undefined,
};
const sparseRuntime: Runtime = {
  client: sparseClient,
  lexical: async () => finiteLexical,
  gazetteer: async () => undefined,
  displayTitles: async () => undefined,
  collar: async () => undefined,
  capabilities: async () => undefined,
};

const match = (over: Partial<CanonicalMatch>): CanonicalMatch => ({
  canonicalKey: 'occupation:a',
  bucket: 'occupation',
  termType: 'canonical',
  matchedAlias: 'a',
  sourceText: 'a',
  evidenceSignal: 'structured',
  evidenceMatchText: 'a',
  itemIndex: 0,
  propositionIndex: 0,
  confidence: 1,
  source: 'derived',
  isConditional: false,
  isPreferred: false,
  isOffered: false,
  structuralTrust: 1,
  legitimacyScore: 1,
  ...over,
});

describe('derive / deriveMany (structured)', () => {
  it('resolves one structured field to a canonical match', async () => {
    const [m] = await derive('senior', { runtime, bucket: 'level' });
    expect(m.canonicalKey).toBe('level:senior');
    expect(m.bucket).toBe('level');
    expect(m.confidence).toBe(1);
    expect(m.evidenceSignal).toBe('structured');
    expect(m.sourceText).toBe('senior');
  });

  it('batches many structured requests across buckets, routing location to the gazetteer', async () => {
    const matches = await deriveMany(
      [
        { bucket: 'level', input: 'senior' },
        { bucket: 'location', input: 'Cluj' },
        { bucket: 'qualifications', input: 'driving licence B', mode: 'lexical' },
      ],
      { runtime },
    );
    // Every requested bucket is represented; the OS (`:resolved`) and gazetteer
    // resolutions are present. Finite buckets may carry ADDITIONAL keys from the
    // rule-inference union — asserted structurally, not pinned to dictionary content.
    expect(new Set(matches.map((m) => m.bucket))).toEqual(new Set(['level', 'location', 'qualifications']));
    const keys = matches.map((m) => m.canonicalKey);
    expect(keys).toContain('level:senior');
    expect(keys).toContain('location:resolved');
    expect(keys).toContain('qualification:license:driving_license_b');
  });

  it('resolves structured finite buckets from the binary taxonomy', async () => {
    const matches = await deriveMany(
      [
        { bucket: 'workplace', input: 'Terület/régió', locale: 'hu' },
        { bucket: 'schedule', input: 'Kötött', locale: 'hu' },
        { bucket: 'benefits', input: 'Mobiltelefon', locale: 'hu' },
        { bucket: 'qualifications', input: 'Főiskola', locale: 'hu' },
        { bucket: 'qualifications', input: 'Német', locale: 'hu' },
      ],
      { runtime, locale: 'hu' },
    );

    const keys = new Set(matches.map((m) => m.canonicalKey));
    expect(keys).toContain('workplace:flexible');
    expect(keys).toContain('schedule:fixed_shift');
    expect(keys).toContain('benefits:phone_provided');
    expect(keys).toContain('qualification:education_requirement:1c_degree');
    expect(keys).toContain('qualification:language_requirement:german');
  });

  it('resolves a structured finite sector value from the binary taxonomy', async () => {
    const matches = await deriveMany([{ bucket: 'sector', input: 'Banking, Finance & Insurance', locale: 'en' }], {
      runtime: sparseRuntime,
    });
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((m) => m.bucket === 'sector')).toBe(true);
    expect(matches.every((m) => m.canonicalKey.startsWith('sector:'))).toBe(true);
    expect(matches.every((m) => m.confidence === 1)).toBe(true);
  });

  it('resolves sector and job_function structured values without calling OS', async () => {
    const noOsRuntime: Runtime = {
      client: {
        queryModelId: async () => null,
        msearch: async () => {
          throw new Error('OS should not be called for finite structured sector/job_function');
        },
      },
      lexical: async () => finiteLexical,
      gazetteer: async () => undefined,
      displayTitles: async () => undefined,
      collar: async () => undefined,
      capabilities: async () => undefined,
    };

    const matches = await deriveMany(
      [
        { bucket: 'sector', input: 'Építő munka, Földmunka', locale: 'hu' },
        { bucket: 'job_function', input: 'Értékesítés, Kereskedelem', locale: 'hu' },
      ],
      { runtime: noOsRuntime, locale: 'hu' },
    );

    expect(matches.map((m) => m.canonicalKey)).toEqual(
      expect.arrayContaining(['sector:construction', 'job_function:sales_commerce']),
    );
  });

  it('keeps sourceText aligned to the originating request when earlier batched requests resolve nothing', async () => {
    const matches = await deriveMany(
      [
        { bucket: 'location', input: 'Lagos' },
        { bucket: 'workplace', input: 'Lagos' },
        { bucket: 'employment', input: 'Full Time' },
        { bucket: 'level', input: 'Mid level' },
      ],
      { runtime: sparseRuntime },
    );

    expect(matches).toEqual([
      expect.objectContaining({
        canonicalKey: 'employment:full_time',
        bucket: 'employment',
        sourceText: 'Full Time',
        evidenceMatchText: 'Full Time',
      }),
      expect.objectContaining({
        canonicalKey: 'level:mid_level',
        bucket: 'level',
        sourceText: 'Mid level',
        evidenceMatchText: 'Mid level',
      }),
    ]);
  });

  it('sends the alt occupation engine output through the title profile as alt signals', async () => {
    const altRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => finiteLexical,
      gazetteer: async () => fakeGazetteer,
      displayTitles: async () => undefined,
      collar: async () => undefined,
      capabilities: async () => undefined,
    };
    setOccupationResolver(
      async () =>
        ({
          occupationContexts: [
            {
              selectedLeafTerm: { graphNodeId: 1001, canonicalTerm: 'Software Engineer', confidence: 0.91 },
              selectedFamilyTerm: { graphNodeId: 2002, canonicalTerm: 'ICT Professionals', confidence: 0.8 },
              altLeafCanonicalTerms: [],
              altFamilyCanonicalTerms: [],
            },
          ],
        }) as any,
    );
    try {
      const matches = await deriveMany([{ profile: 'title', input: 'Backend Developer' }], {
        runtime: altRuntime,
        locale: 'en',
      });
      const alt = matches.filter((m) => m.evidenceSignal.startsWith('alt_occupation'));
      expect(alt.map((m) => m.evidenceSignal).sort()).toEqual(['alt_occupation', 'alt_occupation_family']);
      expect(alt.every((m) => m.bucket === 'occupation')).toBe(true);
      const leaf = alt.find((m) => m.evidenceSignal === 'alt_occupation');
      const family = alt.find((m) => m.evidenceSignal === 'alt_occupation_family');
      expect(leaf?.canonicalKey).toBe('occupation:alt:software_engineer');
      expect(family?.canonicalKey).toBe('occupation:alt_family:ict_professionals');
      expect(leaf?.confidence).toBeCloseTo(0.91, 5); // engine confidence preserved, not flattened to 1
    } finally {
      setOccupationResolver(undefined);
    }
  });

  it('routes a structured occupation field through the title-profile pipeline, keeping only occupation matches', async () => {
    // Alias-scan tags "senior" as a level span; computeResidual peels it off the
    // clause, so resolveTitle resolves BOTH level (from the span) and occupation
    // (from the peeled residual / whole-clause fallback) in one pass. deriveOccupation
    // must keep only the occupation bucket's matches, proving it delegates to the full
    // multi-bucket resolveTitle() rather than a raw single-surface OS query.
    const titleLexical = {
      lookupAll: (text: string) =>
        /senior/i.test(text)
          ? [
              {
                entry: {
                  canonicalKey: 'level:senior',
                  bucket: 'level' as const,
                  displayName: 'Senior',
                  termType: 'canonical',
                  languageCode: 'en' as const,
                },
                words: 1,
                gram: 'senior',
              },
            ]
          : [],
    };
    const occupationRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => titleLexical as any,
      gazetteer: async () => fakeGazetteer,
      displayTitles: async () => undefined,
      collar: async () => undefined,
      capabilities: async () => undefined,
    };

    const matches = await derive('Senior React Developer', { runtime: occupationRuntime, bucket: 'occupation' });
    expect(matches.every((m) => m.bucket === 'occupation')).toBe(true);
    expect(matches.some((m) => m.canonicalKey === 'occupation:resolved')).toBe(true);
    // The real inferOccupation engine also runs (unstubbed here) and tags its own
    // output alt_occupation*; only the title-profile-sourced match is 'structured'.
    const nonAlt = matches.filter((m) => !m.evidenceSignal.startsWith('alt_occupation'));
    expect(nonAlt.length).toBeGreaterThan(0);
    expect(nonAlt.every((m) => m.evidenceSignal === 'structured')).toBe(true);
  });

  it('still derives collar_kind alongside occupation through the title profile (no regression)', async () => {
    // Regression guard: the title profile must keep emitting collar_kind whenever
    // an occupation resolves, independent of any other bucket's inference changes
    // (e.g. company_size). fakeClient resolves occupation to `occupation:resolved`,
    // so the collar map is keyed to that same canonical key.
    const collar = CollarMap.fromEntries({
      'occupation:resolved': { collar: 'collar_kind:white_collar', confidence: 0.9 },
    });
    const collarRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => finiteLexical,
      gazetteer: async () => fakeGazetteer,
      displayTitles: async () => undefined,
      collar: async () => collar,
      capabilities: async () => undefined,
    };
    const matches = await derive('Backend Developer', { runtime: collarRuntime, profile: 'title' });
    expect(matches.some((m) => m.bucket === 'occupation')).toBe(true);
    const collarMatch = matches.find((m) => m.bucket === 'collar_kind');
    expect(collarMatch).toMatchObject({ canonicalKey: 'collar_kind:white_collar', bucket: 'collar_kind' });
  });

  it('surfaces the alt occupation engine through the same structured-occupation path', async () => {
    const occupationRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => finiteLexical,
      gazetteer: async () => fakeGazetteer,
      displayTitles: async () => undefined,
      collar: async () => undefined,
      capabilities: async () => undefined,
    };
    setOccupationResolver(
      async () =>
        ({
          occupationContexts: [
            {
              selectedLeafTerm: { graphNodeId: 1, canonicalTerm: 'Software Engineer', confidence: 0.8 },
              selectedFamilyTerm: null,
              altLeafCanonicalTerms: [],
              altFamilyCanonicalTerms: [],
            },
          ],
        }) as any,
    );
    try {
      const matches = await derive('Senior React Developer', {
        runtime: occupationRuntime,
        bucket: 'occupation',
        locale: 'en',
      });
      const alt = matches.find((m) => m.evidenceSignal === 'alt_occupation');
      expect(alt?.bucket).toBe('occupation');
      expect(alt?.canonicalKey).toBe('occupation:alt:software_engineer');
    } finally {
      setOccupationResolver(undefined);
    }
  });

  it('applies structured-occupation routing inside deriveMany alongside other buckets', async () => {
    const occupationRuntime: Runtime = {
      client: fakeClient,
      lexical: async () => finiteLexical,
      gazetteer: async () => fakeGazetteer,
      displayTitles: async () => undefined,
      collar: async () => undefined,
      capabilities: async () => undefined,
    };
    const matches = await deriveMany(
      [
        { bucket: 'occupation', input: 'React Developer' },
        { bucket: 'level', input: 'senior' },
        { bucket: 'location', input: 'Cluj' },
      ],
      { runtime: occupationRuntime },
    );
    expect(new Set(matches.map((m) => m.bucket))).toEqual(new Set(['occupation', 'level', 'location']));
    const occupation = matches.filter(
      (m) => m.bucket === 'occupation' && !m.evidenceSignal.startsWith('alt_occupation'),
    );
    expect(occupation.length).toBeGreaterThan(0);
    expect(occupation.every((m) => m.evidenceSignal === 'structured')).toBe(true);
  });

  it('skips empty input and requires a bucket or a profile', async () => {
    expect(await derive('   ', { runtime, bucket: 'level' })).toEqual([]);
    await expect(derive('x', { runtime })).rejects.toThrow(/bucket or a profile/);
    await expect(derive('x', { runtime, profile: 'nope' })).rejects.toThrow(/unknown profile/);
  });
});

describe('analyzeJobListing (unstructured)', () => {
  it('probes every bucket over the body and parses salary', async () => {
    const { matches, salaryRanges } = await analyzeJobListing('Backend engineer. Salariu 5000 - 7000 RON pe luna.', {
      runtime,
    });
    // Finite buckets are binary-backed and only resolve when their aliases are
    // actually present in the body. Capability extraction is stricter too: without
    // a requirement-shaped cue or a lexical capability span, generic body prose
    // should not claim a skill. The description profile also disables weak
    // description-sourced identity-like buckets such as collar_kind.
    expect(new Set(matches.map((m) => m.bucket))).toEqual(new Set(['location']));
    expect(matches.every((m) => m.bucket !== 'occupation')).toBe(true);
    expect(matches.every((m) => m.evidenceSignal === 'description')).toBe(true);
    expect(Array.isArray(salaryRanges)).toBe(true);
    expect(salaryRanges[0]?.currency).toBe('RON');
  });

  it('returns empty for blank text', async () => {
    expect(await analyzeJobListing('  ', { runtime })).toEqual({ matches: [], salaryRanges: [] });
  });

  it('narrows the OS cross product to the requested buckets when `buckets` is passed', async () => {
    // Binary-backed finite buckets stay empty unless the exact alias appears in the body.
    const { matches } = await analyzeJobListing('Backend engineer with strong analytical skills.', {
      runtime,
      buckets: ['compensation', 'benefits'],
    });
    expect(matches).toEqual([]);
  });

  it('excludes occupation from the OS cross product even if explicitly requested in `buckets`', async () => {
    const { matches } = await analyzeJobListing('Backend engineer with strong analytical skills.', {
      runtime,
      buckets: ['occupation', 'level'],
    });
    expect(matches).toEqual([]);
  });

  it('still runs the gazetteer path when `location` is explicitly requested in `buckets`', async () => {
    const { matches } = await analyzeJobListing('We are hiring near Paris office sometimes.', {
      runtime,
      buckets: ['location'],
    });
    expect(matches).toEqual([expect.objectContaining({ bucket: 'location', evidenceSignal: 'description' })]);
  });

  it('does not let generic responsibility prose claim capabilities without a requirement cue', async () => {
    const { matches } = await analyzeJobListing('The Sales Engineer will work closely with the sales team.', {
      runtime,
      buckets: ['capabilities'],
    });
    expect(matches).toEqual([]);
  });

  it('still allows capability extraction from requirement-shaped prose', async () => {
    const { matches } = await analyzeJobListing('Strong SQL and Python skills required.', {
      runtime,
      buckets: ['capabilities'],
    });
    expect(matches.map((m) => m.bucket)).toEqual(['capabilities']);
  });

  it('drops section-header clauses before unstructured matching', async () => {
    const { matches } = await analyzeJobListing('Responsibilities. QUALIFIED CANDIDATES.', {
      runtime,
      buckets: ['capabilities', 'qualifications', 'level'],
    });
    expect(matches).toEqual([]);
  });

  it('routes Romanian requirement sections into capability extraction', async () => {
    const { matches } = await analyzeJobListing('Cerințe:\nPython\nSQL', {
      runtime,
      locale: 'ro',
      buckets: ['capabilities'],
    });
    expect(new Set(matches.map((m) => m.bucket))).toEqual(new Set(['capabilities']));
    expect(matches).toEqual([expect.objectContaining({ bucket: 'capabilities', matchedAlias: 'python' })]);
  });

  it('blocks capability extraction from Romanian responsibility sections', async () => {
    const { matches } = await analyzeJobListing(
      'Responsabilități:\nLucrezi îndeaproape cu echipa de vânzări.\nPython',
      {
        runtime,
        locale: 'ro',
        buckets: ['capabilities'],
      },
    );
    expect(matches).toEqual([]);
  });

  it('keeps benefits inside Hungarian offer sections and out of task sections', async () => {
    const { taskMatches } = await analyzeJobListing('Feladatok:\nMobiltelefon', {
      runtime,
      locale: 'hu',
      buckets: ['benefits'],
    }).then((result) => ({ taskMatches: result.matches }));
    expect(taskMatches).toEqual([]);

    const { matches } = await analyzeJobListing('Amit kínálunk:\nMobiltelefon', {
      runtime,
      locale: 'hu',
      buckets: ['benefits'],
    });
    expect(matches).toEqual([expect.objectContaining({ bucket: 'benefits', canonicalKey: 'benefits:phone_provided' })]);
  });

  it('keeps Estonian qualifications inside requirement sections', async () => {
    const { matches } = await analyzeJobListing('Nõuded:\nbakalaureusekraad', {
      runtime,
      locale: 'et',
      buckets: ['qualifications'],
    });
    expect(matches).toEqual([
      expect.objectContaining({
        bucket: 'qualifications',
        canonicalKey: 'qualification:education_requirement:1c_degree',
      }),
    ]);
  });
});

describe('deriveLocation: cross-country structured field → workplace:abroad', () => {
  // A small synthetic country/place map (opaque to any real locale), behaving like the
  // real resolver: `country` gates by filtering out mentions whose languageCode differs
  // (see resolver.ts `resolve()`), so a structured field naming a foreign place resolves
  // to nothing on the filtered (location) call but is still visible on the unfiltered
  // (abroad-check) call.
  function fakeCountryGazetteer() {
    const places: Record<string, string> = { cluj: 'ro', paris: 'fr', london: 'gb' };
    return {
      resolve: (clauses: { text: string }[], structured?: string, country?: string) => {
        const text = (structured ?? clauses.map((c) => c.text).join(' ')).toLowerCase().trim();
        const cc = places[text];
        if (!cc) return [];
        if (country && cc !== country) return [];
        return [
          {
            canonicalKey: `location:${text}`,
            displayName: text,
            termType: 'city',
            languageCode: cc,
            score: 0.95,
            method: 'gazetteer',
            evidence: [{ clause: text, method: 'gazetteer', score: 0.95 }],
          },
        ];
      },
    } as any;
  }
  const countryRuntime = (): Runtime => ({
    client: fakeClient,
    lexical: async () => finiteLexical,
    gazetteer: async () => fakeCountryGazetteer(),
    displayTitles: async () => undefined,
    collar: async () => undefined,
    capabilities: async () => undefined,
  });

  it('emits workplace:abroad (not location) when the structured field resolves only to a foreign country', async () => {
    const matches = await derive('Paris', { runtime: countryRuntime(), bucket: 'location', countryCode: 'ro' });
    expect(matches).toEqual([
      expect.objectContaining({ canonicalKey: 'location:paris', bucket: 'location', sourceText: 'Paris' }),
      expect.objectContaining({ canonicalKey: 'workplace:abroad', bucket: 'workplace', sourceText: 'Paris' }),
    ]);
  });

  it("emits no abroad signal when the structured field resolves to the listing's own country", async () => {
    const matches = await derive('Cluj', { runtime: countryRuntime(), bucket: 'location', countryCode: 'ro' });
    expect(matches).toEqual([expect.objectContaining({ canonicalKey: 'location:cluj', bucket: 'location' })]);
  });

  it('emits nothing for a field the gazetteer cannot resolve at all', async () => {
    const matches = await derive('Nowhereville', { runtime: countryRuntime(), bucket: 'location', countryCode: 'ro' });
    expect(matches).toEqual([]);
  });

  it('applies the same behavior via deriveMany, and does not affect analyzeJobListing (unstructured) bodies', async () => {
    const many = await deriveMany([{ bucket: 'location', input: 'London', countryCode: 'ro' }], {
      runtime: countryRuntime(),
    });
    expect(many).toEqual([
      expect.objectContaining({ canonicalKey: 'location:london', bucket: 'location', sourceText: 'London' }),
      expect.objectContaining({ canonicalKey: 'workplace:abroad', bucket: 'workplace', sourceText: 'London' }),
    ]);

    // Free-text body mentioning a foreign place is NOT a structured field — no cross-check.
    const { matches } = await analyzeJobListing('We are hiring, based near Paris office sometimes.', {
      runtime: countryRuntime(),
      countryCode: 'ro',
    });
    expect(matches.some((m) => m.canonicalKey === 'workplace:abroad')).toBe(false);
  });
});

describe('explicitBuckets', () => {
  it('groups + dedupes per bucket, highest confidence wins', () => {
    const grouped = explicitBuckets([
      match({ canonicalKey: 'occupation:dev', bucket: 'occupation', confidence: 0.5 }),
      match({ canonicalKey: 'occupation:dev', bucket: 'occupation', confidence: 1 }),
      match({ canonicalKey: 'level:senior', bucket: 'level' }),
    ]);
    expect(grouped.occupation).toEqual(['occupation:dev']);
    expect(grouped.level).toEqual(['level:senior']);
    expect(grouped.capabilities).toEqual([]);
  });
});
