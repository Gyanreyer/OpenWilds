/**
 * @typedef {import("@sqlite.org/sqlite-wasm")} SqliteModule;
 * @typedef {import("@sqlite.org/sqlite-wasm").Database} Database;
 * @typedef {import("@sqlite.org/sqlite-wasm").PreparedStatement} PreparedStatement;
 */

const getDB = async () => {
  /**
   * @type {SqliteModule}
   */
  const sqlite3Module =
    // @ts-ignore
    await import("/lib/sqlite3.mjs");
  const sqlite3 = await sqlite3Module.default({
    print: console.log,
    printErr: console.error,
  });

  // Load the gzipped database file, decompress it, and deserialize it into the SQLite instance
  const decompressedDataStream = await fetch(`/OpenWilds.db.gz?v=${/** @type {any} */(window).__DB_VERSION}`, {
    headers: {
      // Cache the database indefinitely, since it is versioned by the app version
      "Cache-Control": "public, max-age=31536000, immutable",
    }
  }).then(res => res.body?.pipeThrough(new DecompressionStream("gzip")));
  if (!decompressedDataStream) {
    throw new Error("Could not fetch or decompress database");
  }
  const databaseBuffer = await new Response(decompressedDataStream).arrayBuffer();

  const pBytes = sqlite3.wasm.allocFromTypedArray(new Uint8Array(databaseBuffer));
  const db = new sqlite3.oo1.DB();

  if (db.pointer === undefined) {
    throw new Error("Failed to open database: db.pointer is undefined");
  }

  const rc = sqlite3.capi.sqlite3_deserialize(
    db.pointer,
    'main',
    pBytes,
    databaseBuffer.byteLength,
    databaseBuffer.byteLength,
    sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE,
  );
  db.checkRc(rc);

  return db;
};

/**
 * @typedef {Object} SearchResult
 * @property {string} path
 * @property {string} scientific_name
 * @property {string} matching_common_name
 * @property {string} primary_common_name
 */

