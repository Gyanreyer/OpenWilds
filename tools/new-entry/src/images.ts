/**
 * Image download + downscale pipeline.
 *
 * Takes ImageCandidate records from `sources/inaturalist-images.ts`, fetches
 * each photo's original-resolution JPG, resizes to 1600px long edge with
 * sharp, and writes them next to the species's data file.
 *
 * Trampling-safety: if the species directory already has an accepted
 * `data.yml`, drafts route image files to `images.draft/` instead of
 * `images/` so curated images aren't overwritten.
 *
 * Caching: a target file that already exists on disk is left in place. To
 * force a re-download, delete the file (or the whole `images.draft/` dir).
 * `--no-cache` only affects HTTP JSON; image bytes are always cached on
 * disk by virtue of being downloaded once.
 */

import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import type {
  ImageCandidate,
  Phenology,
} from "./sources/inaturalist-images.ts";
import type { ImageEntry } from "./types.ts";

const LONG_EDGE_PX = 1600;
const JPEG_QUALITY = 85;

export interface ImagesResolution {
  /** Absolute directory where the .jpg files were written. */
  absImageDir: string;
  /** "images" or "images.draft", relative to the entry dir. */
  relImageDir: string;
  /** Schema-shaped image entries ready to drop into the YAML. */
  entries: ImageEntry[];
  /** Per-candidate report — non-throwing skips are logged here. */
  warnings: string[];
}

/**
 * Resolve the directory where draft image files belong, given whether an
 * accepted `data.yml` already exists. Drafts going alongside an accepted
 * entry land in `images.draft/` to keep curated images untouched; otherwise
 * the canonical `images/` directory is used.
 */
export function resolveImageDir(
  entryDir: string,
  acceptedExists: boolean
): { absImageDir: string; relImageDir: string } {
  const relImageDir = acceptedExists ? "images.draft" : "images";
  return {
    absImageDir: path.join(entryDir, relImageDir),
    relImageDir,
  };
}

/**
 * Download, resize, and write each candidate to disk; return the matching
 * ImageEntry array. Any candidate that fails to download or process is
 * skipped and noted in `warnings` — the rest still complete.
 */
export async function downloadAndProcessImages(
  candidates: ImageCandidate[],
  acceptedScientificName: string,
  entryDir: string,
  acceptedExists: boolean
): Promise<ImagesResolution> {
  const { absImageDir, relImageDir } = resolveImageDir(entryDir, acceptedExists);
  await mkdir(absImageDir, { recursive: true });

  const entries: ImageEntry[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const idx = String(i + 1).padStart(2, "0");
    const fileName = `${idx}__inat_${c.photoId}.jpg`;
    const absPath = path.join(absImageDir, fileName);
    const relPath = path.join(relImageDir, fileName);

    try {
      if (!(await fileExists(absPath))) {
        const buf = await downloadJpeg(c.originalUrl);
        await sharp(buf)
          .resize({
            width: LONG_EDGE_PX,
            height: LONG_EDGE_PX,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: JPEG_QUALITY })
          .toFile(absPath);
      }
    } catch (err) {
      warnings.push(`photo ${c.photoId}: ${(err as Error).message}`);
      continue;
    }

    entries.push({
      local_path: relPath,
      alt: buildAlt(acceptedScientificName, c.creatorName, c.observedOn, c.phenology),
      license: c.license,
      creator_name: c.creatorName,
      ...(c.creatorUrl ? { creator_url: c.creatorUrl } : {}),
      source: "iNaturalist",
      source_url: c.observationUrl,
      ...(c.observedOn ? { observed_on: c.observedOn } : {}),
    });
  }

  return { absImageDir, relImageDir, entries, warnings };
}

async function downloadJpeg(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download ${url}: ${res.status} ${res.statusText}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function buildAlt(
  scientificName: string,
  creatorName: string,
  observedOn: string | null,
  phenology: Phenology
): string {
  const stage =
    phenology === "flowering"
      ? " in flower"
      : phenology === "fruiting"
        ? " in fruit"
        : "";
  const date = observedOn ? ` on ${observedOn}` : "";
  return `${scientificName}${stage}, observed by ${creatorName}${date}.`;
}
