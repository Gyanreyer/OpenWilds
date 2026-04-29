/**
 * Pure diff: parsed draft + reviewer state → new YAML text + filesystem ops.
 *
 * Called from `POST /api/finalize` in [server.ts](./server.ts). The server
 * does the I/O — diff.ts is side-effect-free so it's easy to reason about
 * and (eventually) easy to test.
 *
 * Resolution order for each top-level field:
 *   1. Reviewer scalar override (from the Fields tab "Scalar values" section).
 *   2. Reviewer TODO resolution (from the Fields tab "TODO placeholders" section).
 *   3. Original draft value.
 *   4. Otherwise omit — unresolved TODOs do *not* survive into the finalized
 *      data.yml as comments, since data.yml is the canonical accepted entry.
 *      To preserve a TODO for later, leave the data.draft.yml in place
 *      instead of finalizing.
 *
 * Distribution semantics: only counties the reviewer explicitly toggled to
 * "include" are added to `distribution.native_*`. Everything else (including
 * pending review items) drops on finalize because `_meta` is stripped.
 *
 * Image semantics:
 *   - Excluded images: file is deleted from disk; entry dropped from YAML.
 *   - Reordering: the YAML's `images:` list reflects the reviewer's order.
 *   - Alt edits: applied to the matching entry.
 *   - If images live in `images.draft/` (curated `data.yml` already exists),
 *     finalize wholesale-replaces the curated `images/` dir with the kept
 *     subset, and `local_path` values are rewritten from `images.draft/...`
 *     to `images/...`.
 */

import path from "node:path";

import { Pair, Scalar, YAMLMap, YAMLSeq } from "yaml";

import {
  buildDraftYaml,
  TOP_LEVEL_ORDER,
  type DraftField,
  type TopLevelKey,
} from "../new-entry/src/emit.ts";
import {
  US_STATE_FIPS_TO_ABBR,
  CA_PRUID_TO_ABBR,
} from "../new-entry/src/geo/codes.ts";

export interface ReviewerImage {
  /** Index in the draft's original `images[]` array. */
  originalIndex: number;
  /** True = include in finalized output; false = drop entry + delete file. */
  keep: boolean;
  /** Reviewer-edited alt text (may equal the original). */
  alt: string;
  // Order in the array = final display order.
}

export interface ReviewerDistribution {
  /** Prefixed SVG ids (e.g. "us-26163", "ca-3520") the reviewer confirmed. */
  confirm: string[];
  /**
   * Prefixed SVG ids the reviewer excluded. Informational — finalize drops
   * non-confirmed review items unconditionally; this is here so the server
   * can log/audit the breakdown if desired.
   */
  exclude: string[];
}

export interface ReviewerState {
  distribution: ReviewerDistribution;
  /** field → reviewer-supplied value (overrides the original draft value). */
  scalars: Record<string, unknown>;
  /** field → reviewer-supplied value (resolves a `# TODO:` comment). */
  todos: Record<string, unknown>;
  images: ReviewerImage[];
}

export type FileOp =
  | { kind: "delete-file"; absPath: string }
  | { kind: "delete-dir"; absPath: string }
  | { kind: "rename-dir"; from: string; to: string };

export interface DiffResult {
  /** Bytes to write to the finalized `data.yml`. */
  yamlText: string;
  /** Filesystem operations the server should execute, in order. */
  fileOps: FileOp[];
}

export function computeDiff(
  draft: Record<string, unknown>,
  reviewer: ReviewerState,
  draftPath: string,
): DiffResult {
  const draftDir = path.dirname(draftPath);

  const distribution = applyDistribution(draft, reviewer.distribution);
  const { images, fileOps: imageOps } = applyImages(
    Array.isArray(draft.images) ? (draft.images as Record<string, unknown>[]) : [],
    reviewer.images,
    draftDir,
  );

  /** @type {Partial<Record<TopLevelKey, DraftField>>} */
  const fields: Partial<Record<TopLevelKey, DraftField>> = {};

  for (const key of TOP_LEVEL_ORDER) {
    if (key === "_meta") continue; // strip
    if (key === "distribution") {
      if (distribution !== undefined) fields[key] = { value: distribution };
      continue;
    }
    if (key === "images") {
      if (images.length > 0) fields[key] = { value: images };
      continue;
    }

    if (Object.hasOwn(reviewer.scalars, key)) {
      const v = reviewer.scalars[key];
      if (v !== undefined) fields[key] = { value: v };
      continue;
    }
    if (Object.hasOwn(reviewer.todos, key)) {
      const v = reviewer.todos[key];
      if (v !== undefined) fields[key] = { value: v };
      continue;
    }
    if (key in draft && draft[key] !== undefined) {
      fields[key] = { value: draft[key] };
    }
  }

  const yamlText = buildDraftYaml(fields);
  return { yamlText, fileOps: imageOps };
}

// ---------------------------------------------------------------------------
// Distribution
// ---------------------------------------------------------------------------

/**
 * Confirmed counties merge into the existing `native_us_counties` /
 * `native_ca_divisions` shape. Pending and excluded items just drop.
 *
 * Returns a `YAMLMap` rather than a plain JS object: state codes like "01"
 * (AL) sort *before* "12" (FL) lexicographically, but JS object iteration
 * order surfaces canonical-integer keys ("12") before non-canonical ones
 * ("01") — so a plain-object round-trip would scramble the YAML state order.
 * Building a YAMLMap directly preserves the alphabetic order we want and
 * also lets us re-attach the USPS / Canada-Post abbreviation comments in
 * the same style the upstream emitter produces.
 */
