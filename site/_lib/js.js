export const DEFAULT_BUNDLE = Symbol.for("default");

/**
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 */
export function js(strings, ...values) {
  /**
   * @type {Record<string, string[]>}
   */
  const rawJSBundles = {};

  let currentBundleName = DEFAULT_BUNDLE.description;

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const currentBundleArray = (rawJSBundles[currentBundleName] ??= []);
    currentBundleArray.push(str);

    const value = values[i];
    if (typeof value === "symbol" && value.description) {
      currentBundleName = value.description;
    } else if (value !== undefined && value !== null) {
      // If the value is not a bundle symbol, append it to the current bundle
      currentBundleArray.push(String(value));
    }
  }

  /**
   * @type {Record<string, string>}
   */
  const jsBundles = {};

  for (const bundleName in rawJSBundles) {
    const combinedBundleString = rawJSBundles[bundleName].join("").trim();
    if (!combinedBundleString) {
      // Skip empty bundles
      continue;
    }

    // Wrap the bundle inside a block scope to avoid naming collisions
    jsBundles[bundleName] = `{\n${combinedBundleString}\n}`;
  }

  return jsBundles;
}