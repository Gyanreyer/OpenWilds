# tools/new-entry/data/

Committed offline data used by the `new-entry` CLI. These files are produced by
[`../scripts/prep-data.ts`](../scripts/prep-data.ts) and should not be edited by
hand — re-run the script to pick up a newer upstream vintage.

```
node tools/new-entry/scripts/prep-data.ts            # all four steps
node tools/new-entry/scripts/prep-data.ts --only vascan
node tools/new-entry/scripts/prep-data.ts --force-download
```

Staged raw downloads land in `tools/new-entry/.prep/` (gitignored) and are
re-used on subsequent runs unless `--force-download` is passed.

## Files

### `us-counties-2024.geojson`

**Source:** TIGER/Line 2024, U.S. Census Bureau.
**URL:** https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip
**License:** Public domain (U.S. federal government work).
**Vintage:** 2024 (annual release).

FeatureCollection of US counties and county-equivalents (3,235 features),
projected to WGS84 and simplified with Visvalingam weighted at 4%. Each
feature's properties retain only:

- `GEOID` — 5-digit FIPS (2-digit state + 3-digit county), the primary key
  used throughout the schema (`distribution.native_us_counties`).
- `NAME` — short county name (e.g. "Wayne"), for display.

### `ca-divisions-2021.geojson`

**Source:** Statistics Canada, 2021 Census — Cartographic Boundary Files,
Census Divisions (lcd_000b21a_e).
**URL:** https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcd_000b21a_e.zip
**License:** Statistics Canada Open Licence (attribution required).
**Vintage:** 2021 Census (next refresh after the 2026 Census).

FeatureCollection of Canadian Census Divisions (≈293 features), projected to
WGS84 and simplified with Visvalingam weighted at 4%. Each feature retains:

- `CDUID` — 4-digit Statistics Canada code (2-digit province + 2-digit CD),
  the primary key for `distribution.native_ca_divisions`.
- `CDNAME` — division name (English; some provinces use terms other than
  "census division" — e.g. British Columbia's Regional Districts, Quebec's
  MRCs — but the CDUID remains the universal identifier).

### `usda-plantlst.txt`

**Source:** USDA NRCS PLANTS Database, Complete PLANTS List.
**URL:** https://plants.sc.egov.usda.gov/DocumentLibrary/Txt/plantlst.txt
**License:** Public domain (U.S. federal government work).
**Vintage:** Rolling (PLANTS updates continuously).

Tab-parseable CSV of every scientific name in the PLANTS checklist, with
columns `Symbol`, `Synonym Symbol`, `Scientific Name with Author`,
`Common Name`, `Family`. The `new-entry` tool uses this as a local
name→symbol index, then fetches per-plant characteristics and distribution
on demand from the PLANTS JSON API (`plantsservices.sc.egov.usda.gov/api/`)
and caches the responses under `tools/new-entry/.cache/usda-plants/`.

The historical CSV dumps (`CharacteristicsData.csv`, `Distribution.csv`)
referenced in older documentation no longer exist — the current PLANTS
frontend constructs those CSVs client-side from the JSON API, so there is
no committable bulk dump for characteristics.

### `vascan.csv`

**Source:** VASCAN (Database of Vascular Plants of Canada), via the
Canadensys IPT as a Darwin Core archive.
**URL:** https://data.canadensys.net/ipt/archive.do?r=vascan
**License:** CC0 1.0.
**Vintage:** Rolling (VASCAN is continuously revised).

Trimmed CSV of `scientific_name,native_provinces`. Contains one row per
accepted VASCAN species that is present-and-native in at least one
province or territory. Native provinces are given as pipe-separated
ISO 3166-2 subdivision codes (e.g. `AB|BC|MB|...`) — the 12 Canadian
subdivisions plus `PM` (St. Pierre & Miquelon, a French collectivity
that VASCAN tracks alongside the Canadian flora).

Infraspecific ranks (subspecies, variety) are **rolled up** to their
parent species: a species row's `native_provinces` is the union of its
own species-level presence and the presence of all accepted subordinate
taxa. This is so Phase 4's native filter can answer "is species X
native to province Y?" with a single species-name lookup.

Synonyms are not included. Callers are expected to resolve input names
through GBIF to an accepted name before querying VASCAN.
