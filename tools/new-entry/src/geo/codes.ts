/**
 * Static prefix-to-region maps for the codes carried by the geo index.
 *
 * Both schemes encode the parent region in their leading digits:
 *   - 5-digit US FIPS: first 2 digits = state FIPS.
 *   - 4-digit StatCan CDUID: first 2 digits = province PRUID.
 *
 * Pulling those out gives us a USPS / Canada Post abbreviation (e.g. "MI",
 * "ON") that we use to annotate review hints in `_meta.distribution_review`
 * and to compare against USDA's state set.
 */

export const US_STATE_FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
  // Territories
  "60": "AS", "66": "GU", "69": "MP", "72": "PR", "78": "VI",
};

export const CA_PRUID_TO_ABBR: Record<string, string> = {
  "10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC",
  "35": "ON", "46": "MB", "47": "SK", "48": "AB", "59": "BC",
  "60": "YT", "61": "NT", "62": "NU",
};

/** "26161" → "MI"; "" or unknown → null. */
export function stateAbbrFromFips(fips: string): string | null {
  return US_STATE_FIPS_TO_ABBR[fips.slice(0, 2)] ?? null;
}

/** "3520" → "ON"; "" or unknown → null. */
export function provinceAbbrFromCduid(cduid: string): string | null {
  return CA_PRUID_TO_ABBR[cduid.slice(0, 2)] ?? null;
}

/** "26161" → "26"; falls back to empty for malformed input. */
export function stateFipsFromCounty(fips: string): string {
  return fips.slice(0, 2);
}

/**
 * TDWG World Geographical Scheme for Recording Plant Distributions (WGSRPD)
 * Level 3 codes to USPS state code. WCVP (Kew's World Checklist of Vascular
 * Plants) reports native/introduced at this granularity; we map back to the
 * USPS two-letter code to combine with USDA's distribution data on the same
 * key. Codes confirmed against live WCVP records pulled through GBIF's
 * `/species/{key}/distributions` endpoint.
 *
 * Missing from this map on purpose: territories (PUE Puerto Rico, LEE
 * Leeward Is.) — schema v2 doesn't yet carry them. Unknown codes trigger a
 * warning in the caller.
 */
export const TDWG_L3_TO_USPS: Record<string, string> = {
  ALA: "AL", ARI: "AZ", ARK: "AR", ASK: "AK", CAL: "CA", CNT: "CT",
  COL: "CO", DEL: "DE", FLA: "FL", GEO: "GA", HAW: "HI", IDA: "ID",
  ILL: "IL", INI: "IN", IOW: "IA", KAN: "KS", KTY: "KY", LOU: "LA",
  MAI: "ME", MAS: "MA", MIC: "MI", MIN: "MN", MNT: "MT", MRY: "MD",
  MSI: "MS", MSO: "MO", NCA: "NC", NDA: "ND", NEB: "NE", NEV: "NV",
  NWH: "NH", NWJ: "NJ", NWM: "NM", NWY: "NY", OHI: "OH", OKL: "OK",
  ORE: "OR", PEN: "PA", RHO: "RI", SCA: "SC", SDA: "SD", TEN: "TN",
  TEX: "TX", UTA: "UT", VER: "VT", VRG: "VA", WAS: "WA", WDC: "DC",
  WIS: "WI", WVA: "WV", WYO: "WY",
};

/**
 * TDWG WGSRPD Level 3 → Canada Post province/territory abbreviation.
 * Note: TDWG splits Newfoundland (NFL) from Labrador (LAB); StatCan merged
 * them into one province in 2001. Both codes map to NL here.
 */
export const TDWG_L3_TO_CAPOST: Record<string, string> = {
  ABT: "AB", BRC: "BC", LAB: "NL", MAN: "MB", NBR: "NB", NFL: "NL",
  NSC: "NS", NUN: "NU", NWT: "NT", ONT: "ON", PEI: "PE", QUE: "QC",
  SAS: "SK", YUK: "YT",
};
