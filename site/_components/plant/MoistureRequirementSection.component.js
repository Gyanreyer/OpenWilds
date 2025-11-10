import { html, css } from 'yeti-js';
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
  moistureRequirement: { min, max }
}) {
  return html`
    <section>
      <h2 id="moist-header">Soil Moisture</h2>
      <${PlantDataRangeMeter} low=${min} high=${max} id="moist-meter" aria-labelledby="moist-header" aria-describedby="moist-desc"  />
      <p id="moist-desc">
        ${moistureLevelNames[min]}${min !== max ?
      ` to ${moistureLevelNames[max]}`
      : ""
    }
      </p>
    </section>
  `;
}

MoistureRequirementSection.css = css`
  ${css.bundle("plant")}
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