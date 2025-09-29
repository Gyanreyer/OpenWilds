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
  const decompressedDataStream = await fetch("/OpenWilds.db.gz").then(res => res.body?.pipeThrough(new DecompressionStream("gzip")));
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
  `;

  static {
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(SearchBarElement.styles);
    document.adoptedStyleSheets.push(stylesheet);
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
   *
   * @param {SubmitEvent} evt
   */
  onSubmitSearch = async (evt) => {
    evt.preventDefault();

    const searchResultsListElement = this.querySelector("#search-results");
    if (!searchResultsListElement) {
      console.error("Could not find #search-results element");
      return;
    }

    const formElement = this.formElement;

    const formData = new FormData(formElement);
    const queryString = formData.get("query")?.toString().trim();

    if (!queryString) {
      searchResultsListElement.replaceChildren();
      return;
    }

    let db = SearchBarElement.DB;
    if (!db) {
      SearchBarElement.DB_PROMISE ??= getDB().then((database) => {
        SearchBarElement.DB = database;
        return database;
      });
      db = await SearchBarElement.DB_PROMISE;
    }

    const results = /** @type {SearchResult[]} */(db.selectObjects(SearchBarElement.SEARCH_QUERY_STRING, queryString));

    const newSearchResultNodes = results.map((result, i) => {
      const listItem = document.createElement("li");
      listItem.role = "presentation";
      const link = document.createElement("a");
      link.role = "option";
      link.href = result.path;
      link.textContent = `${result.matching_common_name || result.primary_common_name} (${result.scientific_name})`;
      link.dataset.i = String(i);
      link.tabIndex = -1;
      link.className = "search-result";
      link.id = `search-result-${result.path}`
      listItem.appendChild(link);
      return listItem;
    });
    searchResultsListElement.replaceChildren(...newSearchResultNodes);
  }
});