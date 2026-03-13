figma.showUI(__html__, { width: 920, height: 680, title: "Is it ready for dev?" });

figma.on("selectionchange", function() { pushDebugData(); });

function pushDebugData() {
  var sel = figma.currentPage.selection;
  if (sel.length === 1) figma.ui.postMessage({ type:"debug-data", data:buildDebugData(sel[0]) });
  else figma.ui.postMessage({ type:"debug-data", data:null, selCount:sel.length });
}

figma.ui.onmessage = async function(msg) {
  if (msg.type === "run-audit") {
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "focus-node") {
    var node = figma.getNodeById(msg.id);
    if (node) { figma.currentPage.selection=[node]; figma.viewport.scrollAndZoomIntoView([node]); }
  }
  // ── Per-issue inline fixes ────────────────────────────────────────────────
  if (msg.type === "rename-node") {
    var node = figma.getNodeById(msg.id);
    if (node && msg.name && msg.name.trim()) { node.name = msg.name.trim(); }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "delete-node") {
    var node = figma.getNodeById(msg.id);
    if (node) { try { node.remove(); } catch(e) {} }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "bind-fill") {
    var node = figma.getNodeById(msg.id);
    if (node && "fills" in node && Array.isArray(node.fills)) {
      var colorVars = figma.variables.getLocalVariables().filter(function(v){ return v.resolvedType === "COLOR"; });
      if (colorVars.length > 0) {
        var newFills = node.fills.map(function(fill, i) {
          if (fill.type !== "SOLID" || fill.visible === false) return fill;
          var bv = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[i];
          if (bv) return fill;
          var nearest = findNearestColorVar(fill.color, colorVars);
          if (nearest) { try { return figma.variables.setBoundVariableForPaint(fill,"color",nearest); } catch(e) { return fill; } }
          return fill;
        });
        try { node.fills = newFills; } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  // ── Bulk fix (kept for backward compat) ──────────────────────────────────
  if (msg.type === "run-fixes") {
    figma.ui.postMessage({ type:"audit-results", results:(function(){ runFixes(msg.fixes); return runAudit(); })() });
  }
  if (msg.type === "generate-cover") {
    await generateCover(msg);
    figma.ui.postMessage({ type: "cover-generated" });
  }
  if (msg.type === "import-tokens") {
    try {
      var result = await importTokens(msg.filename, msg.data);
      figma.ui.postMessage({ type:"import-result", success:true,  filename:msg.filename, message:result });
    } catch(e) {
      figma.ui.postMessage({ type:"import-result", success:false, filename:msg.filename, message:String(e) });
    }
  }
  if (msg.type === "request-debug") { pushDebugData(); }
  // ── Workflow: page structure ──────────────────────────────────────────────
  if (msg.type === "check-pages") {
    try {
      var pages = [];
      for (var pi = 0; pi < figma.root.children.length; pi++) {
        pages.push({ id: figma.root.children[pi].id, name: figma.root.children[pi].name });
      }
      var fileInfo = {
        fileName: figma.root.name || "Untitled",
        userName: figma.currentUser ? (figma.currentUser.name || "") : "",
      };
      figma.ui.postMessage({ type: "pages-data", pages: pages, fileInfo: fileInfo });
    } catch(e) {
      figma.ui.postMessage({ type: "pages-data", pages: [], fileInfo: { fileName: "", userName: "" }, error: String(e) });
    }
  }
  if (msg.type === "create-pages") {
    // Page definitions in the correct order they should appear in the file
    var PAGE_DEFS = {
      cover:       "_Cover",
      foundations: "🎨 Foundations",
      components:  "🧩 Components",
      mobile:      "📱 Mobile",
      desktop:     "🖥️ Desktop",
      archive:     "🗄️ Archive",
    };
    var ORDER = ["cover","foundations","components","mobile","desktop","archive"];
    msg.keys.forEach(function(key) {
      if (!PAGE_DEFS[key]) return;
      // Don't create if a page with this hint already exists
      var hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
      var exists = figma.root.children.some(function(p) {
        return p.name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1;
      });
      if (!exists) figma.createPage().name = PAGE_DEFS[key];
    });
    // Re-sort pages to match the recommended order
    var allPages = figma.root.children.slice();
    var sorted = [];
    ORDER.forEach(function(key) {
      var hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
      for (var i = 0; i < allPages.length; i++) {
        if (allPages[i].name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1) {
          sorted.push(allPages.splice(i,1)[0]); break;
        }
      }
    });
    // Append any pages not in the required set (custom pages) after
    allPages.forEach(function(p) { sorted.push(p); });
    sorted.forEach(function(p, i) { figma.root.insertChild(i, p); });
    // Send updated page list directly so UI re-renders immediately
    var updatedPages = [];
    for (var pi = 0; pi < figma.root.children.length; pi++) {
      updatedPages.push({ id: figma.root.children[pi].id, name: figma.root.children[pi].name });
    }
    figma.ui.postMessage({ type: "pages-data", pages: updatedPages, fileInfo: {
      fileName: figma.root.name || "Untitled",
      userName: figma.currentUser ? (figma.currentUser.name || "") : "",
    }});
  }
  // ── Workflow: design tokens check ─────────────────────────────────────────
  if (msg.type === "check-tokens") {
    try {
      var allVars = figma.variables.getLocalVariables();
      var collections = figma.variables.getLocalVariableCollections();
      var textStyles = figma.getLocalTextStyles();
      var effectStyles = figma.getLocalEffectStyles();

      var colorVars = 0, spacingVars = 0, radiusVars = 0, otherVars = 0;
      for (var vi = 0; vi < allVars.length; vi++) {
        var v = allVars[vi];
        var colName = "";
        for (var ci = 0; ci < collections.length; ci++) {
          if (collections[ci].id === v.variableCollectionId) { colName = collections[ci].name.toLowerCase(); break; }
        }
        if (v.resolvedType === "COLOR") colorVars++;
        else if (v.resolvedType === "FLOAT" && (colName.indexOf("spacing") !== -1 || colName.indexOf("gap") !== -1)) spacingVars++;
        else if (v.resolvedType === "FLOAT" && (colName.indexOf("radius") !== -1 || colName.indexOf("corner") !== -1)) radiusVars++;
        else otherVars++;
      }

      figma.ui.postMessage({ type: "tokens-data", tokens: {
        colors: colorVars,
        spacing: spacingVars,
        radius: radiusVars,
        other: otherVars,
        textStyles: textStyles.length,
        effectStyles: effectStyles.length,
        collections: collections.map(function(c) { return { name: c.name, count: allVars.filter(function(v) { return v.variableCollectionId === c.id; }).length }; })
      }});
    } catch(e) {
      figma.ui.postMessage({ type: "tokens-data", tokens: null, error: String(e) });
    }
  }
  // ── Generate tokens ───────────────────────────────────────────────────────
  if (msg.type === "generate-tokens") {
    var brandHex = msg.brandColor || "#3B82F6";
    var secondaryHex = msg.secondaryColor || "";
    var tertiaryHex = msg.tertiaryColor || "";
    var colorOpts = {
      primary: brandHex, secondary: secondaryHex, tertiary: tertiaryHex,
      custom: msg.customColors || []
    };
    var fontFamilies = msg.fontFamilies || { primary: "Inter, sans-serif", secondary: "Inter, sans-serif", tertiary: "Inter, sans-serif" };
    var textStylesData = (msg.textStyles || []).map(function(s) {
      var resolved = {};
      for (var k in s) resolved[k] = s[k];
      resolved.fontFamily = fontFamilies[s.fontRole] || fontFamilies.primary;
      return resolved;
    });
    var spacingData = msg.spacing || [];
    var enabledCats = msg.enabledCategories || null;
    var GEN_ORDER = ["colors","colors-light","colors-dark","spacing","text-styles","radius","border","shadows","zindex","breakpoints"];

    // Filter to only enabled categories if provided
    var catsToRun = enabledCats ? GEN_ORDER.filter(function(c) { return enabledCats.indexOf(c) !== -1; }) : GEN_ORDER;

    for (var gi = 0; gi < catsToRun.length; gi++) {
      try {
        var gd = generateTokenData(catsToRun[gi], colorOpts, textStylesData, spacingData);
        var gr = await importTokens(gd.filename, gd.data);
        figma.ui.postMessage({ type:"generate-result", category:catsToRun[gi], success:true, message:gr });
      } catch(e) {
        figma.ui.postMessage({ type:"generate-result", category:catsToRun[gi], success:false, message:String(e) });
      }
    }
    figma.ui.postMessage({ type:"generate-complete" });
    // Refresh token counts for workflow step 2
    try {
      var allVars2 = figma.variables.getLocalVariables();
      var cols2 = figma.variables.getLocalVariableCollections();
      var ts2 = figma.getLocalTextStyles();
      var es2 = figma.getLocalEffectStyles();
      var cv2=0,sv2=0,rv2=0,ov2=0;
      for(var vi2=0;vi2<allVars2.length;vi2++){var v2=allVars2[vi2];var cn2="";for(var ci2=0;ci2<cols2.length;ci2++){if(cols2[ci2].id===v2.variableCollectionId){cn2=cols2[ci2].name.toLowerCase();break;}}if(v2.resolvedType==="COLOR")cv2++;else if(v2.resolvedType==="FLOAT"&&(cn2.indexOf("spacing")!==-1||cn2.indexOf("gap")!==-1))sv2++;else if(v2.resolvedType==="FLOAT"&&(cn2.indexOf("radius")!==-1||cn2.indexOf("corner")!==-1))rv2++;else ov2++;}
      figma.ui.postMessage({type:"tokens-data",tokens:{colors:cv2,spacing:sv2,radius:rv2,other:ov2,textStyles:ts2.length,effectStyles:es2.length,collections:cols2.map(function(c){return{name:c.name,count:allVars2.filter(function(v){return v.variableCollectionId===c.id;}).length};})}});
    } catch(e){}
  }
};

// ── Token Debugger ────────────────────────────────────────────────────────────
function rgb01ToHex(r,g,b) {
  return "#"+[r,g,b].map(function(v){ return Math.round(Math.min(255,Math.max(0,v*255))).toString(16).padStart(2,"0"); }).join("").toUpperCase();
}
function resolveChain(variableId) {
  var chain=[],currentId=variableId,maxSteps=12,seen={};
  while (currentId && maxSteps-->0) {
    if (seen[currentId]){chain.push({name:"⚠ Circular reference",broken:true});break;}
    seen[currentId]=true;
    var v=figma.variables.getVariableById(currentId);
    if(!v){chain.push({name:"Broken reference — variable deleted or renamed",broken:true});break;}
    var col=figma.variables.getVariableCollectionById(v.variableCollectionId);
    var colName=col?col.name:"?";
    var modeId=col&&col.modes&&col.modes.length>0?col.modes[0].modeId:null;
    var val=modeId&&v.valuesByMode?v.valuesByMode[modeId]:null;
    if(val&&typeof val==="object"&&val.type==="VARIABLE_ALIAS"){
      chain.push({name:v.name,collection:colName,isAlias:true,resolvedType:v.resolvedType});
      currentId=val.id;
    } else {
      var display=null,hexColor=null;
      if(v.resolvedType==="COLOR"&&val){hexColor=rgb01ToHex(val.r||0,val.g||0,val.b||0);var a=val.a!==undefined?val.a:1;display=hexColor+(a<1?" / "+Math.round(a*100)+"%":"");}
      else if(v.resolvedType==="FLOAT") display=String(Math.round((Number(val)||0)*100)/100);
      else if(v.resolvedType==="STRING"){var s=String(val);display=s.length>44?s.slice(0,44)+"…":s;}
      else if(v.resolvedType==="BOOLEAN") display=String(val);
      chain.push({name:v.name,collection:colName,isAlias:false,resolvedType:v.resolvedType,displayValue:display,hexColor:hexColor});
      break;
    }
  }
  return chain;
}
function buildDebugData(node) {
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

// ── Audit ─────────────────────────────────────────────────────────────────────
var DEFAULT_NAME_RE=/^(Frame|Rectangle|Ellipse|Polygon|Star|Vector|Line|Arrow|Text|Group|Component|Instance|Image|Section|Slice)(\s+\d+)?$/i;
function isDefaultName(n){return DEFAULT_NAME_RE.test(n.trim());}
function rgbToHex(c){return "#"+[c.r,c.g,c.b].map(function(v){return Math.round(v*255).toString(16).padStart(2,"0");}).join("");}
function getPath(node){var parts=[],n=node.parent;while(n&&n.type!=="PAGE"&&n.type!=="DOCUMENT"){parts.unshift(n.name);n=n.parent;}return parts.length?parts.join(" › "):"Page root";}
function trunc(s,l){l=l||38;return s&&s.length>l?s.slice(0,l)+"…":(s||"");}

// ── Kebab-case helpers ────────────────────────────────────────────────────────
// Convert any string to kebab-case (preserves slash hierarchy for components)
function toKebab(str) {
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
function getKebabViolation(node) {
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
function generateName(node) {
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
function getVarColor(v){var col=figma.variables.getVariableCollectionById(v.variableCollectionId);if(!col||!col.modes||!col.modes.length)return null;var val=v.valuesByMode[col.modes[0].modeId];if(!val||typeof val!=="object"||val.type==="VARIABLE_ALIAS")return null;return val;}
function colorDist(a,b){var dr=a.r-b.r,dg=a.g-b.g,db=a.b-b.b;return Math.sqrt(dr*dr+dg*dg+db*db);}
function findNearestColorVar(color,vars){var best=null,bestDist=0.04;for(var i=0;i<vars.length;i++){var vc=getVarColor(vars[i]);if(!vc)continue;var d=colorDist(color,vc);if(d<bestDist){bestDist=d;best=vars[i];}}return best;}
function mk(label,desc,icon,group){return{label:label,description:desc,icon:icon,group:group,issues:[]};}

function runAudit(){
  var page=figma.currentPage;
  var checks={
    naming:        mk("Default Layer Names",     "Layers using Figma auto-generated names",                   "🏷",  "Naming & Structure"),
    namingFormat:  mk("Naming Convention",       "Names not in kebab-case (spaces, caps, underscores)",       "📝",  "Naming & Structure"),
    duplicates:    mk("Duplicate Layer Names",   "Sibling layers sharing the same name",                      "👯",  "Naming & Structure"),
    deepNesting:   mk("Deep Nesting",            "Frames or groups nested 6+ levels deep",                    "🪆",  "Naming & Structure"),
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
  var totalNodes=0;
  function walk(node,depth){
    totalNodes++;var path=getPath(node);
    // ── Naming: include suggestedName for inline rename pre-fill ──────────────
    if(isDefaultName(node.name))checks.naming.issues.push({id:node.id,label:node.type+': "'+node.name+'"',path:path,suggestedName:generateName(node)});
    // ── Naming convention: flag non-kebab-case names ───────────────────────
    var violation = getKebabViolation(node);
    if(violation)checks.namingFormat.issues.push({id:node.id,label:'"'+trunc(node.name)+'\" — '+violation,path:path,suggestedName:toKebab(node.name)});
    if("children"in node&&node.children&&node.children.length>1){var seen={};node.children.forEach(function(child){if(!seen[child.name])seen[child.name]=[];seen[child.name].push(child);});Object.keys(seen).forEach(function(name){if(seen[name].length>1)checks.duplicates.issues.push({id:seen[name][0].id,label:seen[name].length+'× "'+trunc(name)+'"',path:path+" › "+trunc(node.name,22)});});}
    if(depth>=6&&(node.type==="FRAME"||node.type==="GROUP"))checks.deepNesting.issues.push({id:node.id,label:"Depth "+depth+': "'+trunc(node.name)+'"',path:path});
    if((node.type==="FRAME"||node.type==="COMPONENT")&&node.layoutMode==="NONE"&&"children"in node&&node.children.length>=2)checks.autoLayout.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.children.length+' children',path:path});
    var bv=node.boundVariables||{};
    if("fills"in node&&Array.isArray(node.fills)){node.fills.forEach(function(fill,i){if(fill.type==="SOLID"&&fill.visible!==false){var b=bv.fills&&bv.fills[i];if(!b)checks.colors.issues.push({id:node.id,label:'"'+trunc(node.name)+'" fill: '+rgbToHex(fill.color),path:path});}});}
    if("strokes"in node&&Array.isArray(node.strokes)){node.strokes.forEach(function(stroke,i){if(stroke.type==="SOLID"&&stroke.visible!==false&&(node.strokeWeight||0)>0){var b=bv.strokes&&bv.strokes[i];if(!b)checks.colors.issues.push({id:node.id,label:'"'+trunc(node.name)+'" stroke: '+rgbToHex(stroke.color),path:path});}});}
    if((node.type==="FRAME"||node.type==="COMPONENT")&&node.layoutMode!=="NONE"){var unboundProps=[];["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"].forEach(function(prop){if(!(prop in node))return;var val=node[prop];if(val===figma.mixed||!val||val<=0)return;var b=bv[prop];if(!b)unboundProps.push(prop.replace(/([A-Z])/g," $1").toLowerCase());});if(unboundProps.length)checks.spacingVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+unboundProps.join(", "),path:path});}
    if("cornerRadius"in node&&node.cornerRadius!==figma.mixed&&node.cornerRadius>0){var b=bv.cornerRadius;if(!b)checks.radiusVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.cornerRadius+'px',path:path});}
    if("opacity"in node&&node.opacity<1&&node.opacity>0){var b=bv.opacity;if(!b)checks.opacityVars.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+Math.round(node.opacity*100)+'%',path:path});}
    if(node.type==="TEXT"){var tsId=node.textStyleId;if(tsId===figma.mixed)checks.mixedText.issues.push({id:node.id,label:'"'+trunc(node.characters||node.name,42)+'"',path:path});else if(!tsId)checks.textStyles.issues.push({id:node.id,label:'"'+trunc(node.characters||node.name,42)+'"',path:path});}
    if(depth<=6&&node.visible===false)checks.hidden.issues.push({id:node.id,label:node.type+': "'+trunc(node.name)+'"',path:path});
    if((node.type==="FRAME"||node.type==="GROUP")&&"children"in node&&node.children.length===0)checks.empty.issues.push({id:node.id,label:node.type+': "'+trunc(node.name)+'"',path:path});
    if("effects"in node&&node.effects&&node.effects.length>0&&!node.effectStyleId)checks.unsavedStyles.issues.push({id:node.id,label:'"'+trunc(node.name)+'" — '+node.effects.length+' effect(s)',path:path});
    if("children"in node&&node.children)node.children.forEach(function(child){walk(child,depth+1);});
  }
  page.children.forEach(function(n){walk(n,0);});
  var WEIGHTS={autoLayout:5,colors:5,textStyles:5,spacingVars:5,naming:5,namingFormat:4,mixedText:4,radiusVars:4,duplicates:3,deepNesting:3,unsavedStyles:3,opacityVars:2,hidden:2,empty:1};
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
function runFixes(fixes){
  var page=figma.currentPage,stats={naming:0,empty:0,hidden:0,colors:0};
  var allNodes=[];
  function collect(node){allNodes.push(node);if("children"in node&&node.children)node.children.forEach(function(c){collect(c);});}
  page.children.forEach(function(n){collect(n);});
  if(fixes.indexOf("hidden")!==-1){allNodes.forEach(function(node){if(node.visible===false){try{node.remove();stats.hidden++;}catch(e){}}});allNodes=[];page.children.forEach(function(n){collect(n);});}
  if(fixes.indexOf("empty")!==-1){allNodes.forEach(function(node){if((node.type==="FRAME"||node.type==="GROUP")&&"children"in node&&node.children.length===0){try{node.remove();stats.empty++;}catch(e){}}});allNodes=[];page.children.forEach(function(n){collect(n);});}
  if(fixes.indexOf("naming")!==-1){allNodes.forEach(function(node){
    if(isDefaultName(node.name)){try{node.name=generateName(node);stats.naming++;}catch(e){}}
    else{var v=getKebabViolation(node);if(v){try{node.name=toKebab(node.name);stats.naming++;}catch(e){}}}
  });}
  if(fixes.indexOf("colors")!==-1){var colorVars=figma.variables.getLocalVariables().filter(function(v){return v.resolvedType==="COLOR";});if(colorVars.length>0){allNodes.forEach(function(node){if(!("fills"in node)||!Array.isArray(node.fills))return;var changed=false;var newFills=node.fills.map(function(fill,i){if(fill.type!=="SOLID"||fill.visible===false)return fill;var bv=node.boundVariables&&node.boundVariables.fills&&node.boundVariables.fills[i];if(bv)return fill;var nearest=findNearestColorVar(fill.color,colorVars);if(nearest){try{var f=figma.variables.setBoundVariableForPaint(fill,"color",nearest);stats.colors++;changed=true;return f;}catch(e){return fill;}}return fill;});if(changed){try{node.fills=newFills;}catch(e){}}});}}
  return stats;
}

// ── Cover Page Generator ──────────────────────────────────────────────────────
async function generateCover(info) {
  // Find the cover page
  var coverPage = null;
  for (var i = 0; i < figma.root.children.length; i++) {
    if (figma.root.children[i].name.toLowerCase().indexOf("cover") !== -1) {
      coverPage = figma.root.children[i]; break;
    }
  }
  if (!coverPage) {
    coverPage = figma.createPage();
    coverPage.name = "_Cover";
    figma.root.insertChild(0, coverPage);
  }

  // Load fonts we'll use
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });

  // Remove existing cover frame if regenerating
  var existing = coverPage.children.filter(function(n) { return n.name === "Cover"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  // Status colours
  var STATUS_COLORS = {
    "In Progress":       { bg: { r:0.988, g:0.886, b:0.686 }, text: { r:0.541, g:0.361, b:0.000 } },
    "Ready for Review":  { bg: { r:0.537, g:0.706, b:0.980 }, text: { r:0.067, g:0.251, b:0.620 } },
    "Dev Ready":         { bg: { r:0.651, g:0.890, b:0.631 }, text: { r:0.067, g:0.392, b:0.114 } },
  };
  var statusCol = STATUS_COLORS[info.status] || STATUS_COLORS["In Progress"];

  var W = 1440, H = 960;
  var frame = figma.createFrame();
  frame.name = "Cover";
  frame.resize(W, H);
  frame.fills = [{ type: "SOLID", color: { r: 0.067, g: 0.067, b: 0.094 } }];
  coverPage.appendChild(frame);

  // ── Accent bar (left edge) ─────────────────────────────────────────────────
  var accent = figma.createRectangle();
  accent.name = "accent-bar";
  accent.resize(6, H);
  accent.x = 0; accent.y = 0;
  accent.fills = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 } }];
  frame.appendChild(accent);

  // ── Logo placeholder ───────────────────────────────────────────────────────
  var logoFrame = figma.createFrame();
  logoFrame.name = "logo-placeholder";
  logoFrame.resize(80, 80);
  logoFrame.x = 80; logoFrame.y = 80;
  logoFrame.cornerRadius = 16;
  logoFrame.fills = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 }, opacity: 0.15 }];
  logoFrame.strokes = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 }, opacity: 0.4 }];
  logoFrame.strokeWeight = 1.5;
  frame.appendChild(logoFrame);

  var logoLabel = figma.createText();
  logoLabel.fontName = { family: "Inter", style: "Medium" };
  logoLabel.fontSize = 11;
  logoLabel.characters = "Logo";
  logoLabel.fills = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 }, opacity: 0.6 }];
  logoLabel.x = logoFrame.x + (logoFrame.width - logoLabel.width) / 2;
  logoLabel.y = logoFrame.y + (logoFrame.height - logoLabel.height) / 2;
  frame.appendChild(logoLabel);

  // ── Project name ───────────────────────────────────────────────────────────
  var projectText = figma.createText();
  projectText.name = "project-name";
  projectText.fontName = { family: "Inter", style: "Bold" };
  projectText.fontSize = 72;
  projectText.characters = info.project;
  projectText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  projectText.x = 80;
  projectText.y = 220;
  frame.appendChild(projectText);

  // ── Divider line ───────────────────────────────────────────────────────────
  var divider = figma.createRectangle();
  divider.name = "divider";
  divider.resize(W - 160, 1);
  divider.x = 80;
  divider.y = projectText.y + projectText.height + 32;
  divider.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.08 }];
  frame.appendChild(divider);

  // ── Meta row: version · date · designers ──────────────────────────────────
  var metaY = divider.y + 36;
  var metaItems = [
    { label: "Version",      value: info.version   },
    { label: "Last Updated", value: info.date       },
    { label: "Designer(s)",  value: info.designers  },
  ];
  var metaX = 80;
  metaItems.forEach(function(item) {
    var lbl = figma.createText();
    lbl.fontName = { family: "Inter", style: "Regular" };
    lbl.fontSize = 12;
    lbl.characters = item.label.toUpperCase();
    lbl.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.35 }];
    lbl.letterSpacing = { unit: "PIXELS", value: 1.2 };
    lbl.x = metaX; lbl.y = metaY;
    frame.appendChild(lbl);

    var val = figma.createText();
    val.fontName = { family: "Inter", style: "Semi Bold" };
    val.fontSize = 20;
    val.characters = item.value;
    val.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.85 }];
    val.x = metaX; val.y = metaY + 22;
    frame.appendChild(val);

    metaX += 280;
  });

  // ── Status badge ──────────────────────────────────────────────────────────
  var badgeW = 200, badgeH = 44, badgeX = W - 80 - badgeW, badgeY = metaY;

  var badgeBg = figma.createRectangle();
  badgeBg.name = "status-badge-bg";
  badgeBg.resize(badgeW, badgeH);
  badgeBg.x = badgeX; badgeBg.y = badgeY;
  badgeBg.cornerRadius = 22;
  badgeBg.fills = [{ type: "SOLID", color: statusCol.bg }];
  frame.appendChild(badgeBg);

  var badgeText = figma.createText();
  badgeText.fontName = { family: "Inter", style: "Bold" };
  badgeText.fontSize = 14;
  badgeText.characters = info.status;
  badgeText.fills = [{ type: "SOLID", color: statusCol.text }];
  badgeText.x = badgeX + (badgeW - badgeText.width) / 2;
  badgeText.y = badgeY + (badgeH - badgeText.height) / 2;
  frame.appendChild(badgeText);

  // Navigate to cover page and zoom to frame
  figma.currentPage = coverPage;
  figma.viewport.scrollAndZoomIntoView([frame]);
}

