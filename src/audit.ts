// Audit & debug system
import { rgb01ToHex, resolveChain, hexToFigma, getAuditPages } from './utils';

export function pushDebugData() {
  var sel = figma.currentPage.selection;
  if (sel.length === 1) figma.ui.postMessage({ type:"debug-data", data:buildDebugData(sel[0]) });
  else figma.ui.postMessage({ type:"debug-data", data:null, selCount:sel.length });
}

export function buildDebugData(node) {
  var bv=node.boundVariables||{},groups=[];
  function getGroup(name,icon){for(var i=0;i<groups.length;i++){if(groups[i].name===name)return groups[i];}var g={name:name,icon:icon,props:[]};groups.push(g);return g;}
  function addBound(gn,icon,label,varId){getGroup(gn,icon).props.push({label:label,chain:resolveChain(varId),unbound:false,isStyle:false});}
  function addUnbound(gn,icon,label,rawVal){getGroup(gn,icon).props.push({label:label,chain:null,unbound:true,rawValue:rawVal,isStyle:false});}
  function addStyle(gn,icon,label,styleName){getGroup(gn,icon).props.push({label:label,chain:null,unbound:false,isStyle:true,styleName:styleName});}
  if("fills" in node&&Array.isArray(node.fills)){node.fills.forEach(function(fill,i){if(fill.visible===false)return;var lbl=node.fills.length>1?"Fill "+(i+1):"Fill";var fbv=bv.fills&&bv.fills[i];if(fbv&&fbv.id)addBound("Color","🎨",lbl,fbv.id);else if(fill.type==="SOLID")addUnbound("Color","🎨",lbl,rgb01ToHex(fill.color.r,fill.color.g,fill.color.b));else if(fill.type.indexOf("GRADIENT")!==-1)addUnbound("Color","🎨",lbl,"Gradient");else if(fill.type==="IMAGE")addUnbound("Color","🎨",lbl,"Image fill");});}
  if("strokes" in node&&Array.isArray(node.strokes)&&(node.strokeWeight||0)>0){node.strokes.forEach(function(stroke,i){if(stroke.visible===false)return;var lbl=node.strokes.length>1?"Stroke "+(i+1):"Stroke";var sbv=bv.strokes&&bv.strokes[i];if(sbv&&sbv.id)addBound("Color","🎨",lbl,sbv.id);else if(stroke.type==="SOLID")addUnbound("Color","🎨",lbl,rgb01ToHex(stroke.color.r,stroke.color.g,stroke.color.b));});}
  if("opacity" in node&&node.opacity<1&&node.opacity>=0){if(bv.opacity&&bv.opacity.id)addBound("Color","🎨","Opacity",bv.opacity.id);else addUnbound("Color","🎨","Opacity",Math.round(node.opacity*100)+"%");}
  if("cornerRadius" in node&&node.cornerRadius!==figma.mixed&&node.cornerRadius>0){if(bv.cornerRadius&&bv.cornerRadius.id)addBound("Shape","⬜","Corner Radius",bv.cornerRadius.id);else addUnbound("Shape","⬜","Corner Radius",node.cornerRadius+"px");}
  else{var corners=[["topLeftRadius","↖ TL"],["topRightRadius","↗ TR"],["bottomRightRadius","↘ BR"],["bottomLeftRadius","↙ BL"]];corners.forEach(function(c){if(!(c[0] in node)||!node[c[0]]||node[c[0]]===figma.mixed)return;if(bv[c[0]]&&bv[c[0]].id)addBound("Shape","⬜","Radius "+c[1],bv[c[0]].id);else if(node[c[0]]>0)addUnbound("Shape","⬜","Radius "+c[1],node[c[0]]+"px");});}
  if(bv.width&&bv.width.id)addBound("Size","📏","Width",bv.width.id);
  if(bv.height&&bv.height.id)addBound("Size","📏","Height",bv.height.id);
  if("layoutMode" in node&&node.layoutMode!=="NONE"){var sps=[["paddingLeft","Pad Left"],["paddingRight","Pad Right"],["paddingTop","Pad Top"],["paddingBottom","Pad Bottom"],["itemSpacing","Gap"]];sps.forEach(function(sp){if(!(sp[0] in node)||node[sp[0]]===figma.mixed)return;if(bv[sp[0]]&&bv[sp[0]].id)addBound("Spacing","📐",sp[1],bv[sp[0]].id);else if(node[sp[0]]>0)addUnbound("Spacing","📐",sp[1],node[sp[0]]+"px");});}
  if(node.type==="TEXT"){if(node.textStyleId&&node.textStyleId!==figma.mixed){var ts=figma.getStyleById(node.textStyleId);if(ts)addStyle("Typography","✏️","Text Style",ts.name);}else addUnbound("Typography","✏️","Text Style","None — raw values");var tps=[["fontSize","Font Size"],["fontFamily","Font Family"],["fontWeight","Font Weight"],["lineHeight","Line Height"],["letterSpacing","Letter Spacing"]];tps.forEach(function(tp){if(bv[tp[0]]&&bv[tp[0]].id)addBound("Typography","✏️",tp[1],bv[tp[0]].id);});}
  if("effectStyleId" in node&&node.effectStyleId){var es=figma.getStyleById(node.effectStyleId);if(es)addStyle("Effects","✨","Effect Style",es.name);}
  else if("effects" in node&&node.effects&&node.effects.length>0)addUnbound("Effects","✨",node.effects.length+" effect"+(node.effects.length>1?"s":""),"No style bound");
  var totalBound=0,totalUnbound=0,totalBroken=0;
  groups.forEach(function(g){g.props.forEach(function(p){if(p.isStyle)return;if(!p.chain){totalUnbound++;return;}if(p.chain.some(function(s){return s.broken;}))totalBroken++;else totalBound++;});});
  return {id:node.id,name:node.name,type:node.type,groups:groups,totalBound:totalBound,totalUnbound:totalUnbound,totalBroken:totalBroken};
}

