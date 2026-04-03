// HTML generation engine
import { MOBILE_BREAKPOINT } from './constants';

// Base64 encoding for Figma plugin sandbox (no btoa available)
const _b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToBase64(bytes) {
  let result = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i], b1 = i + 1 < len ? bytes[i + 1] : 0, b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += _b64chars[(b0 >> 2) & 63];
    result += _b64chars[((b0 << 4) | (b1 >> 4)) & 63];
    result += (i + 1 < len) ? _b64chars[((b1 << 2) | (b2 >> 6)) & 63] : "=";
    result += (i + 2 < len) ? _b64chars[b2 & 63] : "=";
  }
  return result;
}

function bytesToDataUrl(bytes, format) {
  const mimeMap = { svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "image/pdf" };
  const mime = mimeMap[format] || "application/octet-stream";
  return "data:" + mime + ";base64," + bytesToBase64(bytes);
}

export async function htmlResolveVarToCSSName(variableId) {
  try {
    const v = await figma.variables.getVariableByIdAsync(variableId);
    if (!v) return null;
    return "--" + v.name.replace(/\//g, "-").replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  } catch(e) { return null; }
}

export async function htmlResolveVarValue(variableId, _seen) {
  try {
    const seen = _seen || {};
    if (seen[variableId]) return null; // circular reference
    seen[variableId] = true;
    const v = await figma.variables.getVariableByIdAsync(variableId);
    if (!v) return null;
    const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    if (!col?.modes?.length) return null;
    const modeId = col.modes[0].modeId;
    const val = v.valuesByMode[modeId];
    if (!val) return null;
    // Resolve alias
    if (val.type === "VARIABLE_ALIAS") {
      return await htmlResolveVarValue(val.id, seen);
    }
    return val;
  } catch(e) { return null; }
}

export function htmlColorToCSS(c, fillOpacity) {
  if (!c) return null;
  const r = Math.round((c.r || 0) * 255);
  const g = Math.round((c.g || 0) * 255);
  const b = Math.round((c.b || 0) * 255);
  let a = c.a !== undefined ? c.a : 1;
  // Apply paint-level opacity (separate from node opacity in Figma)
  if (fillOpacity !== undefined && fillOpacity < 1) a = a * fillOpacity;
  if (a < 1) return "rgba(" + r + "," + g + "," + b + "," + Math.round(a * 100) / 100 + ")";
  return "rgb(" + r + "," + g + "," + b + ")";
}

export function htmlEscapeText(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function htmlSanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

// ── Shared helper: resolve variable binding to CSS var() or raw value ──
async function cssBindVar(alias, rawValue, unit, cssVars) {
  if (!alias?.id) return rawValue + unit;
  const name = await htmlResolveVarToCSSName(alias.id);
  if (!name) return rawValue + unit;
  cssVars[name] = rawValue + unit;
  return "var(" + name + ")";
}

// Resolve a bound fill color to CSS, with variable binding support
async function cssFillColor(fillAlias, color, paintOpacity, cssVars) {
  const raw = htmlColorToCSS(color, paintOpacity);
  if (!fillAlias?.id) return raw;
  const name = await htmlResolveVarToCSSName(fillAlias.id);
  if (!name) return raw;
  const resolved = await htmlResolveVarValue(fillAlias.id, null);
  cssVars[name] = resolved ? htmlColorToCSS(resolved, paintOpacity) : raw;
  // When paint has sub-1 opacity, the resolved color already bakes it in — use raw value
  if (paintOpacity < 1) return cssVars[name];
  return "var(" + name + ")";
}

// ── 1. extractPosition — Absolute positioning from constraints ──
function extractPosition(node, styles, cssVars, bv) {
  if (node.layoutPositioning !== "ABSOLUTE") return;
  styles["position"] = "absolute";
  const cons = node.constraints || {};
  const pw = node.parent?.width ?? 0;
  const ph = node.parent?.height ?? 0;
  const transforms = [];

  // ── Horizontal axis ──
  if (cons.horizontal === "STRETCH") {
    styles["left"] = "0"; styles["right"] = "0";
  } else if (cons.horizontal === "CENTER") {
    styles["left"] = "50%";
    transforms.push("translateX(-50%)");
  } else if (cons.horizontal === "SCALE" && pw > 0) {
    styles["left"] = Math.round(node.x / pw * 1000) / 10 + "%";
    styles["width"] = Math.round(node.width / pw * 1000) / 10 + "%";
  } else if (cons.horizontal === "MAX" && pw > 0) {
    styles["right"] = Math.round((pw - node.x - node.width) / pw * 1000) / 10 + "%";
  } else {
    // MIN or default — percentage when parent width is known
    styles["left"] = pw > 0 ? Math.round((node.x || 0) / pw * 1000) / 10 + "%" : Math.round(node.x || 0) + "px";
  }

  // ── Vertical axis ──
  if (cons.vertical === "STRETCH") {
    styles["top"] = "0"; styles["bottom"] = "0";
  } else if (cons.vertical === "CENTER") {
    styles["top"] = "50%";
    transforms.push("translateY(-50%)");
  } else if (cons.vertical === "SCALE" && ph > 0) {
    styles["top"] = Math.round(node.y / ph * 1000) / 10 + "%";
    styles["height"] = Math.round(node.height / ph * 1000) / 10 + "%";
  } else if (cons.vertical === "MAX" && ph > 0) {
    styles["bottom"] = Math.round((ph - node.y - node.height) / ph * 1000) / 10 + "%";
  } else {
    styles["top"] = ph > 0 ? Math.round((node.y || 0) / ph * 1000) / 10 + "%" : Math.round(node.y || 0) + "px";
  }

  // Compose transforms
  if (transforms.length > 0) {
    styles["transform"] = transforms.join(" ");
  }

  // Explicit dimensions (when not set by STRETCH or SCALE)
  // Skip for TEXT nodes — they size naturally from content, fixed dimensions would truncate text
  if (node.type !== "TEXT") {
    if (!styles["width"] && !styles["right"] && node.width > 0) {
      styles["width"] = Math.round(node.width) + "px";
      // Responsive max-width + aspect-ratio for MIN/MAX/CENTER constraints
      if (pw > 0) {
        styles["max-width"] = Math.round(node.width / pw * 1000) / 10 + "%";
      }
      if (node.width > 0 && node.height > 0) {
        styles["aspect-ratio"] = Math.round(node.width / node.height * 100) / 100 + " / 1";
      }
    }
    if (!styles["height"] && !styles["bottom"] && node.height > 0 && !styles["aspect-ratio"]) {
      styles["height"] = Math.round(node.height) + "px";
    }
  }

  // No z-index needed — DOM order handles stacking naturally.
  // Later siblings in HTML render above earlier ones, matching Figma's layer order.
}

// ── 2. extractLayout — Flexbox/Grid from auto-layout ──
async function extractLayout(node, styles, cssVars, bv) {
  if (!node.layoutMode || node.layoutMode === "NONE") return;

  // Grid layout
  if (node.layoutMode === "GRID") {
    styles["display"] = "grid";
    styles["position"] = styles["position"] || "relative";
    // Grid template from track sizes
    if (node.gridColumnSizes && node.gridColumnSizes.length > 0) {
      const cols = [];
      for (let ci = 0; ci < node.gridColumnSizes.length; ci++) {
        const ct = node.gridColumnSizes[ci];
        if (ct.type === "FLEX") cols.push((ct.value || 1) + "fr");
        else if (ct.type === "HUG") cols.push("auto");
        else cols.push((ct.value || 0) + "px");
      }
      styles["grid-template-columns"] = cols.join(" ");
    }
    if (node.gridRowSizes && node.gridRowSizes.length > 0) {
      const rows = [];
      for (let ri = 0; ri < node.gridRowSizes.length; ri++) {
        const rt = node.gridRowSizes[ri];
        if (rt.type === "FLEX") rows.push((rt.value || 1) + "fr");
        else if (rt.type === "HUG") rows.push("auto");
        else rows.push((rt.value || 0) + "px");
      }
      styles["grid-template-rows"] = rows.join(" ");
    }
    // Grid gap
    const colGap = node.itemSpacing > 0 ? await cssBindVar(bv.itemSpacing, node.itemSpacing, "px", cssVars) : null;
    const rowGap = node.counterAxisSpacing > 0 ? await cssBindVar(bv.counterAxisSpacing, node.counterAxisSpacing, "px", cssVars) : null;
    if (colGap && rowGap) styles["gap"] = rowGap + " " + colGap;
    else if (colGap) styles["column-gap"] = colGap;
    else if (rowGap) styles["row-gap"] = rowGap;
  } else {
    // Flex layout
    styles["display"] = "flex";
    styles["flex-direction"] = node.layoutMode === "VERTICAL" ? "column" : "row";
    if (node.layoutWrap === "WRAP") styles["flex-wrap"] = "wrap";
    styles["position"] = styles["position"] || "relative";

    // Alignment
    const mainMap = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
    const crossMap = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" };
    if (node.primaryAxisAlignItems && mainMap[node.primaryAxisAlignItems]) styles["justify-content"] = mainMap[node.primaryAxisAlignItems];
    if (node.counterAxisAlignItems && crossMap[node.counterAxisAlignItems]) styles["align-items"] = crossMap[node.counterAxisAlignItems];

    // Wrap alignment (align-content)
    if (node.layoutWrap === "WRAP" && node.counterAxisAlignContent) {
      if (node.counterAxisAlignContent === "SPACE_BETWEEN") styles["align-content"] = "space-between";
      // AUTO = default stretch behavior, no need to emit
    }

    // Gap (primary axis)
    if (node.itemSpacing > 0) {
      styles["gap"] = await cssBindVar(bv.itemSpacing, node.itemSpacing, "px", cssVars);
    }
    // Counter-axis gap (wrap only — row-gap separate from column-gap)
    if (node.layoutWrap === "WRAP" && node.counterAxisSpacing !== null && node.counterAxisSpacing !== undefined && node.counterAxisSpacing > 0) {
      styles["row-gap"] = await cssBindVar(bv.counterAxisSpacing, node.counterAxisSpacing, "px", cssVars);
    }
  }

  // Padding (shared between flex and grid)
  const padProps = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
  const padVals = [];
  for (let pi = 0; pi < padProps.length; pi++) {
    const pv = node[padProps[pi]];
    if (pv > 0) {
      padVals.push(await cssBindVar(bv[padProps[pi]], pv, "px", cssVars));
    } else padVals.push("0");
  }
  if (padVals.some(function(v) { return v !== "0"; })) {
    if (padVals[0] === padVals[1] && padVals[1] === padVals[2] && padVals[2] === padVals[3]) styles["padding"] = padVals[0];
    else if (padVals[0] === padVals[2] && padVals[1] === padVals[3]) styles["padding"] = padVals[0] + " " + padVals[1];
    else styles["padding"] = padVals.join(" ");
  }

  // Box-sizing when strokes are included in layout
  if (node.strokesIncludedInLayout) styles["box-sizing"] = "border-box";
}

// ── 3. extractSizing — Width, height, flex, min/max, overflow ──
async function extractSizing(node, styles, cssVars, bv) {
  // Absolute elements: dimensions handled by extractPosition
  if (node.layoutPositioning === "ABSOLUTE") {
    if (node.clipsContent) styles["overflow"] = "hidden";
    return;
  }
  const isAutoChild = node.parent?.layoutMode && node.parent.layoutMode !== "NONE";
  const parentDir = isAutoChild ? node.parent.layoutMode : null;

  // Horizontal sizing
  if (node.layoutSizingHorizontal === "FILL" || (isAutoChild && node.layoutAlign === "STRETCH")) {
    if (parentDir === "HORIZONTAL") {
      let flexBasis = "auto";
      if (node.minWidth && node.minWidth > 0 && node.minWidth < 10000) {
        flexBasis = await cssBindVar(bv.minWidth, Math.round(node.minWidth), "px", cssVars);
        styles["min-width"] = flexBasis;
      }
      styles["flex"] = "1 1 " + flexBasis;
    } else {
      styles["width"] = "100%";
    }
  } else if (node.width > 0 && node.layoutSizingHorizontal !== "HUG"
    && !(node.type === "TEXT" && node.textAutoResize === "WIDTH_AND_HEIGHT")) {
    styles["width"] = Math.round(node.width) + "px";
    if (isAutoChild) styles["flex-shrink"] = "0";
  }

  // Vertical sizing
  if (node.layoutSizingVertical === "FILL") {
    if (parentDir === "VERTICAL") { styles["flex"] = "1 1 auto"; }
    else { styles["height"] = "100%"; }
  } else if (node.height > 0 && node.layoutSizingVertical !== "HUG"
    && !(node.type === "TEXT" && (node.textAutoResize === "HEIGHT" || node.textAutoResize === "WIDTH_AND_HEIGHT"))) {
    styles["height"] = Math.round(node.height) + "px";
  }

  // Max/min width
  if (node.maxWidth && node.maxWidth < 10000) {
    styles["max-width"] = await cssBindVar(bv.maxWidth, Math.round(node.maxWidth), "px", cssVars);
  }
  if (!styles["min-width"] && node.minWidth && node.minWidth > 0 && node.minWidth < 10000) {
    styles["min-width"] = await cssBindVar(bv.minWidth, Math.round(node.minWidth), "px", cssVars);
  }

  // Min/max height
  if (node.minHeight && node.minHeight > 0 && node.minHeight < 10000) {
    styles["min-height"] = await cssBindVar(bv.minHeight, Math.round(node.minHeight), "px", cssVars);
  }
  if (node.maxHeight && node.maxHeight < 10000) {
    styles["max-height"] = await cssBindVar(bv.maxHeight, Math.round(node.maxHeight), "px", cssVars);
  }

  // Overflow
  if (node.clipsContent) styles["overflow"] = "hidden";
}

// ── 4. extractFills — Background colors, gradients, images ──
async function extractFills(node, styles, cssVars, bv) {
  // TEXT fills are text color, not background — handled in extractText
  if (node.type === "TEXT") return;
  if (!node.fills || !Array.isArray(node.fills) || node.fills.length === 0) return;

  const backgrounds = [];
  const bgColors = [];
  const fillBindings = bv.fills || [];

  for (let fi = node.fills.length - 1; fi >= 0; fi--) {
    const fill = node.fills[fi];
    if (!fill || fill.visible === false) continue;
    const paintOpacity = fill.opacity !== undefined ? fill.opacity : 1;

    if (fill.type === "SOLID") {
      bgColors.push(await cssFillColor(fillBindings[fi], fill.color, paintOpacity, cssVars));
    } else if (fill.type === "GRADIENT_LINEAR" && fill.gradientStops && fill.gradientStops.length > 0) {
      const stops = [];
      for (let gi = 0; gi < fill.gradientStops.length; gi++) {
        const gs = fill.gradientStops[gi];
        let stopColor = htmlColorToCSS(gs.color, paintOpacity);
        if (gs.boundVariables?.color) {
          const scn = await htmlResolveVarToCSSName(gs.boundVariables.color.id);
          if (scn) { const scResolved = await htmlResolveVarValue(gs.boundVariables.color.id, null); cssVars[scn] = scResolved ? htmlColorToCSS(scResolved, paintOpacity) : stopColor; stopColor = "var(" + scn + ")"; }
        }
        stops.push(stopColor + " " + Math.round(gs.position * 100) + "%");
      }
      let angle = 180;
      if (fill.gradientTransform && fill.gradientTransform.length >= 2) {
        const dx = fill.gradientTransform[0][0];
        const dy = fill.gradientTransform[1][0];
        angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 90;
        if (angle < 0) angle += 360;
      }
      backgrounds.push("linear-gradient(" + angle + "deg, " + stops.join(", ") + ")");
    } else if (fill.type === "GRADIENT_RADIAL" && fill.gradientStops && fill.gradientStops.length > 0) {
      const rStops = [];
      for (let ri = 0; ri < fill.gradientStops.length; ri++) {
        const rs = fill.gradientStops[ri];
        rStops.push(htmlColorToCSS(rs.color, paintOpacity) + " " + Math.round(rs.position * 100) + "%");
      }
      backgrounds.push("radial-gradient(ellipse at center, " + rStops.join(", ") + ")");
    } else if (fill.type === "GRADIENT_ANGULAR" && fill.gradientStops && fill.gradientStops.length > 0) {
      const aStops = [];
      for (let ai = 0; ai < fill.gradientStops.length; ai++) {
        const as_ = fill.gradientStops[ai];
        aStops.push(htmlColorToCSS(as_.color, paintOpacity) + " " + Math.round(as_.position * 360) + "deg");
      }
      let fromAngle = 0;
      if (fill.gradientTransform && fill.gradientTransform.length >= 2) {
        fromAngle = Math.round(Math.atan2(fill.gradientTransform[1][0], fill.gradientTransform[0][0]) * 180 / Math.PI);
        if (fromAngle < 0) fromAngle += 360;
      }
      backgrounds.push("conic-gradient(from " + fromAngle + "deg, " + aStops.join(", ") + ")");
    } else if (fill.type === "GRADIENT_DIAMOND" && fill.gradientStops && fill.gradientStops.length > 0) {
      // No CSS equivalent for diamond gradient — approximate as radial
      const dStops = [];
      for (let di = 0; di < fill.gradientStops.length; di++) {
        const ds = fill.gradientStops[di];
        dStops.push(htmlColorToCSS(ds.color, paintOpacity) + " " + Math.round(ds.position * 100) + "%");
      }
      backgrounds.push("radial-gradient(ellipse at center, " + dStops.join(", ") + ")");
    } else if (fill.type === "IMAGE" && fill.imageHash) {
      // Image fills — output background-size based on scaleMode
      const scaleModeMap = { FILL: "cover", FIT: "contain", TILE: "auto", CROP: "cover" };
      const bgSize = scaleModeMap[fill.scaleMode] || "cover";
      backgrounds.push("url('[image:" + fill.imageHash + "]')");
      styles["background-size"] = bgSize;
      styles["background-position"] = "center";
      if (fill.scaleMode === "TILE") styles["background-repeat"] = "repeat";
      else styles["background-repeat"] = "no-repeat";
    }
  }

  // Output: prefer single solid color as background-color, otherwise stack as background
  // Skip fully transparent colors — they block child style propagation for collapsed elements
  const visibleBgColors = bgColors.filter(function(c) { return c.indexOf(",0)") === -1; });
  if (backgrounds.length === 0 && visibleBgColors.length === 1) {
    styles["background-color"] = visibleBgColors[0];
  } else if (backgrounds.length === 0 && visibleBgColors.length > 1) {
    // Multiple solid fills — only the topmost (first visible) matters in CSS
    styles["background-color"] = visibleBgColors[0];
  } else if (backgrounds.length > 0 && bgColors.length === 0) {
    styles["background"] = backgrounds.join(", ");
  } else if (backgrounds.length > 0 && bgColors.length > 0) {
    // Mix gradients/images with solid colors — solid goes last as fallback
    styles["background"] = backgrounds.join(", ");
    if (visibleBgColors.length > 0) styles["background-color"] = visibleBgColors[0];
  }
}

// ── 5. extractCorners — Border radius ──
async function extractCorners(node, styles, cssVars, bv) {
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    // Uniform radius — check for variable binding
    const alias = bv.topLeftRadius || bv.cornerRadius;
    styles["border-radius"] = await cssBindVar(alias, node.cornerRadius, "px", cssVars);
  } else if (node.cornerRadius !== undefined && typeof node.cornerRadius !== "number") {
    // Mixed corners — individual values with variable bindings
    const tl = node.topLeftRadius || 0;
    const tr = node.topRightRadius || 0;
    const br = node.bottomRightRadius || 0;
    const bl = node.bottomLeftRadius || 0;
    if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
      const tlv = tl > 0 ? await cssBindVar(bv.topLeftRadius, tl, "px", cssVars) : "0";
      const trv = tr > 0 ? await cssBindVar(bv.topRightRadius, tr, "px", cssVars) : "0";
      const brv = br > 0 ? await cssBindVar(bv.bottomRightRadius, br, "px", cssVars) : "0";
      const blv = bl > 0 ? await cssBindVar(bv.bottomLeftRadius, bl, "px", cssVars) : "0";
      styles["border-radius"] = tlv + " " + trv + " " + brv + " " + blv;
    }
  }
}

// ── 6. extractStrokes — Borders ──
async function extractStrokes(node, styles, cssVars, bv) {
  if (!node.strokes || node.strokes.length === 0) return;

  const stroke = node.strokes[0];
  if (!stroke || stroke.visible === false || stroke.type !== "SOLID") return;

  // Determine border style from dashPattern
  let borderStyle = "solid";
  if (node.dashPattern && node.dashPattern.length > 0) {
    const sw = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
    borderStyle = (node.dashPattern[0] <= sw) ? "dotted" : "dashed";
  }

  // Stroke color with variable binding
  const sc = await cssFillColor(bv.strokes?.[0], stroke.color, 1, cssVars);

  // Check for individual stroke weights
  const hasIndividual = typeof node.strokeTopWeight === "number" && typeof node.strokeBottomWeight === "number"
    && typeof node.strokeLeftWeight === "number" && typeof node.strokeRightWeight === "number"
    && (node.strokeTopWeight !== node.strokeBottomWeight || node.strokeTopWeight !== node.strokeLeftWeight || node.strokeTopWeight !== node.strokeRightWeight);

  if (hasIndividual) {
    // Individual stroke weights per side
    styles["border-style"] = borderStyle;
    styles["border-color"] = sc;
    if (node.strokeTopWeight > 0) styles["border-top-width"] = await cssBindVar(bv.strokeTopWeight, node.strokeTopWeight, "px", cssVars);
    else styles["border-top-width"] = "0";
    if (node.strokeRightWeight > 0) styles["border-right-width"] = await cssBindVar(bv.strokeRightWeight, node.strokeRightWeight, "px", cssVars);
    else styles["border-right-width"] = "0";
    if (node.strokeBottomWeight > 0) styles["border-bottom-width"] = await cssBindVar(bv.strokeBottomWeight, node.strokeBottomWeight, "px", cssVars);
    else styles["border-bottom-width"] = "0";
    if (node.strokeLeftWeight > 0) styles["border-left-width"] = await cssBindVar(bv.strokeLeftWeight, node.strokeLeftWeight, "px", cssVars);
    else styles["border-left-width"] = "0";
  } else {
    // Uniform stroke weight
    const swVal = typeof node.strokeWeight === "number" ? node.strokeWeight : 0;
    if (swVal > 0) {
      const swCss = await cssBindVar(bv.strokeWeight, swVal, "px", cssVars);
      styles["border"] = swCss + " " + borderStyle + " " + sc;
    }
  }

  // Second stroke → outline (CSS only supports one border)
  if (node.strokes.length > 1) {
    const s2 = node.strokes[1];
    if (s2 && s2.visible !== false && s2.type === "SOLID") {
      const s2c = htmlColorToCSS(s2.color, 1);
      const s2w = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
      styles["outline"] = s2w + "px " + borderStyle + " " + s2c;
    }
  }
}

// ── 7. extractEffects — Shadows, blur, backdrop-filter ──
async function extractEffects(node, styles, cssVars, bv) {
  if (!node.effects || node.effects.length === 0) return;

  const shadows = [];
  const filters = [];
  const backdropFilters = [];

  for (let ei = 0; ei < node.effects.length; ei++) {
    const eff = node.effects[ei];
    if (!eff.visible) continue;

    if (eff.type === "DROP_SHADOW" || eff.type === "INNER_SHADOW") {
      const prefix = eff.type === "INNER_SHADOW" ? "inset " : "";
      const ebv = eff.boundVariables || {};
      const ox = eff.offset?.x ?? 0;
      const oy = eff.offset?.y ?? 0;
      const eRadius = eff.radius || 0;
      const eSpread = eff.spread || 0;
      let eColor = htmlColorToCSS(eff.color, 1);

      // Variable bindings for shadow properties
      const oxCss = ebv.offsetX ? await cssBindVar(ebv.offsetX, ox, "px", cssVars) : ox + "px";
      const oyCss = ebv.offsetY ? await cssBindVar(ebv.offsetY, oy, "px", cssVars) : oy + "px";
      const erCss = ebv.radius ? await cssBindVar(ebv.radius, eRadius, "px", cssVars) : eRadius + "px";
      const esCss = ebv.spread ? await cssBindVar(ebv.spread, eSpread, "px", cssVars) : eSpread + "px";
      if (ebv.color) {
        const ecn = await htmlResolveVarToCSSName(ebv.color.id);
        if (ecn) { const ecResolved = await htmlResolveVarValue(ebv.color.id, null); cssVars[ecn] = ecResolved ? htmlColorToCSS(ecResolved, 1) : eColor; eColor = "var(" + ecn + ")"; }
      }

      shadows.push(prefix + oxCss + " " + oyCss + " " + erCss + " " + esCss + " " + eColor);
    } else if (eff.type === "LAYER_BLUR") {
      const blurR = eff.radius || 0;
      const blurBv = eff.boundVariables || {};
      const blurCss = blurBv.radius ? await cssBindVar(blurBv.radius, blurR, "px", cssVars) : blurR + "px";
      filters.push("blur(" + blurCss + ")");
    } else if (eff.type === "BACKGROUND_BLUR") {
      const bbR = eff.radius || 0;
      const bbBv = eff.boundVariables || {};
      const bbCss = bbBv.radius ? await cssBindVar(bbBv.radius, bbR, "px", cssVars) : bbR + "px";
      backdropFilters.push("blur(" + bbCss + ")");
    } else if (eff.type === "GLASS") {
      // Approximate glass as backdrop blur
      const glassR = eff.radius || 0;
      backdropFilters.push("blur(" + glassR + "px)");
    }
  }

  if (shadows.length) styles["box-shadow"] = shadows.join(", ");
  if (filters.length) styles["filter"] = filters.join(" ");
  if (backdropFilters.length) styles["backdrop-filter"] = backdropFilters.join(" ");
}

// ── 8. extractOpacity — Layer opacity ──
async function extractOpacity(node, styles, cssVars, bv) {
  if (node.opacity === undefined || node.opacity >= 1) return;
  const val = Math.round(node.opacity * 100) + "%";
  if (bv.opacity) {
    const name = await htmlResolveVarToCSSName(bv.opacity.id);
    if (name) { cssVars[name] = val; styles["opacity"] = "var(" + name + ")"; return; }
  }
  styles["opacity"] = val;
}

// ── 9. extractBlendMode — Layer blend mode ──
function extractBlendMode(node, styles, cssVars, bv) {
  if (!node.blendMode || node.blendMode === "PASS_THROUGH" || node.blendMode === "NORMAL") return;
  const map = {
    DARKEN: "darken", MULTIPLY: "multiply", LINEAR_BURN: "multiply",
    COLOR_BURN: "color-burn", LIGHTEN: "lighten", SCREEN: "screen",
    LINEAR_DODGE: "screen", COLOR_DODGE: "color-dodge", OVERLAY: "overlay",
    SOFT_LIGHT: "soft-light", HARD_LIGHT: "hard-light", DIFFERENCE: "difference",
    EXCLUSION: "exclusion", HUE: "hue", SATURATION: "saturation",
    COLOR: "color", LUMINOSITY: "luminosity"
  };
  if (map[node.blendMode]) styles["mix-blend-mode"] = map[node.blendMode];
}

// ── 10. extractText — Typography (TEXT nodes only) ──
async function extractText(node, styles, cssVars, bv) {
  // Font family
  if (node.fontName && typeof node.fontName === "object" && node.fontName.family) {
    styles["font-family"] = "'" + node.fontName.family + "', sans-serif";
  }

  // Font size with variable binding
  if (typeof node.fontSize === "number" && node.fontSize > 0) {
    styles["font-size"] = await cssBindVar(bv.fontSize, node.fontSize, "px", cssVars);
  }

  // Font weight — prefer numeric fontWeight, fallback to style name parsing
  if (typeof node.fontWeight === "number") {
    styles["font-weight"] = await cssBindVar(bv.fontWeight, node.fontWeight, "", cssVars);
  } else if (node.fontName && typeof node.fontName === "object" && node.fontName.style) {
    const styleWeightMap = { "Thin": "100", "Hairline": "100", "ExtraLight": "200", "UltraLight": "200", "Light": "300", "Regular": "400", "Normal": "400", "Medium": "500", "SemiBold": "600", "DemiBold": "600", "Bold": "700", "ExtraBold": "800", "UltraBold": "800", "Black": "900", "Heavy": "900" };
    const rawStyle = node.fontName.style;
    const hasItalic = /italic/i.test(rawStyle);
    const hasOblique = /oblique/i.test(rawStyle);
    const cleanedStyle = rawStyle.replace(/\b(Italic|Oblique)\b/gi, "").replace(/\s+/g, "") || "Regular";
    if (styleWeightMap[cleanedStyle]) styles["font-weight"] = styleWeightMap[cleanedStyle];
    if (hasItalic) styles["font-style"] = "italic";
    else if (hasOblique) styles["font-style"] = "oblique";
  }

  // Line height with variable binding
  if (node.lineHeight && typeof node.lineHeight === "object" && node.lineHeight.value) {
    if (node.lineHeight.unit === "PERCENT") {
      const lhVal = Math.round(node.lineHeight.value) / 100;
      styles["line-height"] = bv.lineHeight ? await cssBindVar(bv.lineHeight, lhVal, "", cssVars) : String(lhVal);
    } else if (node.lineHeight.unit === "PIXELS") {
      styles["line-height"] = await cssBindVar(bv.lineHeight, node.lineHeight.value, "px", cssVars);
    }
  }

  // Letter spacing with variable binding
  if (node.letterSpacing && typeof node.letterSpacing === "object" && node.letterSpacing.value) {
    if (node.letterSpacing.unit === "PERCENT") {
      const lsVal = node.letterSpacing.value / 100;
      styles["letter-spacing"] = bv.letterSpacing ? await cssBindVar(bv.letterSpacing, lsVal, "em", cssVars) : lsVal + "em";
    } else {
      styles["letter-spacing"] = await cssBindVar(bv.letterSpacing, node.letterSpacing.value, "px", cssVars);
    }
  }

  // Text alignment
  const alignMap = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
  if (node.textAlignHorizontal && alignMap[node.textAlignHorizontal]) styles["text-align"] = alignMap[node.textAlignHorizontal];

  // Text decoration (line, style, offset, thickness, color)
  if (typeof node.textDecoration === "string" && node.textDecoration !== "NONE") {
    const decoLine = node.textDecoration === "UNDERLINE" ? "underline" : "line-through";
    styles["text-decoration-line"] = decoLine;

    // Decoration style (solid, wavy, dotted)
    if (typeof node.textDecorationStyle === "string" && node.textDecorationStyle !== "SOLID") {
      const decoStyleMap = { WAVY: "wavy", DOTTED: "dotted" };
      if (decoStyleMap[node.textDecorationStyle]) styles["text-decoration-style"] = decoStyleMap[node.textDecorationStyle];
    }

    // Decoration offset
    if (node.textDecorationOffset && typeof node.textDecorationOffset === "object" && node.textDecorationOffset.unit !== "AUTO") {
      const offVal = node.textDecorationOffset.value;
      if (node.textDecorationOffset.unit === "PERCENT") styles["text-underline-offset"] = offVal + "%";
      else styles["text-underline-offset"] = offVal + "px";
    }

    // Decoration thickness
    if (node.textDecorationThickness && typeof node.textDecorationThickness === "object" && node.textDecorationThickness.unit !== "AUTO") {
      const thkVal = node.textDecorationThickness.value;
      if (node.textDecorationThickness.unit === "PERCENT") styles["text-decoration-thickness"] = thkVal + "%";
      else styles["text-decoration-thickness"] = thkVal + "px";
    }

    // Decoration color
    if (node.textDecorationColor && typeof node.textDecorationColor === "object" && node.textDecorationColor.value !== "AUTO") {
      const decoColor = node.textDecorationColor.value;
      if (decoColor && decoColor.type === "SOLID") styles["text-decoration-color"] = htmlColorToCSS(decoColor.color, 1);
    }
  }

  // Text case + small caps
  if (typeof node.textCase === "string") {
    const caseMap = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" };
    if (caseMap[node.textCase]) styles["text-transform"] = caseMap[node.textCase];
    else if (node.textCase === "SMALL_CAPS") styles["font-variant-caps"] = "small-caps";
    else if (node.textCase === "SMALL_CAPS_FORCED") styles["font-variant-caps"] = "all-small-caps";
  }

  // Paragraph spacing with variable binding
  if (typeof node.paragraphSpacing === "number" && node.paragraphSpacing > 0) {
    styles["margin-bottom"] = await cssBindVar(bv.paragraphSpacing, node.paragraphSpacing, "px", cssVars);
  }

  // Paragraph indent with variable binding
  if (typeof node.paragraphIndent === "number" && node.paragraphIndent > 0) {
    styles["text-indent"] = await cssBindVar(bv.paragraphIndent, node.paragraphIndent, "px", cssVars);
  }

  // Text color (fills on TEXT = foreground color)
  if (node.fills && Array.isArray(node.fills) && node.fills.length > 0 && node.fills[0].type === "SOLID") {
    styles["color"] = await cssFillColor(bv.fills?.[0], node.fills[0].color, 1, cssVars);
  }
}

// ── Main CSS extraction — modular pipeline ──
export async function htmlExtractNodeCSS(node, cssVars) {
  const styles = {};
  const bv = node.boundVariables || {};
  extractPosition(node, styles, cssVars, bv);
  await extractLayout(node, styles, cssVars, bv);
  await extractSizing(node, styles, cssVars, bv);
  await extractFills(node, styles, cssVars, bv);
  await extractCorners(node, styles, cssVars, bv);
  await extractStrokes(node, styles, cssVars, bv);
  await extractEffects(node, styles, cssVars, bv);
  await extractOpacity(node, styles, cssVars, bv);
  extractBlendMode(node, styles, cssVars, bv);
  if (node.type === "TEXT") await extractText(node, styles, cssVars, bv);
  return styles;
}

export async function htmlGetSemanticTag(node, depth, pageType) {
  const name = (node.name || "").toLowerCase();
  const type = node.type;

  // Top-level frame tag depends on page type
  if (depth === 0 && (type === "FRAME" || type === "SECTION")) {
    if (pageType === "promo") return "section";
    // landing/fullsite: top-level represents <body>, handled by skipping wrapper in main.ts
    if (pageType === "landing" || pageType === "fullsite") return "body";
  }

  if (type === "TEXT") {
    const fs = typeof node.fontSize === "number" ? node.fontSize : 14;
    if (fs >= 48) return "h1";
    if (fs >= 36) return "h2";
    if (fs >= 24) return "h3";
    if (fs >= 18) return "h4";
    if (fs >= 15) return "h5";
    return "p";
  }

  // Check component name for INSTANCE nodes (e.g. "Variant=Primary, Size=Default" -> check the component set name)
  let componentHint = "";
  if (type === "INSTANCE") {
    try {
      const mainComp = typeof node.getMainComponentAsync === "function" ? await node.getMainComponentAsync() : node.mainComponent;
      if (mainComp) {
        componentHint = (mainComp.parent?.type === "COMPONENT_SET" ? mainComp.parent.name : mainComp.name).toLowerCase();
      }
    } catch(e) {}
  }

  // Semantic section mapping (any frame-like type)
  if (type === "FRAME" || type === "SECTION" || type === "GROUP" || type === "COMPONENT" || type === "COMPONENT_SET" || type === "INSTANCE") {
    // Promo pages use a flat structure — no nav/header/footer/article tags
    if (pageType !== "promo") {
      if (name.indexOf("nav") !== -1 || name === "header") return "nav";
      if (name.indexOf("header") !== -1) return "header";
      if (name.indexOf("footer") !== -1) return "footer";
    }
    if (name.indexOf("hero") !== -1) return "section";
    if (name.indexOf("banner") !== -1) return "section";
    if (name.indexOf("popup") !== -1 || name.indexOf("modal") !== -1 || name.indexOf("dialog") !== -1) return "div";

    // Form detection
    if (name === "form") return "form";

    // Button detection: check node name, component name, or component set name
    if (name.indexOf("button") !== -1 || name.indexOf("btn") !== -1 || name.indexOf("cta") !== -1
        || componentHint.indexOf("button") !== -1 || componentHint.indexOf("btn") !== -1) return "button";

    // Dropdown / select detection — same structure as floating-label input, just renders <select> instead of <input>
    if (name.indexOf("dropdown") !== -1 || name.indexOf("select") !== -1
        || componentHint.indexOf("dropdown") !== -1 || componentHint.indexOf("select") !== -1) return "form-field-floating";

    // Floating label input detection — check both componentHint and name so it works even if mainComponent is null
    if (componentHint.indexOf("floating label") !== -1 || name.indexOf("floatinglabel") !== -1 || name.indexOf("floating-label") !== -1) return "form-field-floating";
    if (componentHint.indexOf("input") !== -1 || componentHint.indexOf("field") !== -1 || componentHint.indexOf("text-field") !== -1) return "form-field";
    if (name.indexOf("input") !== -1 || name.indexOf("field") !== -1 || name.indexOf("textarea") !== -1) return "input";

    // Link detection
    if (name.indexOf("link") !== -1 || componentHint.indexOf("link") !== -1) return "a";

    // Image detection (for instance/component only)
    if ((type === "INSTANCE" || type === "COMPONENT") && (name.indexOf("image") !== -1 || name.indexOf("img") !== -1 || name.indexOf("icon") !== -1)) return "img";
  }

  if (type === "FRAME" || type === "SECTION" || type === "GROUP" || type === "INSTANCE" || type === "COMPONENT" || type === "COMPONENT_SET") return "div";
  if (type === "RECTANGLE" || type === "ELLIPSE" || type === "LINE" || type === "VECTOR" || type === "STAR" || type === "POLYGON") return "div";
  return "div";
}

export function htmlGetSemanticClass(node, tag) {
  // Semantic tags use tag-based short names
  if (tag === "nav" || tag === "header" || tag === "footer" || tag === "main") return tag;
  if (tag === "section") {
    const sn = htmlAbbreviateName(node.name || "");
    return sn || "section";
  }
  if (tag === "button") return "btn";
  if (tag === "form") return "form";
  if (tag === "form-field" || tag === "form-field-floating") return "form-field";
  if (tag === "input") return "input";
  if (tag === "a") return "link";
  if (/^h[1-6]$/.test(tag)) return tag;
  if (tag === "p") return "text";
  if (tag === "img") return "img";
  // For divs: try abbreviated name from node
  const abbr = htmlAbbreviateName(node.name || "");
  return abbr || "box";
}

export function htmlNodeIsExportableImage(node) {
  // Only treat as <img> if the node has exportSettings configured by the designer
  if (!node.exportSettings || node.exportSettings.length === 0) return false;
  const isLeaf = !("children" in node) || !node.children || node.children.length === 0;
  const isShape = node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR" || node.type === "LINE";
  return isLeaf || isShape;
}

export async function htmlNodeHasBgImageVar(node) {
  // Check if the node (or its main component) is marked as a background image.
  // Detection priority: pluginData "role" → variable binding → component name fallback
  try {
    // 1. Direct pluginData check
    if (node.getPluginData && node.getPluginData("role") === "background-image") return true;

    // 2. For instances, check the main component's pluginData
    if (node.type === "INSTANCE" && node.mainComponent) {
      if (node.mainComponent.getPluginData && node.mainComponent.getPluginData("role") === "background-image") return true;

      // Also check the component set
      const parentSet = node.mainComponent.parent;
      if (parentSet?.type === "COMPONENT_SET" && parentSet.getPluginData?.("role") === "background-image") return true;
    }

    // 3. Legacy: variable binding check
    const bv = node.boundVariables || {};
    if (bv.visible) {
      const v = await figma.variables.getVariableByIdAsync(bv.visible.id);
      if (v && v.name === "background-image") return true;
    }
    if (node.type === "INSTANCE" && node.mainComponent) {
      const compBv = node.mainComponent.boundVariables || {};
      if (compBv.visible) {
        const cv = await figma.variables.getVariableByIdAsync(compBv.visible.id);
        if (cv && cv.name === "background-image") return true;
      }
    }

    // 4. Fallback: name-based detection
    if (node.type === "INSTANCE" && node.mainComponent) {
      const setName = node.mainComponent.parent?.type === "COMPONENT_SET"
        ? node.mainComponent.parent.name : node.mainComponent.name;
      if (setName.toLowerCase().indexOf("background image") !== -1 || setName.toLowerCase().indexOf("background-image") !== -1) return true;
    }
  } catch(e) {}
  return false;
}

export async function htmlNodeHasImageFill(node) {
  // Primary: detect via "background-image" boolean variable binding
  if (await htmlNodeHasBgImageVar(node)) return true;
  // Fallback: container frames with exportSettings and IMAGE fill → background-image
  const hasChildren = ("children" in node) && node.children && node.children.length > 0;
  if (hasChildren && node.exportSettings && node.exportSettings.length > 0 && node.fills && Array.isArray(node.fills)) {
    for (let i = 0; i < node.fills.length; i++) {
      if (node.fills[i].type === "IMAGE" && node.fills[i].visible !== false) return true;
    }
  }
  return false;
}

export const _htmlImageNameCount = {};

export async function htmlExportImage(node, progressCb) {
  try {
    if (!node.exportSettings || node.exportSettings.length === 0) return null;

    let baseName = htmlSanitizeName(node.name || "image");
    // Deduplicate image file names to prevent collisions
    if (!_htmlImageNameCount[baseName]) _htmlImageNameCount[baseName] = 0;
    _htmlImageNameCount[baseName]++;
    if (_htmlImageNameCount[baseName] > 1) baseName = baseName + "-" + _htmlImageNameCount[baseName];

    const variants = [];
    for (let esi = 0; esi < node.exportSettings.length; esi++) {
      const es = node.exportSettings[esi];
      const format = (es.format || "PNG");
      const constraint = es.constraint || { type: "SCALE", value: 1 };
      const scale = constraint.type === "SCALE" ? (constraint.value || 1) : 1;
      const ext = format.toLowerCase();
      const suffix = es.suffix || (scale !== 1 ? "@" + scale + "x" : "");
      const fileName = baseName + suffix + "." + ext;
      const bytes = await node.exportAsync({ format: format, constraint: constraint });
      variants.push({ name: fileName, format: ext, bytes: Array.from(bytes), scale: scale });
    }

    // Primary variant is 1x, or the first one if no 1x exists
    let primary = variants[0];
    for (let vi = 0; vi < variants.length; vi++) {
      if (variants[vi].scale === 1) { primary = variants[vi]; break; }
    }

    // Figma node dimensions are the 1x size
    const displayWidth = Math.round(node.width);
    const displayHeight = Math.round(node.height);

    return {
      name: primary.name,
      format: primary.format,
      bytes: primary.bytes,
      variants: variants,
      displayWidth: displayWidth,
      displayHeight: displayHeight
    };
  } catch(e) {
    return null;
  }
}

// Infer HTML input type from node name and label text
function inferInputType(nodeName, labelTexts) {
  const hints = (nodeName + " " + labelTexts.join(" ")).toLowerCase();
  if (hints.indexOf("textarea") !== -1 || hints.indexOf("message") !== -1 || hints.indexOf("comment") !== -1 || hints.indexOf("description") !== -1) return "textarea";
  if (hints.indexOf("email") !== -1) return "email";
  if (hints.indexOf("password") !== -1) return "password";
  if (hints.indexOf("phone") !== -1 || hints.indexOf("tel") !== -1) return "tel";
  if (hints.indexOf("number") !== -1 || hints.indexOf("quantity") !== -1 || hints.indexOf("amount") !== -1) return "number";
  if (hints.indexOf("url") !== -1 || hints.indexOf("website") !== -1) return "url";
  if (hints.indexOf("date") !== -1 || hints.indexOf("birthday") !== -1) return "date";
  if (hints.indexOf("search") !== -1) return "search";
  if (hints.indexOf("checkbox") !== -1) return "checkbox";
  if (hints.indexOf("radio") !== -1) return "radio";
  return "text";
}

// ── htmlWalkNode helpers ──────────────────────────────────────────────

// Read scaleMode from an array of fills and return the matching CSS background-size value
function bgSizeFromFills(fills) {
  let bgSize = "cover";
  if (!fills) return bgSize;
  for (let i = 0; i < fills.length; i++) {
    if (fills[i].type === "IMAGE" && fills[i].visible !== false) {
      const smMap = { FILL: "cover", FIT: "contain", TILE: "auto", CROP: "cover" };
      bgSize = smMap[fills[i].scaleMode] || "cover";
      break;
    }
  }
  return bgSize;
}

// Apply background-size/position/repeat styles from a resolved bgSize value
function applyBgImageStyles(styles, bgSize) {
  styles["background-size"] = bgSize;
  styles["background-position"] = "center";
  if (bgSize === "auto") styles["background-repeat"] = "repeat";
}

// Absorb absolute-positioned bg-image child instances into the parent's CSS background-image
function absorbBgImageChildren(children, styles) {
  let hasImageFill = false;
  let bgImageName = null;
  let bgImageNodeId = null;
  const filteredChildren = [];
  for (let bci = 0; bci < children.length; bci++) {
    const bc = children[bci];
    if (bc.isBgImageChild) {
      hasImageFill = true;
      bgImageName = htmlSanitizeName(bc.nodeName || "bg") + "-bg";
      const childBgSize = bgSizeFromFills(bc.bgImageFills);
      applyBgImageStyles(styles, childBgSize);
      bgImageNodeId = bc.nodeId;
    } else {
      filteredChildren.push(bc);
    }
  }
  return { hasImageFill, bgImageName, bgImageNodeId, filteredChildren };
}

// Convert flex-wrap rows with grid column spans to CSS Grid
function convertFlexWrapToGrid(children, styles) {
  let hasGridSpans = false;
  for (let gci = 0; gci < children.length; gci++) {
    if (children[gci].colSpan) { hasGridSpans = true; break; }
  }
  if (!hasGridSpans) return;
  styles["display"] = "grid";
  styles["grid-template-columns"] = "repeat(12, 1fr)";
  delete styles["flex-direction"];
  delete styles["flex-wrap"];
  for (let gci2 = 0; gci2 < children.length; gci2++) {
    const cs = children[gci2].colSpan || 12;
    if (!children[gci2].utilityClasses) children[gci2].utilityClasses = [];
    children[gci2].utilityClasses.push("col-span-" + cs);
    delete children[gci2].styles["flex"];
    delete children[gci2].styles["flex-shrink"];
    delete children[gci2].styles["min-width"];
    delete children[gci2].styles["max-width"];
    delete children[gci2].styles["width"];
  }
}

// Recursively search child tree for small icon nodes (close-x, chevron, etc.)
async function findIconInChildren(childList) {
  for (let fi = 0; fi < childList.length; fi++) {
    const fc = childList[fi];
    const fcNode = await figma.getNodeByIdAsync(fc.nodeId);
    if (!fcNode) continue;
    const hasExport = fcNode.exportSettings && fcNode.exportSettings.length > 0;
    const fcName = (fcNode.name || "").toLowerCase();
    const isNamedIcon = fcName.indexOf("icon") !== -1;
    let hasFills = false;
    try { const ff = fcNode.fills; hasFills = ff && ff.length > 0 && ff[0].visible !== false; } catch(e) {}
    let hasStrokes = false;
    try { const ss = fcNode.strokes; hasStrokes = ss && ss.length > 0; } catch(e) {}
    const hasVisualChildren = fcNode.children && fcNode.children.length > 0;
    const isSmallIcon = fcNode.type !== "TEXT" && fcNode.width <= 32 && fcNode.height <= 32
      && (hasFills || hasStrokes || hasVisualChildren);
    if (hasExport || isNamedIcon || isSmallIcon) {
      return { nodeId: fc.nodeId, nodeName: fc.nodeName, width: fcNode.width, height: fcNode.height, hasExport: hasExport };
    }
    if (fc.children && fc.children.length > 0) {
      const found = await findIconInChildren(fc.children);
      if (found) return found;
    }
  }
  return null;
}

// Remove a specific icon node from the child tree by nodeId
function removeIconFromChildren(children, iconNodeId) {
  const result = [];
  for (let ri = 0; ri < children.length; ri++) {
    if (children[ri].nodeId === iconNodeId) continue;
    if (children[ri].children && children[ri].children.length > 0) {
      children[ri].children = removeIconFromChildren(children[ri].children, iconNodeId);
    }
    result.push(children[ri]);
  }
  return result;
}

// Propagate visual styles from collapsed-element children upward, and strip layout props for inputs
function propagateCollapsedStyles(tag, styles, children, node) {
  const skipProps = { "position": 1, "left": 1, "right": 1, "top": 1, "bottom": 1,
    "display": 1, "flex-direction": 1, "flex-wrap": 1, "justify-content": 1,
    "align-items": 1, "gap": 1, "flex": 1, "width": 1, "max-width": 1, "min-width": 1,
    "height": 1, "max-height": 1, "min-height": 1,
    "padding": 1, "aspect-ratio": 1, "transform": 1, "overflow": 1, "z-index": 1,
    "background": 1, "background-image": 1, "background-size": 1,
    "background-position": 1, "background-repeat": 1 };
  const collectChildStyles = function(childList) {
    for (let ci = 0; ci < childList.length; ci++) {
      const c = childList[ci];
      const keys = Object.keys(c.styles);
      for (let ki = 0; ki < keys.length; ki++) {
        if (!skipProps[keys[ki]] && !styles[keys[ki]]) {
          styles[keys[ki]] = c.styles[keys[ki]];
        }
      }
      if (c.children && c.children.length > 0) collectChildStyles(c.children);
    }
  };
  collectChildStyles(children);

  if (tag === "input") {
    const stripLayout = ["display", "flex-direction", "flex-wrap", "justify-content",
      "align-items", "gap", "row-gap", "column-gap", "padding"];
    for (let sli = 0; sli < stripLayout.length; sli++) {
      delete styles[stripLayout[sli]];
    }
    if (styles["position"] === "relative") delete styles["position"];
  }

  if (!styles["height"] && node.height > 0) {
    styles["height"] = Math.round(node.height) + "px";
  }
}

export async function htmlWalkNode(node, cssVars, images, depth, _unused, pageType) {
  if (!node || node.visible === false) return null;
  if (depth > 20) return null; // safety limit

  let tag = await htmlGetSemanticTag(node, depth, pageType);
  const className = htmlGetSemanticClass(node, tag);

  const nodeName = (node.name || "").toLowerCase();
  let compHint = "";
  try { if (node.type === "INSTANCE" || node.type === "COMPONENT") { const mp = (typeof node.getMainComponentAsync === "function" ? await node.getMainComponentAsync() : node.mainComponent) || node; compHint = (mp.parent?.name ?? "").toLowerCase(); } } catch(e) {}
  const isSelect = nodeName.indexOf("dropdown") !== -1 || nodeName.indexOf("select") !== -1
    || compHint.indexOf("dropdown") !== -1 || compHint.indexOf("select") !== -1;

  const styles = await htmlExtractNodeCSS(node, cssVars);
  let text = null;
  const isExportableImage = htmlNodeIsExportableImage(node);
  let hasImageFill = !isExportableImage && await htmlNodeHasImageFill(node);
  let imageName = null;
  let bgImageName = null;
  let bgImageNodeId = null;
  let isBgImageChild = false;
  let bgImageFills = null;
  let children = [];

  // Detect if this node is a bg-image component instance (absolute-positioned)
  // that should be absorbed by its parent as CSS background-image
  if (node.layoutPositioning === "ABSOLUTE" && await htmlNodeHasBgImageVar(node)) {
    isBgImageChild = true;
    // Carry fills so parent can read scaleMode during absorption
    try { bgImageFills = node.fills; } catch(e) { bgImageFills = null; }
  }

  // Top-level frames: always full-width, ignore Figma's fixed width and max-width
  if (depth === 0 && (node.type === "FRAME" || node.type === "SECTION")) {
    styles["width"] = "100%";
    if (styles["height"]) {
      styles["min-height"] = styles["height"];
      delete styles["height"];
    }
    delete styles["max-width"];
  }

  if (node.type === "TEXT") {
    text = node.characters || "";
  }

  // Leaf image nodes: export as <img>
  if (isExportableImage) {
    imageName = htmlSanitizeName(node.name || "image");
    tag = "img";
  }

  // Container frames with IMAGE fill: export as background-image, keep walking children
  if (hasImageFill) {
    bgImageName = htmlSanitizeName(node.name || "bg") + "-bg";
    let nodeFills = null;
    try { nodeFills = node.fills; } catch(e) {}
    applyBgImageStyles(styles, bgSizeFromFills(nodeFills));
  }

  // Walk children (skip for exportable images — they're leaf <img> tags)
  if ("children" in node && node.children && !isExportableImage) {
    for (let i = 0; i < node.children.length; i++) {
      const child = await htmlWalkNode(node.children[i], cssVars, images, depth + 1, null, pageType);
      if (child) children.push(child);
    }
  }

  // Absorb background-image child instances into parent's CSS background-image
  // (absolute-positioned bg image component instances should not render as child divs)
  if (!hasImageFill && children.length > 0) {
    const absorbed = absorbBgImageChildren(children, styles);
    if (absorbed.hasImageFill) {
      hasImageFill = true;
      bgImageName = absorbed.bgImageName;
      bgImageNodeId = absorbed.bgImageNodeId;
    }
    children = absorbed.filteredChildren;
  }

  // Convert flex-wrap rows with grid column spans to CSS Grid for exact proportions
  if (styles["flex-wrap"] === "wrap" && children.length > 0) {
    convertFlexWrapToGrid(children, styles);
  }

  let iconNodeId = null;
  let iconNodeName = "";

  // For any select: detect chevron icon, remove from children so it renders as background-image
  if (isSelect && children.length > 0) {
    const selIconInfo = await findIconInChildren(children);
    if (selIconInfo) {
      iconNodeId = selIconInfo.nodeId;
      iconNodeName = selIconInfo.nodeName;
      children = removeIconFromChildren(children, selIconInfo.nodeId);
    }
  }

  // For collapsed elements (button, input, a), propagate child styles upward
  // since children won't appear in the HTML output.
  if (tag === "button" || tag === "input" || tag === "a") {
    const iconInfo = await findIconInChildren(children);
    if (iconInfo) {
      iconNodeId = iconInfo.nodeId;
      iconNodeName = iconInfo.nodeName;
    }
    propagateCollapsedStyles(tag, styles, children, node);
  }

  return {
    tag: tag,
    className: className,
    utilityClasses: [],
    styles: styles,
    text: text,
    imageName: imageName,
    bgImageName: bgImageName,
    bgImageNodeId: bgImageNodeId,
    iconNodeId: iconNodeId,
    iconNodeName: iconNodeName,
    isImage: isExportableImage,
    hasBgImage: hasImageFill,
    isBgImageChild: isBgImageChild,
    bgImageFills: bgImageFills,
    colSpan: (function() { try { const d = node.getPluginData && node.getPluginData("colSpan"); return d ? (parseInt(d) || 0) : 0; } catch(e) { return 0; } })(),
    isRequired: (function() {
      // Primary: read plugin data set by wireframe generator
      try { if (node.getPluginData && node.getPluginData("required") === "true") return true; } catch(e) {}
      // Fallback: check if any text child ends with " *" (wireframe generator always adds this)
      try {
        if ("children" in node && node.children) {
          for (let ri = 0; ri < node.children.length; ri++) {
            if (node.children[ri].type === "TEXT" && /\s\*\s*$/.test(node.children[ri].characters || "")) return true;
          }
        }
      } catch(e) {}
      return false;
    })(),
    isSelect: isSelect,
    inputType: (function() {
      if (isSelect) return "text";
      if (tag !== "form-field-floating" && tag !== "form-field" && tag !== "input") return "text";
      const labelTexts = [];
      try {
        if ("children" in node && node.children) {
          for (let iti = 0; iti < node.children.length; iti++) {
            if (node.children[iti].type === "TEXT") labelTexts.push(node.children[iti].characters || "");
          }
        }
      } catch(e) {}
      return inferInputType(node.name || "", labelTexts);
    })(),
    _labelStyles: null,
    _inputStyles: null,
    nodeId: node.id,
    nodeName: node.name,
    children: children
  };
}

export function htmlRenderCSS(cssVars, desktopTree, mobileTree, tokens) {
  const lines = [];

  // CSS custom properties
  lines.push(":root {");
  const varKeys = Object.keys(cssVars).sort();
  for (let vi = 0; vi < varKeys.length; vi++) {
    lines.push("  " + varKeys[vi] + ": " + cssVars[varKeys[vi]] + ";");
  }
  lines.push("}");
  lines.push("");

  // Basic reset
  lines.push("*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }");
  lines.push("body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; -webkit-font-smoothing: antialiased; }");
  lines.push("img { max-width: 100%; height: auto; display: block; }");
  lines.push("button { cursor: pointer; font: inherit; display: inline-flex; align-items: center; justify-content: center; border: none; background: none; }");
  lines.push("input, select { font: inherit; display: block; width: 100%; }");
  lines.push("select { appearance: none; -webkit-appearance: none; -moz-appearance: none; }");
  lines.push("a { text-decoration: none; color: inherit; }");
  lines.push(".required-star { color: #e53333; }");
  lines.push("");

  // Utility classes
  const utilCSS = htmlGenerateUtilityCSS(tokens, cssVars);
  if (utilCSS) {
    lines.push(utilCSS);
    lines.push("");
  }

  lines.push("/* ── Component Styles ─────────────────────────────────── */");

  // Component styles from tree
  const classStyles = {};
  htmlCollectClassStyles(desktopTree, classStyles);
  const classNames = Object.keys(classStyles);
  for (let ci = 0; ci < classNames.length; ci++) {
    const cn = classNames[ci];
    const props = classStyles[cn];
    const propKeys = Object.keys(props);
    if (propKeys.length === 0) continue;
    lines.push("." + cn + " {");
    for (let pi = 0; pi < propKeys.length; pi++) {
      lines.push("  " + propKeys[pi] + ": " + props[propKeys[pi]] + ";");
    }
    lines.push("}");
    lines.push("");
  }

  // Mobile overrides
  if (mobileTree) {
    const mobileStyles = {};
    htmlCollectClassStyles(mobileTree, mobileStyles);
    const diffs = [];
    const mobileKeys = Object.keys(mobileStyles);
    for (let mi = 0; mi < mobileKeys.length; mi++) {
      const mk = mobileKeys[mi];
      const desktopProps = classStyles[mk] || {};
      const mobileProps = mobileStyles[mk];
      const diffProps = {};
      const mpKeys = Object.keys(mobileProps);
      for (let mpi = 0; mpi < mpKeys.length; mpi++) {
        if (desktopProps[mpKeys[mpi]] !== mobileProps[mpKeys[mpi]]) {
          diffProps[mpKeys[mpi]] = mobileProps[mpKeys[mpi]];
        }
      }
      if (Object.keys(diffProps).length > 0) {
        diffs.push({ className: mk, props: diffProps });
      }
    }
    if (diffs.length > 0) {
      lines.push("@media (max-width: " + MOBILE_BREAKPOINT + "px) {");
      for (let di = 0; di < diffs.length; di++) {
        lines.push("  ." + diffs[di].className + " {");
        const dpKeys = Object.keys(diffs[di].props);
        for (let dpi = 0; dpi < dpKeys.length; dpi++) {
          lines.push("    " + dpKeys[dpi] + ": " + diffs[di].props[dpKeys[dpi]] + ";");
        }
        lines.push("  }");
      }
      lines.push("}");
    }
  }

  // Mobile: stack grid items in single column
  const gridClasses = [];
  for (let gci3 = 0; gci3 < classNames.length; gci3++) {
    if (classStyles[classNames[gci3]]["grid-template-columns"]) gridClasses.push(classNames[gci3]);
  }
  if (gridClasses.length > 0) {
    lines.push("@media (max-width: " + MOBILE_BREAKPOINT + "px) {");
    for (let gci4 = 0; gci4 < gridClasses.length; gci4++) {
      lines.push("  ." + gridClasses[gci4] + " { grid-template-columns: 1fr; }");
    }
    lines.push("  [class*='col-span-'] { grid-column: span 1; }");
    lines.push("}");
  }

  return lines.join("\n");
}

function stylesMatch(a, b) {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (a[aKeys[i]] !== b[aKeys[i]]) return false;
  }
  return true;
}

