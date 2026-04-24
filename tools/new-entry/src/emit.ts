/**
 * YAML emitter for draft `data.yml` files.
 *
 * Fields a source actually resolved are rendered as real YAML. Fields we
 * couldn't fill are rendered as commented-out key/value lines with a TODO
 * marker, so the reviewer sees the *shape* of what's missing and why — and
 * the file always parses as valid YAML at every stage of review.
 *
 *   # category: Forb  # TODO: not yet resolved (source: usda-plants)
 *
 * Top-level key order matches [tools/migrate-v1-to-v2.ts](../../migrate-v1-to-v2.ts)
 * and [SCHEMA.md](../../../SCHEMA.md) — keep them in sync.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Document, Pair, Scalar } from "yaml";

export const TOP_LEVEL_ORDER = [
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
] as const;

export type TopLevelKey = (typeof TOP_LEVEL_ORDER)[number];

export interface DraftField {
  /** Filled value. If absent, the field is emitted as a TODO comment. */
  value?: unknown;
  /** One-line reason shown after the TODO marker. */
  todoReason?: string;
  /**
   * Commented-out placeholder shown in the YAML so the reviewer sees the
   * expected shape. E.g. `"category: Forb"`. Defaults to `"<key>: <TBD>"`.
   */
  todoPlaceholder?: string;
}

export function buildDraftYaml(fields: Partial<Record<TopLevelKey, DraftField>>): string {
  const doc = new Document({});
  // Document's default contents is a YAMLMap, but we want to build the items
  // explicitly so we can attach `commentBefore` to specific pairs.
  const items: Pair[] = [];
  let pendingComment = "";

  const flushInto = (pair: Pair<Scalar>) => {
    if (!pendingComment) return;
    // yaml prepends "#" to each line; leading space becomes "# line".
    pair.key.commentBefore = pendingComment;
    pendingComment = "";
  };

  for (const key of TOP_LEVEL_ORDER) {
    const f = fields[key];
    if (!f) continue;
    if (f.value === undefined) {
      const placeholder = f.todoPlaceholder ?? `${key}: <TBD>`;
      const reason = f.todoReason ?? "not yet resolved";
      const line = ` ${placeholder}  # TODO: ${reason}`;
      pendingComment += pendingComment ? `\n${line}` : line;
    } else {
      const keyNode = new Scalar(key);
      const pair = new Pair<Scalar>(keyNode, f.value);
      flushInto(pair);
      items.push(pair);
    }
  }

  // Any trailing TODOs after the last filled field become a document-end
  // comment. Put a leading newline on each line so the block sits below the
  // last pair cleanly.
  if (pendingComment) {
    doc.comment = pendingComment;
  }

  // Assemble contents. `doc.add` accepts a Pair.
  for (const pair of items) {
    doc.add(pair);
  }

  return doc.toString({
    lineWidth: 0,
    blockQuote: "literal",
    defaultStringType: "PLAIN",
    defaultKeyType: "PLAIN",
  });
}

export async function writeDraftYaml(absPath: string, yaml: string): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, yaml, "utf8");
}
