/**
 * `new-entry` CLI — drafts a data.yml for a native plant species.
 *
 *   node tools/new-entry/src/cli.ts "<scientific name>"
 *   node tools/new-entry/src/cli.ts "Quercus alba" --force
 *   node tools/new-entry/src/cli.ts "Echinacea purpurea" --no-cache
 *
 * Pipeline:
 *   1. GBIF resolves input (synonym-tolerant) → accepted name + taxonomy +
 *      English common names + species-rank synonyms.
 *   2. USDA PLANTS (local checklist + JSON API) supplies category, life cycle,
 *      light/moisture/pH/drought/height/bloom timing/toxicity characteristics,
 *      and coarse regional native status.
 *   3. VASCAN supplies Canadian per-province native flags (used here as a
 *      presence hint; Phase 4 consumes it for geo filtering).
 *   4. iNaturalist supplies a community-preferred common name.
 *   5. Everything merges into a schema v2 draft with TODO comments where no
 *      source had data.
 */

import path from "node:path";
import { Command } from "commander";

import { createCache } from "./cache.ts";
import { resolveFromGbif, type GbifResolved } from "./sources/gbif.ts";
import { resolveFromUsda, type UsdaResolved } from "./sources/usda-plants.ts";
import { getNativeProvinces } from "./sources/vascan.ts";
import { resolveFromINaturalist, type INatResolved } from "./sources/inaturalist.ts";
import {
  resolveFromWildflower,
  type WildflowerResolved,
} from "./sources/wildflower-center.ts";
import { resolveEntryPath, REPO_ROOT } from "./paths.ts";
import {
  buildDraftYaml,
  writeDraftYaml,
  type DraftField,
  type TopLevelKey,
} from "./emit.ts";
import type {
  ConfidenceLevel,
  SourceCitation,
} from "./types.ts";

interface CliOptions {
  force?: boolean;
  cache: boolean;
}

const program = new Command();

program
  .name("new-entry")
  .description("Draft a data.yml for a native plant species.")
  .argument("<name>", "scientific name — canonical or synonym")
  .option("-f, --force", "write data.draft.yml next to an existing data.yml")
  .option("--no-cache", "bypass the on-disk HTTP cache for this run")
  .action(async (name: string, opts: CliOptions) => {
    const cache = createCache(opts.cache !== false);

    // --- 1) GBIF is the taxonomy pivot; everything else keys off its binomial.
    console.log(`→ GBIF match "${name}"`);
    const gbif = await resolveFromGbif(name, cache);
    console.log(
      `  accepted: ${gbif.acceptedName} (GBIF ${gbif.acceptedKey}, match=${gbif.matchType}${gbif.inputWasSynonym ? ", via synonym" : ""})`
    );
    console.log(
      `  classification: ${gbif.family} / ${gbif.genus} / ${gbif.specificEpithet}`
    );

    // --- 2) Downstream sources run in parallel.
    const [usda, vascanProvs, inat] = await Promise.all([
      resolveFromUsda(gbif.acceptedName, cache, name).catch((err) => {
        console.error(`  [usda] ${(err as Error).message}`);
        return null;
      }),
      getNativeProvinces(gbif.acceptedName),
      resolveFromINaturalist(gbif.acceptedName, cache).catch((err) => {
        console.error(`  [inat] ${(err as Error).message}`);
        return null;
      }),
    ]);

    if (usda) {
      console.log(
        `  USDA ${usda.symbol} (id ${usda.id}) — category=${usda.category ?? "?"}, life_cycle=${usda.lifeCycle ?? "?"}, native L48=${usda.native.nativeRegions.includes("L48")}, CAN=${usda.native.nativeRegions.includes("CAN")}`
      );
    } else {
      console.log(`  USDA: not in checklist`);
    }

    // Wildflower.org is keyed by USDA symbol, so it depends on USDA's result.
    let wildflower: WildflowerResolved | null = null;
    if (usda) {
      try {
        wildflower = await resolveFromWildflower(usda.symbol, cache);
        if (wildflower) {
          const h = wildflower.height
            ? `${wildflower.height.min}–${wildflower.height.max}in`
            : "unparsed";
          console.log(
            `  Wildflower ${usda.symbol} — height=${h}${wildflower.heightRaw ? ` ("${wildflower.heightRaw}")` : ""}, bloom=${wildflower.bloomTime ? `${wildflower.bloomTime.start}–${wildflower.bloomTime.end}` : "?"}, colors=${(wildflower.bloomColorNames ?? []).join("/") || "?"}, root=${wildflower.rootType ?? "?"}`
          );
        } else {
          console.log(`  Wildflower: no page for symbol ${usda.symbol}`);
        }
      } catch (err) {
        console.error(`  [wildflower] ${(err as Error).message}`);
      }
    }
    if (vascanProvs) {
      console.log(`  VASCAN native provinces: ${vascanProvs.join(", ")}`);
    } else {
      console.log(`  VASCAN: not listed (either not Canadian-native or not accepted rank)`);
    }
    if (inat?.preferredCommonName) {
      console.log(`  iNat preferred name: "${inat.preferredCommonName}"`);
    }
    if (inat) {
      const ph = inat.phenology;
      if (ph.range) {
        console.log(
          `  iNat bloom phenology: months ${ph.range.start}–${ph.range.end} from ${ph.total} flowering obs (${ph.confidence} confidence)`
        );
      } else {
        console.log(`  iNat bloom phenology: insufficient sample (${ph.total} obs)`);
      }
    }

    // --- 3) Resolve filesystem target and refuse-by-default.
    const loc = await resolveEntryPath(
      gbif.family,
      gbif.genus,
      gbif.specificEpithet
    );

    if (loc.exists && !opts.force) {
      console.error(
        `\nRefusing to overwrite existing entry: ${loc.relPath}\n  Re-run with --force to write data.draft.yml next to it.`
      );
      process.exit(1);
    }

    const outPath =
      loc.exists && opts.force
        ? loc.absPath.replace(/data\.yml$/, "data.draft.yml")
        : loc.absPath;

    // --- 4) Assemble and write.
    const yaml = buildDraftYaml(buildFields(gbif, usda, vascanProvs, inat, wildflower));
    await writeDraftYaml(outPath, yaml);
    console.log(`\nWrote ${path.relative(REPO_ROOT, outPath)}`);
  });