export function htmlCollectClassStyles(tree, out) {
  if (!tree) return;
  const isFormField = (tree.tag === "form-field-floating" || tree.tag === "form-field");
  if (tree.className && Object.keys(tree.styles).length > 0) {
    const cn = tree.className;
    if (out[cn]) {
      // For form fields: also compare sub-styles (input/label) to avoid collisions
      const wrapperMatch = stylesMatch(out[cn], tree.styles);
      let subMatch = true;
      if (isFormField) {
        const fieldInputSel = tree.isSelect ? " select" : " input";
        const existingInput = out[cn + fieldInputSel];
        const existingLabel = out[cn + " label"];
        if (existingInput && tree._inputStyles && !stylesMatch(existingInput, tree._inputStyles)) subMatch = false;
        if (existingLabel && tree._labelStyles && !stylesMatch(existingLabel, tree._labelStyles)) subMatch = false;
        if (tree.isSelect && out[cn + " input"]) subMatch = false;
        if (!tree.isSelect && out[cn + " select"]) subMatch = false;
      }
      if (!wrapperMatch || !subMatch) {
        let suffix = 2;
        while (out[cn + "-" + suffix]) suffix++;
        tree.className = cn + "-" + suffix;
        out[tree.className] = tree.styles;
      }
    } else {
      out[cn] = tree.styles;
    }
  }
  // For form fields: use pre-resolved styles (after utility class extraction)
  if (isFormField && tree.className) {
    const fieldInputSelector = tree.isSelect ? " select" : " input";
    if (tree._inputStyles && Object.keys(tree._inputStyles).length > 0) out[tree.className + fieldInputSelector] = tree._inputStyles;
    if (tree._labelStyles && Object.keys(tree._labelStyles).length > 0) out[tree.className + " label"] = tree._labelStyles;
    return;
  }
  for (let i = 0; i < tree.children.length; i++) {
    htmlCollectClassStyles(tree.children[i], out);
  }
}

