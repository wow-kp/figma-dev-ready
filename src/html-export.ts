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
      else { styles["left"] = Math.round(node.x || 0) + "px"; }
      if (cons.vertical === "STRETCH") { styles["top"] = "0"; styles["bottom"] = "0"; }
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
    if (parentDir === "HORIZONTAL") { styles["flex"] = "1 1 0"; }
    else { styles["width"] = "100%"; }
  } else if (node.width > 0 && node.layoutSizingHorizontal !== "HUG"
    && !(node.type === "TEXT" && node.textAutoResize === "WIDTH_AND_HEIGHT")) {
    styles["width"] = Math.round(node.width) + "px";
    // Prevent flex shrinking below fixed width in flex parents
    if (isAutoChild) styles["flex-shrink"] = "0";
  }
  if (node.layoutSizingVertical === "FILL") {
    if (parentDir === "VERTICAL") { styles["flex"] = "1 1 0"; }
    else { styles["height"] = "100%"; }
  } else if (node.height > 0 && node.layoutSizingVertical !== "HUG" && !node.layoutMode
    && !(node.type === "TEXT" && (node.textAutoResize === "HEIGHT" || node.textAutoResize === "WIDTH_AND_HEIGHT"))) {
    styles["height"] = Math.round(node.height) + "px";
  }

  // Max width for responsive (child frames only — top-level handled in walkNode)
  if (node.maxWidth && node.maxWidth < 10000) styles["max-width"] = Math.round(node.maxWidth) + "px";

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
    if (stroke && stroke.visible !== false && stroke.type === "SOLID") {
      var sw = typeof node.strokeWeight === "number" ? node.strokeWeight : 1;
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

export function htmlGetSemanticTag(node) {
  var name = (node.name || "").toLowerCase();
  var type = node.type;

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
    if (name.indexOf("nav") !== -1 || name === "header") return "nav";
    if (name.indexOf("header") !== -1) return "header";
    if (name.indexOf("footer") !== -1) return "footer";
    if (name.indexOf("hero") !== -1) return "section";
    if (name.indexOf("banner") !== -1) return "section";
    if (name.indexOf("popup") !== -1 || name.indexOf("modal") !== -1 || name.indexOf("dialog") !== -1) return "div";

    // Button detection: check node name, component name, or component set name
    if (name.indexOf("button") !== -1 || name.indexOf("btn") !== -1 || name.indexOf("cta") !== -1
        || componentHint.indexOf("button") !== -1 || componentHint.indexOf("btn") !== -1) return "button";

    // Dropdown / select detection
    if (name.indexOf("dropdown") !== -1 || name.indexOf("select") !== -1
        || componentHint.indexOf("dropdown") !== -1 || componentHint.indexOf("select") !== -1) return "select";

    // Input / field detection (frames named "input-*" or instances of input components)
    if (name.indexOf("input") !== -1 || name.indexOf("field") !== -1 || name.indexOf("textarea") !== -1
        || componentHint.indexOf("input") !== -1 || componentHint.indexOf("field") !== -1 || componentHint.indexOf("text-field") !== -1) return "input";

    // Link detection
    if (name.indexOf("link") !== -1 || componentHint.indexOf("link") !== -1) return "a";

    // Image detection (for instance/component only)
    if ((type === "INSTANCE" || type === "COMPONENT") && (name.indexOf("image") !== -1 || name.indexOf("img") !== -1 || name.indexOf("icon") !== -1)) return "img";
  }

  if (type === "FRAME" || type === "SECTION" || type === "GROUP" || type === "INSTANCE" || type === "COMPONENT" || type === "COMPONENT_SET") return "div";
  if (type === "RECTANGLE" || type === "ELLIPSE" || type === "LINE" || type === "VECTOR" || type === "STAR" || type === "POLYGON") return "div";
  return "div";
}

export function htmlGetSemanticClass(node) {
  var name = (node.name || "").toLowerCase();
  // Convert node name to a CSS class
  return htmlSanitizeName(node.name || "element");
}

export function htmlNodeIsExportableImage(node) {
  // Only treat as <img> if: (a) node has exportSettings AND is a leaf (no children or only shapes), or
  // (b) node is a RECTANGLE/ELLIPSE/VECTOR with IMAGE fill (not a container frame)
  var isLeaf = !("children" in node) || !node.children || node.children.length === 0;
  var isShape = node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "VECTOR" || node.type === "LINE";

  // Export-marked leaf nodes
  if (node.exportSettings && node.exportSettings.length > 0 && (isLeaf || isShape)) return true;

  // Shapes with IMAGE fills
  if (isShape && node.fills && Array.isArray(node.fills)) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].type === "IMAGE" && node.fills[i].visible !== false) return true;
    }
  }
  return false;
}

