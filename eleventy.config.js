import { parse as parseHTML } from 'parse5';
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
import { createHash, randomUUID } from 'node:crypto';
import { bundleSrcPrefix, bundleSrcPrefixLength, inlinedBundleRegex } from '#site-lib/bundle.js';
import { NS } from 'parse5/dist/common/html';

/**
 * @import { UserConfig } from '@11ty/eleventy';
 * @import { DefaultTreeAdapterTypes as Parse5Types } from 'parse5';
 */

/**
 * @template {Parse5Types.Node} T
 *
 * @param {Parse5Types.Node} node
 * @param {(node: Parse5Types.Node) => node is T} callback
 *
 * @returns {T | null}
 */
const queryDocumentNode = (node, callback) => {
  if (callback(node)) {
    return node;
  }

  if ("childNodes" in node) {
    for (const childNode of node.childNodes) {
      const result = queryDocumentNode(childNode, callback);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

/**
 * @template {Parse5Types.Node} T[]
 *
 * @param {Parse5Types.Node} node
 * @param {(node: Parse5Types.Node) => node is T} callback
 * @param {T[]} [accumulator]
 *
 * @returns {T[]}
 */
const queryAllDocumentNodes = (node, callback, accumulator = []) => {
  if (callback(node)) {
    accumulator.push(node);
  }

  if ("childNodes" in node) {
    for (const childNode of node.childNodes) {
      queryAllDocumentNodes(childNode, callback, accumulator);
    }
  }

  return accumulator;
}

const TRANSFORM_ACTIONS =
/** @type {const} */({
    REMOVE: "REMOVE",
    REPLACE: "REPLACE",
    CONTINUE: "CONTINUE",
  });

/**
 * @param {Parse5Types.Node} node
 * @param {(node: Parse5Types.Node) => (typeof TRANSFORM_ACTIONS.REMOVE | [typeof TRANSFORM_ACTIONS.REPLACE, Parse5Types.ChildNode] | typeof TRANSFORM_ACTIONS.CONTINUE)} transformer
 */
const transformDocumentNodes = (node, transformer) => {
  const result = transformer(node);
  if (result !== TRANSFORM_ACTIONS.CONTINUE) {
    return result;
  }

  if ("childNodes" in node) {
    for (let i = node.childNodes.length - 1; i >= 0; i--) {
      const childNode = node.childNodes[i];
      const childResult = transformDocumentNodes(childNode, transformer);
      if (childResult === TRANSFORM_ACTIONS.REMOVE) {
        node.childNodes.splice(i, 1);
      } else if (Array.isArray(childResult) && childResult[0] === TRANSFORM_ACTIONS.REPLACE) {
        node.childNodes.splice(i, 1, childResult[1]);
      }
    }
  }

  return TRANSFORM_ACTIONS.CONTINUE;
};

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

        let bundleTransformedHTML = "";

        const parsedDocument = parseHTML(html, {
          onParseError: (err) => {
            console.error(`Error parsing HTML on page ${data.page.url}:`, err);
          },
        });

        /**
         * @type {Record<string, Parse5Types.ChildNode>}
         */
        const deduplicatedHeadNodes = {};

        transformDocumentNodes(parsedDocument, (node) => {
          if (!("tagName" in node)) {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          if ("tagName" in node && node.tagName === "head") {
            for (const childNode of node.childNodes) {
              if (!("tagName" in childNode)) {
                deduplicatedHeadNodes[randomUUID()] = childNode;
                continue;
              }

              // De-dupe title, meta, link, script, and style tags
              switch (childNode.tagName) {
                case "title": {
                  // Use the last title tag we encounter
                  deduplicatedHeadNodes["title"] = childNode;
                  break;
                }
                case "meta": {
                  const nameAttr = childNode.attrs.find((attr) => attr.name === "name");
                  if (nameAttr) {
                    deduplicatedHeadNodes[`meta[name="${nameAttr.value}"]`] = childNode;
                  }
                  break;
                };
                case "link": {
                  const relAttr = childNode.attrs.find((attr) => attr.name === "rel") ?? null;
                  const hrefAttr = childNode.attrs.find((attr) => attr.name === "href") ?? null;
                  deduplicatedHeadNodes[`link[rel="${relAttr?.value ?? ""}"][href="${hrefAttr?.value ?? ""}"]`] = childNode;
                  break;
                };
                case "script": {
                  const srcAttr = childNode.attrs.find((attr) => attr.name === "src") ?? null;
                  if (srcAttr) {
                    deduplicatedHeadNodes[`script[src="${srcAttr.value}"]`] = childNode;
                  } else {
                    let scriptContent = "";
                    for (const scriptChildNode of childNode.childNodes) {
                      if (scriptChildNode.nodeName === "#text" && "value" in scriptChildNode) {
                        scriptContent += scriptChildNode.value;
                      }
                    }
                    const scriptContentHash = createHash("md5").update(scriptContent).digest("hex");
                    deduplicatedHeadNodes[`script/${scriptContentHash}`] = childNode;
                  }
                  break;
                }
                case "style": {
                  let styleContent = "";
                  for (const styleChildNode of childNode.childNodes) {
                    if (styleChildNode.nodeName === "#text" && "value" in styleChildNode) {
                      styleContent += styleChildNode.value;
                    }
                  }
                  const styleContentHash = createHash("md5").update(styleContent).digest("hex");
                  deduplicatedHeadNodes[`style/${styleContentHash}`] = childNode;
                  break;
                }
                default: {
                  deduplicatedHeadNodes[randomUUID()] = childNode;
                  break;
                }
              }
            }

            return TRANSFORM_ACTIONS.REMOVE;
          }

          return TRANSFORM_ACTIONS.CONTINUE;
        });

        const rootHTMLTag = queryDocumentNode(parsedDocument,
          /**
           * @returns {node is Parse5Types.Element & { tagName: "head"; nodeName: "head"; }}
           */
          (node) => "tagName" in node && node.tagName === "html"
        );

        rootHTMLTag.childNodes.unshift({
          nodeName: "head",
          tagName: "head",
          attrs: [],
          namespaceURI: NS.HTML,
          parentNode: rootHTMLTag,
          childNodes: Object.values(deduplicatedHeadNodes),
        })

        const bundleResolutionTransformRewriter = new HTMLRewriter((outputChunk) => {
          bundleTransformedHTML += decoder.decode(outputChunk);
        });

        bundleResolutionTransformRewriter.on(`link[rel = "stylesheet"][href ^= "${bundleSrcPrefix}"], link[rel = "preload"][as = "style"][href ^= "${bundleSrcPrefix}"]`, {
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

        bundleResolutionTransformRewriter.on("style", {
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

              const styleTagContentHash = createHash("md5").update(newStyleTagContents).digest("hex");

              if (!shouldSkipProcessingContents) {
                try {
                  if (processedInlineBundleCache[styleTagContentHash] !== undefined) {
                    newStyleTagContents = processedInlineBundleCache[styleTagContentHash];
                  } else {
                    const { code } = await transformCSS({
                      filename: `${encodeURIComponent(data.page.url)}__${styleTagIndex}.css`,
                      code: encoder.encode(newStyleTagContents),
                      minify: true,
                      include: Features.Nesting,
                    });
                    newStyleTagContents = processedInlineBundleCache[styleTagContentHash] = decoder.decode(code);
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

        bundleResolutionTransformRewriter.on("script", {
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

              const scriptTagContentHash = createHash("md5").update(newScriptTagContents).digest("hex");

              if (!shouldSkipProcessingContents) {
                try {
                  if (processedInlineBundleCache[scriptTagContentHash] !== undefined) {
                    newScriptTagContents = processedInlineBundleCache[scriptTagContentHash];
                  } else {
                    const { code: transformedCode } = await transformJS(newScriptTagContents, {
                      minify: true,
                      target: ["es2020"],
                      format: "esm",
                    });
                    // Use trimEnd to chop off the trailing newline that esbuild adds
                    newScriptTagContents = processedInlineBundleCache[scriptTagContentHash] = transformedCode.trimEnd();
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

        // TODO: Support for merging <head> tags
        // How this would need to work...
        // - Start with the bundling rewriter pass above to resolve <link> and <script> tags
        // - Do a second rewriter pass to go through all head tags, gathering contents and removing them
        //   - Do a de-duping pass on the gathered head contents as we go:
        //     - Do a De-de that <title>, <meta>, keeping the last instance of each
        //     - De-dupe <link> tags by rel + href, keeping the last instance of each
        //     - De-dupe <script src=> tags based on src, keeping the last instance of each
        //     - Can we de-dupe inlined <script> and <style> tags in a meaningful way?
        //       - Yes. By content hash, keeping the first instance of each
        // - Do a third final rewriter pass to append all gathered <head> contents to the root <head> tag

        try {
          await bundleResolutionTransformRewriter.write(encoder.encode(html));
          await bundleResolutionTransformRewriter.end();
        } finally {
          bundleResolutionTransformRewriter.free();
        }

        return bundleTransformedHTML;
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
