const getDB = async () => {
  /**
   * @typedef {import("@sqlite.org/sqlite-wasm")} SqliteModule;
   */

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
  const decompressedDataStream = await fetch("/OpenWilds.db.gz").then(res => res.body.pipeThrough(new DecompressionStream("gzip")));
  const databaseBuffer = await new Response(decompressedDataStream).arrayBuffer();

  const pBytes = sqlite3.wasm.allocFromTypedArray(new Uint8Array(databaseBuffer));
  const db = new sqlite3.oo1.DB();
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
 * @property {string} common_name
 */

window.customElements.define("search-bar", class SearchBarElement extends HTMLElement {
  static DB = null;
  static DB_PROMISE = null;

  connectedCallback() {
    const form = this.querySelector("form");
    if (!form) {
      console.error("<search-bar> requires a <form> child");
      return;
    }

    form.addEventListener("submit", this.onSubmitSearch);
  }

  /**
   * @param {string} searchString
   */
  static getSearchDBQuery = (searchString) => `SELECT
  plants.path as path,
  plants.scientific_name as scientific_name,
  MAX(plant_name_fts.common_name) as matching_common_name
  -- MAX(plant_common_names.common_name) as common_name
from plant_name_fts('${searchString}')
JOIN plants on plant_name_fts.plant_id = plants.id
-- join plant_common_names on plant_name_fts.plant_id = plant_common_names.plant_id
GROUP BY plants.path
ORDER BY rank
LIMIT 16`;

  /**
   * 
   * @param {SubmitEvent} evt 
   */
  onSubmitSearch = async (evt) => {
    evt.preventDefault();
    let db = SearchBarElement.DB;
    if (!db) {
      SearchBarElement.DB_PROMISE ??= getDB().then((database) => {
        SearchBarElement.DB = database;
        return database;
      });
      db = await SearchBarElement.DB_PROMISE;
    }

    const formElement = /** @type {HTMLFormElement} */ (evt.target);

    const formData = new FormData(formElement);
    const query = formData.get("query").toString().trim();

    /**
     * @type {SearchResult[]}
     */
    const results = db.selectObjects(SearchBarElement.getSearchDBQuery(query));
    console.log(results);
  }
});