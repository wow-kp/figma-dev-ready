// component-detection.ts — AI-powered component detection for Route B
// Serializes the design tree into compact chunks for AI analysis,
// then creates component sets and swaps originals with instances.

import { findPageByHint, rgb01ToHex, loadFontWithFallback } from './utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SerializedNode {
  id: string;
  t: string;    // "F" | "T" | "R" | "V" | "I" | "G" | "S" | "E" | "L" | "P"
  n: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // Visual
  f?: string;
  s?: string;
  sw?: number;
  r?: number;
  o?: number;
  // Layout
  l?: string;   // "H" | "V" | "W"
  p?: number[];
  g?: number;
  ax?: string;
  cx?: string;
  // Text
  txt?: string;
  fs?: number;
  fw?: number;
  ta?: string;
  td?: string;
  ff?: string;
  // Flags
  img?: boolean;
  clip?: boolean;
  abs?: boolean;
  exp?: boolean;
  shadow?: boolean;
  // Children
  c?: SerializedNode[];
  cc?: number;
}

export interface ChunkData {
  page: string;
  frameName: string;
  frameId: string;
  tree: SerializedNode;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_MAP: { [k: string]: string } = {
  FRAME: "F", TEXT: "T", RECTANGLE: "R", VECTOR: "V", INSTANCE: "I",
  GROUP: "G", SECTION: "S", ELLIPSE: "E", LINE: "L", POLYGON: "P",
  COMPONENT: "F", COMPONENT_SET: "F", STAR: "P", BOOLEAN_OPERATION: "F"
};

function nodeTypeCode(type: string): string {
  return TYPE_MAP[type] || "F";
}

function firstSolidFillHex(node: SceneNode): string | null {
  if (!("fills" in node) || !Array.isArray(node.fills)) return null;
  for (let i = 0; i < node.fills.length; i++) {
    const fill = node.fills[i];
    if (fill.type === "SOLID" && fill.visible !== false) {
      return rgb01ToHex(fill.color.r, fill.color.g, fill.color.b);
    }
  }
  return null;
}

function firstSolidStrokeHex(node: SceneNode): string | null {
  if (!("strokes" in node) || !Array.isArray(node.strokes)) return null;
  for (let i = 0; i < node.strokes.length; i++) {
    const stroke = node.strokes[i];
    if (stroke.type === "SOLID" && stroke.visible !== false) {
      return rgb01ToHex(stroke.color.r, stroke.color.g, stroke.color.b);
    }
  }
  return null;
}

function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node) || !Array.isArray(node.fills)) return false;
  for (let i = 0; i < node.fills.length; i++) {
    if (node.fills[i].type === "IMAGE" && node.fills[i].visible !== false) return true;
  }
  return false;
}

function hasShadowEffect(node: SceneNode): boolean {
  if (!("effects" in node) || !node.effects) return false;
  for (let i = 0; i < node.effects.length; i++) {
    const t = node.effects[i].type;
    if ((t === "DROP_SHADOW" || t === "INNER_SHADOW") && node.effects[i].visible !== false) return true;
  }
  return false;
}

// ── Layer Renaming ──────────────────────────────────────────────────────────