window.customElements.define("search-bar", class SearchBarElement extends HTMLElement {
  /**
   * @type {Database | null}
   */
  static DB = null;
  /**
   * @type {Promise<Database> | null}
   */
  static DB_PROMISE = null;

  static SEARCH_QUERY_STRING = `SELECT
    plants.path as path,
    plants.scientific_name as scientific_name,
    MAX(plant_name_fts.common_name) as matching_common_name,
    primary_names.common_name as primary_common_name
  from plant_name_fts(?)
  JOIN plants on plant_name_fts.plant_id = plants.id
  LEFT JOIN plant_common_names as primary_names
    ON plant_name_fts.plant_id = primary_names.plant_id
    AND primary_names.is_primary_name = 1
  GROUP BY plants.path
  ORDER BY rank
  LIMIT 16`;

  /**
   * @type {PreparedStatement | null}
   */
  static PREPARED_SEARCH_QUERY = null;

  static styles = /*css*/`
    search-bar {
      position: relative;
    }

    search-bar form input {
      display: block;
      width: 100%;
    }

    #search-results-container {
      position: absolute;
      top: 100%;
      left: 0;
      width: 100%;
      border-end-start-radius: 8px;
      border-end-end-radius: 8px;
      background: white;
      border: 1px solid black;
    }

    search-bar[data-expanded="false"] #search-results-container, #search-results-container:not(:has(ul > li)) {
      /* Hide if no search results */
      display: none;
    }

    #search-results {
      list-style: none;
      margin: 0;
      padding: 0;
      max-height: 400px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      background: var(--background);
    }

    #search-results li {
      border-top: 1px solid var(--text-secondary);
    }

    #search-results li:first-child {
      border-top: none;
    }

    #search-results li a {
      display: block;
      text-decoration: none;
      padding: 4px;
      color: var(--text-primary);
      transition-duration: 0.1s;
      transition-property: background-color, opacity;
    }

    #search-results li a[aria-selected="true"] {
      background-color: var(--brand-primary);
      font-weight: 600;
    }

    #search-results li a span {
      display: inline-block;
      transition: transform 0.1s ease-in-out;
    }

    #search-results li a[aria-selected="true"] span {
      transform: translateX(1.5ch);
    }

    #search-results li a::before {
      content: "→";
      position: absolute;
      opacity: 0;
      transform: translateX(-1.5ch);
      transition-duration: 0.1s;
      transition-property: opacity, transform;
    }
    #search-results li a[aria-selected="true"]::before {
      opacity: 1;
      transform: translateX(0);
    }

    #search-results li a:hover {
      background-color: var(--brand-secondary);
    }

    #search-results:has(li a:hover) li a[aria-selected="true"]:not(:hover) {
      opacity: 0.4;
    }
  `;

  static {
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(SearchBarElement.styles);
    document.adoptedStyleSheets.push(stylesheet);
  }

  /**
   * @param {SearchResult} result
   * @param {number} index
   * @param {boolean} isSelected
   */
  static getSearchResultHTML(result, index, isSelected) {
    return /* html */`<li role="presentation">
      <a
        role="option"
        href="${result.path}"
        data-i="${index}"
        tabindex="${isSelected ? "0" : "-1"}"
        aria-selected="${isSelected ? "true" : "false"}"
        class="search-result"
        id="result-${result.path}"
      >
        <span>${result.matching_common_name || result.primary_common_name} (${result.scientific_name})</span>
      </a>
    </li>`;
  }

  /**
   * Allowed characters in search string:
   * - Non-ASCII range characters (i.e. unicode codepoints greater than 127), or
   * - One of the 52 upper and lower case ASCII characters, or
   */
  static ILLEGAL_SEARCH_STRING_CHAR_REGEX = /[^\w\s]/;
  static WHITESPACE_REGEX = /\s+/;

  /**
   * @param {string} searchString
   */
  static sanitizeSearchString(searchString) {
    let sanitizedString = '"';

    for (let i = 0; i < searchString.length; i++) {
      const char = searchString.charAt(i);

      if (this.ILLEGAL_SEARCH_STRING_CHAR_REGEX.test(char)) {
        // Replace illegal characters with spaces
        sanitizedString += " ";
      } else if (this.WHITESPACE_REGEX.test(char)) {
        // Replace whitespace characters with single spaces
        sanitizedString += " ";
      } else {
        sanitizedString += char;
      }
    }

    sanitizedString += '"';

    return `"${sanitizedString.split(this.WHITESPACE_REGEX).filter(s => s.length > 0).join('" "').trim()}"`;
  }

  connectedCallback() {
    this.addEventListener("keydown", this.onkeydown);
    this.addEventListener("focusin", (evt) => {
      this.inputElement.setAttribute("aria-expanded", "true");
      this.dataset.expanded = "true";
    });
    this.addEventListener("focusout", (evt) => {
      if (!(evt.relatedTarget instanceof HTMLElement) || !this.contains(evt.relatedTarget)) {
        this.inputElement.setAttribute("aria-expanded", "false");
        this.dataset.expanded = "false";
      }
    });
    this.inputElement.addEventListener("input", this.onSearchInputChange);
    this.formElement.addEventListener("submit", this.onSubmitSearch);
  }

  /**
   * @type {HTMLFormElement | null}
   */
  #cachedFormElement = null;
  get formElement() {
    const el = this.#cachedFormElement ??= this.querySelector("& > form");
    if (!el) {
      throw new Error("Could not find form element");
    }
    return el;
  }

  /**
   * @type {HTMLInputElement | null}
   */
  #cachedInputElement = null;
  get inputElement() {
    const el = this.#cachedInputElement ??= this.querySelector("& > form > input");
    if (!el) {
      throw new Error("Could not find input element");
    }
    return el;
  }

  /**
   * @type {HTMLUListElement | null}
   */
  #cachedSearchResultsListElement = null;
  get searchResultsListElement() {
    const el = this.#cachedSearchResultsListElement ??= this.querySelector("& #search-results");
    if (!el) {
      throw new Error("Could not find #search-results element");
    }
    return el;
  }

  /**
   * @returns {HTMLAnchorElement | null}
   */
  getSelectedSearchResult() {
    return this.searchResultsListElement.querySelector("& > li a[aria-selected='true']");
  }

  /**
   * @param {number} index 
   * @returns {HTMLAnchorElement | null}
   */
  getSearchResultByIndex(index) {
    return this.searchResultsListElement.querySelector(`& > li a[data-i='${index}']`);
  }

  /**
   * @param {number} index 
   * @returns {HTMLAnchorElement | null}
   */
  getSearchResultElementAtIndex(index) {
    return this.searchResultsListElement.querySelector(`& > li a[data-i='${index}']`);
  }

  /**
   * @param {HTMLAnchorElement} newSelectedResult 
   */
  updateSelectedResultElement(newSelectedResult) {
    const prevSelectedResult = this.getSelectedSearchResult();

    if (newSelectedResult === prevSelectedResult) {
      newSelectedResult.focus();
      return;
    }

    if (prevSelectedResult) {
      prevSelectedResult.tabIndex = -1;
      prevSelectedResult.setAttribute("aria-selected", "false");
    }

    newSelectedResult.tabIndex = 0;
    newSelectedResult.setAttribute("aria-selected", "true");
    newSelectedResult.focus();
  }

  /**
   * @param {number} selectedResultIndex 
   */
  updateSelectedResultIndex(selectedResultIndex) {
    const newSelectedResult = this.getSearchResultElementAtIndex(selectedResultIndex);
    if (newSelectedResult) {
      this.updateSelectedResultElement(newSelectedResult);
    }
  }

  /**
   * @param {KeyboardEvent} evt 
   */
  onkeydown = (evt) => {
    if (!(evt.target instanceof HTMLElement)) {
      return;
    }

    if (evt.target === this.inputElement) {
      if (evt.key === "ArrowUp" || evt.key === "ArrowDown") {
        evt.preventDefault();
        const initiallySelectedResult = this.getSelectedSearchResult() ?? this.getSearchResultByIndex(evt.key === "ArrowDown" ? 0 : this.searchResultsListElement.childElementCount - 1);
        if (initiallySelectedResult) {
          this.updateSelectedResultElement(initiallySelectedResult);
        }
      }
    } else if (evt.target.className === "search-result") {
      const childCount = this.searchResultsListElement.childElementCount;
      if (childCount === 0) {
        return;
      }

      const lastResultIndex = childCount - 1;

      const currentSelectedResult = this.getSelectedSearchResult();
      const currentSelectedResultIndex = Number(currentSelectedResult?.dataset.i ?? "-1");

      switch (evt.key) {
        case "ArrowUp": {
          evt.preventDefault();
          const nextSelectedIndex = currentSelectedResultIndex > 0 ? currentSelectedResultIndex - 1 : lastResultIndex;
          this.updateSelectedResultIndex(nextSelectedIndex);
          break;
        }
        case "ArrowDown": {
          evt.preventDefault();
          const nextSelectedIndex = currentSelectedResultIndex < lastResultIndex ? currentSelectedResultIndex + 1 : 0;
          this.updateSelectedResultIndex(nextSelectedIndex);
          break;
        }
        case "Home": {
          evt.preventDefault();
          this.updateSelectedResultIndex(0);
          break;
        }
        case "End": {
          evt.preventDefault();
          this.updateSelectedResultIndex(lastResultIndex);
          break;
        }
        case "Escape": {
          evt.preventDefault();
          /**
           * @type {HTMLInputElement | null}
           */
          const inputElement = this.querySelector("form input");
          if (inputElement) {
            inputElement.focus();
            inputElement.setAttribute("aria-activedescendant", "");
          }

          if (currentSelectedResult) {
            currentSelectedResult.tabIndex = -1;
            currentSelectedResult.setAttribute("aria-selected", "false");
          }
          break;
        }
      }
    }
  }

  /**
   * @type {number | null}
   */
  #debounceTimeoutID = null;
  #isDebouncedCallInProgress = false;

  onSearchInputChange = () => {
    if (!SearchBarElement.DB && !SearchBarElement.DB_PROMISE) {
      // Start loading the database on first input
      SearchBarElement.DB_PROMISE = getDB().then((database) => {
        SearchBarElement.DB = database;
        return database;
      });
    }

    if (this.#debounceTimeoutID !== null) {
      window.clearTimeout(this.#debounceTimeoutID);
    }
    this.#debounceTimeoutID = window.setTimeout(() => {
      this.#debounceTimeoutID = null;
      if (this.#isDebouncedCallInProgress) {
        // Retry in .3s if a call is currently still in progress
        this.onSearchInputChange();
        return;
      }
      this.#isDebouncedCallInProgress = true;
      this.debouncedOnSearchInputChange().finally(() => {
        this.#isDebouncedCallInProgress = false;
      });
    }, 300);
  }

  debouncedOnSearchInputChange = async () => {
    const searchInputElement = this.inputElement;
    const searchString = SearchBarElement.sanitizeSearchString(searchInputElement.value);

    const searchResultsListElement = this.searchResultsListElement;

    if (searchString.length < 3) {
      // Our search tokenizer uses trigrams, so we need at least 3 characters to search
      searchResultsListElement.innerHTML = "";
      return;
    }

    let db = SearchBarElement.DB || await SearchBarElement.DB_PROMISE;
    if (!db) {
      console.error("Database is not loaded");
      return;
    }

    const results = /** @type {SearchResult[]} */(db.selectObjects(SearchBarElement.SEARCH_QUERY_STRING, searchString));

    if (results.length === 0) {
      searchResultsListElement.innerHTML = `<li role="presentation">No results found</li>`;
      return;
    }

    const newSearchResultHTML = results.map((result, i) => SearchBarElement.getSearchResultHTML(result, i, i === 0)).join("\n");
    searchResultsListElement.innerHTML = newSearchResultHTML;
  }

  /**
   *
   * @param {SubmitEvent} evt
   */
  onSubmitSearch = async (evt) => {
    evt.preventDefault();
    this.getSelectedSearchResult()?.click();
  }
});