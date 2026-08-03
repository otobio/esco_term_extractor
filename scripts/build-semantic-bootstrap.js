import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUTPUT_DIR = path.join(process.cwd(), 'artifacts', 'runtime');

const BOOTSTRAP = [
  {
    locale: 'ro',
    headRule: 'rightmost',
    thresholds: {
      tokenHelpMinOccupationSignal: 0.65,
      tokenHelpMaxPenaltySignal: 0.35,
      tokenHurtMinPenaltySignal: 0.75,
      tokenHurtMaxOccupationSignal: 0.25,
      tokenNeutralNetBand: 0.15,
      phraseHelpMinOccupationSignal: 0.72,
      phraseHelpMaxPenaltySignal: 0.28,
      phraseHurtMinPenaltySignal: 0.68,
      phraseHurtMaxOccupationSignal: 0.25,
      phraseNeutralNetBand: 0.15
    },
    tokens: [
      ['inginer', 'role_head', 0.96, 0.02, 'core occupational head from RO titles'],
      ['tehnician', 'role_head', 0.95, 0.02, 'common RO role head'],
      ['specialist', 'role_head', 0.92, 0.03, 'common RO role head'],
      ['manager', 'role_head', 0.9, 0.05, 'broad but strong role head'],
      ['operator', 'role_head', 0.9, 0.04, 'frequent occupational head'],
      ['consultant', 'role_head', 0.88, 0.05, 'role head in advisory titles'],
      ['reprezentant', 'role_head', 0.84, 0.06, 'sales / service representative head'],
      ['agent', 'role_head', 0.82, 0.06, 'representative head'],
      ['asistent', 'role_head', 0.8, 0.06, 'supportive role head'],
      ['coordonator', 'role_head', 0.8, 0.07, 'coordination head'],
      ['director', 'role_head', 0.78, 0.08, 'leadership head'],
      ['contabil', 'role_head', 0.88, 0.04, 'finance head'],
      ['mecanic', 'role_head', 0.9, 0.04, 'manual technical head'],
      ['electrician', 'role_head', 0.9, 0.04, 'manual technical head'],
      ['electricieni', 'role_head', 0.9, 0.04, 'manual technical head'],
      ['instalator', 'role_head', 0.88, 0.05, 'manual technical head'],
      ['sofer', 'role_head', 0.88, 0.04, 'driving head'],
      ['vanzator', 'role_head', 0.9, 0.04, 'retail head'],
      ['lucrator', 'role_head', 0.78, 0.08, 'broad worker head'],
      ['analist', 'role_head', 0.84, 0.05, 'analysis head'],
      ['expert', 'role_head', 0.78, 0.08, 'professional head'],
      ['inspector', 'role_head', 0.76, 0.08, 'inspection head'],
      ['sef', 'role_head', 0.76, 0.09, 'leadership head'],
      ['responsabil', 'role_head', 0.72, 0.1, 'often lead-like but broad'],
      ['livrator', 'role_head', 0.9, 0.04, 'delivery role head'],
      ['manipulant', 'role_head', 0.88, 0.05, 'warehouse handling role head'],
      ['jurist', 'role_head', 0.9, 0.03, 'legal role head'],
      ['electromecanic', 'role_head', 0.9, 0.04, 'technical role head'],
      ['electromecanici', 'role_head', 0.88, 0.04, 'technical role head'],
      ['colector', 'role_head', 0.86, 0.05, 'collections role head'],
      ['vopsitor', 'role_head', 0.88, 0.04, 'painting role head'],
      ['stivuitorist', 'role_head', 0.88, 0.04, 'forklift role head'],
      ['educator', 'role_head', 0.86, 0.04, 'education role head'],
      ['puericultor', 'role_head', 0.86, 0.04, 'childcare role head'],
      ['coordinator', 'role_head', 0.84, 0.05, 'coordination head'],
      ['instructor', 'role_head', 0.84, 0.05, 'instruction head'],
      ['antrenor', 'role_head', 0.84, 0.05, 'coach head'],
      ['representative', 'role_head', 0.82, 0.06, 'representation head'],
      ['enginer', 'role_head', 0.82, 0.05, 'common spelling variant for engineer'],
      ['ofertare', 'domain_modifier', 0.7, 0.12, 'procurement/sales context'],
      ['vanzari', 'domain_modifier', 0.78, 0.08, 'sales context'],
      ['creante', 'domain_modifier', 0.68, 0.11, 'collections context'],
      ['debite', 'domain_modifier', 0.68, 0.11, 'collections context'],
      ['industriali', 'domain_modifier', 0.62, 0.14, 'industrial context'],
      ['industrial', 'domain_modifier', 0.62, 0.14, 'industrial context'],
      ['quality', 'domain_modifier', 0.6, 0.16, 'quality context'],
      ['planning', 'domain_modifier', 0.58, 0.16, 'planning context'],
      ['sales representative', 'role_phrase', 0.9, 0.05, 'role phrase'],
      ['quality planning engineer', 'role_phrase', 0.88, 0.05, 'role phrase'],
      ['depozit', 'domain_modifier', 0.62, 0.12, 'warehouse context'],
      ['constructii', 'domain_modifier', 0.7, 0.08, 'construction context'],
      ['mentenanta', 'domain_modifier', 0.68, 0.1, 'maintenance context'],
      ['utilaje', 'domain_modifier', 0.64, 0.12, 'equipment context'],
      ['aprovizionare', 'domain_modifier', 0.66, 0.12, 'procurement / supply context'],
      ['logistica', 'domain_modifier', 0.72, 0.1, 'logistics context'],
      ['personal', 'generic_noise', 0.06, 0.9, 'personnel-style generic noise'],
      ['serviciu', 'generic_noise', 0.06, 0.88, 'service-style generic noise'],
      ['servicii', 'generic_noise', 0.06, 0.88, 'service-style generic noise'],
      ['general', 'generic_noise', 0.05, 0.85, 'broad generic noise'],
      ['generale', 'generic_noise', 0.05, 0.85, 'broad generic noise'],
      ['profesional', 'generic_noise', 0.08, 0.82, 'broad generic noise'],
      ['suport', 'generic_noise', 0.08, 0.8, 'support-style generic noise']
    ],
    phrases: [
      ['inginer ofertare', 'role_phrase', 0.97, 0.01, 'clear title phrase'],
      ['tehnician service', 'role_phrase', 0.96, 0.02, 'clear title phrase'],
      ['reprezentant vanzari', 'role_phrase', 0.95, 0.02, 'clear title phrase'],
      ['consilier vanzari', 'role_phrase', 0.95, 0.02, 'clear title phrase'],
      ['sef tura', 'role_phrase', 0.94, 0.02, 'clear title phrase'],
      ['lucrator comercial', 'role_phrase', 0.94, 0.02, 'clear title phrase'],
      ['specialist aprovizionare', 'role_phrase', 0.94, 0.02, 'clear title phrase'],
      ['operator cnc', 'role_phrase', 0.94, 0.02, 'clear title phrase'],
      ['agent de vanzari', 'role_phrase', 0.94, 0.03, 'clear title phrase'],
      ['manager de proiect', 'role_phrase', 0.92, 0.03, 'common project title'],
      ['tehnician mentenanta', 'role_phrase', 0.93, 0.03, 'clear title phrase'],
      ['lucrator depozit', 'role_phrase', 0.92, 0.03, 'warehouse title phrase'],
      ['responsabil de tura', 'role_phrase', 0.88, 0.05, 'shift-role phrase'],
      ['asistent manager', 'role_phrase', 0.88, 0.05, 'support role phrase'],
      ['sofer distributie', 'role_phrase', 0.9, 0.03, 'driving role phrase'],
      ['electrician intretinere', 'role_phrase', 0.92, 0.03, 'maintenance title phrase']
    ]
  },
  {
    locale: 'hu',
    headRule: 'locale_specific',
    thresholds: {
      tokenHelpMinOccupationSignal: 0.65,
      tokenHelpMaxPenaltySignal: 0.35,
      tokenHurtMinPenaltySignal: 0.75,
      tokenHurtMaxOccupationSignal: 0.25,
      tokenNeutralNetBand: 0.15,
      phraseHelpMinOccupationSignal: 0.72,
      phraseHelpMaxPenaltySignal: 0.28,
      phraseHurtMinPenaltySignal: 0.68,
      phraseHurtMaxOccupationSignal: 0.25,
      phraseNeutralNetBand: 0.15
    },
    tokens: [
      ['elado', 'role_head', 0.94, 0.03, 'core retail head'],
      ['karbantarto', 'role_head', 0.92, 0.03, 'maintenance head'],
      ['mernok', 'role_head', 0.91, 0.03, 'engineering head'],
      ['asszisztens', 'role_head', 0.88, 0.04, 'supportive head'],
      ['ertekesito', 'role_head', 0.9, 0.03, 'sales head'],
      ['penztaros', 'role_head', 0.88, 0.03, 'cashier head'],
      ['vezeto', 'role_head', 0.84, 0.05, 'leadership head'],
      ['tanacsado', 'role_head', 0.86, 0.04, 'advisory head'],
      ['szakerto', 'role_head', 0.84, 0.05, 'expert head'],
      ['technikus', 'role_head', 0.88, 0.04, 'technical head'],
      ['gepkezelo', 'role_head', 0.88, 0.04, 'machine operator head'],
      ['raktaros', 'role_head', 0.88, 0.04, 'warehouse head'],
      ['csoportvezeto', 'role_head', 0.86, 0.04, 'team lead head'],
      ['ugyintezo', 'role_head', 0.82, 0.05, 'administrative role head'],
      ['szerelo', 'role_head', 0.88, 0.04, 'installer / repair head'],
      ['manager', 'role_head', 0.84, 0.05, 'borrowed leadership head'],
      ['diszpecser', 'role_head', 0.8, 0.06, 'dispatcher head'],
      ['takarito', 'role_head', 0.86, 0.04, 'cleaning head'],
      ['sofor', 'role_head', 0.88, 0.04, 'driving head'],
      ['lakatos', 'role_head', 0.84, 0.05, 'metalwork head'],
      ['munkatars', 'role_head', 0.78, 0.08, 'broad staff role'],
      ['uzletvezeto', 'role_head', 0.86, 0.04, 'store leadership head'],
      ['muszakvezeto', 'role_head', 0.86, 0.04, 'shift leadership head'],
      ['targoncavezeto', 'role_head', 0.84, 0.05, 'forklift leadership / driver head'],
      ['specialista', 'role_head', 0.84, 0.05, 'specialist head'],
      ['koordinator', 'role_head', 0.84, 0.05, 'coordinator head'],
      ['projektmenedzser', 'role_head', 0.84, 0.05, 'project leadership head'],
      ['fejleszto', 'role_head', 0.84, 0.05, 'developer head'],
      ['kapcsolattarto', 'role_head', 0.8, 0.06, 'contact / liaison head'],
      ['felszolgalo', 'role_head', 0.84, 0.05, 'service staff head'],
      ['pincer', 'role_head', 0.84, 0.05, 'service staff head'],
      ['futar', 'role_head', 0.84, 0.05, 'courier head'],
      ['pultos', 'role_head', 0.82, 0.05, 'counter staff head'],
      ['adminisztrator', 'role_head', 0.82, 0.06, 'administrative head'],
      ['szerviztechnikus', 'role_head', 0.84, 0.05, 'service technician head'],
      ['munkas', 'role_head', 0.76, 0.08, 'manual worker head'],
      ['dolgozo', 'role_head', 0.74, 0.09, 'worker head'],
      ['muszaki', 'domain_modifier', 0.76, 0.07, 'technical context'],
      ['ertekesitesi', 'domain_modifier', 0.74, 0.08, 'sales context'],
      ['banki', 'domain_modifier', 0.74, 0.08, 'banking context'],
      ['ettermi', 'domain_modifier', 0.7, 0.1, 'restaurant context'],
      ['bolti', 'domain_modifier', 0.72, 0.09, 'retail context'],
      ['penzugyi', 'domain_modifier', 0.72, 0.09, 'finance context'],
      ['logisztikai', 'domain_modifier', 0.7, 0.1, 'logistics context'],
      ['termelesi', 'domain_modifier', 0.72, 0.09, 'production context'],
      ['gyartasi', 'domain_modifier', 0.7, 0.1, 'manufacturing context'],
      ['kereskedelmi', 'domain_modifier', 0.68, 0.1, 'commerce context'],
      ['informatikai', 'domain_modifier', 0.66, 0.11, 'IT context'],
      ['beszerzesi', 'domain_modifier', 0.68, 0.1, 'procurement context']
    ],
    phrases: [
      ['muszaki szaktanacsado', 'role_phrase', 0.96, 0.02, 'clear title phrase'],
      ['ertekesitesi szakerto', 'role_phrase', 0.95, 0.02, 'clear title phrase'],
      ['bolti dolgozo', 'role_phrase', 0.93, 0.03, 'retail title phrase'],
      ['raktari kisegito', 'role_phrase', 0.92, 0.03, 'warehouse helper phrase'],
      ['uzletvezeto helyettes', 'role_phrase', 0.92, 0.03, 'store leadership phrase'],
      ['banki tanacsado', 'role_phrase', 0.93, 0.03, 'banking title phrase'],
      ['termelesi muszakvezeto', 'role_phrase', 0.94, 0.03, 'production shift lead'],
      ['gepkezelo operator', 'role_phrase', 0.93, 0.03, 'machine operator phrase'],
      ['elado penztaros', 'role_phrase', 0.94, 0.02, 'retail title phrase'],
      ['csoportvezeto', 'role_phrase', 0.9, 0.04, 'team lead phrase'],
      ['raktari pakolo', 'role_phrase', 0.9, 0.03, 'warehouse loading phrase'],
      ['muszaki karbantarto', 'role_phrase', 0.92, 0.03, 'maintenance phrase'],
      ['penzugyi adminisztrator', 'role_phrase', 0.92, 0.03, 'finance admin phrase'],
      ['ertekesito munkatars', 'role_phrase', 0.9, 0.03, 'sales staff phrase'],
      ['uzletvezeto helyettes', 'role_phrase', 0.92, 0.03, 'store leadership phrase'],
      ['termelesi muszakvezeto', 'role_phrase', 0.94, 0.03, 'production shift lead'],
      ['ugyfelszolgalati munkatars', 'role_phrase', 0.9, 0.03, 'customer service phrase'],
      ['muszakvezeto', 'role_phrase', 0.9, 0.04, 'shift lead phrase'],
      ['targoncavezeto', 'role_phrase', 0.9, 0.04, 'forklift driver phrase']
    ]
  }
];

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  for (const locale of BOOTSTRAP) {
    const outPath = path.join(OUTPUT_DIR, `semantic-bootstrap.${locale.locale}.json`);
    const payload = {
      schemaVersion: 1,
      locale: locale.locale,
      headRule: locale.headRule,
      thresholds: locale.thresholds,
      tokenRules: locale.tokens.map(([token, kind, occupationSignal, penaltySignal, note]) => ({
        token,
        kind,
        occupationSignal,
        penaltySignal,
        note
      })),
      phraseRules: locale.phrases.map(([phrase, kind, occupationSignal, penaltySignal, note]) => ({
        phrase,
        kind,
        occupationSignal,
        penaltySignal,
        note
      }))
    };

    await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${payload.tokenRules.length} token rules and ${payload.phraseRules.length} phrase rules to ${outPath}`);
  }
}

main().catch((error) => {
  console.error('Semantic bootstrap generation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
