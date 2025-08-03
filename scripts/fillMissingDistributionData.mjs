import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import { getDistributionYamlForScientificName } from "./extractStatesFromUSDADistributionData.mjs";

// Helper to recursively find all data.yml files in a directory
function findDataYmlFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findDataYmlFiles(fullPath));
    } else if (entry.isFile() && entry.name === "data.yml") {
      results.push(fullPath);
    }
  }
  return results;
}

async function processFiles() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  // Resolve the data directory relative to this script
  const baseDir = path.resolve(scriptDir, "../data/plantae");
  const files = findDataYmlFiles(baseDir);

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const data = yaml.parse(content);

    // If distribution field exists, skip
    if (data.distribution) {
      console.log(`Skipping ${file} (already has distribution)`);
      continue;
    }

    const scientificName = data.scientific_name;
    if (!scientificName) {
      console.warn(`No scientific_name in ${file}, skipping.`);
      continue;
    }

    console.log(`Fetching distribution for ${scientificName} (${file})...`);
    const distributionYaml = await getDistributionYamlForScientificName(
      scientificName
    );

    if (distributionYaml) {
      // Append distribution YAML to the end of the file
      fs.appendFileSync(file, "\n" + distributionYaml);
      console.log(`Appended distribution to ${file}`);
    } else {
      console.warn(`No distribution data found for ${scientificName}`);
    }
  }
}

processFiles();
