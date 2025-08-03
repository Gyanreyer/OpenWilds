import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import { readFile } from "node:fs/promises";

import { html } from "./_lib/html.js";

import Base from "./_layouts/base.js";

const baseDataFileDirectoryPath = import.meta
  .resolve("../data/")
  .slice("file://".length);
const dataEntryPaths = await glob("**/data.yml", {
  cwd: baseDataFileDirectoryPath,
  onlyFiles: true,
  absolute: true,
});

export const config = {
  pagination: {
    data: "dataEntries",
    size: 1,
    alias: "dataEntry",
  },
  permalink: (data) => data.dataEntry.permalink,
  dataEntries: await Promise.all(
    dataEntryPaths.map(async (path) => {
      const fileContents = await readFile(path, "utf8");
      return {
        permalink: path.slice(
          baseDataFileDirectoryPath.length,
          -"data.yml".length
        ),
        ...parseYaml(fileContents),
      };
    })
  ),
};

export default function ({ dataEntry }) {
  return html`<${Base}>
    <header>
      <h1>${dataEntry.common_names[0]}</h1>
      <p aria-description="Scientific name">${dataEntry.scientific_name}</p>
    </header>
    ${dataEntry.common_names.length > 1 ? html`<section>
      <h2>Other common names</h2>
      <ul>
        ${dataEntry.common_names.slice(1).map((name) => html`<li>${name}</li>`)}
      </ul>
    </section>` : null}
  <//>`;
}
