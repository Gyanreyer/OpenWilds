import { HTMLRewriter } from 'html-rewriter-wasm';
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
  let cssBundles = {};

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

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
    init() {
      // Clear CSS bundles on init so we don't accumulate cruft from past builds
      // when in watch mode.
      cssBundles = {}
    },
    compile({ render }) {
      return async (data) => {
        const {
          html,
          css,
        } = render(data);

        let linkHTML = "";

        for (const bundleName in css) {
          linkHTML += `<link rel="stylesheet" href="/css/${bundleName}.css">`;
          cssBundles[bundleName] ??= new Set();
          for (const chunk of css[bundleName]) {
            cssBundles[bundleName].add(chunk);
          }
        }

        let outputHTML = "";

        if (!linkHTML) {
          outputHTML = html;
        } else {
          const rewriter = new HTMLRewriter((outputChunk) => {
            outputHTML += decoder.decode(outputChunk);
          });
          rewriter.on("head", {
            element: (element) => {
              element.onEndTag((endTag) => {
                endTag.before(linkHTML, {
                  html: true,
                });
              });
            },
          });

          try {
            await rewriter.write(encoder.encode(html));
            await rewriter.end();
          } finally {
            rewriter.free();
          }
        }

        return outputHTML;
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

    await Promise.allSettled(
      Object.entries(cssBundles).map(async ([bundleName, cssChunkSet]) => {
        const cssContent = Array.from(cssChunkSet.values()).join("");
        if (cssContent.length === 0) {
          return;
        }

        /**
         * @type {Uint8Array}
         */
        let code;

        try {
          ({ code } = await transformCSS({
            filename: `${bundleName}.css`,
            code: encoder.encode(cssContent),
            minify: true,
            include: Features.Nesting,
          }));
        } catch (err) {
          throw new Error("Error processing CSS bundle " + bundleName + ": " + err.message);
        }

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
