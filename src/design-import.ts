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
  fontFamily: string; fontSize: number; fontWeight: number;
  lineHeight: number; letterSpacing: number;
  count: number; sampleText: string;
  group: string; name: string;
}

interface FrameInfo {
  nodeId: string; name: string; width: number; height: number;
  pageId: string; pageName: string;
  classification: "desktop" | "mobile" | "component" | "other";
}

export interface AnalysisResult {
  colors: ColorEntry[];
  spacing: SpacingEntry[];
  radius: RadiusEntry[];
  borders: BorderEntry[];
  shadows: ShadowEntry[];
  typography: TypoCombo[];
  fontFamilies: { primary: string; secondary: string };
  frames: FrameInfo[];
  totalNodes: number;
  pagesAnalyzed: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

var MOBILE_BREAKPOINT = 567;
var DESKTOP_MIN_WIDTH = 900;
var MIN_PAGE_HEIGHT = 400;

var SPACING_NAMES = ["4xs", "3xs", "2xs", "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
var RADIUS_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl", "full"];
var BORDER_NAMES = ["thin", "default", "medium", "thick"];
var SHADOW_NAMES = ["xs", "sm", "md", "lg", "xl", "2xl"];

// Named hue ranges for auto-naming colors
var HUE_NAMES: [number, number, string][] = [
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
  var dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}

function hueToName(h: number): string {
  for (var i = 0; i < HUE_NAMES.length; i++) {
    if (h >= HUE_NAMES[i][0] && h < HUE_NAMES[i][1]) return HUE_NAMES[i][2];
  }
  return "color";
}

function makeColorDTCG(r: number, g: number, b: number) {
  return { "$type": "color", "$value": { colorSpace: "srgb", components: [r, g, b], alpha: 1 } };
}

function shadowToCSS(e: Effect): string | null {
  if (e.type !== "DROP_SHADOW" && e.type !== "INNER_SHADOW") return null;
  var s = e as DropShadowEffect;
  var r = Math.round((s.color.r || 0) * 255);
  var g = Math.round((s.color.g || 0) * 255);
  var b = Math.round((s.color.b || 0) * 255);
  var a = Math.round((s.color.a !== undefined ? s.color.a : 1) * 100) / 100;
  var prefix = e.type === "INNER_SHADOW" ? "inset " : "";
  return prefix + (s.offset.x || 0) + "px " + (s.offset.y || 0) + "px " + (s.spread || 0) + "px " + (s.radius || 0) + "px rgba(" + r + "," + g + "," + b + "," + a + ")";
}

// ── Analysis Engine ──────────────────────────────────────────────────────────

export async function analyzeDesign(): Promise<AnalysisResult> {
  await figma.loadAllPagesAsync();
  var colorMap: {[hex:string]: ColorEntry} = {};
  var spacingMap: {[val:string]: number} = {};
  var radiusMap: {[val:string]: number} = {};
  var borderMap: {[val:string]: number} = {};
  var shadowMap: {[css:string]: number} = {};
  var typoMap: {[key:string]: TypoCombo} = {};
  var fontFamilyCount: {[fam:string]: number} = {};
  var frames: FrameInfo[] = [];
  var totalNodes = 0;

  // Skip these pages during analysis
  var skipHints = ["cover", "foundations", "components", "archive"];

  function shouldSkipPage(name: string): boolean {
    var norm = name.toLowerCase().replace(/[^a-z]/g, "");
    for (var i = 0; i < skipHints.length; i++) {
      if (norm.indexOf(skipHints[i]) !== -1) return true;
    }
    return false;
  }

  // Collect a color
  function addColor(c: {r:number, g:number, b:number}) {
    var hex = figmaColorToHex(c);
    if (colorMap[hex]) { colorMap[hex].count++; return; }
    // Check for near-duplicate
    var keys = Object.keys(colorMap);
    for (var i = 0; i < keys.length; i++) {
      var existing = colorMap[keys[i]];
      if (colorDistRgb(c, {r: existing.r, g: existing.g, b: existing.b}) < 0.02) {
        existing.count++;
        return;
      }
    }
    var rgb255 = { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
    var hsl = rgbToHsl(rgb255.r, rgb255.g, rgb255.b);
    colorMap[hex] = { r: c.r, g: c.g, b: c.b, hex: hex, count: 1, h: hsl.h, s: hsl.s, l: hsl.l, name: "" };
  }

  // Walk a single node
  function walkNode(node: SceneNode) {
    totalNodes++;

    // Colors from fills
    if ("fills" in node && Array.isArray(node.fills)) {
      for (var fi = 0; fi < node.fills.length; fi++) {
        var fill = node.fills[fi];
        if (fill.type === "SOLID" && fill.visible !== false) {
          addColor(fill.color);
        }
      }
    }

    // Colors from strokes
    if ("strokes" in node && Array.isArray(node.strokes)) {
      for (var si = 0; si < node.strokes.length; si++) {
        var stroke = node.strokes[si];
        if (stroke.type === "SOLID" && stroke.visible !== false) {
          addColor(stroke.color);
        }
      }
    }

    // Spacing from auto-layout
    if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
      var f = node as FrameNode;
      var spacingProps = [f.paddingLeft, f.paddingRight, f.paddingTop, f.paddingBottom, f.itemSpacing];
      for (var spi = 0; spi < spacingProps.length; spi++) {
        var sv = spacingProps[spi];
        if (typeof sv === "number" && sv > 0) {
          var svk = String(Math.round(sv));
          spacingMap[svk] = (spacingMap[svk] || 0) + 1;
        }
      }
    }

    // Radius
    if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
      var rk = String(Math.round(node.cornerRadius));
      radiusMap[rk] = (radiusMap[rk] || 0) + 1;
    }

    // Border width
    if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) {
      if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.some(function(s: Paint) { return s.visible !== false; })) {
        var bk = String(Math.round(node.strokeWeight as number));
        borderMap[bk] = (borderMap[bk] || 0) + 1;
      }
    }

