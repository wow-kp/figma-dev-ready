// HTML generation engine

export function htmlResolveVarToCSSName(variableId) {
  try {
    var v = figma.variables.getVariableById(variableId);
    if (!v) return null;
    return "--" + v.name.replace(/\//g, "-").replace(/[^a-zA-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  } catch(e) { return null; }
}

export function htmlResolveVarValue(variableId) {
  try {
    var v = figma.variables.getVariableById(variableId);
    if (!v) return null;
    var col = figma.variables.getVariableCollectionById(v.variableCollectionId);
    if (!col || !col.modes || !col.modes.length) return null;
    var modeId = col.modes[0].modeId;
    var val = v.valuesByMode[modeId];
    if (!val) return null;
    // Resolve alias
    if (val.type === "VARIABLE_ALIAS") {
      return htmlResolveVarValue(val.id);
    }
    return val;
  } catch(e) { return null; }
}

export function htmlColorToCSS(c) {
  if (!c) return null;
  var r = Math.round((c.r || 0) * 255);
  var g = Math.round((c.g || 0) * 255);
  var b = Math.round((c.b || 0) * 255);
  var a = c.a !== undefined ? c.a : 1;
  if (a < 1) return "rgba(" + r + "," + g + "," + b + "," + Math.round(a * 100) / 100 + ")";
  return "rgb(" + r + "," + g + "," + b + ")";
}

export function htmlSanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}

export function htmlExtractNodeCSS(node, cssVars) {
  var styles = {};
  var bv = node.boundVariables || {};

  // Absolute positioning (layoutPositioning === "ABSOLUTE" in Figma)
  if (node.layoutPositioning === "ABSOLUTE") {
    styles["position"] = "absolute";
    var cons = node.constraints || {};
    if (cons.horizontal === "STRETCH" && cons.vertical === "STRETCH") {
      styles["inset"] = "0";
    } else {
      if (cons.horizontal === "STRETCH") { styles["left"] = "0"; styles["right"] = "0"; }
      else if (cons.horizontal === "MAX") { styles["right"] = Math.round(node.parent ? node.parent.width - node.x - node.width : 0) + "px"; }
      else if (cons.horizontal === "MIN") { styles["left"] = Math.round(node.x || 0) + "px"; }
      else { styles["left"] = Math.round(node.x || 0) + "px"; }
      if (cons.vertical === "STRETCH") { styles["top"] = "0"; styles["bottom"] = "0"; }
      else if (cons.vertical === "MAX") { styles["bottom"] = Math.round(node.parent ? node.parent.height - node.y - node.height : 0) + "px"; }
      else { styles["top"] = Math.round(node.y || 0) + "px"; }
    }
  }

  // Layout mode
  if (node.layoutMode && node.layoutMode !== "NONE") {
    styles["display"] = "flex";
    styles["flex-direction"] = node.layoutMode === "VERTICAL" ? "column" : "row";
    if (node.layoutWrap === "WRAP") styles["flex-wrap"] = "wrap";
    // Parent of absolute children needs position: relative
    styles["position"] = styles["position"] || "relative";

    // Alignment
    var mainMap = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", SPACE_BETWEEN: "space-between" };
    var crossMap = { MIN: "flex-start", CENTER: "center", MAX: "flex-end", BASELINE: "baseline" };
    if (node.primaryAxisAlignItems && mainMap[node.primaryAxisAlignItems]) styles["justify-content"] = mainMap[node.primaryAxisAlignItems];
    if (node.counterAxisAlignItems && crossMap[node.counterAxisAlignItems]) styles["align-items"] = crossMap[node.counterAxisAlignItems];

    // Gap
    if (node.itemSpacing > 0) {
      if (bv.itemSpacing) { var gn = htmlResolveVarToCSSName(bv.itemSpacing.id); if (gn) { cssVars[gn] = node.itemSpacing + "px"; styles["gap"] = "var(" + gn + ")"; } else styles["gap"] = node.itemSpacing + "px"; }
      else styles["gap"] = node.itemSpacing + "px";
    }

    // Padding
    var padProps = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    var padVals = [];
    for (var pi = 0; pi < padProps.length; pi++) {
      var pv = node[padProps[pi]];
      if (pv > 0) {
        if (bv[padProps[pi]]) { var pn = htmlResolveVarToCSSName(bv[padProps[pi]].id); if (pn) { cssVars[pn] = pv + "px"; padVals.push("var(" + pn + ")"); } else padVals.push(pv + "px"); }
        else padVals.push(pv + "px");
      } else padVals.push("0");
    }
    if (padVals.some(function(v) { return v !== "0"; })) {
      if (padVals[0] === padVals[1] && padVals[1] === padVals[2] && padVals[2] === padVals[3]) styles["padding"] = padVals[0];
      else if (padVals[0] === padVals[2] && padVals[1] === padVals[3]) styles["padding"] = padVals[0] + " " + padVals[1];
      else styles["padding"] = padVals.join(" ");
    }
  }

  // Width & height
  var isAutoChild = node.parent && node.parent.layoutMode && node.parent.layoutMode !== "NONE";
  var parentDir = isAutoChild ? node.parent.layoutMode : null;
  if (node.layoutSizingHorizontal === "FILL" || (isAutoChild && node.layoutAlign === "STRETCH")) {
    // In a row layout, FILL means flex-grow; in column, it means width: 100%
    if (parentDir === "HORIZONTAL") {
      // Use minWidth as flex-basis so fields keep their proportional width
      var flexBasis = "auto";
      if (node.minWidth && node.minWidth > 0 && node.minWidth < 10000) {
        flexBasis = Math.round(node.minWidth) + "px";
        if (bv.minWidth) {
          var mwn = htmlResolveVarToCSSName(bv.minWidth.id);
          if (mwn) { cssVars[mwn] = Math.round(node.minWidth) + "px"; flexBasis = "var(" + mwn + ")"; }
        }
        styles["min-width"] = flexBasis;
      }
      styles["flex"] = "1 1 " + flexBasis;
    }
    else { styles["width"] = "100%"; }
  } else if (node.width > 0 && node.layoutSizingHorizontal !== "HUG"
    && !(node.type === "TEXT" && node.textAutoResize === "WIDTH_AND_HEIGHT")) {
    styles["width"] = Math.round(node.width) + "px";
    // Prevent flex shrinking below fixed width in flex parents
    if (isAutoChild) styles["flex-shrink"] = "0";
  }
  if (node.layoutSizingVertical === "FILL") {
    if (parentDir === "VERTICAL") { styles["flex"] = "1 1 auto"; }
    else { styles["height"] = "100%"; }
  } else if (node.height > 0 && node.layoutSizingVertical !== "HUG"
    && !(node.type === "TEXT" && (node.textAutoResize === "HEIGHT" || node.textAutoResize === "WIDTH_AND_HEIGHT"))) {
    styles["height"] = Math.round(node.height) + "px";
  }

  // Max/min width for responsive (child frames only — top-level handled in walkNode)
  if (node.maxWidth && node.maxWidth < 10000) styles["max-width"] = Math.round(node.maxWidth) + "px";
  if (!styles["min-width"] && node.minWidth && node.minWidth > 0 && node.minWidth < 10000) {
    if (bv.minWidth) {
      var mwn2 = htmlResolveVarToCSSName(bv.minWidth.id);
      if (mwn2) { cssVars[mwn2] = Math.round(node.minWidth) + "px"; styles["min-width"] = "var(" + mwn2 + ")"; }
      else styles["min-width"] = Math.round(node.minWidth) + "px";
    } else styles["min-width"] = Math.round(node.minWidth) + "px";
  }

  // Overflow
  if (node.clipsContent) styles["overflow"] = "hidden";

  // Background color / gradient (skip TEXT nodes — their fills are text color, not background)
  if (node.type !== "TEXT" && node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
    var fill = node.fills[0];
    if (fill && fill.visible !== false) {
      if (fill.type === "SOLID") {
        if (bv.fills && bv.fills[0]) {
          var bgn = htmlResolveVarToCSSName(bv.fills[0].id);
          if (bgn) {
            var resolved = htmlResolveVarValue(bv.fills[0].id);
            cssVars[bgn] = resolved ? htmlColorToCSS(resolved) : htmlColorToCSS(fill.color);
            styles["background-color"] = "var(" + bgn + ")";
          } else styles["background-color"] = htmlColorToCSS(fill.color);
        } else styles["background-color"] = htmlColorToCSS(fill.color);
      } else if (fill.type === "GRADIENT_LINEAR" && fill.gradientStops && fill.gradientStops.length > 0) {
        var stops = [];
        for (var gi = 0; gi < fill.gradientStops.length; gi++) {
          var gs = fill.gradientStops[gi];
          stops.push(htmlColorToCSS(gs.color) + " " + Math.round(gs.position * 100) + "%");
        }
        // Compute angle from gradientTransform matrix
        var angle = 180;
        if (fill.gradientTransform && fill.gradientTransform.length >= 2) {
          var dx = fill.gradientTransform[0][0];
          var dy = fill.gradientTransform[1][0];
          angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 90;
        }
        styles["background"] = "linear-gradient(" + angle + "deg, " + stops.join(", ") + ")";
      } else if (fill.type === "GRADIENT_RADIAL" && fill.gradientStops && fill.gradientStops.length > 0) {
        var rStops = [];
        for (var ri = 0; ri < fill.gradientStops.length; ri++) {
          var rs = fill.gradientStops[ri];
          rStops.push(htmlColorToCSS(rs.color) + " " + Math.round(rs.position * 100) + "%");
        }
        styles["background"] = "radial-gradient(ellipse at center, " + rStops.join(", ") + ")";
      }
    }
  }

  // Corner radius (cornerRadius can be figma.mixed when corners differ)
  if (typeof node.cornerRadius === "number" && node.cornerRadius > 0) {
    if (bv.topLeftRadius || bv.cornerRadius) {
      var rId = bv.cornerRadius ? bv.cornerRadius.id : bv.topLeftRadius.id;
      var rn = htmlResolveVarToCSSName(rId);
      if (rn) { cssVars[rn] = node.cornerRadius + "px"; styles["border-radius"] = "var(" + rn + ")"; }
      else styles["border-radius"] = node.cornerRadius + "px";
    } else styles["border-radius"] = node.cornerRadius + "px";
  } else if (node.cornerRadius !== undefined && typeof node.cornerRadius !== "number") {
    // Mixed corners — output individual values
    var tl = node.topLeftRadius || 0, tr = node.topRightRadius || 0, br = node.bottomRightRadius || 0, bl = node.bottomLeftRadius || 0;
    if (tl > 0 || tr > 0 || br > 0 || bl > 0) {
      styles["border-radius"] = tl + "px " + tr + "px " + br + "px " + bl + "px";
    }
  }

  // Strokes / border (guard against mixed strokeWeight)
  if (node.strokes && node.strokes.length > 0) {
    var stroke = node.strokes[0];
    var sw = typeof node.strokeWeight === "number" ? node.strokeWeight : 0;
    if (stroke && stroke.visible !== false && stroke.type === "SOLID" && sw > 0) {
      var sc = htmlColorToCSS(stroke.color);
      if (bv.strokes && bv.strokes[0]) {
        var sn = htmlResolveVarToCSSName(bv.strokes[0].id);
        if (sn) {
          var sResolved = htmlResolveVarValue(bv.strokes[0].id);
          cssVars[sn] = sResolved ? htmlColorToCSS(sResolved) : sc;
          sc = "var(" + sn + ")";
        }
      }
      styles["border"] = sw + "px solid " + sc;
    }
  }

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    if (bv.opacity) {
      var on = htmlResolveVarToCSSName(bv.opacity.id);
      if (on) { cssVars[on] = String(node.opacity); styles["opacity"] = "var(" + on + ")"; }
      else styles["opacity"] = String(Math.round(node.opacity * 100) / 100);
    } else styles["opacity"] = String(Math.round(node.opacity * 100) / 100);
  }

  // Effects (shadows)
  if (node.effects && node.effects.length > 0) {
    var shadows = [];
    for (var ei = 0; ei < node.effects.length; ei++) {
      var eff = node.effects[ei];
      if (!eff.visible) continue;
      if (eff.type === "DROP_SHADOW" || eff.type === "INNER_SHADOW") {
        var prefix = eff.type === "INNER_SHADOW" ? "inset " : "";
        shadows.push(prefix + (eff.offset ? eff.offset.x : 0) + "px " + (eff.offset ? eff.offset.y : 0) + "px " + (eff.radius || 0) + "px " + (eff.spread || 0) + "px " + htmlColorToCSS(eff.color));
      }
    }
    if (shadows.length) styles["box-shadow"] = shadows.join(", ");
  }

  // Text-specific styles (guard all properties against figma.mixed)
  if (node.type === "TEXT") {
    // Font family
    if (node.fontName && typeof node.fontName === "object" && node.fontName.family) {
      styles["font-family"] = "'" + node.fontName.family + "', sans-serif";
    }
    if (typeof node.fontSize === "number" && node.fontSize > 0) styles["font-size"] = node.fontSize + "px";
    if (typeof node.fontWeight === "number") styles["font-weight"] = String(node.fontWeight);
    else if (node.fontName && typeof node.fontName === "object" && node.fontName.style) {
      // Derive weight from style name if fontWeight is not directly available
      var styleWeightMap = { "Thin": "100", "ExtraLight": "200", "Light": "300", "Regular": "400", "Medium": "500", "SemiBold": "600", "Bold": "700", "ExtraBold": "800", "Black": "900" };
      var styleName = node.fontName.style.replace(/\s+/g, "");
      if (styleWeightMap[styleName]) styles["font-weight"] = styleWeightMap[styleName];
    }
    if (node.lineHeight && typeof node.lineHeight === "object" && node.lineHeight.value) {
      if (node.lineHeight.unit === "PERCENT") styles["line-height"] = Math.round(node.lineHeight.value) / 100;
      else if (node.lineHeight.unit === "PIXELS") styles["line-height"] = node.lineHeight.value + "px";
    }
    if (node.letterSpacing && typeof node.letterSpacing === "object" && node.letterSpacing.value) {
      if (node.letterSpacing.unit === "PERCENT") styles["letter-spacing"] = (node.letterSpacing.value / 100) + "em";
      else styles["letter-spacing"] = node.letterSpacing.value + "px";
    }
    var alignMap = { LEFT: "left", CENTER: "center", RIGHT: "right", JUSTIFIED: "justify" };
    if (node.textAlignHorizontal && alignMap[node.textAlignHorizontal]) styles["text-align"] = alignMap[node.textAlignHorizontal];

    // Text decoration (underline, strikethrough)
    if (typeof node.textDecoration === "string") {
      if (node.textDecoration === "UNDERLINE") styles["text-decoration"] = "underline";
      else if (node.textDecoration === "STRIKETHROUGH") styles["text-decoration"] = "line-through";
    }
    // Text case (uppercase, lowercase, title case)
    if (typeof node.textCase === "string") {
      var caseMap = { UPPER: "uppercase", LOWER: "lowercase", TITLE: "capitalize" };
      if (caseMap[node.textCase]) styles["text-transform"] = caseMap[node.textCase];
    }

    // Text color
    if (node.fills && Array.isArray(node.fills) && node.fills.length > 0 && node.fills[0].type === "SOLID") {
      if (bv.fills && bv.fills[0]) {
        var tcn = htmlResolveVarToCSSName(bv.fills[0].id);
        if (tcn) {
          var tcResolved = htmlResolveVarValue(bv.fills[0].id);
          cssVars[tcn] = tcResolved ? htmlColorToCSS(tcResolved) : htmlColorToCSS(node.fills[0].color);
          styles["color"] = "var(" + tcn + ")";
        } else styles["color"] = htmlColorToCSS(node.fills[0].color);
      } else styles["color"] = htmlColorToCSS(node.fills[0].color);
    }
  }

  return styles;
}