// Extract label and input styles from form-field children for CSS generation.
// Propagates all styles — text children → labelStyles, non-text children → inputStyles.
export function htmlExtractFormFieldChildStyles(tree, labelStyles, inputStyles) {
  if (!tree || !tree.children) return;
  // Structural props that shouldn't propagate to input styles
  const skipLayout = { "display": 1, "flex-direction": 1, "flex-wrap": 1, "justify-content": 1,
    "align-items": 1, "gap": 1, "flex": 1, "width": 1, "max-width": 1, "min-width": 1,
    "position": 1, "left": 1, "right": 1, "top": 1, "bottom": 1,
    "padding": 1, "aspect-ratio": 1, "transform": 1, "overflow": 1, "z-index": 1,
    "background": 1, "background-image": 1, "background-size": 1, "background-position": 1, "background-repeat": 1 };
  // For text children (labels): only skip sizing/layout — ALLOW positioning through (left/top/position/transform)
  const skipTextProps = { "display": 1, "flex-direction": 1, "flex-wrap": 1, "justify-content": 1,
    "align-items": 1, "gap": 1, "flex": 1, "width": 1, "max-width": 1, "min-width": 1,
    "height": 1, "max-height": 1, "min-height": 1,
    "padding": 1, "aspect-ratio": 1, "overflow": 1, "z-index": 1,
    "background": 1, "background-image": 1, "background-size": 1, "background-position": 1, "background-repeat": 1 };
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (child.text !== null && child.text !== undefined) {
      // Text children → label styles (allow position/left/top/transform for Figma label positioning)
      const lKeys = Object.keys(child.styles);
      for (let li = 0; li < lKeys.length; li++) {
        if (!skipTextProps[lKeys[li]] && !labelStyles[lKeys[li]]) labelStyles[lKeys[li]] = child.styles[lKeys[li]];
      }
    } else {
      // Non-text children → input field styles
      const iKeys = Object.keys(child.styles);
      for (let ii = 0; ii < iKeys.length; ii++) {
        if (!skipLayout[iKeys[ii]] && !inputStyles[iKeys[ii]]) inputStyles[iKeys[ii]] = child.styles[iKeys[ii]];
      }
      // Recurse into nested wrappers (field-wrapper > field + label)
      htmlExtractFormFieldChildStyles(child, labelStyles, inputStyles);
    }
  }
}

