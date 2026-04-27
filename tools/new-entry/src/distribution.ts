/**
 * Distribution assembly — fuses GBIF occurrences with two state-level
 * authorities (USDA PLANTS presence + WCVP native/introduced) and VASCAN
 * on the Canadian side, producing the schema-shaped `distribution` field
 * and a `_meta.distribution_review` block of items for manual verification.
 *
 * Each US state + CA province is classified `native`, `introduced`, or
 * `unconfirmed` before GBIF counties are bucketed. Truth table (US):
 *
 *   USDA present  | WCVP says      | State status
 *   --------------|----------------|-------------------
 *   yes           | native         | native    (both agree)
 *   yes           | silent         | native    (USDA-only)
 *   yes           | introduced     | introduced (WCVP beats USDA presence)
 *   no            | native         | native    (WCVP-only)
 *   no            | silent         | unconfirmed
 *   no            | introduced     | introduced
 *
 * WCVP is trusted over USDA because USDA presence doesn't distinguish
 * naturalised from native — WCVP does. Canada uses the same shape with
 * VASCAN in USDA's role.
 *
 * Per-county emission, once the state status is known:
 *   - state=native:
 *       every USDA-curated county → include
 *       every GBIF-observed county → include (any occurrence count)
 *   - state=introduced:
 *       drop silently — the species isn't native here
 *   - state=unconfirmed:
 *       GBIF-observed counties → `us_state_unconfirmed` review (reviewer
 *       decides if evidence supports adding that state to the native list)
 */

import { Pair, Scalar, YAMLMap, YAMLSeq } from "yaml";

import type { Cache } from "./cache.ts";
import type { UsdaDistribution } from "./sources/usda-plants.ts";
import type { WcvpDistribution } from "./sources/gbif-distributions.ts";
import { fetchOccurrences } from "./sources/gbif-occurrences.ts";
import { loadGeoIndex } from "./geo/index.ts";
import { classifyPoint } from "./geo/classify.ts";
import {
  CA_PRUID_TO_ABBR,
  US_STATE_FIPS_TO_ABBR,
  provinceAbbrFromCduid,
  stateAbbrFromFips,
} from "./geo/codes.ts";
import type { ConfidenceLevel } from "./types.ts";

type StateStatus = "native" | "introduced" | "unconfirmed";

export interface ReviewUsCounty {
  fips: string;
  state: string;
  county: string;
  obs?: number;
}

export interface ReviewCaDivision {
  cduid: string;
  prov: string;
  cd: string;
  obs?: number;
}

export interface DistributionReview {
  us_state_unconfirmed?: ReviewUsCounty[];
  ca_province_unconfirmed?: ReviewCaDivision[];
}

export interface AssembledDistribution {
  /**
   * Pre-built YAML node — a map with `native_us_counties` / `native_ca_divisions`
   * children, each a nested map keyed by state-FIPS / province-PRUID with
   * a USPS / Canada Post abbreviation as an inline comment on every key.
   * Null when no included counties/CDs at all. Consumed directly by the
   * emitter; not intended for programmatic inspection (use `meta.counts`
   * for totals).
   */
  data: YAMLMap | null;
  review: DistributionReview;
  meta: {
    sourceText: string;
    confidence: ConfidenceLevel;
    gbifTotalAvailable: number;
    gbifSampled: number;
    gbifTruncated: boolean;
    gbifClassified: number;
    gbifUnclassified: number;
    /** Counts of counties rejected as `state=introduced` — not surfaced for
     * review, but tracked so the `_meta` can signal how much GBIF signal we
     * dropped on WCVP's say-so. */
    introducedDropped: { us: number; ca: number };
    /** Total subdivisions included after assembly. Useful for log lines and
     * confidence picking — counts that would otherwise require walking the
     * pre-built YAMLMap. */
    counts: { us: number; ca: number };
    usStateStatus: Record<string, StateStatus>;
    caProvStatus: Record<string, StateStatus>;
  };
}

