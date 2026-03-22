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

var TYPE_MAP: { [k: string]: string } = {
  FRAME: "F", TEXT: "T", RECTANGLE: "R", VECTOR: "V", INSTANCE: "I",
  GROUP: "G", SECTION: "S", ELLIPSE: "E", LINE: "L", POLYGON: "P",
  COMPONENT: "F", COMPONENT_SET: "F", STAR: "P", BOOLEAN_OPERATION: "F"
};

function nodeTypeCode(type: string): string {
  return TYPE_MAP[type] || "F";
}

function firstSolidFillHex(node: SceneNode): string | null {
  if (!("fills" in node) || !Array.isArray(node.fills)) return null;
  for (var i = 0; i < node.fills.length; i++) {
    var fill = node.fills[i];
    if (fill.type === "SOLID" && fill.visible !== false) {
      return rgb01ToHex(fill.color.r, fill.color.g, fill.color.b);
    }
  }
  return null;
}

function firstSolidStrokeHex(node: SceneNode): string | null {
  if (!("strokes" in node) || !Array.isArray(node.strokes)) return null;
  for (var i = 0; i < node.strokes.length; i++) {
    var stroke = node.strokes[i];
    if (stroke.type === "SOLID" && stroke.visible !== false) {
      return rgb01ToHex(stroke.color.r, stroke.color.g, stroke.color.b);
    }
  }
  return null;
}

function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node) || !Array.isArray(node.fills)) return false;
  for (var i = 0; i < node.fills.length; i++) {
    if (node.fills[i].type === "IMAGE" && node.fills[i].visible !== false) return true;
  }
  return false;
}

function hasShadowEffect(node: SceneNode): boolean {
  if (!("effects" in node) || !node.effects) return false;
  for (var i = 0; i < node.effects.length; i++) {
    var t = node.effects[i].type;
    if ((t === "DROP_SHADOW" || t === "INNER_SHADOW") && node.effects[i].visible !== false) return true;
  }
  return false;
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

  var sn: SerializedNode = {
    id: node.id,
    t: nodeTypeCode(node.type),
    n: (node.name || "").substring(0, 40),
    x: Math.round((node as any).x || 0),
    y: Math.round((node as any).y || 0),
    w: Math.round((node as any).width || 0),
    h: Math.round((node as any).height || 0)
  };

  // Visual properties
  var fillHex = firstSolidFillHex(node);
  if (fillHex) sn.f = fillHex;
  var strokeHex = firstSolidStrokeHex(node);
  if (strokeHex) sn.s = strokeHex;
  if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) sn.sw = Math.round(node.strokeWeight);
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) sn.r = Math.round(node.cornerRadius);
  if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1) sn.o = Math.round(node.opacity * 100) / 100;

  // Layout
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    var frame = node as FrameNode;
    if (frame.layoutMode === "HORIZONTAL") sn.l = "H";
    else if (frame.layoutMode === "VERTICAL") sn.l = "V";
    if (frame.layoutWrap === "WRAP") sn.l = "W";
    var padT = Math.round(frame.paddingTop || 0), padR = Math.round(frame.paddingRight || 0);
    var padB = Math.round(frame.paddingBottom || 0), padL = Math.round(frame.paddingLeft || 0);
    if (padT || padR || padB || padL) sn.p = [padT, padR, padB, padL];
    if (frame.itemSpacing > 0) sn.g = Math.round(frame.itemSpacing);
    if (frame.primaryAxisAlignItems && frame.primaryAxisAlignItems !== "MIN") sn.ax = frame.primaryAxisAlignItems;
    if (frame.counterAxisAlignItems && frame.counterAxisAlignItems !== "MIN") sn.cx = frame.counterAxisAlignItems;
  }

  // Text
  if (node.type === "TEXT") {
    var tn = node as TextNode;
    if (tn.characters) sn.txt = tn.characters.substring(0, 60);
    if (typeof tn.fontSize === "number") sn.fs = tn.fontSize;
    if (typeof tn.fontWeight === "number") sn.fw = tn.fontWeight;
    else if (tn.fontName && typeof tn.fontName === "object" && "style" in tn.fontName) {
      var style = (tn.fontName.style || "").toLowerCase();
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
    var children = (node as any).children as SceneNode[];
    var serializedChildren: SerializedNode[] = [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].visible === false) continue;
      var child = serializeNode(children[i], depth + 1, maxDepth);
      if (child) serializedChildren.push(child);
    }
    if (serializedChildren.length > 0) sn.c = serializedChildren;
  } else if ("children" in node && (node as any).children) {
    var vc = 0;
    var ch = (node as any).children as SceneNode[];
    for (var j = 0; j < ch.length; j++) { if (ch[j].visible !== false) vc++; }
    if (vc > 0) sn.cc = vc;
  }

  return sn;
}

