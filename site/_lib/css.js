const bundles = {
  default: Symbol.for("default"),
  plant: Symbol.for("plant"),
};

/**
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 */
export function css(strings, ...values) {
  /**
   * @type {Record<string, string[]>}
   */
  const rawCSSBundles = {};

  let currentBundleSymbol = bundles.default;

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const currentBundleArray = (rawCSSBundles[currentBundleSymbol.description] ??= []);
    currentBundleArray.push(str);

    const value = values[i];
    if (typeof value === "symbol" && value.description in bundles) {
      currentBundleSymbol = value;
    } else if (value !== undefined && value !== null) {
      // If the value is not a bundle symbol, append it to the current bundle
      currentBundleArray.push(String(value));
    }
  }

  /**
   * @type {Record<string, string>}
   */
  const cssBundles = {};

  for (const bundleName in rawCSSBundles) {
    const combinedBundleString = rawCSSBundles[bundleName].join("").trim();
    if (!combinedBundleString) {
      // Skip empty bundles
      continue;
    }

    cssBundles[bundleName] = combinedBundleString;
  }

  return cssBundles;
}

css.bundles = bundles;