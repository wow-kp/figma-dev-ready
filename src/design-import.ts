// Design Import — Route B: analyze existing designs and convert to plugin structure
import { findPageByHint, rgb01ToHex } from './utils';
import { hexToRgb255, rgbToHsl, hslToRgb01, generateSpacingData, generateRadiusData, generateBorderData, generateShadowsData, generateOpacityData, generateBreakpointsData, generateGridData, generateTypographyData, generateTextStylesData, generateColorTokens } from './tokens-generate';
import { findOrCreateCollection, getOrCreateVar, buildVarMap, importColors, importFlat, importTextStyles, importShadows, importTypography, importOpacity, importGrid } from './tokens-import';
import { findNearestColorVar, findNearestFloatVar, colorDist, getVarFloat, getVarColor } from './audit';

// ── Types ────────────────────────────────────────────────────────────────────

interface ColorEntry {
  r: number; g: number; b: number;
  hex: string;
  count: number;
  h: number; s: number; l: number;
  name: string;
}

interface SpacingEntry { name: string; value: number; count: number; }
interface RadiusEntry  { name: string; value: number; count: number; }
interface BorderEntry  { name: string; value: number; count: number; }
interface ShadowEntry  { name: string; value: string; count: number; }

interface TypoCombo {
  fontFamily: string; fontStyle: string; fontSize: number; fontWeight: number;
  lineHeight: number; letterSpacing: number; letterSpacingUnit: string;
  textDecoration: string; textCase: string; paragraphSpacing: number;
  count: number; sampleText: string;
  group: string; name: string;
}

interface FrameInfo {
  nodeId: string; name: string; width: number; height: number;
  pageId: string; pageName: string;
  classification: "desktop" | "mobile" | "component" | "other";
}

interface ScaleEntry { name: string; value: number; }

export interface TypographyScale {
  sizes: ScaleEntry[];
  weights: ScaleEntry[];
  lineHeights: ScaleEntry[];
}

