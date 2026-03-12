figma.showUI(__html__, { width: 460, height: 680, title: "Is it ready for dev?" });

// ── Push debug data on every selection change ─────────────────────────────────
figma.on("selectionchange", function() { pushDebugData(); });

function pushDebugData() {
  var sel = figma.currentPage.selection;
  if (sel.length === 1) {
    figma.ui.postMessage({ type: "debug-data", data: buildDebugData(sel[0]) });
  } else {
    figma.ui.postMessage({ type: "debug-data", data: null, selCount: sel.length });
  }
}

// ── Message router ────────────────────────────────────────────────────────────
figma.ui.onmessage = function(msg) {
  if (msg.type === "run-audit") {
    figma.ui.postMessage({ type: "audit-results", results: runAudit() });
  }
  if (msg.type === "focus-node") {
    var node = figma.getNodeById(msg.id);
    if (node) { figma.currentPage.selection = [node]; figma.viewport.scrollAndZoomIntoView([node]); }
  }
  if (msg.type === "run-fixes") {
    var stats = runFixes(msg.fixes);
    figma.ui.postMessage({ type: "fix-done", stats: stats, audit: runAudit() });
  }
  if (msg.type === "import-tokens") {
    try {
      figma.ui.postMessage({ type: "import-result", success: true, filename: msg.filename, message: importTokens(msg.filename, msg.data) });
    } catch(e) {
      figma.ui.postMessage({ type: "import-result", success: false, filename: msg.filename, message: String(e) });
    }
  }
  if (msg.type === "request-debug") { pushDebugData(); }
};

// ── Token Debugger ────────────────────────────────────────────────────────────

function rgb01ToHex(r, g, b) {
  return "#" + [r, g, b].map(function(v) {
    return Math.round(Math.min(255, Math.max(0, v * 255))).toString(16).padStart(2, "0");
  }).join("").toUpperCase();
}

function resolveChain(variableId) {
  var chain = [], currentId = variableId, maxSteps = 12, seen = {};
  while (currentId && maxSteps-- > 0) {
    if (seen[currentId]) { chain.push({ name: "⚠ Circular reference", broken: true }); break; }
    seen[currentId] = true;
    var v = figma.variables.getVariableById(currentId);
    if (!v) { chain.push({ name: "Broken reference — variable deleted or renamed", broken: true }); break; }
    var col    = figma.variables.getVariableCollectionById(v.variableCollectionId);
    var colName = col ? col.name : "?";
    var modeId  = col && col.modes && col.modes.length > 0 ? col.modes[0].modeId : null;
    var val     = modeId && v.valuesByMode ? v.valuesByMode[modeId] : null;
    if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") {
      chain.push({ name: v.name, collection: colName, isAlias: true, resolvedType: v.resolvedType });
      currentId = val.id;
    } else {
      var display = null, hexColor = null;
      if (v.resolvedType === "COLOR" && val) {
        hexColor = rgb01ToHex(val.r || 0, val.g || 0, val.b || 0);
        var a = val.a !== undefined ? val.a : 1;
        display = hexColor + (a < 1 ? " / " + Math.round(a * 100) + "%" : "");
      } else if (v.resolvedType === "FLOAT") {
        display = String(Math.round((Number(val) || 0) * 100) / 100);
      } else if (v.resolvedType === "STRING") {
        var s = String(val); display = s.length > 44 ? s.slice(0, 44) + "…" : s;
      } else if (v.resolvedType === "BOOLEAN") {
        display = String(val);
      }
      chain.push({ name: v.name, collection: colName, isAlias: false, resolvedType: v.resolvedType, displayValue: display, hexColor: hexColor });
      break;
    }
  }
  return chain;
}