export async function assembleDistribution(
  acceptedTaxonKey: number,
  usdaDist: UsdaDistribution | null,
  wcvpDist: WcvpDistribution | null,
  vascanProvs: string[] | null,
  cache: Cache,
  opts: { maxRecords?: number } = {}
): Promise<AssembledDistribution> {
  const geo = await loadGeoIndex();
  const gbif = await fetchOccurrences(acceptedTaxonKey, cache, {
    maxRecords: opts.maxRecords,
  });

  const usStateStatus = buildUsStateStatus(usdaDist, wcvpDist);
  const caProvStatus = buildCaProvStatus(vascanProvs, wcvpDist);

  // Histogram GBIF observations per subdivision.
  const usCount = new Map<string, number>();
  const caCount = new Map<string, number>();
  let unclassified = 0;
  for (const p of gbif.points) {
    const code = classifyPoint(geo, p.lng, p.lat, p.country);
    if (code === null) {
      unclassified++;
      continue;
    }
    const target = p.country === "US" ? usCount : caCount;
    target.set(code, (target.get(code) ?? 0) + 1);
  }
  const classified = gbif.points.length - unclassified;

  const usIncludedSet = new Set<string>();
  const caIncludedSet = new Set<string>();
  const review: DistributionReview = {};
  let usIntroducedDropped = 0;
  let caIntroducedDropped = 0;

  // USDA's county list: include directly when the parent state is native.
  // USDA presence in an introduced state is a contradiction we resolve in
  // WCVP's favour (drop). USDA never lists counties in unconfirmed states
  // because listing a county implies state presence, which marks the state
  // native up in `buildUsStateStatus`.
  if (usdaDist) {
    for (const fips of usdaDist.usCountyFips) {
      const state = stateAbbrFromFips(fips);
      const status = state ? (usStateStatus.get(state) ?? "unconfirmed") : "unconfirmed";
      if (status === "native") usIncludedSet.add(fips);
      else if (status === "introduced") usIntroducedDropped++;
    }
  }

  // GBIF-observed US counties.
  for (const [fips, obs] of usCount) {
    const state = stateAbbrFromFips(fips);
    const status = state ? (usStateStatus.get(state) ?? "unconfirmed") : "unconfirmed";

    if (status === "native") {
      usIncludedSet.add(fips);
    } else if (status === "introduced") {
      usIntroducedDropped++;
    } else {
      // unconfirmed: reviewer decides whether to add the state to the native list
      const name = geo.nameByCode.get(fips) ?? "";
      (review.us_state_unconfirmed ??= []).push({
        fips,
        state: state ?? "",
        county: name,
        obs,
      });
    }
  }

  // GBIF-observed Canadian divisions.
  for (const [cduid, obs] of caCount) {
    const prov = provinceAbbrFromCduid(cduid);
    const status = prov ? (caProvStatus.get(prov) ?? "unconfirmed") : "unconfirmed";

    if (status === "native") {
      caIncludedSet.add(cduid);
    } else if (status === "introduced") {
      caIntroducedDropped++;
    } else {
      const name = geo.nameByCode.get(cduid) ?? "";
      (review.ca_province_unconfirmed ??= []).push({
        cduid,
        prov: prov ?? "",
        cd: name,
        obs,
      });
    }
  }

  const usIncluded = [...usIncludedSet].sort();
  const caIncluded = [...caIncludedSet].sort();
  review.us_state_unconfirmed?.sort((a, b) => a.fips.localeCompare(b.fips));
  review.ca_province_unconfirmed?.sort((a, b) => a.cduid.localeCompare(b.cduid));

  const data = buildDistributionYamlMap(usIncluded, caIncluded);

  const sourceText = buildSourceText(gbif, usdaDist, wcvpDist, vascanProvs);
  const confidence = pickConfidence({
    included: usIncluded.length + caIncluded.length,
    review,
    haveUsda: !!usdaDist,
    haveWcvp: !!wcvpDist,
    haveVascan: !!vascanProvs,
    truncated: gbif.truncated,
  });

  return {
    data,
    review,
    meta: {
      sourceText,
      confidence,
      gbifTotalAvailable: gbif.totalAvailable,
      gbifSampled: gbif.points.length,
      gbifTruncated: gbif.truncated,
      gbifClassified: classified,
      gbifUnclassified: unclassified,
      introducedDropped: { us: usIntroducedDropped, ca: caIntroducedDropped },
      counts: { us: usIncluded.length, ca: caIncluded.length },
      usStateStatus: Object.fromEntries(usStateStatus),
      caProvStatus: Object.fromEntries(caProvStatus),
    },
  };
}

/**
 * Group flat lists of full codes by their parent state/province prefix and
 * emit a YAMLMap node. Each top-level key (state FIPS or province PRUID)
 * carries an inline comment with its USPS / Canada Post abbreviation, so the
 * on-disk form is scannable without a lookup table.
 *
 * Returns null when both inputs are empty so callers can fall through to a
 * TODO placeholder for the field.
 */
