/**
 * USDA PLANTS source.
 *
 *   1. Resolve an accepted scientific name (from GBIF) to a USDA symbol by
 *      indexing `data/usda-plantlst.txt` on first call.
 *   2. Fetch the per-plant PlantProfile (categories, life cycle, regional
 *      native status) and PlantCharacteristics (height, light, moisture,
 *      soil pH, drought tolerance, bloom period, …) from the USDA JSON API.
 *   3. Map the raw USDA values onto our schema v2 field shapes.
 *
 * API docs (empirical, no official spec):
 *   https://plantsservices.sc.egov.usda.gov/api/PlantProfile?symbol=<SYM>
 *   https://plantsservices.sc.egov.usda.gov/api/PlantCharacteristics/<id>
 *
 * The plantlst checklist has one row per name. A row with empty `Synonym
 * Symbol` is the accepted record for its Symbol; a row with a non-empty
 * `Synonym Symbol` represents a synonym whose accepted parent is given by
 * the `Symbol` column. Lookups prefer the accepted row; fall back to any
 * synonym row if the input is an old name.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";

import type { Cache } from "../cache.ts";
import type {
  DroughtTolerance,
  LifeCycle,
  Month,
  OneThroughFive,
  PlantCategory,
} from "../types.ts";

const API_BASE = "https://plantsservices.sc.egov.usda.gov/api";
const PLANTLST_PATH = fileURLToPath(import.meta.resolve("../../data/usda-plantlst.txt"));

// ---------------------------------------------------------------------------
// Plantlst index
// ---------------------------------------------------------------------------

interface PlantlstRow {
  Symbol: string;
  "Synonym Symbol": string;
  "Scientific Name with Author": string;
  "Common Name": string;
  Family: string;
}

interface IndexEntry {
  /** The accepted USDA symbol (what we want to query the API with). */
  acceptedSymbol: string;
  /** True when the matched row was itself the accepted entry. */
  viaAccepted: boolean;
  /** The scientific-name-with-author string from the matched row. */
  matchedName: string;
}

let plantlstIndex: Map<string, IndexEntry> | null = null;

async function loadPlantlstIndex(): Promise<Map<string, IndexEntry>> {
  if (plantlstIndex) {
    return plantlstIndex;
  }
  const text = await readFile(PLANTLST_PATH, "utf8");
  const rows = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    relax_quotes: true,
  }) as PlantlstRow[];
  const index = new Map<string, IndexEntry>();
  for (const row of rows) {
    const nameWithAuthor = row["Scientific Name with Author"];
    if (!nameWithAuthor) {
      continue;
    }
    const binomial = extractBinomial(nameWithAuthor);
    if (!binomial) {
      continue;
    }
    const viaAccepted = row["Synonym Symbol"] === "";
    const existing = index.get(binomial);
    // Prefer accepted rows over synonym rows. Otherwise keep the first seen.
    if (!existing || (viaAccepted && !existing.viaAccepted)) {
      index.set(binomial, {
        acceptedSymbol: row.Symbol,
        viaAccepted,
        matchedName: nameWithAuthor,
      });
    }
  }
  plantlstIndex = index;
  return index;
}

/**
 * Strip authorship from a "Scientific Name with Author" string to recover the
 * canonical binomial. The plantlst entries look like:
 *   "Echinacea purpurea (L.) Moench"
 *   "Abutilon americanum (L.) Sweet"
 *   "Echinacea purpurea (L.) Moench var. laevigata (...) Cronquist"
 * In every case the first two whitespace-separated tokens are genus + epithet.
 * We return those two; infraspecific suffixes are ignored here because the
 * index is keyed at species rank.
 */
function extractBinomial(nameWithAuthor: string): string | null {
  const parts = nameWithAuthor.trim().split(/\s+/);
  if (parts.length < 2) return null;
  return `${parts[0]} ${parts[1]}`;
}

// ---------------------------------------------------------------------------
// API fetching
// ---------------------------------------------------------------------------