export var DEFAULT_NAME_RE=/^(Frame|Rectangle|Ellipse|Polygon|Star|Vector|Line|Arrow|Text|Group|Component|Instance|Image|Section|Slice)(\s+\d+)?$/i;

export function isDefaultName(n){return DEFAULT_NAME_RE.test(n.trim());}

function rgbToHex(c){return "#"+[c.r,c.g,c.b].map(function(v){return Math.round(v*255).toString(16).padStart(2,"0");}).join("");}

export function getPath(node){var parts=[],n=node.parent;while(n&&n.type!=="PAGE"&&n.type!=="DOCUMENT"){parts.unshift(n.name);n=n.parent;}return parts.length?parts.join(" › "):"Page root";}

export function trunc(s,l){l=l||38;return s&&s.length>l?s.slice(0,l)+"…":(s||"");}

// ── Kebab-case helpers ────────────────────────────────────────────────────────
// Convert any string to kebab-case (preserves slash hierarchy for components)
export function toKebab(str) {
  if (!str) return "";
  return str
    .split("/")
    .map(function(seg) {
      return seg
        .replace(/([a-z0-9])([A-Z])/g, "$1-$2")    // camelCase split: heroSection → hero-Section
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")  // ACRONYMWord split: XMLParser → XML-Parser
        .replace(/[\s_]+/g, "-")                     // spaces & underscores to hyphens
        .replace(/[^a-zA-Z0-9-]/g, "")              // strip remaining special chars
        .replace(/--+/g, "-")                        // collapse double hyphens
        .replace(/^-|-$/g, "")                       // trim leading/trailing hyphens
        .toLowerCase();
    })
    .filter(function(s) { return s.length > 0; })
    .join("/");
}

// Returns the violation type string, or null if name is valid
// Components (COMPONENT/INSTANCE) use Title/Pascal slash segments — skip them
export function getKebabViolation(node) {
  var name = node.name;
  if (isDefaultName(name)) return null;                // default names handled by separate check
  if (node.type === "COMPONENT" || node.type === "INSTANCE") return null; // components have own convention
  if (node.type === "SECTION") return null;            // Figma sections are org tools, relax rule
  // Skip children of mask groups — they're clipping mechanics, not semantic layers
  if (node.parent && "children" in node.parent &&
      node.parent.children.some(function(c) { return c.isMask; })) return null;
  // Skip text layers whose name is derived from their content — Figma auto-sets this,
  // normalizing newlines to spaces and truncating. Collapse all whitespace before comparing
  // so newline vs space differences don't cause false positives.
  if (node.type === "TEXT" && node.characters) {
    var normName  = node.name.trim().replace(/\s+/g, " ");
    var normChars = node.characters.trim().replace(/\s+/g, " ");
    if (normChars.startsWith(normName)) return null;
  }
  var segments = name.split("/");
  for (var i = 0; i < segments.length; i++) {
    var seg = segments[i];
    if (!seg) return "empty segment";
    if (/[A-Z]/.test(seg) && /^[A-Z]/.test(seg)) return "PascalCase";
    if (/[A-Z]/.test(seg)) return "camelCase or mixed caps";
    if (/\s/.test(seg)) return "spaces in name";
    if (/_/.test(seg)) return "snake_case";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(seg)) return "invalid characters";
  }
  return null;
}