/** Convert a string to kebab-case: "My Layer Name" → "my-layer-name" */
function toKebab(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** Check if a name is a Figma default (e.g., "Frame 12", "Rectangle 45") */
function isFigmaDefaultName(name: string): boolean {
  return /^(Frame|Rectangle|Ellipse|Line|Vector|Group|Polygon|Star|Component|Section|Image)\s*\d*$/i.test(name);
}

/**
 * Generate a purpose-based kebab-case name for a node.
 * componentType is the detected component type (e.g., "button", "input", "card").
 */
function semanticLayerName(node: SceneNode, componentType: string): string {
  const name = node.name || "";
  const nameLower = name.toLowerCase();

  // If already clean kebab-case and not a Figma default, keep it
  if (/^[a-z][a-z0-9-]*$/.test(name) && !isFigmaDefaultName(name)) {
    return name;
  }

  // TEXT nodes — name by role in the component
  if (node.type === "TEXT") {
    // Check original name for hints
    if (/label/i.test(nameLower)) return "label";
    if (/placeholder/i.test(nameLower)) return "placeholder";
    if (/title/i.test(nameLower)) return "title";
    if (/subtitle|description|desc/i.test(nameLower)) return "description";
    if (/caption/i.test(nameLower)) return "caption";
    if (/price/i.test(nameLower)) return "price";
    if (/badge/i.test(nameLower)) return "badge-text";
    if (/error|message/i.test(nameLower)) return "message";

    // Derive from component type
    if (componentType === "button") return "label";
    if (componentType === "input") {
      const txt = (node as TextNode).characters || "";
      if (/enter|type|search|email|password/i.test(txt)) return "placeholder";
      return "label";
    }
    if (componentType === "card") {
      const fs = typeof (node as TextNode).fontSize === "number" ? (node as TextNode).fontSize : 14;
      if (fs >= 18) return "title";
      return "description";
    }
    if (componentType === "nav-item" || componentType === "tag" || componentType === "badge") return "label";
    return "label";
  }

  // Image fills
  if (hasImageFill(node)) return "image";

  // Vectors → icon
  if (node.type === "VECTOR") return "icon";
  if (node.type === "LINE") return "divider";
  if (node.type === "ELLIPSE") {
    if (/avatar/i.test(nameLower)) return "avatar";
    return "shape";
  }

  // Rectangles — background or divider
  if (node.type === "RECTANGLE") {
    if (/background|bg/i.test(nameLower)) return "background";
    if ((node as any).width > (node as any).height * 5) return "divider";
    // Check if it has stroke but no fill → likely an outline/border element
    const hasFill = firstSolidFillHex(node) !== null || hasImageFill(node);
    const hasStroke = firstSolidStrokeHex(node) !== null;
    if (hasStroke && !hasFill) return "border";
    return "background";
  }

  // Frames/groups — use original name if meaningful, else derive from context
  if (!isFigmaDefaultName(name) && name.length > 0) {
    const kebab = toKebab(name);
    if (kebab.length > 0) return kebab;
  }

  // Fallback based on component type
  if (node.type === "FRAME" || node.type === "COMPONENT" || node.type === "INSTANCE") {
    if (componentType === "input") return "field";
    if (componentType === "card") return "content";
    if (componentType === "dropdown") return "field-wrapper";
    return "container";
  }
  if (node.type === "GROUP") return "group";

  return "element";
}

/** Recursively rename child layers of a component to clean, purpose-based names */
function renameComponentLayers(node: SceneNode, componentType: string, depth: number): void {
  if (depth > 0) {
    node.name = semanticLayerName(node, componentType);
  }

  if ("children" in node && (node as any).children) {
    const ch = (node as any).children as SceneNode[];
    for (let ci = 0; ci < ch.length; ci++) {
      renameComponentLayers(ch[ci], componentType, depth + 1);
    }
  }
}

/**
 * Set up proper auto-layout and responsive sizing on a component.
 * Converts fixed-dimension frames to auto-layout with HUG/FILL.
 */
function applyResponsiveLayout(node: SceneNode, componentType: string, depth: number, varCache?: VarCache | null): void {
  // Only process frames (includes components)
  if (node.type !== "FRAME" && node.type !== "COMPONENT" && node.type !== "INSTANCE") return;

  const frame = node as FrameNode;

  // Skip if already has auto-layout — just recurse for child sizing
  if (frame.layoutMode !== "NONE") {
    if ("children" in frame) {
      const ch = frame.children as SceneNode[];
      for (let i = 0; i < ch.length; i++) {
        applyResponsiveLayout(ch[i], componentType, depth + 1, varCache);
      }
    }
    return;
  }

  let children = ("children" in frame) ? (frame.children as SceneNode[]).slice() : [];
  if (children.length === 0) return;

  // ── Record original geometry BEFORE any recursion changes child sizes ──
  const frameW = (frame as any).width as number;
  const frameH = (frame as any).height as number;

  const originals: { node: SceneNode; x: number; y: number; w: number; h: number }[] = [];
  for (let oi = 0; oi < children.length; oi++) {
    const c = children[oi] as any;
    originals.push({ node: children[oi], x: c.x, y: c.y, w: c.width || 0, h: c.height || 0 });
  }

  // ── Check if children can be converted to auto-layout ──
  // Children that overlap significantly should stay absolute-positioned
  const canAutoLayout = childrenCanAutoLayout(originals);

  if (!canAutoLayout) {
    // Keep absolute positioning — just recurse into child frames
    for (let ri2 = 0; ri2 < children.length; ri2++) {
      applyResponsiveLayout(children[ri2], componentType, depth + 1, varCache);
    }
    return;
  }

  // Recurse into children AFTER recording geometry (bottom-up)
  for (let ri = 0; ri < children.length; ri++) {
    applyResponsiveLayout(children[ri], componentType, depth + 1, varCache);
  }

  // ── Infer direction from ORIGINAL positions ──
  const direction = inferLayoutDirection(originals);

  // ── Sort children by position along the layout axis ──
  const sortedOriginals = originals.slice().sort(function(a, b) {
    return direction === "VERTICAL" ? a.y - b.y : a.x - b.x;
  });

  // Reorder children in the frame to match spatial order
  for (let so = 0; so < sortedOriginals.length; so++) {
    try { frame.appendChild(sortedOriginals[so].node); } catch (e) {}
  }
  // Re-read children in new order
  children = (frame.children as SceneNode[]).slice();

  // ── Infer gap and padding from original positions ──
  const gap = inferGap(sortedOriginals, direction);
  const padding = inferPadding(sortedOriginals, frameW, frameH);

  // ── Infer alignment from original positions ──
  const align = inferAlignment(originals, direction, frameW, frameH);

  // ── Apply auto-layout ──
  frame.layoutMode = direction;
  frame.itemSpacing = gap;
  frame.primaryAxisAlignItems = align.primary;
  frame.counterAxisAlignItems = align.counter;
  frame.paddingLeft = padding.left;
  frame.paddingRight = padding.right;
  frame.paddingTop = padding.top;
  frame.paddingBottom = padding.bottom;

  // Sizing: HUG by default
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";

  // ── Bind spacing values to variables (or create new ones) ──
  if (varCache) {
    bindSpacingVar(frame, "paddingLeft", varCache);
    bindSpacingVar(frame, "paddingRight", varCache);
    bindSpacingVar(frame, "paddingTop", varCache);
    bindSpacingVar(frame, "paddingBottom", varCache);
    bindSpacingVar(frame, "itemSpacing", varCache);
  }

  // ── Set child sizing intelligently based on original geometry ──
  for (let si = 0; si < children.length; si++) {
    const child = children[si];
    let orig: { x: number; y: number; w: number; h: number } | null = null;
    for (let fi = 0; fi < originals.length; fi++) {
      if (originals[fi].node === child) { orig = originals[fi]; break; }
    }
    if (!orig) continue;

    try {
      if (child.type === "TEXT") {
        const textSpansWidth = orig.w >= frameW * 0.8;
        (child as any).layoutSizingHorizontal = textSpansWidth ? "FILL" : "HUG";
        (child as any).layoutSizingVertical = "HUG";
      } else if (child.type === "FRAME" || child.type === "COMPONENT" || child.type === "INSTANCE") {
        const spansH = orig.w >= frameW * 0.8;
        const spansV = orig.h >= frameH * 0.8;
        if (direction === "VERTICAL") {
          (child as any).layoutSizingHorizontal = spansH ? "FILL" : "HUG";
          (child as any).layoutSizingVertical = "HUG";
        } else {
          (child as any).layoutSizingHorizontal = "HUG";
          (child as any).layoutSizingVertical = spansV ? "FILL" : "HUG";
        }
      } else if (child.type === "RECTANGLE") {
        const isBackground = orig.w >= frameW * 0.9 && orig.h >= frameH * 0.9;
        if (isBackground) {
          (child as any).layoutSizingHorizontal = "FILL";
          (child as any).layoutSizingVertical = "FILL";
        } else if (direction === "VERTICAL" && orig.w >= frameW * 0.8) {
          (child as any).layoutSizingHorizontal = "FILL";
        }
      }
    } catch (e) {}
  }
}

/** Check if children can be cleanly arranged in auto-layout (no significant overlaps) */
function childrenCanAutoLayout(originals: { x: number; y: number; w: number; h: number }[]): boolean {
  if (originals.length <= 1) return true;

  // Check for significant overlap between children
  for (let i = 0; i < originals.length; i++) {
    for (let j = i + 1; j < originals.length; j++) {
      const a = originals[i], b = originals[j];
      // Calculate overlap area
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      const overlapArea = overlapX * overlapY;
      const smallerArea = Math.min(a.w * a.h, b.w * b.h);
      // If overlap is more than 50% of the smaller element, can't auto-layout
      if (smallerArea > 0 && overlapArea > smallerArea * 0.5) return false;
    }
  }
  return true;
}

/** Infer padding from original child positions relative to frame edges */
function inferPadding(
  sortedOriginals: { x: number; y: number; w: number; h: number }[],
  frameW: number,
  frameH: number
): { top: number; right: number; bottom: number; left: number } {
  let minChildX = Infinity, minChildY = Infinity;
  let maxChildR = -Infinity, maxChildB = -Infinity;

  for (let i = 0; i < sortedOriginals.length; i++) {
    const o = sortedOriginals[i];
    if (o.x < minChildX) minChildX = o.x;
    if (o.y < minChildY) minChildY = o.y;
    const r = o.x + o.w;
    const b = o.y + o.h;
    if (r > maxChildR) maxChildR = r;
    if (b > maxChildB) maxChildB = b;
  }

  return {
    left: Math.max(0, Math.round(minChildX)),
    right: Math.max(0, Math.round(frameW - maxChildR)),
    top: Math.max(0, Math.round(minChildY)),
    bottom: Math.max(0, Math.round(frameH - maxChildB))
  };
}

/** Bind a spacing property to an existing variable, or create a new one */
function bindSpacingVar(frame: FrameNode, prop: string, cache: VarCache): void {
  const val = (frame as any)[prop];
  if (typeof val !== "number" || val <= 0) return;
  const bv = (frame.boundVariables as any)?.[prop];
  if (bv) return;
  const existing = findNearestFloatCached(val, cache.spacing);
  if (existing) {
    try { frame.setBoundVariable(prop as any, existing); } catch (e) {}
    return;
  }
  // Create a new spacing variable
  const newVar = createSpacingVariable(Math.round(val), cache);
  if (newVar) {
    try { frame.setBoundVariable(prop as any, newVar); } catch (e) {}
  }
}

/** Create a new spacing variable and add it to the cache */
function createSpacingVariable(value: number, cache: VarCache): Variable | null {
  if (!cache.spacingCollection) return null;
  try {
    const modeId = cache.spacingCollection.modes[0]?.modeId ?? null;
    if (!modeId) return null;
    const varName = "spacing/" + value;
    // Check if this exact name already exists (avoid duplicates)
    for (let i = 0; i < cache.spacing.length; i++) {
      if (cache.spacing[i].value === value) return cache.spacing[i].variable;
    }
    const newVar = figma.variables.createVariable(varName, cache.spacingCollection, "FLOAT");
    newVar.setValueForMode(modeId, value);
    cache.spacing.push({ variable: newVar, value: value });
    return newVar;
  } catch (e) {
    return null;
  }
}

/** Infer layout direction from original child positions */
function inferLayoutDirection(originals: { x: number; y: number; w: number; h: number }[]): "HORIZONTAL" | "VERTICAL" {
  if (originals.length < 2) return "VERTICAL";

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < originals.length; i++) {
    const o = originals[i];
    if (o.x < minX) minX = o.x;
    if (o.x + o.w > maxX) maxX = o.x + o.w;
    if (o.y < minY) minY = o.y;
    if (o.y + o.h > maxY) maxY = o.y + o.h;
  }
  const xRange = maxX - minX;
  const yRange = maxY - minY;

  return yRange > xRange ? "VERTICAL" : "HORIZONTAL";
}

