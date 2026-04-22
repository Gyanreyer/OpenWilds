/**
 * Site-facing re-export of the plant schema types.
 *
 * The source of truth lives in tools/new-entry/src/types.ts — this file
 * keeps the import path `site/types/plantData.js` stable for site code.
 *
 * In addition to the raw schema, this file exports site-specific view types
 * (e.g. the image shape produced by Eleventy's image pipeline at build time).
 */

export type {
  PlantData,
  PlantCategory,
  LifeCycle,
  RootType,
  DroughtTolerance,
  SoilType,
  Month,
  OneThroughFive,
  BloomTime,
  BloomColor,
  LightRange,
  MoistureRange,
  Toxicity,
  Distribution,
  ConservationStatus,
  ConservationRank,
  ImageEntry,
  ImageLicense,
  ImageSource,
  SourceCitation,
  IntRange,
  NumRange,
} from "../../tools/new-entry/src/types.js";

// ---------------------------------------------------------------------------
// Site-only view types (runtime image pipeline output, not in source YAML)
// ---------------------------------------------------------------------------

/** One rendition produced by `@11ty/eleventy-img`. */
export interface EleventyImageData {
  format: "webp" | "jpeg";
  width: number;
  height: number;
  url: string;
  sourceType: string;
  srcset: string;
  filename: string;
  outputPath: string;
  size: number;
}

import type { ImageEntry as SchemaImageEntry } from "../../tools/new-entry/src/types.js";

/**
 * An image as consumed by the site's plant page: the schema entry plus the
 * rendition data that `@11ty/eleventy-img` produces at build time.
 */
export interface BuiltImage {
  meta: SchemaImageEntry;
  jpeg: EleventyImageData[];
  webp: EleventyImageData[];
}
