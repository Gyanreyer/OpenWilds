/**
 * GBIF occurrences source — paged spatial sample for a species.
 *
 * Fetches geo-tagged occurrence records for a taxon from
 * `/v1/occurrence/search`, restricted to:
 *   - `taxonKey=<acceptedKey>` — also matches subordinate ranks (varieties,
 *     subspecies) under the accepted species, which is what we want.
 *   - `country=US,CA` — comma-separated; GBIF unions them.
 *   - `hasCoordinate=true` — drop records we can't classify to a polygon.
 *   - `basisOfRecord=PRESERVED_SPECIMEN,HUMAN_OBSERVATION` — keeps herbarium
 *     specimens and citizen-science observations; drops machine, fossil,
 *     literature, and unknown records.
 *
 * Pagination is bounded by `maxRecords` (default 20000 ≈ 67 pages). Most
 * native NA species have <20k geo-tagged US+CA observations, so the cap
 * pulls everything for the typical case; only very widespread species
 * (oaks, milkweeds, common goldenrods) get truncated. A short delay
 * between live requests keeps us within GBIF's unauthenticated rate limits.
 */

import type { Cache } from "../cache.ts";

const BASE = "https://api.gbif.org/v1";
const PAGE_SIZE = 300;
const DEFAULT_MAX_RECORDS = 20000;
const POLITE_DELAY_MS = 250;
const USER_AGENT =
  "openwilds-new-entry/0.1 (data curation; one taxon per run)";

interface GbifOccurrenceResponse {
  offset: number;
  limit: number;
  endOfRecords: boolean;
  count: number;
  results: Array<{
    key?: number;
    decimalLatitude?: number;
    decimalLongitude?: number;
    countryCode?: string;
    coordinateUncertaintyInMeters?: number;
    basisOfRecord?: string;
  }>;
}

export interface OccurrencePoint {
  lng: number;
  lat: number;
  country: "US" | "CA";
  uncertaintyMeters?: number;
}

export interface OccurrenceFetchResult {
  points: OccurrencePoint[];
  /** Total records GBIF reports across all pages (independent of our cap). */
  totalAvailable: number;
  /** True when we hit `maxRecords` before GBIF ran out of pages. */
  truncated: boolean;
}

export interface FetchOptions {
  maxRecords?: number;
}

/**
 * Drives pagination, drops malformed records (no coords, unknown country),
 * and surfaces a flat list ready for `geo/classify.ts`. Pages are cached
 * gzipped under `.cache/gbif-occurrences/taxon-<key>-offset-<N>.json.gz` —
 * each page is large enough to make compression worthwhile.
 */
export async function fetchOccurrences(
  taxonKey: number,
  cache: Cache,
  opts: FetchOptions = {}
): Promise<OccurrenceFetchResult> {
  const maxRecords = opts.maxRecords ?? DEFAULT_MAX_RECORDS;
  const points: OccurrencePoint[] = [];
  let totalAvailable = 0;
  let offset = 0;
  let firstNetworkRequest = true;
  let truncated = false;

  while (offset < maxRecords) {
    const cacheSlot = `taxon-${taxonKey}-offset-${offset}`;
    let page = await cache.get<GbifOccurrenceResponse>(
      "gbif-occurrences",
      cacheSlot
    );

    if (!page) {
      if (!firstNetworkRequest) {
        await sleep(POLITE_DELAY_MS);
      }
      firstNetworkRequest = false;
      const url = buildUrl(taxonKey, offset);
      const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok) {
        throw new Error(`GBIF occurrences ${url}: ${res.status} ${res.statusText}`);
      }
      page = (await res.json()) as GbifOccurrenceResponse;
      await cache.set("gbif-occurrences", cacheSlot, page, { gzip: true });
    }

    totalAvailable = page.count;
    for (const r of page.results) {
      const lng = r.decimalLongitude;
      const lat = r.decimalLatitude;
      const cc = r.countryCode;
      if (
        typeof lng !== "number" ||
        typeof lat !== "number" ||
        (cc !== "US" && cc !== "CA")
      ) {
        continue;
      }
      points.push({
        lng,
        lat,
        country: cc,
        uncertaintyMeters: r.coordinateUncertaintyInMeters,
      });
    }

    if (page.endOfRecords) break;
    offset += PAGE_SIZE;
    if (offset >= maxRecords && !page.endOfRecords) {
      truncated = true;
    }
  }

  return { points, totalAvailable, truncated };
}

function buildUrl(taxonKey: number, offset: number): URL {
  const url = new URL(`${BASE}/occurrence/search`);
  url.searchParams.set("taxonKey", String(taxonKey));
  url.searchParams.set("country", "US");
  url.searchParams.append("country", "CA");
  url.searchParams.set("hasCoordinate", "true");
  url.searchParams.set("basisOfRecord", "PRESERVED_SPECIMEN");
  url.searchParams.append("basisOfRecord", "HUMAN_OBSERVATION");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
