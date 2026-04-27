# Plant Data Schema (v2)

Reference for the per-species YAML files at
`data/plantae/<family>/<genus>/<species>/data.yml`.

**Source of truth is TypeScript:** [tools/new-entry/src/types.ts](tools/new-entry/src/types.ts).
If the types and this document disagree, the types win — and this file should
be corrected to match.

---

## File layout

Each species lives at a path that encodes its taxonomy:

```
data/
  plantae/
    <family>/
      <genus>/
        <species>/
          data.yml        # the schema below
          images/         # optional; see Images
            0.jpg
            1.jpg
            ...
```

Everything in the path is lowercase. Family/genus/species names are inferred
from the directory names — they are **not** repeated inside `data.yml`.

---

## Fields

### Identity

| Field | Type | Required | Notes |
|---|---|---|---|
| `scientific_name` | string | yes | Currently-accepted binomial, e.g. `Fragaria virginiana`. |
| `common_names` | string[] | yes | Most common first. |
| `synonyms` | string[] | no | Older/alternate scientific names. Useful for lookup after taxonomic revisions. |

### Habit

| Field | Type | Required | Allowed values |
|---|---|---|---|
| `category` | string | yes | `Tree`, `Shrub`, `Graminoid`, `Fern`, `Forb`, `Vine`, `Succulent`. |
| `life_cycle` | string | yes | `Annual`, `Biennial`, `Perennial`. |

### Flowering

| Field | Type | Required | Notes |
|---|---|---|---|
| `bloom_time` | `{start, end}` | no | Integer months 1–12. Omit for non-flowering plants or when unknown. |
| `bloom_color` | `BloomColor[]` | no | **Always an array**, even for single-color species. Each entry has `name` and `hex` (6-digit `#RRGGBB`). |

### Size

All dimensions are in **inches** as integers.

| Field | Type | Required | Notes |
|---|---|---|---|
| `height` | `{min, max}` | yes | Typical mature height in inches. Use `min === max` for a single value. |
| `spread` | `{min, max}` | no | Typical mature spread in inches. |

### Site preferences

| Field | Type | Required | Notes |
|---|---|---|---|
| `light` | `{min, max}` | yes | 1–5. 1 = full shade, 5 = full sun. |
| `moisture` | `{min, max}` | yes | 1–5. 1 = dry, 5 = wet. |
| `soil_type` | string[] | no | Any subset of `Sand`, `Silt`, `Loam`, `Clay`, `Gravel`, `Peat`. |
| `soil_ph` | `{min, max}` | no | Floats allowed. |
| `root_type` | string | no | `Taproot`, `Fibrous`, `Rhizomatous`, `Stoloniferous`, `Bulb`, `Corm`. |
| `drought_tolerance` | string | no | `Low`, `Medium`, `High`. |

### Ecology

| Field | Type | Required | Notes |
|---|---|---|---|
| `habitat` | string[] | no | Plant communities / ecological settings. Free-form phrases, e.g. `Mesic forest edge`. |

### Conservation & toxicity

| Field | Type | Required | Notes |
|---|---|---|---|
| `conservation_status.global` | string | no | NatureServe G-rank, e.g. `G5`. |
| `conservation_status.state` | `Record<code, rank>` | no | Map of state/province code → S-rank, e.g. `{ MI: S5 }`. |
| `toxicity.humans` | string \| null | no | `null` = "not known to be toxic" (a deliberate assertion). Non-null string = description of symptom/scope. |
| `toxicity.pets` | string \| null | no | Same convention. |
| `toxicity.livestock` | string \| null | no | Same convention. |

### Distribution

US and Canada are tracked in separate fields because the subdivision coding
schemes differ.

| Field | Type | Required | Notes |
|---|---|---|---|
| `distribution.native_us_counties` | `Record<string, string[]>` | no | Map keyed by 2-digit state FIPS; values are 3-digit county-suffix lists. Reconstruct full FIPS as `${state}${suffix}`. E.g. `"26": ["163"]` = Wayne County, MI. Each state key carries an inline `# <USPS>` comment in generated drafts. |
| `distribution.native_ca_divisions` | `Record<string, string[]>` | no | Map keyed by 2-digit province PRUID; values are 2-digit CD-suffix lists. Reconstruct full CDUID as `${prov}${suffix}`. E.g. `"35": ["20"]` = Toronto, ON. |

### Images

