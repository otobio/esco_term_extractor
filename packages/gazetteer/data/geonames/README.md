# GeoNames build inputs

Per-country dumps (`RO/NG/HU/EE.txt`) + language-tagged `alternateNamesV2.txt`, from
<https://download.geonames.org/export/dump/>. Consumed by `location-store.ts` to build
the dataset (`npm run build:dataset`).

`alternateNamesV2.txt` (~742 MB) is git-ignored; fetch it (and refresh the dumps) with:

    bash packages/gazetteer/scripts/download-geonames.sh
