/**
 * iNaturalist source — vernacular-name supplement + empirical bloom phenology.
 *
 * iNat carries a community-preferred English common name per taxon (often
 * different from or missing in the GBIF list) and a phenology annotation
 * system. Aggregating research-grade observations tagged "Flowering" by
 * calendar month gives an empirical bloom-month distribution — typically more
 * accurate than USDA's regional season-string ("Early Summer") which maps to
 * coarse and sometimes incorrect month ranges.
 *
 * Image collection from iNat observations belongs to Phase 5 and isn't done
 * here.
 *
 * API:
 *   /v1/taxa?q=<name>&rank=species                        taxon id lookup
 *   /v1/observations/histogram?taxon_id=<id>              monthly histogram
 *     &term_id=12&term_value_id=13                        (phenology=Flowering)
 *     &date_field=observed&interval=month_of_year
 *     &quality_grade=research
 */

import type { Cache } from "../cache.ts";
import { cacheKey } from "../cache.ts";
import type { Month } from "../types.ts";

const BASE = "https://api.inaturalist.org/v1";

interface INatTaxonSummary {
  id: number;
  name?: string;
  rank?: string;
  preferred_common_name?: string;
  english_common_name?: string;
  is_active?: boolean;
}

interface INatTaxonSearchResponse {
  results?: INatTaxonSummary[];
}

async function fetchJson<T>(url: string, cache: Cache, key: string): Promise<T> {
  const cached = await cache.get<T>("inaturalist", key);
  if (cached !== null) {
    return cached;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`iNat ${url}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as T;
  await cache.set("inaturalist", key, json);
  return json;
}

export interface BloomPhenology {
  /** Research-grade flowering observations per month (1=Jan). */
  histogram: Record<number, number>;
  total: number;
  /** Derived bloom range; null when sample size is too small for a signal. */
  range: { start: Month; end: Month } | null;
  /** Confidence tier the range earns based on sample size. */
  confidence: "high" | "medium" | "low" | "none";
}

export interface INatResolved {
  taxonId: number;
  /** The name iNat surfaces as preferred (community-locale aware). */
  preferredCommonName?: string;
  /** The English-tagged name, if different from preferred. */
  englishCommonName?: string;
  phenology: BloomPhenology;
  sourceUrl: string;
}

export async function resolveFromINaturalist(
  acceptedBinomial: string,
  cache: Cache
): Promise<INatResolved | null> {
  const search = await fetchJson<INatTaxonSearchResponse>(
    `${BASE}/taxa?q=${encodeURIComponent(acceptedBinomial)}&rank=species&is_active=true`,
    cache,
    `search-${cacheKey(acceptedBinomial)}`
  );
  const target = (search.results ?? []).find(
    (r) => r.is_active && r.name?.toLowerCase() === acceptedBinomial.toLowerCase()
  );
  if (!target) {
    return null;
  }

  const phenology = await fetchBloomPhenology(target.id, cache);

  return {
    taxonId: target.id,
    preferredCommonName: target.preferred_common_name?.trim() || undefined,
    englishCommonName: target.english_common_name?.trim() || undefined,
    phenology,
    sourceUrl: `https://www.inaturalist.org/taxa/${target.id}`,
  };
}

// ---------------------------------------------------------------------------
// Phenology
// ---------------------------------------------------------------------------

interface HistogramResponse {
  results?: { month_of_year?: Record<string, number> };
}

async function fetchBloomPhenology(taxonId: number, cache: Cache): Promise<BloomPhenology> {
  // term_id=12 is Plant Phenology; term_value_id=13 is Flowering. quality_grade=research
  // restricts to community-verified observations.
  const url =
    `${BASE}/observations/histogram?taxon_id=${taxonId}` +
    `&term_id=12&term_value_id=13&date_field=observed` +
    `&interval=month_of_year&quality_grade=research`;
  const raw = await fetchJson<HistogramResponse>(url, cache, `phenology-${taxonId}`);
  const monthsRaw = raw.results?.month_of_year ?? {};
  // We'll make a histogram of month -> observation count, and derive a bloom range from that by keeping only months
  // whose count is ≥5% of the total.
  const histogram: Record<number, number> = {};
  let total = 0;
  for (let m = 1; m <= 12; m++) {
    const n = Number(monthsRaw[String(m)] ?? 0);
    histogram[m] = n;
    total += n;
  }
  const range = deriveBloomRange(histogram, total);
  const confidence = confidenceFromSample(total, range);
  return { histogram, total, range, confidence };
}

/**
 * Derive the bloom month range by keeping only months whose count is ≥5% of
 * the total, then taking min/max. Sample sizes under 50 aren't reliable
 * enough to commit to — the reviewer should verify those themselves.
 */
function deriveBloomRange(
  histogram: Record<number, number>,
  total: number
): { start: Month; end: Month } | null {
  if (total < 50) {
    return null;
  }
  const threshold = total * 0.05;
  const eligible: number[] = [];
  for (let m = 1; m <= 12; m++) {
    if (histogram[m] >= threshold) {
      eligible.push(m);
    }
  }
  if (eligible.length === 0) {
    return null;
  }
  return {
    start: eligible[0] as Month,
    end: eligible[eligible.length - 1] as Month,
  };
}

function confidenceFromSample(
  total: number,
  range: { start: Month; end: Month } | null
): BloomPhenology["confidence"] {
  if (!range) {
    return "none";
  }
  if (total >= 500) {
    return "high";
  }
  if (total >= 200) {
    return "medium";
  }
  return "low";
}
