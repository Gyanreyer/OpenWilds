/**
 * GBIF species distributions — WCVP (World Checklist of Vascular Plants)
 * per-region native/introduced status.
 *
 * Endpoint: `GET /v1/species/{key}/distributions`. Returns records from all
 * source datasets GBIF has ingested for the taxon. We filter to WCVP only —
 * it's the single global authority with state-level resolution, clean
 * native/introduced flags, and curation that tracks recent naturalisations
 * better than USDA does (e.g., calls out MD + DE as INTRODUCED for
 * *Echinacea purpurea* where USDA just reports presence).
 *
 * Record shape we act on:
 *   locationId: "TDWG:ALA"          // WGSRPD Level 3 code
 *   locality: "Alabama"
 *   establishmentMeans: undefined   // native (= absent flag)
 *                     | "INTRODUCED"
 *                     | "MANAGED"
 *                     | "NATURALISED"
 *   source: "The World Checklist of Vascular Plants (WCVP)"
 *
 * WCVP treats no `establishmentMeans` as native. Any other value
 * (INTRODUCED / NATURALISED / MANAGED) is not native. We fold NATURALISED
 * into the same "not native" bucket as INTRODUCED since the schema's
 * "native_us_counties" semantics require demonstrated native status, not
 * self-sustaining populations.
 */

import type { Cache } from "../cache.ts";
import {
  TDWG_L3_TO_CAPOST,
  TDWG_L3_TO_USPS,
} from "../geo/codes.ts";

const BASE = "https://api.gbif.org/v1";
const WCVP_SOURCE = "The World Checklist of Vascular Plants (WCVP)";

interface GbifDistributionRecord {
  locationId?: string;
  locality?: string;
  establishmentMeans?: string;
  source?: string;
}

interface GbifDistributionPage {
  results?: GbifDistributionRecord[];
  endOfRecords?: boolean;
}

export interface WcvpDistribution {
  /** USPS codes where WCVP lists the species without an establishmentMeans flag. */
  usNative: Set<string>;
  /** USPS codes where WCVP flags the species as introduced / naturalised / managed. */
  usIntroduced: Set<string>;
  /** Canada Post codes where WCVP lists the species as native. */
  caNative: Set<string>;
  /** Canada Post codes where WCVP flags the species as introduced. */
  caIntroduced: Set<string>;
  /** Raw TDWG Level 3 codes encountered that didn't map to US or CA —
   * surfaced for debug visibility; not consumed downstream. */
  unmappedCodes: string[];
}

export async function fetchWcvpDistribution(
  acceptedTaxonKey: number,
  cache: Cache
): Promise<WcvpDistribution | null> {
  const key = `distributions-${acceptedTaxonKey}`;
  let page = await cache.get<GbifDistributionPage>("gbif-distributions", key);
  if (!page) {
    // One page with a generous limit — WCVP records per species are usually
    // <100, rarely over 300. No pagination needed in practice.
    const res = await fetch(
      `${BASE}/species/${acceptedTaxonKey}/distributions?limit=300`,
      { headers: { "User-Agent": "openwilds-new-entry/0.1" } }
    );
    if (!res.ok) {
      throw new Error(
        `GBIF distributions for ${acceptedTaxonKey}: ${res.status} ${res.statusText}`
      );
    }
    page = (await res.json()) as GbifDistributionPage;
    await cache.set("gbif-distributions", key, page);
  }

  const wcvp = (page.results ?? []).filter((r) => r.source === WCVP_SOURCE);
  if (wcvp.length === 0) return null;

  const out: WcvpDistribution = {
    usNative: new Set(),
    usIntroduced: new Set(),
    caNative: new Set(),
    caIntroduced: new Set(),
    unmappedCodes: [],
  };

  const nonNative = new Set(["INTRODUCED", "NATURALISED", "MANAGED"]);

  for (const r of wcvp) {
    const tdwg = r.locationId?.split(":").pop();
    if (!tdwg) continue;

    const usps = TDWG_L3_TO_USPS[tdwg];
    const capost = TDWG_L3_TO_CAPOST[tdwg];

    // Determine native-or-introduced for this record. WCVP uses no flag =
    // native; anything else = not-native-we-can-trust.
    const isIntroduced =
      typeof r.establishmentMeans === "string" &&
      nonNative.has(r.establishmentMeans.toUpperCase());

    if (usps) {
      (isIntroduced ? out.usIntroduced : out.usNative).add(usps);
    } else if (capost) {
      (isIntroduced ? out.caIntroduced : out.caNative).add(capost);
    } else {
      // Foreign countries dominate unmapped codes (Germany, Korea, etc.);
      // recording them is only useful for debugging coverage holes, not for
      // gating. Kept out of the returned sets.
      out.unmappedCodes.push(tdwg);
    }
  }

  return out;
}

interface GbifRelatedResponse {
  results?: Array<{ taxonID?: string }>;
}

/**
 * Resolve the IPNI (International Plant Names Index) LSID for a GBIF taxon
 * key by following `/v1/species/{key}/related`, which exposes constituent
 * dataset records including IPNI's name registry. Used to deep-link the WCVP
 * citation to POWO's per-taxon page (`https://powo.science.kew.org/taxon/<urn>`)
 * instead of a name search.
 *
 * Returns null when no IPNI record is associated with the GBIF key — uncommon
 * for vascular plants but possible for fringe taxa.
 */
export async function fetchIpniId(
  acceptedTaxonKey: number,
  cache: Cache
): Promise<string | null> {
  const key = `related-${acceptedTaxonKey}`;
  let payload = await cache.get<GbifRelatedResponse>("gbif-related", key);
  if (!payload) {
    const res = await fetch(`${BASE}/species/${acceptedTaxonKey}/related`, {
      headers: { "User-Agent": "openwilds-new-entry/0.1" },
    });
    if (!res.ok) {
      throw new Error(
        `GBIF related for ${acceptedTaxonKey}: ${res.status} ${res.statusText}`
      );
    }
    payload = (await res.json()) as GbifRelatedResponse;
    await cache.set("gbif-related", key, payload);
  }
  for (const r of payload.results ?? []) {
    if (
      typeof r.taxonID === "string" &&
      r.taxonID.startsWith("urn:lsid:ipni.org:names:")
    ) {
      return r.taxonID;
    }
  }
  return null;
}
