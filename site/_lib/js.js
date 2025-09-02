import { DEFAULT_BUNDLE_NAME, getBundleImportFileContents, getBundleName, isBundleImportObject, isBundleObject } from "./bundle.js";

/**
 * @param {TemplateStringsArray} strings
 * @param  {...any} values
 */
export function js(strings, ...values) {
  /**
   * @type {Record<string, string[]>}
   */
  const rawJSBundles = {};

  let currentBundleName = DEFAULT_BUNDLE_NAME;

  for (let i = 0; i < strings.length; i++) {
    const str = strings[i];
    const currentBundleArray = (rawJSBundles[currentBundleName] ??= []);
    currentBundleArray.push(str);

    const value = values[i];

    if (isBundleImportObject(value)) {
      let importBundleName = currentBundleName;
      if (isBundleObject(value)) {
        importBundleName = getBundleName(value);
      }
      try {
        const fileContents = getBundleImportFileContents(value);
        const importBundleArray = (rawJSBundles[importBundleName] ??= []);
        importBundleArray.push(fileContents);
      } catch (err) {
        throw new Error(`bundle.import failed to import file at path "${importBundleName}": ${err.message}`);
      }
    } else if (isBundleObject(value)) {
      currentBundleName = getBundleName(value);
    } else if (value !== undefined && value !== null) {
      // If the value is not a bundle object, append it to the current bundle as a string
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