import assert from 'node:assert/strict';
import { test } from 'node:test';
import { annotateChunkCandidateStats, aggregateChunkFacts, discoverRawTitleChunkFacts } from '../../enrichment/title-chunk-discovery.js';

test('raw title chunk discovery keeps slash-separated role spans independent and marks boundaries', async () => {
  const facts = await discoverRawTitleChunkFacts(
    [
      {
        rowIndex: 1,
        title: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD'
      }
    ],
    { locale: 'ro', maxChunkTokens: 4 }
  );

  const commercialChunk = facts.find((fact) => fact.chunk_normalized_surface === 'lucrator comercial');
  const helperChunk = facts.find((fact) => fact.chunk_normalized_surface === 'ajutor bucatar fast food');
  const crossSlashChunk = facts.find((fact) => fact.chunk_normalized_surface.includes('lucrator comercial ajutor'));

  assert.ok(commercialChunk);
  assert.ok(helperChunk);
  assert.equal(commercialChunk?.position_bucket, 'full');
  assert.equal(helperChunk?.position_bucket, 'full');
  assert.equal(crossSlashChunk, undefined);
});

test('raw title chunk annotations mark exact coverage from common-role and family-alias seeds after preprocessing', async () => {
  const facts = await discoverRawTitleChunkFacts(
    [
      { rowIndex: 1, title: 'Lucrator comercial' },
      { rowIndex: 2, title: 'Lucrator depozit' },
      { rowIndex: 3, title: 'Salariu motivant' }
    ],
    { locale: 'ro', maxChunkTokens: 3 }
  );
  const stats = aggregateChunkFacts(facts);
  const annotations = annotateChunkCandidateStats(stats, { locale: 'ro' });

  const commonRole = annotations.find((row) => row.chunk_normalized_surface === 'lucrator comercial');
  const familyAlias = annotations.find((row) => row.chunk_normalized_surface === 'lucrator depozit');
  const noise = annotations.find((row) => row.chunk_normalized_surface === 'salariu motivant');

  assert.equal(commonRole?.known_common_role_match, true);
  assert.equal(commonRole?.already_covered_flag, true);
  assert.equal(commonRole?.review_bucket, 'covered_skip');

  assert.equal(familyAlias?.known_family_alias_match, true);
  assert.equal(familyAlias?.coverage_skip_reason, 'known_family_alias_exact');

  assert.equal(noise, undefined);
});

test('raw title chunk aggregation computes title_df as a unique-title ratio, not a raw count', async () => {
  const facts = await discoverRawTitleChunkFacts(
    [
      { rowIndex: 1, title: 'Software Engineer' },
      { rowIndex: 2, title: 'Software Engineer' },
      { rowIndex: 3, title: 'Senior Software Engineer' },
      { rowIndex: 4, title: 'Accountant' }
    ],
    { locale: 'ro', maxChunkTokens: 3 }
  );
  const stats = aggregateChunkFacts(facts);
  const softwareEngineer = stats.find((row) => row.chunk_normalized_surface === 'software engineer');

  assert.equal(softwareEngineer?.occurrence_count, 3);
  assert.equal(softwareEngineer?.unique_title_count, 2);
  assert.equal(softwareEngineer?.title_df, 0.666667);
});

test('raw title chunk discovery peels bracketed delimited markers before discovery chunking', async () => {
  const facts = await discoverRawTitleChunkFacts([{ rowIndex: 1, title: 'KFZ-Lackierer (m/w/d)' }], { locale: 'hu', maxChunkTokens: 5 });

  const groupedMarker = facts.find((fact) => fact.chunk_normalized_surface === 'm/w/d');
  const lackierer = facts.find((fact) => fact.chunk_normalized_surface === 'lackierer');

  assert.equal(groupedMarker, undefined);
  assert.ok(lackierer);
  assert.equal(lackierer?.position_bucket, 'full');
});
