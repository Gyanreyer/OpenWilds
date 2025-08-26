import { DEFAULT_BUNDLE_NAME, getBundleName, isBundleObject } from "./bundle.js";

/**
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 */
export function css(strings, ...values) {
  /**
   * @type {Record<string, string[]>}
   */
  const rawCSSBundles = {};

  let currentBundleName = DEFAULT_BUNDLE_NAME;

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const currentBundleArray = (rawCSSBundles[currentBundleName] ??= []);
    currentBundleArray.push(str);

    const value = values[i];
    if (isBundleObject(value)) {
      currentBundleName = getBundleName(value);
    } else if (value !== undefined && value !== null) {
      // If the value is not a bundle object, append it to the current bundle as a string
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