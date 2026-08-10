const lines = [
  'Manual promotion guidance for reviewed job-title proposals',
  '',
  'Operator-only acceptance boundary',
  '  Review aggregated proposal outputs first:',
  '  - data/taxonomy-review/job-title-triage-proposals.<locale>.json',
  '  - data/taxonomy-review/job-title-triage-proposals.<locale>.csv',
  '',
  'Only promote proposals that are repeated, structural, and anti-hack compliant.',
  'Reject one-off title fixes, free-form alias dumps, and domain-only family selectors.',
  '',
  'Current runtime-backed promotion surfaces',
  '  - reviewed_family_signal / reviewed_family_penalty -> src/runtime/seeds/occupation-reviewed-family-signals.json',
  '  - role_head_equivalence -> src/runtime/seeds/occupation-role-head-equivalents.json',
  '',
  'Reviewed query-prep seed candidate surface',
  '  - npm run step_5a_automated_shape_query_prep_seed_candidates -- --input=data/taxonomy-review/job-title-triage-proposals.<locale>.json --out=data/taxonomy-review/job-title-query-prep-seed-proposals.<locale>.json',
  '  - Output is a typed candidate file for:',
  '    common_role_phrase -> src/runtime/seeds/occupation-reviewed-common-role-phrases.json',
  '    family_alias_anchor -> src/runtime/seeds/occupation-reviewed-family-alias-anchors.json',
  '    noise_rule -> src/runtime/seeds/occupation-reviewed-noise-rules.json',
  '',
  'Current manual acceptance boundary',
  '  - common_role_phrase',
  '  - family_alias_anchor',
  '  - noise_rule',
  '  The new candidate file reduces re-authoring, but accepted entries still require deliberate manual promotion into the tracked seed files.',
  '',
  'After manual promotion, rebuild/export runtime artifacts and validate:',
  '  npm run query:reviewed-family-signals:export',
  '  npm run query:role-head-equivalents:export',
  '  npm run test:structural',
  '  npm run evaluation:golden:pipeline:developing',
  '  npm run evaluation:golden:pipeline -- --suite=stable'
];

for (const line of lines) {
  console.log(line);
}