export interface AnalysisResult {
  colors: ColorEntry[];
  spacing: SpacingEntry[];
  radius: RadiusEntry[];
  borders: BorderEntry[];
  shadows: ShadowEntry[];
  typography: TypoCombo[];
  typographyScale: TypographyScale;
  fontFamilies: { [key: string]: string };
  frames: FrameInfo[];
  totalNodes: number;
  pagesAnalyzed: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 567;
const DESKTOP_MIN_WIDTH = 900;
const MIN_PAGE_HEIGHT = 400;

const SPACING_NAMES = ["4xs", "3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
const RADIUS_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "full"];
const BORDER_NAMES = ["thin", "default", "medium", "thick"];
const SHADOW_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl"];

// Map font style name to numeric weight
// Map font style name to approximate numeric weight (used for heuristic grouping only).
// The exact style name (fontStyle) is preserved separately for accurate font loading.
function styleToWeight(style: string): number {
  // Strip width prefixes (SemiExpanded, Expanded, Condensed, etc.) to isolate weight name
  const s = (style || "Regular").toLowerCase()
    .replace(/\b(semi\s*expanded|expanded|semi\s*condensed|condensed|compressed|narrow|wide)\b/g, "")
    .replace(/\bitalic\b/g, "")
    .replace(/\boblique\b/g, "")
    .trim();
  if (s.indexOf("thin") !== -1 || s.indexOf("hairline") !== -1) return 100;
  if (s.indexOf("extralight") !== -1 || s.indexOf("extra light") !== -1 || s.indexOf("ultralight") !== -1 || s.indexOf("ultra light") !== -1) return 200;
  if (s.indexOf("light") !== -1) return 300;
  if (s.indexOf("book") !== -1) return 350;
  if (s.indexOf("semibold") !== -1 || s.indexOf("semi bold") !== -1 || s.indexOf("demibold") !== -1 || s.indexOf("demi bold") !== -1 || s.indexOf("demi") !== -1) return 600;
  if (s.indexOf("extrabold") !== -1 || s.indexOf("extra bold") !== -1 || s.indexOf("ultrabold") !== -1 || s.indexOf("ultra bold") !== -1) return 800;
  if (s.indexOf("black") !== -1 || s.indexOf("heavy") !== -1) return 900;
  if (s.indexOf("bold") !== -1) return 700;
  if (s.indexOf("medium") !== -1 || s.indexOf("middle") !== -1) return 500;
  return 400;
}

// Named hue ranges for auto-naming colors
const HUE_NAMES: [number, number, string][] = [
  [0, 15, "red"], [15, 40, "orange"], [40, 65, "amber"], [65, 80, "yellow"],
  [80, 150, "green"], [150, 180, "teal"], [180, 210, "cyan"],
  [210, 260, "blue"], [260, 290, "violet"], [290, 330, "purple"],
  [330, 360, "red"]
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function figmaColorToHex(c: {r:number, g:number, b:number}): string {
  return rgb01ToHex(c.r, c.g, c.b);
}

function colorDistRgb(a: {r:number,g:number,b:number}, b: {r:number,g:number,b:number}): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}

function hueToName(h: number): string {
  for (let i = 0; i < HUE_NAMES.length; i++) {
    if (h >= HUE_NAMES[i][0] && h < HUE_NAMES[i][1]) return HUE_NAMES[i][2];
  }
  return "color";
}

function makeColorDTCG(r: number, g: number, b: number) {
  return { "$type": "color", "$value": { colorSpace: "srgb", components: [r, g, b], alpha: 1 } };
}

function shadowToCSS(e: Effect): string | null {
  if (e.type !== "DROP_SHADOW" && e.type !== "INNER_SHADOW") return null;
  const s = e as DropShadowEffect;
  const r = Math.round((s.color.r || 0) * 255);
  const g = Math.round((s.color.g || 0) * 255);
  const b = Math.round((s.color.b || 0) * 255);
  const a = Math.round((s.color.a !== undefined ? s.color.a : 1) * 100) / 100;
  const prefix = e.type === "INNER_SHADOW" ? "inset " : "";
  return prefix + (s.offset.x || 0) + "px " + (s.offset.y || 0) + "px " + (s.spread || 0) + "px " + (s.radius || 0) + "px rgba(" + r + "," + g + "," + b + "," + a + ")";
}

// ── Node-level extraction helpers ───────────────────────────────────────────

function addColor(c: {r:number, g:number, b:number}, colorMap: {[hex:string]: ColorEntry}) {
  const hex = figmaColorToHex(c);
  if (colorMap[hex]) { colorMap[hex].count++; return; }
  const keys = Object.keys(colorMap);
  for (let i = 0; i < keys.length; i++) {
    const existing = colorMap[keys[i]];
    if (colorDistRgb(c, {r: existing.r, g: existing.g, b: existing.b}) < 0.02) {
      existing.count++;
      return;
    }
  }
  const rgb255 = { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
  const hsl = rgbToHsl(rgb255.r, rgb255.g, rgb255.b);
  colorMap[hex] = { r: c.r, g: c.g, b: c.b, hex: hex, count: 1, h: hsl.h, s: hsl.s, l: hsl.l, name: "" };
}

function extractColorsFromNode(node: SceneNode, colorMap: {[hex:string]: ColorEntry}) {
  if ("fills" in node && Array.isArray(node.fills)) {
    for (let fi = 0; fi < node.fills.length; fi++) {
      const fill = node.fills[fi];
      if (fill.type === "SOLID" && fill.visible !== false) {
        addColor(fill.color, colorMap);
      }
    }
  }
  if ("strokes" in node && Array.isArray(node.strokes)) {
    for (let si = 0; si < node.strokes.length; si++) {
      const stroke = node.strokes[si];
      if (stroke.type === "SOLID" && stroke.visible !== false) {
        addColor(stroke.color, colorMap);
      }
    }
  }
}

function extractSpacingFromAutoLayout(node: SceneNode, spacingMap: {[val:string]: number}) {
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    const f = node as FrameNode;
    const spacingProps = [f.paddingLeft, f.paddingRight, f.paddingTop, f.paddingBottom, f.itemSpacing];
    if (typeof (f as any).counterAxisSpacing === "number" && (f as any).counterAxisSpacing > 0) {
      spacingProps.push((f as any).counterAxisSpacing);
    }
    for (let spi = 0; spi < spacingProps.length; spi++) {
      const sv = spacingProps[spi];
      if (typeof sv === "number" && sv > 0) {
        const svk = String(Math.round(sv));
        spacingMap[svk] = (spacingMap[svk] || 0) + 1;
      }
    }
  }
}

function extractSpacingFromPositionalGaps(node: SceneNode, spacingMap: {[val:string]: number}) {
  if (!("children" in node) || !((node as any).children?.length > 1)) return;
  const isAutoLayout = "layoutMode" in node && (node as FrameNode).layoutMode !== "NONE";
  if (isAutoLayout || !("width" in node) || !("height" in node)) return;

  const children = (node as any).children as SceneNode[];
  const visibleChildren: SceneNode[] = [];
  for (let vci = 0; vci < children.length; vci++) {
    if (children[vci].visible !== false && "x" in children[vci] && "y" in children[vci]) {
      visibleChildren.push(children[vci]);
    }
  }
  if (visibleChildren.length < 2) return;

  const sortedY = visibleChildren.slice().sort(function(a, b) { return (a as any).y - (b as any).y; });
  const sortedX = visibleChildren.slice().sort(function(a, b) { return (a as any).x - (b as any).x; });

  for (let gi = 1; gi < sortedY.length; gi++) {
    const prevBottom = (sortedY[gi - 1] as any).y + (sortedY[gi - 1] as any).height;
    const curTop = (sortedY[gi] as any).y;
    const gap = Math.round(curTop - prevBottom);
    if (gap > 0 && gap <= 200) {
      spacingMap[String(gap)] = (spacingMap[String(gap)] || 0) + 1;
    }
  }

  for (let gj = 1; gj < sortedX.length; gj++) {
    const prevRight = (sortedX[gj - 1] as any).x + (sortedX[gj - 1] as any).width;
    const curLeft = (sortedX[gj] as any).x;
    const hgap = Math.round(curLeft - prevRight);
    if (hgap > 0 && hgap <= 200) {
      spacingMap[String(hgap)] = (spacingMap[String(hgap)] || 0) + 1;
    }
  }

  if ("width" in node && "height" in node) {
    const fw = (node as any).width, fh = (node as any).height;
    let minX = Infinity, minY = Infinity, maxR = 0, maxB = 0;
    for (let pi = 0; pi < visibleChildren.length; pi++) {
      const vc = visibleChildren[pi] as any;
      if (vc.x < minX) minX = vc.x;
      if (vc.y < minY) minY = vc.y;
      if (vc.x + vc.width > maxR) maxR = vc.x + vc.width;
      if (vc.y + vc.height > maxB) maxB = vc.y + vc.height;
    }
    const paddings = [Math.round(minX), Math.round(minY), Math.round(fw - maxR), Math.round(fh - maxB)];
    for (let pdi = 0; pdi < paddings.length; pdi++) {
      const pd = paddings[pdi];
      if (pd > 0 && pd <= 200) {
        spacingMap[String(pd)] = (spacingMap[String(pd)] || 0) + 1;
      }
    }
  }
}

function extractRadiusFromNode(node: SceneNode, radiusMap: {[val:string]: number}) {
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    const rk = String(Math.round(node.cornerRadius));
    radiusMap[rk] = (radiusMap[rk] || 0) + 1;
  }
}

function extractBorderFromNode(node: SceneNode, borderMap: {[val:string]: number}) {
  if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) {
    if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.some(function(s: Paint) { return s.visible !== false; })) {
      const bk = String(Math.round(node.strokeWeight as number));
      borderMap[bk] = (borderMap[bk] || 0) + 1;
    }
  }
}

function extractShadowsFromNode(node: SceneNode, shadowMap: {[css:string]: number}) {
  if ("effects" in node && node.effects?.length > 0) {
    for (let ei = 0; ei < node.effects.length; ei++) {
      const css = shadowToCSS(node.effects[ei]);
      if (css) {
        shadowMap[css] = (shadowMap[css] || 0) + 1;
      }
    }
  }
}