/** Infer gap between children from their original positions */
function inferGap(originals: { x: number; y: number; w: number; h: number }[], direction: "HORIZONTAL" | "VERTICAL"): number {
  if (originals.length < 2) return 0;

  const sorted = originals.slice().sort(function(a, b) {
    return direction === "VERTICAL" ? a.y - b.y : a.x - b.x;
  });

  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    let gap: number;
    if (direction === "VERTICAL") {
      gap = curr.y - (prev.y + prev.h);
    } else {
      gap = curr.x - (prev.x + prev.w);
    }
    if (gap >= 0) gaps.push(Math.round(gap));
  }

  if (gaps.length === 0) return 0;
  // Use the most common gap (mode)
  const gapCounts: { [g: number]: number } = {};
  for (let gi = 0; gi < gaps.length; gi++) {
    gapCounts[gaps[gi]] = (gapCounts[gaps[gi]] || 0) + 1;
  }
  let bestGap = 0, bestCount = 0;
  const gapKeys = Object.keys(gapCounts);
  for (let gk = 0; gk < gapKeys.length; gk++) {
    if (gapCounts[Number(gapKeys[gk])] > bestCount) {
      bestCount = gapCounts[Number(gapKeys[gk])];
      bestGap = Number(gapKeys[gk]);
    }
  }
  return bestGap;
}

// inferAndApplyPadding replaced by inferPadding (returns values) + direct assignment in applyResponsiveLayout

/** Infer primary and counter axis alignment from original child positions */
function inferAlignment(
  originals: { x: number; y: number; w: number; h: number }[],
  direction: "HORIZONTAL" | "VERTICAL",
  frameW: number,
  frameH: number
): { primary: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN"; counter: "MIN" | "CENTER" | "MAX" } {
  if (originals.length === 0) return { primary: "MIN", counter: "MIN" };

  // Check counter-axis alignment: are children centered, left-aligned, or right-aligned?
  const counterAligns: number[] = [];
  for (let i = 0; i < originals.length; i++) {
    const o = originals[i];
    if (direction === "VERTICAL") {
      // Counter axis is horizontal: check how each child is positioned within frame width
      const centerOffset = (o.x + o.w / 2) - frameW / 2;
      counterAligns.push(centerOffset);
    } else {
      // Counter axis is vertical: check how each child is positioned within frame height
      const centerOffsetV = (o.y + o.h / 2) - frameH / 2;
      counterAligns.push(centerOffsetV);
    }
  }

  // Average offset from center — if near 0, they're centered
  let avgOffset = 0;
  for (let ai = 0; ai < counterAligns.length; ai++) avgOffset += counterAligns[ai];
  avgOffset /= counterAligns.length;

  const crossSize = direction === "VERTICAL" ? frameW : frameH;
  let counter: "MIN" | "CENTER" | "MAX" = "MIN";
  if (Math.abs(avgOffset) < crossSize * 0.1) {
    counter = "CENTER";
  } else if (avgOffset > crossSize * 0.1) {
    counter = "MAX";
  }

  // Primary axis: check if children are centered along the main axis
  const primaryAligns: number[] = [];
  for (let pi = 0; pi < originals.length; pi++) {
    const op = originals[pi];
    if (direction === "VERTICAL") {
      primaryAligns.push((op.y + op.h / 2) - frameH / 2);
    } else {
      primaryAligns.push((op.x + op.w / 2) - frameW / 2);
    }
  }
  let avgPrimary = 0;
  for (let ap = 0; ap < primaryAligns.length; ap++) avgPrimary += primaryAligns[ap];
  avgPrimary /= primaryAligns.length;

  const mainSize = direction === "VERTICAL" ? frameH : frameW;
  let primary: "MIN" | "CENTER" | "MAX" | "SPACE_BETWEEN" = "MIN";
  if (Math.abs(avgPrimary) < mainSize * 0.1) {
    primary = "CENTER";
  }

  return { primary: primary, counter: counter };
}

// ── Serialization ────────────────────────────────────────────────────────────

// Synchronous, depth-limited node serializer — fast because depth is capped
function serializeNode(node: SceneNode, depth: number, maxDepth: number): SerializedNode | null {
  if (!node || node.visible === false) return null;
  if ("width" in node && "height" in node) {
    if ((node as any).width < 4 && (node as any).height < 4) return null;
  }

  if (node.type === "BOOLEAN_OPERATION") {
    return {
      id: node.id, t: "F", n: (node.name || "").substring(0, 40),
      w: Math.round((node as any).width || 0), h: Math.round((node as any).height || 0),
      cc: "children" in node ? (node as any).children.length : 0
    };
  }

  const sn: SerializedNode = {
    id: node.id,
    t: nodeTypeCode(node.type),
    n: (node.name || "").substring(0, 40),
    x: Math.round((node as any).x || 0),
    y: Math.round((node as any).y || 0),
    w: Math.round((node as any).width || 0),
    h: Math.round((node as any).height || 0)
  };

  // Visual properties
  const fillHex = firstSolidFillHex(node);
  if (fillHex) sn.f = fillHex;
  const strokeHex = firstSolidStrokeHex(node);
  if (strokeHex) sn.s = strokeHex;
  if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) sn.sw = Math.round(node.strokeWeight);
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) sn.r = Math.round(node.cornerRadius);
  if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1) sn.o = Math.round(node.opacity * 100) / 100;

  // Layout
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    const frame = node as FrameNode;
    if (frame.layoutMode === "HORIZONTAL") sn.l = "H";
    else if (frame.layoutMode === "VERTICAL") sn.l = "V";
    if (frame.layoutWrap === "WRAP") sn.l = "W";
    const padT = Math.round(frame.paddingTop || 0), padR = Math.round(frame.paddingRight || 0);
    const padB = Math.round(frame.paddingBottom || 0), padL = Math.round(frame.paddingLeft || 0);
    if (padT || padR || padB || padL) sn.p = [padT, padR, padB, padL];
    if (frame.itemSpacing > 0) sn.g = Math.round(frame.itemSpacing);
    if (frame.primaryAxisAlignItems && frame.primaryAxisAlignItems !== "MIN") sn.ax = frame.primaryAxisAlignItems;
    if (frame.counterAxisAlignItems && frame.counterAxisAlignItems !== "MIN") sn.cx = frame.counterAxisAlignItems;
  }

  // Text
  if (node.type === "TEXT") {
    const tn = node as TextNode;
    if (tn.characters) sn.txt = tn.characters.substring(0, 60);
    if (typeof tn.fontSize === "number") sn.fs = tn.fontSize;
    if (typeof tn.fontWeight === "number") sn.fw = tn.fontWeight;
    else if (tn.fontName && typeof tn.fontName === "object" && "style" in tn.fontName) {
      const style = (tn.fontName.style || "").toLowerCase();
      if (style.indexOf("bold") !== -1) sn.fw = 700;
      else if (style.indexOf("semibold") !== -1 || style.indexOf("semi bold") !== -1) sn.fw = 600;
      else if (style.indexOf("medium") !== -1) sn.fw = 500;
      else if (style.indexOf("light") !== -1) sn.fw = 300;
    }
    if (tn.textAlignHorizontal && tn.textAlignHorizontal !== "LEFT") sn.ta = tn.textAlignHorizontal;
    if (tn.textDecoration && tn.textDecoration !== "NONE") sn.td = tn.textDecoration === "UNDERLINE" ? "UNDERLINE" : "STRIKETHROUGH";
    if (tn.fontName && typeof tn.fontName === "object" && "family" in tn.fontName) sn.ff = tn.fontName.family.substring(0, 20);
  }

  // Flags
  if (hasImageFill(node)) sn.img = true;
  if ("clipsContent" in node && (node as FrameNode).clipsContent) sn.clip = true;
  if ("layoutPositioning" in node && (node as any).layoutPositioning === "ABSOLUTE") sn.abs = true;
  if ("exportSettings" in node && node.exportSettings && node.exportSettings.length > 0) sn.exp = true;
  if (hasShadowEffect(node)) sn.shadow = true;

  // Children — hard depth cap
  if (depth < maxDepth && "children" in node && (node as any).children) {
    const children = (node as any).children as SceneNode[];
    const serializedChildren: SerializedNode[] = [];
    for (let i = 0; i < children.length; i++) {
      if (children[i].visible === false) continue;
      const child = serializeNode(children[i], depth + 1, maxDepth);
      if (child) serializedChildren.push(child);
    }
    if (serializedChildren.length > 0) sn.c = serializedChildren;
  } else if ("children" in node && (node as any).children) {
    let vc = 0;
    const ch = (node as any).children as SceneNode[];
    for (let j = 0; j < ch.length; j++) { if (ch[j].visible !== false) vc++; }
    if (vc > 0) sn.cc = vc;
  }

  return sn;
}

