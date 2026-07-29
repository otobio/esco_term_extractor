# SQL Snapshots

Store reproducible MySQL snapshots here when the source/review database state
needs to travel with the repository.

Guidelines:

- Keep each committed snapshot chunk under GitHub's 50 MB file limit.
- If the compressed dump archive is larger, split it into ordered chunks such as
  `esco_search_dump.tar.xz.part-aa` and `esco_search_dump.tar.xz.part-ab`.
- Reconstruct the compressed archive by concatenating chunks in lexical order,
  then extract/restore the SQL dump from that archive.
- The local unsplit `*.tar.xz` archive is ignored so it does not get committed
  accidentally.
- After restoring a snapshot, run `npm run runtime:artifacts-rebuild-db` so all
  generated runtime artifacts share the restored graph-node ID snapshot.
- Do not use snapshots as runtime inputs. Runtime uses `dist` plus generated
  `artifacts/runtime/occupation-*` files.
