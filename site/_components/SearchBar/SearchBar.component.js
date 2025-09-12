import { html } from "#site-lib/html.js";
import { js } from "#site-lib/js.js";
import { bundle } from "#site-lib/bundle.js";

export function SearchBar() {
  return html`
    <search-bar>
      <form>
        <input type="text" name="query" placeholder="Search..." />
      </form>
    </search-bar>
  `;
}

SearchBar.js = js`
  ${bundle.import("./search-bar.js")}
`;