// ── Public API ───────────────────────────────────────────────────────────────

// Serialize one frame at a time via message handler. This avoids freezing
// because each frame is a separate message handler invocation.

let _pendingFrames: { page: string; frameId: string; frameName: string }[] = [];
let _collectedChunks: ChunkData[] = [];

export async function startChunkedSerialization(): Promise<void> {
  _pendingFrames = [];
  _collectedChunks = [];

  const pageHints = ["desktop", "mobile"];
  for (let pi = 0; pi < pageHints.length; pi++) {
    const page = findPageByHint(pageHints[pi]);
    if (!page) continue;
    await page.loadAsync();
    for (let fi = 0; fi < page.children.length; fi++) {
      const frame = page.children[fi];
      if (frame.visible === false) continue;
      _pendingFrames.push({ page: pageHints[pi], frameId: frame.id, frameName: frame.name });
    }
  }

  if (_pendingFrames.length === 0) {
    figma.ui.postMessage({ type: "routeb-components-error", error: "No design frames found on Desktop or Mobile pages." });
    return;
  }

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Found " + _pendingFrames.length + " frames to analyze…",
    percent: 5
  });
  figma.ui.postMessage({ type: "routeb-serialize-next" });
}

export async function serializeNextFrame(): Promise<void> {
  if (_pendingFrames.length === 0) {
    figma.ui.postMessage({ type: "routeb-tree-chunks", chunks: _collectedChunks });
    _collectedChunks = [];
    return;
  }

  const total = _pendingFrames.length + _collectedChunks.length;
  const current = _collectedChunks.length;
  const entry = _pendingFrames.shift()!;

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Serializing " + entry.frameName + "… (" + (current + 1) + "/" + total + ")",
    percent: 5 + Math.round((current / total) * 15)
  });

  try {
    const node = await figma.getNodeByIdAsync(entry.frameId);
    if (node && node.type !== "PAGE") {
      const tree = serializeNode(node as SceneNode, 0, 3);
      if (tree) {
        _collectedChunks.push({
          page: entry.page,
          frameName: entry.frameName,
          frameId: entry.frameId,
          tree: tree
        });
      }
    }
  } catch (e) {
    // Skip frame on error
  }

  figma.ui.postMessage({ type: "routeb-serialize-next" });
}

// ── Component Creation (chunked via message ping-pong) ───────────────────────

interface VariantSpec {
  name: string;
  properties: { [key: string]: string };
  nodeIds: string[];
  associatedNodeIds?: { [frameId: string]: string[] };
}

interface ComponentSpec {
  name: string;
  type: string;
  description: string;
  variants: VariantSpec[];
  inputTextRole?: "label" | "placeholder"; // for input-type: which text role to normalize
}

interface ComponentCreationResult {
  componentsCreated: number;
  variantsCreated: number;
  instancesSwapped: number;
  errors: string[];
}

// Persistent state for chunked creation
let _createPending: ComponentSpec[] = [];
let _createResult: ComponentCreationResult = { componentsCreated: 0, variantsCreated: 0, instancesSwapped: 0, errors: [] };
let _createVarCache: VarCache | null = null;
let _createComponentsPage: PageNode | null = null;
let _createYOffset: number = 0;
// Accumulated swap map: filled during creation, used during swap phase
let _pendingSwaps: { originalId: string; variant: ComponentNode; associatedIds?: string[] }[] = [];
// ID-only version for persistence (sent to UI in stats, survives plugin restart)
let _pendingSwapIds: { originalId: string; variantNodeId: string; associatedIds?: string[] }[] = [];

/**
 * Step 1: Store components, load the Components page, then bounce to step 2.
 * Each step is a separate message handler to yield the Figma UI thread.
 */
export async function startComponentCreation(components: ComponentSpec[]): Promise<void> {
  _createPending = components.slice();
  _createResult = { componentsCreated: 0, variantsCreated: 0, instancesSwapped: 0, errors: [] };
  _createVarCache = null;
  _pendingSwaps = [];
  _pendingSwapIds = [];

  const componentsPage = findPageByHint("components");
  if (!componentsPage) {
    figma.ui.postMessage({ type: "routeb-components-error", error: "Components page not found" });
    return;
  }
  _createComponentsPage = componentsPage;

  // Load ALL pages we'll need: Components (target) + Desktop/Mobile (source nodes to clone)
  await componentsPage.loadAsync();
  const desktopPage = findPageByHint("desktop");
  if (desktopPage) await desktopPage.loadAsync();
  const mobilePage = findPageByHint("mobile");
  if (mobilePage) await mobilePage.loadAsync();

  // Calculate starting Y offset below existing content on Components page
  _createYOffset = 0;
  for (let ci = 0; ci < componentsPage.children.length; ci++) {
    const child = componentsPage.children[ci];
    const bottom = child.y + (child as any).height;
    if (bottom > _createYOffset) _createYOffset = bottom;
  }
  if (_createYOffset > 0) _createYOffset += 80; // gap from existing content

  figma.ui.postMessage({ type: "routeb-components-progress", phase: "Loading pages…", percent: 3 });
  figma.ui.postMessage({ type: "routeb-create-load-vars" });
}

/**
 * Step 2: Load variables and build cache, then kick off per-component ping-pong.
 */
export async function loadVarsAndStartCreation(): Promise<void> {
  figma.ui.postMessage({ type: "routeb-components-progress", phase: "Loading variables…", percent: 5 });
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allCols = await figma.variables.getLocalVariableCollectionsAsync();

  const colorVars = allVars.filter(function(v) { return v.resolvedType === "COLOR"; });
  const floatVars = allVars.filter(function(v) { return v.resolvedType === "FLOAT"; });
  const colMap: { [id: string]: string } = {};
  for (let ci = 0; ci < allCols.length; ci++) {
    colMap[allCols[ci].id] = allCols[ci].name.toLowerCase();
  }
  const spacingVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("spacing") !== -1; });
  const radiusVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("radius") !== -1; });
  const borderVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("border") !== -1; });
  _createVarCache = buildVarCacheSync(colorVars, spacingVars, radiusVars, borderVars, allCols);

  // Now start per-component ping-pong
  figma.ui.postMessage({ type: "routeb-create-next" });
}