// Find the field-wrapper node in a form-field tree (the container with "wrapper" in name,
// or the deepest non-text node whose children include both text and non-text nodes)
export function htmlFindFieldWrapper(tree) {
  if (!tree || !tree.children) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (child.nodeName && child.nodeName.toLowerCase().indexOf("wrapper") !== -1) return child;
    const nested = htmlFindFieldWrapper(child);
    if (nested) return nested;
  }
  return null;
}

// Find the first text node in a tree (the label)
function htmlFindLabelNode(tree) {
  if (!tree || !tree.children) return null;
  for (let i = 0; i < tree.children.length; i++) {
    const child = tree.children[i];
    if (child.text !== null && child.text !== undefined) return child;
    const nested = htmlFindLabelNode(child);
    if (nested) return nested;
  }
  return null;
}

// Collect all text nodes from a tree in order (for form fields with label + placeholder)
export function htmlCollectAllTexts(tree) {
  const results = [];
  if (!tree) return results;
  if (tree.text !== null && tree.text !== undefined && tree.text.trim()) results.push(tree.text.trim());
  for (let i = 0; i < tree.children.length; i++) {
    const childTexts = htmlCollectAllTexts(tree.children[i]);
    for (let j = 0; j < childTexts.length; j++) results.push(childTexts[j]);
  }
  return results;
}

