/**
 * Hono server for `tools/draft-review/`.
 *
 * Endpoints:
 *   GET  /                  — UI shell (index.html)
 *   GET  /ui/<file>         — static UI assets (map.js, occurrences.js, style.css)
 *   GET  /api/draft         — parsed data.draft.yml as JSON, plus a `_path` field
 *   GET  /api/map.svg       — passthrough of tools/build-svg-map/dist/na.svg
 *   GET  /api/occurrences   — cached GBIF points projected to na.svg viewBox space
 *   GET  /api/county-counts — { "us-26163": 47, "ca-3520": 12, ... } per-cached-point tally
 *   POST /api/finalize      — 501 (Phase 7c)
 *
 * The geo index, occurrence cache, and projection are all loaded eagerly at
 * startup so first-byte latency on every endpoint is dominated by HTTP only.
 * Memory cost is the same ~10 MB the new-entry tool already pays.
 */

import { readFile, readdir, rm, rename, unlink, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { parse as parseYaml } from "yaml";
import { geoConicEqualArea } from "d3-geo";
import type { FeatureCollection } from "geojson";

import { loadGeoIndex, type GeoIndex } from "../new-entry/src/geo/index.ts";
import { classifyPoint } from "../new-entry/src/geo/classify.ts";
import { computeDiff, type FileOp, type ReviewerState } from "./diff.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const UI_DIR = path.join(HERE, "ui");
const NA_SVG_PATH = path.join(REPO_ROOT, "tools", "build-svg-map", "dist", "na.svg");
const GEO_DIR = path.join(REPO_ROOT, "tools", "data", "geo");
const OCCURRENCES_CACHE_DIR = path.join(
  REPO_ROOT,
  "tools",
  "new-entry",
  ".cache",
  "gbif-occurrences"
);

// HI + US territories — must match build.js so server-side projection lines
// up with na.svg.
const US_EXCLUDED_STATE_FIPS = new Set(["15", "60", "66", "69", "72", "78"]);

interface ServerOptions {
  draftPath: string;
  port: number;
}

interface OccurrencePoint {
  lng: number;
  lat: number;
  country: "US" | "CA";
}

interface ProjectedDot {
  x: number;
  y: number;
}

interface ParsedDraft {
  raw: Record<string, unknown>;
  taxonKey: number | null;
  /** Field names of `# TODO:` placeholder lines (commented-out keys with TODO markers). */
  todos: string[];
}

interface DraftImage {
  absPath: string;
  contentType: string;
}

export async function startServer(opts: ServerOptions): Promise<{ url: string }> {
  const [draft, geo, naSvg, projection] = await Promise.all([
    loadDraft(opts.draftPath),
    loadGeoIndex(),
    readFile(NA_SVG_PATH, "utf8"),
    buildNaProjection(),
  ]);

  const occurrences = draft.taxonKey !== null
    ? await loadCachedOccurrences(draft.taxonKey)
    : [];
  const projectedDots = projectOccurrences(occurrences, projection.project);
  const countyCounts = tallyCountyCounts(occurrences, geo);
  const imagesByBasename = buildImageIndex(opts.draftPath, draft.raw);

  console.log(
    `loaded: ${occurrences.length} cached GBIF points, ${Object.keys(countyCounts).length} counties with observations, ${Object.keys(imagesByBasename).length} draft images`
  );

  const app = new Hono();

  app.get("/", async (c) => {
    const html = await readFile(path.join(UI_DIR, "index.html"), "utf8");
    return c.html(html);
  });

  app.get("/ui/:file{[a-z0-9._-]+}", async (c) => {
    const file = c.req.param("file");
    const fp = path.join(UI_DIR, file);
    // Defense in depth: req.param's regex already disallows / and ..
    if (!fp.startsWith(UI_DIR)) return c.notFound();
    try {
      const body = await readFile(fp);
      const ct = file.endsWith(".js")
        ? "application/javascript; charset=utf-8"
        : file.endsWith(".css")
        ? "text/css; charset=utf-8"
        : file.endsWith(".html")
        ? "text/html; charset=utf-8"
        : "application/octet-stream";
      return new Response(body, { headers: { "content-type": ct } });
    } catch {
      return c.notFound();
    }
  });

  app.get("/api/draft", (c) =>
    c.json({
      _path: path.relative(REPO_ROOT, opts.draftPath),
      _todos: draft.todos,
      ...draft.raw,
    })
  );

  app.get("/api/map.svg", (c) =>
    new Response(naSvg, {
      headers: { "content-type": "image/svg+xml; charset=utf-8" },
    })
  );

  app.get("/api/occurrences", (c) =>
    c.json({
      viewBox: { width: projection.width, height: projection.height },
      points: projectedDots,
    })
  );

  app.get("/api/county-counts", (c) => c.json(countyCounts));

  app.get("/api/image/:filename{[a-zA-Z0-9._-]+}", async (c) => {
    const fname = c.req.param("filename");
    const img = imagesByBasename[fname];
    if (!img) return c.notFound();
    try {
      const body = await readFile(img.absPath);
      return new Response(body, {
        headers: { "content-type": img.contentType, "cache-control": "no-store" },
      });
    } catch {
      return c.notFound();
    }
  });

  app.post("/api/finalize", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" }, 400);
    }
    const reviewer = parseReviewerState(body);
    if (!reviewer) {
      return c.json({ ok: false, error: "malformed reviewer state" }, 400);
    }

    let result;
    try {
      result = computeDiff(draft.raw, reviewer, opts.draftPath);
    } catch (err) {
      return c.json(
        { ok: false, error: `diff failed: ${(err as Error).message}` },
        500,
      );
    }

    const draftDir = path.dirname(opts.draftPath);
    const dataYmlPath = path.join(draftDir, "data.yml");

    try {
      await writeFile(dataYmlPath, result.yamlText, "utf8");
      // The draft is now superseded by data.yml; remove before file ops so a
      // half-finalized state isn't left with both files present.
      await unlink(opts.draftPath);
      await runFileOps(result.fileOps);
    } catch (err) {
      return c.json(
        { ok: false, error: `finalize I/O failed: ${(err as Error).message}` },
        500,
      );
    }

    const relPath = path.relative(REPO_ROOT, dataYmlPath);
    console.log(`\nFinalized: ${relPath}`);
    // Flush the response before exiting — the client uses the success reply
    // to render its "server exiting" message.
    setTimeout(() => process.exit(0), 250);
    return c.json({ ok: true, path: relPath });
  });

  return new Promise((resolve) => {
    serve({ fetch: app.fetch, port: opts.port }, (info) => {
      resolve({ url: `http://localhost:${info.port}/` });
    });
  });
}