/**
 * After component creation, replace design-specific text in input-type components
 * with a generic placeholder so instances can override with their own label/placeholder.
 * role = "label"      → set text to "Label"
 * role = "placeholder" → set text to "Placeholder"
 */
async function normalizeComponentTextPlaceholders(comp: ComponentNode, role: "label" | "placeholder"): Promise<void> {
  const genericText = role === "placeholder" ? "Placeholder" : "Label";
  const textNodes: { node: TextNode; name: string }[] = [];
  collectTextNodesNamed(comp, textNodes);
  if (textNodes.length === 0) return;

  // For inputs: the first "label" or "placeholder" named text node gets normalized.
  // If none found by name, normalize the first text node.
  let targetIdx = -1;
  for (let i = 0; i < textNodes.length; i++) {
    const nLower = textNodes[i].name.toLowerCase();
    if (nLower === role || nLower === "label" || nLower === "placeholder") {
      targetIdx = i;
      break;
    }
  }
  if (targetIdx < 0) targetIdx = 0;

  const tn = textNodes[targetIdx].node;
  if (tn.characters === genericText) return; // already normalized

  try {
    await loadTextNodeFont(tn);
    tn.characters = genericText;
    // Also rename the layer to match the role
    tn.name = role;
  } catch (e) { /* skip if font unavailable */ }
}

/**
 * Step 2: Process ONE component per message round-trip.
 * Called each time the UI bounces back routeb-create-next.
 */
export async function createNextComponent(): Promise<void> {
  if (_createPending.length === 0 || !_createComponentsPage || !_createVarCache) {
    // All done — send final result with swap map for persistence
    figma.ui.postMessage({ type: "routeb-components-created", stats: _createResult, swapMap: _pendingSwapIds });
    _createVarCache = null;
    _createComponentsPage = null;
    return;
  }

  const totalComponents = _createPending.length + _createResult.componentsCreated + _createResult.errors.length;
  const currentIdx = _createResult.componentsCreated + _createResult.errors.length;
  const compSpec = _createPending.shift()!;

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Creating " + compSpec.name + "… (" + (currentIdx + 1) + "/" + totalComponents + ")",
    percent: 10 + Math.round((currentIdx / totalComponents) * 85)
  });

  try {
    const variantComps: ComponentNode[] = [];
    const swapMap: { originalId: string; variant: ComponentNode; associatedIds: string[] }[] = [];

    for (let vIdx = 0; vIdx < compSpec.variants.length; vIdx++) {
      const varSpec = compSpec.variants[vIdx];
      if (!varSpec.nodeIds || varSpec.nodeIds.length === 0) continue;

      const repNode = await figma.getNodeByIdAsync(varSpec.nodeIds[0]);
      if (!repNode) {
        _createResult.errors.push("Node not found: " + varSpec.nodeIds[0]);
        continue;
      }

      // Clone the node and convert directly to a component — preserves all
      // children, layout, fills, strokes, effects, etc. without manual transfer.
      let cloned = (repNode as SceneNode).clone();

      // If there are associated nodes (e.g., text labels not nested inside the frame),
      // wrap everything in a frame preserving relative positions from the original design.
      const repId = varSpec.nodeIds[0];
      const assocIds = (varSpec.associatedNodeIds && varSpec.associatedNodeIds[repId]) || [];
      if (assocIds.length > 0) {
        // Collect absolute bounding boxes of the main frame + all associated nodes
        const repScene = repNode as SceneNode;
        let repAbs = (repScene as any).absoluteBoundingBox as { x: number; y: number; width: number; height: number } | null;
        if (!repAbs) repAbs = { x: 0, y: 0, width: (repScene as any).width || 100, height: (repScene as any).height || 40 };

        // Gather all nodes' absolute bounds to compute the overall bounding box
        const allBounds: { x: number; y: number; w: number; h: number; node: SceneNode | null; isMain: boolean }[] = [];
        allBounds.push({ x: repAbs.x, y: repAbs.y, w: repAbs.width, h: repAbs.height, node: null, isMain: true });

        const assocNodes: SceneNode[] = [];
        for (let ai = 0; ai < assocIds.length; ai++) {
          const assocNode = await figma.getNodeByIdAsync(assocIds[ai]);
          if (assocNode && assocNode.type !== "PAGE" && assocNode.type !== "DOCUMENT") {
            const aScene = assocNode as SceneNode;
            const aAbs = (aScene as any).absoluteBoundingBox as { x: number; y: number; width: number; height: number } | null;
            if (aAbs) {
              allBounds.push({ x: aAbs.x, y: aAbs.y, w: aAbs.width, h: aAbs.height, node: aScene, isMain: false });
              assocNodes.push(aScene);
            }
          }
        }

        // Compute bounding box encompassing everything
        let minX = allBounds[0].x, minY = allBounds[0].y;
        let maxX = allBounds[0].x + allBounds[0].w, maxY = allBounds[0].y + allBounds[0].h;
        for (let bi = 1; bi < allBounds.length; bi++) {
          if (allBounds[bi].x < minX) minX = allBounds[bi].x;
          if (allBounds[bi].y < minY) minY = allBounds[bi].y;
          if (allBounds[bi].x + allBounds[bi].w > maxX) maxX = allBounds[bi].x + allBounds[bi].w;
          if (allBounds[bi].y + allBounds[bi].h > maxY) maxY = allBounds[bi].y + allBounds[bi].h;
        }

        // Create wrapper with no auto-layout — use absolute positioning
        const wrapper = figma.createFrame();
        wrapper.name = cloned.name;
        wrapper.resize(Math.max(1, Math.round(maxX - minX)), Math.max(1, Math.round(maxY - minY)));
        wrapper.fills = [];
        wrapper.clipsContent = false;

        // Place main frame at its relative position within the wrapper
        wrapper.appendChild(cloned);
        cloned.x = Math.round(repAbs.x - minX);
        cloned.y = Math.round(repAbs.y - minY);

        // Clone and place associated nodes at their relative positions
        for (let ai2 = 0; ai2 < allBounds.length; ai2++) {
          if (allBounds[ai2].isMain) continue;
          const assocCloned = (allBounds[ai2].node as SceneNode).clone();
          wrapper.appendChild(assocCloned);
          assocCloned.x = Math.round(allBounds[ai2].x - minX);
          assocCloned.y = Math.round(allBounds[ai2].y - minY);
        }

        cloned = wrapper as any;
      }

      const comp = figma.createComponentFromNode(cloned);

      // Rename inner layers to clean, purpose-based kebab-case names
      renameComponentLayers(comp, compSpec.type, 0);

      // Convert to responsive auto-layout with HUG/FILL sizing, bind/create spacing vars
      applyResponsiveLayout(comp, compSpec.type, 0, _createVarCache);

      // For input-type components: normalize the label/placeholder text to a generic value
      // so each swapped instance can independently override it with the design-specific text
      if (compSpec.type === "input" && compSpec.inputTextRole) {
        await normalizeComponentTextPlaceholders(comp, compSpec.inputTextRole);
      }

      const propParts: string[] = [];
      const propKeys = Object.keys(varSpec.properties);
      for (let pk = 0; pk < propKeys.length; pk++) {
        propParts.push(propKeys[pk] + "=" + varSpec.properties[propKeys[pk]]);
      }
      comp.name = propParts.join(", ") || varSpec.name;

      variantComps.push(comp);
      _createResult.variantsCreated++;

      for (let ni = 0; ni < varSpec.nodeIds.length; ni++) {
        const swapAssoc = (varSpec.associatedNodeIds && varSpec.associatedNodeIds[varSpec.nodeIds[ni]]) || [];
        swapMap.push({ originalId: varSpec.nodeIds[ni], variant: comp, associatedIds: swapAssoc });
      }
    }

    if (variantComps.length > 0) {
      // Ensure unique variant names
      const usedNames: { [key: string]: number } = {};
      for (let un = 0; un < variantComps.length; un++) {
        const vName = variantComps[un].name;
        if (usedNames[vName]) {
          usedNames[vName]++;
          variantComps[un].name = vName + " " + usedNames[vName];
        } else {
          usedNames[vName] = 1;
        }
      }

      // Move to Components page
      for (let mp = 0; mp < variantComps.length; mp++) {
        _createComponentsPage!.appendChild(variantComps[mp]);
      }

      // Combine as variant set
      try {
        const compSet = figma.combineAsVariants(variantComps, _createComponentsPage!);
        compSet.name = compSpec.name;
        compSet.layoutMode = "HORIZONTAL";
        compSet.itemSpacing = 24;
        compSet.paddingTop = 24;
        compSet.paddingBottom = 24;
        compSet.paddingLeft = 24;
        compSet.paddingRight = 24;
        compSet.primaryAxisSizingMode = "AUTO";
        compSet.counterAxisSizingMode = "AUTO";
        compSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        compSet.cornerRadius = 12;

        // Position below previous component sets
        compSet.x = 0;
        compSet.y = _createYOffset;
        _createYOffset += compSet.height + 48;
      } catch (combineErr) {
        _createResult.errors.push("Could not combine variants for " + compSpec.name + ": " + String(combineErr));
      }

      _createResult.componentsCreated++;

      // Bind variables (synchronous)
      for (let bvi = 0; bvi < variantComps.length; bvi++) {
        bindVariablesOnNode(variantComps[bvi], _createVarCache!);
      }

      // Accumulate swaps for the separate swap phase (store IDs for persistence)
      for (let si = 0; si < swapMap.length; si++) {
        _pendingSwaps.push(swapMap[si]);
        _pendingSwapIds.push({ originalId: swapMap[si].originalId, variantNodeId: swapMap[si].variant.id, associatedIds: swapMap[si].associatedIds });
      }
    }
  } catch (e) {
    _createResult.errors.push("Error creating " + compSpec.name + ": " + String(e));
  }

  // Request next round-trip
  figma.ui.postMessage({ type: "routeb-create-next" });
}

