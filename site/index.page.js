import { html, css } from "yeti-js";

import { BaseLayout } from "./_layouts/base.layout.js";
import { SearchBar } from "#site-components/SearchBar/SearchBar.component.js";
import { RangeSelector } from "#site-components/RangeSelector/RangeSelector.component.js";

/**
 * @import { YetiPageComponent } from 'yeti-js';
 * @type {YetiPageComponent}
 */
const IndexPage = () => {
  return html`<${BaseLayout}>
    <header>
      <div>
        <h1>OpenWilds</h1>
        <p>An open-source database of plants native to North America.</p>
      </div>
    </header>
    <main>
      <${SearchBar} />
      <${RangeSelector} name="bloom-time" min=${1} max=${12} minLabel="Start Month" maxLabel="End Month" dataList=${[
      { value: 1, label: "Jan" },
      { value: 2, label: "Feb" },
      { value: 3, label: "Mar" },
      { value: 4, label: "Apr" },
      { value: 5, label: "May" },
      { value: 6, label: "Jun" },
      { value: 7, label: "Jul" },
      { value: 8, label: "Aug" },
      { value: 9, label: "Sep" },
      { value: 10, label: "Oct" },
      { value: 11, label: "Nov" },
      { value: 12, label: "Dec" },
    ]} />
    </main>
  <//>`;
}

IndexPage.css = css`
  ${css.bundle("index")}
  header div {
    display: flex;
    flex-direction: column;
    row-gap: 0.25lh;
  }

  header,
  main,
  footer {
    padding-inline: 16px;
    padding-block: 32px;
    overflow-x: clip;

    & > * {
      display: block;
      max-width: 800px;
      margin: 0 auto;
      width: 100%;
    }
  }
`;

export default IndexPage;