function buildDebugData(node) {
  var bv = node.boundVariables || {};
  var groups = [];

  function getGroup(name, icon) {
    for (var i = 0; i < groups.length; i++) { if (groups[i].name === name) return groups[i]; }
    var g = { name: name, icon: icon, props: [] }; groups.push(g); return g;
  }
  function addBound(gn, icon, label, varId) {
    getGroup(gn, icon).props.push({ label: label, chain: resolveChain(varId), unbound: false, isStyle: false });
  }
  function addUnbound(gn, icon, label, rawVal) {
    getGroup(gn, icon).props.push({ label: label, chain: null, unbound: true, rawValue: rawVal, isStyle: false });
  }
  function addStyle(gn, icon, label, styleName) {
    getGroup(gn, icon).props.push({ label: label, chain: null, unbound: false, isStyle: true, styleName: styleName });
  }

  // Fills
  if ("fills" in node && Array.isArray(node.fills)) {
    node.fills.forEach(function(fill, i) {
      if (fill.visible === false) return;
      var lbl = node.fills.length > 1 ? "Fill " + (i + 1) : "Fill";
      var fbv = bv.fills && bv.fills[i];
      if (fbv && fbv.id)                         { addBound("Color", "🎨", lbl, fbv.id); }
      else if (fill.type === "SOLID")             { addUnbound("Color", "🎨", lbl, rgb01ToHex(fill.color.r, fill.color.g, fill.color.b)); }
      else if (fill.type.indexOf("GRADIENT") !== -1) { addUnbound("Color", "🎨", lbl, "Gradient"); }
      else if (fill.type === "IMAGE")             { addUnbound("Color", "🎨", lbl, "Image fill"); }
    });
  }

  // Strokes
  if ("strokes" in node && Array.isArray(node.strokes) && (node.strokeWeight || 0) > 0) {
    node.strokes.forEach(function(stroke, i) {
      if (stroke.visible === false) return;
      var lbl = node.strokes.length > 1 ? "Stroke " + (i + 1) : "Stroke";
      var sbv = bv.strokes && bv.strokes[i];
      if (sbv && sbv.id)              { addBound("Color", "🎨", lbl, sbv.id); }
      else if (stroke.type === "SOLID") { addUnbound("Color", "🎨", lbl, rgb01ToHex(stroke.color.r, stroke.color.g, stroke.color.b)); }
    });
  }

  // Opacity
  if ("opacity" in node && node.opacity < 1 && node.opacity >= 0) {
    if (bv.opacity && bv.opacity.id) { addBound("Color", "🎨", "Opacity", bv.opacity.id); }
    else { addUnbound("Color", "🎨", "Opacity", Math.round(node.opacity * 100) + "%"); }
  }

  // Corner radius
  if ("cornerRadius" in node && node.cornerRadius !== figma.mixed && node.cornerRadius > 0) {
    if (bv.cornerRadius && bv.cornerRadius.id) { addBound("Shape", "⬜", "Corner Radius", bv.cornerRadius.id); }
    else { addUnbound("Shape", "⬜", "Corner Radius", node.cornerRadius + "px"); }
  } else {
    var corners = [["topLeftRadius","↖ Top Left"],["topRightRadius","↗ Top Right"],["bottomRightRadius","↘ Bottom Right"],["bottomLeftRadius","↙ Bottom Left"]];
    corners.forEach(function(c) {
      var prop = c[0], lbl = c[1];
      if (!(prop in node) || !node[prop] || node[prop] === figma.mixed) return;
      if (bv[prop] && bv[prop].id) { addBound("Shape", "⬜", "Radius " + lbl, bv[prop].id); }
      else if (node[prop] > 0) { addUnbound("Shape", "⬜", "Radius " + lbl, node[prop] + "px"); }
    });
  }

  // Dimensions (only if variable-bound)
  if (bv.width  && bv.width.id)  addBound("Size", "📏", "Width",  bv.width.id);
  if (bv.height && bv.height.id) addBound("Size", "📏", "Height", bv.height.id);

  // Auto layout spacing
  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    var sps = [["paddingLeft","Padding Left"],["paddingRight","Padding Right"],
               ["paddingTop","Padding Top"],["paddingBottom","Padding Bottom"],["itemSpacing","Gap"]];
    sps.forEach(function(sp) {
      var prop = sp[0], lbl = sp[1];
      if (!(prop in node) || node[prop] === figma.mixed) return;
      if (bv[prop] && bv[prop].id) { addBound("Spacing", "📐", lbl, bv[prop].id); }
      else if (node[prop] > 0) { addUnbound("Spacing", "📐", lbl, node[prop] + "px"); }
    });
  }

  // Typography
  if (node.type === "TEXT") {
    if (node.textStyleId && node.textStyleId !== figma.mixed) {
      var ts = figma.getStyleById(node.textStyleId);
      if (ts) addStyle("Typography", "✏️", "Text Style", ts.name);
    } else {
      addUnbound("Typography", "✏️", "Text Style", "None — raw values");
    }
    var tps = [["fontSize","Font Size"],["fontFamily","Font Family"],["fontWeight","Font Weight"],
               ["lineHeight","Line Height"],["letterSpacing","Letter Spacing"]];
    tps.forEach(function(tp) {
      if (bv[tp[0]] && bv[tp[0]].id) addBound("Typography", "✏️", tp[1], bv[tp[0]].id);
    });
  }

  // Effects
  if ("effectStyleId" in node && node.effectStyleId) {
    var es = figma.getStyleById(node.effectStyleId);
    if (es) addStyle("Effects", "✨", "Effect Style", es.name);
  } else if ("effects" in node && node.effects && node.effects.length > 0) {
    addUnbound("Effects", "✨", node.effects.length + " effect" + (node.effects.length > 1 ? "s" : ""), "No style bound");
  }

  // Tally
  var totalBound = 0, totalUnbound = 0, totalBroken = 0;
  groups.forEach(function(g) {
    g.props.forEach(function(p) {
      if (p.isStyle) return;
      if (!p.chain) { totalUnbound++; return; }
      if (p.chain.some(function(s) { return s.broken; })) totalBroken++;
      else totalBound++;
    });
  });

  return { id: node.id, name: node.name, type: node.type, groups: groups,
           totalBound: totalBound, totalUnbound: totalUnbound, totalBroken: totalBroken };
}

