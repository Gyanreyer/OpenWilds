import { css } from "#site-lib/css.js";
import { html } from "#site-lib/html.js";
import { parseDataRange } from "#site-utils/parseDataRange.js";
import { PlantDataRangeMeter } from "./PlantDataRangeMeter.component.js";

/**
 * @import { PlantData } from "../../types/plantData"
 */

const lightLevelNames = {
  1: "Full Shade",
  2: "Dappled Shade",
  3: "Partial Shade",
  4: "Partial Sun",
  5: "Full Sun",
}

/**
 * @param {Object} props
 * @param {PlantData["light"]} props.lightRequirement
 */
export function LightRequirementSection({
  lightRequirement
}) {
  const [low, high] = parseDataRange(lightRequirement) || [];

  if (!low || !high) {
    return null;
  }

  return html`
    <section>
      <h2 id="light-header">Sun Exposure</h2>
      <${PlantDataRangeMeter} low=${low} high=${high} id="light-meter" aria-labelledby="light-header" aria-describedby="light-desc"  />
      <p id="light-desc">
        ${lightLevelNames[low]}${low !== high ?
      ` to ${lightLevelNames[high]}`
      : ""
    }
      </p>
    </section>`;
}

LightRequirementSection.css = css`
  ${css.bundles.plant}
  #light-meter {
    --grad: linear-gradient(
      to right,
      #440,
      #ff0,
      #fff
    );
    max-width: 400px;
  }
`;

