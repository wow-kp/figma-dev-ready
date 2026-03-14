figma.showUI(__html__, { width: 920, height: 680, title: "Dev-Ready Tools for Designers by wowbrands" });

// Load saved settings and send to UI
(async function() {
  try {
    var saved = await figma.clientStorage.getAsync("wf-settings");
    if (saved) {
      figma.ui.postMessage({ type: "load-settings", settings: saved });
    }
  } catch(e) {}
})();

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

      var colorVars = 0, spacingVars = 0, radiusVars = 0, typographyVars = 0, shadowVars = 0, borderVars = 0, zindexVars = 0, breakpointVars = 0, otherVars = 0;
      for (var vi = 0; vi < allVars.length; vi++) {
        var v = allVars[vi];
        var colName = "";
        for (var ci = 0; ci < collections.length; ci++) {
          if (collections[ci].id === v.variableCollectionId) { colName = collections[ci].name.toLowerCase(); break; }
        }
        if (v.resolvedType === "COLOR") colorVars++;
        else if (colName.indexOf("spacing") !== -1 || colName.indexOf("gap") !== -1) spacingVars++;
        else if (colName.indexOf("radius") !== -1 || colName.indexOf("corner") !== -1) radiusVars++;
        else if (colName.indexOf("typography") !== -1 || colName.indexOf("font") !== -1) typographyVars++;
        else if (colName.indexOf("shadow") !== -1) shadowVars++;
        else if (colName.indexOf("border") !== -1) borderVars++;
        else if (colName.indexOf("z-index") !== -1 || colName.indexOf("zindex") !== -1) zindexVars++;
        else if (colName.indexOf("breakpoint") !== -1) breakpointVars++;
        else otherVars++;
      }

      figma.ui.postMessage({ type: "tokens-data", tokens: {
        colors: colorVars,
        spacing: spacingVars,
        radius: radiusVars,
        typography: typographyVars,
        shadows: shadowVars,
        border: borderVars,
        zindex: zindexVars,
        breakpoints: breakpointVars,
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
      textColor: msg.textColor || "#1A1A1A",
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
    var radiusData = msg.radius || [];
    var shadowsData = msg.shadows || [];
    var bordersData = msg.borders || [];
    var zindexData = msg.zindex || [];
    var typographyData = msg.typography || { sizes: [], weights: [], lineHeights: [] };
    var enabledCats = msg.enabledCategories || null;
    var GEN_ORDER = ["colors","colors-light","typography","spacing","text-styles","radius","border","shadows","zindex","breakpoints"];

    // Filter to only enabled categories if provided
    var catsToRun = enabledCats ? GEN_ORDER.filter(function(c) { return enabledCats.indexOf(c) !== -1; }) : GEN_ORDER;

    for (var gi = 0; gi < catsToRun.length; gi++) {
      try {
        var gd = generateTokenData(catsToRun[gi], colorOpts, textStylesData, spacingData, radiusData, shadowsData, bordersData, zindexData, typographyData, fontFamilies);
        var gr = await importTokens(gd.filename, gd.data);
        figma.ui.postMessage({ type:"generate-result", category:catsToRun[gi], success:true, message:gr });
      } catch(e) {
        figma.ui.postMessage({ type:"generate-result", category:catsToRun[gi], success:false, message:String(e) });
      }
    }
    // Generate specimen pages (Foundations & Components)
    try {
      var specimenMsg = {
        colorOpts: colorOpts,
        fontFamilies: fontFamilies,
        textStylesData: textStylesData,
        spacing: spacingData,
        radius: radiusData,
        shadows: shadowsData,
        borders: bordersData,
        zindex: zindexData,
        brandColor: brandHex,
        typography: typographyData
      };
      await generateFoundationsPage(specimenMsg);
      await generateComponentsPage(specimenMsg);
    } catch(e) {
      figma.ui.postMessage({ type:"generate-result", category:"specimens", success:false, message:"Specimen pages: " + String(e) });
    }

    figma.ui.postMessage({ type:"generate-complete" });
    // Refresh token counts for workflow step 2
    try {
      var allVars2 = figma.variables.getLocalVariables();
      var cols2 = figma.variables.getLocalVariableCollections();
      var ts2 = figma.getLocalTextStyles();
      var es2 = figma.getLocalEffectStyles();
      var cv2=0,sv2=0,rv2=0,tv2=0,shv2=0,bv2=0,zv2=0,bpv2=0,ov2=0;
      for(var vi2=0;vi2<allVars2.length;vi2++){var v2=allVars2[vi2];var cn2="";for(var ci2=0;ci2<cols2.length;ci2++){if(cols2[ci2].id===v2.variableCollectionId){cn2=cols2[ci2].name.toLowerCase();break;}}if(v2.resolvedType==="COLOR")cv2++;else if(cn2.indexOf("spacing")!==-1||cn2.indexOf("gap")!==-1)sv2++;else if(cn2.indexOf("radius")!==-1||cn2.indexOf("corner")!==-1)rv2++;else if(cn2.indexOf("typography")!==-1||cn2.indexOf("font")!==-1)tv2++;else if(cn2.indexOf("shadow")!==-1)shv2++;else if(cn2.indexOf("border")!==-1)bv2++;else if(cn2.indexOf("z-index")!==-1||cn2.indexOf("zindex")!==-1)zv2++;else if(cn2.indexOf("breakpoint")!==-1)bpv2++;else ov2++;}
      figma.ui.postMessage({type:"tokens-data",tokens:{colors:cv2,spacing:sv2,radius:rv2,typography:tv2,shadows:shv2,border:bv2,zindex:zv2,breakpoints:bpv2,other:ov2,textStyles:ts2.length,effectStyles:es2.length,collections:cols2.map(function(c){return{name:c.name,count:allVars2.filter(function(v){return v.variableCollectionId===c.id;}).length};})}});
    } catch(e){}
  }

  if (msg.type === "save-settings") {
    try {
      await figma.clientStorage.setAsync("wf-settings", msg.settings);
    } catch(e) {}
  }

  if (msg.type === "reset-tokens") {
    try {
      // Remove all local text styles
      var localTS = figma.getLocalTextStyles();
      for (var ti = 0; ti < localTS.length; ti++) {
        localTS[ti].remove();
      }
      // Remove all local variables and their collections
      var localVars = figma.variables.getLocalVariables();
      for (var vi = 0; vi < localVars.length; vi++) {
        localVars[vi].remove();
      }
      var localCols = figma.variables.getLocalVariableCollections();
      for (var ci = 0; ci < localCols.length; ci++) {
        localCols[ci].remove();
      }
      // Remove specimen frames from Foundations and Components pages
      var specimenHints = ["foundations", "components"];
      for (var spi = 0; spi < specimenHints.length; spi++) {
        for (var pi = 0; pi < figma.root.children.length; pi++) {
          if (figma.root.children[pi].name.toLowerCase().replace(/[^a-z]/g, "").indexOf(specimenHints[spi]) !== -1) {
            var spChildren = figma.root.children[pi].children.slice();
            for (var sci = 0; sci < spChildren.length; sci++) {
              try { spChildren[sci].remove(); } catch(e) {}
            }
            break;
          }
        }
      }
      figma.ui.postMessage({ type: "reset-complete" });
    } catch(e) {
      figma.ui.postMessage({ type: "reset-complete" });
    }
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

// ── Placeholder image helper ────────────────────────────────────────────────
// Generates a minimal single-color PNG and returns a Figma image hash
function createPlaceholderImageHash(r, g, b) {
  // CRC32 table
  var crcT = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcT[n] = c;
  }
  function crc32(buf) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = crcT[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    var tb = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    var crcIn = tb.concat(data);
    var cv = crc32(crcIn);
    var len = data.length;
    return [(len >>> 24) & 0xFF, (len >>> 16) & 0xFF, (len >>> 8) & 0xFF, len & 0xFF]
      .concat(tb).concat(data)
      .concat([(cv >>> 24) & 0xFF, (cv >>> 16) & 0xFF, (cv >>> 8) & 0xFF, cv & 0xFF]);
  }
  // IHDR: 1x1, 8-bit RGB
  var ihdr = chunk("IHDR", [0,0,0,1, 0,0,0,1, 8, 2, 0, 0, 0]);
  // IDAT: zlib stored block wrapping filter-byte + RGB
  var raw = [0x00, r, g, b];
  var s1 = 1, s2 = 1;
  for (var ai = 0; ai < raw.length; ai++) { s1 = (s1 + raw[ai]) % 65521; s2 = (s2 + s1) % 65521; }
  var adler = ((s2 << 16) | s1) >>> 0;
  var lenLo = raw.length & 0xFF, lenHi = (raw.length >> 8) & 0xFF;
  var idat = chunk("IDAT", [0x78, 0x01, 0x01, lenLo, lenHi, lenLo ^ 0xFF, lenHi ^ 0xFF]
    .concat(raw)
    .concat([(adler >>> 24) & 0xFF, (adler >>> 16) & 0xFF, (adler >>> 8) & 0xFF, adler & 0xFF]));
  var iend = chunk("IEND", []);
  var sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  var all = sig.concat(ihdr).concat(idat).concat(iend);
  var img = figma.createImage(new Uint8Array(all));
  return img.hash;
}

// ── Specimen helpers ─────────────────────────────────────────────────────────
function findPageByHint(hint) {
  for (var i = 0; i < figma.root.children.length; i++) {
    if (figma.root.children[i].name.toLowerCase().replace(/[^a-z]/g, "").indexOf(hint) !== -1) {
      return figma.root.children[i];
    }
  }
  // Auto-create the page if not found
  var pageName = hint.charAt(0).toUpperCase() + hint.slice(1);
  var newPage = figma.createPage();
  newPage.name = pageName;
  return newPage;
}

function hexToFigma(hex) {
  var h = hex.replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
}

function createSpecText(parent, text, x, y, size, style, color, opacity) {
  var t = figma.createText();
  var s = style || "Regular";
  // Try exact style, then common variants
  var variants = [s];
  if (s === "SemiBold") variants.push("Semi Bold", "Semibold");
  else if (s === "Semi Bold") variants.push("SemiBold", "Semibold");
  else if (s === "ExtraBold") variants.push("Extra Bold", "Extrabold");
  else if (s === "ExtraLight") variants.push("Extra Light", "Extralight");
  variants.push("Regular"); // last resort
  for (var vi = 0; vi < variants.length; vi++) {
    try { t.fontName = { family: "Inter", style: variants[vi] }; break; } catch(e) {}
  }
  t.fontSize = size || 14;
  t.characters = text;
  t.fills = [{ type: "SOLID", color: color || { r:0.2, g:0.2, b:0.2 }, opacity: opacity !== undefined ? opacity : 1 }];
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
}

function parseCssShadow(str) {
  if (!str) return null;
  var inset = /\binset\b/.test(str);
  if (inset) return null; // skip inset for specimens
  var clean = str.replace(/\binset\b/, "").trim();
  var colorMatch = clean.match(/rgba?\([^)]+\)/) || clean.match(/#[0-9a-fA-F]{3,8}/);
  var color = colorMatch ? colorMatch[0] : "rgba(0,0,0,0.2)";
  var nums = clean.replace(color, "").trim().split(/\s+/).map(function(v) { return parseFloat(v) || 0; });
  // Parse rgba color
  var figColor = { r: 0, g: 0, b: 0 };
  var alpha = 1;
  var rgbaMatch = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)/);
  if (rgbaMatch) {
    figColor = { r: parseFloat(rgbaMatch[1])/255, g: parseFloat(rgbaMatch[2])/255, b: parseFloat(rgbaMatch[3])/255 };
    alpha = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
  } else if (color.charAt(0) === "#") {
    figColor = hexToFigma(color);
  }
  return {
    type: "DROP_SHADOW", visible: true, blendMode: "NORMAL",
    color: { r: figColor.r, g: figColor.g, b: figColor.b, a: alpha },
    offset: { x: nums[0] || 0, y: nums[1] || 0 },
    radius: nums[2] || 0,
    spread: nums[3] || 0
  };
}