// ── Audit ─────────────────────────────────────────────────────────────────────
var DEFAULT_NAME_RE = /^(Frame|Rectangle|Ellipse|Polygon|Star|Vector|Line|Arrow|Text|Group|Component|Instance|Image|Section|Slice)(\s+\d+)?$/i;
function isDefaultName(n) { return DEFAULT_NAME_RE.test(n.trim()); }
function rgbToHex(c) {
  return "#" + [c.r,c.g,c.b].map(function(v){ return Math.round(v*255).toString(16).padStart(2,"0"); }).join("");
}
function getPath(node) {
  var parts = [], n = node.parent;
  while (n && n.type !== "PAGE" && n.type !== "DOCUMENT") { parts.unshift(n.name); n = n.parent; }
  return parts.length ? parts.join(" › ") : "Page root";
}
function trunc(s, l) { l=l||38; return s&&s.length>l?s.slice(0,l)+"…":(s||""); }

function generateName(node) {
  if (node.type === "TEXT") return (node.characters && node.characters.trim().slice(0,30)) || "Label";
  if ("children" in node && node.children && node.children.length) {
    for (var i=0; i<node.children.length; i++) {
      var c = node.children[i];
      if (c.type==="TEXT" && c.characters && c.characters.trim()) return c.characters.trim().slice(0,30);
    }
    var types={};
    node.children.forEach(function(c){ types[c.type]=(types[c.type]||0)+1; });
    var dom = Object.keys(types).sort(function(a,b){ return types[b]-types[a]; })[0];
    var dn = { INSTANCE:"Component Group",TEXT:"Text Block",RECTANGLE:"Card",FRAME:"Layout",VECTOR:"Icon Container",IMAGE:"Media" };
    if (dn[dom]) return dn[dom];
  }
  var fn = { FRAME:"Container",GROUP:"Group",RECTANGLE:"Shape",ELLIPSE:"Circle",VECTOR:"Icon",COMPONENT:"Component",INSTANCE:"Instance",IMAGE:"Image",SECTION:"Section",LINE:"Divider" };
  return fn[node.type] || node.type;
}

function getVarColor(v) {
  var col=figma.variables.getVariableCollectionById(v.variableCollectionId);
  if (!col||!col.modes||!col.modes.length) return null;
  var val=v.valuesByMode[col.modes[0].modeId];
  if (!val||typeof val!=="object"||val.type==="VARIABLE_ALIAS") return null;
  return val;
}
function colorDist(a,b) { var dr=a.r-b.r,dg=a.g-b.g,db=a.b-b.b; return Math.sqrt(dr*dr+dg*dg+db*db); }
function findNearestColorVar(color,vars) {
  var best=null,bestDist=0.04;
  for (var i=0;i<vars.length;i++) {
    var vc=getVarColor(vars[i]); if (!vc) continue;
    var d=colorDist(color,vc); if (d<bestDist){bestDist=d;best=vars[i];}
  }
  return best;
}

function mk(label,desc,icon,group) { return { label:label,description:desc,icon:icon,group:group,issues:[] }; }

