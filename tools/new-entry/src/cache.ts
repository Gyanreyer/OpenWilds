/**
 * JSON-on-disk cache for upstream HTTP responses.
 *
 * Layout: `tools/new-entry/.cache/<source>/<key>.json[.gz]`. Sources opt into
 * gzip per-write; reads transparently try `.json.gz` first, then `.json`. The
 * disk footprint is bounded by the number of species we've ever queried; no
 * TTL — pass `--no-cache` to bypass for a single run, or delete `.cache/` to
 * reset.
 *
 * Gzip is worth it for paged GBIF occurrence dumps (hundreds of KB → tens) and
 * the USDA distribution CSV; small JSON profile responses are left raw so
 * they're easy to grep when debugging.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

const TOOL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const CACHE_DIR = path.join(TOOL_ROOT, ".cache");

export interface WriteOptions {
  /** Gzip the payload before writing. Reads find it transparently. */
  gzip?: boolean;
}

export interface Cache {
  get<T>(source: string, key: string): Promise<T | null>;
  set<T>(source: string, key: string, value: T, opts?: WriteOptions): Promise<void>;
}

/** Make a cache key safe for use as a file name (no slashes, no spaces). */
export function cacheKey(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
}

export function createCache(enabled: boolean): Cache {
  if (!enabled) {
    return {
      async get() {
        return null;
      },
      async set() {
        // no-op
      },
    };
  }
  return {
    async get<T>(source: string, key: string): Promise<T | null> {
      const base = path.join(CACHE_DIR, source, `${key}.json`);
      // Prefer gzip when both exist (newer writes won the upgrade).
      try {
        const buf = await readFile(`${base}.gz`);
        return JSON.parse(gunzipSync(buf).toString("utf8")) as T;
      } catch {
        // fall through to plain
      }
      try {
        const text = await readFile(base, "utf8");
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    async set<T>(source: string, key: string, value: T, opts?: WriteOptions): Promise<void> {
      const dir = path.join(CACHE_DIR, source);
      await mkdir(dir, { recursive: true });
      const base = path.join(dir, `${key}.json`);
      if (opts?.gzip) {
        const json = JSON.stringify(value);
        await writeFile(`${base}.gz`, gzipSync(Buffer.from(json, "utf8")));
      } else {
        await writeFile(base, JSON.stringify(value, null, 2));
      }
    },
  };
}
