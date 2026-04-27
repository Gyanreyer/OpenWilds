/**
 * Classify a single occurrence point to a US county FIPS or Canadian census
 * division CDUID. The caller picks the index up front from GBIF's tagged
 * `countryCode`; we only do bbox prefilter + precise polygon test here.
 *
 * Returns `null` for offshore points and for the small fraction of records
 * that GBIF places just outside any polygon (rounding artifacts, or features
 * dropped during simplification — TIGER 2024 was simplified to 4% with
 * Visvalingam, CA divisions to 2%; some sliver geometries get clipped away).
 */

import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point } from "@turf/helpers";
import type { Feature, Polygon, MultiPolygon } from "geojson";
import type { GeoIndex } from "./index.ts";

export function classifyPoint(
  index: GeoIndex,
  lng: number,
  lat: number,
  country: "US" | "CA"
): string | null {
  const tree = country === "US" ? index.us : index.ca;
  // RBush bbox query: a single point is a degenerate bbox.
  const candidates = tree.search({
    minX: lng,
    minY: lat,
    maxX: lng,
    maxY: lat,
  });
  if (candidates.length === 0) {
    return null;
  }
  const pt = point([lng, lat]);
  for (const c of candidates) {
    const feature: Feature<Polygon | MultiPolygon> = {
      type: "Feature",
      geometry: c.geometry,
      properties: {},
    };
    if (booleanPointInPolygon(pt, feature)) {
      return c.code;
    }
  }
  return null;
}