function runAudit() {
  var page = figma.currentPage;
  var checks = {
    naming:        mk("Default Layer Names",   "Layers using Figma auto-generated names",           "🏷",  "Naming & Structure"),
    duplicates:    mk("Duplicate Layer Names", "Sibling layers sharing the same name",              "👯",  "Naming & Structure"),
    deepNesting:   mk("Deep Nesting",          "Frames or groups nested 6+ levels deep",            "🪆",  "Naming & Structure"),
    autoLayout:    mk("Auto Layout",           "Frames with 2+ children not using Auto Layout",     "⬜",  "Layout"),
    colors:        mk("Color Variables",       "Solid fills/strokes not bound to a variable",       "🎨",  "Variables & Styles"),
    spacingVars:   mk("Spacing Variables",     "Auto layout padding/gap not bound to a variable",   "📐",  "Variables & Styles"),
    radiusVars:    mk("Radius Variables",      "Corner radius not bound to a variable",             "◻️",  "Variables & Styles"),
    opacityVars:   mk("Opacity Variables",     "Non-default opacity not bound to a variable",       "👁️",  "Variables & Styles"),
    textStyles:    mk("Text Styles",           "Text layers not attached to a text style",          "✏️",  "Typography"),
    mixedText:     mk("Mixed Text Styles",     "Text layers with multiple conflicting styles",      "🔀",  "Typography"),
    hidden:        mk("Hidden Layers",         "Invisible layers that may be forgotten",            "🙈",  "Hygiene"),
    empty:         mk("Empty Containers",      "Frames or groups with no children",                 "📦",  "Hygiene"),
    unsavedStyles: mk("Unsaved Effect Styles", "Shadows/blurs not saved as an effect style",        "✨",  "Hygiene"),
  };
  var totalNodes = 0;

  function walk(node, depth) {
    totalNodes++;
    var path = getPath(node);
    if (isDefaultName(node.name)) checks.naming.issues.push({ id:node.id,label:node.type+': "'+node.name+'"',path:path });
    if ("children" in node && node.children && node.children.length > 1) {
      var seen={};
      node.children.forEach(function(child){ if(!seen[child.name])seen[child.name]=[];seen[child.name].push(child); });
      Object.keys(seen).forEach(function(name){ if(seen[name].length>1) checks.duplicates.issues.push({id:seen[name][0].id,label:seen[name].length+'× "'+trunc(name)+'"',path:path+" › "+trunc(node.name,22)}); });
    }
    if (depth>=6&&(node.type==="FRAME"||node.type==="GROUP")) checks.deepNesting.issues.push({id:node.id,label:"Depth "+depth+': "'+trunc(node.name)+'"',path:path});
    if ((node.type==="FRAME"||node.type==="COMPONENT")&&node.layoutMode==="NONE"&&"children"in node&&node.children.length>=2) checks.autoLayout.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.children.length+' children',path:path});
    var bv=node.boundVariables||{};
    if ("fills" in node && Array.isArray(node.fills)) {
      node.fills.forEach(function(fill,i){ if(fill.type==="SOLID"&&fill.visible!==false){var b=bv.fills&&bv.fills[i];if(!b)checks.colors.issues.push({id:node.id,label:'"'+trunc(node.name)+'" fill: '+rgbToHex(fill.color),path:path});} });
    }
    if ("strokes" in node && Array.isArray(node.strokes)) {
      node.strokes.forEach(function(stroke,i){ if(stroke.type==="SOLID"&&stroke.visible!==false&&(node.strokeWeight||0)>0){var b=bv.strokes&&bv.strokes[i];if(!b)checks.colors.issues.push({id:node.id,label:'"'+trunc(node.name)+'" stroke: '+rgbToHex(stroke.color),path:path});} });
    }
    if ((node.type==="FRAME"||node.type==="COMPONENT")&&node.layoutMode!=="NONE") {
      var unboundProps=[];
      ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"].forEach(function(prop){ if(!(prop in node))return;var val=node[prop];if(val===figma.mixed||!val||val<=0)return;var b=bv[prop];if(!b)unboundProps.push(prop.replace(/([A-Z])/g," $1").toLowerCase()); });
      if(unboundProps.length)checks.spacingVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+unboundProps.join(", "),path:path});
    }
    if ("cornerRadius" in node&&node.cornerRadius!==figma.mixed&&node.cornerRadius>0){var b=bv.cornerRadius;if(!b)checks.radiusVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.cornerRadius+'px',path:path});}
    if ("opacity" in node&&node.opacity<1&&node.opacity>0){var b=bv.opacity;if(!b)checks.opacityVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+Math.round(node.opacity*100)+'%',path:path});}
    if (node.type==="TEXT"){var tsId=node.textStyleId;if(tsId===figma.mixed)checks.mixedText.issues.push({id:node.id,label:'"'+trunc(node.characters||node.name,42)+'"',path:path});else if(!tsId)checks.textStyles.issues.push({id:node.id,label:'"'+trunc(node.characters||node.name,42)+'"',path:path});}
    if (depth<=6&&node.visible===false)checks.hidden.issues.push({id:node.id,label:node.type+': "'+trunc(node.name)+'"',path:path});
    if ((node.type==="FRAME"||node.type==="GROUP")&&"children"in node&&node.children.length===0)checks.empty.issues.push({id:node.id,label:node.type+': "'+trunc(node.name)+'"',path:path});
    if ("effects"in node&&node.effects&&node.effects.length>0&&!node.effectStyleId)checks.unsavedStyles.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.effects.length+' effect(s)',path:path});
    if ("children" in node && node.children) node.children.forEach(function(child){ walk(child,depth+1); });
  }

  page.children.forEach(function(n){ walk(n,0); });

  var WEIGHTS = {
    autoLayout:5,colors:5,textStyles:5,spacingVars:5,naming:5,
    mixedText:4,radiusVars:4,
    duplicates:3,deepNesting:3,unsavedStyles:3,
    opacityVars:2,hidden:2,
    empty:1
  };
  function issuePenalty(count,weight){ if(!count)return 0;var s=count<=2?.12:count<=5?.30:count<=10?.52:count<=20?.72:.95;return s*weight; }
  var keys=Object.keys(checks);
  var totalWeight=keys.reduce(function(s,k){return s+(WEIGHTS[k]||1);},0);
  var totalPenalty=keys.reduce(function(s,k){return s+issuePenalty(checks[k].issues.length,WEIGHTS[k]||1);},0);
  var score=Math.max(0,Math.round(100-(totalPenalty/totalWeight)*100));
  var totalIssues=keys.reduce(function(s,k){return s+checks[k].issues.length;},0);
  var hasColorVars=figma.variables.getLocalVariables().some(function(v){return v.resolvedType==="COLOR";});
  var fixable={naming:checks.naming.issues.length,empty:checks.empty.issues.length,hidden:checks.hidden.issues.length,colors:checks.colors.issues.length,hasColorVars:hasColorVars};
  return {checks:checks,totalNodes:totalNodes,totalIssues:totalIssues,score:score,fixable:fixable,weights:WEIGHTS};
}