await program.parseAsync();

// ---------------------------------------------------------------------------
// Field assembly
// ---------------------------------------------------------------------------

function buildFields(
  gbif: GbifResolved,
  usda: UsdaResolved | null,
  vascanProvs: string[] | null,
  inat: INatResolved | null,
  wf: WildflowerResolved | null
): Partial<Record<TopLevelKey, DraftField>> {
  const fields: Partial<Record<TopLevelKey, DraftField>> = {};
  const metaSources: Record<string, string> = {};
  const confidence: Record<string, ConfidenceLevel> = {};

  // --- Identity ---
  fields.scientific_name = { value: gbif.acceptedName };
  metaSources.scientific_name = "GBIF";
  confidence.scientific_name = gbif.matchType === "EXACT" ? "high" : "medium";

  // Primary common name: iNat (community-preferred) > GBIF (top-ranked
  // vernacular) > USDA (single official name) > first entry in the merged
  // list. Confidence reflects inter-source agreement.
  const primary = pickPrimaryCommonName(gbif, usda, inat);
  fields.primary_common_name = { value: primary.name };
  metaSources.primary_common_name = primary.source;
  confidence.primary_common_name = primary.confidence;

  // `common_names` begins with the primary and is followed by the remaining
  // merged candidates (deduped).
  const commonNames = mergeCommonNames(primary.name, gbif.commonNames, usda?.commonName, inat);
  fields.common_names = { value: commonNames };
  metaSources.common_names = [
    "GBIF",
    usda?.commonName ? "USDA" : null,
    inat?.preferredCommonName ? "iNaturalist" : null,
  ]
    .filter(Boolean)
    .join("+");
  confidence.common_names = commonNames.length >= 2 ? "high" : "low";

  if (gbif.synonyms.length > 0) {
    fields.synonyms = { value: gbif.synonyms };
    metaSources.synonyms = "GBIF";
  } else {
    fields.synonyms = {
      todoPlaceholder: "synonyms: []",
      todoReason: "no species-rank synonyms from GBIF — confirm or remove",
    };
  }

  // --- Habit ---
  // USDA is primary; Wildflower is a cross-reference. Mismatches drop
  // confidence from high → medium and are surfaced in _meta.
  const category = usda?.category ?? wf?.category;
  if (category) {
    fields.category = { value: category };
    const agree = !usda?.category || !wf?.category || usda.category === wf.category;
    metaSources.category = agree
      ? `USDA GrowthHabits + Wildflower Habit`
      : `USDA=${usda?.category}; Wildflower=${wf?.category} — mismatch`;
    confidence.category = agree ? "high" : "medium";
  } else {
    fields.category = todo("no category from USDA or Wildflower", "category: Forb");
  }

  const lifeCycle = usda?.lifeCycle ?? wf?.lifeCycle;
  if (lifeCycle) {
    fields.life_cycle = { value: lifeCycle };
    const agree = !usda?.lifeCycle || !wf?.lifeCycle || usda.lifeCycle === wf.lifeCycle;
    metaSources.life_cycle = agree
      ? "USDA Durations + Wildflower Duration"
      : `USDA=${usda?.lifeCycle}; Wildflower=${wf?.lifeCycle} — mismatch`;
    confidence.life_cycle = agree ? "high" : "medium";
  } else {
    fields.life_cycle = todo("no life cycle from USDA or Wildflower", "life_cycle: Perennial");
  }

  // --- Flowering ---
  // Priority: iNat phenology (empirical, month-granular, large sample) >
  // Wildflower's curated month list > USDA's season-string. Cross-references
  // from the non-selected sources get a comment in _meta.sources so the
  // reviewer can see where each range would land.
  const crossRefs: string[] = [];
  if (wf?.bloomTime) crossRefs.push(`Wildflower=${wf.bloomTime.start}–${wf.bloomTime.end}`);
  if (usda?.fields.bloom_time)
    crossRefs.push(`USDA=${usda.fields.bloom_time.start}–${usda.fields.bloom_time.end}`);

  if (inat?.phenology.range && inat.phenology.confidence !== "none") {
    fields.bloom_time = { value: inat.phenology.range };
    metaSources.bloom_time = `iNaturalist phenology (${inat.phenology.total} flowering obs)${
      crossRefs.length ? `; ${crossRefs.join(", ")}` : ""
    }`;
    confidence.bloom_time = inat.phenology.confidence;
  } else if (wf?.bloomTime) {
    fields.bloom_time = { value: wf.bloomTime };
    metaSources.bloom_time = `Wildflower Bloom Time${crossRefs.length > 1 ? `; ${crossRefs[1]}` : ""}`;
    confidence.bloom_time = "medium";
  } else if (usda?.fields.bloom_time) {
    fields.bloom_time = { value: usda.fields.bloom_time };
    metaSources.bloom_time = "USDA 'Bloom Period' (no iNat/Wildflower signal)";
    confidence.bloom_time = "low";
  } else {
    fields.bloom_time = todo(
      "no phenology signal from any source",
      "bloom_time: { start: 6, end: 8 }"
    );
  }

  // Bloom color: Wildflower gives curated per-species color names; USDA gives
  // a single label. Prefer Wildflower. Hex is always reviewer-fill — the
  // existing curated entries use species-specific shades that we shouldn't
  // guess at from a name alone.
  const colorNames = wf?.bloomColorNames?.length
    ? wf.bloomColorNames
    : usda?.fields.bloom_color_name
    ? [usda.fields.bloom_color_name]
    : null;
  if (colorNames) {
    fields.bloom_color = todo(
      `${wf?.bloomColorNames ? "Wildflower" : "USDA"} Flower Color="${colorNames.join(", ")}" — reviewer adds hex`,
      `bloom_color: [${colorNames.map((n) => `{ name: "${n}", hex: "#RRGGBB" }`).join(", ")}]`
    );
  } else {
    fields.bloom_color = todo("literature / observations — reviewer fills name + hex");
  }

  // --- Size (inches) ---
  // Wildflower's "Size Notes" is authoritative for NA natives (LBJWC curates
  // against botanical literature) and parses into a real min/max range.
  // Fall back to USDA's single-point "Height, Mature" — known to
  // under-report forbs — only if Wildflower didn't resolve.
  if (wf?.height) {
    fields.height = { value: wf.height };
    metaSources.height = `Wildflower Size Notes="${wf.heightRaw}"${
      usda?.fields.height
        ? ` (cross-ref: USDA Mature=${usda.fields.height.max}in)`
        : ""
    }`;
    confidence.height = "high";
  } else if (usda?.fields.height) {
    fields.height = { value: usda.fields.height };
    metaSources.height =
      "USDA 'Height, Mature (feet)' → inches (single point; verify — forbs often under-reported)";
    confidence.height = "low";
  } else if (wf?.heightRaw) {
    fields.height = todo(
      `Wildflower Size Notes didn't parse: "${wf.heightRaw}"`,
      "height: { min: 12, max: 24 }"
    );
  } else {
    fields.height = todo("no height from USDA or Wildflower", "height: { min: 12, max: 24 }");
  }

  // --- Site preferences ---
  // Wildflower's explicit Sun/Part Shade/Shade labels are curated per
  // species; USDA's "Shade Tolerance" is a single rating we have to invert
  // into a range. Prefer Wildflower when both speak.
  if (wf?.light) {
    fields.light = { value: wf.light };
    metaSources.light = "Wildflower Light Requirement";
    confidence.light = "high";
  } else if (usda?.fields.light) {
    fields.light = { value: usda.fields.light };
    metaSources.light = "USDA 'Shade Tolerance' (inverted)";
    confidence.light = "medium";
  } else {
    fields.light = todo("no light data from Wildflower or USDA", "light: { min: 3, max: 5 }");
  }

  if (wf?.moisture) {
    fields.moisture = { value: wf.moisture };
    metaSources.moisture = "Wildflower Soil Moisture";
    confidence.moisture = "high";
  } else if (usda?.fields.moisture) {
    fields.moisture = { value: usda.fields.moisture };
    metaSources.moisture = "USDA 'Moisture Use'";
    confidence.moisture = "medium";
  } else {
    fields.moisture = todo("no moisture data from Wildflower or USDA", "moisture: { min: 2, max: 4 }");
  }
  if (usda?.fields.soil_ph) {
    fields.soil_ph = { value: usda.fields.soil_ph };
    metaSources.soil_ph = "USDA 'pH, Minimum/Maximum'";
    confidence.soil_ph = "high";
  } else {
    fields.soil_ph = todo("USDA pH not available");
  }
  if (usda?.fields.drought_tolerance) {
    fields.drought_tolerance = { value: usda.fields.drought_tolerance };
    metaSources.drought_tolerance = "USDA 'Drought Tolerance'";
    confidence.drought_tolerance = "high";
  } else {
    fields.drought_tolerance = todo("USDA 'Drought Tolerance' not available or 'None'");
  }

  if (wf?.rootType) {
    fields.root_type = { value: wf.rootType };
    metaSources.root_type = "Wildflower Root Type";
    confidence.root_type = "high";
  } else {
    fields.root_type = todo("Wildflower Root Type not available; reviewer fills");
  }

  // --- Conservation / hazard ---
  fields.conservation_status = todo("NatureServe integration deferred");

  if (usda?.fields.livestock_toxicity_hint) {
    fields.toxicity = todo(
      `USDA livestock toxicity="${usda.fields.livestock_toxicity_hint}" — reviewer fills humans/pets/livestock per literature`
    );
  } else {
    fields.toxicity = todo("literature review needed (humans, pets, livestock)");
  }

  // --- Geography ---
  fields.distribution = todo("county / CD distribution (Phase 4)");

  // --- Media ---
  fields.images = todo("iNaturalist image pipeline (Phase 5)");

  // --- Attribution ---
  const sources: SourceCitation[] = [
    {
      name: "GBIF Backbone Taxonomy",
      url: gbif.sourceUrl,
      accessed: isoDate(),
    },
  ];
  if (usda) {
    sources.push({
      name: "USDA PLANTS Database",
      url: usda.sourceUrl,
      accessed: isoDate(),
    });
  }
  if (vascanProvs) {
    sources.push({
      name: "VASCAN (Database of Vascular Plants of Canada)",
      url: `https://data.canadensys.net/vascan/taxon/${encodeURIComponent(gbif.acceptedName)}`,
      accessed: isoDate(),
    });
  }
  if (inat) {
    sources.push({
      name: "iNaturalist",
      url: inat.sourceUrl,
      accessed: isoDate(),
    });
  }
  if (wf) {
    sources.push({
      name: "Lady Bird Johnson Wildflower Center",
      url: wf.url,
      accessed: isoDate(),
    });
  }
  fields.sources = { value: sources };

  // --- Draft metadata ---
  const metaExtras: Record<string, unknown> = {};
  if (usda) {
    metaExtras.usda_symbol = usda.symbol;
    metaExtras.usda_native_regions = usda.native.nativeRegions;
    if (usda.native.introducedRegions.length > 0) {
      metaExtras.usda_introduced_regions = usda.native.introducedRegions;
    }
  }
  if (vascanProvs) metaExtras.vascan_native_provinces = vascanProvs;

  fields._meta = {
    value: {
      generated_by: "tools/new-entry",
      generated_at: isoDate(),
      sources: metaSources,
      confidence,
      ...metaExtras,
    },
  };

  return fields;
}

