import { glob } from "tinyglobby";
import { parse as parseYaml } from "yaml";
import Image from '@11ty/eleventy-img';
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { html } from "#site-lib/html.js";

import Base from "#site-layouts/base.layout.js";
import { BloomColorSection } from "#site-components/plant/BloomColorSection.component.js";
import { LightRequirementSection } from "#site-components/plant/LightRequirementSection.component.js";
import { MoistureRequirementSection } from "#site-components/plant/MoistureRequirementSection.component.js";
import { eleventyImageConfig } from "#site-utils/eleventyImageConfig.js";
import { css } from "#site-lib/css.js";
import { bundle } from "#site-lib/bundle.js";

/**
 * @import { PlantData } from "./types/plantData.js";
 */

const baseDataFileDirectoryPath = fileURLToPath(import.meta.resolve("../data/"));
const dataEntryPaths = await glob("plantae/**/data.yml", {
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
  /**
   * @param {{
   *  dataEntry: PlantData;
   * }} data
   */
  permalink: (data) => data.dataEntry.permalink,
  dataEntries: await Promise.all(
    dataEntryPaths.map(
      /**
       * @param {string} path
       * @returns {Promise<PlantData>}
       */
      async (path) => {
        const fileContents = await readFile(path, "utf8");

        const dataEntryDirectory = path.slice(0, -"data.yml".length);

        const imagePaths = await glob(["images/*.jpg", "images/*.jpeg", "images/*.png", "images/*.webp"], {
          cwd: dataEntryDirectory,
          onlyFiles: true,
          absolute: true,
        });

        const images = await Promise.all(
          imagePaths.map(async (imagePath) => {
            const result = await Image(imagePath, eleventyImageConfig);

            const imageMetdata = JSON.parse(await readFile(
              `${imagePath}.meta.json`,
              "utf8"
            ));

            return {
              ...result,
              meta: imageMetdata,
            }
          })
        );

        return {
          ...parseYaml(fileContents),
          permalink: dataEntryDirectory.slice(
            baseDataFileDirectoryPath.length,
          ),
          images,
        };
      })
  ),
};

/**
 * @param {Object} props
 * @param {PlantData} props.dataEntry
 */
export default function Plant({ dataEntry }) {
  return html`<${Base}>
    <header>
      <div>
        <h1>${dataEntry.common_names[0]}</h1>
        <p aria-description="Scientific name">${dataEntry.scientific_name}</p>
      </div>
    </header>
    <main>
    <ul id="plant-images">
      ${dataEntry.images.map((image) => {
    const imageTagImage = image.jpeg[image.jpeg.length - 1];

    return html`<li style="aspect-ratio: ${imageTagImage.width} / ${imageTagImage.height}">
        <figure>
        <picture>
          <source type="image/webp" srcset="${image.webp.map((img) => img.srcset).join(",")}" />
          <source type="image/jpeg" srcset="${image.jpeg.map((img) => img.srcset).join(",")}" />
          <img src="${imageTagImage.url}" alt="${image.meta.alt}" width=${imageTagImage.width} height=${imageTagImage.height} loading="lazy" sizes="auto" />
        </picture>
        <figcaption>Photo by <a href=${image.meta.creatorURL}>${image.meta.creatorName}</a></figcaption>
        </figure>
        </li>`;
  })}
    </ul>
    ${dataEntry.common_names.length > 1 ? html`<section>
      <h2>Other common names</h2>
      <ul>
        ${dataEntry.common_names.slice(1).map((name) => html`<li>${name}</li>`)}
      </ul>
    </section>` : null}
    <section>
      <h2>Life cycle</h2>
      <p>${dataEntry.life_cycle}</p>
    </section>
    ${dataEntry.bloom_color ? html`<${BloomColorSection} colors=${Array.isArray(dataEntry.bloom_color) ? dataEntry.bloom_color : [dataEntry.bloom_color]} />` : null}
    ${dataEntry.bloom_time ? html`<section>
      <h2>Bloom time</h2>
      <p>${dataEntry.bloom_time.start} to ${dataEntry.bloom_time.end}</p>
    </section>` : null}
    <section>
      <h2>Height</h2>
      <p>${dataEntry.height}</p>
    </section>
    <${LightRequirementSection} lightRequirement=${dataEntry.light} />
    <${MoistureRequirementSection} moistureRequirement=${dataEntry.moisture} />
    </main>
  <//>`;
}

Plant.css = css`
  ${bundle("plant")}
  #plant-images {
    display: flex;
    list-style: none;
    flex-wrap: wrap;
    padding: 0;
    gap: 1rem;

    li {
      position: relative;
      min-width: min(240px, 100vw);
      max-width: 480px;
      max-height: 320px;
      margin-bottom: auto;
    }

    figure {
      display: contents;
    }

    figcaption {
      position: absolute;
      bottom: 0;
      padding-block-start: 0.5rem;
      padding: 0.3rem;
      color: white;
      background-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.4) 35%, rgba(0, 0, 0, 0.6) 70%);
      width: 100%;
      font-size: 0.8rem;
      font-style: italic;
      /* Make the bottom corners conform to the image's border radius */
      border-radius: 0 0 4px 4px;
    }

    figcaption a {
      color: white;
      text-decoration: underline;
    }

    img {
      max-width: 100%;
      max-height: 100%;
      width: auto;
      display: block;
      border-radius: 4px;
    }
  }
`;