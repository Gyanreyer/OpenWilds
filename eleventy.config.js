import { parse as parseHTML, serialize as serializeHTML } from 'parse5';
import { Features, transform as transformCSS } from 'lightningcss';
import {
  writeFile,
  access,
  mkdir,
} from 'node:fs/promises';
import {
  join,
  resolve,
} from 'node:path';

/**
 * @import { UserConfig } from '@11ty/eleventy';
 * @import {Node} from 'parse5';
 */

const DEFAULT_CSS_BUNDLE = "default";

const UNSCOPABLE_TAGNAMES = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr", "title", "textarea", "script", "noscript", "svg", "math", "canvas", "video", "audio", "iframe", "object"
]);

/**
 *
 * @param {UserConfig} eleventyConfig
 */
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    _public: "/",
    "**/*.client.js": "/client/",
    "**/*.client.css": "/client/",
  });

  eleventyConfig.addTemplateFormats("page.js");


  /**
   * @type {Record<string, Set<string>>}
   */
  const cssBundles = {};

  let scidIncrement = 0;

  /**
   * @param {import("parse5").DefaultTreeAdapterTypes.Node} node
   */
  function traverseAndProcessHTMLNodes(node) {
    if (!("childNodes" in node)) {
      return;
    }

    // Copy array to avoid mutation issues when removing children
    for (const child of [...node.childNodes]) {
      if (!("tagName" in child)) {
        continue;
      }

      if (UNSCOPABLE_TAGNAMES.has(child.tagName)) {
        continue;
      }

      if (child.tagName === "style") {
        let styleCSSText = "";

        for (const styleTextNode of child.childNodes) {
          if (styleTextNode.nodeName === "#text" && "value" in styleTextNode) {
            styleCSSText += styleTextNode.value;
          }
        }

        const isScoped = child.attrs.some(({ name, value }) => name === "data-scoped" && value !== "false");

        if (isScoped && "tagName" in child.parentNode) {
          const parentElement = child.parentNode;
          let scid = parentElement.attrs.find(attr => attr.name === "data-scid")?.value;
          if (!scid) {
            scid = scidIncrement.toString(36);
            parentElement.attrs.push({
              name: "data-scid",
              value: scid,
            });
            scidIncrement += 1;
          }

          styleCSSText = `[data-scid="${scid}"] { ${styleCSSText} }`;
        }

        const bundleName = child.attrs.find(({ name }) => name === "data-bundle")?.name || DEFAULT_CSS_BUNDLE;

        (cssBundles[bundleName] ??= new Set()).add(styleCSSText.trim());

        child.parentNode.childNodes = child.parentNode.childNodes.filter((node) => node !== child);
        continue; // Don't recurse into removed style node
      }

      // Recurse into children
      traverseAndProcessHTMLNodes(child);
    }
  }

  eleventyConfig.addExtension(["page.js"], {
    key: "page.js",
    useJavaScriptImport: true,
    async getInstanceFromInputPath(inputPath) {
      const mod = await import(inputPath);
      return {
        render: mod.default,
        config: mod.config || {},
      };
    },
    getData: ["config"],
    compile({ render }) {
      return async (data) => {
        const initialRawHTML = render(data);

        const parsedHTMLDocument = parseHTML(initialRawHTML);

        traverseAndProcessHTMLNodes(parsedHTMLDocument);

        return serializeHTML(parsedHTMLDocument);
      };
    },

  });

  eleventyConfig.addPassthroughCopy("site/public");

  eleventyConfig.on("eleventy.after", async (
    { directories: {
      output
    },
    }
  ) => {
    const encoder = new TextEncoder();

    await Promise.all(
      Object.entries(cssBundles).map(async ([bundleName, cssChunkSet]) => {
        const cssContent = Array.from(cssChunkSet.values()).join("\n");
        if (cssContent.length === 0) {
          return;
        }

        const { code } = await transformCSS({
          filename: `${bundleName}.css`,
          code: encoder.encode(cssContent),
          minify: true,
          include: Features.Nesting,
        });

        const outputDir = resolve(join(output, "css"));

        try {
          await access(outputDir);
        } catch (err) {
          await mkdir(outputDir, { recursive: true });
        }

        const outputFilePath = join(outputDir, `${bundleName}.css`);

        console.log("Writing CSS bundle", bundleName, "to", outputFilePath);

        await writeFile(outputFilePath, code);
      })
    );
  });

  return {
    dir: {
      input: "site",
      layouts: "_layouts",
      output: "dist",
    },
  };
}
