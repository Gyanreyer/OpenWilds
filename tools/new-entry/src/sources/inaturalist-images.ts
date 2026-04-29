/**
 * iNaturalist image-candidate source.
 *
 * Pulls research-grade observations for a taxon, filters to photos under an
 * open license (CC0 / CC-BY / CC-BY-SA / CC-BY-NC / CC-BY-NC-SA), and returns
 * the top-N candidates ready for download.
 *
 *   /v1/observations?taxon_id=<id>
 *     &quality_grade=research
 *     &photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa
 *     &order_by=votes&order=desc          ← `votes` not `faves`; iNat's
 *                                            order_by=faves is a documented
 *                                            misnomer that sorts by
 *                                            created_at instead.
 *     &term_id=12&term_value_id=13|14     ← Plant Phenology, queried twice
 *                                            (Flowering then Fruiting) so we
 *                                            return a quota mix of both
 *                                            life-stage shots.
 *     &per_page=60
 *
 * Three-pass strategy: each pass fills its own quota slot, deduping against
 * earlier passes by observation id. Each accepted observation can contribute
 * up to `MAX_PHOTOS_PER_OBSERVATION` photos — many iNat observations include
 * a habit shot plus close-ups, so taking the first two is a cheap way to get
 * whole-plant coverage alongside the detail-skewed top-voted shots.
 *   1. Flowering — annotated Phenology=Flowering. Detail shots of bloom.
 *   2. Fruiting — annotated Phenology=Fruiting. Detail shots of fruit/seed.
 *   3. Unfiltered — top-faved open-license obs of *any* phenology, excluding
 *      ones already picked. This pass is what surfaces whole-plant/habit
 *      shots, which are usually unannotated and would be invisible to the
 *      phenology-filtered passes. Also doubles as the catch-all for ferns and
 *      undertagged taxa where the flowering/fruiting passes underfill.
 *
 * License normalization: iNat returns short codes (`cc0`, `cc-by-nc`) without
 * version. Our schema accepts unversioned forms like `CC-BY` — we use those
 * rather than guessing a version, since iNat doesn't carry that signal per
 * photo. Reviewers can tighten if they care.
 */

import type { Cache } from "../cache.ts";
import type { ImageLicense } from "../types.ts";

const BASE = "https://api.inaturalist.org/v1";
const OPEN_LICENSES = ["cc0", "cc-by", "cc-by-sa", "cc-by-nc", "cc-by-nc-sa"] as const;
const PER_PAGE = 60;
const MAX_PHOTOS_PER_OBSERVATION = 2;

interface INatPhoto {
  id: number;
  url?: string;
  license_code?: string | null;
  attribution?: string;
  original_dimensions?: { width: number; height: number };
}

interface INatUser {
  id: number;
  login?: string;
  name?: string | null;
}

interface INatObservation {
  id: number;
  faves_count?: number;
  cached_votes_total?: number;
  observed_on?: string | null;
  photos?: INatPhoto[];
  user?: INatUser;
}

interface ObservationsResponse {
  total_results?: number;
  results?: INatObservation[];
}

export type Phenology = "flowering" | "fruiting" | "unfiltered";

export interface ImageCandidate {
  observationId: number;
  photoId: number;
  /** Full-resolution download URL (`.../original.<ext>`). */
  originalUrl: string;
  /** Normalized to the schema's ImageLicense union. */
  license: ImageLicense;
  /** Display name preferred over login when present. */
  creatorName: string;
  /** Public iNat profile URL — null if user.login is missing. */
  creatorUrl: string | null;
  /** Observation page URL, used as `source_url`. */
  observationUrl: string;
  /** ISO date string (YYYY-MM-DD) when the photo was taken; null if unknown. */
  observedOn: string | null;
  /** Faves count used for ranking — useful for review-time logging. */
  faves: number;
  /** Which annotation pass this candidate came from. */
  phenology: Phenology;
}

const CACHE_SOURCE_KEY = "inaturalist-images";