// Suggest a proper kebab-case name based on layer content, structure and context
export function generateName(node) {
  var parentIsPage = node.parent && node.parent.type === "PAGE";
  var parentName   = node.parent && node.parent.name ? toKebab(node.parent.name.split("/")[0]) : "";

  // ── Helpers ───────────────────────────────────────────────────────────────
  // Collect ALL text content in a subtree, shortest first (most likely labels)
  function collectTexts(n, out, depth) {
    if (!out) out = []; if (!depth) depth = 0; if (depth > 4) return out;
    if (n.type === "TEXT" && n.characters && n.characters.trim()) {
      var t = n.characters.trim().replace(/\s+/g, " ");
      if (t.length <= 32) out.push(t);
    }
    if ("children" in n && n.children) {
      n.children.forEach(function(c) { collectTexts(c, out, depth + 1); });
    }
    return out;
  }
  // Pick the most useful text: prefer short strings (button labels, headings)
  // over long body copy
  function bestText(texts) {
    if (!texts || !texts.length) return null;
    var sorted = texts.slice().sort(function(a, b) { return a.length - b.length; });
    return sorted[0];
  }
  // Convert text content to a kebab prefix, stripping punctuation noise
  function textToPrefix(str) {
    if (!str) return null;
    var k = toKebab(str.replace(/[^a-zA-Z0-9\s-]/g, " ").replace(/\s+/g, " ").trim());
    // Truncate to max 3 meaningful words
    var parts = k.split("-").filter(function(p) { return p.length > 1; });
    return parts.slice(0, 3).join("-") || null;
  }
  // Check if any node in subtree has an image fill
  function hasImageFill(n) {
    if (n.fills && Array.isArray(n.fills) && n.fills.some(function(f) { return f.type === "IMAGE"; })) return true;
    if ("children" in n && n.children) return n.children.some(function(c) { return hasImageFill(c); });
    return false;
  }
  // Count child types at direct level
  function childTypes(n) {
    var t = {};
    if ("children" in n && n.children) n.children.forEach(function(c) { t[c.type] = (t[c.type] || 0) + 1; });
    return t;
  }
  function dominant(types) {
    return Object.keys(types).sort(function(a, b) { return types[b] - types[a]; })[0] || null;
  }

  // ── TEXT node ─────────────────────────────────────────────────────────────
  if (node.type === "TEXT") {
    var chars = node.characters && node.characters.trim();
    if (chars) {
      var fs = node.fontSize !== figma.mixed ? node.fontSize : null;
      var fw = node.fontWeight !== figma.mixed ? node.fontWeight : null;
      var prefix = textToPrefix(chars);
      if (fs >= 36 || fw >= 700) return (prefix || "heading") + "-heading";
      if (fs >= 24)              return (prefix || "subheading") + "-subheading";
      if (fs >= 16)              return (prefix || "body") + "-text";
      if (fs <= 12)              return (prefix || "caption") + "-caption";
      return (prefix || "label") + "-text";
    }
    return "label-text";
  }

  // ── Simple shapes ─────────────────────────────────────────────────────────
  if (node.type === "LINE") return "divider";
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") return "icon";
  if (node.type === "ELLIPSE") {
    // Ellipse with image fill = avatar
    if (hasImageFill(node)) return "avatar-image";
    return "circle";
  }
  if (node.type === "RECTANGLE") {
    if (hasImageFill(node)) return "image";
    return "shape";
  }

  // ── Frames, Groups, Components ────────────────────────────────────────────
  if (!("children" in node) || !node.children || !node.children.length) {
    return parentIsPage ? "section" : "container";
  }

  var texts   = collectTexts(node);
  var best    = bestText(texts);
  var prefix  = textToPrefix(best);
  var types   = childTypes(node);
  var dom     = dominant(types);
  var kids    = node.children.length;
  var isHoriz = node.layoutMode === "HORIZONTAL";
  var isVert  = node.layoutMode === "VERTICAL";
  var w       = node.width  || 0;
  var h       = node.height || 0;
  var hasImg  = hasImageFill(node);
  var hasVec  = types.VECTOR > 0 || types.BOOLEAN_OPERATION > 0;
  var hasText = types.TEXT > 0 || texts.length > 0;
  var hasInst = types.INSTANCE > 0;

  // ── Top-level page section ────────────────────────────────────────────────
  if (parentIsPage && node.type === "FRAME") {
    return (prefix || "section") + "-section";
  }

  // ── Navigation bar ────────────────────────────────────────────────────────
  // Horizontal with 3+ links/instances and typically wide
  if (isHoriz && kids >= 3 && w > 300 && (hasInst || types.TEXT >= 3)) {
    return (prefix || "nav") + "-bar";
  }

  // ── Button ────────────────────────────────────────────────────────────────
  // Small frame, 1–3 children, has text, optionally an icon, not too tall
  if (kids <= 3 && hasText && h <= 64 && w <= 320) {
    // Check if the only children are text + optional icon
    var nonTextKids = kids - (types.TEXT || 0);
    if (nonTextKids <= 1 && (!nonTextKids || hasVec || hasInst)) {
      return (prefix || "btn") + "-btn";
    }
  }

  // ── Badge / Tag / Chip ────────────────────────────────────────────────────
  if (kids <= 3 && hasText && h <= 36 && w <= 160) {
    return (prefix || "badge") + "-badge";
  }

  // ── Avatar / Profile ──────────────────────────────────────────────────────
  if (types.ELLIPSE && hasText && kids <= 4) {
    return (prefix || "avatar") + "-avatar";
  }
  if (types.ELLIPSE && !hasText && kids <= 2) {
    return "avatar-image";
  }

  // ── Input field ──────────────────────────────────────────────────────────
  // Has a text layer with short content like "Email", "Password", "Search"
  if (hasText && kids <= 5 && h <= 60) {
    var inputHints = ["email","password","search","name","phone","username","url","enter","type","write"];
    var lowerBest = best ? best.toLowerCase() : "";
    for (var ii = 0; ii < inputHints.length; ii++) {
      if (lowerBest.indexOf(inputHints[ii]) !== -1) {
        return "input-" + inputHints[ii];
      }
    }
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  // Has image + text content, or is a self-contained contained block
  if (hasImg && hasText) {
    return (prefix || (parentName || "")) + (prefix ? "-card" : "card");
  }
  if (isVert && hasText && kids >= 2 && kids <= 8 && w <= 480) {
    return (prefix || (parentName || "")) + (prefix ? "-card" : "card");
  }

  // ── Modal / Dialog ────────────────────────────────────────────────────────
  if (!parentIsPage && node.type === "FRAME" && w > 300 && h > 200 && node.layoutMode === "NONE") {
    return (prefix || "modal") + "-modal";
  }

  // ── List ─────────────────────────────────────────────────────────────────
  if (types[dom] >= 3 && (isVert || isHoriz)) {
    if (dom === "INSTANCE") return (prefix || parentName || "item") + "-list";
    if (dom === "FRAME")    return (prefix || parentName || "item") + "-list";
    if (dom === "TEXT")     return (prefix || "text") + "-list";
  }

  // ── Icon container ────────────────────────────────────────────────────────
  if (dom === "VECTOR" || dom === "BOOLEAN_OPERATION") {
    return (prefix || "icon") + (kids > 1 ? "-group" : "");
  }

  // ── Generic wrapper with content hint ────────────────────────────────────
  if (prefix) {
    if (parentIsPage || h > 300) return prefix + "-section";
    return prefix + "-wrapper";
  }

  // ── Parent-name-informed fallback ─────────────────────────────────────────
  if (parentName && !isDefaultName(parentName) && parentName !== "root") {
    // strip common suffixes before re-appending a role
    var stripped = parentName.replace(/-(section|wrapper|container|card|list|group)$/, "");
    return stripped + "-item";
  }

  // ── Last resort type fallback ─────────────────────────────────────────────
  var typeMap = {
    FRAME:     "container",
    GROUP:     "group",
    COMPONENT: "component",
    INSTANCE:  "instance",
    IMAGE:     "image",
    SECTION:   "section"
  };
  return typeMap[node.type] || node.type.toLowerCase();
}

export function getVarColor(v){var col=figma.variables.getVariableCollectionById(v.variableCollectionId);if(!col||!col.modes||!col.modes.length)return null;var val=v.valuesByMode[col.modes[0].modeId];if(!val||typeof val!=="object"||val.type==="VARIABLE_ALIAS")return null;return val;}

export function colorDist(a,b){var dr=a.r-b.r,dg=a.g-b.g,db=a.b-b.b;return Math.sqrt(dr*dr+dg*dg+db*db);}

export function findNearestColorVar(color,vars){var best=null,bestDist=0.04;for(var i=0;i<vars.length;i++){var vc=getVarColor(vars[i]);if(!vc)continue;var d=colorDist(color,vc);if(d<bestDist){bestDist=d;best=vars[i];}}return best;}

function mk(label,desc,icon,group){return{label:label,description:desc,icon:icon,group:group,issues:[]};}

// getAuditPages imported from utils

export function runAudit(){
  var auditPages=getAuditPages();
  if(!auditPages.length) return{checks:{},totalNodes:0,totalIssues:0,score:100,fixable:{},noPages:true};
  var checks={
    naming:        mk("Default Layer Names",     "Layers using Figma auto-generated names",                   "🏷",  "Naming & Structure"),
    namingFormat:  mk("Naming Convention",       "Names not in kebab-case (spaces, caps, underscores)",       "📝",  "Naming & Structure"),
    deepNesting:   mk("Deep Nesting",            "Frames or groups nested 6+ levels deep",                    "🪆",  "Naming & Structure"),
    autoLayout:    mk("Auto Layout",           "Frames with 2+ children not using Auto Layout",     "⬜",  "Layout"),
    fixedSize:     mk("Fixed Sizing",          "Layout containers using fixed width instead of fill", "📏",  "Layout"),
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
  var totalNodes=0;

  // For nodes inside instances, find the corresponding main component node to check its bindings
  function getComponentNode(node) {
    if (!node || !node.parent) return null;
    // Walk up to find the nearest INSTANCE ancestor
    var cur = node;
    var path = [];
    while (cur && cur.type !== "INSTANCE") {
      if (cur.parent && "children" in cur.parent) {
        for (var ci = 0; ci < cur.parent.children.length; ci++) {
          if (cur.parent.children[ci].id === cur.id) { path.unshift(ci); break; }
        }
      }
      cur = cur.parent;
    }
    if (!cur || cur.type !== "INSTANCE") return null;
    var comp = null;
    try { comp = cur.mainComponent; } catch(e) {}
    if (!comp) return null;
    // Walk down the component tree using the same child indices
    var target = comp;
    for (var pi = 0; pi < path.length; pi++) {
      if (!target || !("children" in target) || path[pi] >= target.children.length) return null;
      target = target.children[path[pi]];
    }
    return target;
  }

  // Get bound variables — check node first, fall back to main component node
  function getBV(node, insideInst) {
    var bv = node.boundVariables || {};
    if (!insideInst) return bv;
    // Merge: if instance child has no binding, check the component source
    var compNode = getComponentNode(node);
    if (!compNode) return bv;
    var cbv = compNode.boundVariables || {};
    var merged = {};
    var allKeys = Object.keys(bv).concat(Object.keys(cbv));
    for (var ki = 0; ki < allKeys.length; ki++) {
      var k = allKeys[ki];
      if (!merged[k]) merged[k] = bv[k] || cbv[k];
    }
    return merged;
  }

  // Get text style ID — check node first, fall back to main component node
  function getTsId(node, insideInst) {
    var tsId = node.textStyleId;
    if (tsId && tsId !== "") return tsId;
    if (!insideInst) return tsId;
    var compNode = getComponentNode(node);
    return compNode && compNode.type === "TEXT" ? compNode.textStyleId : tsId;
  }

  // Get effect style ID — check node first, fall back to main component node
  function getEffectStyleId(node, insideInst) {
    var esId = node.effectStyleId;
    if (esId && esId !== "") return esId;
    if (!insideInst) return esId;
    var compNode = getComponentNode(node);
    return compNode ? compNode.effectStyleId : esId;
  }

  function walk(node, depth, insideInst) {
    // Skip component definitions on audit pages — they belong to the component system, not page content
    if(node.type==="COMPONENT_SET"||(!insideInst && node.type==="COMPONENT"))return;
    totalNodes++;
    var path=getPath(node);
    var isInst = insideInst || node.type === "INSTANCE";
    // ── Naming (skip text nodes, skip inside instances) ─────────────────
    if(node.type!=="TEXT" && !insideInst){
      if(isDefaultName(node.name))checks.naming.issues.push({id:node.id,label:node.type+': "'+node.name+'"',path:path,suggestedName:generateName(node)});
      var violation = getKebabViolation(node);
      if(violation)checks.namingFormat.issues.push({id:node.id,label:'"'+trunc(node.name)+'\" — '+violation,path:path,suggestedName:toKebab(node.name)});
    }
    // ── Deep nesting (skip inside instances — component internals don't count) ──
    if(!insideInst && depth>=6&&(node.type==="FRAME"||node.type==="GROUP"))checks.deepNesting.issues.push({id:node.id,label:"Depth "+depth+': "'+trunc(node.name)+'"',path:path});
    if(!insideInst && (node.type==="FRAME"||node.type==="COMPONENT")&&node.layoutMode==="NONE"&&"children"in node&&node.children.length>=2)checks.autoLayout.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.children.length+' children',path:path});
    // ── Fixed sizing: flag layout containers with FIXED width inside auto-layout parents ──
    if(!insideInst && (node.type==="FRAME"||node.type==="COMPONENT") && node.parent && "layoutMode" in node.parent && node.parent.layoutMode !== "NONE") {
      var parentDir = node.parent.layoutMode;
      // Check horizontal sizing: should be FILL in horizontal parent, or always for vertical parent children
      if ("layoutSizingHorizontal" in node && node.layoutSizingHorizontal === "FIXED") {
        // Skip small elements: buttons, icons, images, inputs (width < 200 and not a section-level frame)
        var isSmallElement = node.width < 200 || (node.name && /button|btn|icon|img|image|input|field|logo/i.test(node.name));
        if (!isSmallElement) checks.fixedSize.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — fixed width '+Math.round(node.width)+'px',path:path});
      }
    }
    // ── Variables & styles (resolve from component when inside instance) ──
    var bv=getBV(node, insideInst);
    if("fills"in node&&Array.isArray(node.fills)){node.fills.forEach(function(fill,i){if(fill.type==="SOLID"&&fill.visible!==false){var b=bv.fills&&bv.fills[i];if(!b)checks.colors.issues.push({id:node.id,label:'"'+trunc(node.name)+'" fill: '+rgbToHex(fill.color),path:path});}});}
    if("strokes"in node&&Array.isArray(node.strokes)){node.strokes.forEach(function(stroke,i){if(stroke.type==="SOLID"&&stroke.visible!==false&&(node.strokeWeight||0)>0){var b=bv.strokes&&bv.strokes[i];if(!b)checks.colors.issues.push({id:node.id,label:'"'+trunc(node.name)+'" stroke: '+rgbToHex(stroke.color),path:path});}});}
    if(!insideInst && (node.type==="FRAME"||node.type==="COMPONENT")&&node.layoutMode!=="NONE"){var unboundProps=[];["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"].forEach(function(prop){if(!(prop in node))return;var val=node[prop];if(val===figma.mixed||!val||val<=0)return;var b=bv[prop];if(!b)unboundProps.push(prop.replace(/([A-Z])/g," $1").toLowerCase());});if(unboundProps.length)checks.spacingVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+unboundProps.join(", "),path:path});}
    if("cornerRadius"in node&&node.cornerRadius!==figma.mixed&&node.cornerRadius>0){var b=bv.cornerRadius||bv.topLeftRadius||bv.topRightRadius||bv.bottomLeftRadius||bv.bottomRightRadius;if(!b)checks.radiusVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.cornerRadius+'px',path:path});}
    if("opacity"in node&&node.opacity<1&&node.opacity>0){var b=bv.opacity;if(!b)checks.opacityVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+Math.round(node.opacity*100)+'%',path:path});}
    if(node.type==="TEXT"){var tsId=getTsId(node, insideInst);if(tsId===figma.mixed)checks.mixedText.issues.push({id:node.id,label:'"'+trunc(node.characters||node.name,42)+'"',path:path});else if(!tsId)checks.textStyles.issues.push({id:node.id,label:'"'+trunc(node.characters||node.name,42)+'"',path:path});}
    if("effects"in node&&node.effects&&node.effects.length>0){var esId=getEffectStyleId(node,insideInst);if(!esId)checks.unsavedStyles.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.effects.length+' effect(s)',path:path});}
    if(depth<=6&&node.visible===false)checks.hidden.issues.push({id:node.id,label:node.type+': "'+trunc(node.name)+'"',path:path});
    if((node.type==="FRAME"||node.type==="GROUP")&&"children"in node&&node.children.length===0)checks.empty.issues.push({id:node.id,label:node.type+': "'+trunc(node.name)+'"',path:path});
    if("children"in node&&node.children)node.children.forEach(function(child){walk(child,depth+1,isInst);});
  }
  auditPages.forEach(function(pg){pg.children.forEach(function(n){walk(n,0,false);});});
  var WEIGHTS={autoLayout:5,fixedSize:4,colors:5,textStyles:5,spacingVars:5,naming:5,namingFormat:4,mixedText:4,radiusVars:4,deepNesting:3,unsavedStyles:3,opacityVars:2,hidden:2,empty:1};
  function issuePenalty(count,weight){if(!count)return 0;var s=count<=2?.12:count<=5?.30:count<=10?.52:count<=20?.72:.95;return s*weight;}
  var keys=Object.keys(checks);
  var totalWeight=keys.reduce(function(s,k){return s+(WEIGHTS[k]||1);},0);
  var totalPenalty=keys.reduce(function(s,k){return s+issuePenalty(checks[k].issues.length,WEIGHTS[k]||1);},0);
  var score=Math.max(0,Math.round(100-(totalPenalty/totalWeight)*100));
  var totalIssues=keys.reduce(function(s,k){return s+checks[k].issues.length;},0);
  var hasColorVars=figma.variables.getLocalVariables().some(function(v){return v.resolvedType==="COLOR";});
  var fixable={naming:checks.naming.issues.length,empty:checks.empty.issues.length,hidden:checks.hidden.issues.length,colors:checks.colors.issues.length,hasColorVars:hasColorVars};
  return{checks:checks,totalNodes:totalNodes,totalIssues:totalIssues,score:score,fixable:fixable};
}

