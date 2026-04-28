/**
 * Bakes static SVG map artifacts from the committed geo data under
 * `tools/data/geo/`. Run as a one-shot whenever the upstream geometry refreshes
 * (after `prep-data.ts --only tiger|statcan`) or when the build options below
 * change.
 *
 *     node tools/build-svg-map/build.js
 *     # or:  npm run db:build-svg-map
 *
 * Three artifacts land in `tools/build-svg-map/dist/`:
 *
 *   us.svg   CONUS + Alaska (AK insetted, Albers-USA composite). HI and US
 *            territories are filtered out — different biogeography.
 *   ca.svg   Canada, full-extent Lambert Conformal Conic.
 *   na.svg   North America (US + CA), continental Albers Equal Area. AK is
 *            shown in its real geographic position here, not insetted.
 *
 * Each output uses the same DOM structure and id conventions:
 *
 *   <g id="us">
 *     <g id="us-counties">
 *       <path id="us-26163" class="co" data-name="Wayne"
 *             fill="var(--us-26163, #f5f5f0)" d="..."/>
 *     </g>
 *     <g id="us-states" pointer-events="none">
 *       <path id="us-state-26" class="st" data-name="Michigan"
 *             fill="var(--us-state-26, none)" d="..."/>
 *     </g>
 *   </g>
 *   <g id="ca"> ... mirrors with id="ca-3520" / id="ca-prov-35" ... </g>
 *
 * State and province paths are dissolved from their child counties / divisions
 * via topojson so the dissolved boundaries share vertices with — and therefore
 * align exactly to — the rendered county / division boundaries. They sit
 * above the counties layer with `pointer-events="none"` so clicks pass
 * through. Parent state / province for any county is derivable from the id
 * prefix; see README.md for the lookup convention.
 *
 * Class names are abbreviated for byte savings (co=county, dv=division,
 * st=state, pv=province). Each path's fill is wired to a CSS custom property
 * named after its id, with the file's default fill as the fallback —
 * consumers highlight by setting `--us-26163: <color>` etc. on a wrapper
 * element. Custom properties inherit through `<use>` shadow boundaries, so
 * highlighting works whether the SVG is inlined or loaded via
 * `<svg><use href="us.svg"/></svg>`.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  geoAlbersUsa,
  geoConicConformal,
  geoConicEqualArea,
  geoPath,
} from "d3-geo";
import { topology } from "topojson-server";
import { feature, mergeArcs } from "topojson-client";
import { presimplify, simplify } from "topojson-simplify";
import { optimize as svgoOptimize } from "svgo";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const GEO_DIR = path.join(REPO_ROOT, "tools", "data", "geo");
const DIST_DIR = path.join(HERE, "dist");

// HI + US territories — filtered out of every US-bearing artifact.
const US_EXCLUDED_STATE_FIPS = new Set(["15", "60", "66", "69", "72", "78"]);

/** @type {Record<string, string>} 2-digit state FIPS → USPS abbreviation. */
const US_STATE_ABBR = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "16": "ID",
  "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA",
  "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
  "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
  "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK",
  "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN",
  "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
  "55": "WI", "56": "WY",
};

/** @type {Record<string, string>} 2-digit state FIPS → full state name. */
const US_STATE_NAME = {
  "01": "Alabama", "02": "Alaska", "04": "Arizona", "05": "Arkansas",
  "06": "California", "08": "Colorado", "09": "Connecticut", "10": "Delaware",
  "11": "District of Columbia", "12": "Florida", "13": "Georgia",
  "16": "Idaho", "17": "Illinois", "18": "Indiana", "19": "Iowa",
  "20": "Kansas", "21": "Kentucky", "22": "Louisiana", "23": "Maine",
  "24": "Maryland", "25": "Massachusetts", "26": "Michigan", "27": "Minnesota",
  "28": "Mississippi", "29": "Missouri", "30": "Montana", "31": "Nebraska",
  "32": "Nevada", "33": "New Hampshire", "34": "New Jersey",
  "35": "New Mexico", "36": "New York", "37": "North Carolina",
  "38": "North Dakota", "39": "Ohio", "40": "Oklahoma", "41": "Oregon",
  "42": "Pennsylvania", "44": "Rhode Island", "45": "South Carolina",
  "46": "South Dakota", "47": "Tennessee", "48": "Texas", "49": "Utah",
  "50": "Vermont", "51": "Virginia", "53": "Washington", "54": "West Virginia",
  "55": "Wisconsin", "56": "Wyoming",
};

