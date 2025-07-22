import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import yaml from "js-yaml";
import clipboardy from "clipboardy";

// Abbreviation maps
const countryAbbr = {
  "United States": "US",
  Canada: "CA",
  Mexico: "MX",
};

const usStates = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
};

const caProvinces = {
  Alberta: "AB",
  "British Columbia": "BC",
  Manitoba: "MB",
  "New Brunswick": "NB",
  "Newfoundland and Labrador": "NL",
  "Nova Scotia": "NS",
  Ontario: "ON",
  "Prince Edward Island": "PE",
  Quebec: "QC",
  Saskatchewan: "SK",
  "Northwest Territories": "NT",
  Nunavut: "NU",
  Yukon: "YT",
};

const mxStates = {
  Aguascalientes: "AG",
  "Baja California": "BC",
  "Baja California Sur": "BS",
  Campeche: "CM",
  Chiapas: "CS",
  Chihuahua: "CH",
  Coahuila: "CO",
  Colima: "CL",
  Durango: "DG",
  Guanajuato: "GT",
  Guerrero: "GR",
  Hidalgo: "HG",
  Jalisco: "JA",
  "Mexico State": "MX",
  Michoacán: "MI",
  Morelos: "MO",
  Nayarit: "NA",
  "Nuevo León": "NL",
  Oaxaca: "OA",
  Puebla: "PU",
  Querétaro: "QE",
  "Quintana Roo": "QR",
  "San Luis Potosí": "SL",
  Sinaloa: "SI",
  Sonora: "SO",
  Tabasco: "TB",
  Tamaulipas: "TM",
  Tlaxcala: "TL",
  Veracruz: "VE",
  Yucatán: "YU",
  Zacatecas: "ZA",
};

function getAbbreviation(country, state) {
  if (country === "United States") return usStates[state];
  if (country === "Canada") return caProvinces[state];
  if (country === "Mexico") return mxStates[state];
  return undefined;
}

function extractDistribution(csvPath) {
  let csvContent = fs.readFileSync(csvPath, "utf8");

  // Skip any non-CSV title lines (e.g., "Distribution Data")
  const lines = csvContent.split(/\r?\n/);
  let headerIdx = lines.findIndex(
    (line) => line.includes("Country") && line.includes("State"),
  );
  if (headerIdx > 0) {
    csvContent = lines.slice(headerIdx).join("\n");
  }

  const records = parse(csvContent, { columns: true, skip_empty_lines: true });

  const distribution = {};

  records.forEach((row) => {
    const country = row.Country;
    const state = row.State;
    const countryCode = countryAbbr[country];
    if (!countryCode) return;
    const stateCode = getAbbreviation(country, state);
    if (stateCode && !distribution[countryCode]?.includes(stateCode)) {
      (distribution[countryCode] ??= []).push(stateCode);
    }
  });

  // Sort states/provinces for consistency
  Object.keys(distribution).forEach((key) => distribution[key].sort());

  return yaml.dump({ distribution });
}

// CLI entry point for ESM
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , inputPath] = process.argv;

  if (!inputPath) {
    console.error(
      "Usage: node OpenWilds/scripts/extractStatesFromUSDADistributionData.mjs <path/to/DistributionData.csv>",
    );
    process.exit(1);
  }

  try {
    const yamlString = extractDistribution(
      path.resolve(process.cwd(), inputPath),
    );
    clipboardy.writeSync(yamlString);
    console.log("YAML output has been copied to your clipboard!");
    console.log("\n--- YAML Preview ---\n");
    console.log(yamlString);
  } catch (err) {
    console.error("Error processing file:", err.message);
    process.exit(1);
  }
}
