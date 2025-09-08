import { HTMLRewriter } from 'html-rewriter-wasm';
import { Features, transform as transformCSS, } from 'lightningcss';
import { transform as transformJS } from 'esbuild';
import {
  writeFile,
  access,
  mkdir,
} from 'node:fs/promises';
import {
  join,
  resolve,
} from 'node:path';
import { bundleSrcPrefix, bundleSrcPrefixLength, inlinedBundleRegex } from '#site-lib/bundle.js';

/**
 * @import { UserConfig } from '@11ty/eleventy';
 */

/**
 * @param {string} bundleName
 */
const getCSSBundleHref = (bundleName) => `/css/${bundleName}.css`;
/**
 * @param {string} bundleName
 */
const getJSBundleSrc = (bundleName) => `/js/${bundleName}.js`;

/**
 *
 * @param {UserConfig} eleventyConfig
 */
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    "site/public": "/",
  });
  eleventyConfig.addWatchTarget("site/_components/**/*.js");

  eleventyConfig.addTemplateFormats("page.js");

  /**
   * @type {Record<string, Set<string>>}
   */
  let globalCssBundles = {};
  /**
   * @type {Record<string, Set<string>>}
   */
  let globalJsBundles = {};

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
      // Clear CSS and JS bundles on init so we don't accumulate cruft from past builds
      // when in watch mode.
      globalCssBundles = {}
      globalJsBundles = {};
    },
    /**
     * @param {Object} compileContext 
     * @param {((data: any) => import('#site-lib/html').RenderResult) & { css?: Record<string, string>; js?: Record<string, string> }} compileContext.render
     * @returns {(data: any) => Promise<string>}
     */
    compile({ render }) {
      /**
       * Object to cache results from processing inline bundles so we don't re-process the same
       * content multiple times. Doing this on the page template level because that tends to be where
       * inlined content duplication happens the most.
       *
       * @type {Record<string, string>}
       */
      const processedInlineBundleCache = {};

      /**
       * @param {{
       *  page: {
       *   url: string;
       *   outputPath: string;
       *  };
       * } & {
       *  [key: string]: any;
       * }} data
       */
      return async (data) => {
        const {
          html,
          cssBundles: renderedCSSBundles,
          jsBundles: renderedJSBundles,
        } = render(data);

        let outputHTML = "";

        const rewriter = new HTMLRewriter((outputChunk) => {
          outputHTML += decoder.decode(outputChunk);
        });

        rewriter.on(`link[rel="stylesheet"][href^="${bundleSrcPrefix}"], link[rel="preload"][as="style"][href^="${bundleSrcPrefix}"]`, {
          element: (element) => {
            const bundleName = element.getAttribute("href").slice(bundleSrcPrefixLength);
            const cssContent = renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("") : null;
            if (cssContent === null) {
              console.error(`CSS bundle "${bundleName}" is unused on page ${data.page.url}. Removing link tag.`);
              element.remove();
              return;
            }

            if (cssContent.length >= 0) {
              globalCssBundles[bundleName] ??= new Set();
              globalCssBundles[bundleName].add(cssContent);
            }

            element.setAttribute("href", getCSSBundleHref(bundleName));
          },
        });

        let currentStyleTagText = "";

        let styleTagIndex = -1;

        rewriter.on("style", {
          element: async (element) => {
            const shouldSkipProcessingContents = (element.getAttribute("data-skip-inline-processing") ?? "false") !== "false";

            styleTagIndex += 1;
            element.onEndTag(async (endTag) => {
              if (currentStyleTagText.trim().length === 0) {
                endTag.remove();
                currentStyleTagText = "";
                return;
              }

              let newStyleTagContents = currentStyleTagText.replaceAll(
                inlinedBundleRegex,
                (match, bundleName) => {
                  const cssContent = renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("") : null;
                  if (cssContent === null) {
                    console.error(`No CSS bundle found with name "${bundleName}" to inline on page ${data.page.url}`);
                    return "";
                  }

                  return cssContent;
                }).trim();

              if (!shouldSkipProcessingContents) {
                try {
                  if (processedInlineBundleCache[newStyleTagContents] !== undefined) {
                    newStyleTagContents = processedInlineBundleCache[newStyleTagContents];
                  } else {
                    const { code } = await transformCSS({
                      filename: `${encodeURIComponent(data.page.url)}__${styleTagIndex}.css`,
                      code: encoder.encode(newStyleTagContents),
                      minify: true,
                      include: Features.Nesting,
                    });
                    newStyleTagContents = processedInlineBundleCache[newStyleTagContents] = decoder.decode(code);
                  }
                } catch (err) {
                  console.error(`Error processing inlined CSS on page ${data.page.url}: ${err}`);
                }
              }

              if (newStyleTagContents.length === 0) {
                endTag.remove();
              } else {
                endTag.before(
                  newStyleTagContents, {
                  html: true,
                });
              }

              currentStyleTagText = "";
            });
          },
          text: (textChunk) => {
            currentStyleTagText += textChunk.text;
            textChunk.remove();
          },
        });

        let currentScriptTagText = "";

        rewriter.on("script", {
          element: async (element) => {
            const src = element.getAttribute("src");

            if (src?.startsWith(bundleSrcPrefix)) {
              const globalImportBundleName = element.getAttribute("href").slice(bundleSrcPrefixLength);

              const jsContent = renderedJSBundles && renderedJSBundles[globalImportBundleName] ? Array.from(renderedJSBundles[globalImportBundleName]).join("") : null;
              if (jsContent === null) {
                console.error(`JS bundle "${globalImportBundleName}" is unused on page ${data.page.url}. Removing script tag.`);
                element.remove();
                return;
              }

              if (jsContent.length >= 0) {
                globalJsBundles[globalImportBundleName] ??= new Set();
                globalJsBundles[globalImportBundleName].add(jsContent);
              }

              element.setAttribute("src", getJSBundleSrc(globalImportBundleName));
            }

            const shouldSkipProcessingContents = (element.getAttribute("data-skip-inline-processing") ?? "false") !== "false";

            element.onEndTag(async (endTag) => {
              if (currentScriptTagText.trim().length === 0) {
                if (!src) {
                  endTag.remove();
                }
                currentScriptTagText = "";
                return;
              }

              let newScriptTagContents = currentScriptTagText.replaceAll(
                inlinedBundleRegex,
                (match, bundleName) => {
                  const jsContent = renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("") : null;
                  if (jsContent === null) {
                    console.error(`No JS bundle found with name "${bundleName}" to inline on page ${data.page.url}`);
                    return "";
                  }

                  return jsContent;

                }).trim();

              if (!shouldSkipProcessingContents) {
                try {
                  if (processedInlineBundleCache[newScriptTagContents] !== undefined) {
                    newScriptTagContents = processedInlineBundleCache[newScriptTagContents];
                  } else {
                    const { code: transformedCode } = await transformJS(newScriptTagContents, {
                      minify: true,
                      target: ["es2020"],
                      format: "esm",
                    });
                    // Use trimEnd to chop off the trailing newline that esbuild adds
                    newScriptTagContents = processedInlineBundleCache[newScriptTagContents] = transformedCode.trimEnd();
                  }
                } catch (err) {
                  console.error(`Error processing inlined JS on page ${data.page.url}: ${err}`);
                }
              }

              if (newScriptTagContents.length === 0) {
                endTag.remove();
              } else {
                endTag.before(
                  newScriptTagContents, {
                  html: true,
                });
              }

              currentScriptTagText = "";
            });
          },
          text: (textChunk) => {
            currentScriptTagText += textChunk.text;
            textChunk.remove();
          },
        });


        try {
          await rewriter.write(encoder.encode(html));
          await rewriter.end();
        } finally {
          rewriter.free();
        }

        return outputHTML;
      };
    },

  });

  eleventyConfig.on("eleventy.before", async ({
    directories: {
      input
    },
  }) => {
    process.env.__ELEVENTY_INPUT_DIR__ = input;
  });

  eleventyConfig.on("eleventy.after", async (
    { directories: {
      output
    },
    }
  ) => {
    await Promise.allSettled(
      Object.entries(globalCssBundles).map(async ([bundleName, cssChunkSet]) => {
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

        await writeFile(outputFilePath, code, "utf8");
      })
    );

    await Promise.allSettled(
      Object.entries(globalJsBundles).map(async ([bundleName, jsChunkSet]) => {
        const jsContent = Array.from(jsChunkSet.values()).join("");
        if (jsContent.length === 0) {
          return;
        }

        /**
         * @type {string}
         */
        let code;
        /*n*
         * @type {string}
         */
        let sourceMap;

        try {
          const result = await transformJS(jsContent, {
            minify: true,
            target: ["es2020"],
            format: "esm",
            sourcemap: true,
            sourcefile: `${bundleName}.js`,
          });
          code = `//# sourceMappingURL=${bundleName}.js.map\n${result.code}`;
          sourceMap = result.map;
        } catch (err) {
          console.error("Error processing JS bundle", bundleName, ":", err);
          throw new Error("Error processing JS bundle " + bundleName + ": " + err.message);
        }

        const outputDir = resolve(join(output, "js"));

        try {
          await access(outputDir);
        } catch (err) {
          await mkdir(outputDir, { recursive: true });
        }

        const outputFilePath = join(outputDir, `${bundleName}.js`);
        const outputSourceMapPath = join(outputDir, `${bundleName}.js.map`);

        console.log("Writing JS bundle", bundleName, "to", outputFilePath);

        await writeFile(outputFilePath, code, "utf8");
        await writeFile(outputSourceMapPath, sourceMap, "utf8");
      })
    );
  });

  return {
    dir: {
      input: "site",
      layouts: "_layouts",
      output: "_site_dist",
    },
  };
}
