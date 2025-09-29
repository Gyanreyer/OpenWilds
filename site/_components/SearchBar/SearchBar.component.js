import { html } from "#site-lib/html.js";
import { js } from "#site-lib/js.js";
import { bundle } from "#site-lib/bundle.js";

export function SearchBar() {
  return html`
    <search-bar>
      <form role="search">
        <input type="text" name="query" placeholder="Search..." autocomplete="off"
          role="combobox"
          aria-activedescendant=""
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="search-results"
          aria-label="Search"
          id="search-input"
        />
      </form>
      <div id="search-results-container">
        <ul id="search-results"
          role="listbox"
          aria-label="Search results"
          aria-labelledby="search-input"
        ></ul>
      </div>
    </search-bar>
  `;
}

SearchBar.js = js`
  ${bundle.import("./search-bar.js")}
`;