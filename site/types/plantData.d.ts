export type Month = "January" | "February" | "March" | "April" | "May" | "June" | "July" | "August" | "September" | "October" | "November" | "December";

export type OneThroughFive = 1 | 2 | 3 | 4 | 5;

export type USStateAbbreviation = "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "FL" | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME" | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH" | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI" | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI" | "WY";
export type CAProvinceAbbreviation = "AB" | "BC" | "MB" | "NB" | "NL" | "NT" | "NS" | "NU" | "ON" | "PE" | "QC" | "SK" | "YT";

interface EleventyImageData {
  format: "webp" | "jpeg";
  width: number;
  height: number;
  url: string;
  sourceType: string;
  srcset: string;
  filename: string;
  outputPath: string;
  size: number;
}

interface ImageMetadata {
  license: string;
  creatorName: string;
  alt: string;
  creatorURL?: string;
  sourceURL?: string;
}

export interface ImageData {
  jpeg: EleventyImageData[];
  webp: EleventyImageData[];
  meta: ImageMetadata;
}

export interface BloomColor {
  /**
   * Human-readable name of the color.
   */
  name: string;
  /**
   * Hex color code representing the bloom color for previewing.
   */
  hex: `#${string}`;
}

export interface PlantData {
  scientific_name: string;
  common_names: string[];
  life_cycle: "Perennial" | "Annual" | "Biennial";
  /**
   * Object describing the range of months when the plant blooms.
   * May not be present if the plant does not bloom or if the bloom time is not known.
   */
  bloom_time?: {
    start: Month;
    end: Month;
  };
  /**
   * Object describing the plant's bloom color
   * May not be present if the plant does not bloom or if the color is not known.
   * May be a single color or an array of colors if the plant has multiple notable bloom colors.
   * (ie, Wild Columbine flowers are primarily red, but also have notable yellow accents)
   */
  bloom_color?: BloomColor | BloomColor[];
  /**
   * Generally in format of "[number or dash-separated range] [feet|inches]", ie "3 feet", "4-8 inches"
   */
  height: string;
  /**
   * Number or dash-separated range, scale is 1-5 where 1 is full shade and 5 is full sun
   */
  light: OneThroughFive | `${OneThroughFive}` | `${OneThroughFive}-${OneThroughFive}`;
  /**
   * Number or dash-separated range, scale is 1-5 where 1 is dry and 5 is wet
   */
  moisture: OneThroughFive | `${OneThroughFive}` | `${OneThroughFive}-${OneThroughFive}`;
  /**
   * State/province distribution data from USDA Plants database data for US and Canada
   */
  distribution: {
    US?: USStateAbbreviation[];
    CA?: CAProvinceAbbreviation[];
  };
  images: ImageData[];
}