// ── Fixes (bulk, kept for compat) ─────────────────────────────────────────────
export function runFixes(fixes){
  var auditPages=getAuditPages();
  var stats={naming:0,empty:0,hidden:0,colors:0};
  var allNodes=[];
  function collect(node){allNodes.push(node);if("children"in node&&node.children)node.children.forEach(function(c){collect(c);});}
  auditPages.forEach(function(pg){pg.children.forEach(function(n){collect(n);});});
  function recollect(){allNodes=[];auditPages.forEach(function(pg){pg.children.forEach(function(n){collect(n);});});}
  if(fixes.indexOf("hidden")!==-1){allNodes.forEach(function(node){if(node.visible===false){try{node.remove();stats.hidden++;}catch(e){}}});recollect();}
  if(fixes.indexOf("empty")!==-1){allNodes.forEach(function(node){if((node.type==="FRAME"||node.type==="GROUP")&&"children"in node&&node.children.length===0){try{node.remove();stats.empty++;}catch(e){}}});recollect();}
  if(fixes.indexOf("naming")!==-1){allNodes.forEach(function(node){
    if(node.type==="TEXT")return;
    if(isDefaultName(node.name)){try{node.name=generateName(node);stats.naming++;}catch(e){}}
    else{var v=getKebabViolation(node);if(v){try{node.name=toKebab(node.name);stats.naming++;}catch(e){}}}
  });}
  if(fixes.indexOf("colors")!==-1){var colorVars=figma.variables.getLocalVariables().filter(function(v){return v.resolvedType==="COLOR";});if(colorVars.length>0){allNodes.forEach(function(node){if(!("fills"in node)||!Array.isArray(node.fills))return;var changed=false;var newFills=node.fills.map(function(fill,i){if(fill.type!=="SOLID"||fill.visible===false)return fill;var bv=node.boundVariables&&node.boundVariables.fills&&node.boundVariables.fills[i];if(bv)return fill;var nearest=findNearestColorVar(fill.color,colorVars);if(nearest){try{var f=figma.variables.setBoundVariableForPaint(fill,"color",nearest);stats.colors++;changed=true;return f;}catch(e){return fill;}}return fill;});if(changed){try{node.fills=newFills;}catch(e){}}});}}
  return stats;
}