export function htmlNodeHasBgImageVar(node) {
  // Check if the node (or its main component) has the "background-image" boolean variable bound
  try {
    var bv = node.boundVariables || {};
    if (bv.visible) {
      var v = figma.variables.getVariableById(bv.visible.id);
      if (v && v.name === "background-image") return true;
    }
    // For instances, check the main component's binding
    if (node.type === "INSTANCE" && node.mainComponent) {
      var compBv = node.mainComponent.boundVariables || {};
      if (compBv.visible) {
        var cv = figma.variables.getVariableById(compBv.visible.id);
        if (cv && cv.name === "background-image") return true;
      }
      // Also check component set name
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
  // Fallback: check if a container frame has an IMAGE fill (should be background-image, not <img>)
  // Only applies to frames with children (containers), not leaf shapes
  var hasChildren = ("children" in node) && node.children && node.children.length > 0;
  if (hasChildren && node.fills && Array.isArray(node.fills)) {
    for (var i = 0; i < node.fills.length; i++) {
      if (node.fills[i].type === "IMAGE" && node.fills[i].visible !== false) return true;
    }
  }
  return false;
}

export var _htmlImageNameCount = {};

export async function htmlExportImage(node, progressCb) {
  try {
    var format = "PNG";
    var exportOpts = { format: "PNG", constraint: { type: "SCALE", value: 2 } };

    if (node.exportSettings && node.exportSettings.length > 0) {
      var es = node.exportSettings[0];
      format = es.format || "PNG";
      exportOpts = {
        format: format,
        constraint: es.constraint || { type: "SCALE", value: 2 }
      };
    }

    var ext = format.toLowerCase();
    if (ext === "jpg") ext = "jpg";
    var bytes = await node.exportAsync(exportOpts);
    var baseName = htmlSanitizeName(node.name || "image");
    // Deduplicate image file names to prevent collisions
    if (!_htmlImageNameCount[baseName]) _htmlImageNameCount[baseName] = 0;
    _htmlImageNameCount[baseName]++;
    if (_htmlImageNameCount[baseName] > 1) baseName = baseName + "-" + _htmlImageNameCount[baseName];
    var name = baseName + "." + ext;
    return { name: name, format: ext, bytes: Array.from(bytes) };
  } catch(e) {
    return null;
  }
}

export function htmlWalkNode(node, cssVars, images, depth, classCounter) {
  if (!node || node.visible === false) return null;
  if (depth > 20) return null; // safety limit
  if (!classCounter) classCounter = {};

  var tag = htmlGetSemanticTag(node);
  var rawClass = htmlGetSemanticClass(node);
  // Deduplicate class names — append index if already seen
  if (!classCounter[rawClass]) classCounter[rawClass] = 0;
  classCounter[rawClass]++;
  var className = classCounter[rawClass] > 1 ? rawClass + "-" + classCounter[rawClass] : rawClass;

  var styles = htmlExtractNodeCSS(node, cssVars);
  var text = null;
  var isExportableImage = htmlNodeIsExportableImage(node);
  var hasImageFill = !isExportableImage && htmlNodeHasImageFill(node);
  var imageName = null;
  var bgImageName = null;
  var children = [];

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
      var child = htmlWalkNode(node.children[i], cssVars, images, depth + 1, classCounter);
      if (child) children.push(child);
    }
  }

  // For collapsed elements (button, select, input, a), propagate child styles upward
  // since children won't appear in the HTML output
  if (tag === "button" || tag === "select" || tag === "input" || tag === "a") {
    for (var sci = 0; sci < children.length; sci++) {
      var sc = children[sci];
      // Pull text styles from TEXT children (color, font-size, font-weight, font-family)
      if (sc.text !== null && sc.text !== undefined) {
        if (sc.styles["color"] && !styles["color"]) styles["color"] = sc.styles["color"];
        if (sc.styles["font-size"] && !styles["font-size"]) styles["font-size"] = sc.styles["font-size"];
        if (sc.styles["font-weight"] && !styles["font-weight"]) styles["font-weight"] = sc.styles["font-weight"];
        if (sc.styles["font-family"] && !styles["font-family"]) styles["font-family"] = sc.styles["font-family"];
        if (sc.styles["text-transform"] && !styles["text-transform"]) styles["text-transform"] = sc.styles["text-transform"];
        if (sc.styles["text-decoration"] && !styles["text-decoration"]) styles["text-decoration"] = sc.styles["text-decoration"];
        if (sc.styles["letter-spacing"] && !styles["letter-spacing"]) styles["letter-spacing"] = sc.styles["letter-spacing"];
      }
      // Pull border from inner frames if the parent has none
      if (sc.styles["border"] && !styles["border"]) styles["border"] = sc.styles["border"];
      if (sc.styles["border-radius"] && !styles["border-radius"]) styles["border-radius"] = sc.styles["border-radius"];
      // Also check grandchildren (e.g. button > frame > text)
      if (sc.text === null || sc.text === undefined) {
        for (var gci = 0; gci < (sc.children || []).length; gci++) {
          var gc = sc.children[gci];
          if (gc.text !== null && gc.text !== undefined) {
            if (gc.styles["color"] && !styles["color"]) styles["color"] = gc.styles["color"];
            if (gc.styles["font-size"] && !styles["font-size"]) styles["font-size"] = gc.styles["font-size"];
            if (gc.styles["font-weight"] && !styles["font-weight"]) styles["font-weight"] = gc.styles["font-weight"];
            if (gc.styles["font-family"] && !styles["font-family"]) styles["font-family"] = gc.styles["font-family"];
          }
          if (gc.styles["border"] && !styles["border"]) styles["border"] = gc.styles["border"];
          if (gc.styles["border-radius"] && !styles["border-radius"]) styles["border-radius"] = gc.styles["border-radius"];
        }
      }
    }
  }

  return {
    tag: tag,
    className: className,
    styles: styles,
    text: text,
    imageName: imageName,
    bgImageName: bgImageName,
    isImage: isExportableImage,
    hasBgImage: hasImageFill,
    nodeId: node.id,
    nodeName: node.name,
    children: children
  };
}