// ── Import ────────────────────────────────────────────────────────────────────
function findOrCreateCollection(name){var cols=figma.variables.getLocalVariableCollections();for(var i=0;i<cols.length;i++){if(cols[i].name===name)return cols[i];}return figma.variables.createVariableCollection(name);}
function buildVarMap(col){var map={},all=figma.variables.getLocalVariables();for(var i=0;i<all.length;i++){if(all[i].variableCollectionId===col.id)map[all[i].name]=all[i];}return map;}
function getOrCreateVar(name,col,type,map){if(map[name]&&map[name].resolvedType===type)return map[name];var v=figma.variables.createVariable(name,col,type);map[name]=v;return v;}
function dtcgToFigmaColor(val){return{r:val.components[0],g:val.components[1],b:val.components[2],a:val.alpha!==undefined?val.alpha:1};}

function detectType(fn){
  fn=fn.toLowerCase();
  if(fn.indexOf("text-style")!==-1||fn.indexOf("textstyle")!==-1) return "text-styles";
  if(fn.indexOf("primitive")!==-1)  return "primitives";
  if(fn.indexOf("dark")!==-1)       return "colors-dark";
  if(fn.indexOf("light")!==-1)      return "colors-light";
  if(fn.indexOf("color")!==-1||fn.indexOf("colour")!==-1) return "colors-light";
  if(fn.indexOf("spacing")!==-1)    return "spacing";
  if(fn.indexOf("typography")!==-1) return "typography";
  if(fn.indexOf("radius")!==-1)     return "radius";
  if(fn.indexOf("border")!==-1)     return "border";
  if(fn.indexOf("shadow")!==-1)     return "shadows";
  if(fn.indexOf("z-index")!==-1)    return "zindex";
  if(fn.indexOf("breakpoint")!==-1) return "breakpoints";
  return "unknown";
}

