import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { getCallSites } from 'node:util';

export const DEFAULT_BUNDLE_NAME = "default";
export const WILDCARD_BUNDLE_NAME = "*";

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
export const bundle = (bundleName = DEFAULT_BUNDLE_NAME) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  return ({
    [bundleNameSymbol]: bundleName,
  })
};

export const importFilePathSymbol = Symbol("import-file-path");
export const importFileContentsSymbol = Symbol("import-file-contents");

/**
 * @typedef {{
 *  [importFilePathSymbol]: string;
 *  [importFileContentsSymbol]: string;
 *  [bundleNameSymbol]?: string;
 * }} BundleImportObject
 */

const FILE_URL_PREFIX = "file://";
const FILE_URL_PREFIX_LENGTH = FILE_URL_PREFIX.length;

/**
 * @param {string} importPath
 * @param {string} [bundleName]
 *
 * @returns {BundleImportObject}
 */
bundle.import = (importPath, bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`bundle.import() called with reserved wildcard bundle name "${WILDCARD_BUNDLE_NAME}"`);
  }

  /**
   * @type {string}
   */
  let resolvedFilePath;

  if (importPath.startsWith(FILE_URL_PREFIX)) {
    resolvedFilePath = importPath.slice(FILE_URL_PREFIX_LENGTH);
  } else if (importPath.startsWith("/")) {
    // Absolute path; resolve relative to the Eleventy input directory
    resolvedFilePath = resolve(process.env.__ELEVENTY_INPUT_DIR__, `.${importPath}`);
  } else if (importPath.startsWith("./") || importPath.startsWith("../")) {
    // Relative path; resolve relative to the caller file's directory
    const callSites = getCallSites();
    const callerDirname = dirname(callSites[1].scriptName).slice(FILE_URL_PREFIX_LENGTH);
    resolvedFilePath = resolve(callerDirname, importPath);
  } else {
    resolvedFilePath = import.meta.resolve(importPath).slice(FILE_URL_PREFIX_LENGTH);
  }

  try {
    const fileContents = readFileSync(resolvedFilePath, "utf-8");
    return ({
      [importFilePathSymbol]: importPath,
      [importFileContentsSymbol]: fileContents,
      [bundleNameSymbol]: bundleName,
    })
  } catch (err) {
    throw new Error(`bundle.import failed to import file at path "${importPath}": ${err.message}`);
  }
};

/**
 * @param {unknown} maybeBundleObj
 * @returns {maybeBundleObj is BundleObject}
 */
export const isBundleObject = (maybeBundleObj) =>
  typeof maybeBundleObj === "object" && maybeBundleObj !== null &&
  typeof maybeBundleObj[bundleNameSymbol] === "string";

/**
 * @param {unknown} maybeBundleImportObj
 * @returns {maybeBundleImportObj is BundleImportObject}
 */
export const isBundleImportObject = (maybeBundleImportObj) =>
  typeof maybeBundleImportObj === "object" && maybeBundleImportObj !== null &&
  typeof maybeBundleImportObj[importFilePathSymbol] === "string";

/**
 * @param {BundleObject} bundleObj
 * @returns {string | undefined}
 */
export const getBundleName = (bundleObj) => bundleObj[bundleNameSymbol];

/**
 * @param {BundleImportObject} bundleImportObj
 * @returns {string}
 */
export const getBundleImportFilePath = (bundleImportObj) => bundleImportObj[importFilePathSymbol];

/**
 * @param {BundleImportObject} bundleImportObj
 * @returns {string}
 */
export const getBundleImportFileContents = (bundleImportObj) => bundleImportObj[importFileContentsSymbol];

export const bundleSrcPrefix = "__bundle__";
export const bundleSrcPrefixLength = bundleSrcPrefix.length;

/**
 * @param {string} bundleName
 */
export const bundleSrc = (bundleName) => `${bundleSrcPrefix}${bundleName}`;

/**
 * @param {string} bundleName
 */
export const inlinedBundle = (bundleName) => {
  if (bundleName === WILDCARD_BUNDLE_NAME) {
    throw new Error(`inlinedBundle() does not support wildcard bundling. Use bundleSrc("${WILDCARD_BUNDLE_NAME}") instead.`);
  }

  return `/*@--BUNDLE--${bundleName}--@*/`;
}

export const inlinedBundleRegex = /\/\*@--BUNDLE--(.*?)--@\*\//g;