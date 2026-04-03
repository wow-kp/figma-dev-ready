// Token data generation

// ── Color math (ES5) ─────────────────────────────────────────────────────────
export function hexToRgb255(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return {
    r: parseInt(h.slice(0,2), 16),
    g: parseInt(h.slice(2,4), 16),
    b: parseInt(h.slice(4,6), 16)
  };
}

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

export function hslToRgb01(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

export function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Generate 10-shade palette from a base hue/saturation
// Lightness curve: 50=97, 100=93, 200=86, 300=75, 400=62, 500=50, 600=42, 700=33, 800=24, 900=15
export function generateShadeScale(h, s, baseL) {
  const SHADES = ["50","100","200","300","400","500","600","700","800","900"];
  const TARGET_L = [97, 93, 86, 75, 62, 50, 42, 33, 24, 15];
  // Shift curve so input lightness lands at shade 500
  const delta = baseL - 50;
  const SAT_CURVE = [0.3, 0.4, 0.55, 0.7, 0.85, 1.0, 0.95, 0.9, 0.85, 0.8];
  const result = {};
  for (let i = 0; i < SHADES.length; i++) {
    const tl = clamp(TARGET_L[i] + delta * (1 - Math.abs(i - 5) / 5), 3, 98);
    const ts = clamp(s * SAT_CURVE[i], 0, 100);
    const rgb = hslToRgb01(h, ts, tl);
    result[SHADES[i]] = { "$type": "color", "$value": { colorSpace: "srgb", components: [rgb[0], rgb[1], rgb[2]], alpha: 1 } };
  }
  return result;
}

// ── Default palettes (Tailwind-inspired) ─────────────────────────────────────
export const DEFAULT_PALETTES = {
  purple: { h: 271, s: 81, l: 56 },
  green:  { h: 142, s: 71, l: 45 },
  red:    { h: 0,   s: 84, l: 60 },
  amber:  { h: 38,  s: 92, l: 50 },
  gray:   { h: 220, s: 9,  l: 46 }
};

function hexToHsl(hex) {
  const rgb = hexToRgb255(hex);
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

export function generateColorTokens(colorOpts) {
  const data = {};

  // User-defined brand colors (raw hex, no shades)
  data.primary = makeColorHex(colorOpts.primary);
  if (colorOpts.secondary) data.secondary = makeColorHex(colorOpts.secondary);
  if (colorOpts.tertiary) data.tertiary = makeColorHex(colorOpts.tertiary);

  // Custom user-defined colors
  if (colorOpts.custom?.length) {
    for (let ci = 0; ci < colorOpts.custom.length; ci++) {
      const cc = colorOpts.custom[ci];
      if (cc.name && cc.hex) {
        const safeKey = cc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (safeKey) data[safeKey] = makeColorHex(cc.hex);
      }
    }
  }

  // Auto-include defaults if not already defined by user
  const hasCustom = function(name) {
    if (!colorOpts.custom) return false;
    for (let i = 0; i < colorOpts.custom.length; i++) {
      const k = colorOpts.custom[i].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (k === name) return true;
    }
    return false;
  };

  // Black, white, gray — auto-included unless user defined them
  if (!hasCustom("black")) data.black = makeColorHex("#000000");
  if (!hasCustom("white")) data.white = makeColorHex("#FFFFFF");
  if (!hasCustom("gray"))  data.gray  = makeColorHex("#E3E3E3");

  // Focus & error tokens — auto-included unless user defined them
  data.focus = {
    border: makeColorHex("#000000"),
    color:  makeColorHex("#79797B")
  };
  data.error = {
    border: makeColorHex("#E32E22"),
    color:  makeColorHex("#E32E22")
  };

  return data;
}

function makeColor(r, g, b) {
  return { "$type": "color", "$value": { colorSpace: "srgb", components: [r, g, b], alpha: 1 } };
}

function makeColorHex(hex) {
  const c = hexToRgb255(hex);
  return makeColor(c.r / 255, c.g / 255, c.b / 255);
}

function makeColorHSL(h, s, l) {
  const rgb = hslToRgb01(h, s, l);
  return { "$type": "color", "$value": { colorSpace: "srgb", components: rgb, alpha: 1 } };
}

export function generateSemanticColors(colorOpts) {
  const pri = hexToHsl(colorOpts.primary);
  const h = pri.h, s = pri.s;

  const result = {
    brand: {
      primary: makeColorHSL(h, s, 50)
    },
    text: {
      primary: colorOpts.textColor ? makeColorHex(colorOpts.textColor) : makeColorHSL(h, 10, 10)
    },
    border: {
      "default": makeColorHex("#E3E3E3")
    },
    overlay: {
      scrim: { "$type": "color", "$value": { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.85 } }
    }
  };

  // Only include secondary/tertiary brand colors if user explicitly set them
  if (colorOpts.secondary) {
    const sec = hexToHsl(colorOpts.secondary);
    result.brand.secondary = makeColorHSL(sec.h, sec.s, 55);
  }
  if (colorOpts.tertiary) {
    const ter = hexToHsl(colorOpts.tertiary);
    result.brand.accent = makeColorHSL(ter.h, ter.s, 50);
  }

  return result;
}

export function generateSpacingData(spacingList) {
  const tokens = {};
  for (let i = 0; i < spacingList.length; i++) {
    const s = spacingList[i];
    if (s.name) {
      tokens[s.name] = { "$type": "dimension", "$value": { value: parseFloat(s.value) || 0, unit: "px" } };
    }
  }
  return tokens;
}

export function generateRadiusData(radiusList) {
  const tokens = {};
  for (let i = 0; i < radiusList.length; i++) {
    const r = radiusList[i];
    if (r.name) {
      tokens[r.name] = { "$type": "dimension", "$value": { value: parseFloat(r.value) || 0, unit: "px" } };
    }
  }
  return tokens;
}

export function generateBorderData(bordersList) {
  const tokens = {};
  for (let i = 0; i < bordersList.length; i++) {
    const b = bordersList[i];
    if (b.name) {
      tokens[b.name] = { "$type": "dimension", "$value": { value: parseFloat(b.value) || 0, unit: "px" } };
    }
  }
  return tokens;
}

export function generateOpacityData() {
  const tokens = {};
  tokens[0] = { "$type": "number", "$value": 0 };
  for (let i = 5; i <= 95; i += 5) {
    tokens[i] = { "$type": "number", "$value": i / 100 };
  }
  tokens[100] = { "$type": "number", "$value": 1 };
  return tokens;
}

export function generateShadowsData(shadowsList) {
  const tokens = {};
  for (let i = 0; i < shadowsList.length; i++) {
    const s = shadowsList[i];
    if (s.name) {
      tokens[s.name] = { "$type": "string", "$value": s.value || "" };
    }
  }
  return tokens;
}

export function generateZIndexData(zindexList) {
  const tokens = {};
  for (let i = 0; i < zindexList.length; i++) {
    const z = zindexList[i];
    if (z.name) {
      tokens[z.name] = { "$type": "number", "$value": parseFloat(z.value) || 0 };
    }
  }
  return tokens;
}

export function generateBreakpointsData() {
  return {
    xs:   { "$type": "number", "$value": 0 },
    sm:   { "$type": "number", "$value": 567 },
    md:   { "$type": "number", "$value": 767 },
    lg:   { "$type": "number", "$value": 991 }
  };
}

export function generateGridData() {
  // 12-column grid system with 4 breakpoints
  // xs: 4 cols, 16px gutter, 16px margin
  // sm: 8 cols, 16px gutter, 24px margin
  // md: 12 cols, 24px gutter, 32px margin
  // lg: 12 cols, 32px gutter, auto margin (0 = auto)
  const data = {
    "grid/columns":   { xs: 4,  sm: 8,  md: 12, lg: 12 },
    "grid/gutter":    { xs: 16, sm: 16, md: 24, lg: 32 },
    "grid/margin":    { xs: 16, sm: 24, md: 32, lg: 0 }
  };
  // Column span widths as percentages of container (span / totalCols * 100)
  // These represent the fractional width each span occupies
  for (let span = 1; span <= 12; span++) {
    const key = "grid/col-" + span;
    data[key] = {
      xs: Math.round((span / 4)  * 10000) / 100,  // % of 4-col grid
      sm: Math.round((span / 8)  * 10000) / 100,  // % of 8-col grid
      md: Math.round((span / 12) * 10000) / 100,  // % of 12-col grid
      lg: Math.round((span / 12) * 10000) / 100   // % of 12-col grid
    };
  }
  return data;
}

export function generateTypographyData(typo, fontFamilies) {
  const t = { family: {}, size: {}, weight: {}, "line-height": {} };

  // Font families from the text styles config (dynamic — supports any number)
  const famKeys = Object.keys(fontFamilies || {});
  for (let fki = 0; fki < famKeys.length; fki++) {
    if (fontFamilies[famKeys[fki]]) t.family[famKeys[fki]] = { "$type": "fontFamily", "$value": fontFamilies[famKeys[fki]] };
  }

  for (let i = 0; i < typo.sizes.length; i++) {
    const s = typo.sizes[i];
    if (s.name) t.size[s.name] = { "$type": "dimension", "$value": { value: parseFloat(s.value) || 0, unit: "px" } };
  }
  for (let j = 0; j < typo.weights.length; j++) {
    const w = typo.weights[j];
    if (w.name) t.weight[w.name] = { "$type": "number", "$value": parseFloat(w.value) || 0 };
  }
  for (let k = 0; k < typo.lineHeights.length; k++) {
    const l = typo.lineHeights[k];
    if (l.name) t["line-height"][l.name] = { "$type": "number", "$value": parseFloat(l.value) || 0 };
  }
  return t;
}

export function generateTextStylesData(textStyles) {
  const data = {};
  for (let i = 0; i < textStyles.length; i++) {
    const s = textStyles[i];
    const group = s.group || "body";
    const name = s.name || "default";
    if (!data[group]) data[group] = {};
    data[group][name] = {
      "$type": "textStyle",
      "$value": {
        fontFamily: s.fontFamily || "Inter, sans-serif",
        fontSize: { value: parseFloat(s.fontSize) || 16, unit: "px" },
        fontWeight: parseFloat(s.fontWeight) || 400,
        lineHeight: { value: parseFloat(s.lineHeight) || 1.5, unit: "MULTIPLIER" },
        letterSpacing: { value: parseFloat(s.letterSpacing) || 0, unit: "px" },
        paragraphSpacing: { value: parseFloat(s.paragraphSpacing) || 0, unit: "px" }
      }
    };
  }
  return data;
}

// ── Router ───────────────────────────────────────────────────────────────────
export function generateTokenData(category, colorOpts, textStylesData, spacingData, radiusData, shadowsData, bordersData, zindexData, typographyData, fontFamilies) {
  // Normalize: if a plain string is passed, wrap it
  if (typeof colorOpts === "string") colorOpts = { primary: colorOpts, secondary: "", tertiary: "" };
  switch (category) {
    case "colors":       return { filename: "colors.json",       data: generateColorTokens(colorOpts) };
    case "colors-light": return { filename: "colors-light.json", data: generateSemanticColors(colorOpts) };
    case "typography":   return { filename: "typography.json",   data: generateTypographyData(typographyData, fontFamilies) };
    case "spacing":      return { filename: "spacing.json",      data: generateSpacingData(spacingData) };
    case "text-styles":  return { filename: "text-styles.json",  data: generateTextStylesData(textStylesData) };
    case "radius":       return { filename: "radius.json",       data: generateRadiusData(radiusData) };
    case "border":       return { filename: "border.json",       data: generateBorderData(bordersData) };
    case "opacity":      return { filename: "opacity.json",      data: generateOpacityData() };
    case "shadows":      return { filename: "shadows.json",      data: generateShadowsData(shadowsData) };
    case "zindex":       return { filename: "z-index.json",      data: generateZIndexData(zindexData) };
    case "breakpoints":  return { filename: "breakpoints.json",  data: generateBreakpointsData() };
    case "grid":         return { filename: "grid.json",         data: generateGridData() };
    default: throw new Error("Unknown generator category: " + category);
  }
}