function extractTypographyFromNode(
  node: SceneNode,
  typoMap: {[key:string]: TypoCombo},
  fontFamilyCount: {[fam:string]: number}
) {
  if (node.type !== "TEXT") return;
  const tn = node as TextNode;
  const fs = tn.fontSize;
  const fn = tn.fontName;
  if (typeof fs !== "number" || !fn || typeof fn !== "object" || !("family" in fn)) return;

  const fontStyleName = (fn.style || "Regular");
  const fw = (typeof (tn as any).fontWeight === "number") ? (tn as any).fontWeight : styleToWeight(fontStyleName);

  let lh = 0;
  if (tn.lineHeight && typeof tn.lineHeight === "object" && "value" in tn.lineHeight) {
    const lhObj = tn.lineHeight as { value: number; unit: string };
    if (lhObj.unit === "PIXELS") lh = lhObj.value;
    else if (lhObj.unit === "PERCENT") lh = (lhObj.value / 100) * fs;
    else lh = fs * 1.5;
  } else {
    lh = fs * 1.5;
  }

  let ls = 0;
  let lsUnit = "px";
  if (tn.letterSpacing && typeof tn.letterSpacing === "object" && "value" in tn.letterSpacing) {
    const lsObj = tn.letterSpacing as { value: number; unit: string };
    ls = lsObj.value || 0;
    if (lsObj.unit === "PERCENT") lsUnit = "percent";
  }

  let td = "NONE";
  if (typeof tn.textDecoration === "string") td = tn.textDecoration;

  let tc = "ORIGINAL";
  if (typeof tn.textCase === "string") tc = tn.textCase;

  let ps = 0;
  if (typeof tn.paragraphSpacing === "number") ps = tn.paragraphSpacing;

  const comboKey = fn.family + "/" + fontStyleName + "/" + fs + "/" + td + "/" + tc;
  fontFamilyCount[fn.family] = (fontFamilyCount[fn.family] || 0) + 1;

  if (typoMap[comboKey]) {
    typoMap[comboKey].count++;
  } else {
    const sample = (tn.characters || "").substring(0, 40);
    typoMap[comboKey] = {
      fontFamily: fn.family, fontStyle: fontStyleName, fontSize: fs, fontWeight: fw,
      lineHeight: Math.round(lh * 10) / 10,
      letterSpacing: Math.round(ls * 100) / 100, letterSpacingUnit: lsUnit,
      textDecoration: td, textCase: tc, paragraphSpacing: ps,
      count: 1, sampleText: sample,
      group: "", name: ""
    };
  }
}

// ── Frame classification ────────────────────────────────────────────────────

function classifyFrame(topNode: SceneNode): "desktop" | "mobile" | "component" | "other" {
  if (topNode.type === "COMPONENT" || topNode.type === "COMPONENT_SET") {
    return "component";
  } else if (topNode.width > DESKTOP_MIN_WIDTH && topNode.height >= MIN_PAGE_HEIGHT) {
    return "desktop";
  } else if (topNode.width <= MOBILE_BREAKPOINT && topNode.height >= MIN_PAGE_HEIGHT) {
    return "mobile";
  } else if (topNode.height < MIN_PAGE_HEIGHT) {
    return "component";
  }
  return "other";
}

// ── Post-processing helpers ─────────────────────────────────────────────────

function processSpacingMap(spacingMap: {[val:string]: number}): SpacingEntry[] {
  const spacingEntries = Object.keys(spacingMap).map(function(k) {
    return { value: parseInt(k, 10), count: spacingMap[k] };
  });
  spacingEntries.sort(function(a, b) { return a.value - b.value; });
  const spacingDeduped: typeof spacingEntries = [];
  for (let sdi = 0; sdi < spacingEntries.length; sdi++) {
    const se = spacingEntries[sdi];
    let merged = false;
    for (let sdj = 0; sdj < spacingDeduped.length; sdj++) {
      if (Math.abs(spacingDeduped[sdj].value - se.value) <= 2) {
        if (se.count > spacingDeduped[sdj].count) spacingDeduped[sdj].value = se.value;
        spacingDeduped[sdj].count += se.count;
        merged = true; break;
      }
    }
    if (!merged) spacingDeduped.push({ value: se.value, count: se.count });
  }
  spacingDeduped.sort(function(a, b) { return b.count - a.count; });
  const topSpacing = spacingDeduped.slice(0, 12);
  topSpacing.sort(function(a, b) { return a.value - b.value; });
  const spacing: SpacingEntry[] = [];
  for (let tsi = 0; tsi < topSpacing.length; tsi++) {
    const sName = tsi < SPACING_NAMES.length ? SPACING_NAMES[tsi] : String(topSpacing[tsi].value);
    spacing.push({ name: sName, value: topSpacing[tsi].value, count: topSpacing[tsi].count });
  }
  return spacing;
}

function processRadiusMap(radiusMap: {[val:string]: number}): RadiusEntry[] {
  const radiusEntries = Object.keys(radiusMap).map(function(k) {
    return { value: parseInt(k, 10), count: radiusMap[k] };
  });
  radiusEntries.sort(function(a, b) { return a.value - b.value; });
  const radius: RadiusEntry[] = [];
  for (let ri = 0; ri < radiusEntries.length; ri++) {
    let rName: string;
    if (radiusEntries[ri].value >= 999) rName = "full";
    else rName = ri < RADIUS_NAMES.length ? RADIUS_NAMES[ri] : "r-" + radiusEntries[ri].value;
    radius.push({ name: rName, value: radiusEntries[ri].value, count: radiusEntries[ri].count });
  }
  return radius;
}

function processBorderMap(borderMap: {[val:string]: number}): BorderEntry[] {
  const borderEntries = Object.keys(borderMap).map(function(k) {
    return { value: parseInt(k, 10), count: borderMap[k] };
  });
  borderEntries.sort(function(a, b) { return a.value - b.value; });
  const borders: BorderEntry[] = [];
  for (let bi = 0; bi < borderEntries.length; bi++) {
    const bName = bi < BORDER_NAMES.length ? BORDER_NAMES[bi] : "b-" + borderEntries[bi].value;
    borders.push({ name: bName, value: borderEntries[bi].value, count: borderEntries[bi].count });
  }
  return borders;
}

function processShadowMap(shadowMap: {[css:string]: number}): ShadowEntry[] {
  const shadowEntries = Object.keys(shadowMap).map(function(k) {
    return { css: k, count: shadowMap[k] };
  });
  shadowEntries.sort(function(a, b) {
    const ay = parseInt(a.css.split("px")[1] || "0", 10) || 0;
    const by = parseInt(b.css.split("px")[1] || "0", 10) || 0;
    return ay - by;
  });
  const shadows: ShadowEntry[] = [];
  for (let shi = 0; shi < shadowEntries.length; shi++) {
    const shName = shi < SHADOW_NAMES.length ? SHADOW_NAMES[shi] : "shadow-" + (shi + 1);
    shadows.push({ name: shName, value: shadowEntries[shi].css, count: shadowEntries[shi].count });
  }
  return shadows;
}

function deriveFontFamilies(typography: TypoCombo[]): { [key: string]: string } {
  const typoFamCount: { [fam: string]: number } = {};
  for (let tfi = 0; tfi < typography.length; tfi++) {
    const tf = typography[tfi].fontFamily;
    typoFamCount[tf] = (typoFamCount[tf] || 0) + typography[tfi].count;
  }
  const famEntries = Object.keys(typoFamCount).map(function(k) { return { name: k, count: typoFamCount[k] }; });
  famEntries.sort(function(a, b) { return b.count - a.count; });
  const famRoleNames = ["primary", "secondary", "tertiary"];
  const fontFamilies: { [key: string]: string } = {};
  for (let ffi = 0; ffi < famEntries.length; ffi++) {
    const roleKey = ffi < famRoleNames.length ? famRoleNames[ffi] : "font-" + (ffi + 1);
    fontFamilies[roleKey] = famEntries[ffi].name;
  }
  if (!fontFamilies.primary) fontFamilies.primary = "Inter";
  return fontFamilies;
}

