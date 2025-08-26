export const DEFAULT_BUNDLE_NAME = "default";

export const bundleNameSymbol = Symbol("bundle-name");

/**
 * @typedef {{
 *  [bundleNameSymbol]: string
 * }} BundleObject
 */

/**
 * @param {string} bundleName
 * @returns {BundleObject}
 */
export const bundle = (bundleName = DEFAULT_BUNDLE_NAME) => ({
  [bundleNameSymbol]: bundleName,
});

/**
 * @param {unknown} maybeBundleObj
 * @returns {maybeBundleObj is BundleObject}
 */
export const isBundleObject = (maybeBundleObj) =>
  typeof maybeBundleObj === "object" && maybeBundleObj !== null &&
  typeof maybeBundleObj[bundleNameSymbol] === "string";

/**
 * @param {BundleObject} bundleObj
 * @returns {string}
 */
export const getBundleName = (bundleObj) => bundleObj[bundleNameSymbol];
