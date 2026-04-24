/**
 * Migration: existing `data/plantae/**\/data.yml` → schema v2 shape plus
 * a flat `family/genus/species/` directory convention (no subfamily level).
 *
 * Per-entry YAML transforms (applied when v1 indicators are present):
 *   - bloom_time.{start,end}: month name → integer 1..12
 *   - height.{min,max}: "4in" / "5ft" → integer inches
 *   - bloom_color: bare object → one-element array
 *   - primary_common_name: set to common_names[0] when not already present
 *   - distribution: DROPPED entirely (regenerated county-level in Phase 4)
 *   - images (when no inline `images:` yet): collapse sibling *.meta.json
 *     sidecars into an inline block; delete sidecars
 *
 * Filesystem pass:
 *   - Entries living under `family/<subfamily>/genus/species/` are moved to
 *     `family/genus/species/`. Subfamily level is dropped from the
 *     convention (no code consumer; GBIF subfamily coverage is unreliable).
 *
 * All content transforms are idempotent — already-v2 entries are detected
 * and skipped so the script is safe to re-run.
 *
 * Usage:
 *   node tools/migrate-v1-to-v2.ts             # dry run (preview)
 *   node tools/migrate-v1-to-v2.ts --apply     # write changes
 */

import { readFile, writeFile, readdir, unlink, stat, rename, rmdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, dirname, relative } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import type {
  ImageEntry,
  ImageLicense,
  ImageSource,
} from "./new-entry/src/types.ts";

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

  // --- bloom_time: month names → integers (skip if already numeric) ---
  if (v1.bloom_time && typeof v1.bloom_time.start === "string") {
    v1.bloom_time = {
      start: monthToInt(v1.bloom_time.start),
      end: monthToInt(v1.bloom_time.end),
    };
  }

  // --- height: "4in" / "5ft" → integer inches (skip if already numeric) ---
  if (v1.height && typeof v1.height.min === "string") {
    v1.height = {
      min: heightToInches(v1.height.min),
      max: heightToInches(v1.height.max),
    };
  }

  // --- bloom_color: bare object → one-element array ---
  if (v1.bloom_color && !Array.isArray(v1.bloom_color)) {
    v1.bloom_color = [v1.bloom_color];
  }

  // --- primary_common_name: default to the first entry in common_names ---
  // Existing hand-curated entries encode the preferred display name by
  // listing it first. Promote that to the explicit field so consumers don't
  // have to know the ordering convention.
  if (
    !v1.primary_common_name &&
    Array.isArray(v1.common_names) &&
    v1.common_names.length > 0
  ) {
    v1.primary_common_name = v1.common_names[0];
  }

  // --- distribution: dropped entirely ---
  if (v1.distribution) {
    delete v1.distribution;
  }

  // --- images: collapse sidecar JSONs into inline block ---
  // Already-v2 entries have an inline `images:` block (and their sidecars
  // were deleted by a prior run). Don't re-process those — we'd regenerate
  // the block from nonexistent sidecars and clobber the real data.
  const sidecarsToDelete: string[] = [];
  const imagesDir = join(entryDir, "images");
  let hasImagesDir = false;
  try {
    const st = await stat(imagesDir);
    hasImagesDir = st.isDirectory();
  } catch {
    // no images dir — fine
  }

  if (hasImagesDir && !v1.images) {
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
  "primary_common_name",
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
// Subfamily-dir collapse: family/<subfam>/genus/species/ → family/genus/species/
// ---------------------------------------------------------------------------

interface SubfamilyMove {
  from: string; // repo-relative directory
  to: string;
  subfamily: string;
}

/**
 * Detect 5-segment plant entry paths (`plantae/family/subfam/genus/species/data.yml`)
 * and plan their move to 4-segment paths. Emits an error if collapsing would
 * collide with another entry (e.g., the same genus/species already exists
 * under `family/` directly).
 */
async function planSubfamilyCollapse(
  plantaeRoot: string,
  dataRoot: string
): Promise<{ moves: SubfamilyMove[]; conflicts: string[] }> {
  const dataFiles = await findDataFiles(plantaeRoot);
  const moves: SubfamilyMove[] = [];
  const conflicts: string[] = [];
  for (const abs of dataFiles) {
    const rel = relative(plantaeRoot, abs); // "family/subfam/genus/species/data.yml" or shorter
    const parts = rel.split("/");
    if (parts.length !== 5) continue; // only 5-segment entries have a subfamily level
    const [family, subfamily, genus, species] = parts;
    const fromDir = join(plantaeRoot, family, subfamily, genus, species);
    const toDir = join(plantaeRoot, family, genus, species);
    try {
      await stat(toDir);
      conflicts.push(
        `${relative(dataRoot, fromDir)} cannot move to ${relative(dataRoot, toDir)} — target already exists`
      );
      continue;
    } catch {
      // target doesn't exist — good
    }
    moves.push({
      from: relative(dataRoot, fromDir),
      to: relative(dataRoot, toDir),
      subfamily,
    });
  }
  return { moves, conflicts };
}

/** Execute the planned moves. Removes now-empty subfamily directories. */
async function applySubfamilyCollapse(
  moves: SubfamilyMove[],
  dataRoot: string
): Promise<void> {
  const emptiedParents = new Set<string>();
  for (const m of moves) {
    const fromAbs = join(dataRoot, m.from);
    const toAbs = join(dataRoot, m.to);
    // rename() handles the leaf directory move atomically. The parent genus
    // dir under the subfamily may also become empty and need cleanup.
    const toParent = dirname(toAbs);
    await readdir(toParent).catch(async () => {
      // Parent doesn't exist yet; mkdir via rename's own behavior would fail,
      // so create it explicitly.
      const { mkdir } = await import("node:fs/promises");
      await mkdir(toParent, { recursive: true });
    });
    await rename(fromAbs, toAbs);
    // Track the genus dir under the subfamily — it may be empty now.
    emptiedParents.add(dirname(fromAbs));
  }
  // Clean up empty intermediate dirs: genus under subfamily, then subfamily
  // under family. Walk from innermost to outermost, ignoring dirs that still
  // have content (a subfamily holding another genus keeps living).
  const ordered = [...emptiedParents].sort((a, b) => b.length - a.length);
  for (const dir of ordered) {
    await removeIfEmpty(dir);
    await removeIfEmpty(dirname(dir)); // subfamily dir
  }
}

async function removeIfEmpty(dir: string): Promise<void> {
  try {
    const contents = await readdir(dir);
    if (contents.length === 0) {
      await rmdir(dir);
    }
  } catch {
    // dir doesn't exist — fine
  }
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
  console.log(`Found ${dataFiles.length} data.yml files under ${relative(repoRoot, plantaeRoot)}`);

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

  // --- Subfamily-dir collapse ---
  const collapse = await planSubfamilyCollapse(plantaeRoot, dataRoot);
  console.log("");
  console.log(
    `Subfamily collapse: ${collapse.moves.length} move${collapse.moves.length === 1 ? "" : "s"}, ${collapse.conflicts.length} conflict${collapse.conflicts.length === 1 ? "" : "s"}`
  );
  for (const m of collapse.moves) {
    console.log(`  ${apply ? "moved" : "would move"} ${m.from} → ${m.to} (drop subfamily "${m.subfamily}")`);
  }
  for (const c of collapse.conflicts) {
    console.error(`  CONFLICT ${c}`);
  }
  if (apply && collapse.conflicts.length === 0) {
    await applySubfamilyCollapse(collapse.moves, dataRoot);
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

  if (failed > 0 || collapse.conflicts.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
