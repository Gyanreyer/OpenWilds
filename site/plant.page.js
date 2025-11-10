import { parse as parseYaml } from "yaml";
import Image from '@11ty/eleventy-img';
import { readFile, glob } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { html, css } from "yeti-js";

import { BaseLayout } from "#site-layouts/base.layout.js";
import { BloomColorSection } from "#site-components/plant/BloomColorSection.component.js";
import { LightRequirementSection } from "#site-components/plant/LightRequirementSection.component.js";
import { MoistureRequirementSection } from "#site-components/plant/MoistureRequirementSection.component.js";
import { eleventyImageConfig } from "#site-utils/eleventyImageConfig.js";

/**
 * @import { PlantData } from "./types/plantData.js";
 */

const baseDataFileDirectoryPath = fileURLToPath(import.meta.resolve("../data/"));
const dataEntryPathsIterator = await glob("plantae/**/data.yml", {
  cwd: baseDataFileDirectoryPath,
});

/**
 * @type {PlantData[]}
 */
const dataEntries = [];

for await (const relativeEntryPath of dataEntryPathsIterator) {
  const path = resolve(baseDataFileDirectoryPath, relativeEntryPath);
  const fileContents = await readFile(path, "utf8");

  const dataEntryDirectory = path.slice(0, -"data.yml".length);

  const imagePaths = await glob(["images/*.jpg", "images/*.jpeg", "images/*.png", "images/*.webp"], {
    cwd: dataEntryDirectory,
  });

  const images = [];
  for await (const relativeImagePath of imagePaths) {
    const imagePath = resolve(dataEntryDirectory, relativeImagePath);
    const result = await Image(imagePath, eleventyImageConfig);

    const imageMetdata = JSON.parse(await readFile(
      `${imagePath}.meta.json`,
      "utf8"
    ));

    images.push({
      ...result,
      meta: imageMetdata,
    });
  }

  dataEntries.push({
    ...parseYaml(fileContents),
    permalink: dataEntryDirectory.slice(
      baseDataFileDirectoryPath.length,
    ),
    images,
  });
}

export const config = {
  pagination: {
    data: "dataEntries",
    size: 1,
    alias: "dataEntry",
  },
  dataEntries,
  /**
   * @param {{
   *  dataEntry: PlantData;
   * }} data
   */
  permalink: (data) => data.dataEntry.permalink,
};

/**
  * @import { YetiPageComponent } from 'yeti-js';
  * @type {YetiPageComponent<{
  *  dataEntry: PlantData;
  * }>}
 */
const PlantPage = ({ dataEntry }) => {
  const hasDistributionData = (dataEntry.distribution.US?.length ?? 0) > 0 || (dataEntry.distribution.CA?.length ?? 0) > 0;

  return html`<${BaseLayout}>
    <header>
      <div>
        <h1>${dataEntry.common_names[0]}</h1>
        <p aria-description="Scientific name">${dataEntry.scientific_name}</p>
      </div>
    </header>
    <div class="content-wrapper">
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
        <p>${dataEntry.height.min === dataEntry.height.max ? dataEntry.height.max : `${dataEntry.height.min} to ${dataEntry.height.max}`}</p>
      </section>
      <${LightRequirementSection} lightRequirement=${dataEntry.light} />
      <${MoistureRequirementSection} moistureRequirement=${dataEntry.moisture} />
    </main>
    ${hasDistributionData ? html`
    <aside>
      <svg xmlns="http://www.w3.org/2000/svg" width="1701.78" height="1695.51" id="map" aria-hidden>
        <style>
        use {
          color: var(--brand-primary);
          ${dataEntry.distribution.US?.map((state) => `--us-${state.toLowerCase()}: currentColor;`).join("\n") ?? ""}
          ${dataEntry.distribution.CA?.map((prov) => `--ca-${prov.toLowerCase()}: currentColor;`).join("\n") ?? ""}
        }
        </style>
        <use href="/US-CA-map.svg#map"></use>
      </svg>
      <h2 id="distribution-heading">Distribution</h2>
      <ul aria-labelledby="distribution-heading" id="distribution-list">
        ${(dataEntry.distribution.US?.length ?? 0) > 0 ? html`
          <li>United States
            <ul class="state-list">
            ${dataEntry.distribution.US?.map((s) => html`<li>${s}</li>`)}
            </ul>
          </li>
        `: ""}
        ${(dataEntry.distribution.CA?.length ?? 0) > 0 ? html`
          <li>Canada
            <ul class="state-list">
            ${dataEntry.distribution.CA?.map((p) => html`<li>${p}</li>`)}
            </ul>
          </li>` : ""}
      </ul>
    </aside>` : ""}
    </div>
  <//>`;
}

PlantPage.css = css`
  ${css.bundle("plant")}
  #plant-images {
    display: flex;
    list-style: none;
    flex-wrap: wrap;
    padding: 0;
    gap: 0.5rem;
    --row-height: 300px;

    li {
      position: relative;
      height: var(--row-height);
      max-width: 100%;
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
      height: 100%;
      width: auto;
      display: block;
      border-radius: 4px;
    }
  }

  .content-wrapper {
    display: flex;
    gap: 2rem;
    max-width: min(1200px, 90vw);
    margin: 0 auto;
    margin-block-end: 8rem;
  }

  main {
    display: flex;
    flex-direction: column;
    row-gap: 1rem;
  }

  aside {
    flex-basis: 25%;
    min-width: 320px;
  }

  @media (max-width: 900px) {
    .content-wrapper {
      flex-direction: column;
    }

    aside {
      min-width: auto;
      width: 100%;
    }
  }

  #map {
    width: 100%;
    height: auto;
  }

  #distribution-list, .state-list {
    list-style: none;
    padding: 0;
  }

  #distribution-heading {
    margin-block: 0.5rem;
  }

  #distribution-list {
    margin: 0;
    display: flex;
    flex-direction: column;
    row-gap: 1rem;
  }

  #distribution-list > li {
    font-weight: bold;
  }

  .state-list {
    margin-block-start: 0.25rem;
    margin-inline-start: 0.25rem;
    display: flex;
    flex-wrap: wrap;
    column-gap: 0.25ch;
    font-weight: normal;

    & li:not(:last-child)::after {
      content: ",";
    }
  }
`;

export default PlantPage;