// ── Swap Phase (separate step) ──────────────────────────────────────────────

let _swapPending: { originalId: string; variant: ComponentNode; associatedIds?: string[] }[] = [];
let _swapResult: { instancesSwapped: number; errors: string[] } = { instancesSwapped: 0, errors: [] };

export async function startSwapInstances(swapMapFromUI?: { originalId: string; variantNodeId: string; associatedIds?: string[] }[]): Promise<void> {
  _swapResult = { instancesSwapped: 0, errors: [] };

  // Load Desktop/Mobile pages for node access
  const desktopPage = findPageByHint("desktop");
  if (desktopPage) await desktopPage.loadAsync();
  const mobilePage = findPageByHint("mobile");
  if (mobilePage) await mobilePage.loadAsync();
  const componentsPage = findPageByHint("components");
  if (componentsPage) await componentsPage.loadAsync();

  // Use in-memory swaps if available, otherwise reconstruct from persisted IDs
  if (_pendingSwaps.length > 0) {
    _swapPending = _pendingSwaps.slice();
  } else if (swapMapFromUI && swapMapFromUI.length > 0) {
    _swapPending = [];
    for (let i = 0; i < swapMapFromUI.length; i++) {
      const entry = swapMapFromUI[i];
      const variantNode = await figma.getNodeByIdAsync(entry.variantNodeId);
      if (variantNode && variantNode.type === "COMPONENT") {
        _swapPending.push({ originalId: entry.originalId, variant: variantNode as ComponentNode, associatedIds: (entry as any).associatedIds });
      }
    }
  } else {
    figma.ui.postMessage({ type: "routeb-components-error", error: "No swap data available. Re-create components first." });
    return;
  }

  figma.ui.postMessage({ type: "routeb-components-progress", phase: "Swapping instances…", percent: 5 });
  figma.ui.postMessage({ type: "routeb-swap-next" });
}

/**
 * After all swaps are done, scan each design page and group instances that sit
 * at the same Y-coordinate (within 4px) in the same parent into "form-row" frames.
 * This handles forms where multiple input instances belong on the same visual row.
 */
async function groupFormRowsOnPages(): Promise<void> {
  const pageHints = ["desktop", "mobile"];
  for (let pi = 0; pi < pageHints.length; pi++) {
    const page = findPageByHint(pageHints[pi]);
    if (!page) continue;
    groupFormRowsInContainer(page);
  }
}

function groupFormRowsInContainer(container: ChildrenMixin): void {
  if (!("children" in container)) return;
  let children = (container as any).children as SceneNode[];

  // Recurse into non-instance frames first
  for (let ci = 0; ci < children.length; ci++) {
    const child = children[ci];
    if (child.type === "FRAME" && child.name !== "form-row") {
      groupFormRowsInContainer(child as FrameNode);
    }
  }

  // Re-read children after recursion (they may have changed)
  children = (container as any).children as SceneNode[];

  // Find all INSTANCE children (swapped form fields)
  const instances: { node: InstanceNode; y: number; x: number }[] = [];
  for (let ii = 0; ii < children.length; ii++) {
    if (children[ii].type === "INSTANCE") {
      const inst = children[ii] as InstanceNode;
      instances.push({ node: inst, y: Math.round((inst as any).y || 0), x: Math.round((inst as any).x || 0) });
    }
  }

  if (instances.length < 2) return;

  // Group by Y position (within 4px tolerance)
  const rows: { y: number; items: { node: InstanceNode; x: number }[] }[] = [];
  for (let ij = 0; ij < instances.length; ij++) {
    const inst2 = instances[ij];
    let placed = false;
    for (let rk = 0; rk < rows.length; rk++) {
      if (Math.abs(rows[rk].y - inst2.y) <= 4) {
        rows[rk].items.push({ node: inst2.node, x: inst2.x });
        placed = true;
        break;
      }
    }
    if (!placed) rows.push({ y: inst2.y, items: [{ node: inst2.node, x: inst2.x }] });
  }

  // Only group rows that have 2+ instances
  for (let ri = 0; ri < rows.length; ri++) {
    if (rows[ri].items.length < 2) continue;

    // Sort items by X position (left to right)
    rows[ri].items.sort(function(a, b) { return a.x - b.x; });

    // Check parent layout mode — skip grouping if already in auto-layout
    // (auto-layout parent already handles the row correctly)
    const parentFrame = container as any;
    if (parentFrame.layoutMode && parentFrame.layoutMode !== "NONE") continue;

    const rowItems = rows[ri].items;

    // Calculate bounding box for this row
    const rowMinX = rowItems[0].x;
    const rowMinY = rows[ri].y;
    let rowMaxX = rowMinX;
    let rowMaxH = 0;
    for (let ki = 0; ki < rowItems.length; ki++) {
      const itemNode = rowItems[ki].node as any;
      const itemRight = rowItems[ki].x + (itemNode.width || 0);
      const itemH = itemNode.height || 0;
      if (itemRight > rowMaxX) rowMaxX = itemRight;
      if (itemH > rowMaxH) rowMaxH = itemH;
    }

    // Find insert index (position of first item in parent)
    const firstChild = rowItems[0].node;
    const parentChildren = (container as any).children as SceneNode[];
    let insertIdx = 0;
    for (let qi = 0; qi < parentChildren.length; qi++) {
      if (parentChildren[qi].id === firstChild.id) { insertIdx = qi; break; }
    }

    // Create form-row frame
    try {
      const rowFrame = figma.createFrame();
      rowFrame.name = "form-row";
      rowFrame.fills = [];
      rowFrame.clipsContent = false;
      rowFrame.resize(Math.max(1, rowMaxX - rowMinX), Math.max(1, rowMaxH));
      rowFrame.x = rowMinX;
      rowFrame.y = rowMinY;

      // Move instances into row frame, adjusting to local coordinates
      for (let mi = 0; mi < rowItems.length; mi++) {
        const moveNode = rowItems[mi].node as any;
        const localX = rowItems[mi].x - rowMinX;
        const localY = (moveNode.y || 0) - rowMinY;
        (container as any).insertChild(insertIdx, rowFrame); // ensure frame is in parent
        rowFrame.appendChild(moveNode);
        moveNode.x = localX;
        moveNode.y = localY;
      }

      // Apply horizontal auto-layout to the row frame
      rowFrame.layoutMode = "HORIZONTAL";
      rowFrame.itemSpacing = rowItems.length > 1
        ? Math.max(0, Math.round((rowItems[1].x - rowItems[0].x - ((rowItems[0].node as any).width || 0))))
        : 8;
      rowFrame.paddingLeft = 0;
      rowFrame.paddingRight = 0;
      rowFrame.paddingTop = 0;
      rowFrame.paddingBottom = 0;
      rowFrame.primaryAxisSizingMode = "AUTO";
      rowFrame.counterAxisSizingMode = "AUTO";
      rowFrame.counterAxisAlignItems = "CENTER";

      // Insert at the correct position (replace the existing insertion)
      (container as any).insertChild(insertIdx, rowFrame);
    } catch (e) { /* skip row grouping if it fails */ }
  }
}

