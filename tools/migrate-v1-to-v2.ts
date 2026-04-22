/**
 * One-shot migration: existing `data/plantae/**\/data.yml` (schema v1)
 * → schema v2 (tools/new-entry/src/types.ts).
 *
 * Changes applied per entry:
 *   - bloom_time.{start,end}: month name → integer 1..12
 *   - height.{min,max}: "4in" / "5ft" → integer inches
 *   - bloom_color: bare object → one-element array
 *   - distribution: DROPPED entirely (regenerated county-level in Phase 4)
 *   - images (if present): collapse sibling *.meta.json sidecars into an
 *     inline `images:` block, then delete the sidecars
 *
 * Usage:
 *   npx tsx tools/migrate-v1-to-v2.ts             # dry run (preview)
 *   npx tsx tools/migrate-v1-to-v2.ts --apply     # write changes
 */

import { readFile, writeFile, readdir, unlink, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, dirname, relative } from "node:path";
import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from "yaml";

import type {
  ImageEntry,
  ImageLicense,
  ImageSource,
} from "./new-entry/src/types.js";

// ---------------------------------------------------------------------------
// Month name → integer
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function monthToInt(name: unknown): number {
  if (typeof name !== "string") {
    throw new Error(`Expected month name string, got ${JSON.stringify(name)}`);
  }
  const n = MONTHS[name.trim().toLowerCase()];
  if (!n) {
    throw new Error(`Unknown month: ${name}`);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Height string → inches
// ---------------------------------------------------------------------------

const HEIGHT_RE = /^\s*(\d+(?:\.\d+)?)\s*(in|ft|inches|feet)\s*$/i;

function heightToInches(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") {
    throw new Error(`Expected height string, got ${JSON.stringify(value)}`);
  }
  const m = value.match(HEIGHT_RE);
  if (!m) throw new Error(`Unable to parse height "${value}"`);
  const num = parseFloat(m[1]);
  const unit = m[2].toLowerCase();
  const inches = unit.startsWith("ft") || unit === "feet" ? num * 12 : num;
  return Math.round(inches);
}

// ---------------------------------------------------------------------------
// Image license normalization: "CC BY 2.0" → "CC-BY-2.0"
// ---------------------------------------------------------------------------

function normalizeLicense(raw: string): ImageLicense {
  const trimmed = raw.trim();
  // Remove the "CC " prefix/space and kebab-join the rest.
  // "CC BY 2.0" → ["CC", "BY", "2.0"] → "CC-BY-2.0"
  const parts = trimmed.split(/\s+/);
  return parts.join("-") as ImageLicense;
}

function detectSource(url: string): ImageSource {
  if (/inaturalist\.org/i.test(url)) return "iNaturalist";
  if (/flickr\.com/i.test(url)) return "Flickr";
  if (/wikimedia\.org|wikipedia\.org/i.test(url)) return "Wikimedia";
  return "Other";
}

// ---------------------------------------------------------------------------
// Per-entry migration
// ---------------------------------------------------------------------------

interface MigrationResult {
  relPath: string;
  /** YAML text to write to `data.yml`. */
  yaml: string;
  /** Sidecar JSON files to delete (absolute paths). */
  sidecarsToDelete: string[];
  /** Warnings that didn't block the migration but the reviewer should see. */
  warnings: string[];
}

async function migrateEntry(
  absPath: string,
  dataRoot: string
): Promise<MigrationResult> {
  const warnings: string[] = [];
  const text = await readFile(absPath, "utf8");
  const v1 = parseYaml(text);
  const entryDir = dirname(absPath);

  // --- bloom_time: month names → integers ---
  if (v1.bloom_time) {
    v1.bloom_time = {
      start: monthToInt(v1.bloom_time.start),
      end: monthToInt(v1.bloom_time.end),
    };
  }

  // --- height: "4in" / "5ft" → integer inches ---
  if (v1.height) {
    v1.height = {
      min: heightToInches(v1.height.min),
      max: heightToInches(v1.height.max),
    };
  }

  // --- bloom_color: bare object → one-element array ---
  if (v1.bloom_color && !Array.isArray(v1.bloom_color)) {
    v1.bloom_color = [v1.bloom_color];
  }

  // --- distribution: dropped entirely ---
  if (v1.distribution) {
    delete v1.distribution;
  }

  // --- images: collapse sidecar JSONs into inline block ---
  const sidecarsToDelete: string[] = [];
  const imagesDir = join(entryDir, "images");
  let hasImagesDir = false;
  try {
    const st = await stat(imagesDir);
    hasImagesDir = st.isDirectory();
  } catch {
    // no images dir — fine
  }

  if (hasImagesDir) {
    const files = await readdir(imagesDir);
    const imageFiles = files
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort();

    const images: ImageEntry[] = [];
    for (const imgFile of imageFiles) {
      const imgAbs = join(imagesDir, imgFile);
      const metaAbs = `${imgAbs}.meta.json`;
      let meta: {
        license?: string;
        creatorName?: string;
        creatorURL?: string;
        sourceURL?: string;
        alt?: string;
      } = {};
      try {
        meta = JSON.parse(await readFile(metaAbs, "utf8"));
        sidecarsToDelete.push(metaAbs);
      } catch {
        warnings.push(`No sidecar meta for ${relative(dataRoot, imgAbs)}; emitting with TODO-filled metadata.`);
      }

      const sourceUrl = meta.sourceURL?.trim();
      images.push({
        local_path: `images/${imgFile}`,
        alt: meta.alt ?? "",
        license: meta.license ? normalizeLicense(meta.license) : ("CC-BY" as ImageLicense),
        creator_name: meta.creatorName ?? "",
        ...(meta.creatorURL ? { creator_url: meta.creatorURL } : {}),
        source: sourceUrl ? detectSource(sourceUrl) : "Other",
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
      });
    }

    if (images.length > 0) {
      v1.images = images;
    }
  }

  // Stable key order to match SCHEMA.md's presentation.
  const ordered = reorderTopLevel(v1);

  const yaml = stringifyYaml(ordered, {
    lineWidth: 0,
    blockQuote: "literal",
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });

  return {
    relPath: relative(dataRoot, absPath),
    yaml,
    sidecarsToDelete,
    warnings,
  };
}

const TOP_LEVEL_ORDER = [
  "scientific_name",
  "common_names",
  "synonyms",
  "category",
  "life_cycle",
  "bloom_time",
  "bloom_color",
  "height",
  "spread",
  "light",
  "moisture",
  "soil_type",
  "soil_ph",
  "root_type",
  "drought_tolerance",
  "habitat",
  "conservation_status",
  "toxicity",
  "distribution",
  "images",
  "sources",
  "_meta",
];

function reorderTopLevel(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of TOP_LEVEL_ORDER) {
    if (k in obj) out[k] = obj[k];
  }
  // Append any unknown keys we didn't anticipate, preserving them.
  for (const k of Object.keys(obj)) {
    if (!(k in out)) out[k] = obj[k];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Directory walk
// ---------------------------------------------------------------------------

async function findDataFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...await findDataFiles(abs));
    } else if (e.isFile() && e.name === "data.yml") {
      out.push(abs);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main() {
  const apply = process.argv.includes("--apply");
  const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..");
  const dataRoot = join(repoRoot, "data");
  const plantaeRoot = join(dataRoot, "plantae");

  const dataFiles = await findDataFiles(plantaeRoot);
  console.log(`Found ${dataFiles.length} v1 data.yml files under ${relative(repoRoot, plantaeRoot)}`);

  let ok = 0;
  let failed = 0;
  const allSidecars: string[] = [];
  const allWarnings: string[] = [];

  for (const abs of dataFiles) {
    try {
      const result = await migrateEntry(abs, dataRoot);
      if (apply) {
        await writeFile(abs, result.yaml, "utf8");
      }
      allSidecars.push(...result.sidecarsToDelete);
      for (const w of result.warnings) {
        allWarnings.push(`[${result.relPath}] ${w}`);
      }
      ok++;
    } catch (err) {
      failed++;
      console.error(`FAIL ${relative(repoRoot, abs)}: ${(err as Error).message}`);
    }
  }

  if (apply) {
    for (const sidecar of allSidecars) {
      await unlink(sidecar);
    }
  }

  console.log("");
  console.log(`Migrated:  ${ok}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Sidecars:  ${allSidecars.length}${apply ? " (deleted)" : " (would delete)"}`);
  if (allWarnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const w of allWarnings) console.log(`  - ${w}`);
  }
  if (!apply) {
    console.log("");
    console.log("Dry run. Re-run with --apply to write changes.");
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