// ── Analysis Engine ──────────────────────────────────────────────────────────

export async function analyzeDesign(): Promise<AnalysisResult> {
  await figma.loadAllPagesAsync();
  const colorMap: {[hex:string]: ColorEntry} = {};
  const spacingMap: {[val:string]: number} = {};
  const radiusMap: {[val:string]: number} = {};
  const borderMap: {[val:string]: number} = {};
  const shadowMap: {[css:string]: number} = {};
  const typoMap: {[key:string]: TypoCombo} = {};
  const fontFamilyCount: {[fam:string]: number} = {};
  const frames: FrameInfo[] = [];
  let totalNodes = 0;

  // Skip these pages during analysis
  const skipHints = ["cover", "foundations", "components", "archive"];

  function shouldSkipPage(name: string): boolean {
    const norm = name.toLowerCase().replace(/[^a-z]/g, "");
    for (let i = 0; i < skipHints.length; i++) {
      if (norm.indexOf(skipHints[i]) !== -1) return true;
    }
    return false;
  }

  // Walk a single node
  function walkNode(node: SceneNode) {
    totalNodes++;
    extractColorsFromNode(node, colorMap);
    extractSpacingFromAutoLayout(node, spacingMap);
    extractSpacingFromPositionalGaps(node, spacingMap);
    extractRadiusFromNode(node, radiusMap);
    extractBorderFromNode(node, borderMap);
    extractShadowsFromNode(node, shadowMap);
    extractTypographyFromNode(node, typoMap, fontFamilyCount);

    // Recurse
    if ("children" in node && (node as any).children) {
      const ch = (node as any).children;
      for (let ci = 0; ci < ch.length; ci++) { walkNode(ch[ci]); }
    }
  }

  // Collect top-level frames from content pages
  let pagesAnalyzed = 0;
  for (let pi = 0; pi < figma.root.children.length; pi++) {
    const page = figma.root.children[pi];
    if (shouldSkipPage(page.name)) continue;
    if (page.children.length === 0) continue;
    pagesAnalyzed++;

    for (let fci = 0; fci < page.children.length; fci++) {
      const topNode = page.children[fci];

      // Classify top-level frames
      if (topNode.type === "FRAME" || topNode.type === "COMPONENT" || topNode.type === "COMPONENT_SET" || topNode.type === "SECTION") {
        frames.push({
          nodeId: topNode.id, name: topNode.name,
          width: Math.round(topNode.width), height: Math.round(topNode.height),
          pageId: page.id, pageName: page.name,
          classification: classifyFrame(topNode)
        });
      }

      // Walk for token extraction
      walkNode(topNode);
    }
  }

  // ── Process collected data ──

  // Colors: sort by frequency, auto-name
  const colors = Object.keys(colorMap).map(function(k) { return colorMap[k]; });
  colors.sort(function(a, b) { return b.count - a.count; });
  nameColors(colors);

  const spacing = processSpacingMap(spacingMap);
  const radius = processRadiusMap(radiusMap);
  const borders = processBorderMap(borderMap);
  const shadows = processShadowMap(shadowMap);

  // Typography: sort by frequency, auto-name
  const typography = Object.keys(typoMap).map(function(k) { return typoMap[k]; });
  typography.sort(function(a, b) { return b.count - a.count; });
  nameTypography(typography);

  const fontFamilies = deriveFontFamilies(typography);
  const typographyScale = deriveTypographyScale(typography);

  return {
    colors: colors, spacing: spacing, radius: radius, borders: borders,
    shadows: shadows, typography: typography, typographyScale: typographyScale,
    fontFamilies: fontFamilies, frames: frames, totalNodes: totalNodes, pagesAnalyzed: pagesAnalyzed
  };
}

function deriveTypographyScale(combos: TypoCombo[]): TypographyScale {
  const sizeSet: {[k:string]: number} = {};
  const weightSet: {[k:string]: number} = {};
  const lhSet: {[k:string]: number} = {};
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    sizeSet[String(c.fontSize)] = c.fontSize;
    weightSet[String(c.fontWeight)] = c.fontWeight;
    if (c.lineHeight > 0) {
      const lhRatio = Math.round((c.lineHeight / c.fontSize) * 100) / 100;
      lhSet[String(lhRatio)] = lhRatio;
    }
  }

  const DEFAULT_SIZE_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
  const WEIGHT_NAMES: {[k:string]: string} = { "100": "thin", "200": "extralight", "300": "light", "400": "regular", "500": "medium", "600": "semibold", "700": "bold", "800": "extrabold", "900": "black" };
  const LH_NAMES: [number, string][] = [[1.0, "none"], [1.15, "tight"], [1.3, "snug"], [1.5, "normal"], [1.65, "relaxed"], [2.0, "loose"]];

  const sizes = Object.keys(sizeSet).map(function(k) { return sizeSet[k]; }).sort(function(a, b) { return a - b; });
  const scSizes: ScaleEntry[] = sizes.map(function(v, idx) {
    return { value: v, name: idx < DEFAULT_SIZE_NAMES.length ? DEFAULT_SIZE_NAMES[idx] : "s-" + v };
  });

  const weights = Object.keys(weightSet).map(function(k) { return weightSet[k]; }).sort(function(a, b) { return a - b; });
  const scWeights: ScaleEntry[] = weights.map(function(v) {
    return { value: v, name: WEIGHT_NAMES[String(v)] || "w-" + v };
  });

  const lhVals = Object.keys(lhSet).map(function(k) { return lhSet[k]; }).sort(function(a, b) { return a - b; });
  const scLH: ScaleEntry[] = lhVals.map(function(v) {
    let name = "lh-" + v;
    for (let li = 0; li < LH_NAMES.length; li++) {
      if (Math.abs(v - LH_NAMES[li][0]) < 0.1) { name = LH_NAMES[li][1]; break; }
    }
    return { value: v, name: name };
  });

  return { sizes: scSizes, weights: scWeights, lineHeights: scLH };
}

// ── Color Naming ─────────────────────────────────────────────────────────────

