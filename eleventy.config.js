import { HTMLRewriter } from 'html-rewriter-wasm';
import { Features, transform as transformCSS } from 'lightningcss';
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
  let jsBundles = {};

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
      cssBundles = {}
      jsBundles = {};
    },
    /**
     * @param {Object} compileContext 
     * @param {((data: any) => import('#site-lib/html').RenderResult) & { css?: Record<string, string>; js?: Record<string, string> }} compileContext.render
     * @returns {(data: any) => Promise<string>}
     */
    compile({ render }) {
      return async (data) => {
        const {
          html,
          cssBundles: renderedCSSBundles,
          jsBundles: renderedJSBundles,
        } = render(data);

        let cssLinkHTML = "";
        let jsScriptHTML = "";

        /**
         * @type {Set<string>}
         */
        const linkedCSSBundleNames = new Set();
        /**
         * @type {Set<string>}
         */
        const linkedScriptBundleNames = new Set();

        // Apply any CSS and JS from the page component, since the returned bundles only include styles and scripts from child components.
        if (render.css) {
          for (const bundleName in render.css) {
            cssBundles[bundleName] ??= new Set();
            cssBundles[bundleName].add(render.css[bundleName]);
            linkedCSSBundleNames.add(bundleName);
          }
        }
        if (render.js) {
          for (const bundleName in render.js) {
            jsBundles[bundleName] ??= new Set();
            jsBundles[bundleName].add(render.js[bundleName]);
            linkedScriptBundleNames.add(bundleName);
          }
        }

        for (const bundleName in renderedCSSBundles) {
          cssBundles[bundleName] ??= new Set();
          for (const chunk of renderedCSSBundles[bundleName]) {
            cssBundles[bundleName].add(chunk);
          }
          linkedCSSBundleNames.add(bundleName);
        }
        for (const bundleName in renderedJSBundles) {
          jsBundles[bundleName] ??= new Set();
          for (const chunk of renderedJSBundles[bundleName]) {
            jsBundles[bundleName].add(chunk);
          }
          linkedScriptBundleNames.add(bundleName);
        }

        for (const bundleName of linkedCSSBundleNames) {
          cssLinkHTML += `<link rel="stylesheet" href="/css/${bundleName}.css">`;
        }
        for (const bundleName of linkedScriptBundleNames) {
          jsScriptHTML += `<script src="/js/${bundleName}.js" type="module" async></script>`;
        }

        let outputHTML = "";

        if (!cssLinkHTML && !jsScriptHTML) {
          outputHTML = html;
        } else {
          const rewriter = new HTMLRewriter((outputChunk) => {
            outputHTML += decoder.decode(outputChunk);
          });
          rewriter.on("head", {
            element: (element) => {
              element.onEndTag((endTag) => {
                endTag.before(`${cssLinkHTML}\n${jsScriptHTML}`, {
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

        await writeFile(outputFilePath, code, "utf8");
      })
    );

    await Promise.allSettled(
      Object.entries(jsBundles).map(async ([bundleName, jsChunkSet]) => {
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
      output: "dist",
    },
  };
}
