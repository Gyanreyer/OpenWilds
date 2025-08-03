import { html } from "./_lib/html.js";

import Base from "./_layouts/base.js";

export default function ({ ...data }) {
  return html`<${Base}>
    <h1>OpenWilds</h1>
  <//>`;
}
