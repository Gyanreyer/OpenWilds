/**
 * Regenerates the committed offline data artifacts under
 * `tools/new-entry/data/` from upstream sources.
 *
 * Four artifacts:
 *   us-counties-2024.geojson   TIGER 2024 county boundaries, WGS84, simplified.
 *   ca-divisions-2021.geojson  StatCan 2021 Census Division boundaries, WGS84, simplified.
 *   usda-plantlst.txt          USDA PLANTS complete list (name -> symbol index).
 *   vascan.csv                 VASCAN accepted species with native Canadian provinces.
 *
 * Raw downloads are staged under `tools/new-entry/.prep/` (gitignored). If a
 * staged file already exists it is reused; pass `--force-download` to re-pull.
 *
 *     node tools/new-entry/scripts/prep-data.ts [--force-download] [--only <step>]
 *
 * where <step> is tiger | statcan | usda | vascan.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(TOOL_ROOT, "..", "..");
const PREP_DIR = path.join(TOOL_ROOT, ".prep");
const DATA_DIR = path.join(TOOL_ROOT, "data");

const SOURCES = {
  tiger: {
    url: "https://www2.census.gov/geo/tiger/TIGER2024/COUNTY/tl_2024_us_county.zip",
    staged: "tl_2024_us_county.zip",
    output: "us-counties-2024.geojson",
  },
  statcan: {
    url: "https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcd_000b21a_e.zip",
    staged: "lcd_000b21a_e.zip",
    output: "ca-divisions-2021.geojson",
  },
  usda: {
    url: "https://plants.sc.egov.usda.gov/DocumentLibrary/Txt/plantlst.txt",
    staged: "plantlst.txt",
    output: "usda-plantlst.txt",
  },
  vascan: {
    url: "https://data.canadensys.net/ipt/archive.do?r=vascan",
    staged: "vascan-dwca.zip",
    output: "vascan.csv",
  },
} as const;

type StepName = keyof typeof SOURCES;

// -----------------------------------------------------------------------------
// CLI
// -----------------------------------------------------------------------------

interface Args {
  forceDownload: boolean;
  only: StepName | null;
}

function parseArgs(argv: string[]): Args {
  let forceDownload = false;
  let only: StepName | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force-download") {
      forceDownload = true;
    } else if (a === "--only") {
      const v = argv[++i];
      if (!(v in SOURCES)) {
        throw new Error(`--only expects one of: ${Object.keys(SOURCES).join(", ")}`);
      }
      only = v as StepName;
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return { forceDownload, only };
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, dest: string): Promise<void> {
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await rename(tmp, dest);
  const size = (await stat(dest)).size;
  console.log(`  wrote ${dest} (${formatBytes(size)})`);
}

async function ensureDownloaded(
  src: { url: string; staged: string },
  force: boolean
): Promise<string> {
  const stagedPath = path.join(PREP_DIR, src.staged);
  if (!force && (await exists(stagedPath))) {
    console.log(`  using cached ${path.relative(REPO_ROOT, stagedPath)}`);
    return stagedPath;
  }
  await download(src.url, stagedPath);
  return stagedPath;
}

function runMapshaper(args: string[]): void {
  const result = spawnSync("npx", ["--no-install", "mapshaper", ...args], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`mapshaper exited with status ${result.status}`);
  }
}

function runUnzip(zipPath: string, destDir: string): void {
  const result = spawnSync("unzip", ["-q", "-o", zipPath, "-d", destDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`unzip exited with status ${result.status}`);
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

async function reportSize(p: string): Promise<void> {
  const s = await stat(p);
  console.log(`  → ${path.relative(REPO_ROOT, p)} (${formatBytes(s.size)})`);
}

// -----------------------------------------------------------------------------
// Steps
// -----------------------------------------------------------------------------

/**
 * TIGER 2024 county shapefile → simplified WGS84 GeoJSON.
 * Keeps only GEOID (5-digit FIPS) and NAME to minimize bytes.
 */
async function prepTiger(force: boolean): Promise<void> {
  console.log("\n[tiger] US county boundaries");
  const zip = await ensureDownloaded(SOURCES.tiger, force);
  const output = path.join(DATA_DIR, SOURCES.tiger.output);
  runMapshaper([
    zip,
    "-proj",
    "wgs84",
    "-filter-fields",
    "GEOID,NAME",
    "-simplify",
    "percentage=4%",
    "keep-shapes",
    "visvalingam",
    "weighted",
    "-clean",
    "-o",
    `format=geojson`,
    `precision=0.00001`,
    output,
  ]);
  await reportSize(output);
}

/**
 * StatCan 2021 Census Division cartographic boundary → simplified WGS84 GeoJSON.
 * Keeps CDUID (4-digit) and CDNAME.
 */
async function prepStatCan(force: boolean): Promise<void> {
  console.log("\n[statcan] Canada Census Division boundaries");
  const zip = await ensureDownloaded(SOURCES.statcan, force);
  const output = path.join(DATA_DIR, SOURCES.statcan.output);
  // Canada's Arctic and Pacific coastlines drive up byte count more than
  // the 293 CD count; we simplify harder than the US counties (2%) to stay
  // under 10 MB.
  runMapshaper([
    zip,
    "-proj",
    "wgs84",
    "-filter-fields",
    "CDUID,CDNAME",
    "-simplify",
    "percentage=2%",
    "keep-shapes",
    "visvalingam",
    "weighted",
    "-clean",
    "-o",
    `format=geojson`,
    `precision=0.00001`,
    output,
  ]);
  await reportSize(output);
}

