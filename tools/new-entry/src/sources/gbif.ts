/**
 * GBIF Backbone Taxonomy client.
 *
 * GBIF is the authoritative taxonomy resolver for the tool: every other source
 * is queried by the accepted name that GBIF returns. Input may be a synonym;
 * we dereference to the accepted usageKey before fetching details.
 *
 * Endpoints used:
 *   GET /v1/species/match?name=...           fuzzy name match; tells us synonymy
 *   GET /v1/species/{key}                    canonical species record
 *   GET /v1/species/{key}/vernacularNames    common names across languages
 *   GET /v1/species/{key}/synonyms           taxonomic synonyms
 *
 * All responses are cached under `.cache/gbif/`.
 */

import type { Cache } from "../cache.ts";
import { cacheKey } from "../cache.ts";

const BASE = "https://api.gbif.org/v1";

// ---------------------------------------------------------------------------
// Raw API response shapes (only fields we actually read)
// ---------------------------------------------------------------------------

interface GbifMatch {
  usageKey?: number;
  acceptedUsageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  rank?: string;
  status?: string;
  matchType: "EXACT" | "FUZZY" | "HIGHERRANK" | "NONE";
  synonym?: boolean;
  family?: string;
  genus?: string;
  species?: string;
}

interface GbifSpecies {
  key: number;
  canonicalName?: string;
  scientificName?: string;
  rank?: string;
  taxonomicStatus?: string;
  family?: string;
  genus?: string;
  species?: string;
  specificEpithet?: string;
}

interface GbifVernacular {
  vernacularName?: string;
  language?: string;
  country?: string;
  preferred?: boolean;
  source?: string;
}

interface GbifPage<T> {
  results?: T[];
  endOfRecords?: boolean;
}

// ---------------------------------------------------------------------------
// Public result shape
// ---------------------------------------------------------------------------

export interface GbifResolved {
  acceptedKey: number;
  /** "Quercus alba" — no authorship. */
  acceptedName: string;
  /** "Quercus alba L." — with authorship. */
  acceptedScientific: string;
  matchType: GbifMatch["matchType"];
  /** True when the input was a synonym that GBIF redirected to an accepted name. */
  inputWasSynonym: boolean;
  family: string;
  genus: string;
  specificEpithet: string;
  /** Deduped, English, title-cased; up to 5 candidates (reviewer trims). */
  commonNames: string[];
  /** Canonical names of all accepted synonyms. */
  synonyms: string[];
  /** Link back to the GBIF species page, for the `sources` citation. */
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function fetchJson<T>(
  url: string,
  cache: Cache,
  key: string
): Promise<T> {
  const cached = await cache.get<T>("gbif", key);
  if (cached !== null) {
    return cached;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GBIF ${url}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as T;
  await cache.set("gbif", key, json);
  return json;
}

export async function resolveFromGbif(
  inputName: string,
  cache: Cache
): Promise<GbifResolved> {
  const match = await fetchJson<GbifMatch>(
    `${BASE}/species/match?name=${encodeURIComponent(inputName)}`,
    cache,
    `match-${cacheKey(inputName)}`
  );

  if (match.matchType === "NONE" || !match.usageKey) {
    throw new Error(`GBIF could not match "${inputName}"`);
  }

  const acceptedKey =
    match.synonym && match.acceptedUsageKey
      ? match.acceptedUsageKey
      : match.usageKey;

  const [species, vernPage, synonymPage] = await Promise.all([
    fetchJson<GbifSpecies>(
      `${BASE}/species/${acceptedKey}`,
      cache,
      `species-${acceptedKey}`
    ),
    fetchJson<GbifPage<GbifVernacular>>(
      `${BASE}/species/${acceptedKey}/vernacularNames?limit=100`,
      cache,
      `vernacular-${acceptedKey}`
    ),
    fetchJson<GbifPage<GbifSpecies>>(
      `${BASE}/species/${acceptedKey}/synonyms?limit=100`,
      cache,
      `synonyms-${acceptedKey}`
    ),
  ]);

  // GBIF's /species/{key} often omits `specificEpithet` but always includes
  // `species` (the binomial). Derive the epithet from the binomial when needed.
  const genus = species.genus;
  const specificEpithet =
    species.specificEpithet ??
    (species.species && genus && species.species.startsWith(`${genus} `)
      ? species.species.slice(genus.length + 1)
      : undefined);

  if (!species.family || !genus || !specificEpithet) {
    throw new Error(
      `GBIF species ${acceptedKey} is missing family/genus/specificEpithet — likely not a species rank`
    );
  }

  return {
    acceptedKey,
    acceptedName: species.canonicalName ?? `${genus} ${specificEpithet}`,
    acceptedScientific: species.scientificName ?? species.canonicalName ?? "",
    matchType: match.matchType,
    inputWasSynonym: match.synonym === true,
    family: species.family,
    genus,
    specificEpithet,
    commonNames: collectCommonNames(vernPage.results ?? []),
    synonyms: collectSynonyms(synonymPage.results ?? []),
    sourceUrl: `https://www.gbif.org/species/${acceptedKey}`,
  };
}

// ---------------------------------------------------------------------------
// Vernacular / synonym post-processing
// ---------------------------------------------------------------------------

/**
 * Dedupe English vernacular names case-insensitively, ranked by a simple
 * score: `preferred` flag > US/CA origin > everything else. Returns up to 5
 * candidates — the reviewer trims to the 2–3 they want to keep.
 */
function collectCommonNames(raw: GbifVernacular[]): string[] {
  const seen = new Map<string, { name: string; score: number }>();
  for (const v of raw) {
    const name = v.vernacularName?.trim();
    if (!name) {
      continue;
    }
    // Require an explicit English language tag. GBIF sometimes carries
    // untagged entries that turn out to be romaji/transliteration of the
    // vernacular from a non-English source; dropping null-language entries
    // keeps the candidate list clean.
    const lang = v.language?.toLowerCase();
    if (lang !== "eng" && lang !== "en") {
      continue;
    }
    const titled = titleCase(name);
    const key = titled.toLowerCase();
    const score =
      (v.preferred ? 100 : 0) +
      (v.country === "US" || v.country === "CA" ? 10 : 0) +
      (v.source ? 1 : 0);
    const cur = seen.get(key);
    if (!cur || score > cur.score) {
      seen.set(key, { name: titled, score });
    }
  }
  return [...seen.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((x) => x.name);
}

/**
 * Keep only species-rank synonyms. GBIF's synonym list also includes
 * infraspecific ranks (FORM, VARIETY, SUBSPECIES) — those aren't alternative
 * *species* names a reader might search on, they're botanical subdivisions of
 * the accepted taxon.
 */
function collectSynonyms(raw: GbifSpecies[]): string[] {
  const seen = new Set<string>();
  for (const s of raw) {
    if (s.rank !== "SPECIES") {
      continue;
    }
    const name = s.canonicalName?.trim();
    if (!name) {
      continue;
    }
    seen.add(name);
  }
  return [...seen].sort();
}

function titleCase(s: string): string {
  return s
    .split(/(\s+|-)/)
    .map((w) =>
      /^\s+$|-/.test(w) ? w : w[0]?.toUpperCase() + w.slice(1).toLowerCase()
    )
    .join("");
}