export function htmlGetSemanticTag(node, depth, pageType) {
  var name = (node.name || "").toLowerCase();
  var type = node.type;

  // Top-level frame tag depends on page type
  if (depth === 0 && (type === "FRAME" || type === "SECTION")) {
    if (pageType === "promo") return "section";
    // landing/fullsite: top-level represents <body>, handled by skipping wrapper in main.ts
    if (pageType === "landing" || pageType === "fullsite") return "body";
  }

  if (type === "TEXT") {
    var fs = typeof node.fontSize === "number" ? node.fontSize : 14;
    if (fs >= 48) return "h1";
    if (fs >= 36) return "h2";
    if (fs >= 24) return "h3";
    if (fs >= 18) return "h4";
    if (fs >= 15) return "h5";
    return "p";
  }

  // Check component name for INSTANCE nodes (e.g. "Variant=Primary, Size=Default" -> check the component set name)
  var componentHint = "";
  if (type === "INSTANCE") {
    try {
      var mainComp = node.mainComponent;
      if (mainComp) {
        componentHint = (mainComp.parent && mainComp.parent.type === "COMPONENT_SET" ? mainComp.parent.name : mainComp.name).toLowerCase();
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

    // Dropdown / select detection
    if (name.indexOf("dropdown") !== -1 || name.indexOf("select") !== -1
        || componentHint.indexOf("dropdown") !== -1 || componentHint.indexOf("select") !== -1) return "select";

    // Input / field detection (frames named "input-*" or instances of input components)
    // Floating label components → "form-field-floating" (label inside the input)
    // Other input components with labels → "form-field" (label above the input)
    // Plain frames named "field" → bare "input"
    if (componentHint.indexOf("floating label") !== -1) return "form-field-floating";
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
    var sn = htmlAbbreviateName(node.name || "");
    return sn || "section";
  }
  if (tag === "button") return "btn";
  if (tag === "form") return "form";
  if (tag === "form-field" || tag === "form-field-floating") return "form-field";
  if (tag === "input") return "input";
  if (tag === "select") return "select";
  if (tag === "a") return "link";
  if (/^h[1-6]$/.test(tag)) return tag;
  if (tag === "p") return "text";
  if (tag === "img") return "img";
  // For divs: try abbreviated name from node
  var abbr = htmlAbbreviateName(node.name || "");
  return abbr || "box";
}

export function htmlNodeIsExportableImage(node) {
  // Only treat as <img> if the node has exportSettings configured by the designer
  if (!node.exportSettings || node.exportSettings.length === 0) return false;
  var isLeaf = !("children" in node) || !node.children || node.children.length === 0;
  var isShape = node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR" || node.type === "LINE";
  return isLeaf || isShape;
}

export function htmlNodeHasBgImageVar(node) {
  // Check if the node (or its main component) is marked as a background image.
  // Detection priority: pluginData "role" → variable binding → component name fallback
  try {
    // 1. Direct pluginData check
    if (node.getPluginData && node.getPluginData("role") === "background-image") return true;

    // 2. For instances, check the main component's pluginData
    if (node.type === "INSTANCE" && node.mainComponent) {
      if (node.mainComponent.getPluginData && node.mainComponent.getPluginData("role") === "background-image") return true;

      // Also check the component set
      var parentSet = node.mainComponent.parent;
      if (parentSet && parentSet.type === "COMPONENT_SET" && parentSet.getPluginData && parentSet.getPluginData("role") === "background-image") return true;
    }

    // 3. Legacy: variable binding check
    var bv = node.boundVariables || {};
    if (bv.visible) {
      var v = figma.variables.getVariableById(bv.visible.id);
      if (v && v.name === "background-image") return true;
    }
    if (node.type === "INSTANCE" && node.mainComponent) {
      var compBv = node.mainComponent.boundVariables || {};
      if (compBv.visible) {
        var cv = figma.variables.getVariableById(compBv.visible.id);
        if (cv && cv.name === "background-image") return true;
      }
    }

    // 4. Fallback: name-based detection
    if (node.type === "INSTANCE" && node.mainComponent) {
      var setName = node.mainComponent.parent && node.mainComponent.parent.type === "COMPONENT_SET"
        ? node.mainComponent.parent.name : node.mainComponent.name;
      if (setName.toLowerCase().indexOf("background image") !== -1 || setName.toLowerCase().indexOf("background-image") !== -1) return true;
    }
  } catch(e) {}
  return false;
}

export function htmlNodeHasImageFill(node) {
  // Primary: detect via "background-image" boolean variable binding
  if (htmlNodeHasBgImageVar(node)) return true;
  // Fallback: container frames with exportSettings and IMAGE fill → background-image
  var hasChildren = ("children" in node) && node.children && node.children.length > 0;
  if (hasChildren && node.exportSettings && node.exportSettings.length > 0 && node.fills && Array.isArray(node.fills)) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].type === "IMAGE" && node.fills[i].visible !== false) return true;
    }
  }
  return false;
}

