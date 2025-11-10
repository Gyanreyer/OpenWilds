import { html, js } from 'yeti-js';
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function SearchBar() {
  return html`
    <search-bar>
      <form role="search">
        <input type="text" name="query" placeholder="Search by common or scientific name"
          autocomplete="off"
          role="combobox"
          aria-activedescendant=""
          aria-autocomplete="list"
          aria-expanded="false"
          aria-controls="search-results"
          aria-label="Search by common or scientific name"
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

const packageJSONPath = fileURLToPath(import.meta.resolve("../../../package.json"));
const packageJSONVersion = JSON.stringify(JSON.parse(readFileSync(packageJSONPath, "utf-8")).version);

SearchBar.js = js`
  window.__SEARCH_DB_VERSION = ${packageJSONVersion};
  ${js.import("./search-bar.js")}
`;