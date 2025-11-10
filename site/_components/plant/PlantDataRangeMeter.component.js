import { html, css } from 'yeti-js';

/**
 * @param {Object} props
 * @param {number} props.low
 * @param {number} props.high
 * @param {string} [props.className]
 */
export function PlantDataRangeMeter({
  low, high, className = "", ...attrs
}) {
  return html`
    <div
      style="--low: ${low}; --high: ${high}"
      class="${`plant-data-range-meter${className ? ` ${className}` : ""}`}"
      ...${attrs}
    >
      <div class="meter-fill"></div>
    </div>
  `;
}

PlantDataRangeMeter.css = css`
  ${css.bundle("plant")}
  .plant-data-range-meter {
    position: relative;
    width: 100%;
    height: 1rem;
    border: 1px solid black;
    --border-radius: 0.5rem;
    border-radius: var(--border-radius);
    position: relative;

    .meter-fill {
      position: absolute;
      inset: 0;
      --left: calc(100% * (var(--low) - 1) / 5);
      --right: calc(100% - (100% * var(--high) / 5));
      clip-path: inset(0 var(--right) 0 var(--left) round var(--border-radius));
      background-image: var(--grad);
      border-radius: var(--border-radius);
    }

    .meter-fill::after {
      /* ::after to add an outline around the meter fill bar */
      content: "";
      position: absolute;
      inset-block: 0;
      left: var(--left);
      right: var(--right);
      border-radius: inherit;
      outline: 2px solid white;
      outline-offset: -2px;
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
`;