export async function swapNextInstance(): Promise<void> {
  if (_swapPending.length === 0) {
    // All swaps done — run form-row grouping on design pages
    try {
      figma.ui.postMessage({ type: "routeb-components-progress", phase: "Grouping form rows…", percent: 97 });
      await groupFormRowsOnPages();
    } catch (e) { /* non-critical */ }
    figma.ui.postMessage({ type: "routeb-swap-completed", stats: _swapResult });
    return;
  }

  const total = _swapPending.length + _swapResult.instancesSwapped;
  const current = _swapResult.instancesSwapped;
  const entry = _swapPending.shift()!;

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Swapping instance " + (current + 1) + "/" + total + "…",
    percent: 10 + Math.round((current / total) * 85)
  });

  try {
    const swapped = await swapSingleNode(entry.originalId, entry.variant);
    if (swapped) {
      _swapResult.instancesSwapped++;
      // Remove associated nodes (text/icons that were merged into the component)
      if (entry.associatedIds && entry.associatedIds.length > 0) {
        for (let ri = 0; ri < entry.associatedIds.length; ri++) {
          try {
            const assocNode = await figma.getNodeByIdAsync(entry.associatedIds[ri]);
            if (assocNode && assocNode.type !== "PAGE" && assocNode.type !== "DOCUMENT") {
              (assocNode as SceneNode).remove();
            }
          } catch (e2) { /* ignore removal errors */ }
        }
      }
    }
  } catch (e) {
    _swapResult.errors.push("Swap failed for " + entry.originalId + ": " + String(e));
  }

  figma.ui.postMessage({ type: "routeb-swap-next" });
}

// ── Variable Binding (pre-cached) ────────────────────────────────────────────

interface ResolvedColorVar { variable: Variable; r: number; g: number; b: number; }
interface ResolvedFloatVar { variable: Variable; value: number; }

interface VarCache {
  colors: ResolvedColorVar[];
  spacing: ResolvedFloatVar[];
  radius: ResolvedFloatVar[];
  borders: ResolvedFloatVar[];
  spacingCollection?: VariableCollection;  // For creating new spacing variables
}

function colorDist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function findNearestColorCached(color: { r: number; g: number; b: number }, cache: ResolvedColorVar[]): Variable | null {
  let best: Variable | null = null, bestDist = 0.04;
  for (let i = 0; i < cache.length; i++) {
    const d = colorDist(color, cache[i]);
    if (d < bestDist) { bestDist = d; best = cache[i].variable; }
  }
  return best;
}

function findNearestFloatCached(value: number, cache: ResolvedFloatVar[]): Variable | null {
  let best: Variable | null = null, bestDist = Infinity;
  for (let i = 0; i < cache.length; i++) {
    const fv = cache[i].value;
    const d = Math.abs(fv - value);
    const threshold = Math.max(fv * 0.1, 1);
    if (d < threshold && d < bestDist) { bestDist = d; best = cache[i].variable; }
  }
  return best;
}

function buildVarCacheSync(
  colorVars: Variable[], spacingVars: Variable[], radiusVars: Variable[], borderVars: Variable[],
  collections: VariableCollection[]
): VarCache {
  const cache: VarCache = { colors: [], spacing: [], radius: [], borders: [] };

  // Find the spacing collection for creating new variables
  for (let sci = 0; sci < collections.length; sci++) {
    if (collections[sci].name.toLowerCase().indexOf("spacing") !== -1) {
      cache.spacingCollection = collections[sci];
      break;
    }
  }

  // Build collection lookup: id → first modeId
  const modeMap: { [colId: string]: string } = {};
  for (let ci = 0; ci < collections.length; ci++) {
    if (collections[ci].modes?.length > 0) {
      modeMap[collections[ci].id] = collections[ci].modes[0].modeId;
    }
  }

  // Resolve colors
  for (let i = 0; i < colorVars.length; i++) {
    try {
      const modeId = modeMap[colorVars[i].variableCollectionId];
      if (!modeId) continue;
      const cv = colorVars[i].valuesByMode[modeId];
      if (cv && typeof cv === "object" && "r" in cv) {
        cache.colors.push({ variable: colorVars[i], r: (cv as any).r, g: (cv as any).g, b: (cv as any).b });
      }
    } catch (e) {}
  }

  // Resolve floats
  function resolveFloats(vars: Variable[]): ResolvedFloatVar[] {
    const out: ResolvedFloatVar[] = [];
    for (let j = 0; j < vars.length; j++) {
      try {
        const mid = modeMap[vars[j].variableCollectionId];
        if (!mid) continue;
        const fv = vars[j].valuesByMode[mid];
        if (typeof fv === "number" && fv > 0) out.push({ variable: vars[j], value: fv });
      } catch (e) {}
    }
    return out;
  }

  cache.spacing = resolveFloats(spacingVars);
  cache.radius = resolveFloats(radiusVars);
  cache.borders = resolveFloats(borderVars);

  return cache;
}

