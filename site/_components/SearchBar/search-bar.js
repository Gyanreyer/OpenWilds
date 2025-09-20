// @ts-ignore
import("/lib/sqlite3.mjs").then(async (module) => {
  const sqlite3 = await module.default({
    print: console.log,
    printErr: console.error,
  });

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

  /**
   * @param {string} query 
   */
  window.searchDB = (query) => {
    return db.selectObjects(`
      SELECT
        plants.path as path,
        MAX(plant_name_fts.common_name) as common_name,
        MAX(plant_name_fts.scientific_name) as scientific_name 
      from plant_name_fts
      JOIN plants on plant_name_fts.plant_id = plants.id
      WHERE plant_name_fts MATCH '${query}*'
      GROUP BY plants.path
      ORDER BY rank
      LIMIT 16
   `);
  }
});

window.customElements.define("search-bar", class extends HTMLElement {
  connectedCallback() {
    const form = this.querySelector("form");
    if (!form) {
      console.error("<search-bar> requires a <form> child");
      return;
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const query = formData.get("query").toString().trim();
      console.log("Search query:", query);
      console.log(window.searchDB(query));
      // Load sqlite wasm and perform search
    });
  }
});