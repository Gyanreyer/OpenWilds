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

/**
 *
 * @param {UserConfig} eleventyConfig
 */
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("site/public");
  eleventyConfig.addWatchTarget("site/_components/**/*.js");

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
    /**
     * @param {Object} compileContext 
     * @param {((data: any) => import('#site-lib/html').RenderResult) & { css?: Record<string, string> }} compileContext.render
     * @returns {(data: any) => Promise<string>}
     */
    compile({ render }) {
      return async (data) => {
        const {
          html,
          cssBundles: renderedCSSBundles,
        } = render(data);

        let linkHTML = "";

        /**
         * @type {Set<string>}
         */
        const linkedStylesheets = new Set();

        // Apply any CSS from the page component, since the returned css bundles only include styles from child components.
        for (const bundleName in render.css) {
          linkHTML += `<link rel="stylesheet" href="/css/${bundleName}.css">`;
          linkedStylesheets.add(bundleName);
          cssBundles[bundleName] ??= new Set();
          cssBundles[bundleName].add(render.css[bundleName]);
        }

        for (const bundleName in renderedCSSBundles) {
          if (!linkedStylesheets.has(bundleName)) {
            linkHTML += `<link rel="stylesheet" href="/css/${bundleName}.css">`;
          }
          cssBundles[bundleName] ??= new Set();
          for (const chunk of renderedCSSBundles[bundleName]) {
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
          console.error("Error processing CSS bundle", bundleName, ":", err);
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
