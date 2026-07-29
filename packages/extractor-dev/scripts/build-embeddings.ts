/**
 * Build the offline index from a dictionary snapshot:
 *   - vectors.bin / index.meta.json : one L2-normalized embedding per canonical
 *                                     term (display name), grouped by bucket+lang.
 *   - lexical.lxb                   : exact normalized-alias -> term map (packed binary).
 *
 * Usage:
 *   tsx scripts/build-embeddings.ts \
 *     [--dict data/dictionary.jsonl] [--data-dir data] \
 *     [--languages en,global] [--buckets occupation,capabilities] \
 *     [--alias-embed] [--alias-cap 8] [--limit N] [--model Xenova/all-MiniLM-L6-v2]
 *
 * --alias-embed adds one extra embedding per alias (capped by --alias-cap),
 * trading build time / size for higher semantic recall on surface variants.
 */
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isUsableTerm, loadDictionary } from '../../../src/dictionary.ts';
import { LexicalIndex } from '../../../src/lexical-index.ts';
import type { DictionaryTerm } from '../../../src/types.ts';
import { VectorStore } from '../../../src/vector-store.ts';
import { EMBEDDING_DIM, Embedder } from '../src/embedder.ts';

const { values } = parseArgs({
  options: {
    dict: { type: 'string', default: 'data/dictionary.jsonl' },
    'data-dir': { type: 'string', default: 'data' },
    languages: { type: 'string' },
    buckets: { type: 'string' },
    // Location is served by the gazetteer, so its ~21k vectors are excluded from
    // the dense index by default (pass --exclude-buckets '' to keep them).
    'exclude-buckets': { type: 'string', default: 'location' },
    'alias-embed': { type: 'boolean', default: false },
    // Alias-embed only these buckets (comma list). Restricts the extra alias
    // vectors to the open semantic buckets that benefit, keeping the index lean and
    // controlled/lexical/inferred buckets' precision untouched. Empty = obey the
    // global --alias-embed flag for every bucket.
    'alias-embed-buckets': { type: 'string', default: '' },
    'alias-cap': { type: 'string', default: '8' },
    limit: { type: 'string' },
    model: { type: 'string', default: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
    batch: { type: 'string', default: '128' },
    // fp32 keeps build inference fast; runtime queries default to fp16 (identical
    // vectors, faster load) — see src/embedder.ts.
    dtype: { type: 'string', default: 'fp32' },
  },
});

const dictPath = resolve(values.dict!);
const dataDir = resolve(values['data-dir']!);
const langFilter = values.languages
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const bucketFilter = values.buckets
  ?.split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const excludeBuckets = new Set(
  values['exclude-buckets']
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const aliasEmbed = values['alias-embed']!;
const aliasEmbedBuckets = new Set(
  values['alias-embed-buckets']
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
const aliasCap = Number(values['alias-cap']);
/** Whether a term's aliases should be embedded: global flag, or bucket opt-in. */
const shouldAliasEmbed = (bucket: string) => aliasEmbed || aliasEmbedBuckets.has(bucket);
const limit = values.limit ? Number(values.limit) : undefined;

async function main() {
  console.log(`Loading dictionary ${dictPath}`);
  let terms = await loadDictionary(dictPath);
  const beforeSanitize = terms.length;
  terms = terms.filter(isUsableTerm);
  // Split the company_stage sub-type into its own `company_size` bucket.
  terms = terms.map((t) =>
    (t.bucket as string) === 'company_type' && t.termType === 'company_stage'
      ? {
          ...t,
          canonicalKey: t.canonicalKey.replace(/^company_type:/, 'company_size:'),
          bucket: 'company_size' as const,
        }
      : t,
  );
  terms = terms.filter((t) => (t.bucket as string) !== 'company_type');
  const removed = beforeSanitize - terms.length;
  if (langFilter?.length) terms = terms.filter((t) => langFilter.includes(t.languageCode));
  if (bucketFilter?.length) terms = terms.filter((t) => bucketFilter.includes(t.bucket));
  if (excludeBuckets.size) terms = terms.filter((t) => !excludeBuckets.has(t.bucket));
  if (limit) terms = terms.slice(0, limit);
  console.log(
    `  ${terms.length} terms after filtering (removed ${removed} unusable or legacy terms; excluded buckets: ${[...excludeBuckets].join(',') || 'none'})`,
  );

  // Lexical index always covers the full (filtered) alias surface.
  console.log('Building lexical index...');
  await LexicalIndex.build(dataDir, terms);

  // Build the (text -> term) list for embedding.
  const texts: string[] = [];
  const owners: DictionaryTerm[] = [];
  for (const t of terms) {
    texts.push(t.displayName);
    owners.push(t);
    if (shouldAliasEmbed(t.bucket)) {
      for (const alias of dedupeAliases(t)) {
        texts.push(alias);
        owners.push(t);
      }
    }
  }
  const aliasScope = aliasEmbed ? 'all buckets' : aliasEmbedBuckets.size ? [...aliasEmbedBuckets].join(',') : 'none';
  console.log(
    `Embedding ${texts.length} vectors (${terms.length} display names + aliases for: ${aliasScope}, cap ${aliasCap}) with ${values.model}...`,
  );

  const embedder = new Embedder({
    model: values.model,
    batchSize: Number(values.batch),
    dtype: values.dtype as 'fp32' | 'fp16' | 'q8',
  });
  const t0 = Date.now();
  const vectors = await embedder.embed(texts, (done, total) => {
    if (done % 2000 === 0 || done === total) {
      const rate = done / ((Date.now() - t0) / 1000 || 1);
      process.stdout.write(`\r  ${done}/${total} (${rate.toFixed(0)}/s)`);
    }
  });
  process.stdout.write('\n');

  const entries = owners.map((term, i) => ({ term, vector: vectors[i] }));
  console.log(`Writing vector store (${entries.length} x ${EMBEDDING_DIM}) to ${dataDir}`);
  await VectorStore.save(dataDir, values.model!, EMBEDDING_DIM, entries);
  console.log('Done.');
}

function dedupeAliases(t: DictionaryTerm): string[] {
  const seen = new Set<string>([t.displayName.toLowerCase()]);
  const out: string[] = [];
  for (const a of t.aliases) {
    const key = a.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= aliasCap) break;
  }
  return out;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