// Extract first text content from a component tree (for buttons, inputs, etc.)
export function htmlExtractTextFromTree(tree) {
  if (!tree) return "";
  if (tree.text !== null && tree.text !== undefined) return tree.text;
  for (let i = 0; i < tree.children.length; i++) {
    const t = htmlExtractTextFromTree(tree.children[i]);
    if (t) return t;
  }
  return "";
}

// Format label for required fields: strip any existing asterisk, append styled one.
// Called only when isRequired is true (from plugin data), no text detection needed.
function formatRequiredLabel(escapedLabel) {
  // Remove trailing asterisk if the wireframe generator already added one
  const clean = escapedLabel.replace(/\s*\*\s*$/, "");
  return clean + ' <span class="required-star">*</span>';
}

export function htmlRenderNodeClean(tree, indent) {
  // Render HTML without inline styles (styles are in CSS file)
  if (!tree) return "";
  let pad = "";
  for (let i = 0; i < indent; i++) pad += "  ";
  const lines = [];

  let attrs = "";
  const allClasses = [];
  if (tree.className) allClasses.push(tree.className);
  if (tree.utilityClasses) {
    for (let ui = 0; ui < tree.utilityClasses.length; ui++) allClasses.push(tree.utilityClasses[ui]);
  }
  if (allClasses.length > 0) attrs += ' class="' + allClasses.join(" ") + '"';

  // "body" tag from landing/fullsite: skip wrapper, render children directly
  if (tree.tag === "body" && tree.children && tree.children.length > 0) {
    for (let bi = 0; bi < tree.children.length; bi++) {
      lines.push(htmlRenderNodeClean(tree.children[bi], indent));
    }
    return lines.join("\n");
  }

  if (tree.tag === "img") {
    const src = tree.imageName ? "assets/" + tree.imageName : "assets/placeholder.png";
    let imgAttrs = attrs + ' src="' + src + '" alt="' + (tree.nodeName || "").replace(/"/g, "&quot;") + '"';
    const srcset = buildSrcset(tree.imageVariants, "assets/");
    if (srcset) imgAttrs += ' srcset="' + srcset + '"';
    if (tree.imageWidth) imgAttrs += ' width="' + tree.imageWidth + '"';
    if (tree.imageHeight) imgAttrs += ' height="' + tree.imageHeight + '"';
    lines.push(pad + '<img' + imgAttrs + ' />');
  } else if (tree.tag === "form-field-floating") {
    // Floating label: follows component structure — form-field > field-wrapper > input + label
    const flfTexts = htmlCollectAllTexts(tree);
    let flfLabel = flfTexts.length > 0 ? htmlEscapeText(flfTexts[0]) : "";
    if (tree.isRequired) flfLabel = formatRequiredLabel(flfLabel);
    const flfInputClasses = tree._inputUtilClasses || [];
    const flfLabelClasses = tree._labelUtilClasses || [];
    let flfInputAttr = flfInputClasses.length > 0 ? ' class="' + flfInputClasses.join(" ") + '"' : "";
    if (tree.isRequired) flfInputAttr += ' required';
    const flfLabelAttr = flfLabelClasses.length > 0 ? ' class="' + flfLabelClasses.join(" ") + '"' : "";
    // Find field-wrapper node and collect its utility classes
    const flfWrapper = htmlFindFieldWrapper(tree);
    const flfWrapperAllClasses = ["field-wrapper", "relative"];
    if (flfWrapper && flfWrapper.utilityClasses) {
      for (let fwi = 0; fwi < flfWrapper.utilityClasses.length; fwi++) {
        if (flfWrapperAllClasses.indexOf(flfWrapper.utilityClasses[fwi]) === -1) {
          flfWrapperAllClasses.push(flfWrapper.utilityClasses[fwi]);
        }
      }
    }
    const flfWrapperAttr = ' class="' + flfWrapperAllClasses.join(" ") + '"';
    lines.push(pad + '<div' + attrs + '>');
    lines.push(pad + '  <div' + flfWrapperAttr + '>');
    if (tree.isSelect) {
      lines.push(pad + '    <select' + flfInputAttr + '>');
      lines.push(pad + '      <option value="" disabled hidden selected></option>');
      lines.push(pad + '    </select>');
    } else if (tree.inputType === "textarea") {
      lines.push(pad + '    <textarea' + flfInputAttr + '></textarea>');
    } else {
      lines.push(pad + '    <input type="' + tree.inputType + '"' + flfInputAttr + ' />');
    }
    if (flfLabel) {
      lines.push(pad + '    <label' + flfLabelAttr + '>' + flfLabel + '</label>');
    }
    lines.push(pad + '  </div>');
    lines.push(pad + '</div>');
  } else if (tree.tag === "form-field") {
    // Regular form field: label above the input
    const ffTexts = htmlCollectAllTexts(tree);
    let ffLabel = ffTexts.length > 0 ? htmlEscapeText(ffTexts[0]) : "";
    if (tree.isRequired) ffLabel = formatRequiredLabel(ffLabel);
    const ffPlaceholder = ffTexts.length > 1 ? htmlEscapeText(ffTexts[1]) : "";
    const ffInputClasses = tree._inputUtilClasses || [];
    const ffLabelClasses = tree._labelUtilClasses || [];
    let ffInputAttr = ffInputClasses.length > 0 ? ' class="' + ffInputClasses.join(" ") + '"' : "";
    if (tree.isRequired) ffInputAttr += ' required';
    const ffLabelAttr = ffLabelClasses.length > 0 ? ' class="' + ffLabelClasses.join(" ") + '"' : "";
    lines.push(pad + '<div' + attrs + '>');
    if (ffLabel) {
      lines.push(pad + '  <label' + ffLabelAttr + '>' + ffLabel + '</label>');
    }
    if (tree.inputType === "textarea") {
      lines.push(pad + '  <textarea' + ffInputAttr + (ffPlaceholder ? ' placeholder="' + ffPlaceholder + '"' : '') + '></textarea>');
    } else {
      lines.push(pad + '  <input type="' + tree.inputType + '"' + ffInputAttr + (ffPlaceholder ? ' placeholder="' + ffPlaceholder + '"' : '') + ' />');
    }
    lines.push(pad + '</div>');
  } else if (tree.tag === "input") {
    const inpText = htmlExtractTextFromTree(tree);
    if (tree.inputType === "textarea") {
      lines.push(pad + '<textarea' + attrs + ' placeholder="' + inpText + '"' + (tree.isRequired ? ' required' : '') + '></textarea>');
    } else {
      lines.push(pad + '<input' + attrs + ' type="' + tree.inputType + '" placeholder="' + inpText + '"' + (tree.isRequired ? ' required' : '') + ' />');
    }
  } else if (tree.tag === "button") {
    let btnText = htmlExtractTextFromTree(tree);
    // Icon-only buttons (e.g. close button) should be empty — don't fall back to node name
    if (!btnText && !tree.iconNodeId) btnText = tree.nodeName || "Button";
    if (tree.iconImageName) {
      // Button with icon image: render as <img> inside button
      lines.push(pad + '<button' + attrs + '>');
      let iconImgAttrs = 'src="assets/' + tree.iconImageName + '" alt="' + (tree.iconNodeName || "icon").replace(/"/g, "&quot;") + '"';
      const iconSrcset = buildSrcset(tree.iconImageVariants, "assets/");
      if (iconSrcset) iconImgAttrs += ' srcset="' + iconSrcset + '"';
      if (tree.iconImageWidth) iconImgAttrs += ' width="' + tree.iconImageWidth + '"';
      if (tree.iconImageHeight) iconImgAttrs += ' height="' + tree.iconImageHeight + '"';
      lines.push(pad + '  <img ' + iconImgAttrs + ' />');
      if (btnText) lines.push(pad + '  <span>' + htmlEscapeText(btnText) + '</span>');
      lines.push(pad + '</button>');
    } else if (btnText) {
      lines.push(pad + '<button' + attrs + '>' + htmlEscapeText(btnText) + '</button>');
    } else {
      lines.push(pad + '<button' + attrs + '></button>');
    }
  } else if (tree.tag === "a") {
    const linkText = htmlExtractTextFromTree(tree) || tree.nodeName || "Link";
    lines.push(pad + '<a' + attrs + ' href="#">' + htmlEscapeText(linkText) + '</a>');
  } else if (tree.text !== null) {
    lines.push(pad + '<' + tree.tag + attrs + '>' + htmlEscapeText(tree.text) + '</' + tree.tag + '>');
  } else if (tree.children.length === 0) {
    lines.push(pad + '<' + tree.tag + attrs + '></' + tree.tag + '>');
  } else {
    lines.push(pad + '<' + tree.tag + attrs + '>');
    for (let ci = 0; ci < tree.children.length; ci++) {
      lines.push(htmlRenderNodeClean(tree.children[ci], indent + 1));
    }
    lines.push(pad + '</' + tree.tag + '>');
  }
  return lines.join("\n");
}

// Helper: push all image variants into the images array
function pushImageVariants(img, images) {
  if (img.variants && img.variants.length > 0) {
    for (let vi = 0; vi < img.variants.length; vi++) {
      images.push(img.variants[vi]);
    }
  } else {
    images.push(img);
  }
}

// Helper: build srcset string from image variants
function buildSrcset(variants, basePath) {
  if (!variants || variants.length <= 1) return null;
  const parts = [];
  for (let vi = 0; vi < variants.length; vi++) {
    parts.push(basePath + variants[vi].name + " " + variants[vi].scale + "x");
  }
  return parts.join(", ");
}

export async function htmlCollectImages(tree, images, progressCb, counter) {
  if (!tree) return;
  // Export leaf <img> nodes
  if (tree.isImage && tree.nodeId) {
    const node = await figma.getNodeByIdAsync(tree.nodeId);
    if (node) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      const img = await htmlExportImage(node);
      if (img) {
        tree.imageName = img.name;
        tree.imageVariants = img.variants || [];
        tree.imageWidth = img.displayWidth;
        tree.imageHeight = img.displayHeight;
        pushImageVariants(img, images);
      }
    }
  }
  // Export icon images for collapsed elements (close button X, select chevron)
  if (tree.iconNodeId) {
    const iconNode = await figma.getNodeByIdAsync(tree.iconNodeId);
    if (iconNode) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      let iconImg = await htmlExportImage(iconNode);
      // Fallback: if no export settings, export as SVG directly
      if (!iconImg && iconNode.exportAsync) {
        try {
          const svgBytes = await iconNode.exportAsync({ format: "SVG" });
          iconImg = { name: htmlSanitizeName(iconNode.name || "icon") + ".svg", format: "svg", bytes: Array.from(svgBytes), variants: [], displayWidth: Math.round(iconNode.width), displayHeight: Math.round(iconNode.height) };
        } catch(e) {}
      }
      if (iconImg) {
        if (tree.tag === "button") {
          tree.iconImageName = iconImg.name;
          tree.iconImageVariants = iconImg.variants || [];
          tree.iconImageWidth = iconImg.displayWidth;
          tree.iconImageHeight = iconImg.displayHeight;
          pushImageVariants(iconImg, images);
        } else {
          // Icon as inline base64 data URL (select chevron, etc.)
          const iconBytes = iconImg.bytes;
          const iconFormat = iconImg.format || "png";
          let iconBgUrl = "";
          if (iconBytes && iconBytes.length > 0) {
            iconBgUrl = "url(\"" + bytesToDataUrl(new Uint8Array(iconBytes), iconFormat) + "\")";
          } else {
            iconBgUrl = "url('assets/" + iconImg.name + "')";
            pushImageVariants(iconImg, images);
          }
          // For select fields: put chevron on _inputStyles (the <select> element)
          if (tree.isSelect && tree._inputStyles) {
            tree._inputStyles["background-image"] = iconBgUrl;
            tree._inputStyles["background-repeat"] = "no-repeat";
            tree._inputStyles["background-position"] = "right 14px center";
            tree._inputStyles["background-size"] = iconImg.displayWidth + "px " + iconImg.displayHeight + "px";
          } else {
            tree.styles["background-image"] = iconBgUrl;
          }
        }
      }
    }
  }
  // Export container background images
  if (tree.hasBgImage && (tree.bgImageNodeId || tree.nodeId)) {
    const bgNode = await figma.getNodeByIdAsync(tree.bgImageNodeId || tree.nodeId);
    if (bgNode) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      const bgImg = await htmlExportImage(bgNode);
      if (bgImg) {
        tree.bgImageName = bgImg.name;
        tree.styles["background-image"] = "url('assets/" + bgImg.name + "')";
        if (bgImg.variants && bgImg.variants.length > 1) {
          const bgParts2 = [];
          for (let bvi2 = 0; bvi2 < bgImg.variants.length; bvi2++) {
            bgParts2.push("url('assets/" + bgImg.variants[bvi2].name + "') " + bgImg.variants[bvi2].scale + "x");
          }
          tree.styles["background-image"] = "image-set(" + bgParts2.join(", ") + ")";
        }
        pushImageVariants(bgImg, images);
      }
    }
  }
  for (let i = 0; i < tree.children.length; i++) {
    await htmlCollectImages(tree.children[i], images, progressCb, counter);
  }
}

