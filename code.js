figma.showUI(__html__, { width: 440, height: 640, title: "Is it ready for dev?" });

figma.ui.onmessage = function(msg) {
  if (msg.type === "run-audit") {
    var results = runAudit();
    figma.ui.postMessage({ type: "audit-results", results: results });
  }
  if (msg.type === "focus-node") {
    var node = figma.getNodeById(msg.id);
    if (node) {
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
    }
  }
  if (msg.type === "import-tokens") {
    try {
      var result = importTokens(msg.filename, msg.data);
      figma.ui.postMessage({ type: "import-result", success: true, filename: msg.filename, message: result });
    } catch(e) {
      figma.ui.postMessage({ type: "import-result", success: false, filename: msg.filename, message: String(e) });
    }
  }
};

// ── Import helpers ────────────────────────────────────────────────────────────

function findOrCreateCollection(name) {
  var cols = figma.variables.getLocalVariableCollections();
  for (var i = 0; i < cols.length; i++) {
    if (cols[i].name === name) return cols[i];
  }
  return figma.variables.createVariableCollection(name);
}

function buildVarMap(collection) {
  var map = {};
  var all = figma.variables.getLocalVariables();
  for (var i = 0; i < all.length; i++) {
    if (all[i].variableCollectionId === collection.id) {
      map[all[i].name] = all[i];
    }
  }
  return map;
}

function getOrCreateVar(name, collection, type, varMap) {
  if (varMap[name] && varMap[name].resolvedType === type) return varMap[name];
  var v = figma.variables.createVariable(name, collection, type);
  varMap[name] = v;
  return v;
}

function dtcgToFigmaColor(val) {
  return {
    r: val.components[0],
    g: val.components[1],
    b: val.components[2],
    a: val.alpha !== undefined ? val.alpha : 1
  };
}

function detectType(filename) {
  var fn = filename.toLowerCase();
  if (fn.indexOf("primitive") !== -1) return "primitives";
  if (fn.indexOf("dark")      !== -1) return "colors-dark";
  if (fn.indexOf("light")     !== -1) return "colors-light";
  if (fn.indexOf("color")     !== -1 || fn.indexOf("colour") !== -1) return "colors-light";
  if (fn.indexOf("spacing")   !== -1) return "spacing";
  if (fn.indexOf("typography")!== -1) return "typography";
  if (fn.indexOf("radius")    !== -1) return "radius";
  if (fn.indexOf("border")    !== -1) return "border";
  if (fn.indexOf("shadow")    !== -1) return "shadows";
  if (fn.indexOf("z-index")   !== -1) return "zindex";
  if (fn.indexOf("breakpoint")!== -1) return "breakpoints";
  return "unknown";
}

function importTokens(filename, data) {
  var type = detectType(filename);
  var count = 0;

  if      (type === "primitives")   count = importPrimitives(data);
  else if (type === "colors-light") count = importColors(data, "Light");
  else if (type === "colors-dark")  count = importColors(data, "Dark");
  else if (type === "spacing")      count = importFlat(data, "Spacing",     "spacing",    true);
  else if (type === "radius")       count = importFlat(data, "Radius",      "radius",     true);
  else if (type === "border")       count = importFlat(data, "Border Width","border",     true);
  else if (type === "zindex")       count = importFlat(data, "Z-Index",     "z-index",    false);
  else if (type === "breakpoints")  count = importFlat(data, "Breakpoints", "breakpoint", false);
  else if (type === "shadows")      count = importShadows(data);
  else if (type === "typography")   count = importTypography(data);
  else throw new Error("Cannot detect type from \"" + filename + "\". Keep original filenames (e.g. colors-light.json, spacing.json).");

  return "Imported " + count + " variable" + (count !== 1 ? "s" : "");
}

function importPrimitives(data) {
  var col    = findOrCreateCollection("Primitives");
  var modeId = col.modes[0].modeId;
  col.renameMode(modeId, "Value");
  var varMap = buildVarMap(col);
  var count  = 0;

  Object.keys(data).forEach(function(groupKey) {
    var group = data[groupKey];
    if (!group || typeof group !== "object" || group["$value"] !== undefined) return;
    Object.keys(group).forEach(function(shadeKey) {
      var token = group[shadeKey];
      if (!token || token["$value"] === undefined) return;
      if (token["$type"] !== "color") return;
      try {
        var v = getOrCreateVar(groupKey + "/" + shadeKey, col, "COLOR", varMap);
        v.setValueForMode(modeId, dtcgToFigmaColor(token["$value"]));
        count++;
      } catch(e) {}
    });
  });
  return count;
}

