const outputDir = import.meta.resolve("../../dist/img/").slice("file://".length);

export const eleventyImageConfig = {
  formats: ["webp", "jpeg"],
  widths: [320, 640, 1080, 1920],
  outputDir,
};