// ── Fixes ─────────────────────────────────────────────────────────────────────
function runFixes(fixes) {
  var page=figma.currentPage, stats={naming:0,empty:0,hidden:0,colors:0};
  var allNodes=[];
  function collect(node){allNodes.push(node);if("children"in node&&node.children)node.children.forEach(function(c){collect(c);});}
  page.children.forEach(function(n){collect(n);});
  if(fixes.indexOf("hidden")!==-1){allNodes.forEach(function(node){if(node.visible===false){try{node.remove();stats.hidden++;}catch(e){}}});allNodes=[];page.children.forEach(function(n){collect(n);});}
  if(fixes.indexOf("empty")!==-1){allNodes.forEach(function(node){if((node.type==="FRAME"||node.type==="GROUP")&&"children"in node&&node.children.length===0){try{node.remove();stats.empty++;}catch(e){}}});allNodes=[];page.children.forEach(function(n){collect(n);});}
  if(fixes.indexOf("naming")!==-1){allNodes.forEach(function(node){if(isDefaultName(node.name)){try{node.name=generateName(node);stats.naming++;}catch(e){}}});}
  if(fixes.indexOf("colors")!==-1){
    var colorVars=figma.variables.getLocalVariables().filter(function(v){return v.resolvedType==="COLOR";});
    if(colorVars.length>0){allNodes.forEach(function(node){if(!("fills"in node)||!Array.isArray(node.fills))return;var changed=false;var newFills=node.fills.map(function(fill,i){if(fill.type!=="SOLID"||fill.visible===false)return fill;var bv=node.boundVariables&&node.boundVariables.fills&&node.boundVariables.fills[i];if(bv)return fill;var nearest=findNearestColorVar(fill.color,colorVars);if(nearest){try{var f=figma.variables.setBoundVariableForPaint(fill,"color",nearest);stats.colors++;changed=true;return f;}catch(e){return fill;}}return fill;});if(changed){try{node.fills=newFills;}catch(e){}}});}
  }
  return stats;
}

