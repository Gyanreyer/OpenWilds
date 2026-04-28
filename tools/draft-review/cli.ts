/**
 * `draft-review` CLI — boots the review server for a `data.draft.yml` and
 * opens it in the browser.
 *
 *   node tools/draft-review/cli.ts "Echinacea purpurea"
 *   node tools/draft-review/cli.ts data/plantae/asteraceae/echinacea/purpurea/data.draft.yml
 *   node tools/draft-review/cli.ts --port 4200 "Echinacea purpurea"
 *
 * Two ways to point at a draft:
 *
 *   1. Path — anything containing `/` or ending in `.yml`. Treated as either
 *      a `data.draft.yml` directly or the directory containing one.
 *   2. Species name — case-insensitive match against `<genus>/<epithet>` under
 *      `data/plantae/`. We walk plantae once at startup; ~few hundred dirs.
 *
 * Server lifecycle: starts on a random free port, prints the URL, opens the
 * default browser, and exits on Ctrl-C. Phase 7c will wire a graceful exit
 * after a successful POST /api/finalize.
 */

import { stat, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import open from "open";

import { startServer } from "./server.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PLANTAE_ROOT = path.join(REPO_ROOT, "data", "plantae");

interface CliOptions {
  port?: string;
  noOpen?: boolean;
}

const program = new Command();

program
  .name("draft-review")
  .description("Review a plant entry's data.draft.yml in a browser.")
  .argument(
    "<species-or-path>",
    "scientific name (e.g. \"Echinacea purpurea\") or path to a data.draft.yml / containing dir"
  )
  .option("-p, --port <port>", "explicit port (default: random free port)")
  .option("--no-open", "don't auto-open the browser")
  .action(async (target: string, opts: CliOptions) => {
    const draftPath = await resolveDraftPath(target);
    if (!draftPath) {
      console.error(
        `Couldn't locate a data.draft.yml for "${target}".\n  Tried as path and as species name (case-insensitive walk of data/plantae/).`
      );
      process.exit(1);
    }

    const port = opts.port ? parseInt(opts.port, 10) : 0;
    if (opts.port && (!Number.isFinite(port) || port < 0 || port > 65535)) {
      console.error(`--port must be 0-65535; got "${opts.port}"`);
      process.exit(1);
    }

    const { url } = await startServer({ draftPath, port });
    console.log(`\nReview UI: ${url}`);
    console.log(`Draft: ${path.relative(REPO_ROOT, draftPath)}`);
    console.log(`Press Ctrl-C to stop.\n`);

    if (!opts.noOpen) {
      await open(url).catch((err: unknown) => {
        console.error(`(couldn't auto-open browser: ${(err as Error).message})`);
      });
    }
  });

await program.parseAsync();

/**
 * Resolve the user's target to an absolute `data.draft.yml` path.
 *
 * Path-form shortcuts: if the argument contains `/`, ends in `.yml`, or names
 * an existing file/dir, we treat it as a path. A directory argument is
 * resolved by appending `data.draft.yml`. Otherwise we treat it as a binomial
 * and walk `data/plantae/<family>/<genus>/<species>/` looking for a
 * directory whose `<genus>/<species>` (case-insensitive) matches.
 */
async function resolveDraftPath(target: string): Promise<string | null> {
  const looksPathy = target.includes("/") || target.endsWith(".yml");
  if (looksPathy) {
    const abs = path.isAbsolute(target) ? target : path.resolve(target);
    const direct = await tryAsDraft(abs);
    if (direct) return direct;
    // Fall through — maybe the user passed a relative species name with a
    // typo'd path; the walk below may still find a match.
  }

  const trimmed = target.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;
  const [genus, epithet] = parts;
  const want = `${genus}/${epithet}`.toLowerCase();

  // Two-level walk: family/, then genus/. Checking the genus/species pair
  // as a single string avoids scanning species dirs whose genus doesn't match.
  const families = await safeReaddir(PLANTAE_ROOT);
  for (const family of families) {
    const familyDir = path.join(PLANTAE_ROOT, family);
    const genera = await safeReaddir(familyDir);
    for (const g of genera) {
      const speciesDir = path.join(familyDir, g);
      const species = await safeReaddir(speciesDir);
      for (const s of species) {
        if (`${g}/${s}`.toLowerCase() === want) {
          const draft = path.join(speciesDir, s, "data.draft.yml");
          if (await fileExists(draft)) return draft;
        }
      }
    }
  }
  return null;
}

async function tryAsDraft(p: string): Promise<string | null> {
  try {
    const s = await stat(p);
    if (s.isDirectory()) {
      const candidate = path.join(p, "data.draft.yml");
      if (await fileExists(candidate)) return candidate;
      return null;
    }
    if (s.isFile() && p.endsWith(".yml")) return p;
  } catch {
    // not a path — fall through
  }
  return null;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isFile();
  } catch {
    return false;
  }
}
