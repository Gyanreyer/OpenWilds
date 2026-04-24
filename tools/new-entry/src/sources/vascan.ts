/**
 * VASCAN source — Canadian native-province lookup.
 *
 * Parses the committed `data/vascan.csv` (accepted species only, infraspecific
 * ranks rolled up) into an in-memory Map<binomial, ISO3166-2 codes[]>. Phase 4
 * uses this to filter GBIF occurrences for the Canadian side; Phase 3 just
 * surfaces whether the species is tracked as native in any Canadian province.
 *
 * Columns: `scientific_name,native_provinces` (pipe-separated codes).
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseCsv } from "csv-parse/sync";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VASCAN_PATH = path.resolve(HERE, "..", "..", "data", "vascan.csv");

let vascanIndex: Map<string, string[]> | null = null;

async function loadVascanIndex(): Promise<Map<string, string[]>> {
  if (vascanIndex) {
    return vascanIndex;
  }
  const text = await readFile(VASCAN_PATH, "utf8");
  const rows = parseCsv(text, { columns: true, skip_empty_lines: true }) as {
    scientific_name: string;
    native_provinces: string;
  }[];
  const index = new Map<string, string[]>();
  for (const row of rows) {
    const provs = row.native_provinces.split("|").filter(Boolean);
    if (provs.length > 0) {
      index.set(row.scientific_name, provs);
    }
  }
  vascanIndex = index;
  return index;
}

/**
 * Returns the ISO 3166-2 codes of Canadian provinces/territories where this
 * species is tracked as native (rolled up across infraspecific ranks), or
 * `null` when the species is not in VASCAN at all.
 */
export async function getNativeProvinces(
  acceptedBinomial: string
): Promise<string[] | null> {
  const index = await loadVascanIndex();
  return index.get(acceptedBinomial) ?? null;
}
