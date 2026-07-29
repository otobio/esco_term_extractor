# Session State

Current state:

- The runtime lexical artifact is back on the broad OpenSearch snapshot source.
- `data/dictionary.jsonl` was refreshed from OpenSearch.
- `data/lexical.lxb` was rebuilt from that refreshed snapshot.
- The finite structured ingest path still resolves from the packed lexical binary first.
- The title profile still uses the same `data/lexical.lxb` artifact and continues to pass tests with the real binary.
- `data/display-titles.gtb` exists as the separate packed display-title artifact.

Validated recently:

- `npm run snapshot`
- rebuilt `data/lexical.lxb` from `data/dictionary.jsonl`
- `npm run build`
- `npm run test`

MySQL builder notes:

- `build/build-runtime-from-mysql.ts` remains in the repo as a documentation/build artifact.
- It is not exposed in `package.json` scripts anymore.
- The MySQL path is therefore informational for now, not part of the default runtime workflow.

Important distinction:

- `lexical.lxb` is still the shared lexical binary loaded by title/profile and finite structured matching.
- `display-titles.gtb` is only for display-title lookup.
- OpenSearch remains the broader source of the current lexical snapshot; MySQL is not the active replacement yet.
