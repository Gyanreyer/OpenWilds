/**
 * Filesystem path resolution for `data/plantae/<family>/<genus>/<species>/data.yml`.
 *
 * Taxonomy is encoded in the path. Subfamily is intentionally omitted from
 * the convention — no code reads it and GBIF's subfamily coverage is too
 * patchy to use reliably. See `tools/migrate-v1-to-v2.ts`.
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { stat } from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
export const PLANTAE_ROOT = path.join(REPO_ROOT, "data", "plantae");

export interface EntryLocation {
  /** Absolute path to the target `data.yml`. */
  absPath: string;
  /** Repo-relative path, for logging. */
  relPath: string;
  /** True when `data.yml` already exists at this path. */
  exists: boolean;
}

export async function resolveEntryPath(
  family: string,
  genus: string,
  specificEpithet: string
): Promise<EntryLocation> {
  const parts = [family, genus, specificEpithet]
    .map((s) => s.toLowerCase())
    .concat("data.yml");

  const absPath = path.join(PLANTAE_ROOT, ...parts);
  const relPath = path.relative(REPO_ROOT, absPath);
  return { absPath, relPath, exists: await fileExists(absPath) };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