function buildDistributionYamlMap(
  usFullCodes: string[],
  caFullCodes: string[]
): YAMLMap | null {
  if (usFullCodes.length === 0 && caFullCodes.length === 0) return null;
  const root = new YAMLMap();
  if (usFullCodes.length > 0) {
    root.items.push(
      new Pair(
        new Scalar("native_us_counties"),
        groupByPrefix(usFullCodes, 2, US_STATE_FIPS_TO_ABBR)
      )
    );
  }
  if (caFullCodes.length > 0) {
    root.items.push(
      new Pair(
        new Scalar("native_ca_divisions"),
        groupByPrefix(caFullCodes, 2, CA_PRUID_TO_ABBR)
      )
    );
  }
  return root;
}

function groupByPrefix(
  fullCodes: string[],
  prefixLen: number,
  abbrByPrefix: Record<string, string>
): YAMLMap {
  const buckets = new Map<string, string[]>();
  for (const c of fullCodes) {
    const prefix = c.slice(0, prefixLen);
    const suffix = c.slice(prefixLen);
    let arr = buckets.get(prefix);
    if (!arr) {
      arr = [];
      buckets.set(prefix, arr);
    }
    arr.push(suffix);
  }
  const map = new YAMLMap();
  for (const prefix of [...buckets.keys()].sort()) {
    const keyNode = new Scalar(prefix);
    keyNode.type = Scalar.QUOTE_DOUBLE;
    const abbr = abbrByPrefix[prefix];
    if (abbr) keyNode.comment = ` ${abbr}`;
    const seq = new YAMLSeq();
    seq.flow = true;
    for (const suffix of buckets.get(prefix)!.sort()) {
      const sNode = new Scalar(suffix);
      sNode.type = Scalar.QUOTE_DOUBLE;
      seq.items.push(sNode);
    }
    map.items.push(new Pair(keyNode, seq));
  }
  return map;
}

/**
 * State classification precedence:
 *   - WCVP introduced → `introduced` (wins even if USDA records presence,
 *     because USDA can't distinguish naturalised from native)
 *   - WCVP native OR USDA present → `native`
 *   - both silent → `unconfirmed`
 */
function buildUsStateStatus(
  usda: UsdaDistribution | null,
  wcvp: WcvpDistribution | null
): Map<string, StateStatus> {
  const status = new Map<string, StateStatus>();

  if (usda) {
    for (const fips of usda.usStateFips) {
      const usps = US_STATE_FIPS_TO_ABBR[fips];
      if (usps) status.set(usps, "native");
    }
  }

  if (wcvp) {
    for (const usps of wcvp.usNative) {
      status.set(usps, "native");
    }
    for (const usps of wcvp.usIntroduced) {
      status.set(usps, "introduced");
    }
  }

  return status;
}

function buildCaProvStatus(
  vascanProvs: string[] | null,
  wcvp: WcvpDistribution | null
): Map<string, StateStatus> {
  const status = new Map<string, StateStatus>();

  if (vascanProvs) {
    for (const prov of vascanProvs) {
      status.set(prov, "native");
    }
  }
  if (wcvp) {
    for (const prov of wcvp.caNative) {
      status.set(prov, "native");
    }
    for (const prov of wcvp.caIntroduced) {
      status.set(prov, "introduced");
    }
  }

  return status;
}

function buildSourceText(
  gbif: { totalAvailable: number; points: unknown[]; truncated: boolean },
  usdaDist: UsdaDistribution | null,
  wcvpDist: WcvpDistribution | null,
  vascanProvs: string[] | null
): string {
  const parts: string[] = [];
  parts.push(
    `GBIF occurrences (${gbif.points.length} sampled / ${gbif.totalAvailable} total${
      gbif.truncated ? "; truncated" : ""
    })`
  );
  if (wcvpDist) {
    parts.push(
      `WCVP (${wcvpDist.usNative.size + wcvpDist.caNative.size} native / ${wcvpDist.usIntroduced.size + wcvpDist.caIntroduced.size} introduced regions)`
    );
  }
  if (usdaDist) {
    parts.push(
      `USDA distribution (${usdaDist.usStateFips.size} US states, ${usdaDist.usCountyFips.size} US counties)`
    );
  }
  if (vascanProvs) {
    parts.push(`VASCAN native provinces (${vascanProvs.length})`);
  }
  return parts.join("; ");
}

function pickConfidence(args: {
  included: number;
  review: DistributionReview;
  haveUsda: boolean;
  haveWcvp: boolean;
  haveVascan: boolean;
  truncated: boolean;
}): ConfidenceLevel {
  if (args.included === 0) return "low";
  const fullUsStack = args.haveUsda && args.haveWcvp;
  if (!fullUsStack) return "medium";
  if (args.truncated) return "medium";
  const reviewSize =
    (args.review.us_state_unconfirmed?.length ?? 0) +
    (args.review.ca_province_unconfirmed?.length ?? 0);
  if (reviewSize > args.included) return "medium";
  return "high";
}