export function htmlRenderCSS(cssVars, desktopTree, mobileTree) {
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
  lines.push("button { cursor: pointer; font: inherit; display: inline-flex; align-items: center; justify-content: center; }");
  lines.push("input, select { font: inherit; display: block; width: 100%; }");
  lines.push("a { text-decoration: none; color: inherit; }");
  lines.push("");

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

  return lines.join("\n");
}

export function htmlCollectClassStyles(tree, out) {
  if (!tree) return;
  if (tree.className && Object.keys(tree.styles).length > 0) {
    out[tree.className] = tree.styles;
  }
  for (var i = 0; i < tree.children.length; i++) {
    htmlCollectClassStyles(tree.children[i], out);
  }
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
  if (tree.className) attrs += ' class="' + tree.className + '"';

  if (tree.tag === "img") {
    var src = tree.imageName ? "assets/" + tree.imageName : "assets/placeholder.png";
    lines.push(pad + '<img' + attrs + ' src="' + src + '" alt="' + (tree.nodeName || "").replace(/"/g, "&quot;") + '" />');
  } else if (tree.tag === "input") {
    lines.push(pad + '<input' + attrs + ' type="text" placeholder="' + htmlExtractTextFromTree(tree) + '" />');
  } else if (tree.tag === "select") {
    var selectText = htmlExtractTextFromTree(tree) || tree.nodeName || "Select";
    lines.push(pad + '<select' + attrs + '>');
    lines.push(pad + '  <option value="" disabled selected>' + selectText.replace(/</g, "&lt;") + '</option>');
    lines.push(pad + '</select>');
  } else if (tree.tag === "button") {
    var btnText = htmlExtractTextFromTree(tree) || tree.nodeName || "Button";
    lines.push(pad + '<button' + attrs + '>' + btnText.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</button>');
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
        tree.imageName = img.name; // already has extension from htmlExportImage
        images.push(img);
      }
    }
  }
  // Export container background images
  if (tree.hasBgImage && tree.nodeId) {
    var bgNode = figma.getNodeById(tree.nodeId);
    if (bgNode) {
      counter.done++;
      if (progressCb) progressCb(counter.done, counter.total);
      var bgImg = await htmlExportImage(bgNode);
      if (bgImg) {
        // Use the bgImageName as the file name
        bgImg.name = htmlSanitizeName(tree.bgImageName) + "." + bgImg.format;
        tree.bgImageName = bgImg.name;
        tree.styles["background-image"] = "url('assets/" + bgImg.name + "')";
        images.push(bgImg);
      }
    }
  }
  for (var i = 0; i < tree.children.length; i++) {
    await htmlCollectImages(tree.children[i], images, progressCb, counter);
  }
}

export function htmlCountImages(tree) {
  if (!tree) return 0;
  var count = (tree.isImage ? 1 : 0) + (tree.hasBgImage ? 1 : 0);
  for (var i = 0; i < tree.children.length; i++) {
    count += htmlCountImages(tree.children[i]);
  }
  return count;
}
