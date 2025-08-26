// Low number is capturing group 1 (index 0)
// High number is capturing group 4 (index 3)
// Unit is capturing group 5 (index 4)
const heightStringRegex = /(\d+)\s*((-|to)\s*(\d+))?\s*(feet|ft|foot|inches|in|inch)/i;

/**
 * @param {string} heightString - ie, "5 feet", "2-5 feet", "6-12 inches"
 * @returns {[number,number] | null} The low and high values parsed from the height string in inches, or null if the input couldn't be parsed
 */
export const heightStringToInches = (heightString) => {
  const [, low, , , high = low, unit] = heightString.match(heightStringRegex);

  if (unit === "feet" || unit === "ft" || unit === "foot") {
    return [parseInt(low, 10) * 12, parseInt(high, 10) * 12];
  } else if (unit === "inches" || unit === "in" || unit === "inch") {
    return [parseInt(low, 10), parseInt(high, 10)];
  }

  console.log("Unable to parse height string:", heightString);

  return null; // Unable to parse
}