/**
 * Merge common-name candidates from GBIF, USDA, and iNat. The primary name
 * (already picked by `pickPrimaryCommonName`) is hoisted to index 0 so
 * `common_names[0] === primary_common_name` is an invariant consumers can
 * rely on. The rest of the list is the deduplicated union of remaining
 * candidates, case-insensitively matched, capped at 5 for review.
 */
function mergeCommonNames(
  primary: string,
  gbifNames: string[],
  usdaCommon: string | undefined,
  inat: INatResolved | null
): string[] {
  const out: string[] = [primary];
  const seen = new Set<string>([primary.toLowerCase()]);
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const titled = titleCase(raw.trim());
    const key = titled.toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(titled);
  };
  push(inat?.preferredCommonName);
  push(inat?.englishCommonName);
  for (const n of gbifNames) push(n);
  push(usdaCommon);
  return out.slice(0, 5);
}

/**
 * Pick the single display name for a species. Priority:
 *   1. iNat `english_common_name` (explicit English, locale-safe)
 *   2. iNat `preferred_common_name` (community-preferred; may be non-English
 *      under odd locales but on plain API access defaults to English)
 *   3. GBIF top-ranked vernacular (our `collectCommonNames` output)
 *   4. USDA CommonName
 *   5. first remaining candidate
 * Confidence: high when ≥2 sources agree on the same string (case-insensitive),
 * medium for a single-source signal, low for the fallback.
 */
