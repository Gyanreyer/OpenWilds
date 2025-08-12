import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";

import { html } from "./_lib/html.js";

import Base from "./_layouts/base.layout.js";

/**
 * @import { PlantData } from "./types/plantData.js"
 */

const baseDataFileDirectoryPath = import.meta
  .resolve("../data/")
  .slice("file://".length);
const dataEntryPaths = await glob("plantae/**/data.yml", {
  cwd: baseDataFileDirectoryPath,
  onlyFiles: true,
  absolute: true,
});

export const config = {
  pagination: {
    data: "dataEntries",
    size: 1,
    alias: "dataEntry",
  },
  permalink: (data) => data.dataEntry.permalink,
  dataEntries: await Promise.all(
    dataEntryPaths.map(async (path) => {
      const fileContents = await readFile(path, "utf8");
      return {
        permalink: path.slice(
          baseDataFileDirectoryPath.length,
          -"data.yml".length
        ),
        ...parseYaml(fileContents),
      };
    })
  ),
};

const lightRequirementNames = {
  1: "Full Shade",
  2: "Dappled Shade",
  3: "Partial Shade",
  4: "Partial Sun",
  5: "Full Sun",
}

/**
 * @param {Object} props
 * @param {PlantData} props.dataEntry
 */
export default function Plant({ dataEntry }) {
  const lightRequirementRange = parseLightRequirementRange(dataEntry.light);

  return html`<${Base}>
    <header>
      <h1>${dataEntry.common_names[0]}</h1>
      <p aria-description="Scientific name">${dataEntry.scientific_name}</p>
    </header>
    ${dataEntry.common_names.length > 1 ? html`<section>
      <h2>Other common names</h2>
      <ul>
        ${dataEntry.common_names.slice(1).map((name) => html`<li>${name}</li>`)}
      </ul>
    </section>` : null}
    ${lightRequirementRange ? html`<section>
      <h2 id="light-header">Light requirements</h2>
      <${LightRequirementMeter} range=${lightRequirementRange} />
      <p id="light-desc">
        ${lightRequirementNames[lightRequirementRange[0]]}${lightRequirementRange[0] !== lightRequirementRange[1] ?
        ` to ${lightRequirementNames[lightRequirementRange[1]]}`
        : ""
      }
      </p>
    </section>` : null}
  <//>`;
}

/**
 * @param {PlantData["light"]} rawLightRequirementValue 
 * @returns { [low: number, high: number] | null }
 */
const parseLightRequirementRange = (rawLightRequirementValue) => {
  if (typeof rawLightRequirementValue === "number") {
    const v = rawLightRequirementValue;
    if (v < 1 || v > 5) {
      return null;
    }
    return [v, v];
  }

  const [lowStr, highStr] = rawLightRequirementValue.split("-").map((s) => s.trim());
  if (!highStr) {
    const v = parseInt(lowStr, 10);
    if (Number.isNaN(v) || v < 1 || v > 5) {
      return null;
    }
    return [v, v];
  }

  const low = parseInt(lowStr, 10);
  const high = parseInt(highStr, 10);
  if (Number.isNaN(low) || Number.isNaN(high) || low < 1 || high > 5 || low > high) {
    return null;
  }
  return [low, high];
};

/**
 * @param {Object} props
 * @param {[low: number, high: number]} props.range 
 */
function LightRequirementMeter({
  range: [low, high],
}) {
  return html`
    <div
      id="light-meter"
      aria-labelledby="light-header"
      aria-describedby="light-desc"
      style="--low: ${low}; --high: ${high}"
    >
      <div class="meter-fill"></div>
    </div>
    <style data-bundle="plant">
      #light-meter {
        position: relative;
        width: 100%;
        height: 1rem;
        --grad: linear-gradient(
          to right,
          #004400,
          #228800,
          #88cc00,
          #ffff00,
          #ff8800,
          #ff4400
        );
        border: 1px solid black;
        --border-radius: 0.5rem;
        border-radius: var(--border-radius);
        position: relative;

        .meter-fill {
          position: absolute;
          inset: 0;
          clip-path: inset(0 calc(100% - (100% * var(--high) / 5)) 0 calc(100% * (var(--low) - 1) / 5) round var(--border-radius));
          background-image: var(--grad);
          border-radius: var(--border-radius);
        }

        &::before {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: var(--grad);
          filter: saturate(0.25) brightness(0.75);
        }
      }
    </style>`;
}