export function htmlCountImages(tree) {
  if (!tree) return 0;
  let count = (tree.isImage ? 1 : 0) + (tree.hasBgImage ? 1 : 0) + (tree.iconNodeId ? 1 : 0);
  for (let i = 0; i < tree.children.length; i++) {
    count += htmlCountImages(tree.children[i]);
  }
  return count;
}

// ── Utility CSS Class System ──────────────────────────────────────────────

export function htmlAbbreviateName(name) {
  const words = name.toLowerCase().replace(/[^a-zA-Z0-9]/g, " ").trim().split(/\s+/).filter(function(w) { return w.length > 0; });
  const skip = ["the","a","an","and","or","that","this","is","of","for","in","on","to","with",
    "frame","group","auto","layout","wrapper","container","component","instance",
    "section","page","div","block","element","item","default","variant","property"];
  const meaningful = words.filter(function(w) { return skip.indexOf(w) === -1; });
  if (meaningful.length === 0) return "";
  let result = meaningful.slice(0, 2).join("-");
  if (result.length > 20) result = result.substring(0, 20).replace(/-$/, "");
  return result.replace(/[^a-zA-Z0-9-]/g, "");
}

export function htmlBuildUtilityMap(tokens) {
  const map = {};

  // Flexbox layout
  map["display:flex"] = "flex";
  map["display:inline-flex"] = "inline-flex";
  map["flex-direction:column"] = "flex-col";
  map["flex-direction:row"] = "flex-row";
  map["flex-wrap:wrap"] = "flex-wrap";
  map["flex-wrap:nowrap"] = "flex-nowrap";
  map["flex:1 1 auto"] = "flex-1";
  map["flex:0 0 auto"] = "flex-none";
  map["flex-grow:0"] = "grow-0";
  map["flex-grow:1"] = "grow";
  map["flex-shrink:0"] = "shrink-0";
  map["flex-shrink:1"] = "shrink";
  map["flex-basis:auto"] = "basis-auto";
  map["flex-basis:0"] = "basis-0";

  // Alignment
  map["align-items:flex-start"] = "items-start";
  map["align-items:center"] = "items-center";
  map["align-items:flex-end"] = "items-end";
  map["align-items:baseline"] = "items-baseline";
  map["align-items:stretch"] = "items-stretch";
  map["align-self:auto"] = "self-auto";
  map["align-self:flex-start"] = "self-start";
  map["align-self:center"] = "self-center";
  map["align-self:flex-end"] = "self-end";
  map["align-self:stretch"] = "self-stretch";
  map["justify-content:flex-start"] = "justify-start";
  map["justify-content:center"] = "justify-center";
  map["justify-content:flex-end"] = "justify-end";
  map["justify-content:space-between"] = "justify-between";

  // Sizing
  map["width:100%"] = "w-full";
  map["height:100%"] = "h-full";
  map["width:auto"] = "w-auto";
  map["height:auto"] = "h-auto";

  // Overflow
  map["overflow:hidden"] = "overflow-hidden";
  map["overflow:auto"] = "overflow-auto";
  map["overflow:scroll"] = "overflow-scroll";
  map["overflow:visible"] = "overflow-visible";

  // Position
  map["position:relative"] = "relative";
  map["position:absolute"] = "absolute";
  map["position:fixed"] = "fixed";
  map["position:sticky"] = "sticky";
  map["inset:0"] = "inset-0";
  map["top:0"] = "top-0";
  map["right:0"] = "right-0";
  map["bottom:0"] = "bottom-0";
  map["left:0"] = "left-0";
  map["top:0px"] = "top-0";
  map["right:0px"] = "right-0";
  map["bottom:0px"] = "bottom-0";
  map["left:0px"] = "left-0";

  // Text
  map["text-align:left"] = "text-left";
  map["text-align:center"] = "text-center";
  map["text-align:right"] = "text-right";
  map["text-align:justify"] = "text-justify";
  map["text-decoration:underline"] = "underline";
  map["text-decoration:line-through"] = "line-through";
  map["text-decoration:none"] = "no-underline";
  map["text-transform:uppercase"] = "uppercase";
  map["text-transform:lowercase"] = "lowercase";
  map["text-transform:capitalize"] = "capitalize";

  // Pointer events
  map["pointer-events:none"] = "pointer-events-none";

  // Spacing (gap, padding, position offsets — from tokens)
  if (tokens && tokens.spacing) {
    const posProps = ["top", "right", "bottom", "left"];
    for (let si = 0; si < tokens.spacing.length; si++) {
      const sp = tokens.spacing[si];
      if (sp.value === "0") continue;
      const val = sp.value + "px";
      map["gap:" + val] = "gap-" + sp.name;
      for (let ppi = 0; ppi < posProps.length; ppi++) {
        map[posProps[ppi] + ":" + val] = posProps[ppi] + "-" + sp.name;
      }
    }
  }

  // Font weight
  const wn = {"100":"thin","200":"extralight","300":"light","400":"normal","500":"medium","600":"semibold","700":"bold","800":"extrabold","900":"black"};
  for (let w in wn) { if (wn.hasOwnProperty(w)) map["font-weight:" + w] = "font-" + wn[w]; }

  // Font size
  if (tokens && tokens.typography && tokens.typography.sizes) {
    for (let tsi = 0; tsi < tokens.typography.sizes.length; tsi++) {
      const ts = tokens.typography.sizes[tsi];
      map["font-size:" + ts.value + "px"] = "text-" + ts.name;
    }
  }

  // Line height
  if (tokens && tokens.typography && tokens.typography.lineHeights) {
    for (let li = 0; li < tokens.typography.lineHeights.length; li++) {
      const lh = tokens.typography.lineHeights[li];
      map["line-height:" + lh.value] = "leading-" + lh.name;
    }
  }

  // Border radius
  if (tokens && tokens.radius) {
    for (let ri = 0; ri < tokens.radius.length; ri++) {
      const rad = tokens.radius[ri];
      map["border-radius:" + rad.value + "px"] = "rounded-" + rad.name;
    }
  }

  return map;
}

