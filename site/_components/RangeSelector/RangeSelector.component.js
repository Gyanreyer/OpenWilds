import { html, js } from 'yeti-js';

/**
 * @import { YetiComponent } from 'yeti-js';
 * @type {YetiComponent<{
 *  min: number;
 *  max: number;
 *  defaultLowerValue?: number;
 *  defaultUpperValue?: number;
 * }>}
 */
export const RangeSelector = ({
  min,
  max,
  defaultLowerValue = min,
  defaultUpperValue = max,
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

  return html`
    <range-selector>
      <div class="lower-wrapper">
        <input type="range" class="lower" name="range" min="${min}" max="${max}" value="${defaultLowerValue}" />
      </div>
      <div class="upper-wrapper">
        <input type="range" class="upper" name="range" min="${min}" max="${max}" value="${defaultUpperValue}" />
      </div>
      <div class="track"></div>
    </range-selector>
  `;
}
RangeSelector.js = js`
  ${js.import("./range-selector.js")}
`;