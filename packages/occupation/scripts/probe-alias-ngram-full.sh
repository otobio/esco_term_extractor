#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUERY_FILE="${1:-}"
OUT_DIR="${2:-"$ROOT_DIR/artifacts/ngram-probe"}"
LIMIT="${LIMIT:-10}"
LOCALE="${LOCALE:-en}"
SOURCE_NAME="${SOURCE_NAME:-esco_1_2_1}"

if [[ -z "$QUERY_FILE" ]]; then
  QUERY_FILE="/tmp/ose-ngram-sample-queries.txt"
  printf '%s\n' \
    'Senior Java Backend Engineer' \
    'Airline Compliance Auditors' \
    'senior data analyst' \
    'Fullstack developer' \
    'primary school teacher' \
    'registered nurse' \
    'front desk receptionist' \
    > "$QUERY_FILE"
fi

mkdir -p "$OUT_DIR"

cd "$ROOT_DIR"
npm run build

node dist/cli/probe-alias-ngram-batch.js \
  --query-file="$QUERY_FILE" \
  --locale="$LOCALE" \
  --source-name="$SOURCE_NAME" \
  --limit="$LIMIT" \
  --alias-source=mysql \
  --query-mode=role \
  > "$OUT_DIR/conservative.txt"

node dist/cli/probe-alias-ngram-batch.js \
  --query-file="$QUERY_FILE" \
  --locale="$LOCALE" \
  --source-name="$SOURCE_NAME" \
  --limit="$LIMIT" \
  --alias-source=mysql \
  --query-mode=role \
  --include-family-supporting \
  > "$OUT_DIR/high-recall.txt"

node dist/cli/probe-alias-ngram-batch.js \
  --query-file="$QUERY_FILE" \
  --locale="$LOCALE" \
  --source-name="$SOURCE_NAME" \
  --limit="$LIMIT" \
  --alias-source=mysql \
  --query-mode=role \
  --include-family-supporting \
  --format=jsonl \
  > "$OUT_DIR/high-recall.jsonl"

printf 'Alias ngram probe complete.\n'
printf 'Query file: %s\n' "$QUERY_FILE"
printf 'Output dir: %s\n' "$OUT_DIR"
printf 'Text reports:\n'
printf '  %s\n' "$OUT_DIR/conservative.txt"
printf '  %s\n' "$OUT_DIR/high-recall.txt"
printf 'JSONL:\n'
printf '  %s\n' "$OUT_DIR/high-recall.jsonl"