/** @type {Record<string, string>} 2-digit StatCan PRUID → Canada Post abbreviation. */
const CA_PROV_ABBR = {
  "10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC", "35": "ON",
  "46": "MB", "47": "SK", "48": "AB", "59": "BC", "60": "YT", "61": "NT",
  "62": "NU",
};

/** @type {Record<string, string>} 2-digit StatCan PRUID → full province / territory name. */
const CA_PROV_NAME = {
  "10": "Newfoundland and Labrador", "11": "Prince Edward Island",
  "12": "Nova Scotia", "13": "New Brunswick", "24": "Quebec",
  "35": "Ontario", "46": "Manitoba", "47": "Saskatchewan",
  "48": "Alberta", "59": "British Columbia", "60": "Yukon",
  "61": "Northwest Territories", "62": "Nunavut",
};

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** @typedef {import('geojson').Feature} Feature */
/** @typedef {import('geojson').FeatureCollection} FeatureCollection */

/** @param {string} filename */
async function loadGeoJSON(filename) {
  const text = await readFile(path.join(GEO_DIR, filename), "utf8");
  return /** @type {FeatureCollection} */ (JSON.parse(text));
}

/**
 * Escape a string for use as an XML attribute value.
 * @param {unknown} s
 * @returns {string}
 */
function escAttr(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Custom geoPath context: rounds every projected coordinate to the nearest
 * integer (viewBox pixel), skips lineTo commands whose target equals the
 * previous point, discards subpaths that contain no line segments, and
 * discards subpaths that are exact axis-aligned 4-vertex rectangles.
 *
 * The rectangle filter exists for `geoAlbersUsa`: its composite stream
 * emits the lower48/AK/HI clipExtent rectangles as part of *every* feature's
 * path. Stripping them strips ~90 chars per feature × thousands of features;
 * for us.svg this drops file size by roughly a third. Real polygon rings
 * essentially never coincide exactly with a 4-vertex axis-aligned rectangle
 * after projection, so the false-positive risk is negligible.
 */
class IntDedupePathContext {
  constructor() {
    /** @type {string} committed (non-empty, non-rect) subpaths */
    this.path = "";
    /** @type {string} current subpath being built */
    this.subpath = "";
    /** @type {number} line segments in current subpath */
    this.lineCount = 0;
    /** @type {number[]} flat vertices of the current subpath: [x0,y0,x1,y1,…] */
    this.ring = [];
    /** @type {number} */
    this.lastX = NaN;
    /** @type {number} */
    this.lastY = NaN;
  }
  /** @param {number} x @param {number} y */
  moveTo(x, y) {
    if (this.lineCount > 0 && !this.isAxisAlignedRect()) {
      this.path += this.subpath;
    }
    const ix = Math.round(x);
    const iy = Math.round(y);
    this.subpath = `M${ix},${iy}`;
    this.lineCount = 0;
    this.ring = [ix, iy];
    this.lastX = ix;
    this.lastY = iy;
  }
  /** @param {number} x @param {number} y */
  lineTo(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix === this.lastX && iy === this.lastY) return;
    this.subpath += `L${ix},${iy}`;
    this.lineCount++;
    this.ring.push(ix, iy);
    this.lastX = ix;
    this.lastY = iy;
  }
  arc() { /* unused for polygon geometry */ }
  closePath() {
    if (this.lineCount > 0 && !this.isAxisAlignedRect()) {
      this.path += this.subpath + "Z";
    }
    this.subpath = "";
    this.lineCount = 0;
    this.ring = [];
  }
  /** @returns {boolean} */
  isAxisAlignedRect() {
    // Exactly 4 distinct vertices (M + 3 L), axis-aligned (alternating
    // horizontal / vertical edges), AND large enough (>=50 px on either
    // dimension) to be a projection clip-extent frame rather than a real
    // small polygon. Without the size guard we drop legitimate small
    // counties — Iowa is famous for its near-square county grid, and a
    // handful of VA independent cities round to 4-vertex rectangles after
    // simplification.
    if (this.ring.length !== 8) return false;
    const [ax, ay, bx, by, cx, cy, dx, dy] = this.ring;
    if (ay !== by || bx !== cx || cy !== dy || dx !== ax) return false;
    const w = Math.abs(bx - ax);
    const h = Math.abs(cy - by);
    return w >= 50 && h >= 50;
  }
  /** @returns {string} */
  drain() {
    if (this.lineCount > 0 && !this.isAxisAlignedRect()) {
      this.path += this.subpath;
    }
    const s = this.path;
    this.path = "";
    this.subpath = "";
    this.lineCount = 0;
    this.ring = [];
    this.lastX = NaN;
    this.lastY = NaN;
    return s;
  }
}

