/**
 * @import { UserConfig } from '@11ty/eleventy';
 */

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
    async compile({ render }) {
      return (data) => `<!DOCTYPE html>${render(data)}`;
    },
  });

  eleventyConfig.addPassthroughCopy("site/public");

  return {
    dir: {
      input: "site",
      layouts: "_layouts",
      output: "dist",
    },
  };
}
