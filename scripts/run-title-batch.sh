#!/usr/bin/env bash
set -euo pipefail

OS_URL="${OS_URL:-http://localhost:9201}"
INDEX="${INDEX:-acme-localdev-listings-1}"
SIZE="${SIZE:-100}"

titles=$(curl -s "${OS_URL}/${INDEX}/_search" \
  -H 'Content-Type: application/json' \
  -d "{\"size\": ${SIZE}, \"_source\": [\"title\"], \"query\": {\"match_all\": {}}}" \
  | jq -r '.hits.hits[]._source.title')

i=0
while IFS= read -r title; do
  i=$((i + 1))
  echo "===================== [$i] $title ====================="
  npm run match -- --profile title "$title" --locale "ro" --verify
  echo
done <<< "$titles"