/** @param {number} n @returns {string} */
function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/**
 * Identity stream wrapper used to override d3-geo's default antimeridian
 * preclip on conic projections. Typed as `(s: any) => any` because d3-geo's
 * exported `GeoStream` type isn't trivial to satisfy through JSDoc and we
 * really do just want to forward the stream untouched.
 *
 * @param {*} s
 * @returns {*}
 */
const passThroughStream = (s) => s;

/**
 * Unified pipeline: build a topology with both the subdivisions
 * (counties / divisions) and a derived parents layer (states / provinces),
 * simplify both consistently in one pass so their shared borders use the
 * exact same vertex set, and convert back to GeoJSON.
 *
 * `minWeight` is the Visvalingam triangle-area threshold (in steradians,
 * since presimplify defaults to spherical area on lat/lng coords). Points
 * whose weight is below the threshold are dropped. Calibrated empirically
 * against viewBox-pixel scale (see WEIGHTS constants in main()).
 *
 * @param {FeatureCollection} fc
 * @param {(properties: any) => string | null} prefixFn
 * @param {number} minWeight
 */
function simplifyAndDissolve(fc, prefixFn, minWeight) {
  let topo = topology({ subs: fc });

  // Build the parents layer in topology space so it shares arcs with subs.
  // Doing this BEFORE simplify means the dissolved boundaries reuse the same
  // arcs as the sub-features, so they get simplified consistently.
  const groups = new Map();
  for (const g of topo.objects.subs.geometries) {
    const code = prefixFn(g.properties);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(g);
  }
  const parentGeometries = [];
  for (const [code, geoms] of groups) {
    const merged = mergeArcs(topo, geoms);
    parentGeometries.push({ ...merged, properties: { __code: code } });
  }
  topo.objects.parents = {
    type: "GeometryCollection",
    geometries: parentGeometries,
  };

  topo = presimplify(topo);
  topo = simplify(topo, minWeight);

  // topojson-client's `feature()` returns either a single Feature or a
  // FeatureCollection depending on the object kind; here both are
  // GeometryCollections so we always get back a FeatureCollection. The cast
  // tells TS what we know.
  return {
    subdivisions: /** @type {FeatureCollection} */ (feature(topo, topo.objects.subs)),
    parents: /** @type {FeatureCollection} */ (feature(topo, topo.objects.parents)),
  };
}

/**
 * @param {FeatureCollection} fc
 * @param {(f: Feature) => boolean} pred
 * @returns {FeatureCollection}
 */
function filterFeatures(fc, pred) {
  return /** @type {FeatureCollection} */ ({
    type: "FeatureCollection",
    features: fc.features.filter(pred),
  });
}

// -----------------------------------------------------------------------------
// Path renderers
// -----------------------------------------------------------------------------

// Each subdivision and parent path emits `fill="var(--<id>, <default>)"` so
// consumers can highlight by setting CSS custom properties on a wrapper or
// the <use> element. Custom properties inherit through the SVG <use> shadow
// boundary (where outer ID selectors can't), so this scheme works whether
// the SVG is inlined into the page or loaded via <use href="us.svg#us">.
const COUNTY_DEFAULT_FILL = "#f5f5f0";   // matches .county / .division base fill
const STATE_DEFAULT_FILL = "none";       // states/provinces are stroke-only by default

// Paths only carry attributes that aren't derivable from the id:
//   id        — primary key, also the CSS variable name for highlighting
//   class     — drives stroke styling in the embedded <style>
//   data-name — human-readable label for tooltips (not derivable)
//   fill      — `var(--<id>, <default>)` highlight hook
//   d         — geometry
// Things we deliberately *don't* emit:
//   data-code      — redundant with id (literal duplicate of the same value)
//   data-state     — derivable: first 2 chars of a 5-digit US FIPS map to USPS
//   data-province  — derivable: first 2 chars of a 4-digit CDUID map to postal
// Consumers that want the parent state / province for a feature should derive
// it on demand from the id (see DOM-attribute notes in README.md).