function nameColors(colors: ColorEntry[]) {
  const usedNames: {[k:string]: boolean} = {};
  let primaryAssigned = false, secondaryAssigned = false, tertiaryAssigned = false;

  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];

    // Near-black
    if (c.l < 10 && c.s < 20) {
      c.name = usedNames["black"] ? "black-" + (i + 1) : "black";
      usedNames[c.name] = true;
      continue;
    }
    // Near-white
    if (c.l > 95) {
      c.name = usedNames["white"] ? "white-" + (i + 1) : "white";
      usedNames[c.name] = true;
      continue;
    }
    // Gray (low saturation)
    if (c.s < 15) {
      if (!usedNames["gray"]) { c.name = "gray"; }
      else {
        // Name by lightness shade
        const shade = Math.round(c.l / 10) * 100;
        c.name = "gray-" + shade;
      }
      usedNames[c.name] = true;
      continue;
    }

    // Chromatic colors: assign primary/secondary/tertiary first, then hue names
    if (!primaryAssigned) {
      c.name = "primary"; primaryAssigned = true;
    } else if (!secondaryAssigned) {
      c.name = "secondary"; secondaryAssigned = true;
    } else if (!tertiaryAssigned) {
      c.name = "tertiary"; tertiaryAssigned = true;
    } else {
      let hueName = hueToName(c.h);
      if (usedNames[hueName]) {
        // Append lightness qualifier
        const qual = c.l > 60 ? "light" : c.l < 35 ? "dark" : "mid";
        hueName = hueName + "-" + qual;
      }
      if (usedNames[hueName]) hueName = hueName + "-" + (i + 1);
      c.name = hueName;
    }
    usedNames[c.name] = true;
  }
}

// ── Typography Naming ────────────────────────────────────────────────────────

function nameTypography(combos: TypoCombo[]) {
  const usedNames: {[k:string]: boolean} = {};

  for (let i = 0; i < combos.length; i++) {
    const t = combos[i];
    let group = "body";
    let name = "default";

    if (t.fontSize >= 36 && t.fontWeight >= 600) { group = "heading"; name = "h1"; }
    else if (t.fontSize >= 28 && t.fontWeight >= 500) { group = "heading"; name = "h2"; }
    else if (t.fontSize >= 22 && t.fontWeight >= 500) { group = "heading"; name = "h3"; }
    else if (t.fontSize >= 18 && t.fontWeight >= 500) { group = "heading"; name = "h4"; }
    else if (t.fontSize >= 16 && t.fontWeight >= 600) { group = "heading"; name = "h5"; }
    else if (t.fontSize >= 16 && t.fontWeight < 500) { group = "body"; name = "lg"; }
    else if (t.fontSize >= 14 && t.fontWeight < 500) { group = "body"; name = "default"; }
    else if (t.fontSize >= 14 && t.fontWeight >= 500) { group = "label"; name = "default"; }
    else if (t.fontSize >= 12 && t.fontWeight < 500) { group = "body"; name = "sm"; }
    else if (t.fontSize >= 12 && t.fontWeight >= 500) { group = "label"; name = "sm"; }
    else if (t.fontSize >= 10) { group = "caption"; name = "default"; }
    else { group = "body"; name = "xs"; }

    let fullName = group + "/" + name;
    if (usedNames[fullName]) {
      // Append size to disambiguate
      fullName = group + "/" + name + "-" + Math.round(t.fontSize);
      if (usedNames[fullName]) fullName = group + "/" + Math.round(t.fontSize) + "-" + t.fontWeight;
    }
    usedNames[fullName] = true;
    t.group = group;
    t.name = name;
    // Store the disambiguated name parts back
    const parts = fullName.split("/");
    t.group = parts[0];
    t.name = parts[1];
  }
}

// ── Archive ──────────────────────────────────────────────────────────────────

export async function archiveExistingContent(): Promise<{ count: number; pageCount: number }> {
  await figma.loadAllPagesAsync();
  const archivePage = findPageByHint("archive");
  let count = 0;
  let pageCount = 0;

  for (let pi = 0; pi < figma.root.children.length; pi++) {
    const page = figma.root.children[pi];
    if (page.id === archivePage.id) continue;
    if (page.children.length === 0) continue;
    pageCount++;

    // Create a section frame for this page's content
    const section = figma.createFrame();
    section.name = "Original — " + page.name;
    section.layoutMode = "VERTICAL";
    section.primaryAxisSizingMode = "AUTO";
    section.counterAxisSizingMode = "AUTO";
    section.itemSpacing = 40;
    section.paddingTop = 40;
    section.paddingBottom = 40;
    section.paddingLeft = 40;
    section.paddingRight = 40;
    section.fills = [];
    archivePage.appendChild(section);

    // Clone all top-level children
    for (let ci = 0; ci < page.children.length; ci++) {
      try {
        const clone = page.children[ci].clone();
        section.appendChild(clone);
        count++;
      } catch (e) {
        // Skip nodes that can't be cloned
      }
    }
  }

  return { count: count, pageCount: pageCount };
}

// ── Token Creation from Analysis ─────────────────────────────────────────────