function bindVariablesOnNode(node: SceneNode, cache: VarCache): void {
  // Bind fills
  if ("fills" in node && Array.isArray(node.fills)) {
    let changed = false;
    const newFills: Paint[] = [];
    for (let fi = 0; fi < node.fills.length; fi++) {
      const fill = node.fills[fi];
      if (fill.type !== "SOLID" || fill.visible === false) { newFills.push(fill); continue; }
      const bv = node.boundVariables?.fills?.[fi];
      if (bv) { newFills.push(fill); continue; }
      const nearest = findNearestColorCached((fill as SolidPaint).color, cache.colors);
      if (nearest) {
        try { newFills.push(figma.variables.setBoundVariableForPaint(fill, "color", nearest)); changed = true; continue; } catch (e) {}
      }
      newFills.push(fill);
    }
    if (changed) { try { (node as any).fills = newFills; } catch (e) {} }
  }

  // Bind strokes
  if ("strokes" in node && Array.isArray(node.strokes)) {
    let sChanged = false;
    const newStrokes: Paint[] = [];
    for (let si = 0; si < node.strokes.length; si++) {
      const stroke = node.strokes[si];
      if (stroke.type !== "SOLID" || stroke.visible === false) { newStrokes.push(stroke); continue; }
      const bvs = node.boundVariables?.strokes?.[si];
      if (bvs) { newStrokes.push(stroke); continue; }
      const nearestS = findNearestColorCached((stroke as SolidPaint).color, cache.colors);
      if (nearestS) {
        try { newStrokes.push(figma.variables.setBoundVariableForPaint(stroke, "color", nearestS)); sChanged = true; continue; } catch (e) {}
      }
      newStrokes.push(stroke);
    }
    if (sChanged) { try { (node as any).strokes = newStrokes; } catch (e) {} }
  }

  // Bind spacing (find existing or create new variable)
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    const fn = node as FrameNode;
    const spacingProps = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"];
    for (let spi = 0; spi < spacingProps.length; spi++) {
      const prop = spacingProps[spi];
      const val = (fn as any)[prop];
      if (typeof val !== "number" || val <= 0) continue;
      const bvSp = (fn.boundVariables as any)?.[prop];
      if (bvSp) continue;
      const nearSp = findNearestFloatCached(val, cache.spacing);
      if (nearSp) {
        try { fn.setBoundVariable(prop as any, nearSp); } catch (e) {}
      } else {
        // No matching variable — create a new spacing variable
        const newSpVar = createSpacingVariable(Math.round(val), cache);
        if (newSpVar) { try { fn.setBoundVariable(prop as any, newSpVar); } catch (e) {} }
      }
    }
  }

  // Bind radius
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    const bvR = node.boundVariables?.cornerRadius || node.boundVariables?.topLeftRadius;
    if (!bvR) {
      const nearR = findNearestFloatCached(node.cornerRadius, cache.radius);
      if (nearR) { try { (node as any).setBoundVariable("cornerRadius", nearR); } catch (e) {} }
    }
  }

  // Bind border width
  if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) {
    const bvBw = node.boundVariables?.strokeWeight;
    if (!bvBw) {
      const nearBw = findNearestFloatCached(node.strokeWeight as number, cache.borders);
      if (nearBw) { try { (node as any).setBoundVariable("strokeWeight", nearBw); } catch (e) {} }
    }
  }

  // Recurse into children — fully synchronous now
  if ("children" in node && (node as any).children) {
    const ch = (node as any).children as SceneNode[];
    for (let i = 0; i < ch.length; i++) {
      bindVariablesOnNode(ch[i], cache);
    }
  }
}

// ── Instance Swapping ────────────────────────────────────────────────────────

async function swapSingleNode(originalId: string, variant: ComponentNode): Promise<boolean> {
  const original = await figma.getNodeByIdAsync(originalId);
  if (!original || !original.parent) return false;

  // Don't swap if it's already an instance
  if (original.type === "INSTANCE") return false;

  const parent = original.parent;
  let idx = -1;
  if ("children" in parent) {
    const siblings = (parent as any).children as SceneNode[];
    for (let i = 0; i < siblings.length; i++) {
      if (siblings[i].id === original.id) { idx = i; break; }
    }
  }
  if (idx < 0) return false;

  try {
    const instance = variant.createInstance();

    // Copy position and size — force FIXED sizing so component auto-layout doesn't override
    instance.x = (original as any).x || 0;
    instance.y = (original as any).y || 0;
    const origW = Math.max(1, Math.round((original as any).width || 100));
    const origH = Math.max(1, Math.round((original as any).height || 40));
    try {
      // Set FIXED sizing before resize so HUG/FILL on the instance doesn't override dimensions
      if ("primaryAxisSizingMode" in instance) (instance as any).primaryAxisSizingMode = "FIXED";
      if ("counterAxisSizingMode" in instance) (instance as any).counterAxisSizingMode = "FIXED";
      instance.resize(origW, origH);
    } catch (e) { /* parent auto-layout may control size — best effort */ }

    // Copy layout sizing if parent uses auto-layout
    if ("layoutMode" in parent && (parent as any).layoutMode !== "NONE") {
      if ("layoutSizingHorizontal" in original) {
        try { (instance as any).layoutSizingHorizontal = (original as any).layoutSizingHorizontal; } catch (e) {}
      }
      if ("layoutSizingVertical" in original) {
        try { (instance as any).layoutSizingVertical = (original as any).layoutSizingVertical; } catch (e) {}
      }
      if ("layoutPositioning" in original) {
        try { (instance as any).layoutPositioning = (original as any).layoutPositioning; } catch (e) {}
      }
    }

    // Copy text content from original to instance
    await copyTextContent(original as SceneNode, instance);

    // Insert at same position
    (parent as any).insertChild(idx, instance);

    // Remove original
    try { (original as SceneNode).remove(); } catch (e) {}

    return true;
  } catch (e) {
    return false;
  }
}

async function loadTextNodeFont(tn: TextNode): Promise<void> {
  // Strategy 1: getRangeAllFontNames (works for inline font overrides)
  try {
    if (tn.characters.length > 0) {
      const rangeFonts = tn.getRangeAllFontNames(0, tn.characters.length);
      for (let ri = 0; ri < rangeFonts.length; ri++) {
        await figma.loadFontAsync(rangeFonts[ri]);
      }
    }
  } catch (e) {}
  // Strategy 2: fontName property (works for text-style nodes where getRangeAllFontNames returns empty)
  try {
    const fn = tn.fontName;
    if (fn && typeof fn === "object" && "family" in fn) {
      await figma.loadFontAsync(fn as FontName);
    }
  } catch (e) {}
}

async function copyTextContent(source: SceneNode, target: SceneNode): Promise<void> {
  // Collect text nodes from both trees; match by semantic layer name first, then by DFS index
  const sourceTexts: { node: TextNode; name: string }[] = [];
  const targetTexts: { node: TextNode; name: string }[] = [];
  collectTextNodesNamed(source, sourceTexts);
  collectTextNodesNamed(target, targetTexts);

  // Build name→index map for targets for fast semantic matching
  const targetByName: { [name: string]: number } = {};
  for (let ti = 0; ti < targetTexts.length; ti++) {
    const tname = targetTexts[ti].name.toLowerCase();
    if (!(tname in targetByName)) targetByName[tname] = ti;
  }

  const usedTargetIndices: { [idx: number]: boolean } = {};

  for (let si = 0; si < sourceTexts.length; si++) {
    const srcEntry = sourceTexts[si];
    const srcChars = srcEntry.node.characters;

    // Skip empty source text
    if (!srcChars) continue;

    // Find matching target: prefer semantic name match, fall back to same index
    let matchIdx = -1;
    const snameLower = srcEntry.name.toLowerCase();
    if (snameLower in targetByName && !usedTargetIndices[targetByName[snameLower]]) {
      matchIdx = targetByName[snameLower];
    } else if (si < targetTexts.length && !usedTargetIndices[si]) {
      matchIdx = si;
    }
    if (matchIdx < 0) continue;

    const tgtEntry = targetTexts[matchIdx];
    if (tgtEntry.node.characters === srcChars) {
      usedTargetIndices[matchIdx] = true;
      continue; // already correct
    }

    try {
      await loadTextNodeFont(tgtEntry.node);
      tgtEntry.node.characters = srcChars;
      usedTargetIndices[matchIdx] = true;
    } catch (e) {
      // If setting with target font fails, try loading source font then applying
      try {
        await loadTextNodeFont(srcEntry.node);
        tgtEntry.node.characters = srcChars;
        usedTargetIndices[matchIdx] = true;
      } catch (e2) { /* give up on this text node */ }
    }
  }
}

function collectTextNodesNamed(node: SceneNode, out: { node: TextNode; name: string }[]): void {
  if (node.type === "TEXT") {
    out.push({ node: node as TextNode, name: node.name || "" });
    return;
  }
  if ("children" in node && (node as any).children) {
    const ch = (node as any).children as SceneNode[];
    for (let i = 0; i < ch.length; i++) {
      collectTextNodesNamed(ch[i], out);
    }
  }
}

