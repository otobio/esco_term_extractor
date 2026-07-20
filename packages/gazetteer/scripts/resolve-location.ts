#!/usr/bin/env tsx
import { join } from 'node:path';
/**
 * Location resolver CLI — exercise the GazetteerResolver directly, without the
 * title/extract pipeline, for fast iteration on gazetteer fixes.
 *
 * Single shot:
 *   npm run resolve:location -- "Adamawa"                 # free text, no locale gate
 *   npm run resolve:location -- "Adamawa" --locale ng     # gated to a country
 *   npm run resolve:location -- "Cluj, jud. Cluj" --structured --locale ro
 *   npm run resolve:location -- "delta and plateau" --locale ng --debug
 *
 * Interactive:
 *   npm run resolve:location -- repl --locale ng
 *     > Adamawa
 *     > delta
 *
 * Flags:
 *   --locale <code>   country gate (ro|hu|et|ng|…); omit = ungated (dense path)
 *   --structured      route input through the structured-location field path
 *                     (fuzzy ON, score 0.99) instead of free text
 *   --debug           show gazetteer gating flags (leaf/major/seat/parents) for
 *                     every exact surface hit — the "why it resolved" view
 */
import { createInterface } from 'node:readline';
import {
  DATA_DIR,
  GAZETTEER_CONFIG,
  GazetteerBin,
  type GazetteerReader,
  GazetteerResolver,
  splitClauses,
} from '../src/index.ts';

import { normalizeText, words } from '../src/normalize.ts';

const useColor = process.stdout.isTTY;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c('1', s);
const dim = (s: string) => c('2', s);
const cyan = (s: string) => c('36', s);
const green = (s: string) => c('32', s);
const _yellow = (s: string) => c('33', s);
const red = (s: string) => c('31', s);

function takeFlag(args: string[], flag: string): { value?: string; rest: string[] } {
  const i = args.indexOf(flag);
  if (i === -1) return { rest: args };
  return { value: args[i + 1], rest: [...args.slice(0, i), ...args.slice(i + 2)] };
}
function takeBool(args: string[], flag: string): { present: boolean; rest: string[] } {
  const i = args.indexOf(flag);
  if (i === -1) return { present: false, rest: args };
  return { present: true, rest: [...args.slice(0, i), ...args.slice(i + 1)] };
}

const MAX_NGRAM = 5;

/** Debug: every exact surface hit in the input + the gating flags that decide trust. */
function debugView(gaz: GazetteerReader, text: string, locale?: string): void {
  const toks = words(normalizeText(text));
  console.log(dim(`  tokens: [${toks.join(' · ')}]`));
  const seen = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    for (let n = Math.min(MAX_NGRAM, toks.length - i); n >= 1; n--) {
      const span = toks.slice(i, i + n).join(' ');
      const idxs = gaz.exact(span);
      if (!idxs.length) continue;
      for (const idx of idxs) {
        const p = gaz.place(idx);
        const tag = `${span}»${p.canonicalKey}`;
        if (seen.has(tag)) continue;
        seen.add(tag);
        const gated = locale && p.languageCode !== locale;
        const flags = [
          gaz.isLeaf(idx) ? dim('leaf') : green('container'),
          gaz.isMajor(idx) ? green('major') : dim('·'),
        ];
        const parents = gaz
          .parentsOf(idx)
          .map((pi) => gaz.place(pi).canonicalKey.split(':').pop())
          .join('>');
        console.log(
          `  ${gated ? red('gated') : green('  ok ')} "${span}"  →  ${p.displayName}  ` +
            dim(`[${p.languageCode} d${p.depth}]`) +
            `  ${flags.join(' ')}  ${dim(`^${parents || '—'}`)}`,
        );
      }
    }
  }
}

function resolveOne(
  resolver: GazetteerResolver,
  gaz: GazetteerReader,
  input: string,
  locale?: string,
  structured?: boolean,
  debug?: boolean,
): void {
  const clauses = structured ? [] : splitClauses(input, 'text');
  const terms = resolver.resolve(clauses, structured ? input : undefined, locale);

  console.log('');
  console.log(
    `${bold(cyan('location'))} ${dim(`(${terms.length})`)} ${dim(`"${input}"${locale ? ` [${locale}]` : ''}${structured ? ' {structured}' : ''}`)}`,
  );
  if (debug) debugView(gaz, input, locale);
  if (!terms.length) {
    console.log(red('  => UNRESOLVED'));
    return;
  }
  for (const t of terms) {
    const ev = t.evidence?.map((e) => e.clause).join(', ') ?? '';
    console.log(
      `  ${green(t.score.toFixed(3).padStart(6))} ${t.displayName}  ` +
        dim(`${t.canonicalKey} [${t.languageCode} ${t.termType}]`) +
        `  ${cyan('◂')} ${dim(ev)}`,
    );
  }
}

async function main(): Promise<void> {
  let args = process.argv.slice(2);
  const locale = takeFlag(args, '--locale');
  args = locale.rest;
  const structured = takeBool(args, '--structured');
  args = structured.rest;
  const debug = takeBool(args, '--debug');
  args = debug.rest;

  const gaz = await GazetteerBin.load(join(DATA_DIR, 'gazetteer.gzb'));
  const stopNames = new Set<string>([...GAZETTEER_CONFIG.stopNames, ...gaz.stopSurfaces()]);
  const resolver = new GazetteerResolver(gaz, { ...GAZETTEER_CONFIG, stopNames });
  console.log(dim(`gazetteer(bin): ${gaz.size} places loaded`));

  if (args[0] !== 'repl' && args.length) {
    resolveOne(resolver, gaz, args.join(' '), locale.value, structured.present, debug.present);
    return;
  }

  console.log(
    bold('\nlocation resolver REPL') +
      dim(
        `  locale=${locale.value ?? '(none)'}${structured.present ? ' structured' : ''}${debug.present ? ' debug' : ''}. Ctrl-C to exit.`,
      ),
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  for await (const line of rl) {
    const q = line.trim();
    if (q) {
      try {
        resolveOne(resolver, gaz, q, locale.value, structured.present, debug.present);
      } catch (err) {
        console.error(err);
      }
    }
    rl.prompt();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
