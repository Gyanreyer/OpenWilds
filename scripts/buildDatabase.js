import Database from 'better-sqlite3';
import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import { readFile, access, mkdir, writeFile } from "node:fs/promises";
import {
  join,
} from 'node:path';
import { gzipSync } from 'node:zlib';
import { heightStringToInches } from '../utils/heightStringToInches.js';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(import.meta.resolve("../dist/"));

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

db.exec(/*sql*/`
  --- Drop existing tables if they exist to start from a clean slate
  DROP TABLE IF EXISTS plant_name_fts;
  DROP TABLE IF EXISTS plant_distribution_regions;
  DROP TABLE IF EXISTS distribution_regions;
  DROP TABLE IF EXISTS plant_bloom_colors;
  DROP TABLE IF EXISTS plant_common_names;
  DROP TABLE IF EXISTS plants;

  --- Main plants table
  CREATE TABLE IF NOT EXISTS plants (
    id                INTEGER   PRIMARY KEY AUTOINCREMENT,
    path              TEXT      UNIQUE NOT NULL,
    scientific_name   TEXT      UNIQUE NOT NULL,
    life_cycle        TEXT      CHECK(life_cycle IN ('annual', 'biennial', 'perennial')) NOT NULL,
    bloom_time_start  INTEGER   CHECK(bloom_time_start >= 1 AND bloom_time_start <= 12),
    bloom_time_end    INTEGER   CHECK(bloom_time_end >= 1 AND bloom_time_end <= 12),
    height_low        INTEGER   NOT NULL,
    height_high       INTEGER   NOT NULL,
    light_low         INTEGER   CHECK(light_low >= 1 AND light_low <= 5) NOT NULL,
    light_high        INTEGER   CHECK(light_high >= 1 AND light_high <= 5) NOT NULL,
    moisture_low      INTEGER   CHECK(moisture_low >= 1 AND moisture_low <= 5) NOT NULL,
    moisture_high     INTEGER   CHECK(moisture_high >= 1 AND moisture_high <= 5) NOT NULL
  );

  --- Table to store common names separately for better querying for searches
  CREATE TABLE IF NOT EXISTS plant_common_names (
    plant_id        INTEGER   NOT NULL,
    common_name     TEXT      NOT NULL,
    is_primary_name BOOLEAN   NOT NULL DEFAULT FALSE,

    PRIMARY KEY (plant_id, common_name),
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_common_name ON plant_common_names(common_name);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_primary_name ON plant_common_names(plant_id) WHERE is_primary_name = TRUE;

  --- Table to store bloom colors for each plant
  CREATE TABLE IF NOT EXISTS plant_bloom_colors (
    plant_id  INTEGER   NOT NULL,
    name      TEXT      NOT NULL,
    hex       TEXT      NOT NULL,

    PRIMARY KEY (plant_id, hex),
    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE
  );

  --- Enumerates regions (country + state/province) where plants are found
  CREATE TABLE IF NOT EXISTS distribution_regions (
    id            INTEGER   PRIMARY KEY AUTOINCREMENT,
    country_code  TEXT      NOT NULL CHECK(LENGTH(country_code) = 2 AND country_code = UPPER(country_code)),
    state_code    TEXT      NOT NULL CHECK(LENGTH(state_code) = 2 AND state_code = UPPER(state_code)),
    UNIQUE(country_code, state_code)
  );

  --- Join table linking plants to their distribution regions
  CREATE TABLE IF NOT EXISTS plant_distribution_regions (
    plant_id       INTEGER   NOT NULL,
    region_id      INTEGER   NOT NULL,
    PRIMARY KEY (plant_id, region_id),

    FOREIGN KEY (plant_id) REFERENCES plants(id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES distribution_regions(id) ON DELETE CASCADE
  );

  -- FTS5 virtual table for searching scientific and common names
  CREATE VIRTUAL TABLE IF NOT EXISTS plant_name_fts USING fts5(
    plant_id UNINDEXED,
    common_name,
    scientific_name,
    tokenize='trigram'
  );

  CREATE INDEX IF NOT EXISTS idx_plants_path ON plants(path);
  CREATE INDEX IF NOT EXISTS idx_plants_scientific_name ON plants(scientific_name);
`);

const insertPlantEntry = db.prepare(/*sql*/`
  INSERT INTO plants (
    path,
    scientific_name,
    life_cycle,
    bloom_time_start,
    bloom_time_end,
    height_low,
    height_high,
    light_low,
    light_high,
    moisture_low,
    moisture_high
  ) VALUES (
    @path,
    @scientific_name,
    @life_cycle,
    @bloom_time_start,
    @bloom_time_end,
    @height_low,
    @height_high,
    @light_low,
    @light_high,
    @moisture_low,
    @moisture_high
  ) RETURNING id;
`);

const insertCommonName = db.prepare(/*sql*/`
  INSERT INTO plant_common_names (
    plant_id,
    common_name,
    is_primary_name
  ) VALUES (
    @plant_id,
    @common_name,
    @is_primary_name
  );
`);

