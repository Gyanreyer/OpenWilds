const heightStringRegex = /(\d+)(ft|in)/i;

/**
 * @param {string} heightString - ie, "5ft", "12in"
 * @returns {number}  A number representing the parsed height in inches
 */
export const heightStringToInches = (heightString) => {
  const match = heightString.match(heightStringRegex);
  if (!match) {
    throw new Error(`Unable to parse height string "${heightString}"`)
  }
  const [, number, unit] = match;

  if (unit === "ft") {
    return parseInt(number, 10) * 12;
  }

  return parseInt(number, 10);
}