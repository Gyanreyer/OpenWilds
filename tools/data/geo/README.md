# tools/data/geo/

Committed geographic boundary artifacts shared across tooling. Used today by
[`tools/new-entry/`](../../new-entry/) (point-in-polygon classification of
GBIF occurrences) and [`tools/build-svg-map/`](../../build-svg-map/) (static
SVG map generation for the review UI and the site's per-plant range maps).

These files are produced by
[`../../new-entry/scripts/prep-data.ts`](../../new-entry/scripts/prep-data.ts)
and should not be edited by hand — re-run the script to pick up a newer
upstream vintage.

```
node tools/new-entry/scripts/prep-data.ts --only tiger --force-download
node tools/new-entry/scripts/prep-data.ts --only statcan --force-download
```

Both source files used here are the **cartographic boundary** variants of
their respective bureaus' boundary releases — they are pre-clipped to land,
so coastal and Great Lakes counties don't extend out into the water. The
"digital" / full-extent variants (TIGER's `tl_*` series, StatCan's `*_a*`
files) include water boundaries and produce ugly maps.

## Files

### `us-counties-2024.geojson`

**Source:** TIGER/Line 2024 Cartographic Boundary Files (1:500,000), U.S.
Census Bureau.
**URL:** https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_county_500k.zip
**License:** Public domain (U.S. federal government work).
**Vintage:** 2024 (annual release).

FeatureCollection of US counties and county-equivalents (3,235 features),
projected to WGS84 and simplified with Visvalingam weighted at 4% of the
already-1:500k upstream simplification. Each feature retains:

- `GEOID` — 5-digit FIPS (2-digit state + 3-digit county), the primary key
  used throughout the schema (`distribution.native_us_counties`).
- `NAME` — short county name (e.g. "Wayne"), for display.

Water-clipping is at the cartographic-boundary scale: shoreline counties
follow the coast / Great Lakes shore rather than extending miles offshore
(as they do in the legal/statistical TIGER definition).

### `ca-divisions-2021.geojson`

**Source:** Statistics Canada, 2021 Census — Cartographic Boundary Files,
Census Divisions (`lcd_000b21a_e`).
**URL:** https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcd_000b21a_e.zip
**License:** Statistics Canada Open Licence (attribution required).
**Vintage:** 2021 Census (next refresh after the 2026 Census).

FeatureCollection of Canadian Census Divisions (≈293 features), projected to
WGS84 and simplified with Visvalingam weighted at 2% (Canadian Arctic and
Pacific coastlines are byte-expensive, so we simplify harder than the US
counties). Each feature retains:

- `CDUID` — 4-digit Statistics Canada code (2-digit province + 2-digit CD),
  the primary key for `distribution.native_ca_divisions`.
- `CDNAME` — division name (English; some provinces use terms other than
  "census division" — e.g. British Columbia's Regional Districts, Quebec's
  MRCs — but the CDUID remains the universal identifier).
