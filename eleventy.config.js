import { parse as parseHTML, serialize as serializeHTML, html as parse5HTML, defaultTreeAdapter } from 'parse5';
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
import { bundleSrcPrefix, bundleSrcPrefixLength, inlinedBundleRegex, inlinedWildcardBundle as inlinedWildCardBundle, WILDCARD_BUNDLE_NAME } from '#site-lib/bundle.js';

/**
 * @import { UserConfig } from '@11ty/eleventy';
 * @import { DefaultTreeAdapterTypes as Parse5Types } from 'parse5';
 */

/**
 * @param {Parse5Types.Node} node
 * @returns {node is Parse5Types.Document}
 */
const isDocumentNode = (node) => node.nodeName === "#document";

/**
 * @param {Parse5Types.Document | Parse5Types.Element} node
 * @param {((elementNode: Parse5Types.Element) => boolean)} callback
 *
 * @returns {Parse5Types.Element | null}
 */
const queryElement = (node, callback) => {
  if (!isDocumentNode(node) && callback(node)) {
    return node;
  }

  for (const childNode of node.childNodes) {
    if (defaultTreeAdapter.isElementNode(childNode)) {
      const result = queryElement(childNode, callback);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

const TRANSFORM_ACTIONS =
/** @type {const} */({
    REMOVE: "REMOVE",
    REPLACE: "REPLACE",
    SKIP_CHILDREN: "SKIP_CHILDREN",
    CONTINUE: "CONTINUE",
  });

/**
 * @typedef {(typeof TRANSFORM_ACTIONS)["REMOVE"] | (typeof TRANSFORM_ACTIONS)["CONTINUE"] | (typeof TRANSFORM_ACTIONS)["SKIP_CHILDREN"] | [(typeof TRANSFORM_ACTIONS)["REPLACE"], ...Parse5Types.ChildNode[]]} TransformResult
 */

/**
 * @param {Parse5Types.Node} node
 * @param {(node: Parse5Types.Node) => TransformResult | Promise<TransformResult>} transformer
 */
const transformDocumentNodes = async (node, transformer) => {
  const result = await transformer(node);
  if (result === TRANSFORM_ACTIONS.SKIP_CHILDREN) {
    return TRANSFORM_ACTIONS.CONTINUE;
  } else if (result !== TRANSFORM_ACTIONS.CONTINUE) {
    return result;
  }

  if (isDocumentNode(node) || defaultTreeAdapter.isElementNode(node)) {
    let childNodeCount = node.childNodes.length;
    for (let i = 0; i < childNodeCount; ++i) {
      const childNode = node.childNodes[i];
      const childResult = await transformDocumentNodes(childNode, transformer);
      if (childResult === TRANSFORM_ACTIONS.REMOVE) {
        node.childNodes.splice(i, 1);
        childNode.parentNode = null;
        --i;
        --childNodeCount;
      } else if (Array.isArray(childResult) && childResult[0] === TRANSFORM_ACTIONS.REPLACE) {
        const [, ...newChildNodes] = childResult;
        node.childNodes.splice(i, 1, ...newChildNodes);
        for (const newChildNode of newChildNodes) {
          newChildNode.parentNode = node;
        }
        i += newChildNodes.length - 1;
        childNodeCount += newChildNodes.length - 1;
        // Disconnect the replaced node from the tree
        childNode.parentNode = null;
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

const lazyPreloadOnloadRegex = /\bthis\.rel\s*=\s*['"`]stylesheet['"`]/;

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

        // Set of JS bundles which were used on this page but haven't been inserted into script tags yet
        const unimportedJSBundleNameSet = new Set(Object.keys(renderedJSBundles));
        const unimportedCSSBundleNameSet = new Set(Object.keys(renderedCSSBundles));

        const parsedDocument = parseHTML(`<!DOCTYPE html>${html}`, {
          onParseError: (err) => {
            console.error(`Error parsing HTML on page ${data.page.url}:`, err);
          },
          sourceCodeLocationInfo: false,
        });

        /**
         * @type {Record<string, Parse5Types.ChildNode>}>}
         */
        let deduplicatedHeadNodes = {};

        // Gather all <head> tag children and de-dupe them
        await transformDocumentNodes(parsedDocument, (node) => {
          if (!defaultTreeAdapter.isElementNode(node) || (node.tagName !== "head" && node.tagName !== "head--")) {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          for (const childNode of node.childNodes) {
            childNode.parentNode = null;

            if (!defaultTreeAdapter.isElementNode(childNode)) {
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
                const charsetAttr = childNode.attrs.find((attr) => attr.name === "charset");
                if (charsetAttr) {
                  deduplicatedHeadNodes[`meta[charset="${charsetAttr.value}"]`] = childNode;
                }
                const propertyAttr = childNode.attrs.find((attr) => attr.name === "property");
                if (propertyAttr) {
                  deduplicatedHeadNodes[`meta[property="${propertyAttr.value}"]`] = childNode;
                }
                const httpEquivAttr = childNode.attrs.find((attr) => attr.name === "http-equiv");
                if (httpEquivAttr) {
                  deduplicatedHeadNodes[`meta[http-equiv="${httpEquivAttr.value}"]`] = childNode;
                }
                if (!nameAttr && !charsetAttr && !propertyAttr && !httpEquivAttr) {
                  deduplicatedHeadNodes[randomUUID()] = childNode;
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
                    if (defaultTreeAdapter.isTextNode(scriptChildNode)) {
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
                  if (defaultTreeAdapter.isTextNode(styleChildNode)) {
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
        });

        const rootHTMLTag = queryElement(parsedDocument,
          (node) => node.tagName === "html"
        );

        /**
         * @type {Parse5Types.ParentNode}
         */
        const newHeadTag = defaultTreeAdapter.createElement("head", parse5HTML.NS.HTML, []);
        for (const headNode of Object.values(deduplicatedHeadNodes)) {
          defaultTreeAdapter.appendChild(newHeadTag, headNode);
        }
        rootHTMLTag.childNodes.unshift(newHeadTag);
        newHeadTag.parentNode = rootHTMLTag;

        // Clear head nodes object for garbage collection
        deduplicatedHeadNodes = {};

        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardCSSLinkNodes = new Set();


        /**
         * @param {Parse5Types.Element} node
         * @returns {TransformResult}
         */
        const handleLinkNode = (node) => {
          const relAttr = node.attrs.find((attr) => attr.name === "rel") ?? null;

          let isPreloadLink = false;
          let isLazyImportPreloadLink = false;

          if (relAttr.value === "preload") {
            isPreloadLink = true;
            // Stylesheets maybe be imported via preload links, but only if they have `as="style"`
            const asAttr = node.attrs.find((attr) => attr.name === "as") ?? null;
            if (asAttr.value !== "style") {
              return TRANSFORM_ACTIONS.CONTINUE;
            }
            const onloadAttr = node.attrs.find((attr) => attr.name === "onload") ?? null;
            isLazyImportPreloadLink = Boolean(onloadAttr) && lazyPreloadOnloadRegex.test(onloadAttr.value);
          } else if (relAttr.value !== "stylesheet") {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          const hrefAttr = node.attrs.find((attr) => attr.name === "href") ?? null;

          if (!hrefAttr || !hrefAttr.value.startsWith(bundleSrcPrefix)) {
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          const globalImportBundleName = hrefAttr.value.slice(bundleSrcPrefixLength);

          if (globalImportBundleName === WILDCARD_BUNDLE_NAME) {
            // If this is a wildcard import, we need to handle it later after we've processed all other nodes
            wildCardCSSLinkNodes.add(node);
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          if (!isPreloadLink || isLazyImportPreloadLink) {
            // Don't consider the bundle as "used" yet if we're dealing with a `preload` link
            // which doesn't actually lazily import the stylesheet with an `onload` handler.
            unimportedCSSBundleNameSet.delete(globalImportBundleName);
          }
          const cssContent = renderedCSSBundles[globalImportBundleName] ? Array.from(renderedCSSBundles[globalImportBundleName]).join("") : null;
          if (!cssContent) {
            console.error(`CSS bundle "${globalImportBundleName}" is unused on page ${data.page.url}. Removing link tag.`);
            // Remove the link if the bundle is not used on this page
            return TRANSFORM_ACTIONS.REMOVE;
          }

          globalCssBundles[globalImportBundleName] ??= new Set();
          globalCssBundles[globalImportBundleName].add(cssContent);

          hrefAttr.value = getCSSBundleHref(globalImportBundleName);

          return TRANSFORM_ACTIONS.CONTINUE;
        };

        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardInlinedCSSStyleNodes = new Set();

        /**
         * <style> tags which we need to return to to process their contents once
         * all bundles are resolved
         *
         * @type {Set<Parse5Types.Element>}
         */
        const styleNodesToProcess = new Set();

        /**
         * @param {Parse5Types.Element} node
         * @returns {TransformResult}
         */
        const handleStyleNode = (node) => {
          let shouldSkipProcessingContents = false;
          node.attrs = node.attrs.filter((attr) => {
            if (attr.name === "data-skip-inline-processing") {
              shouldSkipProcessingContents = (attr.value ?? "false") !== "false";
              // Remove this attribute after processing it
              return false;
            }
            return true;
          });

          let styleTagText = "";
          for (const childNode of node.childNodes) {
            if (defaultTreeAdapter.isTextNode(childNode)) {
              styleTagText += childNode.value;
            }
          }

          styleTagText = styleTagText.trim();
          if (styleTagText.length === 0) {
            console.warn(`Empty <style> tag found on page ${data.page.url}. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          styleTagText = styleTagText.replaceAll(
            inlinedBundleRegex,
            (match, bundleName) => {
              if (bundleName === WILDCARD_BUNDLE_NAME) {
                // If this is a wildcard import, we need to handle it later after we've processed all other nodes
                wildCardInlinedCSSStyleNodes.add(node);
                return match;
              }
              unimportedCSSBundleNameSet.delete(bundleName);
              const cssContent = renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("") : null;
              if (cssContent === null) {
                console.error(`No CSS bundle found with name "${bundleName}" to inline on page ${data.page.url}`);
                return "";
              }

              return cssContent;
            }
          ).trim();

          if (styleTagText.length === 0) {
            console.warn(`Empty <style> tag found on page ${data.page.url} after resolving bundles. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          node.childNodes = [];
          defaultTreeAdapter.insertText(node, styleTagText);

          if (!shouldSkipProcessingContents) {
            styleNodesToProcess.add(node);
          }

          return TRANSFORM_ACTIONS.CONTINUE;
        };

        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardJSScriptImportNodes = new Set();
        /**
         * @type {Set<Parse5Types.Element>}
         */
        const wildCardInlinedJSScriptNodes = new Set();

        /**
         * <script> tags which we need to return to to process their contents once
         * all bundles are resolved
         * 
         * @type {Set<Parse5Types.Element>}
         */
        const inlineScriptNodesToProcess = new Set();

        /**
         * @param {Parse5Types.Element} node
         * @returns {TransformResult}
         */
        const handleScriptNode = (node) => {
          const srcAttr = node.attrs.find((attr) => attr.name === "src") ?? null;
          if (srcAttr) {
          // Skip wild card imports here; they are handled in a second pass below
            if (srcAttr.value.startsWith(bundleSrcPrefix)) {
              const globalImportBundleName = srcAttr.value.slice(bundleSrcPrefixLength);
              if (globalImportBundleName === WILDCARD_BUNDLE_NAME) {
                // If this is a wildcard import, we need to handle it later after we've processed all other nodes
                wildCardJSScriptImportNodes.add(node);
              } else {
                unimportedJSBundleNameSet.delete(globalImportBundleName);
                const jsContent = renderedJSBundles && renderedJSBundles[globalImportBundleName] ? Array.from(renderedJSBundles[globalImportBundleName]).join("") : null;
                if (!jsContent) {
                  console.error(`JS bundle "${globalImportBundleName}" is unused on page ${data.page.url}. Removing script tag.`);
                  // Remove the script if the bundle is not used on this page
                  return TRANSFORM_ACTIONS.REMOVE;
                }

                globalJsBundles[globalImportBundleName] ??= new Set();
                globalJsBundles[globalImportBundleName].add(jsContent);

                srcAttr.value = getJSBundleSrc(globalImportBundleName);
              }
            }
            return TRANSFORM_ACTIONS.CONTINUE;
          }

          let shouldSkipProcessingContents = false;
          node.attrs = node.attrs.filter((attr) => {
            if (attr.name === "data-skip-inline-processing") {
              shouldSkipProcessingContents = (attr.value ?? "false") !== "false";
              // Remove this attribute after processing it
              return false;
            }
            return true;
          });

          let scriptTagText = "";
          for (const childNode of node.childNodes) {
            if (defaultTreeAdapter.isTextNode(childNode)) {
              scriptTagText += childNode.value;
            }
          }
          scriptTagText = scriptTagText.trim();

          if (scriptTagText.length === 0) {
            console.warn(`Empty <script> tag found on page ${data.page.url}. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          scriptTagText = scriptTagText.replaceAll(
            inlinedBundleRegex,
            (match, bundleName) => {
              if (bundleName === WILDCARD_BUNDLE_NAME) {
                // If this is a wildcard import, we need to handle it later after we've processed all other nodes
                wildCardInlinedJSScriptNodes.add(node);
                return match;
              }

              unimportedJSBundleNameSet.delete(bundleName);
              const jsContent = renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("") : null;
              if (jsContent === null) {
                console.error(`No JS bundle found with name "${bundleName}" to inline on page ${data.page.url}`);
                return "";
              }

              return jsContent;
            }
          ).trim();

          if (scriptTagText.length === 0) {
            console.warn(`Empty <script> tag found on page ${data.page.url} after resolving bundles. Removing.`);
            return TRANSFORM_ACTIONS.REMOVE;
          }

          node.childNodes = [];
          defaultTreeAdapter.insertText(node, scriptTagText);

          if (!shouldSkipProcessingContents) {
            inlineScriptNodesToProcess.add(node);
          }

          return TRANSFORM_ACTIONS.CONTINUE;
        };

        // Transform and process all <link> tags which import CSS bundles
        await transformDocumentNodes(parsedDocument,
          async (node) => {
            if (!defaultTreeAdapter.isElementNode(node)) {
              return TRANSFORM_ACTIONS.CONTINUE;
            }

            switch (node.tagName) {
              case "link": {
                return handleLinkNode(node);
              }
              case "style": {
                return handleStyleNode(node);
              }
              case "script": {
                return handleScriptNode(node);
              }
              default: {
                return TRANSFORM_ACTIONS.CONTINUE;
              }
            }
          },
        );

        const wildCardCSSBundleNames = Array.from(unimportedCSSBundleNameSet);

        for (const wildCardLinkNode of wildCardCSSLinkNodes) {
          const nodeIndex = wildCardLinkNode.parentNode.childNodes.indexOf(wildCardLinkNode);
          const newNodes = [];
          for (const bundleName of wildCardCSSBundleNames) {
            const cssContent = renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("") : null;
            if (!cssContent) {
              continue;
            }

            globalCssBundles[bundleName] ??= new Set();
            globalCssBundles[bundleName].add(cssContent);

            const newNode = {
              ...wildCardLinkNode,
            };
            const hrefAttr = newNode.attrs.find((attr) => attr.name === "href");
            hrefAttr.value = getCSSBundleHref(bundleName);

            newNodes.push(newNode);
          }

          wildCardLinkNode.parentNode.childNodes.splice(nodeIndex, 1, ...newNodes);
        }

        for (const styleNode of wildCardInlinedCSSStyleNodes) {
          const combinedWildCardBundleContent = wildCardCSSBundleNames.map((bundleName) => {
            return renderedCSSBundles[bundleName] ? Array.from(renderedCSSBundles[bundleName]).join("\n") : null;
          }).join("\n").trim();


          const currentStyleTagText = styleNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();
          const newStyleTagText = currentStyleTagText.replaceAll(
            inlinedWildCardBundle,
            combinedWildCardBundleContent
          );

          styleNode.childNodes = [];
          defaultTreeAdapter.insertText(styleNode, newStyleTagText);
        }

        const wildCardJSBundleNames = Array.from(unimportedJSBundleNameSet);

        for (const scriptNode of wildCardJSScriptImportNodes) {
          const nodeIndex = scriptNode.parentNode.childNodes.indexOf(scriptNode);
          const newNodes = [];
          for (const bundleName of wildCardJSBundleNames) {
            const jsContent = renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("") : null;
            if (!jsContent) {
              continue;
            }

            globalJsBundles[bundleName] ??= new Set();
            globalJsBundles[bundleName].add(jsContent);
            const newNode = {
              ...scriptNode,
            };
            const srcAttr = newNode.attrs.find((attr) => attr.name === "src");
            srcAttr.value = getJSBundleSrc(bundleName);

            newNodes.push(newNode);
          }

          scriptNode.parentNode.childNodes.splice(nodeIndex, 1, ...newNodes);
        }

        for (const scriptNode of wildCardInlinedJSScriptNodes) {
          const combinedWildCardBundleContent = wildCardJSBundleNames.map((bundleName) => {
            return renderedJSBundles && renderedJSBundles[bundleName] ? Array.from(renderedJSBundles[bundleName]).join("\n") : null;
          }).join("\n").trim();

          const currentScriptTagText = scriptNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();
          const newScriptTagText = currentScriptTagText.replaceAll(
            inlinedWildCardBundle,
            combinedWildCardBundleContent
          );

          scriptNode.childNodes = [];
          defaultTreeAdapter.insertText(scriptNode, newScriptTagText);
        }

        let styleTagIndex = -1;
        for (const styleNode of styleNodesToProcess) {
          styleTagIndex += 1;

          let styleTagText = styleNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();

          const styleTagContentHash = createHash("md5").update(styleTagText).digest("hex");

          try {
            if (processedInlineBundleCache[styleTagContentHash] !== undefined) {
              styleTagText = processedInlineBundleCache[styleTagContentHash];
            } else {
              const { code } = transformCSS({
                filename: `${encodeURIComponent(data.page.url)}__<style>(${styleTagIndex}).css`,
                code: encoder.encode(styleTagText),
                minify: true,
                include: Features.Nesting,
              });
              styleTagText = processedInlineBundleCache[styleTagContentHash] = decoder.decode(code);
            }
          } catch (err) {
            console.error(`Error processing inlined CSS on page ${data.page.url}: ${err}`);
          }

          if (styleTagText.length === 0) {
            console.warn(`Empty <style> tag found on page ${data.page.url} after processing. Removing.`);
            defaultTreeAdapter.detachNode(styleNode);
          } else {
            styleNode.childNodes = [];
            defaultTreeAdapter.insertText(styleNode, styleTagText);
          }
        }


        let scriptTagIndex = -1;

        for (const scriptNode of inlineScriptNodesToProcess) {
          scriptTagIndex += 1;

          let scriptTagText = scriptNode.childNodes.map((childNode) => defaultTreeAdapter.isTextNode(childNode) ? childNode.value : "").join("").trim();

          const scriptTagContentHash = createHash("md5").update(scriptTagText).digest("hex");

          try {
            if (processedInlineBundleCache[scriptTagContentHash] !== undefined) {
              scriptTagText = processedInlineBundleCache[scriptTagContentHash];
            } else {
              const { code: transformedCode } = await transformJS(scriptTagText, {
                minify: true,
                target: ["es2020"],
                format: "esm",
                sourcefile: `${encodeURIComponent(data.page.url)}__<script>(${scriptTagIndex}).js`,
              });
              scriptTagText = processedInlineBundleCache[scriptTagContentHash] = transformedCode.trimEnd();
            }
          } catch (err) {
            console.error(`Error processing inlined JS on page ${data.page.url}: ${err}`);
          }

          if (scriptTagText.length === 0) {
            console.warn(`Empty <script> tag found on page ${data.page.url} after processing. Removing.`);
            defaultTreeAdapter.detachNode(scriptNode);
          } else {
            scriptNode.childNodes = [];
            defaultTreeAdapter.insertText(scriptNode, scriptTagText);
          }
        }

        return serializeHTML(parsedDocument);
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
        /**
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