/**
 * Resolve a feature's path data. If the feature is too small to produce any
 * geometry at viewBox-pixel scale (after simplify + integer rounding), fall
 * back to a 1-pixel placeholder at the projected centroid so the feature's
 * id/highlight hook is still addressable. Without this, ~5 tiny VA
 * independent cities (Falls Church, Manassas Park, etc.) lose their ids and
 * become un-highlightable.
 *
 * @param {Feature} f
 * @param {(feature: Feature) => void} pathGen — geoPath bound to `ctx`
 * @param {IntDedupePathContext} ctx
 * @param {{ centroid(feature: Feature): [number, number] }} measurePath — geoPath without ctx
 * @returns {string | null}
 */
function pathDataOrPlaceholder(f, pathGen, ctx, measurePath) {
  pathGen(f);
  const d = ctx.drain();
  if (d) return d;
  const c = measurePath.centroid(f);
  if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) return null;
  const cx = Math.round(c[0]);
  const cy = Math.round(c[1]);
  return `M${cx},${cy}h1v1h-1z`;
}

/** @typedef {Parameters<typeof pathDataOrPlaceholder>[1]} PathGenFn */
/** @typedef {Parameters<typeof pathDataOrPlaceholder>[3]} MeasurePath */

/**
 * @param {Feature[]} features
 * @param {PathGenFn} pathGen
 * @param {IntDedupePathContext} ctx
 * @param {MeasurePath} measurePath
 * @returns {string}
 */
function renderUsCountyPaths(features, pathGen, ctx, measurePath) {
  const out = [];
  for (const f of features) {
    const d = pathDataOrPlaceholder(f, pathGen, ctx, measurePath);
    if (!d) continue;
    const props = /** @type {Record<string, string>} */ (f.properties);
    const code = props.GEOID;
    const name = props.NAME ?? "";
    out.push(
      `<path id="us-${code}" class="co" data-name="${escAttr(name)}" fill="var(--us-${code}, ${COUNTY_DEFAULT_FILL})" d="${d}"/>`
    );
  }
  return out.join("\n");
}

/**
 * @param {Feature[]} features
 * @param {PathGenFn} pathGen
 * @param {IntDedupePathContext} ctx
 * @param {MeasurePath} measurePath
 * @returns {string}
 */
function renderUsStatePaths(features, pathGen, ctx, measurePath) {
  const out = [];
  for (const f of features) {
    const d = pathDataOrPlaceholder(f, pathGen, ctx, measurePath);
    if (!d) continue;
    const props = /** @type {Record<string, string>} */ (f.properties);
    const fips = props.__code;
    const name = US_STATE_NAME[fips] ?? "";
    out.push(
      `<path id="us-state-${fips}" class="st" data-name="${escAttr(name)}" fill="var(--us-state-${fips}, ${STATE_DEFAULT_FILL})" d="${d}"/>`
    );
  }
  return out.join("\n");
}

/**
 * @param {Feature[]} features
 * @param {PathGenFn} pathGen
 * @param {IntDedupePathContext} ctx
 * @param {MeasurePath} measurePath
 * @returns {string}
 */
function renderCaDivisionPaths(features, pathGen, ctx, measurePath) {
  const out = [];
  for (const f of features) {
    const d = pathDataOrPlaceholder(f, pathGen, ctx, measurePath);
    if (!d) continue;
    const props = /** @type {Record<string, string>} */ (f.properties);
    const code = props.CDUID;
    const name = props.CDNAME ?? "";
    out.push(
      `<path id="ca-${code}" class="dv" data-name="${escAttr(name)}" fill="var(--ca-${code}, ${COUNTY_DEFAULT_FILL})" d="${d}"/>`
    );
  }
  return out.join("\n");
}

/**
 * @param {Feature[]} features
 * @param {PathGenFn} pathGen
 * @param {IntDedupePathContext} ctx
 * @param {MeasurePath} measurePath
 * @returns {string}
 */
function renderCaProvincePaths(features, pathGen, ctx, measurePath) {
  const out = [];
  for (const f of features) {
    const d = pathDataOrPlaceholder(f, pathGen, ctx, measurePath);
    if (!d) continue;
    const props = /** @type {Record<string, string>} */ (f.properties);
    const pruid = props.__code;
    const name = CA_PROV_NAME[pruid] ?? "";
    out.push(
      `<path id="ca-prov-${pruid}" class="pv" data-name="${escAttr(name)}" fill="var(--ca-prov-${pruid}, ${STATE_DEFAULT_FILL})" d="${d}"/>`
    );
  }
  return out.join("\n");
}