export var _htmlImageNameCount = {};

export async function htmlExportImage(node, progressCb) {
  try {
    if (!node.exportSettings || node.exportSettings.length === 0) return null;

    var baseName = htmlSanitizeName(node.name || "image");
    // Deduplicate image file names to prevent collisions
    if (!_htmlImageNameCount[baseName]) _htmlImageNameCount[baseName] = 0;
    _htmlImageNameCount[baseName]++;
    if (_htmlImageNameCount[baseName] > 1) baseName = baseName + "-" + _htmlImageNameCount[baseName];

    var variants = [];
    for (var esi = 0; esi < node.exportSettings.length; esi++) {
      var es = node.exportSettings[esi];
      var format = (es.format || "PNG");
      var constraint = es.constraint || { type: "SCALE", value: 1 };
      var scale = constraint.type === "SCALE" ? (constraint.value || 1) : 1;
      var ext = format.toLowerCase();
      var suffix = es.suffix || (scale !== 1 ? "@" + scale + "x" : "");
      var fileName = baseName + suffix + "." + ext;
      var bytes = await node.exportAsync({ format: format, constraint: constraint });
      variants.push({ name: fileName, format: ext, bytes: Array.from(bytes), scale: scale });
    }

    // Primary variant is 1x, or the first one if no 1x exists
    var primary = variants[0];
    for (var vi = 0; vi < variants.length; vi++) {
      if (variants[vi].scale === 1) { primary = variants[vi]; break; }
    }

    // Figma node dimensions are the 1x size
    var displayWidth = Math.round(node.width);
    var displayHeight = Math.round(node.height);

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

export function htmlWalkNode(node, cssVars, images, depth, _unused, pageType) {
  if (!node || node.visible === false) return null;
  if (depth > 20) return null; // safety limit

  var tag = htmlGetSemanticTag(node, depth, pageType);
  var className = htmlGetSemanticClass(node, tag);

  var styles = htmlExtractNodeCSS(node, cssVars);
  var text = null;
  var isExportableImage = htmlNodeIsExportableImage(node);
  var hasImageFill = !isExportableImage && htmlNodeHasImageFill(node);
  var imageName = null;
  var bgImageName = null;
  var bgImageNodeId = null;
  var isBgImageChild = false;
  var children = [];

  // Detect if this node is a bg-image component instance (absolute-positioned)
  // that should be absorbed by its parent as CSS background-image
  if (node.layoutPositioning === "ABSOLUTE" && htmlNodeHasBgImageVar(node)) {
    isBgImageChild = true;
  }

  // Top-level frames: always full-width, ignore Figma's fixed width and max-width
  if (depth === 0 && (node.type === "FRAME" || node.type === "SECTION")) {
    styles["width"] = "100%";
    delete styles["height"];
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
    styles["background-size"] = "cover";
    styles["background-position"] = "center";
    // bgImageName will be resolved to assets/ path after export
  }

  // Walk children (skip for exportable images — they're leaf <img> tags)
  if ("children" in node && node.children && !isExportableImage) {
    for (var i = 0; i < node.children.length; i++) {
      var child = htmlWalkNode(node.children[i], cssVars, images, depth + 1, null, pageType);
      if (child) children.push(child);
    }
  }

  // Absorb background-image child instances into parent's CSS background-image
  // (absolute-positioned bg image component instances should not render as child divs)
  if (!hasImageFill && children.length > 0) {
    var filteredChildren = [];
    for (var bci = 0; bci < children.length; bci++) {
      var bc = children[bci];
      if (bc.isBgImageChild) {
        // Absorb: mark parent as having a background image
        hasImageFill = true;
        bgImageName = htmlSanitizeName(bc.nodeName || "bg") + "-bg";
        styles["background-size"] = "cover";
        styles["background-position"] = "center";
        // Store the original node ID so the image export can find it
        bgImageNodeId = bc.nodeId;
      } else {
        filteredChildren.push(bc);
      }
    }
    children = filteredChildren;
  }

  // Convert flex-wrap rows with grid column spans to CSS Grid for exact proportions
  if (styles["flex-wrap"] === "wrap" && children.length > 0) {
    var hasGridSpans = false;
    for (var gci = 0; gci < children.length; gci++) {
      if (children[gci].colSpan) { hasGridSpans = true; break; }
    }
    if (hasGridSpans) {
      styles["display"] = "grid";
      styles["grid-template-columns"] = "repeat(12, 1fr)";
      delete styles["flex-direction"];
      delete styles["flex-wrap"];
      // Add col-span utility classes to children (not inline styles — class is shared)
      for (var gci2 = 0; gci2 < children.length; gci2++) {
        var cs = children[gci2].colSpan || 12;
        if (!children[gci2].utilityClasses) children[gci2].utilityClasses = [];
        children[gci2].utilityClasses.push("col-span-" + cs);
        // Remove flex properties — grid handles sizing
        delete children[gci2].styles["flex"];
        delete children[gci2].styles["flex-shrink"];
        delete children[gci2].styles["min-width"];
        delete children[gci2].styles["max-width"];
        delete children[gci2].styles["width"];
      }
    }
  }

  // For collapsed elements (button, select, input, a), propagate child styles upward
  // since children won't appear in the HTML output
  var iconNodeId = null;
  var iconNodeName = "";
  if (tag === "button" || tag === "select" || tag === "input" || tag === "a") {
    // Helper to detect IMAGE-fill shape nodes (icons like close-x, chevron)
    var findIconInChildren = function(childList) {
      for (var fi = 0; fi < childList.length; fi++) {
        var fc = childList[fi];
        var fcNode = figma.getNodeById(fc.nodeId);
        if (fcNode && fcNode.exportSettings && fcNode.exportSettings.length > 0) {
          return { nodeId: fc.nodeId, nodeName: fc.nodeName, width: fcNode.width, height: fcNode.height };
        }
        // Check grandchildren
        if (fc.children && fc.children.length > 0) {
          var found = findIconInChildren(fc.children);
          if (found) return found;
        }
      }
      return null;
    };

    var iconInfo = findIconInChildren(children);
    if (iconInfo) {
      iconNodeId = iconInfo.nodeId;
      iconNodeName = iconInfo.nodeName;
      // For select: position chevron on the right side
      if (tag === "select") {
        styles["background-repeat"] = "no-repeat";
        styles["background-position"] = "right 14px center";
        styles["background-size"] = Math.round(iconInfo.width) + "px " + Math.round(iconInfo.height) + "px";
        styles["padding-right"] = (Math.round(iconInfo.width) + 28) + "px";
      } else if (tag === "button") {
        // Button icons will render as <img> child — no background-image needed
      }
    }

    // Propagate all styles from descendants that the collapsed element doesn't already have.
    // Skip structural/layout props that don't make sense to bubble up.
    var skipProps = { "position": 1, "left": 1, "right": 1, "top": 1, "bottom": 1,
      "display": 1, "flex-direction": 1, "flex-wrap": 1, "justify-content": 1,
      "align-items": 1, "gap": 1, "flex": 1, "width": 1, "max-width": 1, "min-width": 1,
      "height": 1, "max-height": 1, "min-height": 1 };
    var collectChildStyles = function(childList) {
      for (var ci = 0; ci < childList.length; ci++) {
        var c = childList[ci];
        var keys = Object.keys(c.styles);
        for (var ki = 0; ki < keys.length; ki++) {
          if (!skipProps[keys[ki]] && !styles[keys[ki]]) {
            styles[keys[ki]] = c.styles[keys[ki]];
          }
        }
        if (c.children && c.children.length > 0) collectChildStyles(c.children);
      }
    };
    collectChildStyles(children);

    // Ensure collapsed elements have explicit height — their children won't provide it in HTML
    if (!styles["height"] && node.height > 0) {
      styles["height"] = Math.round(node.height) + "px";
    }
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
    colSpan: (function() { try { var d = node.getPluginData && node.getPluginData("colSpan"); return d ? (parseInt(d) || 0) : 0; } catch(e) { return 0; } })(),
    nodeId: node.id,
    nodeName: node.name,
    children: children
  };
}

export function htmlRenderCSS(cssVars, desktopTree, mobileTree, tokens) {
  var lines = [];

  // CSS custom properties
  lines.push(":root {");
  var varKeys = Object.keys(cssVars).sort();
  for (var vi = 0; vi < varKeys.length; vi++) {
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
  lines.push("");

  // Utility classes
  var utilCSS = htmlGenerateUtilityCSS(tokens, cssVars);
  if (utilCSS) {
    lines.push(utilCSS);
    lines.push("");
  }

  lines.push("/* ── Component Styles ─────────────────────────────────── */");

  // Component styles from tree
  var classStyles = {};
  htmlCollectClassStyles(desktopTree, classStyles);
  var classNames = Object.keys(classStyles);
  for (var ci = 0; ci < classNames.length; ci++) {
    var cn = classNames[ci];
    var props = classStyles[cn];
    var propKeys = Object.keys(props);
    if (propKeys.length === 0) continue;
    lines.push("." + cn + " {");
    for (var pi = 0; pi < propKeys.length; pi++) {
      lines.push("  " + propKeys[pi] + ": " + props[propKeys[pi]] + ";");
    }
    lines.push("}");
    lines.push("");
  }

  // Mobile overrides
  if (mobileTree) {
    var mobileStyles = {};
    htmlCollectClassStyles(mobileTree, mobileStyles);
    var diffs = [];
    var mobileKeys = Object.keys(mobileStyles);
    for (var mi = 0; mi < mobileKeys.length; mi++) {
      var mk = mobileKeys[mi];
      var desktopProps = classStyles[mk] || {};
      var mobileProps = mobileStyles[mk];
      var diffProps = {};
      var mpKeys = Object.keys(mobileProps);
      for (var mpi = 0; mpi < mpKeys.length; mpi++) {
        if (desktopProps[mpKeys[mpi]] !== mobileProps[mpKeys[mpi]]) {
          diffProps[mpKeys[mpi]] = mobileProps[mpKeys[mpi]];
        }
      }
      if (Object.keys(diffProps).length > 0) {
        diffs.push({ className: mk, props: diffProps });
      }
    }
    if (diffs.length > 0) {
      lines.push("@media (max-width: 567px) {");
      for (var di = 0; di < diffs.length; di++) {
        lines.push("  ." + diffs[di].className + " {");
        var dpKeys = Object.keys(diffs[di].props);
        for (var dpi = 0; dpi < dpKeys.length; dpi++) {
          lines.push("    " + dpKeys[dpi] + ": " + diffs[di].props[dpKeys[dpi]] + ";");
        }
        lines.push("  }");
      }
      lines.push("}");
    }
  }

  // Mobile: stack grid items in single column
  var gridClasses = [];
  for (var gci3 = 0; gci3 < classNames.length; gci3++) {
    if (classStyles[classNames[gci3]]["grid-template-columns"]) gridClasses.push(classNames[gci3]);
  }
  if (gridClasses.length > 0) {
    lines.push("@media (max-width: 567px) {");
    for (var gci4 = 0; gci4 < gridClasses.length; gci4++) {
      lines.push("  ." + gridClasses[gci4] + " { grid-template-columns: 1fr; }");
    }
    lines.push("  [class*='col-span-'] { grid-column: span 1; }");
    lines.push("}");
  }

  return lines.join("\n");
}

export function htmlCollectClassStyles(tree, out) {
  if (!tree) return;
  if (tree.className && Object.keys(tree.styles).length > 0) {
    out[tree.className] = tree.styles;
  }
  // For form fields: use pre-resolved styles (after utility class extraction)
  if ((tree.tag === "form-field-floating" || tree.tag === "form-field") && tree.className) {
    if (tree._inputStyles && Object.keys(tree._inputStyles).length > 0) out[tree.className + " input"] = tree._inputStyles;
    if (tree._labelStyles && Object.keys(tree._labelStyles).length > 0) out[tree.className + " label"] = tree._labelStyles;
    // field-wrapper only needs position:relative — don't leak Figma internal styles
    return;
  }
  for (var i = 0; i < tree.children.length; i++) {
    htmlCollectClassStyles(tree.children[i], out);
  }
}

// Extract label and input styles from form-field children for CSS generation.
// Propagates all styles — text children → labelStyles, non-text children → inputStyles.
export function htmlExtractFormFieldChildStyles(tree, labelStyles, inputStyles) {
  if (!tree || !tree.children) return;
  // Structural props that shouldn't propagate to label/input
  var skipLayout = { "display": 1, "flex-direction": 1, "flex-wrap": 1, "justify-content": 1,
    "align-items": 1, "gap": 1, "flex": 1, "width": 1, "max-width": 1, "min-width": 1 };
  for (var i = 0; i < tree.children.length; i++) {
    var child = tree.children[i];
    if (child.text !== null && child.text !== undefined) {
      // Text children → label styles
      var lKeys = Object.keys(child.styles);
      for (var li = 0; li < lKeys.length; li++) {
        if (!labelStyles[lKeys[li]]) labelStyles[lKeys[li]] = child.styles[lKeys[li]];
      }
    } else {
      // Non-text children → input field styles
      var iKeys = Object.keys(child.styles);
      for (var ii = 0; ii < iKeys.length; ii++) {
        if (!skipLayout[iKeys[ii]] && !inputStyles[iKeys[ii]]) inputStyles[iKeys[ii]] = child.styles[iKeys[ii]];
      }
      // Recurse into nested wrappers (field-wrapper > field + label)
      htmlExtractFormFieldChildStyles(child, labelStyles, inputStyles);
    }
  }
  // If no padding was found on the field but we have a label position, infer padding from it
  if (!inputStyles["padding"] && labelStyles["left"]) {
    var inferPadH = parseInt(labelStyles["left"], 10);
    var inferPadV = labelStyles["top"] ? parseInt(labelStyles["top"], 10) : inferPadH;
    if (inferPadH > 0) inputStyles["padding"] = inferPadV + "px " + inferPadH + "px";
  }
}

// Find the absolute-positioned label's position values in a form-field tree, with utility class matches
export function htmlFindAbsoluteLabelPos(tree) {
  var result = { left: null, top: null, leftClass: null, topClass: null };
  if (!tree || !tree.children) return result;
  for (var i = 0; i < tree.children.length; i++) {
    var child = tree.children[i];
    if (child.text !== null && child.text !== undefined && child.styles["position"] === "absolute") {
      // Parse px values from left/top styles
      var leftVal = child.styles["left"] ? parseInt(child.styles["left"], 10) : null;
      var topVal = child.styles["top"] ? parseInt(child.styles["top"], 10) : null;
      result.left = leftVal;
      result.top = topVal;
      // Check if utility classes exist for these values
      if (child.utilityClasses) {
        for (var u = 0; u < child.utilityClasses.length; u++) {
          if (child.utilityClasses[u].indexOf("left-") === 0) result.leftClass = child.utilityClasses[u];
          if (child.utilityClasses[u].indexOf("top-") === 0) result.topClass = child.utilityClasses[u];
        }
      }
      return result;
    }
    // Recurse into wrappers
    var nested = htmlFindAbsoluteLabelPos(child);
    if (nested.left !== null || nested.top !== null) return nested;
  }
  return result;
}

// Find the field-wrapper node in a form-field tree (the container with "wrapper" in name,
// or the deepest non-text node whose children include both text and non-text nodes)
export function htmlFindFieldWrapper(tree) {
  if (!tree || !tree.children) return null;
  for (var i = 0; i < tree.children.length; i++) {
    var child = tree.children[i];
    if (child.nodeName && child.nodeName.toLowerCase().indexOf("wrapper") !== -1) return child;
    var nested = htmlFindFieldWrapper(child);
    if (nested) return nested;
  }
  return null;
}

// Collect all text nodes from a tree in order (for form fields with label + placeholder)
export function htmlCollectAllTexts(tree) {
  var results = [];
  if (!tree) return results;
  if (tree.text !== null && tree.text !== undefined && tree.text.trim()) results.push(tree.text.trim());
  for (var i = 0; i < tree.children.length; i++) {
    var childTexts = htmlCollectAllTexts(tree.children[i]);
    for (var j = 0; j < childTexts.length; j++) results.push(childTexts[j]);
  }
  return results;
}

// Extract first text content from a component tree (for buttons, inputs, etc.)
export function htmlExtractTextFromTree(tree) {
  if (!tree) return "";
  if (tree.text !== null && tree.text !== undefined) return tree.text;
  for (var i = 0; i < tree.children.length; i++) {
    var t = htmlExtractTextFromTree(tree.children[i]);
    if (t) return t;
  }
  return "";
}

export function htmlRenderNodeClean(tree, indent) {
  // Render HTML without inline styles (styles are in CSS file)
  if (!tree) return "";
  var pad = "";
  for (var i = 0; i < indent; i++) pad += "  ";
  var lines = [];

  var attrs = "";
  var allClasses = [];
  if (tree.className) allClasses.push(tree.className);
  if (tree.utilityClasses) {
    for (var ui = 0; ui < tree.utilityClasses.length; ui++) allClasses.push(tree.utilityClasses[ui]);
  }
  if (allClasses.length > 0) attrs += ' class="' + allClasses.join(" ") + '"';

  // "body" tag from landing/fullsite: skip wrapper, render children directly
  if (tree.tag === "body" && tree.children && tree.children.length > 0) {
    for (var bi = 0; bi < tree.children.length; bi++) {
      lines.push(htmlRenderNodeClean(tree.children[bi], indent));
    }
    return lines.join("\n");
  }

  if (tree.tag === "img") {
    var src = tree.imageName ? "assets/" + tree.imageName : "assets/placeholder.png";
    var imgAttrs = attrs + ' src="' + src + '" alt="' + (tree.nodeName || "").replace(/"/g, "&quot;") + '"';
    var srcset = buildSrcset(tree.imageVariants, "assets/");
    if (srcset) imgAttrs += ' srcset="' + srcset + '"';
    if (tree.imageWidth) imgAttrs += ' width="' + tree.imageWidth + '"';
    if (tree.imageHeight) imgAttrs += ' height="' + tree.imageHeight + '"';
    lines.push(pad + '<img' + imgAttrs + ' />');
  } else if (tree.tag === "form-field-floating") {
    // Floating label: follows component structure — form-field > field-wrapper > input + label
    var flfTexts = htmlCollectAllTexts(tree);
    var flfLabel = flfTexts.length > 0 ? flfTexts[0].replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    var flfInputClasses = tree._inputUtilClasses || [];
    var flfLabelClasses = tree._labelUtilClasses || [];
    var flfInputAttr = flfInputClasses.length > 0 ? ' class="' + flfInputClasses.join(" ") + '"' : "";
    var flfLabelAttr = flfLabelClasses.length > 0 ? ' class="' + flfLabelClasses.join(" ") + '"' : "";
    // Find field-wrapper node and collect its utility classes
    var flfWrapper = htmlFindFieldWrapper(tree);
    var flfWrapperAllClasses = ["field-wrapper", "relative"];
    if (flfWrapper && flfWrapper.utilityClasses) {
      for (var fwi = 0; fwi < flfWrapper.utilityClasses.length; fwi++) {
        if (flfWrapperAllClasses.indexOf(flfWrapper.utilityClasses[fwi]) === -1) {
          flfWrapperAllClasses.push(flfWrapper.utilityClasses[fwi]);
        }
      }
    }
    var flfWrapperAttr = ' class="' + flfWrapperAllClasses.join(" ") + '"';
    lines.push(pad + '<div' + attrs + '>');
    lines.push(pad + '  <div' + flfWrapperAttr + '>');
    lines.push(pad + '    <input type="text"' + flfInputAttr + ' />');
    if (flfLabel) {
      lines.push(pad + '    <label' + flfLabelAttr + '>' + flfLabel + '</label>');
    }
    lines.push(pad + '  </div>');
    lines.push(pad + '</div>');
  } else if (tree.tag === "form-field") {
    // Regular form field: label above the input
    var ffTexts = htmlCollectAllTexts(tree);
    var ffLabel = ffTexts.length > 0 ? ffTexts[0].replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    var ffPlaceholder = ffTexts.length > 1 ? ffTexts[1].replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
    var ffInputClasses = tree._inputUtilClasses || [];
    var ffLabelClasses = tree._labelUtilClasses || [];
    var ffInputAttr = ffInputClasses.length > 0 ? ' class="' + ffInputClasses.join(" ") + '"' : "";
    var ffLabelAttr = ffLabelClasses.length > 0 ? ' class="' + ffLabelClasses.join(" ") + '"' : "";
    lines.push(pad + '<div' + attrs + '>');
    if (ffLabel) {
      lines.push(pad + '  <label' + ffLabelAttr + '>' + ffLabel + '</label>');
    }
    lines.push(pad + '  <input type="text"' + ffInputAttr + (ffPlaceholder ? ' placeholder="' + ffPlaceholder + '"' : '') + ' />');
    lines.push(pad + '</div>');
  } else if (tree.tag === "input") {
    lines.push(pad + '<input' + attrs + ' type="text" placeholder="' + htmlExtractTextFromTree(tree) + '" />');
  } else if (tree.tag === "select") {
    var selectText = htmlExtractTextFromTree(tree) || tree.nodeName || "Select";
    lines.push(pad + '<select' + attrs + '>');
    lines.push(pad + '  <option value="" disabled hidden selected>' + selectText.replace(/</g, "&lt;") + '</option>');
    lines.push(pad + '</select>');
  } else if (tree.tag === "button") {
    var btnText = htmlExtractTextFromTree(tree);
    // Icon-only buttons (e.g. close button) should be empty — don't fall back to node name
    if (!btnText && !tree.iconNodeId) btnText = tree.nodeName || "Button";
    if (tree.iconImageName) {
      // Button with icon image: render as <img> inside button
      lines.push(pad + '<button' + attrs + '>');
      var iconImgAttrs = 'src="assets/' + tree.iconImageName + '" alt="' + (tree.iconNodeName || "icon").replace(/"/g, "&quot;") + '"';
      var iconSrcset = buildSrcset(tree.iconImageVariants, "assets/");
      if (iconSrcset) iconImgAttrs += ' srcset="' + iconSrcset + '"';
      if (tree.iconImageWidth) iconImgAttrs += ' width="' + tree.iconImageWidth + '"';
      if (tree.iconImageHeight) iconImgAttrs += ' height="' + tree.iconImageHeight + '"';
      lines.push(pad + '  <img ' + iconImgAttrs + ' />');
      if (btnText) lines.push(pad + '  <span>' + btnText.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</span>');
      lines.push(pad + '</button>');
    } else if (btnText) {
      lines.push(pad + '<button' + attrs + '>' + btnText.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</button>');
    } else {
      lines.push(pad + '<button' + attrs + '></button>');
    }
  } else if (tree.tag === "a") {
    var linkText = htmlExtractTextFromTree(tree) || tree.nodeName || "Link";
    lines.push(pad + '<a' + attrs + ' href="#">' + linkText.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</a>');
  } else if (tree.text !== null) {
    lines.push(pad + '<' + tree.tag + attrs + '>' + tree.text.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</' + tree.tag + '>');
  } else if (tree.children.length === 0) {
    lines.push(pad + '<' + tree.tag + attrs + '></' + tree.tag + '>');
  } else {
    lines.push(pad + '<' + tree.tag + attrs + '>');
    for (var ci = 0; ci < tree.children.length; ci++) {
      lines.push(htmlRenderNodeClean(tree.children[ci], indent + 1));
    }
    lines.push(pad + '</' + tree.tag + '>');
  }
  return lines.join("\n");
}

// Helper: push all image variants into the images array
function pushImageVariants(img, images) {
  if (img.variants && img.variants.length > 0) {
    for (var vi = 0; vi < img.variants.length; vi++) {
      images.push(img.variants[vi]);
    }
  } else {
    images.push(img);
  }
}

// Helper: build srcset string from image variants
function buildSrcset(variants, basePath) {
  if (!variants || variants.length <= 1) return null;
  var parts = [];
  for (var vi = 0; vi < variants.length; vi++) {
    parts.push(basePath + variants[vi].name + " " + variants[vi].scale + "x");
  }
  return parts.join(", ");
}

export async function htmlCollectImages(tree, images, progressCb, counter) {
  if (!tree) return;
  // Export leaf <img> nodes
  if (tree.isImage && tree.nodeId) {
    var node = figma.getNodeById(tree.nodeId);
    if (node) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      var img = await htmlExportImage(node);
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
    var iconNode = figma.getNodeById(tree.iconNodeId);
    if (iconNode) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      var iconImg = await htmlExportImage(iconNode);
      if (iconImg) {
        if (tree.tag === "button") {
          tree.iconImageName = iconImg.name;
          tree.iconImageVariants = iconImg.variants || [];
          tree.iconImageWidth = iconImg.displayWidth;
          tree.iconImageHeight = iconImg.displayHeight;
        } else {
          // Select chevron etc — use 1x for background-image, CSS handles density
          tree.styles["background-image"] = "url('assets/" + iconImg.name + "')";
          // image-set for retina bg images
          if (iconImg.variants && iconImg.variants.length > 1) {
            var bgParts = [];
            for (var bvi = 0; bvi < iconImg.variants.length; bvi++) {
              bgParts.push("url('assets/" + iconImg.variants[bvi].name + "') " + iconImg.variants[bvi].scale + "x");
            }
            tree.styles["background-image"] = "image-set(" + bgParts.join(", ") + ")";
          }
        }
        pushImageVariants(iconImg, images);
      }
    }
  }
  // Export container background images
  if (tree.hasBgImage && (tree.bgImageNodeId || tree.nodeId)) {
    var bgNode = figma.getNodeById(tree.bgImageNodeId || tree.nodeId);
    if (bgNode) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      var bgImg = await htmlExportImage(bgNode);
      if (bgImg) {
        tree.bgImageName = bgImg.name;
        tree.styles["background-image"] = "url('assets/" + bgImg.name + "')";
        if (bgImg.variants && bgImg.variants.length > 1) {
          var bgParts2 = [];
          for (var bvi2 = 0; bvi2 < bgImg.variants.length; bvi2++) {
            bgParts2.push("url('assets/" + bgImg.variants[bvi2].name + "') " + bgImg.variants[bvi2].scale + "x");
          }
          tree.styles["background-image"] = "image-set(" + bgParts2.join(", ") + ")";
        }
        pushImageVariants(bgImg, images);
      }
    }
  }
  for (var i = 0; i < tree.children.length; i++) {
    await htmlCollectImages(tree.children[i], images, progressCb, counter);
  }
}

export function htmlCountImages(tree) {
  if (!tree) return 0;
  var count = (tree.isImage ? 1 : 0) + (tree.hasBgImage ? 1 : 0) + (tree.iconNodeId ? 1 : 0);
  for (var i = 0; i < tree.children.length; i++) {
    count += htmlCountImages(tree.children[i]);
  }
  return count;
}

// ── Utility CSS Class System ──────────────────────────────────────────────

export function htmlAbbreviateName(name) {
  var words = name.toLowerCase().replace(/[^a-zA-Z0-9]/g, " ").trim().split(/\s+/).filter(function(w) { return w.length > 0; });
  var skip = ["the","a","an","and","or","that","this","is","of","for","in","on","to","with",
    "frame","group","auto","layout","wrapper","container","component","instance",
    "section","page","div","block","element","item","default","variant","property"];
  var meaningful = words.filter(function(w) { return skip.indexOf(w) === -1; });
  if (meaningful.length === 0) return "";
  var result = meaningful.slice(0, 2).join("-");
  if (result.length > 20) result = result.substring(0, 20).replace(/-$/, "");
  return result.replace(/[^a-zA-Z0-9-]/g, "");
}

export function htmlBuildUtilityMap(tokens) {
  var map = {};

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
    var posProps = ["top", "right", "bottom", "left"];
    for (var si = 0; si < tokens.spacing.length; si++) {
      var sp = tokens.spacing[si];
      if (sp.value === "0") continue;
      var val = sp.value + "px";
      map["gap:" + val] = "gap-" + sp.name;
      for (var ppi = 0; ppi < posProps.length; ppi++) {
        map[posProps[ppi] + ":" + val] = posProps[ppi] + "-" + sp.name;
      }
    }
  }

  // Font weight
  var wn = {"100":"thin","200":"extralight","300":"light","400":"normal","500":"medium","600":"semibold","700":"bold","800":"extrabold","900":"black"};
  for (var w in wn) { if (wn.hasOwnProperty(w)) map["font-weight:" + w] = "font-" + wn[w]; }

  // Font size
  if (tokens && tokens.typography && tokens.typography.sizes) {
    for (var tsi = 0; tsi < tokens.typography.sizes.length; tsi++) {
      var ts = tokens.typography.sizes[tsi];
      map["font-size:" + ts.value + "px"] = "text-" + ts.name;
    }
  }

  // Line height
  if (tokens && tokens.typography && tokens.typography.lineHeights) {
    for (var li = 0; li < tokens.typography.lineHeights.length; li++) {
      var lh = tokens.typography.lineHeights[li];
      map["line-height:" + lh.value] = "leading-" + lh.name;
    }
  }

  // Border radius
  if (tokens && tokens.radius) {
    for (var ri = 0; ri < tokens.radius.length; ri++) {
      var rad = tokens.radius[ri];
      map["border-radius:" + rad.value + "px"] = "rounded-" + rad.name;
    }
  }

  return map;
}

export function htmlBuildSpacingLookup(tokens, cssVars) {
  var lookup = {};
  if (tokens && tokens.spacing) {
    for (var i = 0; i < tokens.spacing.length; i++) {
      var sp = tokens.spacing[i];
      if (sp.value === "0") continue;
      var val = sp.value + "px";
      lookup[val] = sp.name;
    }
  }
  // Also index var() references that resolve to spacing values
  if (cssVars) {
    var varKeys = Object.keys(cssVars);
    for (var vi = 0; vi < varKeys.length; vi++) {
      var vn = varKeys[vi];
      var vv = cssVars[vn];
      if (typeof vv === "string" && /^\d+px$/.test(vv) && lookup[vv]) {
        lookup["var(" + vn + ")"] = lookup[vv];
      }
    }
  }
  return lookup;
}

export function htmlAddColorUtilities(utilMap, cssVars) {
  var varKeys = Object.keys(cssVars);
  for (var i = 0; i < varKeys.length; i++) {
    var varName = varKeys[i];
    var val = cssVars[varName];
    var shortName = varName.replace(/^--/, "");
    var varRef = "var(" + varName + ")";
    if (typeof val === "string" && (val.indexOf("rgb") === 0 || val.indexOf("#") === 0)) {
      utilMap["background-color:" + varRef] = "bg-" + shortName;
      utilMap["color:" + varRef] = "text-" + shortName;
    }
    // Map var()-based spacing/radius values to existing token utilities
    // e.g., gap:var(--spacing-4) → reuse the same class as gap:4px (which is gap-4)
    if (typeof val === "string" && /^\d+px$/.test(val)) {
      var gapTokenClass = utilMap["gap:" + val];
      if (gapTokenClass) utilMap["gap:" + varRef] = gapTokenClass;
      var radiusTokenClass = utilMap["border-radius:" + val];
      if (radiusTokenClass) utilMap["border-radius:" + varRef] = radiusTokenClass;
    }
  }
}

export function htmlGenerateUtilityCSS(tokens, cssVars) {
  var lines = [];
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
  for (var colI = 1; colI <= 12; colI++) {
    lines.push(".col-span-" + colI + " { grid-column: span " + colI + "; }");
  }
  lines.push("");

  // Spacing
  if (tokens && tokens.spacing) {
    lines.push("/* ── Spacing Utilities ────────────────────────────────── */");
    for (var si = 0; si < tokens.spacing.length; si++) {
      var sp = tokens.spacing[si];
      if (sp.value === "0") continue;
      var v = sp.value + "px";
      lines.push(".gap-" + sp.name + " { gap: " + v + "; }");
    }
    for (var si2 = 0; si2 < tokens.spacing.length; si2++) {
      var sp2 = tokens.spacing[si2];
      if (sp2.value === "0") continue;
      var v2 = sp2.value + "px";
      lines.push(".p-" + sp2.name + " { padding: " + v2 + "; }");
      lines.push(".px-" + sp2.name + " { padding-left: " + v2 + "; padding-right: " + v2 + "; }");
      lines.push(".py-" + sp2.name + " { padding-top: " + v2 + "; padding-bottom: " + v2 + "; }");
    }
    lines.push("");
    lines.push("/* ── Position Offset Utilities (from spacing tokens) ──── */");
    for (var si3 = 0; si3 < tokens.spacing.length; si3++) {
      var sp3 = tokens.spacing[si3];
      if (sp3.value === "0") continue;
      var v3 = sp3.value + "px";
      lines.push(".top-" + sp3.name + " { top: " + v3 + "; }");
      lines.push(".right-" + sp3.name + " { right: " + v3 + "; }");
      lines.push(".bottom-" + sp3.name + " { bottom: " + v3 + "; }");
      lines.push(".left-" + sp3.name + " { left: " + v3 + "; }");
    }
    lines.push("");
  }

  // Typography
  lines.push("/* ── Typography Utilities ─────────────────────────────── */");
  var wn = {"100":"thin","200":"extralight","300":"light","400":"normal","500":"medium","600":"semibold","700":"bold","800":"extrabold","900":"black"};
  for (var w in wn) { if (wn.hasOwnProperty(w)) lines.push(".font-" + wn[w] + " { font-weight: " + w + "; }"); }
  if (tokens && tokens.typography && tokens.typography.sizes) {
    for (var tsi = 0; tsi < tokens.typography.sizes.length; tsi++) {
      var ts = tokens.typography.sizes[tsi];
      lines.push(".text-" + ts.name + " { font-size: " + ts.value + "px; }");
    }
  }
  if (tokens && tokens.typography && tokens.typography.lineHeights) {
    for (var li = 0; li < tokens.typography.lineHeights.length; li++) {
      var lh = tokens.typography.lineHeights[li];
      lines.push(".leading-" + lh.name + " { line-height: " + lh.value + "; }");
    }
  }
  lines.push("");

  // Border radius
  if (tokens && tokens.radius) {
    lines.push("/* ── Border Radius Utilities ──────────────────────────── */");
    for (var ri = 0; ri < tokens.radius.length; ri++) {
      var rad = tokens.radius[ri];
      lines.push(".rounded-" + rad.name + " { border-radius: " + rad.value + "px; }");
    }
    lines.push("");
  }

  // Color utilities from collected CSS vars
  if (cssVars) {
    var colorLines = [];
    var varKeys = Object.keys(cssVars).sort();
    for (var ci = 0; ci < varKeys.length; ci++) {
      var varName = varKeys[ci];
      var cval = cssVars[varName];
      if (typeof cval === "string" && (cval.indexOf("rgb") === 0 || cval.indexOf("#") === 0)) {
        var shortName = varName.replace(/^--/, "");
        colorLines.push(".bg-" + shortName + " { background-color: var(" + varName + "); }");
        colorLines.push(".text-" + shortName + " { color: var(" + varName + "); }");
      }
    }
    if (colorLines.length > 0) {
      lines.push("/* ── Color Utilities ──────────────────────────────────── */");
      for (var cli = 0; cli < colorLines.length; cli++) lines.push(colorLines[cli]);
      lines.push("");
    }
  }

  return lines.join("\n");
}

// Resolve a styles object into { utils: string[], remaining: object }
function resolveStylesToUtilities(styles, utilMap, spacingLookup) {
  var utils = [];
  var remaining = {};
  var keys = Object.keys(styles);
  for (var i = 0; i < keys.length; i++) {
    var prop = keys[i];
    var val = styles[prop];
    var lookup = prop + ":" + val;
    if (utilMap[lookup]) {
      utils.push(utilMap[lookup]);
    } else if (prop === "padding" && spacingLookup) {
      var padParts = [];
      var padRemainder = val;
      while (padRemainder.length > 0) {
        padRemainder = padRemainder.trim();
        if (padRemainder.indexOf("var(") === 0) {
          var closeIdx = padRemainder.indexOf(")");
          if (closeIdx !== -1) { padParts.push(padRemainder.substring(0, closeIdx + 1)); padRemainder = padRemainder.substring(closeIdx + 1); }
          else { padParts.push(padRemainder); padRemainder = ""; }
        } else {
          var spIdx = padRemainder.indexOf(" ");
          if (spIdx !== -1) { padParts.push(padRemainder.substring(0, spIdx)); padRemainder = padRemainder.substring(spIdx + 1); }
          else { padParts.push(padRemainder); padRemainder = ""; }
        }
      }
      var resolvedParts = [];
      for (var ppi = 0; ppi < padParts.length; ppi++) {
        var pp = padParts[ppi];
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

export function htmlAssignUtilities(tree, utilMap, spacingLookup) {
  if (!tree) return;
  var result = resolveStylesToUtilities(tree.styles, utilMap, spacingLookup);
  // Preserve existing utility classes (e.g. col-span-N added during tree walk)
  var existing = tree.utilityClasses || [];
  tree.utilityClasses = existing.concat(result.utils);
  tree.styles = result.remaining;

  // For form fields: resolve input/label child styles to utility classes too
  if (tree.tag === "form-field-floating" || tree.tag === "form-field") {
    var flLabelStyles = {};
    var flInputStyles = {};
    htmlExtractFormFieldChildStyles(tree, flLabelStyles, flInputStyles);
    if (tree.tag === "form-field-floating") {
      flLabelStyles["position"] = "absolute";
      flLabelStyles["pointer-events"] = "none";
    }
    var inputResult = resolveStylesToUtilities(flInputStyles, utilMap, spacingLookup);
    var labelResult = resolveStylesToUtilities(flLabelStyles, utilMap, spacingLookup);
    tree._inputUtilClasses = inputResult.utils;
    tree._inputStyles = inputResult.remaining;
    tree._labelUtilClasses = labelResult.utils;
    tree._labelStyles = labelResult.remaining;
  }

  if (tree.children) {
    for (var ci = 0; ci < tree.children.length; ci++) {
      htmlAssignUtilities(tree.children[ci], utilMap, spacingLookup);
    }
  }
}