export async function createTokensFromAnalysis(analysis: AnalysisResult): Promise<string[]> {
  const results: string[] = [];

  // Colors
  if (analysis.colors.length > 0) {
    const colorData: any = {};
    for (let ci = 0; ci < analysis.colors.length; ci++) {
      const c = analysis.colors[ci];
      colorData[c.name] = makeColorDTCG(c.r, c.g, c.b);
    }
    // Auto-include focus/error semantic tokens
    if (!colorData["focus"]) {
      colorData["focus"] = {
        border: makeColorDTCG(0, 0, 0),
        color: makeColorDTCG(0.475, 0.475, 0.482)
      };
    }
    if (!colorData["error"]) {
      colorData["error"] = {
        border: makeColorDTCG(0.89, 0.18, 0.13),
        color: makeColorDTCG(0.89, 0.18, 0.13)
      };
    }
    const r = await importColors(colorData, "Light");
    results.push(r);
  }

  // Spacing
  if (analysis.spacing.length > 0) {
    const spacingData: any = {};
    for (let si = 0; si < analysis.spacing.length; si++) {
      const sp = analysis.spacing[si];
      spacingData[sp.name] = { "$type": "dimension", "$value": { value: sp.value, unit: "px" } };
    }
    results.push(await importFlat(spacingData, "Spacing", "spacing", true));
  }

  // Radius
  if (analysis.radius.length > 0) {
    const radiusData: any = {};
    for (let ri = 0; ri < analysis.radius.length; ri++) {
      const rd = analysis.radius[ri];
      radiusData[rd.name] = { "$type": "dimension", "$value": { value: rd.value, unit: "px" } };
    }
    results.push(await importFlat(radiusData, "Radius", "radius", true));
  }

  // Borders
  if (analysis.borders.length > 0) {
    const borderData: any = {};
    for (let bi = 0; bi < analysis.borders.length; bi++) {
      const bd = analysis.borders[bi];
      borderData[bd.name] = { "$type": "dimension", "$value": { value: bd.value, unit: "px" } };
    }
    results.push(await importFlat(borderData, "Border Width", "border", true));
  }

  // Shadows
  if (analysis.shadows.length > 0) {
    const shadowData: any = {};
    for (let shi = 0; shi < analysis.shadows.length; shi++) {
      const sh = analysis.shadows[shi];
      shadowData[sh.name] = { "$type": "string", "$value": sh.value };
    }
    results.push(await importShadows(shadowData));
  }

  // Text styles
  if (analysis.typography.length > 0) {
    const tsData: any = {};
    for (let ti = 0; ti < analysis.typography.length; ti++) {
      const t = analysis.typography[ti];
      const grp = t.group || "body";
      if (!tsData[grp]) tsData[grp] = {};
      tsData[grp][t.name] = {
        "$type": "textStyle",
        "$value": {
          fontFamily: t.fontFamily + ", sans-serif",
          fontStyle: t.fontStyle,
          fontSize: { value: t.fontSize, unit: "px" },
          fontWeight: t.fontWeight,
          lineHeight: { value: t.lineHeight / t.fontSize, unit: "MULTIPLIER" },
          letterSpacing: { value: t.letterSpacing, unit: (t.letterSpacingUnit === "percent" ? "PERCENT" : "PIXELS") },
          paragraphSpacing: { value: t.paragraphSpacing || 0, unit: "px" },
          textDecoration: t.textDecoration || "NONE",
          textCase: t.textCase || "ORIGINAL"
        }
      };
    }
    const tsResult = await importTextStyles(tsData);
    results.push(tsResult);
  }

  // Typography variables (sizes, weights, line-heights, families)
  if (analysis.typography.length > 0) {
    const scale = analysis.typographyScale || deriveTypographyScale(analysis.typography);
    const typoSizes = scale.sizes.map(function(s) { return { name: s.name, value: String(s.value) }; });
    const typoWeights = scale.weights.map(function(s) { return { name: s.name, value: String(s.value) }; });
    const typoLH = scale.lineHeights.map(function(s) { return { name: s.name, value: String(s.value) }; });

    const typoData = generateTypographyData(
      { sizes: typoSizes, weights: typoWeights, lineHeights: typoLH },
      analysis.fontFamilies
    );
    results.push(await importTypography(typoData));
  }

  // Auto-generated: opacity, breakpoints, grid
  results.push(await importOpacity(generateOpacityData()));
  results.push(await importFlat(generateBreakpointsData(), "Breakpoints", "breakpoint", false));
  results.push(await importGrid(generateGridData()));

  return results;
}

// ── Page Reorganization ──────────────────────────────────────────────────────

export async function reorganizeFrames(frames: FrameInfo[]): Promise<{ moved: number; skipped: number; pages: string[] }> {
  const desktopPage = findPageByHint("desktop");
  const mobilePage = findPageByHint("mobile");
  const componentsPage = findPageByHint("components");
  let moved = 0;
  let skipped = 0;
  const pagesCreated: string[] = [];

  // Track which pages were created vs already existed
  if (desktopPage) pagesCreated.push(desktopPage.name);
  if (mobilePage) pagesCreated.push(mobilePage.name);
  if (componentsPage) pagesCreated.push(componentsPage.name);

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const node = await figma.getNodeByIdAsync(f.nodeId);
    if (!node || !node.parent) continue;

    let targetPage: PageNode | null = null;
    if (f.classification === "desktop") targetPage = desktopPage;
    else if (f.classification === "mobile") targetPage = mobilePage;
    else if (f.classification === "component") targetPage = componentsPage;

    if (targetPage && node.parent.id !== targetPage.id) {
      try {
        targetPage.appendChild(node as SceneNode);
        moved++;
      } catch (e) {
        // Skip nodes that can't be moved
      }
    } else if (!targetPage) {
      skipped++;
    }
  }

  // Clear "Ready for dev" status on all top-level frames — designers set this at the end
  const clearPages = [desktopPage, mobilePage, componentsPage];
  for (let cpi = 0; cpi < clearPages.length; cpi++) {
    const cp = clearPages[cpi];
    if (!cp) continue;
    for (let cci = 0; cci < cp.children.length; cci++) {
      const child = cp.children[cci];
      if ("devStatus" in child) {
        try { (child as any).devStatus = null; } catch (e) {}
      }
    }
  }

  return { moved: moved, skipped: skipped, pages: pagesCreated };
}

// ── Variable Binding ─────────────────────────────────────────────────────────