    // Shadows / effects
    if ("effects" in node && node.effects && node.effects.length > 0) {
      for (var ei = 0; ei < node.effects.length; ei++) {
        var css = shadowToCSS(node.effects[ei]);
        if (css) {
          shadowMap[css] = (shadowMap[css] || 0) + 1;
        }
      }
    }

    // Typography
    if (node.type === "TEXT") {
      var tn = node as TextNode;
      var fs = tn.fontSize;
      var fn = tn.fontName;
      if (typeof fs === "number" && fn && typeof fn === "object" && "family" in fn) {
        var fw = 400;
        // Map style name to weight
        var style = (fn.style || "Regular").toLowerCase();
        if (style.indexOf("thin") !== -1) fw = 100;
        else if (style.indexOf("extralight") !== -1 || style.indexOf("ultra light") !== -1) fw = 200;
        else if (style.indexOf("light") !== -1) fw = 300;
        else if (style.indexOf("medium") !== -1) fw = 500;
        else if (style.indexOf("semibold") !== -1 || style.indexOf("semi bold") !== -1 || style.indexOf("demi") !== -1) fw = 600;
        else if (style.indexOf("extrabold") !== -1 || style.indexOf("ultra bold") !== -1) fw = 800;
        else if (style.indexOf("black") !== -1 || style.indexOf("heavy") !== -1) fw = 900;
        else if (style.indexOf("bold") !== -1) fw = 700;

        var lh = 0;
        if (tn.lineHeight && typeof tn.lineHeight === "object" && "value" in tn.lineHeight) {
          var lhObj = tn.lineHeight as { value: number; unit: string };
          if (lhObj.unit === "PIXELS") lh = lhObj.value;
          else if (lhObj.unit === "PERCENT") lh = (lhObj.value / 100) * fs;
          else lh = fs * 1.5; // AUTO fallback
        } else {
          lh = fs * 1.5;
        }

        var ls = 0;
        if (tn.letterSpacing && typeof tn.letterSpacing === "object" && "value" in tn.letterSpacing) {
          ls = (tn.letterSpacing as {value:number}).value || 0;
        }

        var comboKey = fn.family + "/" + fs + "/" + fw;
        fontFamilyCount[fn.family] = (fontFamilyCount[fn.family] || 0) + 1;

        if (typoMap[comboKey]) {
          typoMap[comboKey].count++;
        } else {
          var sample = (tn.characters || "").substring(0, 40);
          typoMap[comboKey] = {
            fontFamily: fn.family, fontSize: fs, fontWeight: fw,
            lineHeight: Math.round(lh * 10) / 10,
            letterSpacing: Math.round(ls * 100) / 100,
            count: 1, sampleText: sample,
            group: "", name: ""
          };
        }
      }
    }