function importColors(data, modeName) {
  var col    = findOrCreateCollection("Colors");
  var modeId = null;

  for (var i = 0; i < col.modes.length; i++) {
    if (col.modes[i].name === modeName) { modeId = col.modes[i].modeId; break; }
  }
  if (!modeId) {
    if (col.modes.length === 1 && col.modes[0].name === "Mode 1") {
      col.renameMode(col.modes[0].modeId, modeName);
      modeId = col.modes[0].modeId;
    } else {
      modeId = col.addMode(modeName);
    }
  }

  var varMap = buildVarMap(col);
  var count  = 0;

  Object.keys(data).forEach(function(groupKey) {
    var group = data[groupKey];
    if (!group || typeof group !== "object" || group["$value"] !== undefined) return;
    Object.keys(group).forEach(function(tokenKey) {
      var token = group[tokenKey];
      if (!token || token["$value"] === undefined) return;
      if (token["$type"] !== "color") return;
      try {
        var v = getOrCreateVar(groupKey + "/" + tokenKey, col, "COLOR", varMap);
        v.setValueForMode(modeId, dtcgToFigmaColor(token["$value"]));
        count++;
      } catch(e) {}
    });
  });
  return count;
}

function importFlat(data, collectionName, prefix, isDimension) {
  var col    = findOrCreateCollection(collectionName);
  var modeId = col.modes[0].modeId;
  col.renameMode(modeId, "Value");
  var varMap = buildVarMap(col);
  var count  = 0;

  Object.keys(data).forEach(function(key) {
    var token = data[key];
    if (!token || token["$value"] === undefined) return;
    try {
      var raw    = token["$value"];
      var numVal = isDimension && typeof raw === "object" ? raw.value : parseFloat(raw) || 0;
      var v      = getOrCreateVar(prefix + "/" + key, col, "FLOAT", varMap);
      v.setValueForMode(modeId, numVal);
      count++;
    } catch(e) {}
  });
  return count;
}

function importShadows(data) {
  var col    = findOrCreateCollection("Shadows");
  var modeId = col.modes[0].modeId;
  col.renameMode(modeId, "Value");
  var varMap = buildVarMap(col);
  var count  = 0;

  Object.keys(data).forEach(function(key) {
    var token = data[key];
    if (!token || token["$value"] === undefined) return;
    try {
      var v = getOrCreateVar("shadow/" + key, col, "STRING", varMap);
      v.setValueForMode(modeId, String(token["$value"]));
      count++;
    } catch(e) {}
  });
  return count;
}

