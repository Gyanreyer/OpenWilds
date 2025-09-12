import { html } from "./_lib/html.js";
import { getScopedComponentID } from "./_lib/scid.js";

import Base from "./_layouts/base.layout.js";
import { SearchBar } from "#site-components/SearchBar/SearchBar.component.js";

const scid = getScopedComponentID();

export default function IndexPage({ ...data }) {
  return html`<${Base}>
    <main data-scid=${scid}>
      <h1>OpenWilds</h1>
      <${SearchBar} />
    </main>
  <//>`;
}