/**
 * USDA PLANTS complete checklist. Ships as-is (~7 MB) — the new-entry tool
 * uses it as a local name→symbol index and fetches per-plant details from the
 * USDA API at runtime.
 */
async function prepUsda(force: boolean): Promise<void> {
  console.log("\n[usda] PLANTS checklist");
  const staged = await ensureDownloaded(SOURCES.usda, force);
  const output = path.join(DATA_DIR, SOURCES.usda.output);
  const buf = await readFile(staged);
  await writeFile(output, buf);
  await reportSize(output);
}

/**
 * VASCAN Darwin Core archive → trimmed CSV of accepted taxa with their
 * native Canadian provinces. Phase 4 uses this to filter GBIF occurrences:
 * a county/CD is only kept if the province (or state, for USDA) has the
 * species flagged as native.
 */
async function prepVascan(force: boolean): Promise<void> {
  console.log("\n[vascan] Canadian vascular plants");
  const zip = await ensureDownloaded(SOURCES.vascan, force);
  const extractDir = path.join(PREP_DIR, "vascan");
  await mkdir(extractDir, { recursive: true });
  runUnzip(zip, extractDir);

  const taxonPath = path.join(extractDir, "taxon.txt");
  const distPath = path.join(extractDir, "distribution.txt");

  // Parse taxon.txt: keep accepted species / subspecies / variety only.
  // Canonical species name is reconstructed from genus + specificEpithet,
  // avoiding the fragile task of stripping authorship from scientificName.
  // Infraspecific taxa are rolled up to their parent species so a caller
  // querying by species name gets the union of all variety-level native
  // distributions (e.g. Acer rubrum inherits from its accepted varieties).
  const taxonText = await readFile(taxonPath, "utf8");
  type Taxon = { id: string; speciesName: string };
  const taxa = new Map<string, Taxon>();
  const taxonLines = taxonText.split("\n");
  const taxonHeader = taxonLines[0].split("\t");
  const tColId = taxonHeader.indexOf("id");
  const tColGenus = taxonHeader.indexOf("genus");
  const tColSpEpi = taxonHeader.indexOf("specificEpithet");
  const tColRank = taxonHeader.indexOf("taxonRank");
  const tColStatus = taxonHeader.indexOf("taxonomicStatus");
  for (let i = 1; i < taxonLines.length; i++) {
    const line = taxonLines[i];
    if (!line) continue;
    const cols = line.split("\t");
    if (cols[tColStatus] !== "accepted") continue;
    const rank = cols[tColRank];
    if (rank !== "species" && rank !== "subspecies" && rank !== "variety") continue;
    const genus = cols[tColGenus];
    const epi = cols[tColSpEpi];
    if (!genus || !epi) continue;
    taxa.set(cols[tColId], { id: cols[tColId], speciesName: `${genus} ${epi}` });
  }

  // Parse distribution.txt: keep present+native rows, group by species name.
  const distText = await readFile(distPath, "utf8");
  const distLines = distText.split("\n");
  const distHeader = distLines[0].split("\t");
  const dColId = distHeader.indexOf("id");
  const dColLoc = distHeader.indexOf("locationID");
  const dColOcc = distHeader.indexOf("occurrenceStatus");
  const dColEst = distHeader.indexOf("establishmentMeans");
  const provincesBySpecies = new Map<string, Set<string>>();
  for (let i = 1; i < distLines.length; i++) {
    const line = distLines[i];
    if (!line) continue;
    const cols = line.split("\t");
    if (cols[dColOcc] !== "present") continue;
    if (cols[dColEst] !== "native") continue;
    const taxon = taxa.get(cols[dColId]);
    if (!taxon) continue;
    const loc = cols[dColLoc]; // "ISO3166-2:CA-ON"
    const dash = loc.lastIndexOf("-");
    if (dash < 0) continue;
    const code = loc.slice(dash + 1); // "ON", or "PM" for St. Pierre & Miquelon
    let set = provincesBySpecies.get(taxon.speciesName);
    if (!set) provincesBySpecies.set(taxon.speciesName, (set = new Set()));
    set.add(code);
  }

  // Emit CSV: scientific_name,native_provinces
  const rows: string[] = [`scientific_name,native_provinces`];
  const sortedNames = [...provincesBySpecies.keys()].sort();
  for (const name of sortedNames) {
    const provs = [...provincesBySpecies.get(name)!].sort().join("|");
    rows.push(`${csvField(name)},${provs}`);
  }
  const output = path.join(DATA_DIR, SOURCES.vascan.output);
  await writeFile(output, rows.join("\n") + "\n");
  console.log(`  ${rows.length - 1} species with native provinces`);
  await reportSize(output);
}

function csvField(s: string): string {
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(PREP_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  const steps: Record<StepName, (f: boolean) => Promise<void>> = {
    tiger: prepTiger,
    statcan: prepStatCan,
    usda: prepUsda,
    vascan: prepVascan,
  };

  const names: StepName[] = args.only ? [args.only] : (Object.keys(steps) as StepName[]);
  for (const n of names) {
    await steps[n](args.forceDownload);
  }
  console.log("\ndone.");
}

await main();
