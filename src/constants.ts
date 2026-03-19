// Shared constants used across the plugin

// Layout
export var DESKTOP_WIDTH = 1440;
export var PAGE_PADDING = 80;
export var SECTION_GAP = 80;
export var MOBILE_BREAKPOINT = 567;
export var DEFAULT_RADIUS = 8;

// Standard export settings for generated image nodes (1x + 2x)
export var STANDARD_EXPORT_SETTINGS = [
  { format: "PNG", suffix: "", constraint: { type: "SCALE", value: 1 } },
  { format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } }
];