export function htmlBuildSpacingLookup(tokens, cssVars) {
  const lookup = {};
  if (tokens && tokens.spacing) {
    for (let i = 0; i < tokens.spacing.length; i++) {
      const sp = tokens.spacing[i];
      if (sp.value === "0") continue;
      const val = sp.value + "px";
      lookup[val] = sp.name;
    }
  }
  // Also index var() references that resolve to spacing values
  if (cssVars) {
    const varKeys = Object.keys(cssVars);
    for (let vi = 0; vi < varKeys.length; vi++) {
      const vn = varKeys[vi];
      const vv = cssVars[vn];
      if (typeof vv === "string" && /^\d+px$/.test(vv) && lookup[vv]) {
        lookup["var(" + vn + ")"] = lookup[vv];
      }
    }
  }
  return lookup;
}

export function htmlAddColorUtilities(utilMap, cssVars) {
  const varKeys = Object.keys(cssVars);
  for (let i = 0; i < varKeys.length; i++) {
    const varName = varKeys[i];
    const val = cssVars[varName];
    const shortName = varName.replace(/^--/, "");
    const varRef = "var(" + varName + ")";
    if (typeof val === "string" && (val.indexOf("rgb") === 0 || val.indexOf("#") === 0)) {
      utilMap["background-color:" + varRef] = "bg-" + shortName;
      utilMap["color:" + varRef] = "text-" + shortName;
    }
    // Map var()-based spacing/radius values to existing token utilities
    // e.g., gap:var(--spacing-4) → reuse the same class as gap:4px (which is gap-4)
    if (typeof val === "string" && /^\d+px$/.test(val)) {
      const gapTokenClass = utilMap["gap:" + val];
      if (gapTokenClass) utilMap["gap:" + varRef] = gapTokenClass;
      const radiusTokenClass = utilMap["border-radius:" + val];
      if (radiusTokenClass) utilMap["border-radius:" + varRef] = radiusTokenClass;
    }
  }
}

