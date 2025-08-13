import { css } from "#site-lib/css.js";
import { html } from "#site-lib/html.js";
import { parseDataRange } from "#site-utils/parseDataRange.js";
import { PlantDataRangeMeter } from "./PlantDataRangeMeter.component.js";

/**
 * @import { PlantData } from "../../types/plantData"
 */

const moistureLevelNames = {
  1: "Dry",
  2: "Medium-Dry",
  3: "Medium",
  4: "Medium-Wet",
  5: "Wet",
}

/**
 * @param {Object} props
 * @param {PlantData["moisture"]} props.moistureRequirement
 */
export function MoistureRequirementSection({
  moistureRequirement
}) {
  const [low, high] = parseDataRange(moistureRequirement) || [];

  if (!low || !high) {
    return null;
  }

  return html`
    <section>
      <h2 id="moist-header">Soil Moisture</h2>
      <${PlantDataRangeMeter} low=${low} high=${high} id="moist-meter" aria-labelledby="moist-header" aria-describedby="moist-desc"  />
      <p id="moist-desc">
        ${moistureLevelNames[low]}${low !== high ?
      ` to ${moistureLevelNames[high]}`
      : ""
    }
      </p>
    </section>
  `;
}

MoistureRequirementSection.css = css`
  ${css.bundles.plant}
  #moist-meter {
    --grad: linear-gradient(
      to right,
      #EDC9AF,
      #93ac86ff,
      #2D68C4
    );
    max-width: 400px;
  }
`;