async function importTokens(filename,data){
  var type=detectType(filename);
  if(type==="text-styles")   return await importTextStyles(data);
  if(type==="primitives")    return importPrimitives(data);
  if(type==="colors-light")  return importColors(data,"Light");
  if(type==="colors-dark")   return importColors(data,"Dark");
  if(type==="spacing")       return importFlat(data,"Spacing","spacing",true);
  if(type==="radius")        return importFlat(data,"Radius","radius",true);
  if(type==="border")        return importFlat(data,"Border Width","border",true);
  if(type==="zindex")        return importFlat(data,"Z-Index","z-index",false);
  if(type==="breakpoints")   return importFlat(data,"Breakpoints","breakpoint",false);
  if(type==="shadows")       return importShadows(data);
  if(type==="typography")    return importTypography(data);
  throw new Error('Cannot detect type from "'+filename+'". Keep original filenames.');
}

function weightToStyle(w){var n=parseInt(w)||400;if(n<=100)return"Thin";if(n<=200)return"ExtraLight";if(n<=300)return"Light";if(n<=400)return"Regular";if(n<=500)return"Medium";if(n<=600)return"SemiBold";if(n<=700)return"Bold";if(n<=800)return"ExtraBold";return"Black";}

async function importTextStyles(data){
  var fontsNeeded=[],seen={};
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var style=weightToStyle(val.fontWeight||400);var k=family+":"+style;if(!seen[k]){seen[k]=true;fontsNeeded.push({family:family,style:style});}});});
  await Promise.all(fontsNeeded.map(function(f){return figma.loadFontAsync({family:f.family,style:f.style}).catch(function(){});}));
  var existingStyles=figma.getLocalTextStyles(),styleMap={};existingStyles.forEach(function(s){styleMap[s.name]=s;});
  var count=0,skipped=0;
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var styleName=groupKey+"/"+key;try{var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var fontStyle=weightToStyle(val.fontWeight||400);var style=styleMap[styleName]||figma.createTextStyle();style.name=styleName;style.fontName={family:family,style:fontStyle};var fs=val.fontSize;style.fontSize=typeof fs==="object"?(fs.value||16):(parseFloat(fs)||16);var lh=val.lineHeight;if(lh){if(typeof lh==="object"){if(lh.unit==="PIXELS")style.lineHeight={unit:"PIXELS",value:lh.value||24};else if(lh.unit==="MULTIPLIER"){var lhPx=(lh.value||1.5)*style.fontSize;style.lineHeight={unit:"PIXELS",value:lhPx};}else style.lineHeight={unit:"PERCENT",value:(lh.value||1.5)*100};}else style.lineHeight={unit:"PERCENT",value:(parseFloat(lh)||1.5)*100};}var ls=val.letterSpacing;if(ls!==undefined){var lsVal=typeof ls==="object"?ls.value:(parseFloat(ls)||0);style.letterSpacing={unit:"PIXELS",value:lsVal};}var ps=val.paragraphSpacing;if(ps!==undefined)style.paragraphSpacing=typeof ps==="object"?(ps.value||0):(parseFloat(ps)||0);var td=val.textDecoration;style.textDecoration=(td&&td!=="NONE")?td:"NONE";if(token["$description"])style.description=token["$description"];styleMap[styleName]=style;count++;}catch(e){skipped++;}});});
  var msg="Created/updated "+count+" text style"+(count!==1?"s":"");if(skipped>0)msg+=" ("+skipped+" skipped — font not installed)";return msg;
}