Inline list. Image files live next to `data.yml` under `images/`. The first
entry is the default card/preview image by convention.

| Field | Type | Required | Notes |
|---|---|---|---|
| `local_path` | string | yes | Relative to `data.yml`, e.g. `images/0.jpg`. |
| `alt` | string | yes | Descriptive alt text; used for a11y and search. |
| `caption` | string | no | Short display caption. Omit if redundant with `alt`. |
| `license` | string | yes | One of `CC0`, `CC-BY`, `CC-BY-SA`, `CC-BY-NC`, `CC-BY-NC-SA`, with optional version suffix (`CC-BY-2.0`, etc.). `CC-BY-ND` is excluded — we downscale on ingest, which is a derivative. |
| `creator_name` | string | yes | As provided by the source. |
| `creator_url` | string | no | Profile/attribution URL. |
| `source` | string | yes | `iNaturalist`, `Flickr`, `Wikimedia`, or `Other`. |
| `source_url` | string | no | Link back to the observation/photo page. Omit for first-party photos with no upstream URL. |
| `observed_on` | string | no | ISO date (`YYYY-MM-DD`) the photo was taken. |

### Sources

| Field | Type | Required | Notes |
|---|---|---|---|
| `sources` | `SourceCitation[]` | yes | Per-entry list. Each `{name, url, accessed}` where `accessed` is an ISO date. |

### Draft metadata (generated entries only)

Generated drafts carry a `_meta` block with provenance and per-field
confidence. It is stripped when the entry is reviewed and accepted.

```yaml
_meta:
  generated_by: new-entry v0.1
  generated_at: 2026-04-21
  sources:
    taxonomy: GBIF backbone (taxonKey 2984545)
    distribution: GBIF occurrences (2891 records) ∩ USDA PLANTS native states
  confidence:
    distribution: medium
    bloom_color: low
```

---

## TODO convention

Fields the generator cannot reliably fill in are **emitted as commented-out
keys** rather than placeholder values. This keeps drafts parseable at every
stage of review.

```yaml
# TODO: USDA PLANTS entry lacks height data for this taxon — consult regional flora.
# height:
#   min: 0
#   max: 0

# TODO: Prose-y and regional; no structured source.
# habitat:
#   - ""
```

A commented-out key reads as "reviewer, fill this in or confirm the omission
is fine." Do not emit invalid typed values (e.g. `start: TODO` where a number
is expected).

---

## Fields commonly left to reviewers

Even after the generator runs, these fields typically need human input:

- `habitat` — no structured API produces "mesic deciduous forest edges."
- `toxicity.*` — better curated by hand from a trusted reference set.
- `soil_type` / `soil_ph` — USDA PLANTS has partial coverage.
- `root_type` — rarely in structured data.
- `conservation_status` — deferred until NatureServe integration lands.

---

## Full example

```yaml
scientific_name: Fragaria virginiana
common_names:
  - Virginia strawberry
  - Wild strawberry
synonyms:
  - Fragaria ovalis

category: Forb
life_cycle: Perennial

bloom_time:
  start: 4
  end: 6
bloom_color:
  - name: White
    hex: "#FFFFFF"

height:
  min: 3
  max: 6
spread:
  min: 6
  max: 12

light:
  min: 3
  max: 5
moisture:
  min: 2
  max: 4

soil_type:
  - Sand
  - Loam
  - Clay
soil_ph:
  min: 5.5
  max: 7.5

root_type: Rhizomatous
drought_tolerance: Medium

habitat:
  - Mesic forest edge
  - Oak savanna
  - Old field

toxicity:
  humans: null
  pets: null
  livestock: null

distribution:
  native_us_counties:
    "26": # MI
      - "099"
      - "163"
  native_ca_divisions:
    "35": # ON
      - "20"

images:
  - local_path: images/0.jpg
    alt: Fragaria virginiana in bloom, white flower and trifoliate leaves.
    license: CC-BY-2.0
    creator_name: Jane Doe
    creator_url: https://www.flickr.com/photos/janedoe
    source: Flickr
    source_url: https://www.flickr.com/photos/janedoe/12345
    observed_on: 2024-05-14

sources:
  - name: USDA PLANTS Database
    url: https://plants.usda.gov/plant-profile/FRVI
    accessed: 2026-04-21
  - name: GBIF Occurrences
    url: https://www.gbif.org/species/2984545
    accessed: 2026-04-21
```
