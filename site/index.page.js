import { html, css } from "yeti-js";

import { BaseLayout } from "./_layouts/base.layout.js";
import { SearchBar } from "#site-components/SearchBar/SearchBar.component.js";

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