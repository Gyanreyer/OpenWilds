import { bundle } from "#site-lib/bundle.js";
import { css } from "#site-lib/css.js";
import { html } from "#site-lib/html.js";
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
  lightRequirement: {
    min,
    max,
  }
}) {
  return html`
    <section>
      <h2 id="light-header">Sun Exposure</h2>
      <${PlantDataRangeMeter} low=${min} high=${max} id="light-meter" aria-labelledby="light-header" aria-describedby="light-desc"  />
      <p id="light-desc">
        ${lightLevelNames[min]}${min !== max ?
      ` to ${lightLevelNames[max]}`
      : ""
    }
      </p>
    </section>`;
}

LightRequirementSection.css = css`
  ${bundle("plant")}
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

