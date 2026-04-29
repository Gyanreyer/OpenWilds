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
  /** Absolute path to the curated `data.yml`. */
  absPath: string;
  /** Repo-relative path to `data.yml`, for logging. */
  relPath: string;
  /** True when `data.yml` already exists. Used to route image fetches to `images.draft/`. */
  exists: boolean;
  /** Absolute path to the sibling `data.draft.yml`. */
  draftPath: string;
  /** Repo-relative path to `data.draft.yml`, for logging. */
  draftRelPath: string;
  /** True when `data.draft.yml` already exists. */
  draftExists: boolean;
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
  const draftPath = absPath.replace(/data\.yml$/, "data.draft.yml");
  const [exists, draftExists] = await Promise.all([
    fileExists(absPath),
    fileExists(draftPath),
  ]);
  return {
    absPath,
    relPath: path.relative(REPO_ROOT, absPath),
    exists,
    draftPath,
    draftRelPath: path.relative(REPO_ROOT, draftPath),
    draftExists,
  };
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}
