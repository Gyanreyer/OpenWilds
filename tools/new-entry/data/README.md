# tools/new-entry/data/

Plant-data artifacts used by the `new-entry` CLI. These files are produced by
[`../scripts/prep-data.ts`](../scripts/prep-data.ts) and should not be edited
by hand — re-run the script to pick up a newer upstream vintage.

```
node tools/new-entry/scripts/prep-data.ts            # all four steps
node tools/new-entry/scripts/prep-data.ts --only vascan
node tools/new-entry/scripts/prep-data.ts --force-download
```

Staged raw downloads land in `tools/new-entry/.prep/` (gitignored) and are
re-used on subsequent runs unless `--force-download` is passed.

The geographic boundary artifacts (US counties, Canadian census divisions)
that `new-entry` also depends on live in [`../../data/geo/`](../../data/geo/)
— they're shared with `tools/build-svg-map/` and aren't `new-entry`-specific.

## Files

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
