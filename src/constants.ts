// Shared constants used across the plugin

// Layout
export const DESKTOP_WIDTH = 1440;
export const PAGE_PADDING = 80;
export const SECTION_GAP = 80;
export const MOBILE_BREAKPOINT = 567;
export const DEFAULT_RADIUS = 8;

// Standard export settings for generated image nodes (1x + 2x)
export const STANDARD_EXPORT_SETTINGS = [
  { format: "PNG", suffix: "", constraint: { type: "SCALE", value: 1 } },
  { format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } }
];