function pickPrimaryCommonName(
  gbif: GbifResolved,
  usda: UsdaResolved | null,
  inat: INatResolved | null
): { name: string; source: string; confidence: ConfidenceLevel } {
  const inatName = inat?.englishCommonName || inat?.preferredCommonName;
  const gbifName = gbif.commonNames[0];
  const usdaName = usda?.commonName;

  const candidates: Array<{ name: string; source: string }> = [];
  if (inatName) candidates.push({ name: titleCase(inatName.trim()), source: "iNaturalist" });
  if (gbifName) candidates.push({ name: titleCase(gbifName.trim()), source: "GBIF" });
  if (usdaName) candidates.push({ name: titleCase(usdaName.trim()), source: "USDA" });

  if (candidates.length === 0) {
    return {
      name: "TODO",
      source: "none — reviewer fills primary_common_name",
      confidence: "low",
    };
  }

  const primary = candidates[0];
  const agreeingSources = candidates
    .filter((c) => c.name.toLowerCase() === primary.name.toLowerCase())
    .map((c) => c.source);
  const confidence: ConfidenceLevel =
    agreeingSources.length >= 2 ? "high" : candidates.length === 1 ? "medium" : "medium";

  return {
    name: primary.name,
    source:
      agreeingSources.length > 1
        ? `${primary.source} (confirmed by ${agreeingSources.slice(1).join(", ")})`
        : primary.source,
    confidence,
  };
}

function titleCase(s: string): string {
  return s
    .split(/(\s+|-)/)
    .map((w) =>
      /^\s+$|-/.test(w) ? w : (w[0]?.toUpperCase() ?? "") + w.slice(1).toLowerCase()
    )
    .join("");
}

function todo(reason: string, placeholder?: string): DraftField {
  return { todoReason: reason, todoPlaceholder: placeholder };
}

function isoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
