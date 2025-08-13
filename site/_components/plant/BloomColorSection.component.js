import { css } from "#site-lib/css.js";
import { html } from "../../_lib/html.js";

/**
 * @import { BloomColor } from '../../types/plantData';
 */

/**
 * @param {Object} props
 * @param {BloomColor[]} props.colors
 */
export function BloomColorSection({
  colors,
}) {
  return html`
    <section>
      <h2>Bloom color${colors.length !== 1 ? "s" : ""}</h2>
      <ul id="bloom-color-list">
        ${colors.map((color) => html`<li>${color.name}<div class="color-preview-dot" style="--hex: ${color.hex}"></div></li>`)}
      </ul>
    </section>
  `;
}

BloomColorSection.css = css`
  ${css.bundles.plant}
  #bloom-color-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0;
    list-style: none;

    li {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }

    .color-preview-dot {
      background-color: var(--hex);
      width: 1rem;
      height: 1rem;
      border-radius: 50%;
      flex-shrink: 0;
      outline: 1px solid rgba(0, 0, 0, 0.25);
    }
  }
`;