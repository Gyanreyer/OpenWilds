/**
 * JSON-on-disk cache for upstream HTTP responses.
 *
 * Layout: `tools/new-entry/.cache/<source>/<key>.json`. The disk footprint is
 * bounded by the number of species we've ever queried; no TTL — pass
 * `--no-cache` to bypass for a single run, or delete `.cache/` to reset.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const CACHE_DIR = path.join(TOOL_ROOT, ".cache");

export interface Cache {
  get<T>(source: string, key: string): Promise<T | null>;
  set<T>(source: string, key: string, value: T): Promise<void>;
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
      const f = path.join(CACHE_DIR, source, `${key}.json`);
      try {
        const text = await readFile(f, "utf8");
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
    async set<T>(source: string, key: string, value: T): Promise<void> {
      const dir = path.join(CACHE_DIR, source);
      await mkdir(dir, { recursive: true });
      const f = path.join(dir, `${key}.json`);
      await writeFile(f, JSON.stringify(value, null, 2));
    },
  };
}