// ── Foundations page ─────────────────────────────────────────────────────────
async function generateFoundationsPage(msg) {
  var page = findPageByHint("foundations");
  if (!page) return;

  // Load all Inter + user font weights using fallback-aware loader
  var stdWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  for (var iw = 0; iw < stdWeights.length; iw++) {
    await loadFontWithFallback("Inter", stdWeights[iw]);
  }

  var fontFamilies = msg.fontFamilies || {};
  var userFonts = [fontFamilies.primary, fontFamilies.secondary, fontFamilies.tertiary].filter(Boolean);
  var loadedFamilies = {};
  for (var fi = 0; fi < userFonts.length; fi++) {
    var fam = userFonts[fi].split(",")[0].trim().replace(/['"]/g, "");
    if (loadedFamilies[fam] || fam === "Inter") continue;
    loadedFamilies[fam] = true;
    for (var fw = 0; fw < stdWeights.length; fw++) {
      await loadFontWithFallback(fam, stdWeights[fw]);
    }
  }

  // Remove existing specimens
  var existing = page.children.filter(function(n) { return n.name === "Foundations"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  var W = 1440, PAD = 80, SECTION_GAP = 60;
  var frame = figma.createFrame();
  frame.name = "Foundations";
  frame.clipsContent = false;
  frame.resize(W, 20000);
  frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  page.appendChild(frame);

  var y = PAD;

  // ── Section title helper ──
  function sectionTitle(title) {
    var t = createSpecText(frame, title, PAD, y, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    y += t.height + 8;
    var div = figma.createRectangle();
    div.resize(W - PAD * 2, 1);
    div.x = PAD; div.y = y;
    div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div);
    y += 24;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COLORS
  // ══════════════════════════════════════════════════════════════════════════
  var colorOpts = msg.colorOpts || {};
  var allColors = [];
  if (colorOpts.primary) allColors.push({ name: "primary", hex: colorOpts.primary });
  if (colorOpts.secondary) allColors.push({ name: "secondary", hex: colorOpts.secondary });
  if (colorOpts.tertiary) allColors.push({ name: "tertiary", hex: colorOpts.tertiary });
  if (colorOpts.textColor) allColors.push({ name: "text", hex: colorOpts.textColor });
  var customs = colorOpts.custom || [];
  for (var ci = 0; ci < customs.length; ci++) {
    if (customs[ci].name && customs[ci].hex) allColors.push(customs[ci]);
  }
  // Auto colors
  var autoColors = [
    { name: "black", hex: "#000000" }, { name: "white", hex: "#FFFFFF" }, { name: "gray", hex: "#E3E3E3" },
    { name: "focus-border", hex: "#000000" }, { name: "focus-color", hex: "#79797B" },
    { name: "error-border", hex: "#E32E22" }, { name: "error-color", hex: "#E32E22" }
  ];
  for (var ai = 0; ai < autoColors.length; ai++) {
    var hasIt = allColors.some(function(c) { return c.name === autoColors[ai].name; });
    if (!hasIt) allColors.push(autoColors[ai]);
  }

  if (allColors.length > 0) {
    sectionTitle("Colors");
    var SWATCH_W = 120, SWATCH_H = 80, SWATCH_GAP = 16, COLS = Math.min(8, Math.floor((W - PAD * 2 + SWATCH_GAP) / (SWATCH_W + SWATCH_GAP)));
    for (var si = 0; si < allColors.length; si++) {
      var col = si % COLS;
      var row = Math.floor(si / COLS);
      var sx = PAD + col * (SWATCH_W + SWATCH_GAP);
      var sy = y + row * (SWATCH_H + 36);

      var rect = figma.createRectangle();
      rect.name = "color/" + allColors[si].name;
      rect.resize(SWATCH_W, SWATCH_H);
      rect.x = sx; rect.y = sy;
      rect.cornerRadius = 8;
      rect.fills = [{ type: "SOLID", color: hexToFigma(allColors[si].hex) }];
      rect.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
      rect.strokeWeight = 1;
      frame.appendChild(rect);

      createSpecText(frame, allColors[si].name, sx, sy + SWATCH_H + 4, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, allColors[si].hex.toUpperCase(), sx, sy + SWATCH_H + 18, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
    }
    var colorRows = Math.ceil(allColors.length / COLS);
    y += colorRows * (SWATCH_H + 36) + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FONT FAMILIES
  // ══════════════════════════════════════════════════════════════════════════
  try {
    var ff = msg.fontFamilies || {};
    var ffEntries = [];
    if (ff.primary) ffEntries.push({ role: "Primary", family: ff.primary });
    if (ff.secondary && ff.secondary !== ff.primary) ffEntries.push({ role: "Secondary", family: ff.secondary });
    if (ff.tertiary && ff.tertiary !== ff.primary) ffEntries.push({ role: "Tertiary", family: ff.tertiary });

    if (ffEntries.length > 0) {
      sectionTitle("Font Families");
      var FF_CARD_W = 380, FF_CARD_H = 160, FF_GAP = 24;
      var ffCols = Math.min(ffEntries.length, Math.floor((W - PAD * 2 + FF_GAP) / (FF_CARD_W + FF_GAP)));

      for (var ffi = 0; ffi < ffEntries.length; ffi++) {
        var ffe = ffEntries[ffi];
        var ffCol = ffi % ffCols;
        var ffRow = Math.floor(ffi / ffCols);
        var ffX = PAD + ffCol * (FF_CARD_W + FF_GAP);
        var ffY = y + ffRow * (FF_CARD_H + FF_GAP);
        var ffFam = ffe.family.split(",")[0].trim().replace(/['"]/g, "");

        // Card background
        var ffCard = figma.createFrame();
        ffCard.name = "font/" + ffe.role.toLowerCase();
        ffCard.resize(FF_CARD_W, FF_CARD_H);
        ffCard.x = ffX; ffCard.y = ffY;
        ffCard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        ffCard.cornerRadius = 12;
        ffCard.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
        ffCard.strokeWeight = 1;
        ffCard.clipsContent = true;
        frame.appendChild(ffCard);

        // Role label
        var ffRoleLabel = figma.createText();
        ffRoleLabel.fontName = { family: "Inter", style: "Regular" };
        ffRoleLabel.fontSize = 10;
        ffRoleLabel.characters = ffe.role.toUpperCase();
        ffRoleLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
        ffRoleLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
        ffRoleLabel.x = 24; ffRoleLabel.y = 20;
        ffCard.appendChild(ffRoleLabel);

        // Font family name in its own font
        var ffNameStyle = await loadFontWithFallback(ffFam, 700);
        var ffNameNode = figma.createText();
        ffNameNode.fontName = { family: ffFam, style: ffNameStyle };
        ffNameNode.fontSize = 28;
        ffNameNode.characters = ffFam;
        ffNameNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        ffNameNode.x = 24; ffNameNode.y = 42;
        ffCard.appendChild(ffNameNode);

        // Sample alphabet in Regular
        var ffSampleStyle = await loadFontWithFallback(ffFam, 400);
        var ffSampleNode = figma.createText();
        ffSampleNode.fontName = { family: ffFam, style: ffSampleStyle };
        ffSampleNode.fontSize = 14;
        ffSampleNode.characters = "AaBbCcDdEeFfGgHhIiJjKkLl";
        ffSampleNode.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
        ffSampleNode.x = 24; ffSampleNode.y = 86;
        ffCard.appendChild(ffSampleNode);

        // Full family value as subtitle
        var ffValueNode = figma.createText();
        ffValueNode.fontName = { family: "Inter", style: "Regular" };
        ffValueNode.fontSize = 11;
        ffValueNode.characters = ffe.family;
        ffValueNode.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.55 } }];
        ffValueNode.x = 24; ffValueNode.y = 118;
        ffCard.appendChild(ffValueNode);

        // Weight samples row
        var ffWeightSamples = [
          { w: 300, label: "Light" },
          { w: 400, label: "Regular" },
          { w: 600, label: "SemiBold" },
          { w: 700, label: "Bold" }
        ];
        var ffwX = 24;
        for (var ffwi = 0; ffwi < ffWeightSamples.length; ffwi++) {
          var ffw = ffWeightSamples[ffwi];
          var ffwStyle = await loadFontWithFallback(ffFam, ffw.w);
          var ffwNode = figma.createText();
          ffwNode.fontName = { family: ffFam, style: ffwStyle };
          ffwNode.fontSize = 11;
          ffwNode.characters = ffw.label;
          ffwNode.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
          ffwNode.x = ffwX; ffwNode.y = 138;
          ffCard.appendChild(ffwNode);
          ffwX += ffwNode.width + 16;
        }
      }

      var ffRows = Math.ceil(ffEntries.length / ffCols);
      y += ffRows * (FF_CARD_H + FF_GAP) + SECTION_GAP;
    }
  } catch(ffErr) { console.log("[Foundations] Font Families error: " + ffErr); }

  // ══════════════════════════════════════════════════════════════════════════
  // TEXT STYLES
  // ══════════════════════════════════════════════════════════════════════════
  var textStylesData = msg.textStylesData || [];
  if (textStylesData.length > 0) {
    try {
    // Helper: find style by group + optional name
    function findTS(group, name) {
      for (var i = 0; i < textStylesData.length; i++) {
        if (textStylesData[i].group === group && (!name || textStylesData[i].name === name)) return textStylesData[i];
      }
      return null;
    }
    function filterTS(group) {
      var r = [];
      for (var i = 0; i < textStylesData.length; i++) {
        if (textStylesData[i].group === group) r.push(textStylesData[i]);
      }
      return r;
    }
    // Helper: create a styled text node from a text style entry
    async function makeStyledText(tsEntry, text, x, yPos) {
      var fam = (tsEntry.fontFamily || "Inter").split(",")[0].trim().replace(/['"]/g, "");
      var weight = tsEntry.fontWeight || 400;
      await loadFontWithFallback(fam, weight);
      var node = figma.createText();
      setFontName(node, fam, weight);
      node.fontSize = parseFloat(tsEntry.fontSize) || 16;
      if (tsEntry.lineHeight) node.lineHeight = { value: parseFloat(tsEntry.lineHeight) * 100, unit: "PERCENT" };
      if (tsEntry.letterSpacing && parseFloat(tsEntry.letterSpacing) !== 0) node.letterSpacing = { value: parseFloat(tsEntry.letterSpacing), unit: "PIXELS" };
      node.characters = text;
      node.fills = [{ type: "SOLID", color: colorOpts.textColor ? hexToFigma(colorOpts.textColor) : { r: 0.1, g: 0.1, b: 0.1 } }];
      node.x = x; node.y = yPos;
      frame.appendChild(node);
      return node;
    }

    var brandHexSpec = msg.brandColor || "#3B82F6";

    // ── Headings ──
    var headings = filterTS("heading");
    if (headings.length > 0) {
      sectionTitle("Headings");
      for (var hi = 0; hi < headings.length; hi++) {
        var hd = headings[hi];
        var hNode = await makeStyledText(hd, hd.name.toUpperCase() + " — The quick brown fox jumps over the lazy dog", PAD, y);
        var hMeta = hd.name + " · " + hd.fontSize + "px / " + hd.fontWeight + " / " + hd.lineHeight;
        createSpecText(frame, hMeta, PAD, y + Math.max(hNode.height, 20) + 2, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
        y += Math.max(hNode.height, 24) + 26;
      }
      y += SECTION_GAP;
    }

    // ── Body / Paragraphs ──
    var bodies = filterTS("body");
    if (bodies.length > 0) {
      sectionTitle("Paragraphs");
      var paraText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
      for (var bdi = 0; bdi < bodies.length; bdi++) {
        var bd = bodies[bdi];
        createSpecText(frame, "body/" + bd.name + " · " + bd.fontSize + "px / " + bd.fontWeight + " / lh:" + bd.lineHeight, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        var bNode = await makeStyledText(bd, paraText, PAD, y);
        bNode.resize(W - PAD * 2, bNode.height);
        bNode.textAutoResize = "HEIGHT";
        y += bNode.height + 24;
      }
      y += SECTION_GAP;
    }

    // ── Lists ──
    var bodyDefault = findTS("body", "default") || findTS("body", "lg") || (bodies && bodies[0] ? bodies[0] : null);
    if (bodyDefault) {
      sectionTitle("Lists");
      var COL_W = Math.floor((W - PAD * 2 - 40) / 2);

      createSpecText(frame, "Unordered List", PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
      createSpecText(frame, "Ordered List", PAD + COL_W + 40, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
      y += 18;

      var ulItems = ["First item in the list", "Second item with more text", "Third item to show rhythm", "Fourth and final item"];
      var olItems = ["Prepare the design tokens", "Configure typography settings", "Review color palette choices", "Export and hand off to dev"];

      var ulStartY = y;
      for (var uli = 0; uli < ulItems.length; uli++) {
        var bullet = await makeStyledText(bodyDefault, "•   " + ulItems[uli], PAD, y);
        y += Math.max(bullet.height, 20) + 6;
      }
      var ulEndY = y;

      var olY = ulStartY;
      for (var oli = 0; oli < olItems.length; oli++) {
        var olNode = await makeStyledText(bodyDefault, (oli + 1) + ".  " + olItems[oli], PAD + COL_W + 40, olY);
        olY += Math.max(olNode.height, 20) + 6;
      }
      y = Math.max(ulEndY, olY);
      y += SECTION_GAP;
    }

    // ── Links ──
    var links = filterTS("links");
    if (links.length > 0) {
      sectionTitle("Links");
      var linkColor = hexToFigma(brandHexSpec);
      for (var lki = 0; lki < links.length; lki++) {
        var lk = links[lki];
        var lkFam = (lk.fontFamily || "Inter").split(",")[0].trim().replace(/['"]/g, "");
        var lkWt = lk.fontWeight || 500;
        await loadFontWithFallback(lkFam, lkWt);

        createSpecText(frame, "links/" + lk.name + " · " + lk.fontSize + "px / " + lk.fontWeight, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;

        var lkNode = figma.createText();
        setFontName(lkNode, lkFam, lkWt);
        lkNode.fontSize = parseFloat(lk.fontSize) || 16;
        if (lk.lineHeight) lkNode.lineHeight = { value: parseFloat(lk.lineHeight) * 100, unit: "PERCENT" };
        lkNode.characters = "This is a link example — click here to learn more";
        lkNode.fills = [{ type: "SOLID", color: linkColor }];
        lkNode.textDecoration = "UNDERLINE";
        lkNode.x = PAD; lkNode.y = y;
        frame.appendChild(lkNode);
        y += Math.max(lkNode.height, 20) + 20;
      }
      y += SECTION_GAP;
    }

    // ── Buttons / Input / Label text styles (compact reference) ──
    var otherGroups = ["buttons", "input", "label"];
    var otherStyles = [];
    for (var ogi = 0; ogi < otherGroups.length; ogi++) {
      var gs = filterTS(otherGroups[ogi]);
      for (var gsi = 0; gsi < gs.length; gsi++) otherStyles.push(gs[gsi]);
    }
    if (otherStyles.length > 0) {
      sectionTitle("UI Text Styles");
      for (var usi = 0; usi < otherStyles.length; usi++) {
        var us = otherStyles[usi];
        var usLabel = us.group + "/" + us.name;
        createSpecText(frame, usLabel + " · " + us.fontSize + "px / " + us.fontWeight, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        var usNode = await makeStyledText(us, usLabel + " — Sample text preview", PAD, y);
        y += Math.max(usNode.height, 20) + 16;
      }
      y += SECTION_GAP;
    }
    } catch(tsErr) { console.log("[Foundations] Text Styles section error: " + tsErr); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TYPOGRAPHY VARIABLES (sizes, weights, line-heights)
  // ══════════════════════════════════════════════════════════════════════════
  var typo = msg.typography || { sizes: [], weights: [], lineHeights: [] };
  var hasSizes = typo.sizes && typo.sizes.length > 0;
  var hasWeights = typo.weights && typo.weights.length > 0;
  var hasLH = typo.lineHeights && typo.lineHeights.length > 0;

  if (hasSizes || hasWeights || hasLH) {
    sectionTitle("Typography Scale");
    console.log("[Foundations] Typography Scale: sizes=" + (typo.sizes ? typo.sizes.length : 0) + " weights=" + (typo.weights ? typo.weights.length : 0) + " lh=" + (typo.lineHeights ? typo.lineHeights.length : 0));

    // ── Font Sizes ──
    if (hasSizes) {
      try {
        createSpecText(frame, "Font Sizes", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 });
        y += 24;
        for (var fsi = 0; fsi < typo.sizes.length; fsi++) {
          var sz = typo.sizes[fsi];
          var pxVal = parseFloat(sz.value) || 16;
          var sizeText = figma.createText();
          sizeText.fontName = { family: "Inter", style: "Regular" };
          sizeText.fontSize = Math.min(pxVal, 60);
          sizeText.characters = sz.name + " — " + sz.value + "px";
          sizeText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          sizeText.x = PAD; sizeText.y = y;
          frame.appendChild(sizeText);
          y += Math.max(sizeText.height, 20) + 8;
        }
        y += 24;
      } catch(e) { console.log("[Foundations] Font Sizes error: " + e); }
    }

    // ── Font Weights ──
    if (hasWeights) {
      try {
        createSpecText(frame, "Font Weights", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 });
        y += 24;
        var wx = PAD;
        for (var fwi = 0; fwi < typo.weights.length; fwi++) {
          var wt = typo.weights[fwi];
          await loadFontWithFallback("Inter", wt.value);
          var wtText = figma.createText();
          setFontName(wtText, "Inter", wt.value);
          wtText.fontSize = 16;
          wtText.characters = wt.name + " (" + wt.value + ")";
          wtText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          wtText.x = wx; wtText.y = y;
          frame.appendChild(wtText);
          wx += 140;
          if (wx + 140 > W - PAD) { wx = PAD; y += 32; }
        }
        y += 40;
      } catch(e) { console.log("[Foundations] Font Weights error: " + e); }
    }

    // ── Line Heights ──
    if (hasLH) {
      try {
        createSpecText(frame, "Line Heights", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 });
        y += 24;
        for (var lhi = 0; lhi < typo.lineHeights.length; lhi++) {
          var lh = typo.lineHeights[lhi];
          createSpecText(frame, lh.name + ": " + lh.value, PAD, y, 12, "Regular", { r: 0.3, g: 0.3, b: 0.3 });
          y += 20;
        }
        y += 16;
      } catch(e) { console.log("[Foundations] Line Heights error: " + e); }
    }
    y += SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPACING
  // ══════════════════════════════════════════════════════════════════════════
  var spacingData = msg.spacing || [];
  if (spacingData.length > 0) {
    sectionTitle("Spacing");
    for (var spi = 0; spi < spacingData.length; spi++) {
      var sp = spacingData[spi];
      var spVal = parseFloat(sp.value) || 0;
      createSpecText(frame, sp.name, PAD, y + 2, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, spVal + "px", PAD + 60, y + 2, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });

      if (spVal > 0) {
        var bar = figma.createRectangle();
        bar.name = "spacing/" + sp.name;
        bar.resize(Math.min(spVal * 3, W - PAD * 2 - 120), 12);
        bar.x = PAD + 110; bar.y = y + 1;
        bar.cornerRadius = 2;
        bar.fills = [{ type: "SOLID", color: hexToFigma(msg.brandColor || "#3B82F6"), opacity: 0.25 }];
        frame.appendChild(bar);
      }
      y += 22;
    }
    y += SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RADIUS
  // ══════════════════════════════════════════════════════════════════════════
  var radiusData = msg.radius || [];
  if (radiusData.length > 0) {
    sectionTitle("Radius");
    var rx = PAD;
    for (var ri = 0; ri < radiusData.length; ri++) {
      var rad = radiusData[ri];
      var rv = parseFloat(rad.value) || 0;
      var rRect = figma.createRectangle();
      rRect.name = "radius/" + rad.name;
      rRect.resize(80, 80);
      rRect.x = rx; rRect.y = y;
      rRect.cornerRadius = Math.min(rv, 40);
      rRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      rRect.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.12 }];
      rRect.strokeWeight = 1.5;
      frame.appendChild(rRect);

      createSpecText(frame, rad.name, rx, y + 86, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, rv + "px", rx, y + 100, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      rx += 112;
      if (rx + 112 > W - PAD) { rx = PAD; y += 120; }
    }
    y += 120 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHADOWS
  // ══════════════════════════════════════════════════════════════════════════
  var shadowsData = msg.shadows || [];
  if (shadowsData.length > 0) {
    sectionTitle("Shadows");
    var shx = PAD;
    for (var shi = 0; shi < shadowsData.length; shi++) {
      var sh = shadowsData[shi];
      var effect = parseCssShadow(sh.value);
      var shRect = figma.createRectangle();
      shRect.name = "shadow/" + sh.name;
      shRect.resize(120, 80);
      shRect.x = shx; shRect.y = y;
      shRect.cornerRadius = 8;
      shRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      if (effect) shRect.effects = [effect];
      frame.appendChild(shRect);

      createSpecText(frame, sh.name, shx, y + 86, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, sh.value, shx, y + 100, 9, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      shx += 152;
      if (shx + 152 > W - PAD) { shx = PAD; y += 130; }
    }
    y += 120 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BORDERS
  // ══════════════════════════════════════════════════════════════════════════
  var bordersData = msg.borders || [];
  if (bordersData.length > 0) {
    sectionTitle("Borders");
    var bx = PAD;
    for (var bi = 0; bi < bordersData.length; bi++) {
      var bd = bordersData[bi];
      var bv = parseFloat(bd.value) || 1;
      var bRect = figma.createRectangle();
      bRect.name = "border/" + bd.name;
      bRect.resize(100, 60);
      bRect.x = bx; bRect.y = y;
      bRect.cornerRadius = 4;
      bRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      bRect.strokes = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
      bRect.strokeWeight = bv;
      frame.appendChild(bRect);

      createSpecText(frame, bd.name, bx, y + 66, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, bv + "px", bx, y + 80, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      bx += 132;
      if (bx + 132 > W - PAD) { bx = PAD; y += 100; }
    }
    y += 100 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Z-INDEX
  // ══════════════════════════════════════════════════════════════════════════
  var zindexData = msg.zindex || [];
  if (zindexData.length > 0) {
    sectionTitle("Z-Index");
    // Render as a visual stacking diagram
    var maxZ = 1;
    for (var zi = 0; zi < zindexData.length; zi++) {
      var zVal = Math.abs(parseFloat(zindexData[zi].value) || 0);
      if (zVal > maxZ) maxZ = zVal;
    }
    for (var zi2 = 0; zi2 < zindexData.length; zi2++) {
      var zItem = zindexData[zi2];
      var zv = parseFloat(zItem.value) || 0;
      var barW = Math.max(20, Math.round((Math.abs(zv) / maxZ) * (W - PAD * 2 - 160)));
      createSpecText(frame, zItem.name, PAD, y + 2, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, String(zv), PAD + 80, y + 2, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      var zBar = figma.createRectangle();
      zBar.name = "zindex/" + zItem.name;
      zBar.resize(barW, 14);
      zBar.x = PAD + 130; zBar.y = y;
      zBar.cornerRadius = 3;
      zBar.fills = [{ type: "SOLID", color: hexToFigma(msg.brandColor || "#3B82F6"), opacity: 0.15 + 0.6 * (Math.abs(zv) / maxZ) }];
      frame.appendChild(zBar);
      y += 24;
    }
    y += SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BREAKPOINTS
  // ══════════════════════════════════════════════════════════════════════════
  var breakpoints = [
    { name: "xs", value: 0 }, { name: "sm", value: 567 },
    { name: "md", value: 767 }, { name: "lg", value: 991 }
  ];
  sectionTitle("Breakpoints");
  var bpMaxW = W - PAD * 2;
  var bpScale = bpMaxW / 1200;
  for (var bpi = 0; bpi < breakpoints.length; bpi++) {
    var bp = breakpoints[bpi];
    var bpBarW = Math.max(40, Math.round(Math.max(bp.value, 50) * bpScale));
    createSpecText(frame, bp.name + " ≥ " + bp.value + "px", PAD, y + 2, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
    var bpBar = figma.createRectangle();
    bpBar.name = "breakpoint/" + bp.name;
    bpBar.resize(bpBarW, 16);
    bpBar.x = PAD + 130; bpBar.y = y;
    bpBar.cornerRadius = 3;
    bpBar.fills = [{ type: "SOLID", color: hexToFigma(msg.brandColor || "#3B82F6"), opacity: 0.12 + bpi * 0.15 }];
    frame.appendChild(bpBar);
    y += 28;
  }
  y += PAD;

  // Resize frame to fit all content — measure actual children
  var maxBottom = y;
  for (var mi = 0; mi < frame.children.length; mi++) {
    var child = frame.children[mi];
    var childBottom = child.y + child.height;
    if (childBottom > maxBottom) maxBottom = childBottom;
  }
  var finalH = maxBottom + PAD;
  frame.resize(W, Math.max(finalH, 400));
  frame.clipsContent = true;
  console.log("[Foundations] frame resized to " + W + "x" + Math.max(finalH, 400) + ", children: " + frame.children.length + ", y=" + y);
}

// ── Components page ─────────────────────────────────────────────────────────
async function generateComponentsPage(msg) {
  var page = findPageByHint("components");
  if (!page) return;

  var compWeights = [400, 500, 600, 700];
  for (var cw = 0; cw < compWeights.length; cw++) {
    await loadFontWithFallback("Inter", compWeights[cw]);
  }

  var fontFamilies = msg.fontFamilies || {};
  var userFonts = [fontFamilies.primary, fontFamilies.secondary, fontFamilies.tertiary].filter(Boolean);
  for (var fi = 0; fi < userFonts.length; fi++) {
    var fam = userFonts[fi].split(",")[0].trim().replace(/['"]/g, "");
    if (fam === "Inter") continue;
    for (var cwi = 0; cwi < compWeights.length; cwi++) {
      await loadFontWithFallback(fam, compWeights[cwi]);
    }
  }

  // Remove existing specimens
  var existing = page.children.filter(function(n) { return n.name === "Components"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  var W = 1440, PAD = 80, SECTION_GAP = 80;
  var frame = figma.createFrame();
  frame.name = "Components";
  frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  page.appendChild(frame);

  var y = PAD;
  var brandColor = hexToFigma(msg.brandColor || "#3B82F6");

  function sectionTitle(title) {
    var t = createSpecText(frame, title, PAD, y, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    y += t.height + 8;
    var div = figma.createRectangle();
    div.resize(W - PAD * 2, 1);
    div.x = PAD; div.y = y;
    div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div);
    y += 24;
  }

  // Find text styles by group/name
  var localStyles = figma.getLocalTextStyles();
  function findStyle(group, name) {
    var styleName = group + "/" + name;
    for (var i = 0; i < localStyles.length; i++) {
      if (localStyles[i].name === styleName) return localStyles[i];
    }
    return null;
  }

  // Get radius value
  var radiusData = msg.radius || [];
  var defaultRadius = 8;
  for (var ri = 0; ri < radiusData.length; ri++) {
    if (radiusData[ri].name === "md" || radiusData[ri].name === "default") {
      defaultRadius = parseFloat(radiusData[ri].value) || 8;
      break;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BUTTONS (component set with Variant + Size properties)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Buttons");
  var btnSizes = [
    { label: "Large",   style: "lg" },
    { label: "Default", style: "default" },
    { label: "Small",   style: "sm" }
  ];
  var btnVariants = [
    { label: "Primary",   filled: true },
    { label: "Secondary", filled: false },
  ];

  var allBtnComps = [];
  for (var bvi = 0; bvi < btnVariants.length; bvi++) {
    var variant = btnVariants[bvi];
    for (var bsi = 0; bsi < btnSizes.length; bsi++) {
      var bs = btnSizes[bsi];
      var ts = findStyle("buttons", bs.style);
      var padH = bs.style === "lg" ? 16 : (bs.style === "sm" ? 8 : 12);
      var padW = bs.style === "lg" ? 32 : (bs.style === "sm" ? 16 : 24);

      var btnComp = figma.createComponent();
      btnComp.name = "Variant=" + variant.label + ", Size=" + bs.label;
      btnComp.cornerRadius = defaultRadius;

      if (variant.filled) {
        btnComp.fills = [{ type: "SOLID", color: brandColor }];
      } else {
        btnComp.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        btnComp.strokes = [{ type: "SOLID", color: brandColor }];
        btnComp.strokeWeight = 1.5;
      }

      var btnText = figma.createText();
      if (ts) {
        btnText.textStyleId = ts.id;
      } else {
        btnText.fontName = { family: "Inter", style: "Semi Bold" };
        btnText.fontSize = bs.style === "lg" ? 18 : (bs.style === "sm" ? 14 : 16);
      }
      btnText.characters = "Button";
      btnText.fills = [{ type: "SOLID", color: variant.filled ? { r: 1, g: 1, b: 1 } : brandColor }];

      btnComp.layoutMode = "HORIZONTAL";
      btnComp.primaryAxisAlignItems = "CENTER";
      btnComp.counterAxisAlignItems = "CENTER";
      btnComp.paddingTop = padH; btnComp.paddingBottom = padH;
      btnComp.paddingLeft = padW; btnComp.paddingRight = padW;
      btnComp.primaryAxisSizingMode = "AUTO";
      btnComp.counterAxisSizingMode = "AUTO";
      btnComp.appendChild(btnText);

      allBtnComps.push(btnComp);
    }
  }

  var btnSet = figma.combineAsVariants(allBtnComps, frame);
  btnSet.name = "Button";
  btnSet.x = PAD; btnSet.y = y;
  btnSet.layoutMode = "HORIZONTAL";
  btnSet.layoutWrap = "WRAP";
  btnSet.itemSpacing = 16;
  btnSet.counterAxisSpacing = 16;
  btnSet.paddingTop = 24; btnSet.paddingBottom = 24;
  btnSet.paddingLeft = 24; btnSet.paddingRight = 24;
  btnSet.primaryAxisSizingMode = "AUTO";
  btnSet.counterAxisSizingMode = "AUTO";
  btnSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  btnSet.cornerRadius = 12;
  btnSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  btnSet.strokeWeight = 1;
  y += btnSet.height + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // INPUTS (component set with State property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Inputs");
  var inputStyle = findStyle("input", "default");
  var labelStyle = findStyle("label", "default");
  var inputStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5 },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2 },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5 },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1 },
  ];

  var allInputComps = [];
  for (var isi = 0; isi < inputStates.length; isi++) {
    var ist = inputStates[isi];

    var inputComp = figma.createComponent();
    inputComp.name = "State=" + ist.label;
    inputComp.layoutMode = "VERTICAL";
    inputComp.primaryAxisSizingMode = "AUTO";
    inputComp.counterAxisSizingMode = "AUTO";
    inputComp.itemSpacing = 6;
    inputComp.fills = [];

    // Label
    var lbl = figma.createText();
    if (labelStyle) {
      lbl.textStyleId = labelStyle.id;
    } else {
      lbl.fontName = { family: "Inter", style: "Medium" };
      lbl.fontSize = 12;
    }
    lbl.characters = ist.label === "Error" ? "Error Label" : "Label";
    lbl.fills = [{ type: "SOLID", color: ist.label === "Error" ? hexToFigma("#E32E22") : { r: 0.2, g: 0.2, b: 0.2 } }];
    if (ist.label === "Disabled") lbl.opacity = 0.5;
    inputComp.appendChild(lbl);

    // Input field
    var inputField = figma.createFrame();
    inputField.name = "field";
    inputField.resize(260, 44);
    inputField.cornerRadius = defaultRadius;
    inputField.fills = [{ type: "SOLID", color: ist.label === "Disabled" ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
    inputField.strokes = [{ type: "SOLID", color: ist.borderColor }];
    inputField.strokeWeight = ist.strokeW;

    inputField.layoutMode = "HORIZONTAL";
    inputField.counterAxisAlignItems = "CENTER";
    inputField.paddingLeft = 14; inputField.paddingRight = 14;
    inputField.paddingTop = 10; inputField.paddingBottom = 10;
    inputField.primaryAxisSizingMode = "FIXED";
    inputField.counterAxisSizingMode = "FIXED";

    var inputText = figma.createText();
    if (inputStyle) {
      inputText.textStyleId = inputStyle.id;
    } else {
      inputText.fontName = { family: "Inter", style: "Regular" };
      inputText.fontSize = 14;
    }
    inputText.characters = ist.label === "Disabled" ? "Disabled" : "Placeholder text";
    inputText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
    if (ist.label === "Disabled") inputText.opacity = 0.5;
    inputField.appendChild(inputText);
    inputComp.appendChild(inputField);

    allInputComps.push(inputComp);
  }

  var inputSet = figma.combineAsVariants(allInputComps, frame);
  inputSet.name = "Input";
  inputSet.x = PAD; inputSet.y = y;
  inputSet.layoutMode = "HORIZONTAL";
  inputSet.itemSpacing = 24;
  inputSet.paddingTop = 24; inputSet.paddingBottom = 24;
  inputSet.paddingLeft = 24; inputSet.paddingRight = 24;
  inputSet.primaryAxisSizingMode = "AUTO";
  inputSet.counterAxisSizingMode = "AUTO";
  inputSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  inputSet.cornerRadius = 12;
  inputSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  inputSet.strokeWeight = 1;
  y += inputSet.height + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // LABELS (component set with State property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Labels");
  if (labelStyle) {
    var lblStates = [
      { label: "Default",  color: { r: 0.2, g: 0.2, b: 0.2 }, text: "Label" },
      { label: "Required", color: { r: 0.2, g: 0.2, b: 0.2 }, text: "Label *" },
      { label: "Disabled", color: { r: 0.6, g: 0.6, b: 0.6 }, text: "Label" },
    ];
    var allLblComps = [];
    for (var li = 0; li < lblStates.length; li++) {
      var ls = lblStates[li];
      var lblComp = figma.createComponent();
      lblComp.name = "State=" + ls.label;
      lblComp.layoutMode = "HORIZONTAL";
      lblComp.primaryAxisSizingMode = "AUTO";
      lblComp.counterAxisSizingMode = "AUTO";
      lblComp.fills = [];

      var lblNode = figma.createText();
      lblNode.textStyleId = labelStyle.id;
      lblNode.characters = ls.text;
      lblNode.fills = [{ type: "SOLID", color: ls.color }];
      lblComp.appendChild(lblNode);

      allLblComps.push(lblComp);
    }

    var lblSet = figma.combineAsVariants(allLblComps, frame);
    lblSet.name = "Label";
    lblSet.x = PAD; lblSet.y = y;
    lblSet.layoutMode = "HORIZONTAL";
    lblSet.itemSpacing = 24;
    lblSet.paddingTop = 24; lblSet.paddingBottom = 24;
    lblSet.paddingLeft = 24; lblSet.paddingRight = 24;
    lblSet.primaryAxisSizingMode = "AUTO";
    lblSet.counterAxisSizingMode = "AUTO";
    lblSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    lblSet.cornerRadius = 12;
    lblSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    lblSet.strokeWeight = 1;
    y += lblSet.height + 30;
  }
  y += SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // IMAGE WRAPPERS (component set with Radius property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Images");

  // Look up the Radius variable collection and build a name→variable map
  var radiusCols = figma.variables.getLocalVariableCollections().filter(function(c) {
    return c.name.toLowerCase().indexOf("radius") !== -1;
  });
  var radiusVarMap = {};
  if (radiusCols.length > 0) {
    var radiusCol = radiusCols[0];
    var allRadiusVars = figma.variables.getLocalVariables().filter(function(v) {
      return v.variableCollectionId === radiusCol.id && v.resolvedType === "FLOAT";
    });
    for (var rvi = 0; rvi < allRadiusVars.length; rvi++) {
      var rv = allRadiusVars[rvi];
      // Use the last segment of the variable name as key (e.g. "radius/sm" → "sm")
      var rvName = rv.name.split("/").pop();
      radiusVarMap[rvName] = rv;
    }
  }

  // Build radius entries from the variable map, falling back to radiusData config
  var imgRadii = [];
  var usedRadiusNames = {};
  // Prefer variables (they carry the binding)
  for (var rvk in radiusVarMap) {
    if (radiusVarMap.hasOwnProperty(rvk)) {
      var rvVal = 0;
      try {
        var modeId = radiusCols[0].modes[0].modeId;
        rvVal = parseFloat(radiusVarMap[rvk].valuesByMode[modeId]) || 0;
      } catch(e) {}
      imgRadii.push({ label: rvk, value: rvVal, variable: radiusVarMap[rvk] });
      usedRadiusNames[rvk] = true;
    }
  }
  // Fill in any from config that aren't already covered
  if (imgRadii.length === 0) {
    for (var iri = 0; iri < radiusData.length; iri++) {
      if (!usedRadiusNames[radiusData[iri].name]) {
        imgRadii.push({ label: radiusData[iri].name, value: parseFloat(radiusData[iri].value) || 0, variable: null });
      }
    }
  }
  // Always add a "full" (circle) variant
  imgRadii.push({ label: "full", value: 9999, variable: null });

  var placeholderHash = createPlaceholderImageHash(0xE8, 0xEB, 0xED);
  var IMG_W = 240, IMG_H = 160;

  var allImgComps = [];
  for (var imri = 0; imri < imgRadii.length; imri++) {
    var imgR = imgRadii[imri];

    var isFull = imgR.label === "full";
    var compW = isFull ? IMG_H : IMG_W; // square for "full" so it's a perfect circle
    var compH = IMG_H;

    var imgComp = figma.createComponent();
    imgComp.name = "Radius=" + imgR.label;
    imgComp.resize(compW, compH);
    imgComp.clipsContent = true;
    imgComp.fills = [];

    var appliedR = isFull ? compH / 2 : imgR.value;
    imgComp.cornerRadius = appliedR;

    // Bind corner radius to the Figma variable if available
    if (imgR.variable) {
      try {
        imgComp.setBoundVariable("topLeftRadius", imgR.variable);
        imgComp.setBoundVariable("topRightRadius", imgR.variable);
        imgComp.setBoundVariable("bottomLeftRadius", imgR.variable);
        imgComp.setBoundVariable("bottomRightRadius", imgR.variable);
      } catch(e) {}
    }

    // Child rectangle with placeholder image — user replaces the image fill
    var imgRect = figma.createRectangle();
    imgRect.name = "image";
    imgRect.resize(compW, compH);
    imgRect.x = 0; imgRect.y = 0;
    imgRect.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
    imgRect.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    imgComp.appendChild(imgRect);

    allImgComps.push(imgComp);
  }

  if (allImgComps.length > 0) {
    var imgSet = figma.combineAsVariants(allImgComps, frame);
    imgSet.name = "Image";
    imgSet.x = PAD; imgSet.y = y;
    imgSet.layoutMode = "HORIZONTAL";
    imgSet.itemSpacing = 24;
    imgSet.paddingTop = 24; imgSet.paddingBottom = 24;
    imgSet.paddingLeft = 24; imgSet.paddingRight = 24;
    imgSet.primaryAxisSizingMode = "AUTO";
    imgSet.counterAxisSizingMode = "AUTO";
    imgSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    imgSet.cornerRadius = 12;
    imgSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    imgSet.strokeWeight = 1;
    y += imgSet.height + SECTION_GAP;
  }

  y += PAD;

  frame.resize(W, y);
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

// Returns an array of style name candidates to try (Figma font naming varies between fonts)
function weightToStyleCandidates(w) {
  var n = parseInt(w) || 400;
  if (n <= 100) return ["Thin"];
  if (n <= 200) return ["ExtraLight", "Extra Light", "UltraLight", "Ultra Light"];
  if (n <= 300) return ["Light"];
  if (n <= 400) return ["Regular"];
  if (n <= 500) return ["Medium"];
  if (n <= 600) return ["SemiBold", "Semi Bold", "DemiBold", "Demi Bold"];
  if (n <= 700) return ["Bold"];
  if (n <= 800) return ["ExtraBold", "Extra Bold", "UltraBold", "Ultra Bold"];
  return ["Black", "Heavy"];
}
function weightToStyle(w) { return weightToStyleCandidates(w)[0]; }

// Load a font trying all style name candidates
async function loadFontWithFallback(family, weight) {
  var candidates = weightToStyleCandidates(weight);
  for (var i = 0; i < candidates.length; i++) {
    try {
      await figma.loadFontAsync({ family: family, style: candidates[i] });
      return candidates[i]; // return the style that worked
    } catch(e) {}
  }
  // Last resort: try Regular
  try { await figma.loadFontAsync({ family: family, style: "Regular" }); } catch(e) {}
  return "Regular";
}

// Set fontName trying all style candidates
function setFontName(node, family, weight) {
  var candidates = weightToStyleCandidates(weight);
  for (var i = 0; i < candidates.length; i++) {
    try {
      node.fontName = { family: family, style: candidates[i] };
      return candidates[i];
    } catch(e) {}
  }
  try { node.fontName = { family: "Inter", style: "Regular" }; } catch(e) {}
  return "Regular";
}

async function importTextStyles(data){
  // Pre-load all needed fonts with fallback
  var fontsToLoad=[],seen={};
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var weight=val.fontWeight||400;var k=family+":"+weight;if(!seen[k]){seen[k]=true;fontsToLoad.push({family:family,weight:weight});}});});
  // Resolve actual style names per family+weight
  var resolvedStyles={};
  for(var fi=0;fi<fontsToLoad.length;fi++){
    var f=fontsToLoad[fi];
    var actualStyle=await loadFontWithFallback(f.family,f.weight);
    resolvedStyles[f.family+":"+f.weight]=actualStyle;
  }
  var existingStyles=figma.getLocalTextStyles(),styleMap={};existingStyles.forEach(function(s){styleMap[s.name]=s;});
  var count=0,skipped=0;
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var styleName=groupKey+"/"+key;try{var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var weight=val.fontWeight||400;var fontStyle=resolvedStyles[family+":"+weight]||"Regular";var style=styleMap[styleName]||figma.createTextStyle();style.name=styleName;style.fontName={family:family,style:fontStyle};var fs=val.fontSize;style.fontSize=typeof fs==="object"?(fs.value||16):(parseFloat(fs)||16);var lh=val.lineHeight;if(lh){if(typeof lh==="object"){if(lh.unit==="PIXELS")style.lineHeight={unit:"PIXELS",value:lh.value||24};else if(lh.unit==="MULTIPLIER"){var lhPx=(lh.value||1.5)*style.fontSize;style.lineHeight={unit:"PIXELS",value:lhPx};}else style.lineHeight={unit:"PERCENT",value:(lh.value||1.5)*100};}else style.lineHeight={unit:"PERCENT",value:(parseFloat(lh)||1.5)*100};}var ls=val.letterSpacing;if(ls!==undefined){var lsVal=typeof ls==="object"?ls.value:(parseFloat(ls)||0);style.letterSpacing={unit:"PIXELS",value:lsVal};}var ps=val.paragraphSpacing;if(ps!==undefined)style.paragraphSpacing=typeof ps==="object"?(ps.value||0):(parseFloat(ps)||0);var td=val.textDecoration;style.textDecoration=(td&&td!=="NONE")?td:"NONE";if(token["$description"])style.description=token["$description"];styleMap[styleName]=style;count++;}catch(e){skipped++;}});});
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

function generateSemanticColors(colorOpts) {
  var pri = hexToHsl(colorOpts.primary);
  var h = pri.h, s = pri.s;

  var result = {
    brand: {
      primary: makeColorHSL(h, s, 50)
    },
    text: {
      primary: colorOpts.textColor ? makeColorHex(colorOpts.textColor) : makeColorHSL(h, 10, 10)
    },
    border: {
      "default": makeColorHex("#E3E3E3")
    },
    overlay: {
      scrim: { "$type": "color", "$value": { colorSpace: "srgb", components: [0, 0, 0], alpha: 0.85 } }
    }
  };

  // Only include secondary/tertiary brand colors if user explicitly set them
  if (colorOpts.secondary) {
    var sec = hexToHsl(colorOpts.secondary);
    result.brand.secondary = makeColorHSL(sec.h, sec.s, 55);
  }
  if (colorOpts.tertiary) {
    var ter = hexToHsl(colorOpts.tertiary);
    result.brand.accent = makeColorHSL(ter.h, ter.s, 50);
  }

  return result;
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

function generateRadiusData(radiusList) {
  var tokens = {};
  for (var i = 0; i < radiusList.length; i++) {
    var r = radiusList[i];
    if (r.name) {
      tokens[r.name] = { "$type": "dimension", "$value": { value: parseFloat(r.value) || 0, unit: "px" } };
    }
  }
  return tokens;
}

function generateBorderData(bordersList) {
  var tokens = {};
  for (var i = 0; i < bordersList.length; i++) {
    var b = bordersList[i];
    if (b.name) {
      tokens[b.name] = { "$type": "dimension", "$value": { value: parseFloat(b.value) || 0, unit: "px" } };
    }
  }
  return tokens;
}

function generateShadowsData(shadowsList) {
  var tokens = {};
  for (var i = 0; i < shadowsList.length; i++) {
    var s = shadowsList[i];
    if (s.name) {
      tokens[s.name] = { "$type": "string", "$value": s.value || "" };
    }
  }
  return tokens;
}

function generateZIndexData(zindexList) {
  var tokens = {};
  for (var i = 0; i < zindexList.length; i++) {
    var z = zindexList[i];
    if (z.name) {
      tokens[z.name] = { "$type": "number", "$value": parseFloat(z.value) || 0 };
    }
  }
  return tokens;
}

function generateBreakpointsData() {
  return {
    xs:   { "$type": "number", "$value": 0 },
    sm:   { "$type": "number", "$value": 567 },
    md:   { "$type": "number", "$value": 767 },
    lg:   { "$type": "number", "$value": 991 }
  };
}

function generateTypographyData(typo, fontFamilies) {
  var t = { family: {}, size: {}, weight: {}, "line-height": {} };

  // Font families from the text styles config
  if (fontFamilies.primary)   t.family.primary   = { "$type": "fontFamily", "$value": fontFamilies.primary };
  if (fontFamilies.secondary) t.family.secondary = { "$type": "fontFamily", "$value": fontFamilies.secondary };
  if (fontFamilies.tertiary)  t.family.tertiary  = { "$type": "fontFamily", "$value": fontFamilies.tertiary };

  for (var i = 0; i < typo.sizes.length; i++) {
    var s = typo.sizes[i];
    if (s.name) t.size[s.name] = { "$type": "dimension", "$value": { value: parseFloat(s.value) || 0, unit: "px" } };
  }
  for (var j = 0; j < typo.weights.length; j++) {
    var w = typo.weights[j];
    if (w.name) t.weight[w.name] = { "$type": "number", "$value": parseFloat(w.value) || 0 };
  }
  for (var k = 0; k < typo.lineHeights.length; k++) {
    var l = typo.lineHeights[k];
    if (l.name) t["line-height"][l.name] = { "$type": "number", "$value": parseFloat(l.value) || 0 };
  }
  return t;
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
function generateTokenData(category, colorOpts, textStylesData, spacingData, radiusData, shadowsData, bordersData, zindexData, typographyData, fontFamilies) {
  // Normalize: if a plain string is passed, wrap it
  if (typeof colorOpts === "string") colorOpts = { primary: colorOpts, secondary: "", tertiary: "" };
  switch (category) {
    case "colors":       return { filename: "colors.json",       data: generateColorTokens(colorOpts) };
    case "colors-light": return { filename: "colors-light.json", data: generateSemanticColors(colorOpts) };
    case "typography":   return { filename: "typography.json",   data: generateTypographyData(typographyData, fontFamilies) };
    case "spacing":      return { filename: "spacing.json",      data: generateSpacingData(spacingData) };
    case "text-styles":  return { filename: "text-styles.json",  data: generateTextStylesData(textStylesData) };
    case "radius":       return { filename: "radius.json",       data: generateRadiusData(radiusData) };
    case "border":       return { filename: "border.json",       data: generateBorderData(bordersData) };
    case "shadows":      return { filename: "shadows.json",      data: generateShadowsData(shadowsData) };
    case "zindex":       return { filename: "z-index.json",      data: generateZIndexData(zindexData) };
    case "breakpoints":  return { filename: "breakpoints.json",  data: generateBreakpointsData() };
    default: throw new Error("Unknown generator category: " + category);
  }
}