async function fetchJson<T>(url: URL | string, cache: Cache, key: string): Promise<T> {
  const cached = await cache.get<T>(CACHE_SOURCE_KEY, key);
  if (cached !== null) {
    return cached;
  }
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`iNat ${url}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as T;
  await cache.set(CACHE_SOURCE_KEY, key, json);
  return json;
}

export interface ImageCandidateQuota {
  flowering: number;
  fruiting: number;
  unfiltered: number;
}

export interface ImageCandidatesResult {
  candidates: ImageCandidate[];
  floweringCount: number;
  fruitingCount: number;
  unfilteredCount: number;
}

/**
 * Image candidates for a taxon. Three sequential passes (flowering, fruiting,
 * unfiltered), each filling up to its own quota and skipping observations
 * already picked. The unfiltered pass also absorbs any leftover slots from
 * underfilled earlier passes, so the total returned is always ≤
 * `flowering + fruiting + unfiltered` and equal to it whenever the taxon has
 * enough open-licensed observations.
 */
export async function fetchImageCandidates(
  taxonId: number,
  cache: Cache,
  quota: ImageCandidateQuota
): Promise<ImageCandidatesResult> {
  const targetCount = quota.flowering + quota.fruiting + quota.unfiltered;

  const baseQueryURL = new URL(`${BASE}/observations`);
  baseQueryURL.searchParams.set("taxon_id", taxonId.toString());
  baseQueryURL.searchParams.set("quality_grade", "research");
  // Filter to only observations with photos
  baseQueryURL.searchParams.set("photos", "true");
  // Filter to open licenses we recognize
  baseQueryURL.searchParams.set("photo_license", OPEN_LICENSES.join(","));
  baseQueryURL.searchParams.set("order_by", "votes");
  baseQueryURL.searchParams.set("order", "desc");
  // Reach deeper than `targetCount` so passes can keep walking when early
  // observations are skipped (license, dedup with earlier passes, photos
  // already counted toward this obs's MAX_PHOTOS_PER_OBSERVATION cap).
  baseQueryURL.searchParams.set("per_page", PER_PAGE.toString());

  const candidates: ImageCandidate[] = [];
  const seenObs = new Set<number>();

  const collect = async (
    url: URL | string,
    cacheKeySuffix: string,
    maxEntries: number,
    phenology: Phenology
  ): Promise<number> => {
    if (maxEntries <= 0) {
      return 0;
    }
    const resp = await fetchJson<ObservationsResponse>(
      url,
      cache,
      `images-${cacheKeySuffix}-${taxonId}`
    );
    let added = 0;
    for (const obs of resp.results ?? []) {
      if (added >= maxEntries) break;
      if (candidates.length >= targetCount) break;
      if (seenObs.has(obs.id)) {
        // Skip observations we've already included from an earlier pass.
        continue;
      }
      const fromObs = pickFromObservation(obs, phenology);
      if (fromObs.length === 0) continue;
      for (const c of fromObs) {
        if (added >= maxEntries) break;
        if (candidates.length >= targetCount) break;
        candidates.push(c);
        added++;
      }
      seenObs.add(obs.id);
    }
    return added;
  };

  const floweringQueryURL = new URL(baseQueryURL);
  // Filter to "flowers and fruits" annotation group
  floweringQueryURL.searchParams.set("term_id", "12");
  // Filter to "flowers" annotation within "flowers and fruits" group
  floweringQueryURL.searchParams.set("term_value_id", "13");
  const floweringCount = await collect(
    floweringQueryURL,
    "flowering",
    quota.flowering,
    "flowering"
  );

  const fruitingQueryURL = new URL(baseQueryURL);
  // Filter to "flowers and fruits" annotation group
  fruitingQueryURL.searchParams.set("term_id", "12");
  // Filter to "fruits or seeds" annotation within "flowers and fruits" group
  fruitingQueryURL.searchParams.set("term_value_id", "14");
  const fruitingCount = await collect(
    fruitingQueryURL,
    "fruiting",
    quota.fruiting,
    "fruiting"
  );

  const unfilteredCount = await collect(
    baseQueryURL,
    "all",
    // Fill the rest of the quota with unfiltered observations
    targetCount - candidates.length,
    "unfiltered"
  );

  return { candidates, floweringCount, fruitingCount, unfilteredCount };
}

/**
 * Up to `MAX_PHOTOS_PER_OBSERVATION` valid candidates from one observation.
 * Many iNat uploads include a habit shot plus close-ups in the same record;
 * walking past the first photo (without going wild) tends to surface
 * whole-plant views the votes-desc sort otherwise misses. Photos under an
 * unrecognized or missing license are skipped, not counted toward the cap.
 */
function pickFromObservation(
  obs: INatObservation,
  phenology: Phenology
): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const user = obs.user;
  const creatorName = user?.name?.trim() || user?.login || "Unknown";
  const creatorUrl = user?.login
    ? `https://www.inaturalist.org/people/${user.login}`
    : null;
  const observationUrl = `https://www.inaturalist.org/observations/${obs.id}`;
  const observedOn = obs.observed_on || null;
  const faves = obs.faves_count ?? obs.cached_votes_total ?? 0;

  for (const photo of obs.photos ?? []) {
    if (out.length >= MAX_PHOTOS_PER_OBSERVATION) break;
    const license = normalizeLicense(photo.license_code);
    if (!license) continue;
    if (!photo.url) continue;
    // iNaturalist uses a convention where image file names are "<size>.<ext>";
    // the API gives the "square" thumbnail URL by default — swap in "original"
    // for the full-resolution version.
    const originalUrl = photo.url.replace(/\/square\.([a-zA-Z]+)/, "/original.$1");
    out.push({
      observationId: obs.id,
      photoId: photo.id,
      originalUrl,
      license,
      creatorName,
      creatorUrl,
      observationUrl,
      observedOn,
      faves,
      phenology,
    });
  }
  return out;
}

/**
 * Map iNat's lowercase license code to our schema's ImageLicense union. CC-BY-ND
 * variants (including CC-BY-NC-ND) are deliberately rejected — we may downscale
 * images, which is a derivative work.
 */
function normalizeLicense(code: string | null | undefined): ImageLicense | null {
  switch (code) {
    case "cc0":
      return "CC0";
    case "cc-by":
      return "CC-BY";
    case "cc-by-sa":
      return "CC-BY-SA";
    case "cc-by-nc":
      return "CC-BY-NC";
    case "cc-by-nc-sa":
      return "CC-BY-NC-SA";
    default:
      return null;
  }
}
