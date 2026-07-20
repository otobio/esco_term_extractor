#!/usr/bin/env bash
# Fetch GeoNames build inputs into packages/gazetteer/data/geonames (offline rebuild).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/data/geonames"
mkdir -p "$DIR"
BASE="https://download.geonames.org/export/dump"
for c in RO NG HU EE; do
  curl -fsS -o "$DIR/$c.zip" "$BASE/$c.zip"
  unzip -o -q "$DIR/$c.zip" "$c.txt" -d "$DIR" && rm -f "$DIR/$c.zip"
done
curl -fsS -o "$DIR/alternateNamesV2.zip" "$BASE/alternateNamesV2.zip"
unzip -o -q "$DIR/alternateNamesV2.zip" alternateNamesV2.txt -d "$DIR" && rm -f "$DIR/alternateNamesV2.zip"
echo "geonames ready in $DIR"
