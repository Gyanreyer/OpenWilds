window.customElements.define("range-selector", class RangeSelectorElement extends HTMLElement {
  static styles = /*css*/`
    range-selector {
      display: block;
      position: relative;
      --range: calc(var(--max) - var(--min));
      --middle-pt: calc(var(--lower-value) + (var(--upper-value) - var(--lower-value)) / 2);
    }

    range-selector:defined {
      container-type: inline-size;

      .lower-wrapper {
        position: absolute;
        top: 0;
        left: 0;
        height: 32px;
        overflow-x: clip;
        width: calc(100% * (var(--middle-pt) - var(--min)) / var(--range));
      }

      .upper-wrapper {
        position: absolute;
        top: 0;
        right: 0;
        height: 32px;
        overflow-x: clip;
        width: calc(100% * (var(--max) - var(--middle-pt)) / var(--range));
      }

      input[type="range"] {
        width: 100cqw;
        margin: 0;
        position: absolute;
        top: 0;
        opacity: 0;

        &.lower {
          left: 0;
          /* scale: calc((var(--middle-pt) - var(--min)) / var(--range)) 1; */
          transform-origin: left
        }
        &.upper {
          right: 0;
          /* width: calc(100% * (var(--max) - var(--lower-value)) / var(--range)); */
          /* scale: calc((var(--max) - var(--middle-pt)) / var(--range)) 1; */
          transform-origin: right;
        }
      }

      .track {
        position: absolute;
        left: calc(100% * (var(--lower-value) - var(--min)) / var(--range));
        right: calc(100% * (var(--max) - var(--upper-value)) / var(--range));
        height: 8px;
        background: blue;
        pointer-events: none;

        &::before {
          /** Lower range thumb */
          content: "";
          position: absolute;
          width: 16px;
          height: 16px;
          top: 50%;
          border-radius: 50%;
          background: var(--brand-primary);
          left: 0;
          translate: -50% -50%;
        }

        &::after {
          /** Upper range thumb */
          content: "";
          position: absolute;
          width: 16px;
          height: 16px;
          top: 50%;
          border-radius: 50%;
          background: var(--brand-primary);
          right: 0;
          translate: 50% -50%;
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

  connectedCallback() {
    this.style.setProperty('--min', this.lowerRangeInput.min);
    this.style.setProperty('--max', this.upperRangeInput.max);
    this.style.setProperty('--lower-value', this.lowerRangeInput.value);
    this.style.setProperty('--upper-value', this.upperRangeInput.value);

    this.lowerRangeInput.addEventListener('input', () => {
      let lowerValue = this.lowerRangeInput.value;
      const upperValue = this.upperRangeInput.value;
      if (parseFloat(lowerValue) >= parseFloat(upperValue)) {
        lowerValue = upperValue;
        this.lowerRangeInput.value = lowerValue;
      }
      this.upperRangeInput.ariaValueMin = lowerValue;
      this.lowerRangeInput.ariaValueMax = upperValue;

      this.style.setProperty('--lower-value', lowerValue);
      this.style.setProperty('--upper-value', upperValue);
    });

    this.upperRangeInput.addEventListener('input', () => {
      let upperValue = this.upperRangeInput.value;
      const lowerValue = this.lowerRangeInput.value;
      if (parseFloat(upperValue) <= parseFloat(lowerValue)) {
        upperValue = lowerValue;
        this.upperRangeInput.value = upperValue;
      }
      this.upperRangeInput.ariaValueMin = lowerValue;
      this.lowerRangeInput.ariaValueMax = upperValue;
      this.style.setProperty('--lower-value', lowerValue);
      this.style.setProperty('--upper-value', upperValue);
    });
  }
});