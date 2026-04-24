/**
 * Lady Bird Johnson Wildflower Center (wildflower.org) source.
 *
 * LBJWC carries authoritative NA-native trait data — height, bloom timing,
 * bloom color, light, moisture, root type — linked by the same USDA symbol
 * we resolve via the PLANTS checklist. No API; we fetch the HTML page and
 * parse the stable `<strong>Label:</strong> value <br />` markup inside
 * three fixed `<h4>` sections:
 *
 *   Plant Characteristics:  Duration, Habit, Root Type, Size Notes, …
 *   Bloom Information:      Bloom Color, Bloom Time
 *   Growing Conditions:     Water Use, Light Requirement, Soil Moisture
 *
 * HTML parsing is done with cheerio against the real DOM tree (not regex),
 * so minor markup changes — whitespace, attribute ordering, glossary-link
 * variations — don't break extraction.
 *
 * The page URL is keyed on USDA symbol:
 *   https://www.wildflower.org/plants/result.php?id_plant=<SYMBOL>
 *
 * Responses cache aggressively under `.cache/wildflower-center/<symbol>.html`
 * so we're a one-shot request per species across repeated runs.
 */

import * as cheerio from "cheerio";

import type { Cache } from "../cache.ts";
import type {
  LifeCycle,
  Month,
  OneThroughFive,
  PlantCategory,
  RootType,
} from "../types.ts";

const BASE = "https://www.wildflower.org/plants/result.php";

// ---------------------------------------------------------------------------
// HTML → section map (cheerio-driven)
// ---------------------------------------------------------------------------

const SECTIONS = [
  "Plant Characteristics",
  "Bloom Information",
  "Growing Conditions",
] as const;
type SectionName = (typeof SECTIONS)[number];

type SectionMap = Map<SectionName, Map<string, string>>;

/**
 * Parse the LBJWC page into a nested map: section → label → value.
 *
 * For each known section heading, locate the `<h4>` that contains it, then
 * walk forward through its sibling stream. `<strong>Label:</strong>` opens
 * a new field; the following content (text, `<a>` glossary links, etc.)
 * accumulates into that field's value until the next `<br>`, `<strong>`,
 * or `<h4>` closes or transitions the field.
 *
 * This is obviously brittle to markup changes.
 */

function parseSections(html: string): SectionMap {
  const $ = cheerio.load(html);
  const out: SectionMap = new Map();

  const sectionH4s: { [name in SectionName]?: ReturnType<typeof $>[number] } = {};

  for (const h4Node of $("h4")) {
    const text = $(h4Node).text().trim() as SectionName;
    if (SECTIONS.includes(text)) {
      sectionH4s[text] = h4Node;
    }
  }

  for (const [sectionName, h4Node] of Object.entries(sectionH4s)) {
    const fields = new Map<string, string>();

    let label: string | null = null;
    let accum: string[] = [];
    const commit = () => {
      if (label === null) {
        return;
      }
      fields.set(label, accum.join(" ").replace(/\s+/g, " ").trim());
      label = null;
      accum = [];
    };

    let nextSibling = h4Node.nextSibling;
    loop: while (nextSibling) {
      if (nextSibling.type === "tag") {
        switch (nextSibling.name) {
          case "h4": {
            // Encountered the start of a new section; break out of loop to stop processing this section.
            break loop;
          }
          case "strong": {
            // New field label; commit the previous one and start accumulating the next.
            commit();
            // Get the text content of the <strong> as the new label, stripping trailing colons and whitespace.
            label = $(nextSibling).text().trim().replace(/:$/, "").trim();
            break;
          }
          case "br": {
            // Line break; commit the current field
            commit();
            break;
          }
          default: {
            if (label !== null) {
              // If we have a label, accumulate the text content of this node into the current field
              accum.push($(nextSibling).text());
            }
            break;
          }
        }
      } else if (nextSibling.type === "text" && label !== null) {
        // Plain text node; accumulate into current field if we have a label.
        accum.push(nextSibling.data ?? "");
      }

      nextSibling = nextSibling?.nextSibling;
    }

    commit();

    out.set(sectionName as SectionName, fields);
  }

  return out;
}

/** Split a "Foo , Bar , Baz" list — the source HTML uses odd whitespace
 * around commas. Values keep their original casing so downstream matching
 * against our label maps stays exact. */
