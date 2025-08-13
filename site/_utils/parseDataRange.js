/**
 * @import {OneThroughFive} from "../types/plantData";
 */

/**
 * @param {OneThroughFive | `${OneThroughFive}` | `${OneThroughFive}-${OneThroughFive}`} rawDataRangeValue 
 * @returns { [low: number, high: number] | null }
 */
export const parseDataRange = (rawDataRangeValue) => {
  if (typeof rawDataRangeValue === "number") {
    const v = rawDataRangeValue;
    if (v < 1 || v > 5) {
      return null;
    }
    return [v, v];
  }

  const [lowStr, highStr] = rawDataRangeValue.split("-").map((s) => s.trim());
  if (!highStr) {
    const v = parseInt(lowStr, 10);
    if (Number.isNaN(v) || v < 1 || v > 5) {
      return null;
    }
    return [v, v];
  }

  const low = parseInt(lowStr, 10);
  const high = parseInt(highStr, 10);
  if (Number.isNaN(low) || Number.isNaN(high) || low < 1 || high > 5 || low > high) {
    return null;
  }
  return [low, high];
};