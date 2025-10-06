import { fileURLToPath } from "node:url";

const outputDir = fileURLToPath(import.meta.resolve("../../_site_dist/img/"));

export const eleventyImageConfig = {
  formats: ["webp", "jpeg"],
  widths: [320, 640, 1080, 1920],
  outputDir,
};