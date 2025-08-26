import Database from 'better-sqlite3';
import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import { readFile, access, mkdir } from "node:fs/promises";
import {
  join,
} from 'node:path';
import { heightStringToInches } from '../utils/heightStringToInches.js';

const distDir = import.meta.resolve("../dist/").slice("file://".length);

try {
  await access(distDir);
} catch (err) {
  await mkdir(distDir, { recursive: true });
}

const dbPath = join(distDir, "OpenWilds.db");

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("temp_store = MEMORY");
db.pragma("cache_size = -20000");

db.exec(`
  DROP TABLE IF EXISTS plant_distribution_regions;
  DROP TABLE IF EXISTS distribution_regions;
  DROP TABLE IF EXISTS plants;

  CREATE TABLE IF NOT EXISTS plants (
    id                INTEGER   PRIMARY KEY AUTOINCREMENT,
    path              TEXT      UNIQUE NOT NULL,
    scientific_name   TEXT      UNIQUE NOT NULL,
    common_names      JSON      DEFAULT('[]') NOT NULL,
    life_cycle        TEXT      CHECK(life_cycle IN ('annual', 'biennial', 'perennial')) NOT NULL,
    bloom_time_start  TEXT,
    bloom_time_end    TEXT,
    bloom_colors      JSON      DEFAULT('[]'),
    height_low        INTEGER   NOT NULL,
    height_high       INTEGER   NOT NULL,
    light_low         INTEGER   CHECK(light_low >= 1 AND light_low <= 5) NOT NULL,
    light_high        INTEGER   CHECK(light_high >= 1 AND light_high <= 5) NOT NULL,
    moisture_low      INTEGER   CHECK(moisture_low >= 1 AND moisture_low <= 5) NOT NULL,
    moisture_high     INTEGER   CHECK(moisture_high >= 1 AND moisture_high <= 5) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS distribution_regions (
    id            INTEGER   PRIMARY KEY AUTOINCREMENT,
    country_code  TEXT      NOT NULL CHECK(LENGTH(country_code) = 2 AND country_code = UPPER(country_code)),
    state_code    TEXT      NOT NULL CHECK(LENGTH(state_code) = 2 AND state_code = UPPER(state_code)),
    UNIQUE(country_code, state_code)
  );

  CREATE TABLE IF NOT EXISTS plant_distribution_regions (
    plant_id       INTEGER   NOT NULL,
    region_id      INTEGER   NOT NULL,
    PRIMARY KEY (plant_id, region_id),

    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES distribution_regions(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_plants_path ON plants(path);
  CREATE INDEX IF NOT EXISTS idx_plants_scientific_name ON plants(scientific_name);
`);

const insertPlantEntry = db.prepare(`
  INSERT INTO plants (
    path,
    scientific_name,
    common_names,
    life_cycle,
    bloom_time_start,
    bloom_time_end,
    bloom_colors,
    height_low,
    height_high,
    light_low,
    light_high,
    moisture_low,
    moisture_high
  ) VALUES (
    @path,
    @scientific_name,
    json(@common_names),
    @life_cycle,
    @bloom_time_start,
    @bloom_time_end,
    json(@bloom_colors),
    @height_low,
    @height_high,
    @light_low,
    @light_high,
    @moisture_low,
    @moisture_high
  ) RETURNING id;
`);

const insertDistributionRegion = db.prepare(`
    INSERT INTO distribution_regions (
      country_code, state_code
    ) VALUES (
      ?, ?
    ) RETURNING id;
`);

const getDistributionRegionID = db.prepare(`SELECT id FROM distribution_regions WHERE country_code = ? AND state_code = ?`);

const upsertDistributionRegion = db.transaction(({
  country_code,
  state_code
}) => {
  const region = getDistributionRegionID.get(country_code, state_code);
  if (region) {
    return region;
  }

  return insertDistributionRegion.get(country_code, state_code);
});

const insertPlantDistributionRegion = db.prepare(`
  INSERT INTO plant_distribution_regions (
    plant_id,
    region_id
  ) VALUES (
    @plant_id,
    @region_id
  );
`);

/**
 * @import { PlantData } from "../site/types/plantData.js"
 */

const insertPlantEntries = db.transaction(
  /**
   * @param {(PlantData & { path: string; })[]} plantEntries 
   */
  (plantEntries) => {
    for (const entry of plantEntries) {
      const [lowHeight, highHeight] = heightStringToInches(entry.height) ?? [null, null];

      const [lowLight, highLight = lowLight] = /** @type {string} */(entry.light).split("-").map((v) => parseInt(v, 10));

      const [lowMoisture, highMoisture = lowMoisture] = /** @type {string} */(entry.moisture).split("-").map((v) => parseInt(v, 10)) || [];

      const { id: plantID } = insertPlantEntry.get({
        path: entry.path,
        scientific_name: entry.scientific_name,
        common_names: JSON.stringify(entry.common_names),
        life_cycle: entry.life_cycle.toLowerCase(),
        bloom_time_start: entry.bloom_time?.start || null,
        bloom_time_end: entry.bloom_time?.end || null,
        bloom_colors: JSON.stringify(Array.isArray(entry.bloom_color) ? entry.bloom_color : entry.bloom_color ? [entry.bloom_color] : []),
        height_low: lowHeight,
        height_high: highHeight,
        light_low: lowLight,
        light_high: highLight,
        moisture_low: lowMoisture,
        moisture_high: highMoisture,
      });

      if (!entry.distribution) {
        continue;
      }

      for (const countryCode in entry.distribution) {
        for (const stateCode of entry.distribution[countryCode]) {
          const normalizedCountryCode = countryCode.trim().toUpperCase();
          const normalizedStateCode = stateCode.trim().toUpperCase();

          const { id: regionID } = upsertDistributionRegion({
            country_code: normalizedCountryCode,
            state_code: normalizedStateCode,
          });

          insertPlantDistributionRegion.run({
            plant_id: plantID,
            region_id: regionID,
          });
        }
      }
    }
  });


const baseDataFileDirectoryPath = import.meta
  .resolve("../data/")
  .slice("file://".length);
const dataEntryPaths = await glob("plantae/**/data.yml", {
  cwd: baseDataFileDirectoryPath,
  onlyFiles: true,
  absolute: true,
});

const plantDataEntries = await Promise.all(
  dataEntryPaths.map(async (path) => {
    const fileContents = await readFile(path, "utf8");
    return {
      path: path.slice(baseDataFileDirectoryPath.length, -"/data.yml".length),
      ...parseYaml(fileContents),
    };
  })
);

insertPlantEntries(plantDataEntries);

db.exec("ANALYZE;");
db.exec("VACUUM;");

db.close();