function applyDistribution(
  draft: Record<string, unknown>,
  toggle: ReviewerDistribution,
): YAMLMap | undefined {
  const dist =
    typeof draft.distribution === "object" && draft.distribution !== null
      ? (draft.distribution as Record<string, unknown>)
      : undefined;

  const us = cloneCountryMap(dist?.native_us_counties);
  const ca = cloneCountryMap(dist?.native_ca_divisions);

  for (const id of toggle.confirm) {
    if (id.startsWith("us-")) {
      const code = id.slice(3);
      if (code.length !== 5) continue;
      addToCountryMap(us, code.slice(0, 2), code.slice(2));
    } else if (id.startsWith("ca-")) {
      const code = id.slice(3);
      if (code.length !== 4) continue;
      addToCountryMap(ca, code.slice(0, 2), code.slice(2));
    }
  }

  const usKeys = Object.keys(us);
  const caKeys = Object.keys(ca);
  if (usKeys.length === 0 && caKeys.length === 0) return undefined;

  const root = new YAMLMap();
  if (usKeys.length > 0) {
    root.items.push(
      new Pair(new Scalar("native_us_counties"), buildSubdivisionsMap(us, US_STATE_FIPS_TO_ABBR)),
    );
  }
  if (caKeys.length > 0) {
    root.items.push(
      new Pair(new Scalar("native_ca_divisions"), buildSubdivisionsMap(ca, CA_PRUID_TO_ABBR)),
    );
  }
  return root;
}

/**
 * Build a state/province → flow-list YAMLMap with abbreviation comments,
 * matching the style of the original draft emitter.
 */
function buildSubdivisionsMap(
  m: Record<string, string[]>,
  abbrMap: Record<string, string>,
): YAMLMap {
  const out = new YAMLMap();
  for (const prefix of Object.keys(m).sort()) {
    const keyNode = new Scalar(prefix);
    keyNode.type = Scalar.QUOTE_DOUBLE;
    const abbr = abbrMap[prefix];
    if (abbr) keyNode.comment = ` ${abbr}`;
    const seq = new YAMLSeq();
    seq.flow = true;
    for (const suffix of m[prefix].slice().sort()) {
      const sNode = new Scalar(suffix);
      sNode.type = Scalar.QUOTE_DOUBLE;
      seq.items.push(sNode);
    }
    out.items.push(new Pair(keyNode, seq));
  }
  return out;
}

function cloneCountryMap(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const src = v as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [k, list] of Object.entries(src)) {
    if (!Array.isArray(list)) continue;
    out[k] = list.filter((x): x is string => typeof x === "string").slice();
  }
  return out;
}

function addToCountryMap(
  map: Record<string, string[]>,
  parent: string,
  suffix: string,
): void {
  if (!map[parent]) map[parent] = [];
  if (!map[parent].includes(suffix)) {
    map[parent].push(suffix);
    map[parent].sort();
  }
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

interface ImagesDiff {
  images: Record<string, unknown>[];
  fileOps: FileOp[];
}

/**
 * Build the finalized images list from the draft + reviewer state, and emit
 * file ops that bring the on-disk layout in line with it.
 *
 * If any draft image's `local_path` lives under `images.draft/`, the curated
 * `images/` dir is replaced wholesale: excluded files are deleted from
 * `images.draft/`, the curated `images/` is removed, and `images.draft/` is
 * renamed to `images/`. YAML `local_path` values are rewritten accordingly.
 *
 * If the reviewer keeps zero images, both dirs are deleted instead of
 * renamed (avoids leaving an empty `images/`).
 */
function applyImages(
  draftImages: Record<string, unknown>[],
  reviewerImages: ReviewerImage[],
  draftDir: string,
): ImagesDiff {
  const fileOps: FileOp[] = [];

  // Excluded image files → queue deletes.
  for (const r of reviewerImages) {
    if (r.keep) continue;
    const orig = draftImages[r.originalIndex];
    if (!orig) continue;
    const lp = orig.local_path;
    if (typeof lp !== "string") continue;
    fileOps.push({ kind: "delete-file", absPath: path.resolve(draftDir, lp) });
  }

  // Build the kept-and-reordered image list with alt overrides.
  const kept: Record<string, unknown>[] = [];
  let usingDraftDir = false;
  for (const r of reviewerImages) {
    if (!r.keep) continue;
    const orig = draftImages[r.originalIndex];
    if (!orig) continue;
    const next: Record<string, unknown> = { ...orig, alt: r.alt };
    const lp = next.local_path;
    if (typeof lp === "string" && lp.startsWith("images.draft/")) {
      usingDraftDir = true;
      next.local_path = "images/" + lp.slice("images.draft/".length);
    }
    kept.push(next);
  }

  if (usingDraftDir) {
    if (kept.length > 0) {
      fileOps.push({ kind: "delete-dir", absPath: path.join(draftDir, "images") });
      fileOps.push({
        kind: "rename-dir",
        from: path.join(draftDir, "images.draft"),
        to: path.join(draftDir, "images"),
      });
    } else {
      // No kept images → both dirs become noise.
      fileOps.push({ kind: "delete-dir", absPath: path.join(draftDir, "images") });
      fileOps.push({ kind: "delete-dir", absPath: path.join(draftDir, "images.draft") });
    }
  }

  return { images: kept, fileOps };
}