export function htmlGenerateUtilityCSS(tokens, cssVars) {
  const lines = [];
  lines.push("/* ── Flexbox Utilities ────────────────────────────────── */");
  lines.push(".flex { display: flex; }");
  lines.push(".inline-flex { display: inline-flex; }");
  lines.push(".flex-col { flex-direction: column; }");
  lines.push(".flex-row { flex-direction: row; }");
  lines.push(".flex-wrap { flex-wrap: wrap; }");
  lines.push(".flex-nowrap { flex-wrap: nowrap; }");
  lines.push(".flex-1 { flex: 1 1 auto; }");
  lines.push(".flex-none { flex: 0 0 auto; }");
  lines.push(".grow { flex-grow: 1; }");
  lines.push(".grow-0 { flex-grow: 0; }");
  lines.push(".shrink { flex-shrink: 1; }");
  lines.push(".shrink-0 { flex-shrink: 0; }");
  lines.push(".basis-auto { flex-basis: auto; }");
  lines.push(".basis-0 { flex-basis: 0; }");
  lines.push(".items-start { align-items: flex-start; }");
  lines.push(".items-center { align-items: center; }");
  lines.push(".items-end { align-items: flex-end; }");
  lines.push(".items-baseline { align-items: baseline; }");
  lines.push(".items-stretch { align-items: stretch; }");
  lines.push(".self-auto { align-self: auto; }");
  lines.push(".self-start { align-self: flex-start; }");
  lines.push(".self-center { align-self: center; }");
  lines.push(".self-end { align-self: flex-end; }");
  lines.push(".self-stretch { align-self: stretch; }");
  lines.push(".justify-start { justify-content: flex-start; }");
  lines.push(".justify-center { justify-content: center; }");
  lines.push(".justify-end { justify-content: flex-end; }");
  lines.push(".justify-between { justify-content: space-between; }");
  lines.push("");
  lines.push("/* ── Sizing Utilities ─────────────────────────────────── */");
  lines.push(".w-full { width: 100%; }");
  lines.push(".w-auto { width: auto; }");
  lines.push(".h-full { height: 100%; }");
  lines.push(".h-auto { height: auto; }");
  lines.push(".overflow-hidden { overflow: hidden; }");
  lines.push(".overflow-auto { overflow: auto; }");
  lines.push(".overflow-scroll { overflow: scroll; }");
  lines.push(".overflow-visible { overflow: visible; }");
  lines.push("");
  lines.push("/* ── Position Utilities ───────────────────────────────── */");
  lines.push(".relative { position: relative; }");
  lines.push(".absolute { position: absolute; }");
  lines.push(".fixed { position: fixed; }");
  lines.push(".sticky { position: sticky; }");
  lines.push(".inset-0 { inset: 0; }");
  lines.push(".top-0 { top: 0; }");
  lines.push(".right-0 { right: 0; }");
  lines.push(".bottom-0 { bottom: 0; }");
  lines.push(".left-0 { left: 0; }");
  lines.push("");
  lines.push("/* ── Text Utilities ───────────────────────────────────── */");
  lines.push(".text-left { text-align: left; }");
  lines.push(".text-center { text-align: center; }");
  lines.push(".text-right { text-align: right; }");
  lines.push(".text-justify { text-align: justify; }");
  lines.push(".underline { text-decoration: underline; }");
  lines.push(".line-through { text-decoration: line-through; }");
  lines.push(".no-underline { text-decoration: none; }");
  lines.push(".uppercase { text-transform: uppercase; }");
  lines.push(".lowercase { text-transform: lowercase; }");
  lines.push(".capitalize { text-transform: capitalize; }");
  lines.push(".pointer-events-none { pointer-events: none; }");
  lines.push("");
  lines.push("/* ── Grid Utilities ───────────────────────────────────── */");
  lines.push(".grid { display: grid; }");
  lines.push(".grid-cols-12 { grid-template-columns: repeat(12, 1fr); }");
  for (let colI = 1; colI <= 12; colI++) {
    lines.push(".col-span-" + colI + " { grid-column: span " + colI + "; }");
  }
  lines.push("");

  // Spacing
  if (tokens && tokens.spacing) {
    lines.push("/* ── Spacing Utilities ────────────────────────────────── */");
    for (let si = 0; si < tokens.spacing.length; si++) {
      const sp = tokens.spacing[si];
      if (sp.value === "0") continue;
      const v = sp.value + "px";
      lines.push(".gap-" + sp.name + " { gap: " + v + "; }");
    }
    for (let si2 = 0; si2 < tokens.spacing.length; si2++) {
      const sp2 = tokens.spacing[si2];
      if (sp2.value === "0") continue;
      const v2 = sp2.value + "px";
      lines.push(".p-" + sp2.name + " { padding: " + v2 + "; }");
      lines.push(".px-" + sp2.name + " { padding-left: " + v2 + "; padding-right: " + v2 + "; }");
      lines.push(".py-" + sp2.name + " { padding-top: " + v2 + "; padding-bottom: " + v2 + "; }");
    }
    lines.push("");
    lines.push("/* ── Position Offset Utilities (from spacing tokens) ──── */");
    for (let si3 = 0; si3 < tokens.spacing.length; si3++) {
      const sp3 = tokens.spacing[si3];
      if (sp3.value === "0") continue;
      const v3 = sp3.value + "px";
      lines.push(".top-" + sp3.name + " { top: " + v3 + "; }");
      lines.push(".right-" + sp3.name + " { right: " + v3 + "; }");
      lines.push(".bottom-" + sp3.name + " { bottom: " + v3 + "; }");
      lines.push(".left-" + sp3.name + " { left: " + v3 + "; }");
    }
    lines.push("");
  }

  // Typography
  lines.push("/* ── Typography Utilities ─────────────────────────────── */");
  const wn = {"100":"thin","200":"extralight","300":"light","400":"normal","500":"medium","600":"semibold","700":"bold","800":"extrabold","900":"black"};
  for (let w in wn) { if (wn.hasOwnProperty(w)) lines.push(".font-" + wn[w] + " { font-weight: " + w + "; }"); }
  if (tokens && tokens.typography && tokens.typography.sizes) {
    for (let tsi = 0; tsi < tokens.typography.sizes.length; tsi++) {
      const ts = tokens.typography.sizes[tsi];
      lines.push(".text-" + ts.name + " { font-size: " + ts.value + "px; }");
    }
  }
  if (tokens && tokens.typography && tokens.typography.lineHeights) {
    for (let li = 0; li < tokens.typography.lineHeights.length; li++) {
      const lh = tokens.typography.lineHeights[li];
      lines.push(".leading-" + lh.name + " { line-height: " + lh.value + "; }");
    }
  }
  lines.push("");

  // Border radius
  if (tokens && tokens.radius) {
    lines.push("/* ── Border Radius Utilities ──────────────────────────── */");
    for (let ri = 0; ri < tokens.radius.length; ri++) {
      const rad = tokens.radius[ri];
      lines.push(".rounded-" + rad.name + " { border-radius: " + rad.value + "px; }");
    }
    lines.push("");
  }

  // Color utilities from collected CSS vars
  if (cssVars) {
    const colorLines = [];
    const varKeys = Object.keys(cssVars).sort();
    for (let ci = 0; ci < varKeys.length; ci++) {
      const varName = varKeys[ci];
      const cval = cssVars[varName];
      if (typeof cval === "string" && (cval.indexOf("rgb") === 0 || cval.indexOf("#") === 0)) {
        const shortName = varName.replace(/^--/, "");
        colorLines.push(".bg-" + shortName + " { background-color: var(" + varName + "); }");
        colorLines.push(".text-" + shortName + " { color: var(" + varName + "); }");
      }
    }
    if (colorLines.length > 0) {
      lines.push("/* ── Color Utilities ──────────────────────────────────── */");
      for (let cli = 0; cli < colorLines.length; cli++) lines.push(colorLines[cli]);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// Resolve a styles object into { utils: string[], remaining: object }
function resolveStylesToUtilities(styles, utilMap, spacingLookup) {
  const utils = [];
  const remaining = {};
  const keys = Object.keys(styles);
  for (let i = 0; i < keys.length; i++) {
    const prop = keys[i];
    const val = styles[prop];
    const lookup = prop + ":" + val;
    if (utilMap[lookup]) {
      utils.push(utilMap[lookup]);
    } else if (prop === "padding" && spacingLookup) {
      const padParts = [];
      let padRemainder = val;
      while (padRemainder.length > 0) {
        padRemainder = padRemainder.trim();
        if (padRemainder.indexOf("var(") === 0) {
          const closeIdx = padRemainder.indexOf(")");
          if (closeIdx !== -1) { padParts.push(padRemainder.substring(0, closeIdx + 1)); padRemainder = padRemainder.substring(closeIdx + 1); }
          else { padParts.push(padRemainder); padRemainder = ""; }
        } else {
          const spIdx = padRemainder.indexOf(" ");
          if (spIdx !== -1) { padParts.push(padRemainder.substring(0, spIdx)); padRemainder = padRemainder.substring(spIdx + 1); }
          else { padParts.push(padRemainder); padRemainder = ""; }
        }
      }
      let resolvedParts = [];
      for (let ppi = 0; ppi < padParts.length; ppi++) {
        const pp = padParts[ppi];
        if (spacingLookup[pp]) { resolvedParts.push(spacingLookup[pp]); }
        else if (pp === "0" || pp === "0px") { resolvedParts.push(null); }
        else { resolvedParts = null; break; }
      }
      if (resolvedParts && resolvedParts.length === 1 && resolvedParts[0]) {
        utils.push("p-" + resolvedParts[0]);
      } else if (resolvedParts && resolvedParts.length === 2) {
        if (resolvedParts[0]) utils.push("py-" + resolvedParts[0]);
        if (resolvedParts[1]) utils.push("px-" + resolvedParts[1]);
      } else { remaining[prop] = val; }
    } else {
      remaining[prop] = val;
    }
  }
  return { utils: utils, remaining: remaining };
}

export async function htmlAssignUtilities(tree, utilMap, spacingLookup) {
  if (!tree) return;
  const result = resolveStylesToUtilities(tree.styles, utilMap, spacingLookup);
  // Preserve existing utility classes (e.g. col-span-N added during tree walk)
  const existing = tree.utilityClasses || [];
  tree.utilityClasses = existing.concat(result.utils);
  tree.styles = result.remaining;

  // For form fields: resolve input/label child styles to utility classes too
  if (tree.tag === "form-field-floating" || tree.tag === "form-field") {
    const flLabelStyles = {};
    const flInputStyles = {};
    htmlExtractFormFieldChildStyles(tree, flLabelStyles, flInputStyles);
    if (tree.tag === "form-field-floating") {
      flLabelStyles["position"] = "absolute";
      flLabelStyles["pointer-events"] = "none";
      // Always read label position from Figma node's x/y in px (matches design, resolves to utility classes)
      const labelNode = htmlFindLabelNode(tree);
      if (labelNode) {
        const lNode = await figma.getNodeByIdAsync(labelNode.nodeId);
        if (lNode) {
          if (typeof lNode.x === "number") flLabelStyles["left"] = Math.round(lNode.x) + "px";
          if (typeof lNode.y === "number") flLabelStyles["top"] = Math.round(lNode.y) + "px";
        }
      }
    }
    const inputResult = resolveStylesToUtilities(flInputStyles, utilMap, spacingLookup);
    const labelResult = resolveStylesToUtilities(flLabelStyles, utilMap, spacingLookup);
    tree._inputUtilClasses = inputResult.utils;
    tree._inputStyles = inputResult.remaining;
    tree._labelUtilClasses = labelResult.utils;
    tree._labelStyles = labelResult.remaining;
  }


  if (tree.children) {
    for (let ci = 0; ci < tree.children.length; ci++) {
      await htmlAssignUtilities(tree.children[ci], utilMap, spacingLookup);
    }
  }
}