    // Recurse
    if ("children" in node && (node as any).children) {
      var ch = (node as any).children;
      for (var ci = 0; ci < ch.length; ci++) { walkNode(ch[ci]); }
    }
  }

  // Collect top-level frames from content pages
  var pagesAnalyzed = 0;
  for (var pi = 0; pi < figma.root.children.length; pi++) {
    var page = figma.root.children[pi];
    if (shouldSkipPage(page.name)) continue;
    if (page.children.length === 0) continue;
    pagesAnalyzed++;

    for (var fci = 0; fci < page.children.length; fci++) {
      var topNode = page.children[fci];

      // Classify top-level frames
      if (topNode.type === "FRAME" || topNode.type === "COMPONENT" || topNode.type === "COMPONENT_SET" || topNode.type === "SECTION") {
        var classification: "desktop" | "mobile" | "component" | "other" = "other";
        if (topNode.type === "COMPONENT" || topNode.type === "COMPONENT_SET") {
          classification = "component";
        } else if (topNode.width > DESKTOP_MIN_WIDTH && topNode.height >= MIN_PAGE_HEIGHT) {
          classification = "desktop";
        } else if (topNode.width <= MOBILE_BREAKPOINT && topNode.height >= MIN_PAGE_HEIGHT) {
          classification = "mobile";
        } else if (topNode.height < MIN_PAGE_HEIGHT) {
          classification = "component";
        }
        frames.push({
          nodeId: topNode.id, name: topNode.name,
          width: Math.round(topNode.width), height: Math.round(topNode.height),
          pageId: page.id, pageName: page.name,
          classification: classification
        });
      }

      // Walk for token extraction
      walkNode(topNode);
    }
  }

  // ── Process collected data ──

  // Colors: sort by frequency, auto-name
  var colors = Object.keys(colorMap).map(function(k) { return colorMap[k]; });
  colors.sort(function(a, b) { return b.count - a.count; });
  nameColors(colors);

  // Spacing: sort by value, pick top values, name
  var spacingEntries = Object.keys(spacingMap).map(function(k) {
    return { value: parseInt(k, 10), count: spacingMap[k] };
  });
  spacingEntries.sort(function(a, b) { return a.value - b.value; });
  // Deduplicate close values (within 2px) keeping higher-frequency one
  var spacingDeduped: typeof spacingEntries = [];
  for (var sdi = 0; sdi < spacingEntries.length; sdi++) {
    var se = spacingEntries[sdi];
    var merged = false;
    for (var sdj = 0; sdj < spacingDeduped.length; sdj++) {
      if (Math.abs(spacingDeduped[sdj].value - se.value) <= 2) {
        if (se.count > spacingDeduped[sdj].count) spacingDeduped[sdj].value = se.value;
        spacingDeduped[sdj].count += se.count;
        merged = true; break;
      }
    }
    if (!merged) spacingDeduped.push({ value: se.value, count: se.count });
  }
  // Take top 12 by frequency
  spacingDeduped.sort(function(a, b) { return b.count - a.count; });
  var topSpacing = spacingDeduped.slice(0, 12);
  topSpacing.sort(function(a, b) { return a.value - b.value; });
  var spacing: SpacingEntry[] = [];
  for (var tsi = 0; tsi < topSpacing.length; tsi++) {
    var sName = tsi < SPACING_NAMES.length ? SPACING_NAMES[tsi] : String(topSpacing[tsi].value);
    spacing.push({ name: sName, value: topSpacing[tsi].value, count: topSpacing[tsi].count });
  }

  // Radius: sort ascending, name
  var radiusEntries = Object.keys(radiusMap).map(function(k) {
    return { value: parseInt(k, 10), count: radiusMap[k] };
  });
  radiusEntries.sort(function(a, b) { return a.value - b.value; });
  var radius: RadiusEntry[] = [];
  for (var ri = 0; ri < radiusEntries.length; ri++) {
    var rName: string;
    if (radiusEntries[ri].value >= 999) rName = "full";
    else rName = ri < RADIUS_NAMES.length ? RADIUS_NAMES[ri] : "r-" + radiusEntries[ri].value;
    radius.push({ name: rName, value: radiusEntries[ri].value, count: radiusEntries[ri].count });
  }

  // Borders: sort ascending, name
  var borderEntries = Object.keys(borderMap).map(function(k) {
    return { value: parseInt(k, 10), count: borderMap[k] };
  });
  borderEntries.sort(function(a, b) { return a.value - b.value; });
  var borders: BorderEntry[] = [];
  for (var bi = 0; bi < borderEntries.length; bi++) {
    var bName = bi < BORDER_NAMES.length ? BORDER_NAMES[bi] : "b-" + borderEntries[bi].value;
    borders.push({ name: bName, value: borderEntries[bi].value, count: borderEntries[bi].count });
  }

  // Shadows: sort by size (offset.y as proxy), name
  var shadowEntries = Object.keys(shadowMap).map(function(k) {
    return { css: k, count: shadowMap[k] };
  });
  // Sort by offset-y extracted from CSS string
  shadowEntries.sort(function(a, b) {
    var ay = parseInt(a.css.split("px")[1] || "0", 10) || 0;
    var by = parseInt(b.css.split("px")[1] || "0", 10) || 0;
    return ay - by;
  });
  var shadows: ShadowEntry[] = [];
  for (var shi = 0; shi < shadowEntries.length; shi++) {
    var shName = shi < SHADOW_NAMES.length ? SHADOW_NAMES[shi] : "shadow-" + (shi + 1);
    shadows.push({ name: shName, value: shadowEntries[shi].css, count: shadowEntries[shi].count });
  }

  // Typography: sort by frequency, auto-name
  var typography = Object.keys(typoMap).map(function(k) { return typoMap[k]; });
  typography.sort(function(a, b) { return b.count - a.count; });
  nameTypography(typography);

  // Font families: top 2
  var famEntries = Object.keys(fontFamilyCount).map(function(k) { return { name: k, count: fontFamilyCount[k] }; });
  famEntries.sort(function(a, b) { return b.count - a.count; });
  var fontFamilies = {
    primary: famEntries.length > 0 ? famEntries[0].name : "Inter",
    secondary: famEntries.length > 1 ? famEntries[1].name : ""
  };

  return {
    colors: colors, spacing: spacing, radius: radius, borders: borders,
    shadows: shadows, typography: typography, fontFamilies: fontFamilies,
    frames: frames, totalNodes: totalNodes, pagesAnalyzed: pagesAnalyzed
  };
}