export async function bindTokensToDesign(
  progressCallback?: (phase: string, count: number, total: number) => void
): Promise<{ colors: number; spacing: number; radius: number; borders: number; opacity: number; textStyles: number; effects: number }> {
  const stats = { colors: 0, spacing: 0, radius: 0, borders: 0, opacity: 0, textStyles: 0, effects: 0 };

  // Load all local variables
  const allVars = await figma.variables.getLocalVariablesAsync();
  const colorVars = allVars.filter(function(v) { return v.resolvedType === "COLOR"; });
  const floatVars = allVars.filter(function(v) { return v.resolvedType === "FLOAT"; });

  // Partition float vars by collection
  const allCols = await figma.variables.getLocalVariableCollectionsAsync();
  const colMap: {[id:string]: string} = {};
  for (let ci = 0; ci < allCols.length; ci++) {
    colMap[allCols[ci].id] = allCols[ci].name.toLowerCase();
  }

  const spacingVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("spacing") !== -1; });
  const radiusVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("radius") !== -1; });
  const borderVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("border") !== -1; });
  const opacityVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("opacity") !== -1; });

  // Load text and effect styles
  const localTextStyles = await figma.getLocalTextStylesAsync();
  const localEffectStyles = await figma.getLocalEffectStylesAsync();

  // Collect all nodes from Desktop, Mobile, Components pages
  const targetPages: PageNode[] = [];
  const pageHints = ["desktop", "mobile", "components"];
  for (let phi = 0; phi < pageHints.length; phi++) {
    for (let rpi = 0; rpi < figma.root.children.length; rpi++) {
      const pn = figma.root.children[rpi].name.toLowerCase().replace(/[^a-z]/g, "");
      if (pn.indexOf(pageHints[phi]) !== -1) {
        targetPages.push(figma.root.children[rpi]);
        break;
      }
    }
  }

  const allNodes: SceneNode[] = [];
  function collect(node: SceneNode) {
    allNodes.push(node);
    if ("children" in node && (node as any).children) {
      const ch = (node as any).children;
      for (let i = 0; i < ch.length; i++) collect(ch[i]);
    }
  }
  for (let tpi = 0; tpi < targetPages.length; tpi++) {
    for (let tci = 0; tci < targetPages[tpi].children.length; tci++) {
      collect(targetPages[tpi].children[tci]);
    }
  }

  const total = allNodes.length;

  // Bind each node
  for (let ni = 0; ni < allNodes.length; ni++) {
    const node = allNodes[ni];

    if (progressCallback && ni % 100 === 0) {
      progressCallback("binding", ni, total);
    }

    // Colors — fills
    if ("fills" in node && Array.isArray(node.fills)) {
      let changed = false;
      const newFills: Paint[] = [];
      for (let _fIdx = 0; _fIdx < node.fills.length; _fIdx++) {
        const fill = node.fills[_fIdx];
        if (fill.type !== "SOLID" || fill.visible === false) { newFills.push(fill); continue; }
        const bv = node.boundVariables?.fills?.[_fIdx];
        if (bv) { newFills.push(fill); continue; }
        const nearest = await findNearestColorVar((fill as SolidPaint).color, colorVars);
        if (nearest) {
          try {
            const f = figma.variables.setBoundVariableForPaint(fill, "color", nearest);
            stats.colors++; changed = true; newFills.push(f); continue;
          } catch (e) { newFills.push(fill); continue; }
        }
        newFills.push(fill);
      }
      if (changed) { try { (node as any).fills = newFills; } catch (e) {} }
    }

    // Colors — strokes
    if ("strokes" in node && Array.isArray(node.strokes)) {
      let sChanged = false;
      const newStrokes: Paint[] = [];
      for (let _sIdx = 0; _sIdx < node.strokes.length; _sIdx++) {
        const stroke = node.strokes[_sIdx];
        if (stroke.type !== "SOLID" || stroke.visible === false) { newStrokes.push(stroke); continue; }
        const bv = node.boundVariables?.strokes?.[_sIdx];
        if (bv) { newStrokes.push(stroke); continue; }
        const nearest = await findNearestColorVar((stroke as SolidPaint).color, colorVars);
        if (nearest) {
          try {
            const s = figma.variables.setBoundVariableForPaint(stroke, "color", nearest);
            stats.colors++; sChanged = true; newStrokes.push(s); continue;
          } catch (e) { newStrokes.push(stroke); continue; }
        }
        newStrokes.push(stroke);
      }
      if (sChanged) { try { (node as any).strokes = newStrokes; } catch (e) {} }
    }

    // Spacing
    if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
      const fn = node as FrameNode;
      const spacingProps: (keyof FrameNode)[] = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"];
      for (let spi = 0; spi < spacingProps.length; spi++) {
        const prop = spacingProps[spi];
        const val = (fn as any)[prop];
        if (typeof val !== "number" || val <= 0) continue;
        const bvSp = (fn.boundVariables as any)?.[prop];
        if (bvSp) continue;
        const nearSp = await findNearestFloatVar(val, spacingVars);
        if (nearSp) {
          try { fn.setBoundVariable(prop as any, nearSp); stats.spacing++; } catch (e) {}
        }
      }
    }

    // Radius
    if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
      const bvR = node.boundVariables?.cornerRadius || node.boundVariables?.topLeftRadius;
      if (!bvR) {
        const nearR = await findNearestFloatVar(node.cornerRadius, radiusVars);
        if (nearR) {
          try { (node as any).setBoundVariable("cornerRadius", nearR); stats.radius++; } catch (e) {}
        }
      }
    }

    // Border width
    if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) {
      if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.some(function(s: Paint) { return s.visible !== false; })) {
        const bvBw = node.boundVariables?.strokeWeight;
        if (!bvBw) {
          const nearBw = await findNearestFloatVar(node.strokeWeight as number, borderVars);
          if (nearBw) {
            try { (node as any).setBoundVariable("strokeWeight", nearBw); stats.borders++; } catch (e) {}
          }
        }
      }
    }

    // Opacity — variables store percentage (70), node.opacity is 0–1 (0.7)
    if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1 && node.opacity > 0) {
      const bvO = node.boundVariables?.opacity;
      if (!bvO) {
        const nearO = await findNearestFloatVar(Math.round(node.opacity * 100), opacityVars);
        if (nearO) {
          try { (node as any).setBoundVariable("opacity", nearO); stats.opacity++; } catch (e) {}
        }
      }
    }

    // Text styles
    if (node.type === "TEXT") {
      const tn = node as TextNode;
      const tsId = tn.textStyleId;
      if (!tsId || tsId === figma.mixed) {
        const fs = tn.fontSize;
        const fnm = tn.fontName;
        if (typeof fs === "number" && fnm && typeof fnm === "object" && "family" in fnm) {
          let bestTs: TextStyle | null = null;
          let bestScore = 0;
          for (let ltsi = 0; ltsi < localTextStyles.length; ltsi++) {
            const ts = localTextStyles[ltsi];
            let score = 0;
            if (ts.fontSize === fs) score += 10;
            else if (Math.abs(ts.fontSize - fs) <= 1) score += 5;
            else continue;
            if (ts.fontName.family === fnm.family) { score += 5; if (ts.fontName.style === fnm.style) score += 3; }
            if (score > bestScore) { bestScore = score; bestTs = ts; }
          }
          if (bestTs && bestScore >= 10) {
            try { await tn.setTextStyleIdAsync(bestTs.id); stats.textStyles++; } catch (e) {}
          }
        }
      }
    }

    // Effect styles
    if ("effects" in node && node.effects?.length > 0) {
      const esId = "effectStyleId" in node ? (node as any).effectStyleId : null;
      if (!esId) {
        // Try to match by serialized CSS
        const nodeShadows: string[] = [];
        for (let nei = 0; nei < node.effects.length; nei++) {
          const css = shadowToCSS(node.effects[nei]);
          if (css) nodeShadows.push(css);
        }
        if (nodeShadows.length > 0) {
          const nodeKey = nodeShadows.join("|");
          for (let esi = 0; esi < localEffectStyles.length; esi++) {
            const es = localEffectStyles[esi];
            const esShadows: string[] = [];
            for (let esj = 0; esj < es.effects.length; esj++) {
              const esCss = shadowToCSS(es.effects[esj]);
              if (esCss) esShadows.push(esCss);
            }
            if (esShadows.join("|") === nodeKey) {
              try { await (node as any).setEffectStyleIdAsync(es.id); stats.effects++; } catch (e) {}
              break;
            }
          }
        }
      }
    }
  }

  return stats;
}

