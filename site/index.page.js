import { html } from "./_lib/html.js";

import Base from "./_layouts/base.layout.js";
import { SearchBar } from "#site-components/SearchBar/SearchBar.component.js";
import { css } from "#site-lib/css.js";
import { bundle } from "#site-lib/bundle.js";

export default function IndexPage({ ...data }) {
  return html`<${Base}>
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
  ${bundle("index")}
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
