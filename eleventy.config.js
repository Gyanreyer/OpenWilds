import { yetiPlugin } from 'yeti-js';

/**
 * @import UserConfig from '@11ty/eleventy/src/UserConfig.js';
 * @param {UserConfig} eleventyConfig
 */
export default function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({
    "site/public": "/",
  });

  eleventyConfig.addWatchTarget("site/**/*");
  eleventyConfig.addPlugin(yetiPlugin);

  return {
    dir: {
      input: "site",
      layouts: "_layouts",
      output: "_site_dist",
    },
  };
}