// ── Cleanup Original Pages ──────────────────────────────────────────────────

export async function cleanupOriginalPages(): Promise<{ removedPages: string[] }> {
  await figma.loadAllPagesAsync();
  const standardHints = ["cover", "foundations", "components", "desktop", "mobile", "archive"];
  const removedPages: string[] = [];

  const pages = figma.root.children.slice();
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    const norm = pg.name.toLowerCase().replace(/[^a-z]/g, "");
    const isStandard = standardHints.some(function(h) { return norm.indexOf(h) !== -1; });
    if (!isStandard && pg.children.length === 0) {
      removedPages.push(pg.name);
      pg.remove();
    }
  }

  return { removedPages: removedPages };
}

// ── Scan Existing Variables ─────────────────────────────────────────────────

interface ExistingColorVar { name: string; hex: string; id: string; }
interface ExistingFloatVar { name: string; value: number; collection: string; id: string; }
interface ExistingTextStyle { name: string; fontSize: number; fontFamily: string; fontStyle: string; fontWeight: number; id: string; }

export interface ExistingVarsResult {
  colors: ExistingColorVar[];
  floats: ExistingFloatVar[];
  textStyles: ExistingTextStyle[];
}

export async function scanExistingVariables(): Promise<ExistingVarsResult> {
  const colors: ExistingColorVar[] = [];
  const floats: ExistingFloatVar[] = [];
  const textStyles: ExistingTextStyle[] = [];

  // Scan local variables
  const localVars = await figma.variables.getLocalVariablesAsync();
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionMap: Record<string, string> = {};
  for (let ci = 0; ci < collections.length; ci++) {
    collectionMap[collections[ci].id] = collections[ci].name;
  }

  for (let vi = 0; vi < localVars.length; vi++) {
    const v = localVars[vi];
    const modeId = Object.keys(v.valuesByMode)[0];
    if (!modeId) continue;
    const val = v.valuesByMode[modeId];

    if (v.resolvedType === "COLOR" && typeof val === "object" && "r" in val) {
      const rgba = val as RGBA;
      const hex = rgb01ToHex(rgba.r, rgba.g, rgba.b);
      colors.push({ name: v.name, hex: hex, id: v.id });
    } else if (v.resolvedType === "FLOAT" && typeof val === "number") {
      floats.push({
        name: v.name,
        value: val as number,
        collection: collectionMap[v.variableCollectionId] || "",
        id: v.id
      });
    }
  }

  // Scan local text styles
  const localTextStyles = await figma.getLocalTextStylesAsync();
  for (let ti = 0; ti < localTextStyles.length; ti++) {
    const ts = localTextStyles[ti];
    textStyles.push({
      name: ts.name,
      fontSize: ts.fontSize as number,
      fontFamily: (ts.fontName as FontName).family,
      fontStyle: (ts.fontName as FontName).style,
      fontWeight: styleToWeight((ts.fontName as FontName).style),
      id: ts.id
    });
  }

  return { colors: colors, floats: floats, textStyles: textStyles };
}

// ── Match Tokens With Existing ──────────────────────────────────────────────

export function matchTokensWithExisting(analysis: AnalysisResult, existingVars: ExistingVarsResult): AnalysisResult {
  // Deep copy so we don't mutate the original
  const result: AnalysisResult = JSON.parse(JSON.stringify(analysis));

  // Match colors by distance
  for (let ci = 0; ci < result.colors.length; ci++) {
    const ac = result.colors[ci];
    let bestDist = 0.02;
    let bestName = "";
    for (let ei = 0; ei < existingVars.colors.length; ei++) {
      const ec = existingVars.colors[ei];
      // Parse hex to RGB for comparison
      const ar = ac.r, ag = ac.g, ab = ac.b;
      const er = parseInt(ec.hex.slice(1, 3), 16) / 255;
      const eg = parseInt(ec.hex.slice(3, 5), 16) / 255;
      const eb = parseInt(ec.hex.slice(5, 7), 16) / 255;
      const dist = Math.sqrt((ar - er) * (ar - er) + (ag - eg) * (ag - eg) + (ab - eb) * (ab - eb));
      if (dist < bestDist) {
        bestDist = dist;
        bestName = ec.name;
      }
    }
    if (bestName) {
      (result.colors[ci] as any).name = bestName;
      (result.colors[ci] as any).matched = true;
    }
  }

  // Match spacing by value (±1px tolerance)
  for (let si = 0; si < result.spacing.length; si++) {
    const sv = result.spacing[si].value;
    for (let sj = 0; sj < existingVars.floats.length; sj++) {
      const ef = existingVars.floats[sj];
      if (ef.collection.toLowerCase().indexOf("spacing") !== -1 && Math.abs(sv - ef.value) <= 1) {
        (result.spacing[si] as any).name = ef.name;
        (result.spacing[si] as any).matched = true;
        break;
      }
    }
  }

  // Match radius by value (±1px tolerance)
  for (let ri = 0; ri < result.radius.length; ri++) {
    const rv = result.radius[ri].value;
    for (let rj = 0; rj < existingVars.floats.length; rj++) {
      const rf = existingVars.floats[rj];
      if (rf.collection.toLowerCase().indexOf("radius") !== -1 && Math.abs(rv - rf.value) <= 1) {
        (result.radius[ri] as any).name = rf.name;
        (result.radius[ri] as any).matched = true;
        break;
      }
    }
  }

  // Match borders by value (±1px tolerance)
  for (let bi = 0; bi < result.borders.length; bi++) {
    const bv = result.borders[bi].value;
    for (let bj = 0; bj < existingVars.floats.length; bj++) {
      const bf = existingVars.floats[bj];
      if (bf.collection.toLowerCase().indexOf("border") !== -1 && Math.abs(bv - bf.value) <= 1) {
        (result.borders[bi] as any).name = bf.name;
        (result.borders[bi] as any).matched = true;
        break;
      }
    }
  }

  // Match typography by fontSize + fontStyle (exact) or fontSize + fontWeight (approximate)
  for (let ti = 0; ti < result.typography.length; ti++) {
    const tc = result.typography[ti];
    for (let tj = 0; tj < existingVars.textStyles.length; tj++) {
      const et = existingVars.textStyles[tj];
      const sizeMatch = Math.abs(tc.fontSize - et.fontSize) < 0.5;
      const styleMatch = tc.fontStyle === et.fontStyle;
      const weightMatch = tc.fontWeight === et.fontWeight;
      if (sizeMatch && (styleMatch || weightMatch)) {
        (result.typography[ti] as any).name = et.name;
        (result.typography[ti] as any).matched = true;
        break;
      }
    }
  }

  return result;
}