// ---------------------------------------------------------------------------
// Finalize helpers
// ---------------------------------------------------------------------------

/**
 * Best-effort runtime validation of the POST /api/finalize body. The shape
 * matches `ReviewerState` in [./diff.ts](./diff.ts); anything malformed
 * yields `null` so the route can return 400.
 */
function parseReviewerState(body: unknown): ReviewerState | null {
  if (!body || typeof body !== "object") return null;
  const o = body as Record<string, unknown>;

  const dist = o.distribution as Record<string, unknown> | undefined;
  const confirm = Array.isArray(dist?.confirm) ? dist.confirm.filter((x) => typeof x === "string") : [];
  const exclude = Array.isArray(dist?.exclude) ? dist.exclude.filter((x) => typeof x === "string") : [];

  const scalars = isPlainObject(o.scalars) ? (o.scalars as Record<string, unknown>) : {};
  const todos = isPlainObject(o.todos) ? (o.todos as Record<string, unknown>) : {};

  const imagesRaw = Array.isArray(o.images) ? o.images : [];
  const images = imagesRaw
    .filter(isPlainObject)
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        originalIndex: typeof rec.originalIndex === "number" ? rec.originalIndex : -1,
        keep: rec.keep === true,
        alt: typeof rec.alt === "string" ? rec.alt : "",
      };
    })
    .filter((r) => r.originalIndex >= 0);

  return {
    distribution: { confirm: confirm as string[], exclude: exclude as string[] },
    scalars,
    todos,
    images,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Execute `FileOp` entries sequentially — order matters: per-file deletes run
 * before any directory-scoped move, so the rename moves only the kept files.
 * Missing-file errors on `delete-file` / `delete-dir` are swallowed (idempotent),
 * but `rename-dir` errors propagate so the caller surfaces a real failure.
 */
async function runFileOps(ops: FileOp[]): Promise<void> {
  for (const op of ops) {
    if (op.kind === "delete-file") {
      await unlink(op.absPath).catch((err) => {
        if (err && (err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      });
    } else if (op.kind === "delete-dir") {
      await rm(op.absPath, { recursive: true, force: true });
    } else if (op.kind === "rename-dir") {
      // Rename is the failure-sensitive op; let errors bubble.
      await rename(op.from, op.to);
    }
  }
}

// ---------------------------------------------------------------------------
// Image index
// ---------------------------------------------------------------------------

/**
 * Build a basename → absolute-path map for the draft's `images:` array. The
 * `/api/image/:filename` route looks up basenames here, so only files actually
 * referenced by the draft can be served — `..` traversal is impossible because
 * the lookup is keyed by basename, not path.
 */
function buildImageIndex(
  draftPath: string,
  raw: Record<string, unknown>
): Record<string, DraftImage> {
  const index: Record<string, DraftImage> = {};
  const draftDir = path.dirname(draftPath);
  const images = raw.images;
  if (!Array.isArray(images)) return index;
  for (const img of images) {
    const local = (img as { local_path?: unknown })?.local_path;
    if (typeof local !== "string") continue;
    const absPath = path.resolve(draftDir, local);
    if (!absPath.startsWith(draftDir + path.sep)) continue;
    const basename = path.basename(absPath);
    const ext = path.extname(absPath).toLowerCase();
    const contentType =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    index[basename] = { absPath, contentType };
  }
  return index;
}

// ---------------------------------------------------------------------------
// Draft loading
// ---------------------------------------------------------------------------

async function loadDraft(filePath: string): Promise<ParsedDraft> {
  const text = await readFile(filePath, "utf8");
  const raw = parseYaml(text) as Record<string, unknown>;
  const taxonKey = extractTaxonKey(raw);
  const todos = extractTodoFieldNames(text);
  return { raw, taxonKey, todos };
}

/**
 * Scan the raw YAML text for commented-out keys flagged with `# TODO:`. The
 * `yaml` parser drops comments, so we work from the on-disk text. Lines look
 * like `# fieldName: <placeholder>  # TODO: …` — capture the field name to
 * surface in the Fields review pane.
 */
function extractTodoFieldNames(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /^#\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:.*#\s*TODO\b/;
  for (const line of text.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Pull the GBIF taxon key from `_meta.gbif_taxon_key` (new drafts) or, as a
 * fallback for older drafts, parse it out of the GBIF Backbone source URL
 * (`https://www.gbif.org/species/<key>`).
 */
function extractTaxonKey(draft: Record<string, unknown>): number | null {
  const meta = draft._meta as Record<string, unknown> | undefined;
  const direct = meta?.gbif_taxon_key;
  if (typeof direct === "number") return direct;
  if (typeof direct === "string" && /^\d+$/.test(direct)) return parseInt(direct, 10);

  const sources = draft.sources;
  if (Array.isArray(sources)) {
    for (const s of sources) {
      const src = s as { name?: string; url?: string };
      if (src.name === "GBIF Backbone Taxonomy" && typeof src.url === "string") {
        const m = src.url.match(/\/species\/(\d+)/);
        if (m) return parseInt(m[1], 10);
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Occurrence cache reader
// ---------------------------------------------------------------------------

interface CachedGbifPage {
  results: Array<{
    decimalLongitude?: number;
    decimalLatitude?: number;
    countryCode?: string;
  }>;
}

/**
 * Walk `tools/new-entry/.cache/gbif-occurrences/` for files named
 * `taxon-<key>-offset-<N>.json.gz` and concatenate their `results` arrays.
 * Bypasses the HTTP path entirely — if a draft was generated, the cache is
 * already complete; if not, the reviewer sees no overlay and that's fine.
 */
async function loadCachedOccurrences(taxonKey: number): Promise<OccurrencePoint[]> {
  let files: string[];
  try {
    files = await readdir(OCCURRENCES_CACHE_DIR);
  } catch {
    return [];
  }
  const prefix = `taxon-${taxonKey}-offset-`;
  const matches = files.filter((f) => f.startsWith(prefix) && f.endsWith(".json.gz"));
  const points: OccurrencePoint[] = [];
  for (const f of matches) {
    const buf = await readFile(path.join(OCCURRENCES_CACHE_DIR, f));
    const page = JSON.parse(gunzipSync(buf).toString("utf8")) as CachedGbifPage;
    for (const r of page.results) {
      const lng = r.decimalLongitude;
      const lat = r.decimalLatitude;
      const cc = r.countryCode;
      if (
        typeof lng !== "number" ||
        typeof lat !== "number" ||
        (cc !== "US" && cc !== "CA")
      ) {
        continue;
      }
      points.push({ lng, lat, country: cc });
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// na.svg projection (server-side mirror of build.js)
// ---------------------------------------------------------------------------

interface NaProjection {
  width: number;
  height: number;
  project: (lng: number, lat: number) => [number, number] | null;
}

/**
 * Reconstruct the projection used by `tools/build-svg-map/build.js` for
 * na.svg. We read the actual viewBox from the baked SVG (ground truth) and
 * fitSize the projection to the same combined feature collection so dot
 * overlays land where they should within ~1 px.
 *
 * Differences vs build.js: build.js fits to the *simplified* topology, we fit
 * to the unsimplified geojsons. Simplification at our weights (6e-4 / 8e-4)
 * doesn't move the geometry's extent more than a few hundred meters at any
 * edge, which corresponds to <1 viewBox pixel at width=1200 spanning North
 * America. Good enough for dot overlays; revisit if the mismatch becomes
 * visible.
 */
async function buildNaProjection(): Promise<NaProjection> {
  const [usFc, caFc, naSvgText] = await Promise.all([
    readGeoJson(path.join(GEO_DIR, "us-counties-2024.geojson")),
    readGeoJson(path.join(GEO_DIR, "ca-divisions-2021.geojson")),
    readFile(NA_SVG_PATH, "utf8"),
  ]);

  const { width, height } = parseViewBox(naSvgText);

  const usFiltered: FeatureCollection = {
    type: "FeatureCollection",
    features: usFc.features.filter((f) => {
      const fips = (f.properties as { GEOID?: string })?.GEOID;
      return typeof fips === "string" && !US_EXCLUDED_STATE_FIPS.has(fips.slice(0, 2));
    }),
  };
  const fitTarget: FeatureCollection = {
    type: "FeatureCollection",
    features: [...usFiltered.features, ...caFc.features],
  };

  // Same projection params as build.js — see the na.svg rendering block there.
  // `passThroughStream` overrides the default antimeridian preclip, which
  // otherwise emits a clip boundary near the projection's pole singularity
  // and breaks fitSize.
  const projection = geoConicEqualArea()
    .parallels([29.5, 60])
    .rotate([100, 0])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .preclip(((s: any) => s) as any);
  projection.fitSize([width, height], fitTarget);

  return {
    width,
    height,
    project: (lng, lat) => {
      const r = projection([lng, lat]);
      if (!r || !Number.isFinite(r[0]) || !Number.isFinite(r[1])) return null;
      return [r[0], r[1]];
    },
  };
}

async function readGeoJson(filePath: string): Promise<FeatureCollection> {
  const text = await readFile(filePath, "utf8");
  return JSON.parse(text) as FeatureCollection;
}

function parseViewBox(svg: string): { width: number; height: number } {
  // The baked SVG starts with `<svg ... viewBox="0 0 W H" ...>`; tolerant of
  // whitespace / attribute ordering.
  const m = svg.match(/viewBox="\s*0\s+0\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*"/);
  if (!m) throw new Error(`couldn't parse viewBox from ${NA_SVG_PATH}`);
  return { width: parseFloat(m[1]), height: parseFloat(m[2]) };
}

function projectOccurrences(
  points: OccurrencePoint[],
  project: NaProjection["project"]
): ProjectedDot[] {
  const out: ProjectedDot[] = [];
  for (const p of points) {
    const xy = project(p.lng, p.lat);
    if (!xy) continue;
    out.push({ x: Math.round(xy[0] * 10) / 10, y: Math.round(xy[1] * 10) / 10 });
  }
  return out;
}

function tallyCountyCounts(points: OccurrencePoint[], geo: GeoIndex): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of points) {
    const code = classifyPoint(geo, p.lng, p.lat, p.country);
    if (!code) continue;
    const key = p.country === "US" ? `us-${code}` : `ca-${code}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
