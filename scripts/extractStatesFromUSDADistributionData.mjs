import { parse as parseCSV } from "csv-parse/sync";
import { stringify as stringifyYaml } from "yaml";

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

function extractDistribution(csvContent) {
  // Skip any non-CSV title lines (e.g., "Distribution Data")
  const lines = csvContent.split(/\r?\n/);
  let headerIdx = lines.findIndex(
    (line) => line.includes("Country") && line.includes("State")
  );
  if (headerIdx > 0) {
    csvContent = lines.slice(headerIdx).join("\n");
  }

  const records = parseCSV(csvContent, { columns: true, skip_empty_lines: true });

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

  return stringifyYaml({ distribution });
}

/**
 * @param {string} scientificName
 */
export async function getDistributionYamlForScientificName(scientificName) {
  try {
    const plantSearchResponse = await fetch(
      "https://plantsservices.sc.egov.usda.gov/api/plants-search-results",
      {
        method: "POST",
        body: JSON.stringify({
          Field: "Scientific Name",
          Text: scientificName.trim(),
          SortBy: "sortSciName",
          Type: "Basic",
          allData: 0,
          pageNumber: 1,
        }),
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }
    ).then((r) => r.json());

    if (plantSearchResponse.PlantResults.length > 1) {
      console.warn(
        `Found more than one plant matching ${scientificName}. Results may be incorrect.`
      );
    }

    const plantResult = plantSearchResponse.PlantResults.find((result) => {
      const scientificNames = [
        result.ScientificNameWithoutAuthor.toLowerCase().trim(),
        ...(result.Synonyms?.map(({ ScientificNameWithoutAuthor }) =>
          ScientificNameWithoutAuthor.toLowerCase().trim()
        ) ?? []),
      ];

      return scientificNames.includes(scientificName.toLowerCase().trim());
    });

    // const plantResult = plantSearchResponse.PlantResults[0];
    if (!plantResult) {
      console.error(`No plant found with scientific name "${scientificName}".`);
      process.exit(1);
    }

    const plantID = plantResult.Id;

    if (!plantID) {
      console.error(`No plant ID found for "${scientificName}".`);
      console.log("Dumping search response...");
      console.dir(plantSearchResponse);
      process.exit(1);
    }

    const response = await fetch(
      "https://plantsservices.sc.egov.usda.gov/api/PlantProfile/getDownloadDistributionDocumentation",
      {
        method: "POST",
        body: JSON.stringify({
          MasterId: plantID,
        }),
        headers: {
          Accept: "text/csv",
          "Content-Type": "application/json",
        },
      }
    ).then((r) => r.text());

    const yamlString = extractDistribution(response);
    return yamlString;
  } catch (err) {
    console.error(
      `Error getting distribution data for ${scientificName}:`,
      err.message
    );
  }
}
