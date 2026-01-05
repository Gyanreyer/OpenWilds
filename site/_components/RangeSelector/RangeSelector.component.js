import { randomUUID } from 'node:crypto';
import { html, js } from 'yeti-js';

/**
 * @import { YetiComponent } from 'yeti-js';
 * @type {YetiComponent<{
 *  min: number;
 *  max: number;
 *  minLabel: string;
 *  maxLabel: string;
 *  step?: number;
 *  defaultLowerValue?: number;
 *  defaultUpperValue?: number;
 *  name?: string;
  * minName?: string;
  * maxName?: string;
  * dataList?: {
  *   value: number;
  *   label?: string;
  * }[];
 * }>}
 */
export const RangeSelector = ({
  min,
  max,
  minLabel,
  maxLabel,
  step = 1,
  defaultLowerValue = min,
  defaultUpperValue = max,
  name,
  minName = name ? `${name}-min` : undefined,
  maxName = name ? `${name}-max` : undefined,
  dataList,
}) => {
  if (min > max) {
    throw new Error('min must be less than max');
  }
  if (defaultLowerValue < min || defaultLowerValue > max) {
    throw new Error('defaultLowerValue must be between min and max');
  }
  if (defaultUpperValue < min || defaultUpperValue > max) {
    throw new Error('defaultUpperValue must be between min and max');
  }

  const datalistID = dataList ? `${name || randomUUID()}-ticks` : null;

  return html`
    <range-selector>
      <div class="track">
        <div class="lower-wrapper">
          <input type="range" aria-label=${minLabel} class="lower" name=${minName} min="${min}" max="${max}" step="${step}" value="${defaultLowerValue}" list=${datalistID} />
        </div>
        <div class="upper-wrapper">
          <input type="range" aria-label=${maxLabel} class="upper" name=${maxName} min="${min}" max="${max}" step="${step}" value="${defaultUpperValue}" list=${datalistID} />
        </div>
        <div class="track-selected"></div>
      </div>
      <span class="value-label lower" aria-hidden></span>
      <span class="value-label upper" aria-hidden></span>
      ${dataList ? html`<datalist id=${datalistID}>
        ${dataList.map(({ value, label }) => html`<option value=${value} label=${label}></option>`)}
      </datalist>` : ''}
    </range-selector>
  `;
}

RangeSelector.js = js`
  ${js.import("./range-selector.js")}
`;