const insertCommonNames = db.transaction(
  /**
   * @param {Object} params
   * @param {number} params.plant_id
   * @param {string[]} params.common_names
   */
  ({
    plant_id,
    common_names
  }) => {
    for (let i = 0; i < common_names.length; i++) {
      const name = common_names[i];
      insertCommonName.run({
        plant_id,
        common_name: name.trim(),
        // First name is primary. We can't bind boolean directly for some reason so use 1/0
        is_primary_name: i === 0 ? 1 : 0,
      });
    }
  });

const insertBloomColor = db.prepare(/*sql*/`
  INSERT INTO plant_bloom_colors (
    plant_id,
    name,
    hex
  ) VALUES (
    @plant_id,
    @name,
    @hex
  );
`);

const insertBloomColorsForPlant = db.transaction(
  /**
   * @param {{
   *  plant_id: number;
   *  bloom_color: PlantData["bloom_color"]
   * }} params
   */
  ({
    plant_id,
    bloom_color
  }) => {
    /**
     * @type {BloomColor[]}
     */
    let normalizedBloomColorArray;
    if (Array.isArray(bloom_color)) {
      normalizedBloomColorArray = bloom_color;
    } else if (bloom_color) {
      normalizedBloomColorArray = [bloom_color];
    } else {
      normalizedBloomColorArray = [];
    }

    for (const color of normalizedBloomColorArray) {
      insertBloomColor.run({
        plant_id,
        name: color.name.trim(),
        hex: color.hex.trim(),
      });
    }
  });

const insertDistributionRegion = db.prepare(/*sql*/`
    INSERT INTO distribution_regions (
      country_code, state_code
    ) VALUES (
      ?, ?
    ) RETURNING id;
`);

const getDistributionRegionID = db.prepare(/*sql*/`SELECT id FROM distribution_regions WHERE country_code = ? AND state_code = ?`);

const upsertDistributionRegion = db.transaction(
  /**
   * @param {Object} params
   * @param {string} params.country_code
   * @param {string} params.state_code
   * 
   * @returns {{id: number}}
   */
  ({
    country_code,
    state_code
  }) => {
    const region = getDistributionRegionID.get(country_code, state_code);
    if (region) {
      return region;
    }

    return insertDistributionRegion.get(country_code, state_code);
  });

const insertPlantDistributionRegion = db.prepare(/*sql*/`
  INSERT INTO plant_distribution_regions (
    plant_id,
    region_id
  ) VALUES (
    @plant_id,
    @region_id
  );
`);

const insertIntoFTS = db.prepare(/*sql*/`
  INSERT INTO plant_name_fts (plant_id, common_name, scientific_name)
  VALUES (@plant_id, @common_name, @scientific_name)
`);

/**
 * @import { BloomColor, PlantData } from "../site/types/plantData.js"
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

      let bloomTimeStart = null;
      let bloomTimeEnd = null;
      if (entry.bloom_time) {
        bloomTimeStart = new Date(`${entry.bloom_time.start}-1-01`).getMonth() + 1;
        bloomTimeEnd = new Date(`${entry.bloom_time.end}-1-01`).getMonth() + 1;
      }

      const { id: plantID } = insertPlantEntry.get({
        path: entry.path,
        scientific_name: entry.scientific_name,
        life_cycle: entry.life_cycle.toLowerCase(),
        bloom_time_start: bloomTimeStart,
        bloom_time_end: bloomTimeEnd,
        height_low: lowHeight,
        height_high: highHeight,
        light_low: lowLight,
        light_high: highLight,
        moisture_low: lowMoisture,
        moisture_high: highMoisture,
      });

      // Insert scientific name into FTS (with empty common_name)
      insertIntoFTS.run({
        plant_id: plantID,
        common_name: '',
        scientific_name: entry.scientific_name,
      });

      insertCommonNames({ plant_id: plantID, common_names: entry.common_names });

      // Insert each common name into FTS (with empty scientific_name)
      for (const name of entry.common_names) {
        insertIntoFTS.run({
          plant_id: plantID,
          common_name: name.trim(),
          scientific_name: '',
        });
      }

      insertBloomColorsForPlant({ plant_id: plantID, bloom_color: entry.bloom_color });

      if (!entry.distribution) {
        continue;
      }

      for (const countryCode in entry.distribution) {
        const states = entry.distribution[/** @type {keyof PlantData["distribution"]} */(countryCode)];
        if (!Array.isArray(states) || states.length === 0) {
          // No states/provinces listed; skip
          continue;
        }
        for (const stateCode of states) {
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


const baseDataFileDirectoryPath = fileURLToPath(import.meta
  .resolve("../data/"));
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

// Optimize the FTS index
db.exec("INSERT INTO plant_name_fts(plant_name_fts) VALUES('optimize');");

db.exec("ANALYZE;");
// Set journal mode back to DELETE so it can be loaded in the browser
db.pragma("journal_mode = DELETE");
db.exec("VACUUM;");
// Enforce read-only mode
db.pragma("query_only = ON");

db.close();

const sitePublicDir = fileURLToPath(import.meta.resolve("../site/public"));
const dbFile = await readFile(dbPath);
await writeFile(join(sitePublicDir, `OpenWilds.db.gz`), gzipSync(dbFile));