function importPrimitives(data){var col=findOrCreateCollection("Primitives"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object"||g["$value"]!==undefined)return;Object.keys(g).forEach(function(sk){var t=g[sk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+sk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return"Imported "+count+" variables";}
function importColors(data,modeName){var col=findOrCreateCollection("Colors"),modeId=null;for(var i=0;i<col.modes.length;i++){if(col.modes[i].name===modeName){modeId=col.modes[i].modeId;break;}}if(!modeId){if(col.modes.length===1&&col.modes[0].name==="Mode 1"){col.renameMode(col.modes[0].modeId,modeName);modeId=col.modes[0].modeId;}else modeId=col.addMode(modeName);}var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object"||g["$value"]!==undefined)return;Object.keys(g).forEach(function(tk){var t=g[tk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+tk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return"Imported "+count+" variables";}
function importFlat(data,colName,prefix,isDim){var col=findOrCreateCollection(colName),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(key){var t=data[key];if(!t||t["$value"]===undefined)return;try{var raw=t["$value"],num=isDim&&typeof raw==="object"?raw.value:parseFloat(raw)||0;var v=getOrCreateVar(prefix+"/"+key,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}catch(e){}});return"Imported "+count+" variables";}
function importShadows(data){var col=findOrCreateCollection("Shadows"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(key){var t=data[key];if(!t||t["$value"]===undefined)return;try{var v=getOrCreateVar("shadow/"+key,col,"STRING",map);v.setValueForMode(modeId,String(t["$value"]));count++;}catch(e){}});return"Imported "+count+" variables";}
function importTypography(data){var col=findOrCreateCollection("Typography"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object")return;Object.keys(g).forEach(function(key){var t=g[key];if(!t||t["$value"]===undefined)return;try{var vn=gk+"/"+key,val=t["$value"];if(t["$type"]==="fontFamily"){var v=getOrCreateVar(vn,col,"STRING",map);v.setValueForMode(modeId,String(val));count++;}else if(t["$type"]==="dimension"){var num=typeof val==="object"?val.value:parseFloat(val)||0;var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}else if(t["$type"]==="number"){var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,parseFloat(val)||0);count++;}}catch(e){}});});return"Imported "+count+" variables";}

// ══════════════════════════════════════════════════════════════════════════════
// ── Token Generator ──────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════

// ── Color math (ES5) ─────────────────────────────────────────────────────────
function hexToRgb255(hex) {
  var h = hex.replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return {
    r: parseInt(h.slice(0,2), 16),
    g: parseInt(h.slice(2,4), 16),
    b: parseInt(h.slice(4,6), 16)
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb01(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  var r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Generate 10-shade palette from a base hue/saturation
// Lightness curve: 50=97, 100=93, 200=86, 300=75, 400=62, 500=50, 600=42, 700=33, 800=24, 900=15
function generateShadeScale(h, s, baseL) {
  var SHADES = ["50","100","200","300","400","500","600","700","800","900"];
  var TARGET_L = [97, 93, 86, 75, 62, 50, 42, 33, 24, 15];
  // Shift curve so input lightness lands at shade 500
  var delta = baseL - 50;
  var SAT_CURVE = [0.3, 0.4, 0.55, 0.7, 0.85, 1.0, 0.95, 0.9, 0.85, 0.8];
  var result = {};
  for (var i = 0; i < SHADES.length; i++) {
    var tl = clamp(TARGET_L[i] + delta * (1 - Math.abs(i - 5) / 5), 3, 98);
    var ts = clamp(s * SAT_CURVE[i], 0, 100);
    var rgb = hslToRgb01(h, ts, tl);
    result[SHADES[i]] = { "$type": "color", "$value": { colorSpace: "srgb", components: [rgb[0], rgb[1], rgb[2]], alpha: 1 } };
  }
  return result;
}

// ── Default palettes (Tailwind-inspired) ─────────────────────────────────────
var DEFAULT_PALETTES = {
  purple: { h: 271, s: 81, l: 56 },
  green:  { h: 142, s: 71, l: 45 },
  red:    { h: 0,   s: 84, l: 60 },
  amber:  { h: 38,  s: 92, l: 50 },
  gray:   { h: 220, s: 9,  l: 46 }
};

function hexToHsl(hex) {
  var rgb = hexToRgb255(hex);
  return rgbToHsl(rgb.r, rgb.g, rgb.b);
}

function generateColorTokens(colorOpts) {
  var data = {};

  // User-defined brand colors (raw hex, no shades)
  data.primary = makeColorHex(colorOpts.primary);
  if (colorOpts.secondary) data.secondary = makeColorHex(colorOpts.secondary);
  if (colorOpts.tertiary) data.tertiary = makeColorHex(colorOpts.tertiary);

  // Custom user-defined colors
  if (colorOpts.custom && colorOpts.custom.length) {
    for (var ci = 0; ci < colorOpts.custom.length; ci++) {
      var cc = colorOpts.custom[ci];
      if (cc.name && cc.hex) {
        var safeKey = cc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (safeKey) data[safeKey] = makeColorHex(cc.hex);
      }
    }
  }

  // Auto-include defaults if not already defined by user
  var hasCustom = function(name) {
    if (!colorOpts.custom) return false;
    for (var i = 0; i < colorOpts.custom.length; i++) {
      var k = colorOpts.custom[i].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (k === name) return true;
    }
    return false;
  };

  // Black, white, gray — auto-included unless user defined them
  if (!hasCustom("black")) data.black = makeColorHex("#000000");
  if (!hasCustom("white")) data.white = makeColorHex("#FFFFFF");
  if (!hasCustom("gray"))  data.gray  = makeColorHex("#E3E3E3");

  // Focus & error tokens — auto-included unless user defined them
  data.focus = {
    border: makeColorHex("#000000"),
    color:  makeColorHex("#79797B")
  };
  data.error = {
    border: makeColorHex("#E32E22"),
    color:  makeColorHex("#E32E22")
  };

  return data;
}

function makeColor(r, g, b) {
  return { "$type": "color", "$value": { colorSpace: "srgb", components: [r, g, b], alpha: 1 } };
}

function makeColorHex(hex) {
  var c = hexToRgb255(hex);
  return makeColor(c.r / 255, c.g / 255, c.b / 255);
}

function makeColorHSL(h, s, l) {
  var rgb = hslToRgb01(h, s, l);
  return { "$type": "color", "$value": { colorSpace: "srgb", components: rgb, alpha: 1 } };
}

function generateSemanticColors(colorOpts, mode) {
  var pri = hexToHsl(colorOpts.primary);
  var h = pri.h, s = pri.s;

  // Secondary: from picker or auto-derived
  var secH, secS;
  if (colorOpts.secondary) {
    var sec = hexToHsl(colorOpts.secondary);
    secH = sec.h; secS = sec.s;
  } else {
    secH = (h + 60) % 360; secS = clamp(s - 10, 20, 90);
  }

  // Tertiary: from picker or auto-derived
  var terH, terS;
  if (colorOpts.tertiary) {
    var ter = hexToHsl(colorOpts.tertiary);
    terH = ter.h; terS = ter.s;
  } else {
    terH = (h + 150) % 360; terS = clamp(s - 15, 20, 85);
  }

  if (mode === "light") {
    return {
      brand: {
        primary:   makeColorHSL(h, s, 50),
        secondary: makeColorHSL(secH, secS, 55),
        accent:    makeColorHSL(terH, terS, 50)
      },
      surface: {
        base:    makeColor(1, 1, 1),
        raised:  makeColorHSL(h, 5, 97),
        overlay: makeColorHSL(h, 5, 95)
      },
      text: {
        primary:   makeColorHSL(h, 10, 10),
        secondary: makeColorHSL(h, 8, 40),
        disabled:  makeColorHSL(h, 5, 65),
        inverse:   makeColor(1, 1, 1)
      },
      border: {
        "default": makeColorHSL(h, 8, 85),
        strong:    makeColorHSL(h, 10, 70),
        subtle:    makeColorHSL(h, 5, 92)
      },
      feedback: {
        success: makeColorHSL(142, 71, 45),
        warning: makeColorHSL(38, 92, 50),
        error:   makeColorHSL(0, 84, 60),
        info:    makeColorHSL(h, s, 50)
      },
      overlay: {
        scrim: { "$type": "color", "$value": { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.5 } }
      }
    };
  } else {
    return {
      brand: {
        primary:   makeColorHSL(h, clamp(s - 5, 0, 100), 60),
        secondary: makeColorHSL(secH, clamp(secS - 5, 0, 100), 60),
        accent:    makeColorHSL(terH, clamp(terS - 5, 0, 100), 58)
      },
      surface: {
        base:    makeColorHSL(h, 10, 8),
        raised:  makeColorHSL(h, 10, 12),
        overlay: makeColorHSL(h, 10, 16)
      },
      text: {
        primary:   makeColorHSL(h, 5, 93),
        secondary: makeColorHSL(h, 5, 65),
        disabled:  makeColorHSL(h, 5, 40),
        inverse:   makeColorHSL(h, 10, 10)
      },
      border: {
        "default": makeColorHSL(h, 8, 22),
        strong:    makeColorHSL(h, 8, 35),
        subtle:    makeColorHSL(h, 5, 15)
      },
      feedback: {
        success: makeColorHSL(142, 60, 55),
        warning: makeColorHSL(38, 80, 55),
        error:   makeColorHSL(0, 72, 60),
        info:    makeColorHSL(h, clamp(s - 5, 0, 100), 60)
      },
      overlay: {
        scrim: { "$type": "color", "$value": { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.7 } }
      }
    };
  }
}

function generateSpacingData(spacingList) {
  var tokens = {};
  for (var i = 0; i < spacingList.length; i++) {
    var s = spacingList[i];
    if (s.name) {
      tokens[s.name] = { "$type": "dimension", "$value": { value: parseFloat(s.value) || 0, unit: "px" } };
    }
  }
  return tokens;
}

function generateRadiusData() {
  return {
    none: { "$type": "dimension", "$value": { value: 0, unit: "px" } },
    sm:   { "$type": "dimension", "$value": { value: 4, unit: "px" } },
    md:   { "$type": "dimension", "$value": { value: 8, unit: "px" } },
    lg:   { "$type": "dimension", "$value": { value: 16, unit: "px" } },
    xl:   { "$type": "dimension", "$value": { value: 24, unit: "px" } },
    full: { "$type": "dimension", "$value": { value: 9999, unit: "px" } }
  };
}

function generateBorderData() {
  return {
    thin:    { "$type": "dimension", "$value": { value: 1, unit: "px" } },
    "default": { "$type": "dimension", "$value": { value: 1.5, unit: "px" } },
    thick:   { "$type": "dimension", "$value": { value: 2, unit: "px" } },
    heavy:   { "$type": "dimension", "$value": { value: 4, unit: "px" } }
  };
}

function generateShadowsData() {
  return {
    sm:  { "$type": "string", "$value": "0 1px 2px rgba(0,0,0,0.05)" },
    md:  { "$type": "string", "$value": "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)" },
    lg:  { "$type": "string", "$value": "0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)" },
    xl:  { "$type": "string", "$value": "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)" },
    "2xl": { "$type": "string", "$value": "0 25px 50px -12px rgba(0,0,0,0.25)" },
    inner: { "$type": "string", "$value": "inset 0 2px 4px rgba(0,0,0,0.06)" }
  };
}

function generateZIndexData() {
  return {
    hide:     { "$type": "number", "$value": -1 },
    base:     { "$type": "number", "$value": 0 },
    dropdown: { "$type": "number", "$value": 1000 },
    sticky:   { "$type": "number", "$value": 1100 },
    overlay:  { "$type": "number", "$value": 1300 },
    modal:    { "$type": "number", "$value": 1400 },
    toast:    { "$type": "number", "$value": 1700 }
  };
}

function generateBreakpointsData() {
  return {
    sm:   { "$type": "number", "$value": 640 },
    md:   { "$type": "number", "$value": 768 },
    lg:   { "$type": "number", "$value": 1024 },
    xl:   { "$type": "number", "$value": 1280 },
    "2xl": { "$type": "number", "$value": 1536 }
  };
}

function generateTextStylesData(textStyles) {
  var data = {};
  for (var i = 0; i < textStyles.length; i++) {
    var s = textStyles[i];
    var group = s.group || "body";
    var name = s.name || "default";
    if (!data[group]) data[group] = {};
    data[group][name] = {
      "$type": "textStyle",
      "$value": {
        fontFamily: s.fontFamily || "Inter, sans-serif",
        fontSize: { value: parseFloat(s.fontSize) || 16, unit: "px" },
        fontWeight: parseFloat(s.fontWeight) || 400,
        lineHeight: { value: parseFloat(s.lineHeight) || 1.5, unit: "MULTIPLIER" },
        letterSpacing: { value: parseFloat(s.letterSpacing) || 0, unit: "px" },
        paragraphSpacing: { value: parseFloat(s.paragraphSpacing) || 0, unit: "px" }
      }
    };
  }
  return data;
}

// ── Router ───────────────────────────────────────────────────────────────────
function generateTokenData(category, colorOpts, textStylesData, spacingData) {
  // Normalize: if a plain string is passed, wrap it
  if (typeof colorOpts === "string") colorOpts = { primary: colorOpts, secondary: "", tertiary: "" };
  switch (category) {
    case "colors":       return { filename: "colors.json",       data: generateColorTokens(colorOpts) };
    case "colors-light": return { filename: "colors-light.json", data: generateSemanticColors(colorOpts, "light") };
    case "colors-dark":  return { filename: "colors-dark.json",  data: generateSemanticColors(colorOpts, "dark") };
    case "spacing":      return { filename: "spacing.json",      data: generateSpacingData(spacingData) };
    case "text-styles":  return { filename: "text-styles.json",  data: generateTextStylesData(textStylesData) };
    case "radius":       return { filename: "radius.json",       data: generateRadiusData() };
    case "border":       return { filename: "border.json",       data: generateBorderData() };
    case "shadows":      return { filename: "shadows.json",      data: generateShadowsData() };
    case "zindex":       return { filename: "z-index.json",      data: generateZIndexData() };
    case "breakpoints":  return { filename: "breakpoints.json",  data: generateBreakpointsData() };
    default: throw new Error("Unknown generator category: " + category);
  }
}