// ── Import ────────────────────────────────────────────────────────────────────
function findOrCreateCollection(name){var cols=figma.variables.getLocalVariableCollections();for(var i=0;i<cols.length;i++){if(cols[i].name===name)return cols[i];}return figma.variables.createVariableCollection(name);}
function buildVarMap(col){var map={},all=figma.variables.getLocalVariables();for(var i=0;i<all.length;i++){if(all[i].variableCollectionId===col.id)map[all[i].name]=all[i];}return map;}
function getOrCreateVar(name,col,type,map){if(map[name]&&map[name].resolvedType===type)return map[name];var v=figma.variables.createVariable(name,col,type);map[name]=v;return v;}
function dtcgToFigmaColor(val){return{r:val.components[0],g:val.components[1],b:val.components[2],a:val.alpha!==undefined?val.alpha:1};}
function detectType(fn){fn=fn.toLowerCase();if(fn.indexOf("primitive")!=-1)return"primitives";if(fn.indexOf("dark")!=-1)return"colors-dark";if(fn.indexOf("light")!=-1)return"colors-light";if(fn.indexOf("color")!=-1||fn.indexOf("colour")!=-1)return"colors-light";if(fn.indexOf("spacing")!=-1)return"spacing";if(fn.indexOf("typography")!=-1)return"typography";if(fn.indexOf("radius")!=-1)return"radius";if(fn.indexOf("border")!=-1)return"border";if(fn.indexOf("shadow")!=-1)return"shadows";if(fn.indexOf("z-index")!=-1)return"zindex";if(fn.indexOf("breakpoint")!=-1)return"breakpoints";return"unknown";}
function importTokens(filename,data){var type=detectType(filename),count=0;if(type==="primitives")count=importPrimitives(data);else if(type==="colors-light")count=importColors(data,"Light");else if(type==="colors-dark")count=importColors(data,"Dark");else if(type==="spacing")count=importFlat(data,"Spacing","spacing",true);else if(type==="radius")count=importFlat(data,"Radius","radius",true);else if(type==="border")count=importFlat(data,"Border Width","border",true);else if(type==="zindex")count=importFlat(data,"Z-Index","z-index",false);else if(type==="breakpoints")count=importFlat(data,"Breakpoints","breakpoint",false);else if(type==="shadows")count=importShadows(data);else if(type==="typography")count=importTypography(data);else throw new Error('Cannot detect type from "'+filename+'". Keep original filenames.');return"Imported "+count+" variable"+(count!==1?"s":"");}
function importPrimitives(data){var col=findOrCreateCollection("Primitives"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object"||g["$value"]!==undefined)return;Object.keys(g).forEach(function(sk){var t=g[sk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+sk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return count;}
function importColors(data,modeName){var col=findOrCreateCollection("Colors"),modeId=null;for(var i=0;i<col.modes.length;i++){if(col.modes[i].name===modeName){modeId=col.modes[i].modeId;break;}}if(!modeId){if(col.modes.length===1&&col.modes[0].name==="Mode 1"){col.renameMode(col.modes[0].modeId,modeName);modeId=col.modes[0].modeId;}else modeId=col.addMode(modeName);}var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object"||g["$value"]!==undefined)return;Object.keys(g).forEach(function(tk){var t=g[tk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+tk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return count;}
function importFlat(data,colName,prefix,isDim){var col=findOrCreateCollection(colName),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(key){var t=data[key];if(!t||t["$value"]===undefined)return;try{var raw=t["$value"],num=isDim&&typeof raw==="object"?raw.value:parseFloat(raw)||0;var v=getOrCreateVar(prefix+"/"+key,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}catch(e){}});return count;}
function importShadows(data){var col=findOrCreateCollection("Shadows"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(key){var t=data[key];if(!t||t["$value"]===undefined)return;try{var v=getOrCreateVar("shadow/"+key,col,"STRING",map);v.setValueForMode(modeId,String(t["$value"]));count++;}catch(e){}});return count;}
function importTypography(data){var col=findOrCreateCollection("Typography"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object")return;Object.keys(g).forEach(function(key){var t=g[key];if(!t||t["$value"]===undefined)return;try{var vn=gk+"/"+key,val=t["$value"];if(t["$type"]==="fontFamily"){var v=getOrCreateVar(vn,col,"STRING",map);v.setValueForMode(modeId,String(val));count++;}else if(t["$type"]==="dimension"){var num=typeof val==="object"?val.value:parseFloat(val)||0;var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}else if(t["$type"]==="number"){var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,parseFloat(val)||0);count++;}}catch(e){}});});return count;}