function importTypography(data) {
  var col    = findOrCreateCollection("Typography");
  var modeId = col.modes[0].modeId;
  col.renameMode(modeId, "Value");
  var varMap = buildVarMap(col);
  var count  = 0;

  Object.keys(data).forEach(function(groupKey) {
    var group = data[groupKey];
    if (!group || typeof group !== "object") return;
    Object.keys(group).forEach(function(key) {
      var token = group[key];
      if (!token || token["$value"] === undefined) return;
      try {
        var varName = groupKey + "/" + key;
        var val     = token["$value"];
        if (token["$type"] === "fontFamily") {
          var v = getOrCreateVar(varName, col, "STRING", varMap);
          v.setValueForMode(modeId, String(val));
          count++;
        } else if (token["$type"] === "dimension") {
          var num = typeof val === "object" ? val.value : parseFloat(val) || 0;
          var v   = getOrCreateVar(varName, col, "FLOAT", varMap);
          v.setValueForMode(modeId, num);
          count++;
        } else if (token["$type"] === "number") {
          var v = getOrCreateVar(varName, col, "FLOAT", varMap);
          v.setValueForMode(modeId, parseFloat(val) || 0);
          count++;
        }
      } catch(e) {}
    });
  });
  return count;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

var DEFAULT_NAME_RE = /^(Frame|Rectangle|Ellipse|Polygon|Star|Vector|Line|Arrow|Text|Group|Component|Instance|Image|Section|Slice)(\s+\d+)?$/i;

function isDefaultName(name) { return DEFAULT_NAME_RE.test(name.trim()); }

function rgbToHex(c) {
  return "#" + [c.r, c.g, c.b].map(function(v) {
    return Math.round(v * 255).toString(16).padStart(2, "0");
  }).join("");
}

function getPath(node) {
  var parts = [];
  var n = node.parent;
  while (n && n.type !== "PAGE" && n.type !== "DOCUMENT") { parts.unshift(n.name); n = n.parent; }
  return parts.length ? parts.join(" › ") : "Page root";
}

function trunc(str, len) {
  len = len || 38;
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

function runAudit() {
  var page = figma.currentPage;
  var checks = {
    naming:     { label:"Layer Naming",      description:"Layers still using default Figma names",           icon:"tag",     issues:[] },
    autoLayout: { label:"Auto Layout",       description:"Frames with 2+ children not using Auto Layout",    icon:"layout",  issues:[] },
    colors:     { label:"Color Variables",   description:"Solid fills or strokes not bound to a variable",   icon:"palette", issues:[] },
    textStyles: { label:"Text Styles",       description:"Text layers not using a text style",               icon:"type",    issues:[] },
    hidden:     { label:"Hidden Layers",     description:"Invisible layers — may be forgotten",              icon:"eye-off", issues:[] },
    empty:      { label:"Empty Containers",  description:"Frames or groups with no children",                icon:"box",     issues:[] },
  };

  var totalNodes = 0;

  function walk(node, depth) {
    totalNodes++;

    if (isDefaultName(node.name)) {
      checks.naming.issues.push({ id:node.id, label:node.type + ": \"" + node.name + "\"", path:getPath(node) });
    }

    if (
      (node.type === "FRAME" || node.type === "COMPONENT") &&
      node.layoutMode === "NONE" &&
      "children" in node &&
      node.children.length >= 2
    ) {
      checks.autoLayout.issues.push({ id:node.id, label:"\"" + trunc(node.name) + "\" — " + node.children.length + " children", path:getPath(node) });
    }

    if ("fills" in node && Array.isArray(node.fills)) {
      node.fills.forEach(function(fill, i) {
        if (fill.type === "SOLID" && fill.visible !== false) {
          var bound = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[i];
          if (!bound) {
            checks.colors.issues.push({ id:node.id, label:"\"" + trunc(node.name) + "\" fill: " + rgbToHex(fill.color), path:getPath(node) });
          }
        }
      });
    }

    if ("strokes" in node && Array.isArray(node.strokes)) {
      node.strokes.forEach(function(stroke, i) {
        if (stroke.type === "SOLID" && stroke.visible !== false && (node.strokeWeight || 0) > 0) {
          var bound = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[i];
          if (!bound) {
            checks.colors.issues.push({ id:node.id, label:"\"" + trunc(node.name) + "\" stroke: " + rgbToHex(stroke.color), path:getPath(node) });
          }
        }
      });
    }

    if (node.type === "TEXT" && !node.textStyleId) {
      checks.textStyles.issues.push({ id:node.id, label:"\"" + trunc(node.characters || node.name, 42) + "\"", path:getPath(node) });
    }

    if (depth <= 4 && node.visible === false) {
      checks.hidden.issues.push({ id:node.id, label:node.type + ": \"" + trunc(node.name) + "\"", path:getPath(node) });
    }

    if (
      (node.type === "FRAME" || node.type === "GROUP") &&
      "children" in node &&
      node.children.length === 0
    ) {
      checks.empty.issues.push({ id:node.id, label:node.type + ": \"" + trunc(node.name) + "\"", path:getPath(node) });
    }

    if ("children" in node && node.children) {
      node.children.forEach(function(child) { walk(child, depth + 1); });
    }
  }

  page.children.forEach(function(n) { walk(n, 0); });

  var totalIssues = Object.keys(checks).reduce(function(s, k) { return s + checks[k].issues.length; }, 0);
  var penalty     = Math.min(totalIssues / Math.max(totalNodes, 1), 1);
  var score       = Math.max(0, Math.round(100 - penalty * 200));

  return { checks:checks, totalNodes:totalNodes, totalIssues:totalIssues, score:score };
}