function splitList(value: string): string[] {
  return value
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

// Shared building blocks for the Size Notes regexes below. Each regex
// captures its own `unit` group so conversion to inches is keyed on what
// *this* match actually saw — no separate upfront unit-detection pass.
const NUMBER_PART = String.raw`\d+(?:\.\d+)?`;
const UNIT_PART = String.raw`(?<unit>inch|inches|in\.?|ft\.?|feet|foot)`;

/** "3-6 ft", "3 to 6 feet", "24-36 inches". Captures `min`, `max`, `unit`. */
const SIZE_RANGE_REGEX = new RegExp(
  `(?<min>${NUMBER_PART})\\s*(?:to|[-–—])\\s*(?<max>${NUMBER_PART})\\s*${UNIT_PART}`
);

/**
 * "up to 4 feet", "to 40 ft", "reaching 6 feet". The `\s+` after each
 * optional qualifier (about/approximately/around) is load-bearing — without
 * it the regex silently fails on strings like "up to about 2 feet" and
 * falls through to the single-value path. Trailing `\+?` tolerates
 * "100+ ft". Captures `max`, `unit`.
 */
const SIZE_UPPER_REGEX = new RegExp(
  `(?:up\\s*to|to|reaching|reaches)\\s+(?:(?:about|approximately|around)\\s+)?(?<max>${NUMBER_PART})\\+?\\s*${UNIT_PART}`
);

/** "4 feet tall" — fallback when no range or upper bound appears.
 *  Captures `value`, `unit`. */
const SIZE_SINGLE_REGEX = new RegExp(`(?<value>${NUMBER_PART})\\s*${UNIT_PART}`);

const INCH_UNIT_REGEX = /^(?:inch|inches|in)/;

/** Convert a number in the given unit to inches, rounded. */
function toInches(value: number, unit: string): number {
  return INCH_UNIT_REGEX.test(unit) ? Math.round(value) : Math.round(value * 12);
}

/**
 * Parse a "Size Notes" prose value into inches. Handles the common patterns
 * LBJWC uses; returns undefined when the text doesn't match any of them.
 *
 *   "Up to about 4 feet tall."            → { min: 0, max: 48 }
 *   "3-6 ft."                             → { min: 36, max: 72 }
 *   "24 to 36 in."                        → { min: 24, max: 36 }
 *   "To 40 feet tall"                     → { min: 0, max: 480 }
 *   "4 feet tall"                         → { min: 48, max: 48 }
 *   "Height to 100+ ft. Width 60 to 80 ft."
 *                                         → { min: 0, max: 1200 }   (height clause only)
 */
export function parseSizeNotes(text: string): { min: number; max: number } | undefined {
  if (!text) {
    return undefined;
  }
  // If the prose talks about both height and width (common for trees/shrubs),
  // isolate the height clause before running number regexes — otherwise
  // numbers from the width clause bleed into the answer.
  const normalized = scopeToHeightClause(text).toLowerCase();

  const range = SIZE_RANGE_REGEX.exec(normalized)?.groups;
  if (range) {
    return {
      min: toInches(parseFloat(range.min), range.unit),
      max: toInches(parseFloat(range.max), range.unit),
    };
  }

  const upper = SIZE_UPPER_REGEX.exec(normalized)?.groups;
  if (upper) {
    return { min: 0, max: toInches(parseFloat(upper.max), upper.unit) };
  }

  const single = SIZE_SINGLE_REGEX.exec(normalized)?.groups;
  if (single) {
    const v = toInches(parseFloat(single.value), single.unit);
    return { min: v, max: v };
  }

  return undefined;
}

const DIMENSION_REGEX = /\b(height|tall|width|spread)\b/;
const CLAUSE_BOUNDARY_REGEX = /(?<=[.;])\s+/;
const HEIGHT_CLAUSE_REGEX = /\b(height|tall)\b/i;
const SPREAD_CLAUSE_REGEX = /\b(width|spread)\b/i;

/**
 * LBJWC's "Size Notes" often cover both height and width in one field
 * ("Height to 100+ ft. Width 60 to 80 ft."). If the text contains a "width"
 * or "spread" clause, strip that clause off so the height parser isn't
 * fooled. If a "height" word is present, keep only the clause that contains
 * it; otherwise return the original text (simple forb entries read as one
 * sentence with no disambiguating label).
 */
function scopeToHeightClause(text: string): string {
  const lower = text.toLowerCase();
  if (!DIMENSION_REGEX.test(lower)) {
    return text;
  }
  // Split on sentence-ish boundaries; keep clauses that mention height/tall.
  const clauses = text.split(CLAUSE_BOUNDARY_REGEX);
  const heightClauses = clauses.filter((c) => HEIGHT_CLAUSE_REGEX.test(c));
  if (heightClauses.length > 0) {
    return heightClauses.join(" ");
  }

  // Filter out any spread related clauses and just return what we have, or the original text
  // if we ended up with nothing after filtering.
  return clauses.filter((c) => !SPREAD_CLAUSE_REGEX.test(c)).join(" ") || text;
}

const MONTH_ABBR: Record<string, Month> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseBloomTime(value: string): { start: Month; end: Month } | undefined {
  const parts = splitList(value);
  const months: Month[] = [];
  for (const p of parts) {
    const m = MONTH_ABBR[p.slice(0, 3).toLowerCase()];
    if (m) {
      months.push(m);
    }
  }
  if (months.length === 0) {
    return undefined;
  }
  months.sort((a, b) => a - b);
  return { start: months[0], end: months[months.length - 1] };
}

/**
 * Wildflower uses three coarse light labels. Combine them if multiple are
 * listed for one species: "Sun, Part Shade" → tolerates 3–5 on our scale.
 */
const LIGHT_MAP: Record<string, { min: OneThroughFive; max: OneThroughFive }> = {
  sun: { min: 4, max: 5 },
  "part shade": { min: 3, max: 4 },
  shade: { min: 1, max: 2 },
};

function parseLightRequirement(
  value: string
): { min: OneThroughFive; max: OneThroughFive } | undefined {
  return combineRanges(value, LIGHT_MAP, "Light Requirement", "LIGHT_MAP");
}

const MOISTURE_MAP: Record<string, { min: OneThroughFive; max: OneThroughFive }> = {
  dry: { min: 1, max: 2 },
  moist: { min: 3, max: 4 },
  wet: { min: 4, max: 5 },
};

function parseSoilMoisture(
  value: string
): { min: OneThroughFive; max: OneThroughFive } | undefined {
  return combineRanges(value, MOISTURE_MAP, "Soil Moisture", "MOISTURE_MAP");
}

/**
 * Look up each comma-separated label in `value` against `map` and union the
 * resulting ranges. Unknown labels are logged once to stderr with enough
 * context to fix the map — LBJWC can add new vocabulary at any time and we
 * want the signal to surface the next time a reviewer runs the tool, not
 * silently drop the data.
 */
function combineRanges(
  value: string,
  map: Record<string, { min: OneThroughFive; max: OneThroughFive }>,
  fieldLabel: string,
  mapName: string
): { min: OneThroughFive; max: OneThroughFive } | undefined {
  const labels = splitList(value).map((s) => s.toLowerCase());
  let min: OneThroughFive | undefined;
  let max: OneThroughFive | undefined;
  for (const l of labels) {
    const range = map[l];
    if (!range) {
      console.warn(
        `  [wildflower] unknown ${fieldLabel} label: "${l}" — add to ${mapName} if this should map to a range`
      );
      continue;
    }
    min = min === undefined ? range.min : (Math.min(min, range.min) as OneThroughFive);
    max = max === undefined ? range.max : (Math.max(max, range.max) as OneThroughFive);
  }
  if (min === undefined || max === undefined) {
    return undefined;
  }
  return { min, max };
}

const ROOT_TYPE_MAP: Record<string, RootType> = {
  Taproot: "Taproot",
  Fibrous: "Fibrous",
  Rhizomatous: "Rhizomatous",
  Rhizome: "Rhizomatous",
  Stoloniferous: "Stoloniferous",
  Bulb: "Bulb",
  Corm: "Corm",
};

function parseRootType(value: string): RootType | undefined {
  const first = splitList(value)[0];
  if (first && first in ROOT_TYPE_MAP) {
    return ROOT_TYPE_MAP[first];
  }
  console.warn(
    `  [wildflower] unknown Root Type label: "${first}" — add to ROOT_TYPE_MAP if this should map to a RootType`
  )
  return undefined;
}

const LIFE_CYCLE_DURATION_MAP: Record<string, LifeCycle> = {
  Annual: "Annual",
  Biennial: "Biennial",
  Perennial: "Perennial",
};

function parseDuration(value: string): LifeCycle | undefined {
  const labels = splitList(value);
  for (const l of labels) {
    if (l in LIFE_CYCLE_DURATION_MAP) {
      return LIFE_CYCLE_DURATION_MAP[l];
    }
  }
  console.warn(
    `  [wildflower] unknown Duration label(s): "${labels.join(", ")}" — add to LIFE_CYCLE_DURATION_MAP if this should map to a LifeCycle`
  );
  return undefined;
}

const HABIT_MAP: Record<string, PlantCategory> = {
  Tree: "Tree",
  Shrub: "Shrub",
  Subshrub: "Shrub",
  Vine: "Vine",
  Herb: "Forb",
  Graminoid: "Graminoid",
  Grass: "Graminoid",
  Cactus: "Succulent",
  Succulent: "Succulent",
  Fern: "Fern",
};

function parseHabit(value: string): PlantCategory | undefined {
  const labels = splitList(value);
  for (const l of labels) {
    if (l in HABIT_MAP) {
      return HABIT_MAP[l];
    }
  }
  console.warn(
    `  [wildflower] unknown Habit label(s): "${labels.join(", ")}" — add to HABIT_MAP if this should map to a PlantCategory`
  );
  return undefined;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface WildflowerResolved {
  url: string;
  /** Raw Wildflower labels preserved for the reviewer / _meta block. */
  raw: Record<string, string>;
  category?: PlantCategory;
  lifeCycle?: LifeCycle;
  height?: { min: number; max: number };
  heightRaw?: string;
  bloomTime?: { start: Month; end: Month };
  bloomColorNames?: string[];
  light?: { min: OneThroughFive; max: OneThroughFive };
  moisture?: { min: OneThroughFive; max: OneThroughFive };
  rootType?: RootType;
}

async function fetchHtml(symbol: string, cache: Cache): Promise<string> {
  const key = `${symbol}.html`;
  const cached = await cache.get<string>("wildflower-center", key);
  if (cached !== null) return cached;
  const url = `${BASE}?id_plant=${encodeURIComponent(symbol)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "openwilds-new-entry/0.1 (data curation; cache single req/species)" },
  });
  if (!res.ok) throw new Error(`Wildflower ${url}: ${res.status} ${res.statusText}`);
  const text = await res.text();
  await cache.set("wildflower-center", key, text);
  return text;
}

export async function resolveFromWildflower(
  usdaSymbol: string,
  cache: Cache
): Promise<WildflowerResolved | null> {
  const html = await fetchHtml(usdaSymbol, cache);

  const sections = parseSections(html);
  // If none of our expected section headings were present, the page is
  // likely a "no record found" stub (LBJWC returns 200 for these). Treat
  // as no-data rather than throwing.
  if (sections.size === 0) return null;

  const raw: Record<string, string> = {};
  const get = (section: SectionName, label: string): string | undefined =>
    sections.get(section)?.get(label);

  for (const fields of sections.values()) {
    for (const [k, v] of fields) {
      raw[k] = v;
    }
  }

  const out: WildflowerResolved = {
    url: `${BASE}?id_plant=${encodeURIComponent(usdaSymbol)}`,
    raw,
  };

  const habit = get("Plant Characteristics", "Habit");
  if (habit) {
    out.category = parseHabit(habit);
  }

  const duration = get("Plant Characteristics", "Duration");
  if (duration) {
    out.lifeCycle = parseDuration(duration);
  }

  const root = get("Plant Characteristics", "Root Type");
  if (root) {
    out.rootType = parseRootType(root);
  }

  const heightRaw = get("Plant Characteristics", "Size Notes");
  if (heightRaw) {
    out.heightRaw = heightRaw;
    out.height = parseSizeNotes(heightRaw);
  }

  const bloomTime = get("Bloom Information", "Bloom Time");
  if (bloomTime) {
    out.bloomTime = parseBloomTime(bloomTime);
  }

  const bloomColor = get("Bloom Information", "Bloom Color");
  if (bloomColor) {
    out.bloomColorNames = splitList(bloomColor);
  }

  const light = get("Growing Conditions", "Light Requirement");
  if (light) {
    out.light = parseLightRequirement(light);
  }

  const moisture = get("Growing Conditions", "Soil Moisture");
  if (moisture) {
    out.moisture = parseSoilMoisture(moisture);
  }

  return out;
}
