const UNINITIALIZED_SYMBOL = Symbol.for("uninitialized");

window.customElements.define("range-selector", class RangeSelectorElement extends HTMLElement {
  static styles = /*css*/`
    range-selector {
      display: block;
      position: relative;
      --range: calc(var(--max) - var(--min));
      --middle-pt: calc(var(--lower-value) + (var(--upper-value) - var(--lower-value)) / 2);
      --track-height: 16px;
    }

    range-selector:defined {
      .track {
        position: relative;
        display: flex;
        height: var(--track-height);
        container-type: inline-size;

        &::after {
          /** Display track */
          content: "";
          pointer-events: none;
          background-color: var(--accent-primary);
          border-radius: 4px;
          height: calc(var(--track-height) / 2);
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          translate: 0 -50%;
        }
      }

      .lower-wrapper, .upper-wrapper {
        position: absolute;
        height: 100%;
        overflow-x: clip;
      }

      .lower-wrapper {
        /** Add padded gap to avoid cutting off left edge of range thumb */
        inset-inline-start: calc(-1 * var(--track-height));
        padding-inline-start: var(--track-height);
        width: calc(100% * (var(--middle-pt) - var(--min)) / var(--range));
      }

      .upper-wrapper {
        /** Add padded gap to avoid cutting off right edge range thumb */
        inset-inline-end: calc(-1 * var(--track-height));
        padding-inline-end: var(--track-height);
        width: calc(100% * (var(--max) - var(--middle-pt)) / var(--range));
      }

      input[type="range"] {
        position: absolute;
        width: 100cqw;
        height: 100%;
        margin: 0;
        opacity: 0;

        &.lower {
          left: 0;
        }
        &.upper {
          right: 0;
        }
      }

      .track-selected {
        position: absolute;
        top: 50%;
        translate: 0 -50%;
        left: calc(100% * (var(--lower-value) - var(--min)) / var(--range));
        right: calc(100% * (var(--max) - var(--upper-value)) / var(--range));
        height: calc(var(--track-height) / 2);
        background-color: var(--brand-primary);
        pointer-events: none;
        z-index: 1;

        &::before, &::after {
          /* Range thumbs */
          content: "";
          position: absolute;
          width: var(--track-height);
          height: var(--track-height);
          top: 50%;
          border-radius: 50%;
          background: var(--brand-primary);
          border: 1px solid var(--brand-secondary);
        }

        &::before {
          /** Lower range thumb */
          left: 0;
          translate: -50% -50%;
        }

        &::after {
          /** Upper range thumb */
          right: 0;
          translate: 50% -50%;
        }
      }

      .lower-wrapper:has(:focus-visible) + .upper-wrapper + .track-selected::before {
        outline: 2px solid var(--positive);
      }
      .upper-wrapper:has(:focus-visible) + .track-selected::after {
        outline: 2px solid var(--positive);
      }

      .value-label {
        position: absolute;
        top: 100%;
        translate: -50% 4px;

        &.lower {
          left: calc(100% * (var(--lower-value) - var(--min)) / var(--range));
        }

        &.upper {
          left: calc(100% * (var(--upper-value) - var(--min)) / var(--range));
        }
      }
    }
  `;

  static {
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(RangeSelectorElement.styles);
    document.adoptedStyleSheets.push(stylesheet);
  }

  /**
   * @type {HTMLInputElement|null}
   */
  #cachedLowerRangeInput = null;
  get lowerRangeInput() {
    const el = this.#cachedLowerRangeInput ??= this.querySelector('input[type="range"].lower');
    if (!el) {
      throw new Error('Lower range input not found');
    }
    return el;
  }

  /**
   * @type {HTMLInputElement|null}
   */
  #cachedUpperRangeInput = null;
  get upperRangeInput() {
    const el = this.#cachedUpperRangeInput ??= this.querySelector('input[type="range"].upper');
    if (!el) {
      throw new Error('Upper range input not found');
    }
    return el;
  }

  /**
   * @type {{[k: string]: string}|typeof UNINITIALIZED_SYMBOL|null}
   */
  #cachedDataListOptions = UNINITIALIZED_SYMBOL;
  get dataListOptions() {
    if (this.#cachedDataListOptions === UNINITIALIZED_SYMBOL) {
      this.#cachedDataListOptions = null;
      const dataListElement = this.querySelector('datalist');
      if (dataListElement) {
        this.#cachedDataListOptions = {};
        for (const optionElement of dataListElement.querySelectorAll('option')) {
          const label = optionElement.label;
          if (label) {
            const value = (optionElement.value);
            this.#cachedDataListOptions[value] = label;
          }
        }
      }
    }

    return this.#cachedDataListOptions;
  }

  /**
   * @type {HTMLSpanElement|null}
   */
  #cachedLowerValueLabelElement = null;
  get lowerValueLabelElement() {
    const el = this.#cachedLowerValueLabelElement ??= this.querySelector('.value-label.lower');
    if (!el) {
      throw new Error('Lower value label element not found');
    }
    return el;
  }
  /**
   * @type {HTMLSpanElement|null}
   */
  #cachedUpperValueLabelElement = null;
  get upperValueLabelElement() {
    const el = this.#cachedUpperValueLabelElement ??= this.querySelector('.value-label.upper');
    if (!el) {
      throw new Error('Upper value label element not found');
    }
    return el;
  }

  connectedCallback() {
    this.style.setProperty('--min', this.lowerRangeInput.min);
    this.style.setProperty('--max', this.upperRangeInput.max);
    this.style.setProperty('--lower-value', this.lowerRangeInput.value);
    this.style.setProperty('--upper-value', this.upperRangeInput.value);


    if (this.dataListOptions) {
      const lowerValue = this.lowerRangeInput.value;
      const upperValue = this.upperRangeInput.value;

      const lowerLabel = this.dataListOptions[lowerValue] ?? lowerValue;
      const upperLabel = this.dataListOptions[upperValue] ?? upperValue;

      this.lowerRangeInput.ariaValueText = lowerLabel;
      this.upperRangeInput.ariaValueText = upperLabel;

      this.lowerValueLabelElement.textContent = lowerLabel;
      this.upperValueLabelElement.textContent = upperLabel;
    }

    const onRangeInputChange = () => {
      let lowerValue = this.lowerRangeInput.value;
      let upperValue = this.upperRangeInput.value;

      const parsedLower = Number(lowerValue);
      const parsedUpper = Number(upperValue);
      if (parsedLower >= parsedUpper) {
        lowerValue = upperValue;
        this.lowerRangeInput.value = lowerValue;
      } else if (parsedUpper <= parsedLower) {
        upperValue = lowerValue;
        this.upperRangeInput.value = upperValue;
      }

      this.upperRangeInput.ariaValueMin = lowerValue;
      this.lowerRangeInput.ariaValueMax = upperValue;

      const lowerLabel = this.dataListOptions?.[lowerValue] ?? lowerValue;
      const upperLabel = this.dataListOptions?.[upperValue] ?? upperValue;

      this.lowerRangeInput.ariaValueText = lowerLabel;
      this.upperRangeInput.ariaValueText = upperLabel;

      this.lowerValueLabelElement.textContent = lowerLabel;
      this.upperValueLabelElement.textContent = upperLabel;

      this.style.setProperty('--lower-value', lowerValue);
      this.style.setProperty('--upper-value', upperValue);
    };

    this.lowerRangeInput.addEventListener('input', onRangeInputChange);
    this.upperRangeInput.addEventListener('input', onRangeInputChange);
  }
});