// ── Color Naming ─────────────────────────────────────────────────────────────

function nameColors(colors: ColorEntry[]) {
  var usedNames: {[k:string]: boolean} = {};
  var primaryAssigned = false, secondaryAssigned = false, tertiaryAssigned = false;

  for (var i = 0; i < colors.length; i++) {
    var c = colors[i];

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
        var shade = Math.round(c.l / 10) * 100;
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
      var hueName = hueToName(c.h);
      if (usedNames[hueName]) {
        // Append lightness qualifier
        var qual = c.l > 60 ? "light" : c.l < 35 ? "dark" : "mid";
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
  var usedNames: {[k:string]: boolean} = {};

  for (var i = 0; i < combos.length; i++) {
    var t = combos[i];
    var group = "body";
    var name = "default";

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

    var fullName = group + "/" + name;
    if (usedNames[fullName]) {
      // Append size to disambiguate
      fullName = group + "/" + name + "-" + Math.round(t.fontSize);
      if (usedNames[fullName]) fullName = group + "/" + Math.round(t.fontSize) + "-" + t.fontWeight;
    }
    usedNames[fullName] = true;
    t.group = group;
    t.name = name;
    // Store the disambiguated name parts back
    var parts = fullName.split("/");
    t.group = parts[0];
    t.name = parts[1];
  }
}

// ── Archive ──────────────────────────────────────────────────────────────────

export async function archiveExistingContent(): Promise<{ count: number; pageCount: number }> {
  await figma.loadAllPagesAsync();
  var archivePage = findPageByHint("archive");
  var count = 0;
  var pageCount = 0;

  for (var pi = 0; pi < figma.root.children.length; pi++) {
    var page = figma.root.children[pi];
    if (page.id === archivePage.id) continue;
    if (page.children.length === 0) continue;
    pageCount++;

    // Create a section frame for this page's content
    var section = figma.createFrame();
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
    for (var ci = 0; ci < page.children.length; ci++) {
      try {
        var clone = page.children[ci].clone();
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
  var results: string[] = [];

  // Colors
  if (analysis.colors.length > 0) {
    var colorData: any = {};
    for (var ci = 0; ci < analysis.colors.length; ci++) {
      var c = analysis.colors[ci];
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
    var r = await importColors(colorData, "Light");
    results.push(r);
  }

  // Spacing
  if (analysis.spacing.length > 0) {
    var spacingData: any = {};
    for (var si = 0; si < analysis.spacing.length; si++) {
      var sp = analysis.spacing[si];
      spacingData[sp.name] = { "$type": "dimension", "$value": { value: sp.value, unit: "px" } };
    }
    results.push(await importFlat(spacingData, "Spacing", "spacing", true));
  }

  // Radius
  if (analysis.radius.length > 0) {
    var radiusData: any = {};
    for (var ri = 0; ri < analysis.radius.length; ri++) {
      var rd = analysis.radius[ri];
      radiusData[rd.name] = { "$type": "dimension", "$value": { value: rd.value, unit: "px" } };
    }
    results.push(await importFlat(radiusData, "Radius", "radius", true));
  }

  // Borders
  if (analysis.borders.length > 0) {
    var borderData: any = {};
    for (var bi = 0; bi < analysis.borders.length; bi++) {
      var bd = analysis.borders[bi];
      borderData[bd.name] = { "$type": "dimension", "$value": { value: bd.value, unit: "px" } };
    }
    results.push(await importFlat(borderData, "Border Width", "border", true));
  }

  // Shadows
  if (analysis.shadows.length > 0) {
    var shadowData: any = {};
    for (var shi = 0; shi < analysis.shadows.length; shi++) {
      var sh = analysis.shadows[shi];
      shadowData[sh.name] = { "$type": "string", "$value": sh.value };
    }
    results.push(await importShadows(shadowData));
  }

  // Text styles
  if (analysis.typography.length > 0) {
    var tsData: any = {};
    for (var ti = 0; ti < analysis.typography.length; ti++) {
      var t = analysis.typography[ti];
      var grp = t.group || "body";
      if (!tsData[grp]) tsData[grp] = {};
      tsData[grp][t.name] = {
        "$type": "textStyle",
        "$value": {
          fontFamily: t.fontFamily + ", sans-serif",
          fontSize: { value: t.fontSize, unit: "px" },
          fontWeight: t.fontWeight,
          lineHeight: { value: t.lineHeight / t.fontSize, unit: "MULTIPLIER" },
          letterSpacing: { value: t.letterSpacing, unit: "px" },
          paragraphSpacing: { value: 0, unit: "px" }
        }
      };
    }
    var tsResult = await importTextStyles(tsData);
    results.push(tsResult);
  }

  // Typography variables (sizes, weights, line-heights, families)
  if (analysis.typography.length > 0) {
    // Extract unique sizes
    var sizeSet: {[k:string]: number} = {};
    var weightSet: {[k:string]: number} = {};
    var lhSet: {[k:string]: number} = {};
    for (var tvi = 0; tvi < analysis.typography.length; tvi++) {
      var tv = analysis.typography[tvi];
      sizeSet[String(tv.fontSize)] = tv.fontSize;
      weightSet[String(tv.fontWeight)] = tv.fontWeight;
      if (tv.lineHeight > 0) {
        var lhRatio = Math.round((tv.lineHeight / tv.fontSize) * 100) / 100;
        lhSet[String(lhRatio)] = lhRatio;
      }
    }
    var sizes = Object.keys(sizeSet).map(function(k) { return sizeSet[k]; }).sort(function(a, b) { return a - b; });
    var sizeNames = ["xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl"];
    var typoSizes: {name:string, value:string}[] = [];
    for (var tsi2 = 0; tsi2 < sizes.length; tsi2++) {
      var sn = tsi2 < sizeNames.length ? sizeNames[tsi2] : "s-" + sizes[tsi2];
      typoSizes.push({ name: sn, value: String(sizes[tsi2]) });
    }

    var WEIGHT_NAMES: {[k:string]: string} = { "100": "thin", "200": "extralight", "300": "light", "400": "regular", "500": "medium", "600": "semibold", "700": "bold", "800": "extrabold", "900": "black" };
    var weights = Object.keys(weightSet).map(function(k) { return weightSet[k]; }).sort(function(a, b) { return a - b; });
    var typoWeights: {name:string, value:string}[] = [];
    for (var twi = 0; twi < weights.length; twi++) {
      var wn = WEIGHT_NAMES[String(weights[twi])] || "w-" + weights[twi];
      typoWeights.push({ name: wn, value: String(weights[twi]) });
    }

    var LH_NAMES: [number, string][] = [[1.0, "none"], [1.15, "tight"], [1.3, "snug"], [1.5, "normal"], [1.65, "relaxed"], [2.0, "loose"]];
    var lhVals = Object.keys(lhSet).map(function(k) { return lhSet[k]; }).sort(function(a, b) { return a - b; });
    var typoLH: {name:string, value:string}[] = [];
    for (var lhi = 0; lhi < lhVals.length; lhi++) {
      var lhName = "lh-" + lhVals[lhi];
      for (var lni = 0; lni < LH_NAMES.length; lni++) {
        if (Math.abs(lhVals[lhi] - LH_NAMES[lni][0]) < 0.1) { lhName = LH_NAMES[lni][1]; break; }
      }
      typoLH.push({ name: lhName, value: String(lhVals[lhi]) });
    }

    var typoData = generateTypographyData(
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
  var desktopPage = findPageByHint("desktop");
  var mobilePage = findPageByHint("mobile");
  var componentsPage = findPageByHint("components");
  var moved = 0;
  var skipped = 0;
  var pagesCreated: string[] = [];

  // Track which pages were created vs already existed
  if (desktopPage) pagesCreated.push(desktopPage.name);
  if (mobilePage) pagesCreated.push(mobilePage.name);
  if (componentsPage) pagesCreated.push(componentsPage.name);

  for (var i = 0; i < frames.length; i++) {
    var f = frames[i];
    var node = await figma.getNodeByIdAsync(f.nodeId);
    if (!node || !node.parent) continue;

    var targetPage: PageNode | null = null;
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

  return { moved: moved, skipped: skipped, pages: pagesCreated };
}

// ── Variable Binding ─────────────────────────────────────────────────────────

export async function bindTokensToDesign(
  progressCallback?: (phase: string, count: number, total: number) => void
): Promise<{ colors: number; spacing: number; radius: number; borders: number; opacity: number; textStyles: number; effects: number }> {
  var stats = { colors: 0, spacing: 0, radius: 0, borders: 0, opacity: 0, textStyles: 0, effects: 0 };

  // Load all local variables
  var allVars = await figma.variables.getLocalVariablesAsync();
  var colorVars = allVars.filter(function(v) { return v.resolvedType === "COLOR"; });
  var floatVars = allVars.filter(function(v) { return v.resolvedType === "FLOAT"; });

  // Partition float vars by collection
  var allCols = await figma.variables.getLocalVariableCollectionsAsync();
  var colMap: {[id:string]: string} = {};
  for (var ci = 0; ci < allCols.length; ci++) {
    colMap[allCols[ci].id] = allCols[ci].name.toLowerCase();
  }

  var spacingVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("spacing") !== -1; });
  var radiusVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("radius") !== -1; });
  var borderVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("border") !== -1; });
  var opacityVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("opacity") !== -1; });

  // Load text and effect styles
  var localTextStyles = await figma.getLocalTextStylesAsync();
  var localEffectStyles = await figma.getLocalEffectStylesAsync();

  // Collect all nodes from Desktop, Mobile, Components pages
  var targetPages: PageNode[] = [];
  var pageHints = ["desktop", "mobile", "components"];
  for (var phi = 0; phi < pageHints.length; phi++) {
    for (var rpi = 0; rpi < figma.root.children.length; rpi++) {
      var pn = figma.root.children[rpi].name.toLowerCase().replace(/[^a-z]/g, "");
      if (pn.indexOf(pageHints[phi]) !== -1) {
        targetPages.push(figma.root.children[rpi]);
        break;
      }
    }
  }

  var allNodes: SceneNode[] = [];
  function collect(node: SceneNode) {
    allNodes.push(node);
    if ("children" in node && (node as any).children) {
      var ch = (node as any).children;
      for (var i = 0; i < ch.length; i++) collect(ch[i]);
    }
  }
  for (var tpi = 0; tpi < targetPages.length; tpi++) {
    for (var tci = 0; tci < targetPages[tpi].children.length; tci++) {
      collect(targetPages[tpi].children[tci]);
    }
  }

  var total = allNodes.length;

  // Bind each node
  for (var ni = 0; ni < allNodes.length; ni++) {
    var node = allNodes[ni];

    if (progressCallback && ni % 100 === 0) {
      progressCallback("binding", ni, total);
    }

    // Colors — fills
    if ("fills" in node && Array.isArray(node.fills)) {
      var changed = false;
      var newFills: Paint[] = [];
      for (var _fIdx = 0; _fIdx < node.fills.length; _fIdx++) {
        var fill = node.fills[_fIdx];
        if (fill.type !== "SOLID" || fill.visible === false) { newFills.push(fill); continue; }
        var bv = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[_fIdx];
        if (bv) { newFills.push(fill); continue; }
        var nearest = await findNearestColorVar((fill as SolidPaint).color, colorVars);
        if (nearest) {
          try {
            var f = figma.variables.setBoundVariableForPaint(fill, "color", nearest);
            stats.colors++; changed = true; newFills.push(f); continue;
          } catch (e) { newFills.push(fill); continue; }
        }
        newFills.push(fill);
      }
      if (changed) { try { (node as any).fills = newFills; } catch (e) {} }
    }

    // Colors — strokes
    if ("strokes" in node && Array.isArray(node.strokes)) {
      var sChanged = false;
      var newStrokes: Paint[] = [];
      for (var _sIdx = 0; _sIdx < node.strokes.length; _sIdx++) {
        var stroke = node.strokes[_sIdx];
        if (stroke.type !== "SOLID" || stroke.visible === false) { newStrokes.push(stroke); continue; }
        var bv = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[_sIdx];
        if (bv) { newStrokes.push(stroke); continue; }
        var nearest = await findNearestColorVar((stroke as SolidPaint).color, colorVars);
        if (nearest) {
          try {
            var s = figma.variables.setBoundVariableForPaint(stroke, "color", nearest);
            stats.colors++; sChanged = true; newStrokes.push(s); continue;
          } catch (e) { newStrokes.push(stroke); continue; }
        }
        newStrokes.push(stroke);
      }
      if (sChanged) { try { (node as any).strokes = newStrokes; } catch (e) {} }
    }

    // Spacing
    if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
      var fn = node as FrameNode;
      var spacingProps: (keyof FrameNode)[] = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"];
      for (var spi = 0; spi < spacingProps.length; spi++) {
        var prop = spacingProps[spi];
        var val = (fn as any)[prop];
        if (typeof val !== "number" || val <= 0) continue;
        var bvSp = fn.boundVariables && (fn.boundVariables as any)[prop];
        if (bvSp) continue;
        var nearSp = await findNearestFloatVar(val, spacingVars);
        if (nearSp) {
          try { fn.setBoundVariable(prop as any, nearSp); stats.spacing++; } catch (e) {}
        }
      }
    }

    // Radius
    if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
      var bvR = node.boundVariables && (node.boundVariables.cornerRadius || node.boundVariables.topLeftRadius);
      if (!bvR) {
        var nearR = await findNearestFloatVar(node.cornerRadius, radiusVars);
        if (nearR) {
          try { (node as any).setBoundVariable("cornerRadius", nearR); stats.radius++; } catch (e) {}
        }
      }
    }

    // Border width
    if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) {
      if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.some(function(s: Paint) { return s.visible !== false; })) {
        var bvBw = node.boundVariables && node.boundVariables.strokeWeight;
        if (!bvBw) {
          var nearBw = await findNearestFloatVar(node.strokeWeight as number, borderVars);
          if (nearBw) {
            try { (node as any).setBoundVariable("strokeWeight", nearBw); stats.borders++; } catch (e) {}
          }
        }
      }
    }

    // Opacity
    if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1 && node.opacity > 0) {
      var bvO = node.boundVariables && node.boundVariables.opacity;
      if (!bvO) {
        var nearO = await findNearestFloatVar(node.opacity, opacityVars);
        if (nearO) {
          try { (node as any).setBoundVariable("opacity", nearO); stats.opacity++; } catch (e) {}
        }
      }
    }

    // Text styles
    if (node.type === "TEXT") {
      var tn = node as TextNode;
      var tsId = tn.textStyleId;
      if (!tsId || tsId === figma.mixed) {
        var fs = tn.fontSize;
        var fnm = tn.fontName;
        if (typeof fs === "number" && fnm && typeof fnm === "object" && "family" in fnm) {
          var bestTs: TextStyle | null = null;
          var bestScore = 0;
          for (var ltsi = 0; ltsi < localTextStyles.length; ltsi++) {
            var ts = localTextStyles[ltsi];
            var score = 0;
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
    if ("effects" in node && node.effects && node.effects.length > 0) {
      var esId = "effectStyleId" in node ? (node as any).effectStyleId : null;
      if (!esId) {
        // Try to match by serialized CSS
        var nodeShadows: string[] = [];
        for (var nei = 0; nei < node.effects.length; nei++) {
          var css = shadowToCSS(node.effects[nei]);
          if (css) nodeShadows.push(css);
        }
        if (nodeShadows.length > 0) {
          var nodeKey = nodeShadows.join("|");
          for (var esi = 0; esi < localEffectStyles.length; esi++) {
            var es = localEffectStyles[esi];
            var esShadows: string[] = [];
            for (var esj = 0; esj < es.effects.length; esj++) {
              var esCss = shadowToCSS(es.effects[esj]);
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

// ── File Type Detection ──────────────────────────────────────────────────────

export async function detectFileType(): Promise<"existing" | "fresh" | "managed"> {
  await figma.loadAllPagesAsync();
  var pages = figma.root.children;
  var contentPages = 0;
  var totalChildren = 0;

  for (var pi = 0; pi < pages.length; pi++) {
    if (pages[pi].children.length > 0) {
      contentPages++;
      totalChildren += pages[pi].children.length;
    }
  }

  // Empty or near-empty file
  if (contentPages === 0 || totalChildren <= 1) return "fresh";

  // Check for standard pages
  var standardHints = ["cover", "foundations", "components", "desktop", "mobile"];
  var foundStandard = 0;
  for (var shi2 = 0; shi2 < standardHints.length; shi2++) {
    for (var pj = 0; pj < pages.length; pj++) {
      var norm = pages[pj].name.toLowerCase().replace(/[^a-z]/g, "");
      if (norm.indexOf(standardHints[shi2]) !== -1) { foundStandard++; break; }
    }
  }

  // Check for local variables
  var localVars = await figma.variables.getLocalVariablesAsync();
  var colorVarCount = localVars.filter(function(v) { return v.resolvedType === "COLOR"; }).length;

  // Already managed: has most standard pages AND has variables
  if (foundStandard >= 4 && colorVarCount > 5) return "managed";

  // Existing design: has content but not plugin-managed
  return "existing";
}
