/**
 * Spatial index over US counties (TIGER 2024) and Canadian census divisions
 * (StatCan 2021). Built once per process from the committed geojson artifacts
 * in [tools/data/geo](../../../../tools/data/geo) and reused for every
 * occurrence lookup.
 *
 * Two trees, not one: a single tree spanning North America would force every
 * GBIF point through both polygon sets. GBIF tags each occurrence with a
 * `countryCode`, so the caller can pick the right tree up front and roughly
 * halve the candidate count.
 *
 * Each indexed entry carries the polygon geometry it was derived from so
 * `classify.ts` can do the precise point-in-polygon check after the bbox
 * prefilter.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import RBush from "rbush";
import type { MultiPolygon, Polygon, Position } from "geojson";

const GEO_DIR = fileURLToPath(import.meta.resolve("../../../data/geo"));

/**
 * RBush requires `minX/minY/maxX/maxY` on each entry; we tack on the polygon
 * code and geometry for the post-filter. `code` is a 5-digit FIPS for US
 * counties or a 4-digit CDUID for Canadian census divisions.
 */
export interface IndexedSubdivision {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  code: string;
  /** County or CD name from the source geojson; used for human-readable
   * review annotations in `_meta.distribution_review`. */
  name: string;
  geometry: Polygon | MultiPolygon;
}

export interface GeoIndex {
  us: RBush<IndexedSubdivision>;
  ca: RBush<IndexedSubdivision>;
  /** Code → name lookup for both countries; used to render review hints in
   * `_meta.distribution_review` without re-walking the rbush. Codes are
   * globally unique across US (5-digit) and CA (4-digit). */
  nameByCode: Map<string, string>;
}

let cached: GeoIndex | null = null;

export async function loadGeoIndex(): Promise<GeoIndex> {
  if (cached) return cached;

  const [usFeatures, caFeatures] = await Promise.all([
    readFeatures(path.join(GEO_DIR, "us-counties-2024.geojson"), "GEOID", "NAME"),
    readFeatures(path.join(GEO_DIR, "ca-divisions-2021.geojson"), "CDUID", "CDNAME"),
  ]);

  const us = new RBush<IndexedSubdivision>();
  us.load(usFeatures);
  const ca = new RBush<IndexedSubdivision>();
  ca.load(caFeatures);

  const nameByCode = new Map<string, string>();
  for (const f of usFeatures) {
    nameByCode.set(f.code, f.name);
  }
  for (const f of caFeatures) {
    nameByCode.set(f.code, f.name);
  }

  cached = { us, ca, nameByCode };
  return cached;
}

interface FeatureCollectionShape {
  features: Array<{
    type: "Feature";
    geometry: Polygon | MultiPolygon;
    properties: Record<string, unknown>;
  }>;
}

async function readFeatures(
  filePath: string,
  codeProperty: string,
  nameProperty: string
): Promise<IndexedSubdivision[]> {
  const text = await readFile(filePath, "utf8");
  const fc = JSON.parse(text) as FeatureCollectionShape;
  const out: IndexedSubdivision[] = [];
  for (const feature of fc.features) {
    const code = feature.properties?.[codeProperty];
    if (typeof code !== "string" || !code) {
      continue;
    }
    const rawName = feature.properties?.[nameProperty];
    const name = typeof rawName === "string" ? rawName : "";
    const boundingBox = computeBoundingBox(feature.geometry);
    if (!boundingBox) {
      continue;
    }
    out.push({
      minX: boundingBox[0],
      minY: boundingBox[1],
      maxX: boundingBox[2],
      maxY: boundingBox[3],
      code,
      name,
      geometry: feature.geometry,
    });
  }
  return out;
}

/**
 * Walk every coordinate to derive the bounding box. Source geojsons don't
 * carry a feature-level `bbox` (they were emitted by mapshaper without one),
 * and computing it once at index build time is cheaper than recomputing per
 * lookup.
 */
function computeBoundingBox(
  geometry: Polygon | MultiPolygon
): [number, number, number, number] | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const visitRing = (ring: Position[]) => {
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  };

  if (geometry.type === "Polygon") {
    for (const ring of geometry.coordinates) {
      visitRing(ring);
    }
  } else {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        visitRing(ring);
      }
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }
  return [minX, minY, maxX, maxY];
}