// ── Public API ───────────────────────────────────────────────────────────────

// Serialize one frame at a time via message handler. This avoids freezing
// because each frame is a separate message handler invocation.

var _pendingFrames: { page: string; frameId: string; frameName: string }[] = [];
var _collectedChunks: ChunkData[] = [];

export async function startChunkedSerialization(): Promise<void> {
  _pendingFrames = [];
  _collectedChunks = [];

  var pageHints = ["desktop", "mobile"];
  for (var pi = 0; pi < pageHints.length; pi++) {
    var page = findPageByHint(pageHints[pi]);
    if (!page) continue;
    await page.loadAsync();
    for (var fi = 0; fi < page.children.length; fi++) {
      var frame = page.children[fi];
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

  var total = _pendingFrames.length + _collectedChunks.length;
  var current = _collectedChunks.length;
  var entry = _pendingFrames.shift()!;

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Serializing " + entry.frameName + "… (" + (current + 1) + "/" + total + ")",
    percent: 5 + Math.round((current / total) * 15)
  });

  try {
    var node = await figma.getNodeByIdAsync(entry.frameId);
    if (node && node.type !== "PAGE") {
      var tree = serializeNode(node as SceneNode, 0, 3);
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
}

interface ComponentCreationResult {
  componentsCreated: number;
  variantsCreated: number;
  instancesSwapped: number;
  errors: string[];
}

// Persistent state for chunked creation
var _createPending: ComponentSpec[] = [];
var _createResult: ComponentCreationResult = { componentsCreated: 0, variantsCreated: 0, instancesSwapped: 0, errors: [] };
var _createVarCache: VarCache | null = null;
var _createComponentsPage: PageNode | null = null;
var _createYOffset: number = 0;
// Accumulated swap map: filled during creation, used during swap phase
var _pendingSwaps: { originalId: string; variant: ComponentNode; associatedIds?: string[] }[] = [];
// ID-only version for persistence (sent to UI in stats, survives plugin restart)
var _pendingSwapIds: { originalId: string; variantNodeId: string; associatedIds?: string[] }[] = [];

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

  var componentsPage = findPageByHint("components");
  if (!componentsPage) {
    figma.ui.postMessage({ type: "routeb-components-error", error: "Components page not found" });
    return;
  }
  _createComponentsPage = componentsPage;

  // Load ALL pages we'll need: Components (target) + Desktop/Mobile (source nodes to clone)
  await componentsPage.loadAsync();
  var desktopPage = findPageByHint("desktop");
  if (desktopPage) await desktopPage.loadAsync();
  var mobilePage = findPageByHint("mobile");
  if (mobilePage) await mobilePage.loadAsync();

  // Calculate starting Y offset below existing content on Components page
  _createYOffset = 0;
  for (var ci = 0; ci < componentsPage.children.length; ci++) {
    var child = componentsPage.children[ci];
    var bottom = child.y + (child as any).height;
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
  var allVars = await figma.variables.getLocalVariablesAsync();
  var allCols = await figma.variables.getLocalVariableCollectionsAsync();

  var colorVars = allVars.filter(function(v) { return v.resolvedType === "COLOR"; });
  var floatVars = allVars.filter(function(v) { return v.resolvedType === "FLOAT"; });
  var colMap: { [id: string]: string } = {};
  for (var ci = 0; ci < allCols.length; ci++) {
    colMap[allCols[ci].id] = allCols[ci].name.toLowerCase();
  }
  var spacingVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("spacing") !== -1; });
  var radiusVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("radius") !== -1; });
  var borderVars = floatVars.filter(function(v) { return (colMap[v.variableCollectionId] || "").indexOf("border") !== -1; });
  _createVarCache = buildVarCacheSync(colorVars, spacingVars, radiusVars, borderVars, allCols);

  // Now start per-component ping-pong
  figma.ui.postMessage({ type: "routeb-create-next" });
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

  var totalComponents = _createPending.length + _createResult.componentsCreated + _createResult.errors.length;
  var currentIdx = _createResult.componentsCreated + _createResult.errors.length;
  var compSpec = _createPending.shift()!;

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Creating " + compSpec.name + "… (" + (currentIdx + 1) + "/" + totalComponents + ")",
    percent: 10 + Math.round((currentIdx / totalComponents) * 85)
  });

  try {
    var variantComps: ComponentNode[] = [];
    var swapMap: { originalId: string; variant: ComponentNode; associatedIds: string[] }[] = [];

    for (var vIdx = 0; vIdx < compSpec.variants.length; vIdx++) {
      var varSpec = compSpec.variants[vIdx];
      if (!varSpec.nodeIds || varSpec.nodeIds.length === 0) continue;

      var repNode = await figma.getNodeByIdAsync(varSpec.nodeIds[0]);
      if (!repNode) {
        _createResult.errors.push("Node not found: " + varSpec.nodeIds[0]);
        continue;
      }

      // Clone the node and convert directly to a component — preserves all
      // children, layout, fills, strokes, effects, etc. without manual transfer.
      var cloned = (repNode as SceneNode).clone();

      // If there are associated nodes (e.g., text labels not nested inside the frame),
      // wrap everything in a frame preserving relative positions from the original design.
      var repId = varSpec.nodeIds[0];
      var assocIds = (varSpec.associatedNodeIds && varSpec.associatedNodeIds[repId]) || [];
      if (assocIds.length > 0) {
        // Collect absolute bounding boxes of the main frame + all associated nodes
        var repScene = repNode as SceneNode;
        var repAbs = (repScene as any).absoluteBoundingBox as { x: number; y: number; width: number; height: number } | null;
        if (!repAbs) repAbs = { x: 0, y: 0, width: (repScene as any).width || 100, height: (repScene as any).height || 40 };

        // Gather all nodes' absolute bounds to compute the overall bounding box
        var allBounds: { x: number; y: number; w: number; h: number; node: SceneNode | null; isMain: boolean }[] = [];
        allBounds.push({ x: repAbs.x, y: repAbs.y, w: repAbs.width, h: repAbs.height, node: null, isMain: true });

        var assocNodes: SceneNode[] = [];
        for (var ai = 0; ai < assocIds.length; ai++) {
          var assocNode = await figma.getNodeByIdAsync(assocIds[ai]);
          if (assocNode && assocNode.type !== "PAGE" && assocNode.type !== "DOCUMENT") {
            var aScene = assocNode as SceneNode;
            var aAbs = (aScene as any).absoluteBoundingBox as { x: number; y: number; width: number; height: number } | null;
            if (aAbs) {
              allBounds.push({ x: aAbs.x, y: aAbs.y, w: aAbs.width, h: aAbs.height, node: aScene, isMain: false });
              assocNodes.push(aScene);
            }
          }
        }

        // Compute bounding box encompassing everything
        var minX = allBounds[0].x, minY = allBounds[0].y;
        var maxX = allBounds[0].x + allBounds[0].w, maxY = allBounds[0].y + allBounds[0].h;
        for (var bi = 1; bi < allBounds.length; bi++) {
          if (allBounds[bi].x < minX) minX = allBounds[bi].x;
          if (allBounds[bi].y < minY) minY = allBounds[bi].y;
          if (allBounds[bi].x + allBounds[bi].w > maxX) maxX = allBounds[bi].x + allBounds[bi].w;
          if (allBounds[bi].y + allBounds[bi].h > maxY) maxY = allBounds[bi].y + allBounds[bi].h;
        }

        // Create wrapper with no auto-layout — use absolute positioning
        var wrapper = figma.createFrame();
        wrapper.name = cloned.name;
        wrapper.resize(Math.max(1, Math.round(maxX - minX)), Math.max(1, Math.round(maxY - minY)));
        wrapper.fills = [];
        wrapper.clipsContent = false;

        // Place main frame at its relative position within the wrapper
        wrapper.appendChild(cloned);
        cloned.x = Math.round(repAbs.x - minX);
        cloned.y = Math.round(repAbs.y - minY);

        // Clone and place associated nodes at their relative positions
        for (var ai2 = 0; ai2 < allBounds.length; ai2++) {
          if (allBounds[ai2].isMain) continue;
          var assocCloned = (allBounds[ai2].node as SceneNode).clone();
          wrapper.appendChild(assocCloned);
          assocCloned.x = Math.round(allBounds[ai2].x - minX);
          assocCloned.y = Math.round(allBounds[ai2].y - minY);
        }

        cloned = wrapper as any;
      }

      var comp = figma.createComponentFromNode(cloned);

      var propParts: string[] = [];
      var propKeys = Object.keys(varSpec.properties);
      for (var pk = 0; pk < propKeys.length; pk++) {
        propParts.push(propKeys[pk] + "=" + varSpec.properties[propKeys[pk]]);
      }
      comp.name = propParts.join(", ") || varSpec.name;

      variantComps.push(comp);
      _createResult.variantsCreated++;

      for (var ni = 0; ni < varSpec.nodeIds.length; ni++) {
        var swapAssoc = (varSpec.associatedNodeIds && varSpec.associatedNodeIds[varSpec.nodeIds[ni]]) || [];
        swapMap.push({ originalId: varSpec.nodeIds[ni], variant: comp, associatedIds: swapAssoc });
      }
    }

    if (variantComps.length > 0) {
      // Ensure unique variant names
      var usedNames: { [key: string]: number } = {};
      for (var un = 0; un < variantComps.length; un++) {
        var vName = variantComps[un].name;
        if (usedNames[vName]) {
          usedNames[vName]++;
          variantComps[un].name = vName + " " + usedNames[vName];
        } else {
          usedNames[vName] = 1;
        }
      }

      // Move to Components page
      for (var mp = 0; mp < variantComps.length; mp++) {
        _createComponentsPage!.appendChild(variantComps[mp]);
      }

      // Combine as variant set
      try {
        var compSet = figma.combineAsVariants(variantComps, _createComponentsPage!);
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
      for (var bvi = 0; bvi < variantComps.length; bvi++) {
        bindVariablesOnNode(variantComps[bvi], _createVarCache!);
      }

      // Accumulate swaps for the separate swap phase (store IDs for persistence)
      for (var si = 0; si < swapMap.length; si++) {
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

var _swapPending: { originalId: string; variant: ComponentNode; associatedIds?: string[] }[] = [];
var _swapResult: { instancesSwapped: number; errors: string[] } = { instancesSwapped: 0, errors: [] };

export async function startSwapInstances(swapMapFromUI?: { originalId: string; variantNodeId: string; associatedIds?: string[] }[]): Promise<void> {
  _swapResult = { instancesSwapped: 0, errors: [] };

  // Load Desktop/Mobile pages for node access
  var desktopPage = findPageByHint("desktop");
  if (desktopPage) await desktopPage.loadAsync();
  var mobilePage = findPageByHint("mobile");
  if (mobilePage) await mobilePage.loadAsync();
  var componentsPage = findPageByHint("components");
  if (componentsPage) await componentsPage.loadAsync();

  // Use in-memory swaps if available, otherwise reconstruct from persisted IDs
  if (_pendingSwaps.length > 0) {
    _swapPending = _pendingSwaps.slice();
  } else if (swapMapFromUI && swapMapFromUI.length > 0) {
    _swapPending = [];
    for (var i = 0; i < swapMapFromUI.length; i++) {
      var entry = swapMapFromUI[i];
      var variantNode = await figma.getNodeByIdAsync(entry.variantNodeId);
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

export async function swapNextInstance(): Promise<void> {
  if (_swapPending.length === 0) {
    figma.ui.postMessage({ type: "routeb-swap-completed", stats: _swapResult });
    return;
  }

  var total = _swapPending.length + _swapResult.instancesSwapped;
  var current = _swapResult.instancesSwapped;
  var entry = _swapPending.shift()!;

  figma.ui.postMessage({
    type: "routeb-components-progress",
    phase: "Swapping instance " + (current + 1) + "/" + total + "…",
    percent: 10 + Math.round((current / total) * 85)
  });

  try {
    var swapped = await swapSingleNode(entry.originalId, entry.variant);
    if (swapped) {
      _swapResult.instancesSwapped++;
      // Remove associated nodes (text/icons that were merged into the component)
      if (entry.associatedIds && entry.associatedIds.length > 0) {
        for (var ri = 0; ri < entry.associatedIds.length; ri++) {
          try {
            var assocNode = await figma.getNodeByIdAsync(entry.associatedIds[ri]);
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
}

function colorDist(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

function findNearestColorCached(color: { r: number; g: number; b: number }, cache: ResolvedColorVar[]): Variable | null {
  var best: Variable | null = null, bestDist = 0.04;
  for (var i = 0; i < cache.length; i++) {
    var d = colorDist(color, cache[i]);
    if (d < bestDist) { bestDist = d; best = cache[i].variable; }
  }
  return best;
}

function findNearestFloatCached(value: number, cache: ResolvedFloatVar[]): Variable | null {
  var best: Variable | null = null, bestDist = Infinity;
  for (var i = 0; i < cache.length; i++) {
    var fv = cache[i].value;
    var d = Math.abs(fv - value);
    var threshold = Math.max(fv * 0.1, 1);
    if (d < threshold && d < bestDist) { bestDist = d; best = cache[i].variable; }
  }
  return best;
}

function buildVarCacheSync(
  colorVars: Variable[], spacingVars: Variable[], radiusVars: Variable[], borderVars: Variable[],
  collections: VariableCollection[]
): VarCache {
  var cache: VarCache = { colors: [], spacing: [], radius: [], borders: [] };

  // Build collection lookup: id → first modeId
  var modeMap: { [colId: string]: string } = {};
  for (var ci = 0; ci < collections.length; ci++) {
    if (collections[ci].modes && collections[ci].modes.length > 0) {
      modeMap[collections[ci].id] = collections[ci].modes[0].modeId;
    }
  }

  // Resolve colors
  for (var i = 0; i < colorVars.length; i++) {
    try {
      var modeId = modeMap[colorVars[i].variableCollectionId];
      if (!modeId) continue;
      var cv = colorVars[i].valuesByMode[modeId];
      if (cv && typeof cv === "object" && "r" in cv) {
        cache.colors.push({ variable: colorVars[i], r: (cv as any).r, g: (cv as any).g, b: (cv as any).b });
      }
    } catch (e) {}
  }

  // Resolve floats
  function resolveFloats(vars: Variable[]): ResolvedFloatVar[] {
    var out: ResolvedFloatVar[] = [];
    for (var j = 0; j < vars.length; j++) {
      try {
        var mid = modeMap[vars[j].variableCollectionId];
        if (!mid) continue;
        var fv = vars[j].valuesByMode[mid];
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
    var changed = false;
    var newFills: Paint[] = [];
    for (var fi = 0; fi < node.fills.length; fi++) {
      var fill = node.fills[fi];
      if (fill.type !== "SOLID" || fill.visible === false) { newFills.push(fill); continue; }
      var bv = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[fi];
      if (bv) { newFills.push(fill); continue; }
      var nearest = findNearestColorCached((fill as SolidPaint).color, cache.colors);
      if (nearest) {
        try { newFills.push(figma.variables.setBoundVariableForPaint(fill, "color", nearest)); changed = true; continue; } catch (e) {}
      }
      newFills.push(fill);
    }
    if (changed) { try { (node as any).fills = newFills; } catch (e) {} }
  }

  // Bind strokes
  if ("strokes" in node && Array.isArray(node.strokes)) {
    var sChanged = false;
    var newStrokes: Paint[] = [];
    for (var si = 0; si < node.strokes.length; si++) {
      var stroke = node.strokes[si];
      if (stroke.type !== "SOLID" || stroke.visible === false) { newStrokes.push(stroke); continue; }
      var bvs = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[si];
      if (bvs) { newStrokes.push(stroke); continue; }
      var nearestS = findNearestColorCached((stroke as SolidPaint).color, cache.colors);
      if (nearestS) {
        try { newStrokes.push(figma.variables.setBoundVariableForPaint(stroke, "color", nearestS)); sChanged = true; continue; } catch (e) {}
      }
      newStrokes.push(stroke);
    }
    if (sChanged) { try { (node as any).strokes = newStrokes; } catch (e) {} }
  }

  // Bind spacing
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    var fn = node as FrameNode;
    var spacingProps = ["paddingLeft", "paddingRight", "paddingTop", "paddingBottom", "itemSpacing"];
    for (var spi = 0; spi < spacingProps.length; spi++) {
      var prop = spacingProps[spi];
      var val = (fn as any)[prop];
      if (typeof val !== "number" || val <= 0) continue;
      var bvSp = fn.boundVariables && (fn.boundVariables as any)[prop];
      if (bvSp) continue;
      var nearSp = findNearestFloatCached(val, cache.spacing);
      if (nearSp) { try { fn.setBoundVariable(prop as any, nearSp); } catch (e) {} }
    }
  }

  // Bind radius
  if ("cornerRadius" in node && typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    var bvR = node.boundVariables && (node.boundVariables.cornerRadius || node.boundVariables.topLeftRadius);
    if (!bvR) {
      var nearR = findNearestFloatCached(node.cornerRadius, cache.radius);
      if (nearR) { try { (node as any).setBoundVariable("cornerRadius", nearR); } catch (e) {} }
    }
  }

  // Bind border width
  if ("strokeWeight" in node && typeof node.strokeWeight === "number" && node.strokeWeight > 0) {
    var bvBw = node.boundVariables && node.boundVariables.strokeWeight;
    if (!bvBw) {
      var nearBw = findNearestFloatCached(node.strokeWeight as number, cache.borders);
      if (nearBw) { try { (node as any).setBoundVariable("strokeWeight", nearBw); } catch (e) {} }
    }
  }

  // Recurse into children — fully synchronous now
  if ("children" in node && (node as any).children) {
    var ch = (node as any).children as SceneNode[];
    for (var i = 0; i < ch.length; i++) {
      bindVariablesOnNode(ch[i], cache);
    }
  }
}

// ── Instance Swapping ────────────────────────────────────────────────────────

async function swapSingleNode(originalId: string, variant: ComponentNode): Promise<boolean> {
  var original = await figma.getNodeByIdAsync(originalId);
  if (!original || !original.parent) return false;

  // Don't swap if it's already an instance
  if (original.type === "INSTANCE") return false;

  var parent = original.parent;
  var idx = -1;
  if ("children" in parent) {
    var siblings = (parent as any).children as SceneNode[];
    for (var i = 0; i < siblings.length; i++) {
      if (siblings[i].id === original.id) { idx = i; break; }
    }
  }
  if (idx < 0) return false;

  try {
    var instance = variant.createInstance();

    // Copy position and size
    instance.x = (original as any).x || 0;
    instance.y = (original as any).y || 0;
    try {
      instance.resize(
        Math.max(1, Math.round((original as any).width || 100)),
        Math.max(1, Math.round((original as any).height || 40))
      );
    } catch (e) { /* auto-layout parent may control size */ }

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

async function copyTextContent(source: SceneNode, target: SceneNode): Promise<void> {
  // Collect text nodes from both trees by DFS order
  var sourceTexts: TextNode[] = [];
  var targetTexts: TextNode[] = [];
  collectTextNodes(source, sourceTexts);
  collectTextNodes(target, targetTexts);

  // Match by index and copy characters
  var count = Math.min(sourceTexts.length, targetTexts.length);
  for (var i = 0; i < count; i++) {
    if (sourceTexts[i].characters !== targetTexts[i].characters) {
      try {
        // Load all fonts used in the target text node (handles mixed fonts)
        var targetFonts = targetTexts[i].getRangeAllFontNames(0, targetTexts[i].characters.length);
        for (var fi = 0; fi < targetFonts.length; fi++) {
          await figma.loadFontAsync(targetFonts[fi]);
        }
        targetTexts[i].characters = sourceTexts[i].characters;
      } catch (e) {
        // Font loading failed — skip text update
      }
    }
  }
}

function collectTextNodes(node: SceneNode, out: TextNode[]): void {
  if (node.type === "TEXT") {
    out.push(node as TextNode);
    return;
  }
  if ("children" in node && (node as any).children) {
    var ch = (node as any).children as SceneNode[];
    for (var i = 0; i < ch.length; i++) {
      collectTextNodes(ch[i], out);
    }
  }
}