// Class names are abbreviated for byte savings:
//   co = county  dv = division  st = state  pv = province
// The embedded style sheet sets stroke conventions; fills come from the
// per-path `fill="var(--<id>, <default>)"` attributes above.
const EMBEDDED_STYLE = `<style>
    .co, .dv { stroke: #d8d4c8; stroke-width: 0.5; vector-effect: non-scaling-stroke; }
    .st, .pv { stroke: #777; stroke-width: 1; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
  </style>`;

/**
 * Compose a full SVG document. Uses the geometry's projected bounds to pick a
 * viewBox aspect ratio that fits the content tightly (no letterboxing).
 *
 * @param {object} options
 * @param {*} options.projection — d3-geo projection (call before fitSize)
 * @param {{ counties: FeatureCollection, states: FeatureCollection } | null} options.us
 * @param {{ divisions: FeatureCollection, provinces: FeatureCollection } | null} options.ca
 * @returns {string}
 */
function renderSvg({ projection, us, ca }) {
  // Combined fit target — projection scale will fit all geometry from both
  // countries if both are present.
  const fitFeatures = [
    ...(us ? us.counties.features : []),
    ...(ca ? ca.divisions.features : []),
  ];
  const fitTarget = { type: "FeatureCollection", features: fitFeatures };

  // First fit: arbitrary box, used to read true aspect ratio of the projected
  // geometry. Then re-fit at a sensible width with that aspect.
  projection.fitSize([1000, 1000], fitTarget);
  const [[x0, y0], [x1, y1]] = geoPath(projection).bounds(fitTarget);
  const aspect = (x1 - x0) / (y1 - y0);
  const width = 1200;
  const height = Math.round(width / aspect);
  projection.fitSize([width, height], fitTarget);

  // Disable adaptive resampling: d3-geo's default precision (0.707px) inserts
  // sub-pixel intermediate points along projection-curved arcs, which inflates
  // path data with vertices that all collapse to the same integer pixel
  // anyway. Composite projections like geoAlbersUsa don't expose precision();
  // their sub-projections inherit the default. For non-composite projections
  // (Lambert, Albers Equal Area), bumping precision above the
  // integer-rounding threshold cuts SVG size by ~3-5x with no visible
  // difference.
  if (typeof projection.precision === "function") {
    projection.precision(2);
  }

  const ctx = new IntDedupePathContext();
  const pathGen = geoPath(projection, ctx);
  // Separate path generator (no custom context) used to compute centroids
  // for the placeholder fallback in pathDataOrPlaceholder().
  const measurePath = geoPath(projection);

  let body = "";
  if (us) {
    body +=
      `  <g id="us">\n` +
      `    <g id="us-counties">\n` +
      renderUsCountyPaths(us.counties.features, pathGen, ctx, measurePath) +
      `\n    </g>\n` +
      `    <g id="us-states" pointer-events="none">\n` +
      renderUsStatePaths(us.states.features, pathGen, ctx, measurePath) +
      `\n    </g>\n` +
      `  </g>\n`;
  }
  if (ca) {
    body +=
      `  <g id="ca">\n` +
      `    <g id="ca-divisions">\n` +
      renderCaDivisionPaths(ca.divisions.features, pathGen, ctx, measurePath) +
      `\n    </g>\n` +
      `    <g id="ca-provinces" pointer-events="none">\n` +
      renderCaProvincePaths(ca.provinces.features, pathGen, ctx, measurePath) +
      `\n    </g>\n` +
      `  </g>\n`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
  ${EMBEDDED_STYLE}
${body}</svg>\n`;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  await mkdir(DIST_DIR, { recursive: true });

  console.log("loading geojsons...");
  const usCountiesAll = await loadGeoJSON("us-counties-2024.geojson");
  const caDivisions = await loadGeoJSON("ca-divisions-2021.geojson");

  // Filter US to drop HI + territories.
  const usCountiesFiltered = filterFeatures(
    usCountiesAll,
    (f) => f.properties != null && !US_EXCLUDED_STATE_FIPS.has(f.properties.GEOID.slice(0, 2))
  );
  console.log(
    `  us counties: ${usCountiesFiltered.features.length} (filtered ${usCountiesAll.features.length - usCountiesFiltered.features.length} HI/territory)`
  );
  console.log(`  ca divisions: ${caDivisions.features.length}`);

  // Visvalingam minimum triangle-area thresholds (spherical, steradians).
  // Calibrated empirically against viewBox-pixel scale. Higher = more
  // aggressive simplification.
  //   US: 6e-4 cleans up sub-pixel coastal noise (TX gulf, AK Aleutians,
  //       mid-Atlantic barrier islands) without flattening visible detail on
  //       state/county borders.
  //   CA: 8e-4 — more aggressive because Arctic island detail otherwise
  //       renders as sub-pixel specks that bloat path data.
  const US_SIMPLIFY_WEIGHT = 6e-4;
  const CA_SIMPLIFY_WEIGHT = 8e-4;
  console.log("\nsimplifying + dissolving topologies...");
  const us = (() => {
    const r = simplifyAndDissolve(
      usCountiesFiltered,
      (props) => props.GEOID.slice(0, 2),
      US_SIMPLIFY_WEIGHT
    );
    return { counties: r.subdivisions, states: r.parents };
  })();
  console.log(`  us counties (post-simplify): ${us.counties.features.length}`);
  console.log(`  us states: ${us.states.features.length}`);

  const ca = (() => {
    const r = simplifyAndDissolve(
      caDivisions,
      (props) => props.CDUID.slice(0, 2),
      CA_SIMPLIFY_WEIGHT
    );
    return { divisions: r.subdivisions, provinces: r.parents };
  })();
  console.log(`  ca divisions (post-simplify): ${ca.divisions.features.length}`);
  console.log(`  ca provinces: ${ca.provinces.features.length}`);

  console.log("\nrendering us.svg (Albers-USA composite)...");
  const usSvg = renderSvg({ projection: geoAlbersUsa(), us, ca: null });
  const usPath = path.join(DIST_DIR, "us.svg");
  await writeFile(usPath, minify(usSvg));
  await report(usPath);

  console.log("\nrendering ca.svg (Lambert Conformal Conic)...");
  // Standard parallels for Canada: 49°N (south) and 77°N (north). Central
  // meridian at 95°W roughly bisects the country.
  //
  // `preclip(s => s)` disables d3-geo's default antimeridian-clipping stream.
  // For the geographic range we care about (lower-48 + Canada, no antimeridian
  // crossings) the antimeridian clip is irrelevant — but its emitted boundary
  // path runs near the projection's pole singularity, where coordinates blow
  // up to ±10^8. fitSize sees those bounds and shrinks scale to ~0, collapsing
  // every real feature to a single point. Disabling the preclip makes the
  // bounds match the actual data.
  const caProjection = geoConicConformal()
    .parallels([49, 77])
    .rotate([95, 0])
    .preclip(passThroughStream);
  const caSvg = renderSvg({ projection: caProjection, us: null, ca });
  const caPath = path.join(DIST_DIR, "ca.svg");
  await writeFile(caPath, minify(caSvg));
  await report(caPath);

  console.log("\nrendering na.svg (continental Albers Equal Area)...");
  // Standard parallels for North America: 29.5°N and 60°N is a common choice
  // (matches USGS continental Albers). Central meridian at 100°W.
  // Same preclip-override rationale as ca.svg.
  const naProjection = geoConicEqualArea()
    .parallels([29.5, 60])
    .rotate([100, 0])
    .preclip(passThroughStream);
  const naSvg = renderSvg({ projection: naProjection, us, ca });
  const naPath = path.join(DIST_DIR, "na.svg");
  await writeFile(naPath, minify(naSvg));
  await report(naPath);

  console.log("\ndone.");
}

/** @param {string} p @returns {Promise<void>} */
async function report(p) {
  const s = await stat(p);
  console.log(`  → ${path.relative(REPO_ROOT, p)} (${formatBytes(s.size)})`);
}

/**
 * Run the rendered SVG through SVGO. Default plugins handle whitespace
 * stripping, path-command shortening (M…L… → M…h… / v… / relative-coord
 * shorthands), and other safe optimizations. We only override `cleanupIds`
 * to ensure none of our county / division / state / province ids get
 * removed — those are the highlight hooks that consumers rely on, even
 * though they're not referenced from anywhere inside the SVG itself.
 *
 * @param {string} svg
 * @returns {string}
 */
function minify(svg) {
  const result = svgoOptimize(svg, {
    multipass: true,
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            cleanupIds: false,
          },
        },
      },
    ],
  });
  return result.data;
}

await main();