interface PlantProfile {
  Id: number;
  Symbol: string;
  ScientificName: string;
  CommonName?: string;
  Durations?: string[];
  GrowthHabits?: string[];
  NativeStatuses?: { Region: string; Status: string; Type?: string }[];
  MapCoordinates?: { StateAbbr: string }[];
}

interface PlantCharacteristic {
  PlantCharacteristicName: string;
  PlantCharacteristicValue: string;
  PlantCharacteristicCategory: string;
}

async function fetchJson<T>(url: string, cache: Cache, key: string): Promise<T> {
  const cached = await cache.get<T>("usda-plants", key);
  if (cached !== null) return cached;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`USDA ${url}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as T;
  await cache.set("usda-plants", key, json);
  return json;
}

// ---------------------------------------------------------------------------
// Field mapping — raw USDA values → schema v2 shapes
// ---------------------------------------------------------------------------

/**
 * USDA's per-region native status. L48 covers the lower 48 states collectively;
 * AK/HI/PR/VI are their own regions; CAN is a whole-country flag for Canada.
 * This is coarser than we'd like (no per-state breakdown) but sufficient for
 * a draft's sanity flag — Phase 4's geo pipeline produces the fine-grained
 * county/CD list.
 */
export interface UsdaNativeSummary {
  /** Regions where USDA flags Status === "N" (Native). */
  nativeRegions: string[];
  /** Regions where USDA flags Status === "I" (Introduced). */
  introducedRegions: string[];
}

function summarizeNativeStatuses(ns: PlantProfile["NativeStatuses"]): UsdaNativeSummary {
  const native: string[] = [];
  const introduced: string[] = [];
  for (const s of ns ?? []) {
    if (s.Status === "N") {
      native.push(s.Region);
    } else if (s.Status === "I") {
      introduced.push(s.Region);
    }
  }
  return { nativeRegions: native, introducedRegions: introduced };
}

// USDA can tag a plant with multiple habits (e.g., "Shrub, Subshrub").
// We'll order these in an array so priority favors the most informative/specific
// category that matches first.
const CATEGORY_MATCHERS: Array<[RegExp, PlantCategory]> = [
  [/^tree$/i, "Tree"],
  [/^shrub$/i, "Shrub"],
  [/^subshrub$/i, "Shrub"],
  [/^vine$/i, "Vine"],
  [/^graminoid$/i, "Graminoid"],
  [/^fern$/i, "Fern"],
  [/^forb\/?herb$/i, "Forb"],
  [/^forb$/i, "Forb"],
];

/** Map USDA growth habit strings to our coarser PlantCategory enum. */
function mapCategory(growthHabits: string[] | undefined): PlantCategory | undefined {
  if (!growthHabits || growthHabits.length === 0) return undefined;

  for (const [regex, categoryName] of CATEGORY_MATCHERS) {
    if (growthHabits.some((h) => regex.test(h))) {
      return categoryName;
    }
  }
  console.warn(`  [USDA] Unrecognized growth habits ${growthHabits.join(", ")}`);
  return undefined;
}

const LIFE_CYCLES: LifeCycle[] = ["Perennial", "Biennial", "Annual"];

/** USDA durations are a flat list; species usually report one. */
function mapLifeCycle(durations: string[] | undefined): LifeCycle | undefined {
  if (!durations || durations.length === 0) {
    return undefined;
  }

  for (const lc of LIFE_CYCLES) {
    if (durations.includes(lc)) {
      return lc;
    }
  }

  console.warn(`  [USDA] Unrecognized durations ${durations.join(", ")}`);
  return undefined;
}

interface MappedCharacteristics {
  height?: { min: number; max: number };
  light?: { min: OneThroughFive; max: OneThroughFive };
  moisture?: { min: OneThroughFive; max: OneThroughFive };
  soil_ph?: { min: number; max: number };
  drought_tolerance?: DroughtTolerance;
  bloom_time?: { start: Month; end: Month };
  bloom_color_name?: string;
  /** Raw USDA livestock-toxicity label ("None"/"Slight"/"Moderate"/"Severe"),
   * surfaced for the reviewer as a hint; not mapped into schema `toxicity`. */
  livestock_toxicity_hint?: string;
}

const SHADE_TOLERANCE_TO_LIGHT_MAP: Record<string, { min: OneThroughFive; max: OneThroughFive } | undefined> = {
  None: { min: 5, max: 5 },
  Low: { min: 3, max: 5 },
  Medium: { min: 2, max: 4 },
  High: { min: 1, max: 2 },
};

const MOISTURE_USE_MAP: Record<string, { min: OneThroughFive; max: OneThroughFive } | undefined> = {
  "Low": { min: 1, max: 2 },
  "Medium": { min: 2, max: 4 },
  "High": { min: 4, max: 5 },
};

const DROUGHT_TOLERANCE_MAP: Record<string, DroughtTolerance | undefined> = {
  // Just map "None" to "Low"
  "None": "Low",
  "Low": "Low",
  "Medium": "Medium",
  "High": "High",
};

const BLOOM_PERIODS: Record<string, { start: Month; end: Month }> = {
  "Early Spring": { start: 3, end: 4 },
  "Mid Spring": { start: 4, end: 5 },
  "Late Spring": { start: 5, end: 6 },
  Spring: { start: 3, end: 5 },
  "Early Summer": { start: 6, end: 7 },
  "Mid Summer": { start: 7, end: 8 },
  "Late Summer": { start: 8, end: 9 },
  Summer: { start: 6, end: 8 },
  "Spring and Summer": { start: 3, end: 8 },
  "Summer and Fall": { start: 6, end: 11 },
  "Early Fall": { start: 9, end: 10 },
  "Mid Fall": { start: 10, end: 11 },
  "Late Fall": { start: 11, end: 11 },
  Fall: { start: 9, end: 11 },
  Winter: { start: 12, end: 2 },
  "Year Round": { start: 1, end: 12 },
};

function mapCharacteristics(chars: PlantCharacteristic[]): MappedCharacteristics {
  const byName = new Map<string, string>();
  for (const c of chars) byName.set(c.PlantCharacteristicName, c.PlantCharacteristicValue);

  const out: MappedCharacteristics = {};

  // Height: USDA reports a single "mature height in feet". We have no min
  // from USDA, so emit the same value as min and max; reviewer can widen it.
  const htFeet = parseFloat(byName.get("Height, Mature (feet)") ?? "");
  if (Number.isFinite(htFeet) && htFeet > 0) {
    const inches = Math.round(htFeet * 12);
    out.height = { min: inches, max: inches };
  }

  // Light: USDA "Shade Tolerance" is inverse of our sun scale. Higher shade
  // tolerance → lower light-requirement values. Map to a range that reflects
  // what the plant *can* tolerate, not what it prefers.
  const shade = byName.get("Shade Tolerance");
  if (shade) {
    if (shade in SHADE_TOLERANCE_TO_LIGHT_MAP) {
      out.light = SHADE_TOLERANCE_TO_LIGHT_MAP[shade];
    } else {
      console.warn(`  [USDA] Unrecognized shade tolerance ${shade}`);
    }
  }

  // Moisture: "Moisture Use" is coarse but directionally correct.
  const moisture = byName.get("Moisture Use");
  if (moisture) {
    if (moisture in MOISTURE_USE_MAP) {
      out.moisture = MOISTURE_USE_MAP[moisture];
    } else {
      console.warn(`  [USDA] Unrecognized moisture use ${moisture}`);
    }
  }

  // Soil pH: USDA gives exact min/max.
  const phMin = parseFloat(byName.get("pH, Minimum") ?? "");
  const phMax = parseFloat(byName.get("pH, Maximum") ?? "");
  if (Number.isFinite(phMin) && Number.isFinite(phMax)) {
    out.soil_ph = { min: phMin, max: phMax };
  }

  // Drought tolerance: USDA has None/Low/Medium/High
  const drought = byName.get("Drought Tolerance");
  if (drought) {
    if (drought in DROUGHT_TOLERANCE_MAP) {
      out.drought_tolerance = DROUGHT_TOLERANCE_MAP[drought];
    } else {
      console.warn(`  [USDA] Unrecognized drought tolerance ${drought}`);
    }
  }

  // Bloom period: USDA uses season strings. Translate to month ranges.
  const bloom = byName.get("Bloom Period");
  if (bloom) {
    if (bloom in BLOOM_PERIODS) {
      out.bloom_time = BLOOM_PERIODS[bloom];
    } else {
      console.warn(`  [USDA] Unrecognized bloom period ${bloom}`);
    }
  }

  // Bloom color name: we can't guess hex — reviewer fills that.
  const flowerColor = byName.get("Flower Color");
  if (flowerColor && flowerColor !== "Conspicuous" && flowerColor !== "Inconspicuous") {
    out.bloom_color_name = flowerColor;
  }

  // Toxicity is deliberately *not* derived from USDA. USDA tracks livestock
  // toxicity only, and the schema's `null` is a strong "known-safe" assertion
  // that shouldn't be inferred from a silence on humans/pets. Leave as TODO
  // for the reviewer. Pass the raw livestock value through for context.
  const tox = byName.get("Toxicity");
  if (tox) {
    out.livestock_toxicity_hint = tox;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface UsdaResolved {
  symbol: string;
  id: number;
  matchedName: string;
  /** True when we matched via the accepted-row rather than a synonym row. */
  viaAccepted: boolean;
  commonName?: string;
  category?: PlantCategory;
  lifeCycle?: LifeCycle;
  /** Characteristic-derived fields, schema-shaped. */
  fields: MappedCharacteristics;
  /** Coarse region-level native/introduced flags from PlantProfile. */
  native: UsdaNativeSummary;
  /** Per-state presence codes (not native/introduced flags; USDA API limitation). */
  stateAbbrsWithPresence: string[];
  sourceUrl: string;
}

export async function resolveFromUsda(
  acceptedBinomial: string,
  cache: Cache,
  /** Fallback binomial tried when `acceptedBinomial` isn't in the checklist.
   * USDA sometimes keeps an older spelling (e.g. "Andropogon gerardii") that
   * GBIF has already migrated from ("gerardi"). Passing the input name keeps
   * us from losing USDA data to a nomenclatural disagreement. */
  fallbackBinomial?: string
): Promise<UsdaResolved | null> {
  const index = await loadPlantlstIndex();
  let entry = index.get(acceptedBinomial);
  if (!entry && fallbackBinomial && fallbackBinomial !== acceptedBinomial) {
    entry = index.get(fallbackBinomial);
  }
  if (!entry) return null;

  const profile = await fetchJson<PlantProfile>(
    `${API_BASE}/PlantProfile?symbol=${encodeURIComponent(entry.acceptedSymbol)}`,
    cache,
    `profile-${entry.acceptedSymbol}`
  );

  const chars = await fetchJson<PlantCharacteristic[]>(
    `${API_BASE}/PlantCharacteristics/${profile.Id}`,
    cache,
    `chars-${profile.Id}`
  );

  return {
    symbol: entry.acceptedSymbol,
    id: profile.Id,
    matchedName: entry.matchedName,
    viaAccepted: entry.viaAccepted,
    commonName: profile.CommonName || undefined,
    category: mapCategory(profile.GrowthHabits),
    lifeCycle: mapLifeCycle(profile.Durations),
    fields: mapCharacteristics(chars),
    native: summarizeNativeStatuses(profile.NativeStatuses),
    stateAbbrsWithPresence: (profile.MapCoordinates ?? [])
      .map((m) => m.StateAbbr)
      .filter((s) => s && s !== "L48"),
    sourceUrl: `https://plants.usda.gov/plant-profile/${entry.acceptedSymbol}`,
  };
}
