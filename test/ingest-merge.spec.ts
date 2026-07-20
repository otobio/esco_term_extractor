import { describe, expect, it } from 'vitest';
import type { CanonicalMatch, SearchBucket } from '../src/ingest/index.ts';
import { defaultTierOf, type MergePolicy, mergeSignals } from '../src/ingest/merge.ts';

type Signal = 'structured' | 'title' | 'description';

function m(bucket: SearchBucket, key: string, signal: Signal, confidence = 1): CanonicalMatch {
  return {
    canonicalKey: key,
    bucket,
    termType: 'canonical',
    matchedAlias: key,
    sourceText: key,
    evidenceSignal: signal,
    evidenceMatchText: key,
    itemIndex: 0,
    propositionIndex: 0,
    confidence,
    source: 'derived',
    isConditional: false,
    isPreferred: false,
    isOffered: false,
    structuralTrust: 1,
    legitimacyScore: 1,
  };
}

const keys = (matches: CanonicalMatch[], bucket: SearchBucket): string[] =>
  matches
    .filter((x) => x.bucket === bucket)
    .map((x) => x.canonicalKey)
    .sort();

describe('defaultTierOf', () => {
  it('maps evidence signals to precedence tiers', () => {
    expect(defaultTierOf(m('occupation', 'a', 'structured'))).toBe('structured');
    expect(defaultTierOf(m('occupation', 'a', 'title'))).toBe('profile');
    expect(defaultTierOf(m('occupation', 'a', 'description'))).toBe('unstructured');
  });
});

describe('mergeSignals — trusted tiers win claimed buckets', () => {
  it('drops an unstructured match when a profile match claims the same bucket', () => {
    const merged = mergeSignals([
      m('occupation', 'occupation:public_relations_manager', 'title'),
      m('occupation', 'occupation:head_chef', 'description'),
    ]);
    expect(keys(merged, 'occupation')).toEqual(['occupation:public_relations_manager']);
  });

  it('drops an unstructured match when a structured match claims the same bucket', () => {
    const merged = mergeSignals([
      m('location', 'location:depth1:lagos', 'structured'),
      m('location', 'location:depth1:abuja', 'description'),
    ]);
    expect(keys(merged, 'location')).toEqual(['location:depth1:lagos']);
  });

  it('lets structured and profile coexist in a bucket, deduped by key', () => {
    const merged = mergeSignals([
      m('location', 'location:depth1:adamawa', 'structured'),
      m('location', 'location:depth2:numan_adamawa', 'title'),
      m('location', 'location:depth1:adamawa', 'title'), // duplicate key across tiers
    ]);
    expect(keys(merged, 'location')).toEqual(['location:depth1:adamawa', 'location:depth2:numan_adamawa']);
  });
});

describe('mergeSignals — trusted tiers keep low-confidence signals', () => {
  it('admits an ambiguous (0.5) title occupation that a flat 0.75 gate would drop', () => {
    const merged = mergeSignals([m('occupation', 'occupation:video_artist', 'title', 0.5)]);
    expect(keys(merged, 'occupation')).toEqual(['occupation:video_artist']);
  });

  it('admits ambiguous (0.5) structured locations (sibling sub-areas)', () => {
    const merged = mergeSignals([
      m('location', 'location:depth2:ibadan_north_oyo', 'structured', 0.5),
      m('location', 'location:depth2:ibadan_north_east_oyo', 'structured', 0.5),
    ]);
    expect(keys(merged, 'location')).toEqual([
      'location:depth2:ibadan_north_east_oyo',
      'location:depth2:ibadan_north_oyo',
    ]);
  });
});

describe('mergeSignals — unstructured is heavily gated', () => {
  it('bars the unstructured tier from identity buckets even when nothing else claims them', () => {
    const merged = mergeSignals([
      m('occupation', 'occupation:head_chef', 'description', 1),
      m('level', 'level:executive', 'description', 1),
      m('location', 'location:depth1:lagos', 'description', 1),
    ]);
    expect(merged).toEqual([]);
  });

  it('fills a non-identity bucket from the body when no trusted tier claims it', () => {
    const merged = mergeSignals([m('capabilities', 'capability:skill:write_captions', 'description', 1)]);
    expect(keys(merged, 'capabilities')).toEqual(['capability:skill:write_captions']);
  });

  it('drops body matches below the unstructured confidence floor', () => {
    const merged = mergeSignals([m('capabilities', 'capability:skill:write_captions', 'description', 0.5)]);
    expect(merged).toEqual([]);
  });

  it('caps the number of body keys per bucket, keeping the highest confidence', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      m('capabilities', `capability:skill:s${i}`, 'description', 0.75 + i / 100),
    );
    const merged = mergeSignals(many, { maxPerBucket: { unstructured: 3 } });
    expect(keys(merged, 'capabilities')).toEqual([
      'capability:skill:s17',
      'capability:skill:s18',
      'capability:skill:s19',
    ]);
  });
});

describe('mergeSignals — dedupe keeps the top-ranked instance', () => {
  it('keeps the structured instance over a profile instance of the same key', () => {
    const merged = mergeSignals([
      m('level', 'level:senior', 'title', 1),
      m('level', 'level:senior', 'structured', 0.5),
    ]);
    const kept = merged.find((x) => x.bucket === 'level');
    expect(kept?.evidenceSignal).toBe('structured');
  });
});

describe('mergeSignals — policy overrides', () => {
  it('honors a custom tier classifier', () => {
    const policy: MergePolicy = {
      tierOf: (match) => (match.source === 'lexical' ? 'structured' : 'unstructured'),
    };
    const merged = mergeSignals(
      [
        { ...m('occupation', 'occupation:x', 'description'), source: 'lexical' },
        m('occupation', 'occupation:y', 'description'),
      ],
      policy,
    );
    // 'x' is reclassified structured (claims the bucket); 'y' stays unstructured and is dropped.
    expect(keys(merged, 'occupation')).toEqual(['occupation:x']);
  });

  it('can widen the unstructured bucket allowlist to include identity buckets', () => {
    const merged = mergeSignals([m('occupation', 'occupation:z', 'description', 1)], {
      allowedBuckets: { unstructured: new Set<SearchBucket>(['occupation']) },
    });
    expect(keys(merged, 'occupation')).toEqual(['occupation:z']);
  });
});
