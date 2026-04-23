/**
 * Schema v2 — source of truth for `data/plantae/**\/data.yml`.
 *
 * Units and conventions are documented once in SCHEMA.md; this file mirrors
 * them in TypeScript. Fields the script cannot reliably fill in are marked
 * optional here and emitted as commented-out TODO lines in drafts, so the
 * YAML parses cleanly at every stage of review.
 *
 * Taxonomy (kingdom, family, genus, species) is not stored in the file —
 * it is encoded in the file path: data/<kingdom>/<family>/<genus>/<species>/data.yml
 */

// -----------------------------------------------------------------------------
// Enumerations
// -----------------------------------------------------------------------------

export type PlantCategory =
  | "Tree"
  | "Shrub"
  | "Graminoid"
  | "Fern"
  | "Forb"
  | "Vine"
  | "Succulent";

export type LifeCycle = "Annual" | "Biennial" | "Perennial";

export type RootType =
  | "Taproot"
  | "Fibrous"
  | "Rhizomatous"
  | "Stoloniferous"
  | "Bulb"
  | "Corm";

export type DroughtTolerance = "Low" | "Medium" | "High";

export type SoilType = "Sand" | "Silt" | "Loam" | "Clay" | "Gravel" | "Peat";

/** 1 = January, 12 = December. */
export type Month = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

/** Scale used for light (1=shade, 5=sun) and moisture (1=dry, 5=wet). */
export type OneThroughFive = 1 | 2 | 3 | 4 | 5;

/**
 * NatureServe conservation rank. Global ranks use the G-series; subnational
 * (state/province) ranks use the S-series. Uncertain ranges like "G3G4" are
 * valid; so are modifiers (?, Q). Kept as a plain string for now — tighten
 * once we actually integrate NatureServe.
 */
export type ConservationRank = string;

/**
 * Open content licenses we accept for images. `CC-BY-ND` is deliberately
 * excluded — we may downscale/convert, which is a derivative work.
 */
export type ImageLicense =
  | "CC0"
  | "CC-BY"
  | "CC-BY-SA"
  | "CC-BY-NC"
  | "CC-BY-NC-SA"
  | `CC-BY-${"1.0" | "2.0" | "2.5" | "3.0" | "4.0"}`
  | `CC-BY-SA-${"1.0" | "2.0" | "2.5" | "3.0" | "4.0"}`
  | `CC-BY-NC-${"1.0" | "2.0" | "2.5" | "3.0" | "4.0"}`
  | `CC-BY-NC-SA-${"1.0" | "2.0" | "2.5" | "3.0" | "4.0"}`;

export type ImageSource = "iNaturalist" | "Flickr" | "Wikimedia" | "Other";

// -----------------------------------------------------------------------------
// Leaf value shapes
// -----------------------------------------------------------------------------

/** Inclusive integer range. Use min === max for a single value. */
export interface IntRange {
  min: number;
  max: number;
}

/** Inclusive numeric range (floats allowed — used for soil pH). */
export interface NumRange {
  min: number;
  max: number;
}

export interface BloomTime {
  start: Month;
  end: Month;
}

export interface BloomColor {
  name: string;
  /** 6-digit hex including the leading `#`. */
  hex: `#${string}`;
}

export interface LightRange {
  min: OneThroughFive;
  max: OneThroughFive;
}

export interface MoistureRange {
  min: OneThroughFive;
  max: OneThroughFive;
}

/**
 * Toxicity per audience. `null` means "not known to be toxic" (a deliberate
 * assertion, not missing data). Any non-null string implies toxicity and
 * describes the symptom/scope briefly.
 */
export interface Toxicity {
  humans: string | null;
  pets: string | null;
  livestock: string | null;
}

/**
 * Distribution is split by country because the underlying coding schemes
 * differ (5-digit FIPS vs. 4-digit Statistics Canada CDUID).
 */
export interface Distribution {
  /** 5-digit FIPS codes (2-digit state + 3-digit county), e.g. "26163". */
  native_us_counties?: string[];
  /** 4-digit Statistics Canada CDUIDs (2-digit province + 2-digit CD), e.g. "3520". */
  native_ca_divisions?: string[];
}

/**
 * Global + subnational conservation rank. State/province keys are 2-letter
 * USPS or Canada Post codes.
 */
export interface ConservationStatus {
  global?: ConservationRank;
  state?: Record<string, ConservationRank>;
}

export interface ImageEntry {
  /** Path relative to the enclosing data.yml, e.g. "images/0.jpg". */
  local_path: string;
  /** Required. Used for alt text and search. Describe the image's content. */
  alt: string;
  /** Optional short display caption; omit if redundant with `alt`. */
  caption?: string;
  license: ImageLicense;
  creator_name: string;
  creator_url?: string;
  source: ImageSource;
  /**
   * Link back to the observation/photo page on the source site. Omit only
   * when the creator is themselves the original source (e.g., a first-party
   * photo with no upstream URL).
   */
  source_url?: string;
  /** ISO date (YYYY-MM-DD) when the photo was taken, if known. */
  observed_on?: string;
}

export interface SourceCitation {
  name: string;
  url: string;
  /** ISO date (YYYY-MM-DD) of retrieval. */
  accessed: string;
}

// -----------------------------------------------------------------------------
// Draft-only metadata
// -----------------------------------------------------------------------------

export type ConfidenceLevel = "low" | "medium" | "high";

/**
 * `_meta` is written on every generated draft and stripped (or moved to a
 * sidecar) when the entry is accepted. It is *not* part of the accepted
 * schema surface.
 */
export interface DraftMeta {
  generated_by: string;
  /** ISO date. */
  generated_at: string;
  /** Map of schema-field name -> free-text source description. */
  sources: Record<string, string>;
  /** Map of schema-field name -> confidence. Absent means "high/unstated". */
  confidence?: Record<string, ConfidenceLevel>;
}

// -----------------------------------------------------------------------------
// Top-level plant entry
// -----------------------------------------------------------------------------

export interface PlantData {
  // --- Identity ---
  scientific_name: string;
  common_names: string[];
  synonyms?: string[];

  // --- Habit ---
  category: PlantCategory;
  life_cycle: LifeCycle;

  // --- Flowering ---
  bloom_time?: BloomTime;
  /**
   * Always an array. Species with a single bloom color is a one-element list.
   * (The old v1 schema allowed a bare object here; v2 collapses that.)
   */
  bloom_color?: BloomColor[];

  // --- Size (inches) ---
  height: IntRange;
  spread?: IntRange;

  // --- Site preferences ---
  light: LightRange;
  moisture: MoistureRange;
  soil_type?: SoilType[];
  soil_ph?: NumRange;
  root_type?: RootType;
  drought_tolerance?: DroughtTolerance;

  // --- Ecology ---
  habitat?: string[];

  // --- Conservation / hazard ---
  conservation_status?: ConservationStatus;
  toxicity?: Toxicity;

  // --- Geography ---
  distribution?: Distribution;

  // --- Media ---
  images?: ImageEntry[];

  // --- Attribution ---
  sources: SourceCitation[];

  // --- Draft metadata (removed on accept) ---
  _meta?: DraftMeta;
}
