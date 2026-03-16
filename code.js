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

function countTokensByCategory(allVars, allCols) {
  var colorVars = 0, spacingVars = 0, radiusVars = 0, typographyVars = 0, shadowVars = 0, borderVars = 0, zindexVars = 0, breakpointVars = 0, gridVars = 0, opacityVars = 0, otherVars = 0;
  for (var vi = 0; vi < allVars.length; vi++) {
    var v = allVars[vi];
    var colName = "";
    for (var ci = 0; ci < allCols.length; ci++) {
      if (allCols[ci].id === v.variableCollectionId) { colName = allCols[ci].name.toLowerCase(); break; }
    }
    if (v.resolvedType === "COLOR") colorVars++;
    else if (colName === "grid") gridVars++;
    else if (colName.indexOf("spacing") !== -1 || colName.indexOf("gap") !== -1) spacingVars++;
    else if (colName.indexOf("radius") !== -1 || colName.indexOf("corner") !== -1) radiusVars++;
    else if (colName.indexOf("typography") !== -1 || colName.indexOf("font") !== -1) typographyVars++;
    else if (colName.indexOf("border") !== -1) borderVars++;
    else if (colName.indexOf("opacity") !== -1) opacityVars++;
    else if (colName.indexOf("z-index") !== -1 || colName.indexOf("zindex") !== -1) zindexVars++;
    else if (colName.indexOf("breakpoint") !== -1) breakpointVars++;
    else otherVars++;
  }
  return { colors: colorVars, spacing: spacingVars, radius: radiusVars, typography: typographyVars, shadows: shadowVars, border: borderVars, opacity: opacityVars, zindex: zindexVars, breakpoints: breakpointVars, grid: gridVars, other: otherVars };
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
  if (msg.type === "generate-specimens-from-vars") {
    try {
      ensureEssentialColors();
      await ensureComponentTextStyles();
      await generateFoundationsPageComplex();
      await generateComponentsPageComplex();
      figma.ui.postMessage({ type: "specimens-generated", success: true });
    } catch(e) {
      console.log("[Complex specimens] Error: " + e + " stack: " + (e.stack || ""));
      figma.ui.postMessage({ type: "specimens-generated", success: false, message: String(e) });
    }
    // Refresh token counts
    try {
      var allVars2 = figma.variables.getLocalVariables();
      var cols2 = figma.variables.getLocalVariableCollections();
      var ts2 = figma.getLocalTextStyles();
      var es2 = figma.getLocalEffectStyles();
      var counts2 = countTokensByCategory(allVars2, cols2);
      for(var esi2=0;esi2<es2.length;esi2++){if(es2[esi2].name.toLowerCase().indexOf("shadow")!==-1)counts2.shadows++;}
      counts2.textStyles = ts2.length;
      counts2.effectStyles = es2.length;
      counts2.collections = cols2.map(function(c){return{name:c.name,count:allVars2.filter(function(v){return v.variableCollectionId===c.id;}).length};});
      figma.ui.postMessage({type:"tokens-data",tokens:counts2});
    } catch(e){}
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

      var counts = countTokensByCategory(allVars, collections);
      // Count shadow effect styles (shadows are Effect Styles, not variables)
      for (var esi = 0; esi < effectStyles.length; esi++) {
        if (effectStyles[esi].name.toLowerCase().indexOf("shadow") !== -1) counts.shadows++;
      }

      counts.textStyles = textStyles.length;
      counts.effectStyles = effectStyles.length;
      counts.collections = collections.map(function(c) { return { name: c.name, count: allVars.filter(function(v) { return v.variableCollectionId === c.id; }).length }; });
      figma.ui.postMessage({ type: "tokens-data", tokens: counts });
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
    var GEN_ORDER = ["colors","colors-light","typography","spacing","text-styles","radius","border","opacity","shadows","zindex","breakpoints","grid"];

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
      var counts2 = countTokensByCategory(allVars2, cols2);
      for(var esi2=0;esi2<es2.length;esi2++){if(es2[esi2].name.toLowerCase().indexOf("shadow")!==-1)counts2.shadows++;}
      counts2.textStyles = ts2.length;
      counts2.effectStyles = es2.length;
      counts2.collections = cols2.map(function(c){return{name:c.name,count:allVars2.filter(function(v){return v.variableCollectionId===c.id;}).length};});
      figma.ui.postMessage({type:"tokens-data",tokens:counts2});
    } catch(e){}
  }

  if (msg.type === "generate-promo-pages") {
    try {
      await generatePromoStructure(msg);
      figma.ui.postMessage({ type: "promo-generated", success: true });
    } catch(e) {
      console.log("[Promo] Error: " + e);
      figma.ui.postMessage({ type: "promo-generated", success: false, message: String(e) });
    }
  }

  if (msg.type === "delete-wireframes") {
    try {
      var promoNames = ["promo/hero", "promo/popup", "promo/popup-thankyou", "promo/banner"];
      var allPages = figma.root.children;
      for (var pi = 0; pi < allPages.length; pi++) {
        var pg = allPages[pi];
        var pgName = pg.name.toLowerCase().replace(/[^a-z]/g, "");
        if (pgName.indexOf("desktop") !== -1 || pgName.indexOf("mobile") !== -1) {
          var toRemove = pg.children.filter(function(n) {
            return promoNames.indexOf(n.name) !== -1
              || n.name === "form-row" || n.name === "form-div"
              || n.name.indexOf("promo/") === 0
              || n.name.indexOf("input-") === 0;
          });
          for (var ri = 0; ri < toRemove.length; ri++) {
            try { toRemove[ri].remove(); } catch(e) {}
          }
        }
      }
      figma.ui.postMessage({ type: "wireframes-deleted" });
    } catch(e) {
      figma.ui.postMessage({ type: "wireframes-deleted", error: String(e) });
    }
  }

  if (msg.type === "save-settings") {
    try {
      await figma.clientStorage.setAsync("wf-settings", msg.settings);
    } catch(e) {}
  }

  if (msg.type === "reset-settings") {
    try {
      await figma.clientStorage.deleteAsync("wf-settings");
      figma.ui.postMessage({ type: "settings-reset" });
    } catch(e) {}
  }

  if (msg.type === "reset-tokens") {
    try {
      // Remove all local text styles
      var localTS = figma.getLocalTextStyles();
      for (var ti = 0; ti < localTS.length; ti++) {
        localTS[ti].remove();
      }
      // Remove all local effect styles (shadows)
      var localES = figma.getLocalEffectStyles();
      for (var ei = 0; ei < localES.length; ei++) {
        localES[ei].remove();
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

function getAuditPages(){
  var hints=["mobile","desktop"];
  var pages=[];
  for(var i=0;i<figma.root.children.length;i++){
    var p=figma.root.children[i];
    var n=p.name.toLowerCase().replace(/[^a-z]/g,"");
    for(var h=0;h<hints.length;h++){
      if(n.indexOf(hints[h])!==-1){pages.push(p);break;}
    }
  }
  return pages;
}

function runAudit(){
  var auditPages=getAuditPages();
  if(!auditPages.length) return{checks:{},totalNodes:0,totalIssues:0,score:100,fixable:{},noPages:true};
  var checks={
    naming:        mk("Default Layer Names",     "Layers using Figma auto-generated names",                   "🏷",  "Naming & Structure"),
    namingFormat:  mk("Naming Convention",       "Names not in kebab-case (spaces, caps, underscores)",       "📝",  "Naming & Structure"),
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
  var WEIGHTS={autoLayout:5,colors:5,textStyles:5,spacingVars:5,naming:5,namingFormat:4,mixedText:4,radiusVars:4,deepNesting:3,unsavedStyles:3,opacityVars:2,hidden:2,empty:1};
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

// ── Promo page structure generator ───────────────────────────────────────────
async function generatePromoStructure(msg) {
  var sections = msg.sections || {};
  var popupIncludeForm = msg.popupIncludeForm !== false;
  var brandHex = msg.brandColor || "#3B82F6";
  var textHex = msg.textColor || "#1A1A1A";
  var brandFigma = hexToFigma(brandHex);
  var textFigma = hexToFigma(textHex);
  var radiusData = msg.radius || [];
  var defaultRadius = 8;
  for (var dri = 0; dri < radiusData.length; dri++) {
    if (radiusData[dri].name === "md" || radiusData[dri].name === "default") {
      defaultRadius = parseFloat(radiusData[dri].value) || 8; break;
    }
  }

  var preloadWeights = [400, 500, 600, 700];
  for (var pw = 0; pw < preloadWeights.length; pw++) {
    await loadFontWithFallback("Inter", preloadWeights[pw]);
  }

  // Placeholder image for backgrounds (light gray)
  var placeholderHash = createPlaceholderImageHash(0xCC, 0xCF, 0xD2);
  // Placeholder image for content images (darker, visible on any background)
  var contentImageHash = createPlaceholderImageHash(0x8A, 0x8F, 0x99);

  // Close button image
  var closeImageHash = figma.createImage(
    figma.base64Decode("iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAYAAAByUDbMAAABQUlEQVQ4jZ3UvUtcQRQF8J+IIAqWFoqdGxXbkMIU/h9WGgI2ESxstbNUxM5K0oiNiBYimCatGAjb+C0EQUIUMYUIWqwMvIXHOG/3rQduc+aeM3Pv3Jl2fMUyPuESd8qjD/OYQ1cgfqOWxX2WUBZ7Oe1xINZyRIgqRkoYrUa6rUBWcBItPOBLgUlvIj/EZNGR6zEeGVVwFOXc4mO8Yz82E4aL2fpAJqzl4gofGvViNmE4hbOIu0Fnid4mDfOx3exEMRbwFJk84od34lei2cOtmvRl8/acKPFPg7F5gzbsN+lZDZ/LmFUj0Tkm8L3glgtL24mS/6K7wUb/MRobdeBnlPgPQ4kWLCWe3lg9IQguErc2qBgriZLDV2YjIsM4hDfYDDOR7iCQp1Fp4Vcoi2857Vk7XtCDXUzjugWzw6wloZfrr6cznFx8NDn5AAAAAElFTkSuQmCC")
  ).hash;

  // Look up overlay variable for popup-overlay background
  var overlayVar = null;
  var allColorVars = figma.variables.getLocalVariables().filter(function(v) { return v.resolvedType === "COLOR"; });
  for (var ovi = 0; ovi < allColorVars.length; ovi++) {
    var ovName = allColorVars[ovi].name.toLowerCase();
    if (ovName.indexOf("overlay") !== -1 || ovName.indexOf("scrim") !== -1) {
      overlayVar = allColorVars[ovi]; break;
    }
  }

  // Look up shadow effect styles for binding
  var promoEffectStyles = figma.getLocalEffectStyles();
  var promoShadowStyle = null;
  for (var esi = 0; esi < promoEffectStyles.length; esi++) {
    var esName = promoEffectStyles[esi].name.toLowerCase();
    if (esName.indexOf("shadow") !== -1 && (esName.indexOf("default") !== -1 || esName.indexOf("md") !== -1)) {
      promoShadowStyle = promoEffectStyles[esi]; break;
    }
  }
  // Fallback: use any shadow style
  if (!promoShadowStyle) {
    for (var esi2 = 0; esi2 < promoEffectStyles.length; esi2++) {
      if (promoEffectStyles[esi2].name.toLowerCase().indexOf("shadow") !== -1) {
        promoShadowStyle = promoEffectStyles[esi2]; break;
      }
    }
  }
  function applyPromoShadow(node) {
    if (!promoShadowStyle) return;
    try { node.effectStyleId = promoShadowStyle.id; } catch(e) {}
  }

  // Look up spacing, radius & opacity variables for binding
  var spacingVarMap = {};
  var radiusVarMap = {};
  var opacityVarMap = {};
  var allFloatVars = figma.variables.getLocalVariables().filter(function(v) { return v.resolvedType === "FLOAT"; });
  var allColls = figma.variables.getLocalVariableCollections();
  for (var fvi = 0; fvi < allFloatVars.length; fvi++) {
    var fv = allFloatVars[fvi];
    var collName = "";
    for (var fci = 0; fci < allColls.length; fci++) {
      if (allColls[fci].id === fv.variableCollectionId) { collName = allColls[fci].name.toLowerCase(); break; }
    }
    var shortName = fv.name.split("/").pop();
    if (collName.indexOf("spacing") !== -1 || collName.indexOf("gap") !== -1) {
      spacingVarMap[shortName] = fv;
    } else if (collName.indexOf("opacity") !== -1) {
      var opModeId2 = null;
      for (var oci = 0; oci < allColls.length; oci++) { if (allColls[oci].id === fv.variableCollectionId) { if (allColls[oci].modes && allColls[oci].modes.length) { opModeId2 = allColls[oci].modes[0].modeId; } break; } }
      if (opModeId2) { try { var opVal2 = cxResolveVar(fv, opModeId2, allColls); if (typeof opVal2 === "number") opacityVarMap[Math.round(opVal2 * 100)] = fv; } catch(e) {} }
    } else if (collName.indexOf("radius") !== -1 || collName.indexOf("corner") !== -1) {
      radiusVarMap[shortName] = fv;
    }
  }

  // Helper: find best spacing variable for a target px value
  function findSpacingVar(targetPx) {
    var best = null, bestDiff = Infinity;
    var spCol = null;
    for (var sci = 0; sci < allColls.length; sci++) { if (allColls[sci].name.toLowerCase().indexOf("spacing") !== -1) { spCol = allColls[sci]; break; } }
    if (!spCol || !spCol.modes || !spCol.modes.length) return null;
    var spModeId = spCol.modes[0].modeId;
    for (var sk in spacingVarMap) {
      if (!spacingVarMap.hasOwnProperty(sk)) continue;
      var val = 0;
      try {
        val = cxResolveVar(spacingVarMap[sk], spModeId, allColls);
        if (typeof val !== "number") val = parseFloat(val) || 0;
      } catch(e) {}
      var diff = Math.abs(val - targetPx);
      if (diff < bestDiff) { bestDiff = diff; best = spacingVarMap[sk]; }
    }
    return bestDiff <= 4 ? best : null; // only use if within 4px
  }

  // Helper: find radius variable by name or closest value
  function findRadiusVar(name) {
    if (radiusVarMap[name]) return radiusVarMap[name];
    return null;
  }

  // Helper: bind opacity to variable
  function bindPromoOpacity(node) {
    if (!("opacity" in node) || node.opacity >= 1 || node.opacity <= 0) return;
    var pct = Math.round(node.opacity * 100);
    var ov = opacityVarMap[pct];
    if (ov) { try { node.setBoundVariable("opacity", ov); } catch(e) {} }
  }

  // Look up grid column span variables (grid/col-1 through grid/col-12)
  var gridColVarMap = {};
  for (var gvi = 0; gvi < allFloatVars.length; gvi++) {
    var gv = allFloatVars[gvi];
    var gCollName = "";
    for (var gci = 0; gci < allColls.length; gci++) {
      if (allColls[gci].id === gv.variableCollectionId) { gCollName = allColls[gci].name.toLowerCase(); break; }
    }
    if (gCollName === "grid" && gv.name.indexOf("grid/col-") === 0) {
      var spanNum = parseInt(gv.name.replace("grid/col-", ""));
      if (spanNum >= 1 && spanNum <= 12) gridColVarMap[spanNum] = gv;
    }
  }
  // Also look up grid/gutter variable for form row gap binding
  var gridGutterVar = null;
  for (var ggi = 0; ggi < allFloatVars.length; ggi++) {
    var ggv = allFloatVars[ggi];
    var ggCollName = "";
    for (var ggci = 0; ggci < allColls.length; ggci++) {
      if (allColls[ggci].id === ggv.variableCollectionId) { ggCollName = allColls[ggci].name.toLowerCase(); break; }
    }
    if (ggCollName === "grid" && ggv.name === "grid/gutter") { gridGutterVar = ggv; break; }
  }

  // Helper: bind separate horizontal/vertical padding to spacing variables
  function bindPaddingXY(frame, padXPx, padYPx) {
    frame.paddingLeft = padXPx; frame.paddingRight = padXPx;
    frame.paddingTop = padYPx; frame.paddingBottom = padYPx;
    var xVar = findSpacingVar(padXPx);
    var yVar = findSpacingVar(padYPx);
    if (xVar) {
      try {
        frame.setBoundVariable("paddingLeft", xVar);
        frame.setBoundVariable("paddingRight", xVar);
      } catch(e) {}
    }
    if (yVar) {
      try {
        frame.setBoundVariable("paddingTop", yVar);
        frame.setBoundVariable("paddingBottom", yVar);
      } catch(e) {}
    }
  }

  // Helper: bind padding and gap to spacing variables on an auto-layout frame
  function bindSpacing(frame, padPx, gapPx) {
    var padVar = findSpacingVar(padPx);
    var gapVar = findSpacingVar(gapPx);
    if (padVar) {
      try {
        frame.setBoundVariable("paddingLeft", padVar);
        frame.setBoundVariable("paddingRight", padVar);
        frame.setBoundVariable("paddingTop", padVar);
        frame.setBoundVariable("paddingBottom", padVar);
      } catch(e) {}
    }
    if (gapVar) {
      try { frame.setBoundVariable("itemSpacing", gapVar); } catch(e) {}
    }
  }

  // Helper: bind corner radius to variable
  function bindRadius(frame, radiusName) {
    var rv = findRadiusVar(radiusName);
    if (rv) {
      try { frame.setBoundVariable("cornerRadius", rv); } catch(e) {}
      try {
        frame.setBoundVariable("topLeftRadius", rv);
        frame.setBoundVariable("topRightRadius", rv);
        frame.setBoundVariable("bottomLeftRadius", rv);
        frame.setBoundVariable("bottomRightRadius", rv);
      } catch(e) {}
    }
  }

  // ── Look up text styles for wireframe text nodes ──
  var promoTextStyles = figma.getLocalTextStyles();
  function findPromoTextStyle(group, name) {
    var styleName = group + "/" + name;
    for (var i = 0; i < promoTextStyles.length; i++) {
      if (promoTextStyles[i].name === styleName) return promoTextStyles[i];
    }
    return null;
  }
  // Semantic text style lookup: heading, body, button
  var tsH1 = findPromoTextStyle("heading", "h1");
  var tsH1Mobile = findPromoTextStyle("heading", "h2") || tsH1;
  var tsBody = findPromoTextStyle("body", "default") || findPromoTextStyle("body", "lg");
  var tsBodyMobile = findPromoTextStyle("body", "sm") || tsBody;
  var tsSmall = findPromoTextStyle("body", "sm");

  // Pre-load fonts for text styles we'll use
  var tsBtnDefault = findPromoTextStyle("buttons", "default");
  var tsBtnSm = findPromoTextStyle("buttons", "sm");
  var tsLabel = findPromoTextStyle("label", "default");
  var promoTsArr = [tsH1, tsH1Mobile, tsBody, tsBodyMobile, tsSmall, tsBtnDefault, tsBtnSm, tsLabel];
  for (var ptsi = 0; ptsi < promoTsArr.length; ptsi++) {
    if (promoTsArr[ptsi]) {
      try { await figma.loadFontAsync(promoTsArr[ptsi].fontName); } catch(e) {}
    }
  }

  // ── Color variable binding helpers for wireframe ──
  var colorCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name === "Colors"; });
  var promoColorVarMap = {};
  if (colorCols.length > 0) {
    for (var pcvi = 0; pcvi < allColorVars.length; pcvi++) {
      if (allColorVars[pcvi].variableCollectionId === colorCols[0].id) {
        promoColorVarMap[allColorVars[pcvi].name] = allColorVars[pcvi];
      }
    }
  }
  function promoBindFill(node, varName) {
    var v = promoColorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }

  // ── Find component sets created on the Components page ──
  var btnVariant = null;      // Button: Variant=Primary, Size=Default
  var inputVariant = null;    // Input / Floating Label: State=Default
  var labelVariant = null;    // Label: State=Default
  var dropdownVariant = null; // Dropdown: State=Default
  var allCompSets = figma.root.findAll(function(n) { return n.type === "COMPONENT_SET"; });
  for (var csi = 0; csi < allCompSets.length; csi++) {
    var cs = allCompSets[csi];
    if (cs.name === "Button") {
      for (var vi = 0; vi < cs.children.length; vi++) {
        var vp = cs.children[vi].variantProperties;
        if (vp && vp["Variant"] === "Primary" && vp["Size"] === "Default") {
          btnVariant = cs.children[vi]; break;
        }
      }
    } else if (cs.name === "Input / Floating Label") {
      for (var ii = 0; ii < cs.children.length; ii++) {
        var ip = cs.children[ii].variantProperties;
        if (ip && ip["State"] === "Default") {
          inputVariant = cs.children[ii]; break;
        }
      }
    } else if (cs.name === "Label") {
      for (var li = 0; li < cs.children.length; li++) {
        var lp = cs.children[li].variantProperties;
        if (lp && lp["State"] === "Default") {
          labelVariant = cs.children[li]; break;
        }
      }
    } else if (cs.name === "Dropdown") {
      for (var di = 0; di < cs.children.length; di++) {
        var dp = cs.children[di].variantProperties;
        if (dp && dp["State"] === "Default") {
          dropdownVariant = cs.children[di]; break;
        }
      }
    }
  }

  var BREAKPOINTS = [
    { hint: "desktop", width: 1920 },
    { hint: "mobile",  width: 567 }
  ];

  // Names of all frames we create — used for cleanup
  var PROMO_FRAME_NAMES = ["promo/hero", "promo/popup", "promo/popup-thankyou", "promo/banner"];

  for (var bi = 0; bi < BREAKPOINTS.length; bi++) {
    var bp = BREAKPOINTS[bi];
    var page = findPageByHint(bp.hint);
    if (!page) continue;
    figma.currentPage = page;

    // Remove existing promo frames and any orphaned wireframe elements
    var toRemove = page.children.filter(function(n) {
      return PROMO_FRAME_NAMES.indexOf(n.name) !== -1
        || n.name === "form-row" || n.name === "form-div"
        || n.name.indexOf("promo/") === 0
        || n.name.indexOf("input-") === 0;
    });
    toRemove.forEach(function(n) { try { n.remove(); } catch(e) {} });

    var W = bp.width;
    var isMobile = bp.hint === "mobile";
    var pageX = 0;
    var GAP = 80;

    // Track created frames so we can fix layer order at the end
    var createdFrames = [];

    // ── Helper: create a top-level section frame ──
    function createSectionFrame(name, width, height) {
      var f = figma.createFrame();
      f.name = name;
      f.resize(width, height);
      f.x = pageX; f.y = 0;
      f.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(f, "white");
      f.clipsContent = true;
      page.appendChild(f);
      createdFrames.push(f);
      return f;
    }

    // ── Helper: create a CTA using Button component instance ──
    async function createCta(parent, text) {
      if (btnVariant) {
        var inst = null;
        try {
          inst = btnVariant.createInstance();
          var txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
          if (txtNodes.length > 0) {
            await figma.loadFontAsync(txtNodes[0].fontName);
            txtNodes[0].characters = text;
          }
          parent.appendChild(inst);
          return inst;
        } catch(e) {
          if (inst) try { inst.remove(); } catch(e2) {}
        }
      }
      // Fallback if component not found
      var btn = figma.createFrame();
      btn.name = "cta-button";
      btn.resize(isMobile ? 160 : 200, isMobile ? 44 : 52);
      btn.cornerRadius = defaultRadius;
      bindRadius(btn, "md");
      btn.fills = [{ type: "SOLID", color: brandFigma }];
      btn.layoutMode = "HORIZONTAL";
      btn.primaryAxisAlignItems = "CENTER";
      btn.counterAxisAlignItems = "CENTER";
      btn.primaryAxisSizingMode = "FIXED";
      btn.counterAxisSizingMode = "FIXED";
      var txt = figma.createText();
      var btnTxtStyle = findPromoTextStyle("buttons", isMobile ? "sm" : "default");
      if (btnTxtStyle) {
        txt.textStyleId = btnTxtStyle.id;
      } else {
        txt.fontName = { family: "Inter", style: "Semi Bold" };
        txt.fontSize = isMobile ? 14 : 16;
      }
      txt.characters = text;
      txt.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(txt, "white");
      btn.fills = [{ type: "SOLID", color: brandFigma }];
      promoBindFill(btn, "brand/primary");
      btn.appendChild(txt);
      parent.appendChild(btn);
      return btn;
    }

    // ── Helper: create an Input component instance with label override ──
    async function createInput(parent, labelText) {
      if (inputVariant) {
        var inst = null;
        try {
          inst = inputVariant.createInstance();
          var txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
          for (var ti = 0; ti < txtNodes.length; ti++) {
            await figma.loadFontAsync(txtNodes[ti].fontName);
          }
          if (txtNodes.length > 0) txtNodes[0].characters = labelText;
          parent.appendChild(inst);
          inst.layoutSizingHorizontal = "FILL";
          return inst;
        } catch(e) {
          if (inst) try { inst.remove(); } catch(e2) {}
        }
      }
      // Fallback: label + field frame
      var wrapper = figma.createFrame();
      wrapper.name = "input-" + labelText.toLowerCase().replace(/\s+/g, "-");
      wrapper.layoutMode = "VERTICAL";
      wrapper.primaryAxisSizingMode = "AUTO";
      wrapper.counterAxisSizingMode = "FILL_PARENT";
      wrapper.itemSpacing = 6;
      var wrapGapVar = findSpacingVar(6);
      if (wrapGapVar) { try { wrapper.setBoundVariable("itemSpacing", wrapGapVar); } catch(e) {} }
      wrapper.fills = [];
      var lbl = figma.createText();
      var lblFbStyle = findPromoTextStyle("label", "default");
      if (lblFbStyle) {
        lbl.textStyleId = lblFbStyle.id;
      } else {
        lbl.fontName = { family: "Inter", style: "Medium" };
        lbl.fontSize = 12;
      }
      lbl.characters = labelText;
      lbl.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
      promoBindFill(lbl, "text/primary");
      wrapper.appendChild(lbl);
      var fld = figma.createRectangle();
      fld.name = "field";
      fld.resize(260, 44);
      fld.cornerRadius = defaultRadius;
      bindRadius(fld, "md");
      fld.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
      promoBindFill(fld, "white");
      fld.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.82 } }];
      fld.strokeWeight = 1;
      wrapper.appendChild(fld);
      fld.layoutSizingHorizontal = "FILL";
      parent.appendChild(wrapper);
      wrapper.layoutSizingHorizontal = "FILL";
      return wrapper;
    }

    // ── Helper: create a Dropdown component instance ──
    async function createDropdown(parent, placeholderText) {
      if (dropdownVariant) {
        var inst = null;
        try {
          inst = dropdownVariant.createInstance();
          var txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
          for (var ti = 0; ti < txtNodes.length; ti++) {
            await figma.loadFontAsync(txtNodes[ti].fontName);
          }
          if (txtNodes.length > 0) txtNodes[0].characters = placeholderText;
          parent.appendChild(inst);
          inst.layoutSizingHorizontal = "FILL";
          return inst;
        } catch(e) {
          if (inst) try { inst.remove(); } catch(e2) {}
        }
      }
      // Fallback: use createInput
      return await createInput(parent, placeholderText);
    }

    // ── Helper: apply overlay fill (with variable binding if available) ──
    function applyOverlayFill(node) {
      if (overlayVar) {
        node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
        try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", overlayVar)]; } catch(e) {
          node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.85 }];
        }
      } else {
        node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.85 }];
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 1. HERO
    // ════════════════════════════════════════════════════════════════════
    if (sections.hero) {
      var heroH = isMobile ? 520 : 700;
      var hero = createSectionFrame("promo/hero", W, heroH);
      // Auto-layout: center children both axes
      hero.layoutMode = "VERTICAL";
      hero.primaryAxisAlignItems = "CENTER";
      hero.counterAxisAlignItems = "CENTER";
      hero.primaryAxisSizingMode = "AUTO";
      hero.counterAxisSizingMode = "FIXED";
      bindPaddingXY(hero, 0, 128);
      if (isMobile) {
        hero.maxWidth = 567;
      }

      // Background placeholder image (absolute, fills parent)
      var heroBg = figma.createRectangle();
      heroBg.name = "hero-bg-image";
      heroBg.resize(W, heroH);
      hero.appendChild(heroBg);
      heroBg.layoutPositioning = "ABSOLUTE";
      heroBg.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
      heroBg.x = 0; heroBg.y = 0;
      heroBg.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];

      // Centered content frame (auto-layout vertical, centered)
      var contentW = isMobile ? W - 40 : 800;
      var content = figma.createFrame();
      content.name = "hero-content";
      content.resize(contentW, 1);
      content.fills = [];
      content.layoutMode = "VERTICAL";
      content.primaryAxisAlignItems = "CENTER";
      content.counterAxisAlignItems = "CENTER";
      content.primaryAxisSizingMode = "AUTO";
      content.counterAxisSizingMode = "FIXED";
      content.itemSpacing = isMobile ? 12 : 16;
      bindSpacing(content, 0, isMobile ? 12 : 16);
      hero.appendChild(content);

      // Heading
      var h1 = figma.createText();
      var h1Style = isMobile ? tsH1Mobile : tsH1;
      if (h1Style) {
        h1.textStyleId = h1Style.id;
      } else {
        h1.fontName = { family: "Inter", style: "Bold" };
        h1.fontSize = isMobile ? 28 : 48;
      }
      h1.characters = "Headline goes here";
      var h1Fill = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };
      var h1ColorVar = findNearestColorVar(h1Fill.color, allColorVars);
      h1.fills = h1ColorVar ? [figma.variables.setBoundVariableForPaint(h1Fill, "color", h1ColorVar)] : [h1Fill];
      h1.textAlignHorizontal = "CENTER";
      content.appendChild(h1);

      // Placeholder image between heading and paragraph
      var heroImg = figma.createRectangle();
      heroImg.name = "hero-image";
      heroImg.resize(isMobile ? contentW - 20 : 400, isMobile ? 160 : 240);
      heroImg.cornerRadius = defaultRadius;
      bindRadius(heroImg, "md");
      heroImg.fills = [{ type: "IMAGE", imageHash: contentImageHash, scaleMode: "FILL" }];
      content.appendChild(heroImg);

      // Paragraph
      var sub = figma.createText();
      var subStyle = isMobile ? tsBodyMobile : tsBody;
      if (subStyle) {
        sub.textStyleId = subStyle.id;
      } else {
        sub.fontName = { family: "Inter", style: "Regular" };
        sub.fontSize = isMobile ? 14 : 18;
      }
      sub.characters = "Supporting text that describes the promo offer or key message.";
      var subFill = { type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } };
      var subColorVar = findNearestColorVar(subFill.color, allColorVars);
      sub.fills = subColorVar ? [figma.variables.setBoundVariableForPaint(subFill, "color", subColorVar)] : [subFill];
      sub.textAlignHorizontal = "CENTER";
      sub.textAutoResize = "HEIGHT";
      content.appendChild(sub);
      try { sub.layoutSizingHorizontal = "FILL"; } catch(e) {
        sub.resize(contentW - 40, sub.height);
      }

      // CTA
      await createCta(content, "Call to Action");

      // Resize bg to match final parent size
      heroBg.resize(hero.width, hero.height);

      pageX += W + GAP;
    }

    // ════════════════════════════════════════════════════════════════════
    // 2. POPUP (default screen — with or without form)
    // ════════════════════════════════════════════════════════════════════
    if (sections.popup) {
      var popH = isMobile ? 700 : 900;
      var popup = createSectionFrame("promo/popup", W, popH);
      popup.fills = [];
      // Auto-layout: center popup-content
      popup.layoutMode = "VERTICAL";
      popup.primaryAxisAlignItems = "CENTER";
      popup.counterAxisAlignItems = "CENTER";
      popup.primaryAxisSizingMode = "AUTO";
      popup.counterAxisSizingMode = "FIXED";
      bindPaddingXY(popup, 0, 128);
      if (isMobile) {
        popup.maxWidth = 567;
      }

      // popup-overlay (absolute, fills parent, uses overlay variable)
      var overlay = figma.createRectangle();
      overlay.name = "popup-overlay";
      overlay.resize(W, popH);
      popup.appendChild(overlay);
      overlay.layoutPositioning = "ABSOLUTE";
      overlay.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
      overlay.x = 0; overlay.y = 0;
      applyOverlayFill(overlay);

      // popup-content (fills parent, uses native maxWidth)
      popup.paddingLeft = 16; popup.paddingRight = 16;
      var popPadVar = findSpacingVar(16);
      if (popPadVar) {
        try {
          popup.setBoundVariable("paddingLeft", popPadVar);
          popup.setBoundVariable("paddingRight", popPadVar);
        } catch(e) {}
      }
      var pcMaxW = isMobile ? 375 : 700;
      var pcH = isMobile ? 520 : 500;
      var pc = figma.createFrame();
      pc.name = "popup-content";
      pc.resize(pcMaxW, pcH);
      pc.cornerRadius = defaultRadius * 2;
      bindRadius(pc, "lg");
      pc.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(pc, "white");
      applyPromoShadow(pc);
      pc.clipsContent = true;
      // Auto-layout so popup-inner can FILL
      pc.layoutMode = "VERTICAL";
      pc.primaryAxisSizingMode = "FIXED";
      pc.counterAxisSizingMode = "FIXED";
      popup.appendChild(pc);
      pc.layoutSizingHorizontal = "FILL";
      pc.maxWidth = pcMaxW;

      // Background image inside popup-content (absolute behind content)
      var pcBg = figma.createRectangle();
      pcBg.name = "popup-bg-image";
      pcBg.resize(pcMaxW, pcH);
      pc.appendChild(pcBg);
      pcBg.layoutPositioning = "ABSOLUTE";
      pcBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
      pcBg.x = 0; pcBg.y = 0;
      pcBg.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
      pcBg.opacity = 0.15;
      bindPromoOpacity(pcBg);

      // Close button (absolute, top-right corner x=0 y=0, padding inside)
      var closeSize = isMobile ? 15 : 19;
      var closeBtn = figma.createFrame();
      closeBtn.name = "close-button";
      closeBtn.fills = [];
      closeBtn.layoutMode = "HORIZONTAL";
      closeBtn.primaryAxisSizingMode = "AUTO";
      closeBtn.counterAxisSizingMode = "AUTO";
      closeBtn.primaryAxisAlignItems = "CENTER";
      closeBtn.counterAxisAlignItems = "CENTER";
      bindPaddingXY(closeBtn, isMobile ? 16 : 28, isMobile ? 20 : 32);
      var closeIcon = figma.createRectangle();
      closeIcon.name = "close-icon";
      closeIcon.resize(closeSize, closeSize);
      closeIcon.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: closeImageHash }];
      closeBtn.appendChild(closeIcon);
      pc.appendChild(closeBtn);
      closeBtn.layoutPositioning = "ABSOLUTE";
      closeBtn.constraints = { horizontal: "MAX", vertical: "MIN" };
      closeBtn.x = pcMaxW - closeBtn.width;
      closeBtn.y = 0;

      if (popupIncludeForm) {
        // ── Popup with form — auto-layout popup-inner ──
        var fPad = 32;

        var formInner = figma.createFrame();
        formInner.name = "popup-inner";
        formInner.fills = [];
        formInner.layoutMode = "VERTICAL";
        formInner.primaryAxisAlignItems = "CENTER";
        formInner.counterAxisAlignItems = "CENTER";
        formInner.primaryAxisSizingMode = "FIXED";
        formInner.counterAxisSizingMode = "FIXED";
        formInner.paddingTop = fPad; formInner.paddingBottom = fPad;
        formInner.paddingLeft = fPad; formInner.paddingRight = fPad;
        formInner.itemSpacing = 16;
        bindSpacing(formInner, fPad, 16);
        pc.appendChild(formInner);
        try {
          formInner.layoutSizingHorizontal = "FILL";
          formInner.layoutSizingVertical = "FILL";
        } catch(e) {}

        // Paragraph
        var pText = figma.createText();
        var pStyle = isMobile ? tsSmall : tsBody;
        if (pStyle) {
          pText.textStyleId = pStyle.id;
        } else {
          pText.fontName = { family: "Inter", style: "Regular" };
          pText.fontSize = isMobile ? 13 : 15;
        }
        pText.characters = "Fill in the form below to claim your offer.";
        pText.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
        promoBindFill(pText, "text/primary");
        pText.textAlignHorizontal = "CENTER";
        pText.textAutoResize = "HEIGHT";
        formInner.appendChild(pText);
        try { pText.layoutSizingHorizontal = "FILL"; } catch(e) {
          pText.resize(pcMaxW - fPad * 2, pText.height);
        }

        // Form wrapper
        var formDiv = figma.createFrame();
        formDiv.name = "form";
        formDiv.fills = [];
        formDiv.layoutMode = "VERTICAL";
        formDiv.primaryAxisSizingMode = "AUTO";
        formDiv.counterAxisSizingMode = "AUTO";
        formDiv.itemSpacing = 16;
        bindSpacing(formDiv, 0, isMobile ? 12 : 16);
        formInner.appendChild(formDiv);
        formDiv.layoutSizingHorizontal = "FILL";

        // Form rows — from grid layout (array of arrays) or fallback
        var formRows;
        if (msg.formRows && msg.formRows.length > 0) {
          formRows = msg.formRows;
        } else {
          // Legacy fallback
          formRows = [
            [{ label: "First name", required: true }, { label: "Last name", required: true }],
            [{ label: "Email address", required: true }, { label: "Phone number", required: true }],
            [{ label: "Select your store", dropdown: true, required: true }]
          ];
        }
        var colGap = isMobile ? 12 : 16;

        for (var ri = 0; ri < formRows.length; ri++) {
          var rowData = formRows[ri];
          var rowFrame = figma.createFrame();
          rowFrame.name = "form-row";
          rowFrame.fills = [];

          if (isMobile) {
            rowFrame.layoutMode = "VERTICAL";
            rowFrame.primaryAxisSizingMode = "AUTO";
            rowFrame.counterAxisSizingMode = "AUTO";
            rowFrame.itemSpacing = colGap;
          } else {
            // Auto-layout with wrap — Figma displays this as Grid in the UI
            rowFrame.layoutMode = "HORIZONTAL";
            rowFrame.layoutWrap = "WRAP";
            rowFrame.primaryAxisSizingMode = "FIXED";
            rowFrame.counterAxisSizingMode = "AUTO";
            rowFrame.itemSpacing = colGap;
            rowFrame.counterAxisSpacing = colGap;
          }
          // Bind gaps to grid gutter variable, fall back to spacing variable
          var rowGapVar = gridGutterVar || findSpacingVar(colGap);
          if (rowGapVar) {
            try { rowFrame.setBoundVariable("itemSpacing", rowGapVar); } catch(e) {}
            if (!isMobile) {
              try { rowFrame.setBoundVariable("counterAxisSpacing", rowGapVar); } catch(e) {}
            }
          }
          formDiv.appendChild(rowFrame);
          rowFrame.layoutSizingHorizontal = "FILL";

          // Calculate 12-column grid unit width
          var rowWidth = rowFrame.width;
          var unitCol = (rowWidth - 11 * colGap) / 12;

          for (var ci = 0; ci < rowData.length; ci++) {
            var fld = rowData[ci];
            var span = fld.colSpan || Math.floor(12 / rowData.length);
            var fieldLabel = fld.required ? fld.label + " *" : fld.label;
            var inp = fld.dropdown
              ? await createDropdown(rowFrame, fieldLabel)
              : await createInput(rowFrame, fieldLabel);

            if (!isMobile) {
              // Size field to span N columns: N * unitCol + (N-1) * gap
              var fieldWidth = Math.round(span * unitCol + Math.max(0, span - 1) * colGap);
              try {
                inp.layoutSizingHorizontal = "FIXED";
                inp.resize(fieldWidth, inp.height);
              } catch(e) {}
            } else {
              try { inp.layoutSizingHorizontal = "FILL"; } catch(e) {}
            }

            // Bind minWidth to grid column variable
            if (!isMobile && gridColVarMap[span]) {
              try { inp.setBoundVariable("minWidth", gridColVarMap[span]); } catch(e) {}
            }
            // Color the asterisk red on required fields
            if (fld.required) {
              var txtNodes = inp.findAll(function(n) { return n.type === "TEXT"; });
              for (var ti = 0; ti < txtNodes.length; ti++) {
                var tn = txtNodes[ti];
                var starIdx = tn.characters.lastIndexOf(" *");
                if (starIdx !== -1) {
                  try {
                    tn.setRangeFills(starIdx + 1, starIdx + 2, [{ type: "SOLID", color: { r: 0.9, g: 0.2, b: 0.2 } }]);
                  } catch(e) {}
                }
              }
            }
            var innerField = inp.findOne(function(n) { return n.name === "field"; });
            if (innerField) {
              try { innerField.layoutSizingHorizontal = "FILL"; } catch(e) {}
            }
          }
        }

        // Submit CTA in form-actions wrapper
        var formActions = figma.createFrame();
        formActions.name = "form-actions";
        formActions.fills = [];
        formActions.layoutMode = "HORIZONTAL";
        formActions.primaryAxisAlignItems = "CENTER";
        formActions.primaryAxisSizingMode = "AUTO";
        formActions.counterAxisSizingMode = "AUTO";
        formDiv.appendChild(formActions);
        formActions.layoutSizingHorizontal = "FILL";
        await createCta(formActions, "Submit");

      } else {
        // ── Popup without form — text + CTA centered ──
        var innerFrame = figma.createFrame();
        innerFrame.name = "popup-inner";
        innerFrame.fills = [];
        innerFrame.layoutMode = "VERTICAL";
        innerFrame.primaryAxisAlignItems = "CENTER";
        innerFrame.counterAxisAlignItems = "CENTER";
        innerFrame.primaryAxisSizingMode = "FIXED";
        innerFrame.counterAxisSizingMode = "FIXED";
        innerFrame.paddingLeft = 32; innerFrame.paddingRight = 32;
        innerFrame.paddingTop = 32; innerFrame.paddingBottom = 32;
        innerFrame.itemSpacing = 20;
        bindSpacing(innerFrame, 32, 20);
        pc.appendChild(innerFrame);
        try {
          innerFrame.layoutSizingHorizontal = "FILL";
          innerFrame.layoutSizingVertical = "FILL";
        } catch(e) {}

        var popTxt = figma.createText();
        var popTxtStyle = isMobile ? tsBodyMobile : tsBody;
        if (popTxtStyle) {
          popTxt.textStyleId = popTxtStyle.id;
        } else {
          popTxt.fontName = { family: "Inter", style: "Regular" };
          popTxt.fontSize = isMobile ? 14 : 16;
        }
        popTxt.characters = "Promotional message or announcement text goes here.";
        popTxt.fills = [{ type: "SOLID", color: textFigma }];
        promoBindFill(popTxt, "text/primary");
        popTxt.textAlignHorizontal = "CENTER";
        popTxt.textAutoResize = "HEIGHT";
        innerFrame.appendChild(popTxt);
        try { popTxt.layoutSizingHorizontal = "FILL"; } catch(e) {
          popTxt.resize(pcMaxW - 64 - 40, popTxt.height);
        }

        await createCta(innerFrame, "Call to Action");
      }

      // Resize overlay to match final parent size
      overlay.resize(popup.width, popup.height);

      pageX += W + GAP;

      // ══════════════════════════════════════════════════════════════════
      // 3. POPUP THANK-YOU (only when popup has a form)
      // ══════════════════════════════════════════════════════════════════
      if (popupIncludeForm) {
        var tyPopH = popH;
        var tyPopup = createSectionFrame("promo/popup-thankyou", W, tyPopH);
        tyPopup.fills = [];
        // Auto-layout: center popup-content
        tyPopup.layoutMode = "VERTICAL";
        tyPopup.primaryAxisAlignItems = "CENTER";
        tyPopup.counterAxisAlignItems = "CENTER";
        tyPopup.primaryAxisSizingMode = "AUTO";
        tyPopup.counterAxisSizingMode = "FIXED";
        bindPaddingXY(tyPopup, 0, 128);
        if (isMobile) {
          tyPopup.maxWidth = 567;
        }

        // overlay (absolute, fills parent)
        var tyOverlay = figma.createRectangle();
        tyOverlay.name = "popup-overlay";
        tyOverlay.resize(W, tyPopH);
        tyPopup.appendChild(tyOverlay);
        tyOverlay.layoutPositioning = "ABSOLUTE";
        tyOverlay.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
        tyOverlay.x = 0; tyOverlay.y = 0;
        applyOverlayFill(tyOverlay);

        // popup-content (fills parent, uses native maxWidth)
        tyPopup.paddingLeft = 16; tyPopup.paddingRight = 16;
        var tyPopPadVar = findSpacingVar(16);
        if (tyPopPadVar) {
          try {
            tyPopup.setBoundVariable("paddingLeft", tyPopPadVar);
            tyPopup.setBoundVariable("paddingRight", tyPopPadVar);
          } catch(e) {}
        }
        var tyPcMaxW = isMobile ? 375 : 700;
        var tyPcH = isMobile ? 520 : 500;
        var tyPc = figma.createFrame();
        tyPc.name = "popup-content";
        tyPc.resize(tyPcMaxW, tyPcH);
        tyPc.cornerRadius = defaultRadius * 2;
        bindRadius(tyPc, "lg");
        tyPc.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        promoBindFill(tyPc, "white");
        applyPromoShadow(tyPc);
        tyPc.clipsContent = true;
        // Auto-layout so popup-inner can FILL
        tyPc.layoutMode = "VERTICAL";
        tyPc.primaryAxisSizingMode = "FIXED";
        tyPc.counterAxisSizingMode = "FIXED";
        tyPopup.appendChild(tyPc);
        tyPc.layoutSizingHorizontal = "FILL";
        tyPc.maxWidth = tyPcMaxW;

        // Background image (absolute behind content)
        var tyBg = figma.createRectangle();
        tyBg.name = "popup-bg-image";
        tyBg.resize(tyPcMaxW, tyPcH);
        tyPc.appendChild(tyBg);
        tyBg.layoutPositioning = "ABSOLUTE";
        tyBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
        tyBg.x = 0; tyBg.y = 0;
        tyBg.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
        tyBg.opacity = 0.15;
        bindPromoOpacity(tyBg);

        // Close button (absolute, top-right)
        var tyCloseSize = isMobile ? 15 : 19;
        var tyCloseBtn = figma.createFrame();
        tyCloseBtn.name = "close-button";
        tyCloseBtn.fills = [];
        tyCloseBtn.layoutMode = "HORIZONTAL";
        tyCloseBtn.primaryAxisSizingMode = "AUTO";
        tyCloseBtn.counterAxisSizingMode = "AUTO";
        tyCloseBtn.primaryAxisAlignItems = "CENTER";
        tyCloseBtn.counterAxisAlignItems = "CENTER";
        bindPaddingXY(tyCloseBtn, isMobile ? 16 : 28, isMobile ? 20 : 32);
        var tyCloseIcon = figma.createRectangle();
        tyCloseIcon.name = "close-icon";
        tyCloseIcon.resize(tyCloseSize, tyCloseSize);
        tyCloseIcon.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: closeImageHash }];
        tyCloseBtn.appendChild(tyCloseIcon);
        tyPc.appendChild(tyCloseBtn);
        tyCloseBtn.layoutPositioning = "ABSOLUTE";
        tyCloseBtn.constraints = { horizontal: "MAX", vertical: "MIN" };
        tyCloseBtn.x = tyPcMaxW - tyCloseBtn.width;
        tyCloseBtn.y = 0;

        // Centered text + CTA
        var tyInner = figma.createFrame();
        tyInner.name = "popup-inner";
        tyInner.fills = [];
        tyInner.layoutMode = "VERTICAL";
        tyInner.primaryAxisAlignItems = "CENTER";
        tyInner.counterAxisAlignItems = "CENTER";
        tyInner.primaryAxisSizingMode = "FIXED";
        tyInner.counterAxisSizingMode = "FIXED";
        tyInner.paddingLeft = 32; tyInner.paddingRight = 32;
        tyInner.paddingTop = 32; tyInner.paddingBottom = 32;
        tyInner.itemSpacing = 20;
        bindSpacing(tyInner, 32, 20);
        tyPc.appendChild(tyInner);
        try {
          tyInner.layoutSizingHorizontal = "FILL";
          tyInner.layoutSizingVertical = "FILL";
        } catch(e) {}

        var tyTxt = figma.createText();
        var tyTxtStyle = isMobile ? tsBodyMobile : tsBody;
        if (tyTxtStyle) {
          tyTxt.textStyleId = tyTxtStyle.id;
        } else {
          tyTxt.fontName = { family: "Inter", style: "Regular" };
          tyTxt.fontSize = isMobile ? 14 : 16;
        }
        tyTxt.characters = "Thank you! Your submission has been received.";
        tyTxt.fills = [{ type: "SOLID", color: textFigma }];
        promoBindFill(tyTxt, "text/primary");
        tyTxt.textAlignHorizontal = "CENTER";
        tyTxt.textAutoResize = "HEIGHT";
        tyInner.appendChild(tyTxt);
        try { tyTxt.layoutSizingHorizontal = "FILL"; } catch(e) {
          tyTxt.resize(tyPcMaxW - 64 - 40, tyTxt.height);
        }

        // Placeholder image
        var tyImg = figma.createRectangle();
        tyImg.name = "thankyou-image";
        tyImg.resize(isMobile ? 140 : 200, isMobile ? 100 : 140);
        tyImg.cornerRadius = defaultRadius;
        bindRadius(tyImg, "md");
        tyImg.fills = [{ type: "IMAGE", imageHash: contentImageHash, scaleMode: "FILL" }];
        tyInner.appendChild(tyImg);

        await createCta(tyInner, "Continue");

        // Resize overlay to match final parent size
        tyOverlay.resize(tyPopup.width, tyPopup.height);

        pageX += W + GAP;
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. BANNER
    // ════════════════════════════════════════════════════════════════════
    if (sections.banner) {
      var innerW = isMobile ? W - 24 : 1315;
      var innerH = isMobile ? 160 : 240;
      var bannerH = innerH + 60;
      var banner = createSectionFrame("promo/banner", W, bannerH);
      banner.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(banner, "white");
      // Auto-layout to center inner-banner
      banner.layoutMode = "VERTICAL";
      banner.primaryAxisAlignItems = "CENTER";
      banner.counterAxisAlignItems = "CENTER";
      banner.primaryAxisSizingMode = "AUTO";
      banner.counterAxisSizingMode = "FIXED";
      bindPaddingXY(banner, 0, 24);
      if (isMobile) {
        banner.maxWidth = 567;
      }

      // inner-banner with background image, horizontal layout: image + CTA
      var innerBanner = figma.createFrame();
      innerBanner.name = "inner-banner";
      innerBanner.resize(innerW, innerH);
      innerBanner.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
      innerBanner.cornerRadius = defaultRadius;
      bindRadius(innerBanner, "md");
      innerBanner.layoutMode = isMobile ? "VERTICAL" : "HORIZONTAL";
      innerBanner.primaryAxisAlignItems = "CENTER";
      innerBanner.counterAxisAlignItems = "CENTER";
      innerBanner.primaryAxisSizingMode = "AUTO";
      innerBanner.counterAxisSizingMode = "FIXED";
      var bannerPadPx = isMobile ? 16 : 40;
      var bannerGapPx = isMobile ? 16 : 32;
      innerBanner.paddingLeft = bannerPadPx;
      innerBanner.paddingRight = bannerPadPx;
      innerBanner.paddingTop = 24; innerBanner.paddingBottom = 24;
      innerBanner.itemSpacing = bannerGapPx;
      var innerBannerTBVar = findSpacingVar(24);
      if (innerBannerTBVar) {
        try {
          innerBanner.setBoundVariable("paddingTop", innerBannerTBVar);
          innerBanner.setBoundVariable("paddingBottom", innerBannerTBVar);
        } catch(e) {}
      }
      var bannerPadVar = findSpacingVar(bannerPadPx);
      var bannerGapVar = findSpacingVar(bannerGapPx);
      if (bannerPadVar) {
        try {
          innerBanner.setBoundVariable("paddingLeft", bannerPadVar);
          innerBanner.setBoundVariable("paddingRight", bannerPadVar);
        } catch(e) {}
      }
      if (bannerGapVar) {
        try { innerBanner.setBoundVariable("itemSpacing", bannerGapVar); } catch(e) {}
      }
      banner.appendChild(innerBanner);
      if (isMobile) {
        innerBanner.layoutSizingHorizontal = "FILL";
        innerBanner.maxWidth = 375;
      }

      // Placeholder image inside banner
      var bannerImg = figma.createRectangle();
      bannerImg.name = "banner-image";
      bannerImg.resize(isMobile ? 100 : 200, isMobile ? 80 : 140);
      bannerImg.cornerRadius = defaultRadius;
      bindRadius(bannerImg, "md");
      bannerImg.fills = [{ type: "IMAGE", imageHash: contentImageHash, scaleMode: "FILL" }];
      innerBanner.appendChild(bannerImg);
      if (isMobile) { bannerImg.layoutSizingHorizontal = "FILL"; }

      await createCta(innerBanner, "Learn More");

      pageX += W + GAP;
    }

    // Fix page-level layer order: first frame (hero) = top of layer panel.
    // Figma: last child = top of panel. So re-append in order, making
    // the last one (banner) end up at the top — then reverse.
    // Simplest: insert each frame at index 0 in creation order,
    // so the first created (hero) ends up as the last child (top of panel).
    for (var lri = 0; lri < createdFrames.length; lri++) {
      page.insertChild(0, createdFrames[lri]);
    }
  }
}

// ── Foundations page ─────────────────────────────────────────────────────────
async function generateFoundationsPage(msg) {
  var page = findPageByHint("foundations");
  if (!page) return;
  figma.currentPage = page;

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

  // ── Look up color variables for binding ──
  var fColorCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name === "Colors"; });
  var fColorVarMap = {};
  if (fColorCols.length > 0) {
    var fColorVars = figma.variables.getLocalVariables().filter(function(v) {
      return v.variableCollectionId === fColorCols[0].id && v.resolvedType === "COLOR";
    });
    for (var fcvi = 0; fcvi < fColorVars.length; fcvi++) {
      fColorVarMap[fColorVars[fcvi].name] = fColorVars[fcvi];
    }
  }
  function bindFill(node, varName) {
    var v = fColorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }

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
    var figmaTextStyles = figma.getLocalTextStyles();
    var figmaTextStyleMap = {};
    for (var fts = 0; fts < figmaTextStyles.length; fts++) {
      figmaTextStyleMap[figmaTextStyles[fts].name] = figmaTextStyles[fts];
    }
    async function makeStyledText(tsEntry, text, x, yPos) {
      var styleName = tsEntry.group + "/" + tsEntry.name;
      var figmaStyle = figmaTextStyleMap[styleName];
      var fam = (tsEntry.fontFamily || "Inter").split(",")[0].trim().replace(/['"]/g, "");
      var weight = tsEntry.fontWeight || 400;
      await loadFontWithFallback(fam, weight);
      var node = figma.createText();
      if (figmaStyle) {
        node.textStyleId = figmaStyle.id;
      } else {
        setFontName(node, fam, weight);
        node.fontSize = parseFloat(tsEntry.fontSize) || 16;
        if (tsEntry.lineHeight) node.lineHeight = { value: parseFloat(tsEntry.lineHeight) * 100, unit: "PERCENT" };
        if (tsEntry.letterSpacing && parseFloat(tsEntry.letterSpacing) !== 0) node.letterSpacing = { value: parseFloat(tsEntry.letterSpacing), unit: "PIXELS" };
      }
      node.characters = text;
      node.fills = [{ type: "SOLID", color: colorOpts.textColor ? hexToFigma(colorOpts.textColor) : { r: 0.1, g: 0.1, b: 0.1 } }];
      bindFill(node, "text/primary");
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
        var lhSampleText = "The quick brown fox jumps\nover the lazy dog. Pack my\nbox with five dozen\nliquor jugs.";
        var lhColW = Math.floor((W - PAD * 2 - (typo.lineHeights.length - 1) * 24) / typo.lineHeights.length);
        var lhX = PAD;
        var lhMaxH = 0;
        for (var lhi = 0; lhi < typo.lineHeights.length; lhi++) {
          var lh = typo.lineHeights[lhi];
          var lhVal = parseFloat(lh.value) || 1.5;
          createSpecText(frame, lh.name + " (" + lh.value + ")", lhX, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
          var lhNode = figma.createText();
          lhNode.fontName = { family: "Inter", style: "Regular" };
          lhNode.fontSize = 16;
          lhNode.lineHeight = { value: lhVal * 100, unit: "PERCENT" };
          lhNode.characters = lhSampleText;
          lhNode.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          lhNode.x = lhX; lhNode.y = y + 16;
          lhNode.resize(lhColW, lhNode.height);
          lhNode.textAutoResize = "HEIGHT";
          frame.appendChild(lhNode);
          if (lhNode.height + 16 > lhMaxH) lhMaxH = lhNode.height + 16;
          lhX += lhColW + 24;
        }
        y += lhMaxH + 24;
      } catch(e) { console.log("[Foundations] Line Heights error: " + e); }
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
    var shEffectStyles = figma.getLocalEffectStyles();
    var shStyleMap = {};
    for (var sem = 0; sem < shEffectStyles.length; sem++) { shStyleMap[shEffectStyles[sem].name] = shEffectStyles[sem]; }
    var shx = PAD;
    for (var shi = 0; shi < shadowsData.length; shi++) {
      var sh = shadowsData[shi];
      var shRect = figma.createRectangle();
      shRect.name = "shadow/" + sh.name;
      shRect.resize(120, 80);
      shRect.x = shx; shRect.y = y;
      shRect.cornerRadius = 8;
      shRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      var shStyle = shStyleMap["shadow/" + sh.name];
      if (shStyle) { try { shRect.effectStyleId = shStyle.id; } catch(e) {} }
      else { var effect = parseCssShadow(sh.value); if (effect) shRect.effects = [effect]; }
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
    var zBrandColor = hexToFigma(msg.brandColor || "#3B82F6");
    // Sort by value ascending so lowest z-index is at the back
    var zSorted = zindexData.slice().sort(function(a, b) {
      return (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0);
    });
    var zCardW = 220;
    var zCardH = 80;
    var zOffsetX = 32; // horizontal shift per layer
    var zOffsetY = -36; // vertical shift per layer (negative = upward)
    var zCount = zSorted.length;
    // Start from bottom-left so first (lowest) card is at bottom
    var zBaseX = PAD;
    var zBaseY = y + (zCount - 1) * Math.abs(zOffsetY);

    for (var zi2 = 0; zi2 < zCount; zi2++) {
      var zItem = zSorted[zi2];
      var zv = parseFloat(zItem.value) || 0;
      var zx = zBaseX + zi2 * zOffsetX;
      var zy = zBaseY + zi2 * zOffsetY;
      var zOpacity = 0.06 + 0.12 * (zi2 / Math.max(zCount - 1, 1));

      // Card
      var zCard = figma.createFrame();
      zCard.name = "zindex/" + zItem.name;
      zCard.resize(zCardW, zCardH);
      zCard.x = zx; zCard.y = zy;
      zCard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      zCard.strokes = [{ type: "SOLID", color: zBrandColor, opacity: 0.2 + 0.4 * (zi2 / Math.max(zCount - 1, 1)) }];
      zCard.strokeWeight = 1;
      zCard.cornerRadius = 6;
      zCard.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: zOpacity }, offset: { x: 0, y: 2 }, radius: 6, spread: 0, visible: true, blendMode: "NORMAL" }];
      frame.appendChild(zCard);

      // Name label inside card
      var zNameTxt = figma.createText();
      zNameTxt.name = "label";
      await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
      zNameTxt.fontName = { family: "Inter", style: "Semi Bold" };
      zNameTxt.fontSize = 12;
      zNameTxt.characters = zItem.name;
      zNameTxt.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
      zNameTxt.x = 12; zNameTxt.y = zCardH - 34;
      zCard.appendChild(zNameTxt);

      // Value label inside card
      var zValTxt = figma.createText();
      zValTxt.name = "value";
      await figma.loadFontAsync({ family: "Inter", style: "Regular" });
      zValTxt.fontName = { family: "Inter", style: "Regular" };
      zValTxt.fontSize = 11;
      zValTxt.characters = String(zv);
      zValTxt.fills = [{ type: "SOLID", color: zBrandColor, opacity: 0.8 }];
      zValTxt.x = 12; zValTxt.y = zCardH - 18;
      zCard.appendChild(zValTxt);
    }
    y = zBaseY + zCardH + 16;
    y += SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPACITY
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Opacity");
  var opCols = 10;
  var opGap = 8;
  var opSwatchW = Math.floor((W - PAD * 2 - (opCols - 1) * opGap) / opCols);
  var opSwatchH = 40;
  var opX = PAD;
  for (var opi = 5; opi <= 95; opi += 5) {
    var opRect = figma.createRectangle();
    opRect.name = "opacity/" + opi;
    opRect.resize(opSwatchW, opSwatchH);
    opRect.x = opX; opRect.y = y;
    opRect.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
    opRect.opacity = opi / 100;
    frame.appendChild(opRect);
    createSpecText(frame, opi + "%", opX, y + opSwatchH + 4, 10, "Medium", { r: 0.3, g: 0.3, b: 0.3 });
    opX += opSwatchW + opGap;
    if (opX + opSwatchW > W - PAD) { opX = PAD; y += opSwatchH + 24; }
  }
  y += opSwatchH + 24 + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // SPACING
  // ══════════════════════════════════════════════════════════════════════════
  var spacingData = msg.spacing || [];
  if (spacingData.length > 0) {
    sectionTitle("Spacing");
    var spBrandColor = hexToFigma(msg.brandColor || "#3B82F6");
    var spCols = 3;
    var spGutterX = 24;
    var spInnerSize = 32; // fixed inner square size
    var spRowGap = 16;
    var spRowY = y;
    var spRowMaxBottom = y;

    for (var spi = 0; spi < spacingData.length; spi++) {
      var sp = spacingData[spi];
      var spVal = parseFloat(sp.value) || 0;
      var spCol = spi % spCols;
      var spPad = Math.max(spVal, 4); // minimum visible padding
      var spOuterSize = spInnerSize + spPad * 2;

      // Start a new row
      if (spCol === 0 && spi > 0) {
        spRowY = spRowMaxBottom + spRowGap;
        spRowMaxBottom = spRowY;
      }

      var spCellW = Math.floor((W - PAD * 2 - spGutterX) / spCols);
      var spX = PAD + spCol * (spCellW + spGutterX);

      // Outer square (brand-colored, represents the spacing)
      var spOuter = figma.createRectangle();
      spOuter.name = "spacing/" + sp.name + "/outer";
      spOuter.resize(spOuterSize, spOuterSize);
      spOuter.x = spX; spOuter.y = spRowY;
      spOuter.fills = [{ type: "SOLID", color: spBrandColor, opacity: 0.12 }];
      spOuter.strokes = [{ type: "SOLID", color: spBrandColor, opacity: 0.35 }];
      spOuter.strokeWeight = 1;
      spOuter.cornerRadius = 4;
      frame.appendChild(spOuter);

      // Inner square (gray, centered inside outer)
      var spInner = figma.createRectangle();
      spInner.name = "spacing/" + sp.name + "/inner";
      spInner.resize(spInnerSize, spInnerSize);
      spInner.x = spX + spPad; spInner.y = spRowY + spPad;
      spInner.fills = [{ type: "SOLID", color: { r: 0.78, g: 0.78, b: 0.82 } }];
      spInner.cornerRadius = 2;
      frame.appendChild(spInner);

      // Label to the right of the squares
      var spLabelX = spX + spOuterSize + 12;
      var spLabelCenterY = spRowY + (spOuterSize / 2) - 7;
      createSpecText(frame, sp.name, spLabelX, spLabelCenterY - 1, 12, "Medium", { r: 0.15, g: 0.15, b: 0.15 });
      createSpecText(frame, spVal + "px", spLabelX, spLabelCenterY + 14, 11, "Regular", { r: 0.45, g: 0.45, b: 0.45 });

      var spItemBottom = spRowY + spOuterSize;
      if (spItemBottom > spRowMaxBottom) spRowMaxBottom = spItemBottom;
    }
    y = spRowMaxBottom + spRowGap;
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
  var bpBrandColor = hexToFigma(msg.brandColor || "#3B82F6");
  // Sort ascending by value: xs(0), sm(567), md(767), lg(991)
  var bpAsc = breakpoints.slice().sort(function(a, b) { return (parseFloat(a.value)||0) - (parseFloat(b.value)||0); });
  var bpAvailW = W - PAD * 2;
  // lg is the outermost; scale so lg fills the available width
  var bpOuterVal = (parseFloat(bpAsc[bpAsc.length - 1].value) || 991) * 1.15; // add 15% so lg rect isn't edge-to-edge
  var bpScale = bpAvailW / bpOuterVal;
  var bpH = 320; // same height for all
  var bpCenterX = PAD + bpAvailW / 2;
  var bpBaseY = y;
  // Opacity steps: outermost (lg) lightest, innermost (xs) darkest
  var bpCount = bpAsc.length;
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  // Draw from outermost (lg) to innermost (xs)
  for (var bpi = bpCount - 1; bpi >= 0; bpi--) {
    var bp = bpAsc[bpi];
    var bpVal = parseFloat(bp.value) || 0;
    // Width: use the breakpoint value, but for lg use the outer boundary, for xs use the next bp value
    var bpRectW;
    if (bpi === bpCount - 1) {
      // lg — outermost, use full scaled width
      bpRectW = Math.round(bpOuterVal * bpScale);
    } else {
      // others — width = their breakpoint value
      var bpPixelVal = Math.max(bpVal, 280); // minimum visual size for xs
      bpRectW = Math.round(bpPixelVal * bpScale);
    }
    var bpX = Math.round(bpCenterX - bpRectW / 2);
    var bpOpacity = 0.06 + 0.06 * (bpCount - 1 - bpi); // outermost lightest, innermost darkest

    var bpRect = figma.createRectangle();
    bpRect.name = "breakpoint/" + bp.name;
    bpRect.resize(bpRectW, bpH);
    bpRect.x = bpX; bpRect.y = bpBaseY;
    bpRect.fills = [{ type: "SOLID", color: bpBrandColor, opacity: bpOpacity }];
    bpRect.strokes = [{ type: "SOLID", color: bpBrandColor, opacity: 0.15 + 0.1 * (bpCount - 1 - bpi) }];
    bpRect.strokeWeight = 1;
    bpRect.cornerRadius = bpi === bpCount - 1 ? 8 : 4;
    frame.appendChild(bpRect);

    // Range label — placed in the highlighted band area
    // For lg: right edge area, for others: left edge area (just inside the stroke)
    var bpRangeStr;
    if (bpi === bpCount - 1) {
      bpRangeStr = bp.name + " ≥ " + bpVal + "px";
    } else if (bpi === 0) {
      bpRangeStr = bp.name + " < " + (parseFloat(bpAsc[1].value) || 0) + "px";
    } else {
      bpRangeStr = bp.name + ": " + bpVal + "–" + (parseFloat(bpAsc[bpi + 1].value) || 0) + "px";
    }

    // Position label at the top of the band between this rect edge and the next inner rect edge
    var bpNameTxt = figma.createText();
    bpNameTxt.name = "bp-label/" + bp.name;
    bpNameTxt.fontName = { family: "Inter", style: "Semi Bold" };
    bpNameTxt.fontSize = 11;
    bpNameTxt.characters = bpRangeStr;
    bpNameTxt.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
    // Place label at the left edge of the highlighted band
    if (bpi === bpCount - 1) {
      // lg: label at top-left of the outermost rect
      bpNameTxt.x = bpX + 10; bpNameTxt.y = bpBaseY + 10;
    } else {
      // Inner breakpoints: label at bottom, just inside left edge
      bpNameTxt.x = bpX + 6; bpNameTxt.y = bpBaseY + bpH - 20 - bpi * 16;
    }
    frame.appendChild(bpNameTxt);
  }
  y = bpBaseY + bpH + 16;
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
  figma.currentPage = page;

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

  // ── Look up color variables for binding ──
  var colorCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name === "Colors"; });
  var colorVarMap = {};
  if (colorCols.length > 0) {
    var colorVars = figma.variables.getLocalVariables().filter(function(v) {
      return v.variableCollectionId === colorCols[0].id && v.resolvedType === "COLOR";
    });
    for (var cvi = 0; cvi < colorVars.length; cvi++) {
      colorVarMap[colorVars[cvi].name] = colorVars[cvi];
    }
  }
  function bindFill(node, varName) {
    var v = colorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }
  function bindStroke(node, varName) {
    var v = colorVarMap[varName]; if (!v) return;
    try { node.strokes = [figma.variables.setBoundVariableForPaint(node.strokes[0], "color", v)]; } catch(e) {}
  }

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

  // Get radius value and variable
  var radiusData = msg.radius || [];
  var defaultRadius = 8;
  for (var ri = 0; ri < radiusData.length; ri++) {
    if (radiusData[ri].name === "md" || radiusData[ri].name === "default") {
      defaultRadius = parseFloat(radiusData[ri].value) || 8;
      break;
    }
  }
  var radiusCols2 = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("radius") !== -1; });
  var defaultRadiusVar = null;
  if (radiusCols2.length > 0) {
    var rvars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === radiusCols2[0].id && v.resolvedType === "FLOAT"; });
    for (var rvi = 0; rvi < rvars.length; rvi++) {
      var rvn = rvars[rvi].name.split("/").pop();
      if (rvn === "md" || rvn === "default") { defaultRadiusVar = rvars[rvi]; break; }
    }
  }
  function bindRadius(node) {
    if (!defaultRadiusVar) return;
    try { node.setBoundVariable("cornerRadius", defaultRadiusVar); } catch(e) {}
  }

  // ── Look up spacing variables for binding ──
  var spacingCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("spacing") !== -1; });
  var spacingVarMapComp = {};
  if (spacingCols.length > 0) {
    var spVars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === spacingCols[0].id && v.resolvedType === "FLOAT"; });
    var allColsBasic = figma.variables.getLocalVariableCollections();
    for (var svi = 0; svi < spVars.length; svi++) {
      var spv = spVars[svi];
      var modeId = spacingCols[0].modes[0].modeId;
      try {
        var val = spv.valuesByMode[modeId];
        if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") {
          val = cxResolveVar(spv, modeId, allColsBasic);
        }
        if (typeof val === "number") spacingVarMapComp[val] = spv;
      } catch(e) {}
    }
  }
  function bindCompSpacing(frame) {
    var props = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing","counterAxisSpacing"];
    for (var pi = 0; pi < props.length; pi++) {
      var prop = props[pi];
      if (!(prop in frame)) continue;
      var val = frame[prop];
      if (!val || val <= 0) continue;
      var sv = spacingVarMapComp[val];
      if (sv) { try { frame.setBoundVariable(prop, sv); } catch(e) {} }
    }
  }

  // ── Look up opacity variables for binding ──
  var opacityCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("opacity") !== -1; });
  var opacityVarMapComp = {};
  if (opacityCols.length > 0) {
    var opVars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === opacityCols[0].id && v.resolvedType === "FLOAT"; });
    var opModeId = opacityCols[0].modes[0].modeId;
    var allColsBasicOp = figma.variables.getLocalVariableCollections();
    for (var opi = 0; opi < opVars.length; opi++) {
      try {
        var opVal = cxResolveVar(opVars[opi], opModeId, allColsBasicOp);
        if (typeof opVal === "number") opacityVarMapComp[Math.round(opVal * 100)] = opVars[opi];
      } catch(e) {}
    }
  }
  function bindOpacity(node) {
    if (!("opacity" in node) || node.opacity >= 1 || node.opacity <= 0) return;
    var pct = Math.round(node.opacity * 100);
    var ov = opacityVarMapComp[pct];
    if (ov) { try { node.setBoundVariable("opacity", ov); } catch(e) {} }
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
      bindRadius(btnComp);

      if (variant.filled) {
        btnComp.fills = [{ type: "SOLID", color: brandColor }];
        bindFill(btnComp, "brand/primary");
      } else {
        btnComp.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        btnComp.strokes = [{ type: "SOLID", color: brandColor }];
        bindFill(btnComp, "white");
        bindStroke(btnComp, "brand/primary");
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
      bindFill(btnText, variant.filled ? "white" : "brand/primary");

      btnComp.layoutMode = "HORIZONTAL";
      btnComp.primaryAxisAlignItems = "CENTER";
      btnComp.counterAxisAlignItems = "CENTER";
      btnComp.paddingTop = padH; btnComp.paddingBottom = padH;
      btnComp.paddingLeft = padW; btnComp.paddingRight = padW;
      btnComp.primaryAxisSizingMode = "AUTO";
      btnComp.counterAxisSizingMode = "AUTO";
      btnComp.appendChild(btnText);
      bindCompSpacing(btnComp);

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
  bindCompSpacing(btnSet);
  y += btnSet.height + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // INPUTS — 3 component sets (one per type), stacked vertically with titles
  // Types: Placeholder, Floating Label, Label + Placeholder
  // Each has State variants: Default, Focused, Error, Disabled
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Inputs");
  var inputStyle = findStyle("input", "default");
  var labelStyle = findStyle("label", "default");
  var labelStyleFocused = findStyle("label", "focused");
  var labelStyleError   = findStyle("label", "error");
  function pickLabelStyle(state) {
    if (state === "Focused" && labelStyleFocused) return labelStyleFocused;
    if (state === "Error"   && labelStyleError)   return labelStyleError;
    return labelStyle;
  }

  var inputTypes = [
    { type: "Placeholder",         hasLabel: false, hasPlaceholder: true,  floatingLabel: false },
    { type: "Floating Label",      hasLabel: true,  hasPlaceholder: false, floatingLabel: true  },
    { type: "Label + Placeholder", hasLabel: true,  hasPlaceholder: true,  floatingLabel: false },
  ];
  var inputStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5, borderVar: "border/default" },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2, borderVar: "focus/border" },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5, borderVar: "error/border" },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1, borderVar: "border/default" },
  ];

  for (var iti = 0; iti < inputTypes.length; iti++) {
    var itype = inputTypes[iti];
    var typeComps = [];

    // ── Type title ──
    var typeTitle = figma.createText();
    typeTitle.fontName = { family: "Inter", style: "Semi Bold" };
    typeTitle.fontSize = 14;
    typeTitle.characters = itype.type;
    typeTitle.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
    bindFill(typeTitle, "text/primary");
    frame.appendChild(typeTitle);
    typeTitle.x = PAD; typeTitle.y = y;
    y += typeTitle.height + 12;

    for (var isi = 0; isi < inputStates.length; isi++) {
      var ist = inputStates[isi];
      var isError = ist.label === "Error";
      var isDisabled = ist.label === "Disabled";

      var inputComp = figma.createComponent();
      inputComp.name = "State=" + ist.label;
      inputComp.resize(260, 44);
      inputComp.layoutMode = "VERTICAL";
      inputComp.primaryAxisSizingMode = "AUTO";
      inputComp.counterAxisSizingMode = "FIXED";
      inputComp.itemSpacing = 0;
      inputComp.fills = [];

      if (itype.floatingLabel) {
        // ── Floating Label type: form-field > field-wrapper > field + label ──
        var isDefault = ist.label === "Default";

        var formField = figma.createFrame();
        formField.name = "form-field";
        formField.layoutMode = "VERTICAL";
        formField.primaryAxisSizingMode = "AUTO";
        formField.counterAxisSizingMode = "AUTO";
        formField.fills = [];

        var fieldWrapper = figma.createFrame();
        fieldWrapper.name = "field-wrapper";
        fieldWrapper.layoutMode = "VERTICAL";
        fieldWrapper.primaryAxisSizingMode = "AUTO";
        fieldWrapper.counterAxisSizingMode = "AUTO";
        fieldWrapper.fills = [];

        // Input field — the styled element with border, bg, radius
        var field;
        if (isDefault) {
          // Default state: no children, use a rectangle
          field = figma.createRectangle();
          field.name = "field";
          field.resize(260, 44);
          field.cornerRadius = defaultRadius;
          bindRadius(field);
          field.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
          bindFill(field, "white");
          field.strokes = [{ type: "SOLID", color: ist.borderColor }];
          bindStroke(field, ist.borderVar);
          field.strokeWeight = ist.strokeW;
        } else {
          // Non-default states: frame with value text inside
          field = figma.createFrame();
          field.name = "field";
          field.resize(260, 44);
          field.layoutMode = "VERTICAL";
          field.primaryAxisSizingMode = "FIXED";
          field.counterAxisSizingMode = "FIXED";
          field.paddingLeft = 14; field.paddingRight = 14;
          field.paddingTop = 20; field.paddingBottom = 6;
          field.cornerRadius = defaultRadius;
          bindRadius(field);
          field.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
          if (!isDisabled) bindFill(field, "white");
          field.strokes = [{ type: "SOLID", color: ist.borderColor }];
          bindStroke(field, ist.borderVar);
          field.strokeWeight = ist.strokeW;

          var floatInput = figma.createText();
          if (inputStyle) {
            floatInput.textStyleId = inputStyle.id;
          } else {
            floatInput.fontName = { family: "Inter", style: "Regular" };
            floatInput.fontSize = 14;
            floatInput.fills = [{ type: "SOLID", color: { r: 0.13, g: 0.13, b: 0.13 } }];
          }
          floatInput.characters = isDisabled ? "Disabled" : "Value";
          if (isDisabled) { floatInput.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }]; floatInput.opacity = 0.5; bindOpacity(floatInput); }
          else { bindFill(floatInput, "text/primary"); }
          field.appendChild(floatInput);
          bindCompSpacing(field);
        }

        fieldWrapper.appendChild(field);
        field.layoutSizingHorizontal = "FILL";

        // Label — absolutely positioned over the field
        var floatLbl = figma.createText();
        if (isDefault) {
          // Default: label looks like a placeholder, uses input font size
          if (inputStyle) {
            floatLbl.textStyleId = inputStyle.id;
          } else {
            floatLbl.fontName = { family: "Inter", style: "Regular" };
            floatLbl.fontSize = 14;
            floatLbl.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
          }
          floatLbl.characters = "Label";
          bindFill(floatLbl, "focus/color");
        } else {
          // Focused/Error/Disabled: small label at top
          var flStyle = pickLabelStyle(ist.label);
          if (flStyle) {
            floatLbl.textStyleId = flStyle.id;
          } else {
            floatLbl.fontName = { family: "Inter", style: "Medium" };
            floatLbl.fontSize = 10;
            floatLbl.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
          }
          floatLbl.characters = isError ? "Error Label" : "Label";
          if (isError) { floatLbl.fills = [{ type: "SOLID", color: hexToFigma("#E32E22") }]; bindFill(floatLbl, "error/color"); }
          else { bindFill(floatLbl, "text/primary"); }
          if (isDisabled) { floatLbl.opacity = 0.5; bindOpacity(floatLbl); }
        }
        floatLbl.name = "label";
        fieldWrapper.appendChild(floatLbl);
        floatLbl.layoutPositioning = "ABSOLUTE";
        floatLbl.x = 14;
        floatLbl.y = isDefault ? 12 : 4;

        formField.appendChild(fieldWrapper);
        fieldWrapper.layoutSizingHorizontal = "FILL";
        inputComp.appendChild(formField);
        formField.layoutSizingHorizontal = "FILL";

      } else if (itype.hasLabel && itype.hasPlaceholder) {
        // ── Label + Placeholder type: label above, then field with placeholder ──
        inputComp.itemSpacing = 6;

        var lbl = figma.createText();
        var lblSt = pickLabelStyle(ist.label);
        if (lblSt) {
          lbl.textStyleId = lblSt.id;
        } else {
          lbl.fontName = { family: "Inter", style: "Medium" };
          lbl.fontSize = 12;
          lbl.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
        }
        lbl.characters = isError ? "Error Label" : "Label";
        if (isError) { lbl.fills = [{ type: "SOLID", color: hexToFigma("#E32E22") }]; bindFill(lbl, "error/color"); }
        else { bindFill(lbl, "text/primary"); }
        if (isDisabled) { lbl.opacity = 0.5; bindOpacity(lbl); }
        inputComp.appendChild(lbl);

        var inputField = figma.createFrame();
        inputField.name = "field";
        inputField.resize(260, 44);
        inputField.cornerRadius = defaultRadius;
        bindRadius(inputField);
        inputField.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
        if (!isDisabled) bindFill(inputField, "white");
        inputField.strokes = [{ type: "SOLID", color: ist.borderColor }];
        bindStroke(inputField, ist.borderVar);
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
          inputText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
        }
        inputText.characters = isDisabled ? "Disabled" : "Placeholder text";
        bindFill(inputText, "focus/color");
        if (isDisabled) { inputText.opacity = 0.5; bindOpacity(inputText); }
        inputField.appendChild(inputText);
        bindCompSpacing(inputField);
        bindCompSpacing(inputComp);
        inputComp.appendChild(inputField);
        inputField.layoutSizingHorizontal = "FILL";

      } else {
        // ── Placeholder only type: just field with placeholder, no label ──
        var inputField2 = figma.createFrame();
        inputField2.name = "field";
        inputField2.resize(260, 44);
        inputField2.cornerRadius = defaultRadius;
        bindRadius(inputField2);
        inputField2.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
        if (!isDisabled) bindFill(inputField2, "white");
        inputField2.strokes = [{ type: "SOLID", color: ist.borderColor }];
        bindStroke(inputField2, ist.borderVar);
        inputField2.strokeWeight = ist.strokeW;
        inputField2.layoutMode = "HORIZONTAL";
        inputField2.counterAxisAlignItems = "CENTER";
        inputField2.paddingLeft = 14; inputField2.paddingRight = 14;
        inputField2.paddingTop = 10; inputField2.paddingBottom = 10;
        inputField2.primaryAxisSizingMode = "FIXED";
        inputField2.counterAxisSizingMode = "FIXED";

        var inputText2 = figma.createText();
        if (inputStyle) {
          inputText2.textStyleId = inputStyle.id;
        } else {
          inputText2.fontName = { family: "Inter", style: "Regular" };
          inputText2.fontSize = 14;
          inputText2.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
        }
        inputText2.characters = isDisabled ? "Disabled" : "Placeholder text";
        bindFill(inputText2, "focus/color");
        if (isDisabled) { inputText2.opacity = 0.5; bindOpacity(inputText2); }
        inputField2.appendChild(inputText2);
        bindCompSpacing(inputField2);
        inputComp.appendChild(inputField2);
        inputField2.layoutSizingHorizontal = "FILL";
      }

      typeComps.push(inputComp);
    }

    var INPUT_SET_W = 4 * 260 + 3 * 24 + 2 * 24;  // 1160
    var typeSet = figma.combineAsVariants(typeComps, frame);
    typeSet.name = "Input / " + itype.type;
    typeSet.x = PAD; typeSet.y = y;
    typeSet.resize(INPUT_SET_W, typeSet.height);
    typeSet.layoutMode = "HORIZONTAL";
    typeSet.itemSpacing = 24;
    typeSet.paddingTop = 24; typeSet.paddingBottom = 24;
    typeSet.paddingLeft = 24; typeSet.paddingRight = 24;
    typeSet.primaryAxisSizingMode = "FIXED";
    typeSet.counterAxisSizingMode = "AUTO";
    typeSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    typeSet.cornerRadius = 12;
    typeSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    typeSet.strokeWeight = 1;
    // Make each variant fill equally
    for (var vi = 0; vi < typeSet.children.length; vi++) {
      typeSet.children[vi].layoutSizingHorizontal = "FILL";
    }
    y += typeSet.height + 24;
  }
  y += SECTION_GAP - 24;

  // ══════════════════════════════════════════════════════════════════════════
  // LABELS (component set with State property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Labels");
  var labelDefaultStyle = findStyle("label", "default");
  var labelFocusedStyle = findStyle("label", "focused");
  var labelErrorStyle   = findStyle("label", "error");
  if (labelDefaultStyle) {
    var lblStates = [
      { label: "Default", text: "Label",       style: labelDefaultStyle },
      { label: "Focused", text: "Label",       style: labelFocusedStyle || labelDefaultStyle },
      { label: "Error",   text: "Error Label", style: labelErrorStyle   || labelDefaultStyle },
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
      lblNode.textStyleId = ls.style.id;
      lblNode.characters = ls.text;
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
    bindCompSpacing(lblSet);
    y += lblSet.height + 30;
  }
  y += SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // DROPDOWN (component set with State property)
  // Same structure as Floating Label input but with a chevron arrow
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Dropdown");
  var dropdownStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5, borderVar: "border/default" },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2, borderVar: "focus/border" },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5, borderVar: "error/border" },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1, borderVar: "border/default" },
  ];

  var chevronImageHash = figma.createImage(
    figma.base64Decode("iVBORw0KGgoAAAANSUhEUgAAABEAAAAKCAMAAABlokWQAAAAUVBMVEUAAAAmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJibJjcPCAAAAGnRSTlMA12X77M24LBMG5INzXkgZ9M7FwKaZUU80D09PB/wAAABWSURBVAjXRchHDsAgAMTAJRBI79X/f2gUhMAna2TMrNJsjBx1k6FZcQpdobemC9Jj2dsIrWcJ/0wWH8ljJ8UuOCSdcCs1Qq8eRuUq2KAq8FOC0uCGdB+C4gRExbf0IwAAAABJRU5ErkJggg==")
  ).hash;

  var allDropComps = [];
  for (var dsi = 0; dsi < dropdownStates.length; dsi++) {
    var dst = dropdownStates[dsi];
    var dIsError = dst.label === "Error";
    var dIsDisabled = dst.label === "Disabled";


    var dropComp = figma.createComponent();
    dropComp.name = "State=" + dst.label;
    dropComp.resize(260, 44);
    dropComp.layoutMode = "VERTICAL";
    dropComp.primaryAxisSizingMode = "AUTO";
    dropComp.counterAxisSizingMode = "FIXED";
    dropComp.itemSpacing = 0;
    dropComp.fills = [];

    // form-field wrapper
    var dFormField = figma.createFrame();
    dFormField.name = "form-field";
    dFormField.layoutMode = "VERTICAL";
    dFormField.primaryAxisSizingMode = "AUTO";
    dFormField.counterAxisSizingMode = "AUTO";
    dFormField.fills = [];

    // field-wrapper
    var dFieldWrapper = figma.createFrame();
    dFieldWrapper.name = "field-wrapper";
    dFieldWrapper.layoutMode = "VERTICAL";
    dFieldWrapper.primaryAxisSizingMode = "AUTO";
    dFieldWrapper.counterAxisSizingMode = "AUTO";
    dFieldWrapper.fills = [];

    // field — the styled select element
    var dField = figma.createFrame();
    dField.name = "field";
    dField.resize(260, 44);
    dField.layoutMode = "HORIZONTAL";
    dField.primaryAxisSizingMode = "FIXED";
    dField.counterAxisSizingMode = "FIXED";
    dField.counterAxisAlignItems = "CENTER";
    dField.paddingLeft = 14; dField.paddingRight = 14;
    dField.paddingTop = 10; dField.paddingBottom = 10;
    dField.cornerRadius = defaultRadius;
    bindRadius(dField);
    dField.fills = [{ type: "SOLID", color: dIsDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
    if (!dIsDisabled) bindFill(dField, "white");
    dField.strokes = [{ type: "SOLID", color: dst.borderColor }];
    bindStroke(dField, dst.borderVar);
    dField.strokeWeight = dst.strokeW;

    // Select text (placeholder)
    var dText = figma.createText();
    if (inputStyle) {
      dText.textStyleId = inputStyle.id;
    } else {
      dText.fontName = { family: "Inter", style: "Regular" };
      dText.fontSize = 14;
      dText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
    }
    dText.characters = dIsDisabled ? "Disabled" : "Select option";
    bindFill(dText, "focus/color");
    if (dIsDisabled) { dText.opacity = 0.5; bindOpacity(dText); }
    dField.appendChild(dText);
    dText.layoutSizingHorizontal = "FILL";

    // Chevron arrow (base64 PNG)
    var chevron = figma.createRectangle();
    chevron.name = "chevron";
    chevron.resize(17, 10);
    chevron.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: chevronImageHash }];
    if (dIsDisabled) { chevron.opacity = 0.5; bindOpacity(chevron); }
    dField.appendChild(chevron);

    bindCompSpacing(dField);
    dFieldWrapper.appendChild(dField);
    dField.layoutSizingHorizontal = "FILL";

    dFormField.appendChild(dFieldWrapper);
    dFieldWrapper.layoutSizingHorizontal = "FILL";

    dropComp.appendChild(dFormField);
    dFormField.layoutSizingHorizontal = "FILL";

    allDropComps.push(dropComp);
  }

  var dropSet = figma.combineAsVariants(allDropComps, frame);
  dropSet.name = "Dropdown";
  dropSet.x = PAD; dropSet.y = y;
  var DROP_SET_W = 4 * 260 + 3 * 24 + 2 * 24;
  dropSet.resize(DROP_SET_W, dropSet.height);
  dropSet.layoutMode = "HORIZONTAL";
  dropSet.itemSpacing = 24;
  dropSet.paddingTop = 24; dropSet.paddingBottom = 24;
  dropSet.paddingLeft = 24; dropSet.paddingRight = 24;
  dropSet.primaryAxisSizingMode = "FIXED";
  dropSet.counterAxisSizingMode = "AUTO";
  dropSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  dropSet.cornerRadius = 12;
  dropSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  dropSet.strokeWeight = 1;
  bindCompSpacing(dropSet);
  for (var dvi = 0; dvi < dropSet.children.length; dvi++) {
    dropSet.children[dvi].layoutSizingHorizontal = "FILL";
  }
  y += dropSet.height + SECTION_GAP;

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
    bindCompSpacing(imgSet);
    y += imgSet.height + SECTION_GAP;
  }

  y += PAD;

  frame.resize(W, y);
}

// ══════════════════════════════════════════════════════════════════════════════
// ── Complex Foundations & Components (reads directly from Figma variables) ────
// ══════════════════════════════════════════════════════════════════════════════

// Shared helpers for complex generators
function cxResolveVar(v, modeId, allCols) {
  var val = v.valuesByMode[modeId];
  var seen = {};
  while (val && typeof val === "object" && val.type === "VARIABLE_ALIAS" && val.id && !seen[val.id]) {
    seen[val.id] = true;
    try {
      var aliased = figma.variables.getVariableById(val.id);
      if (!aliased) break;
      var ac = null;
      for (var i = 0; i < allCols.length; i++) { if (allCols[i].id === aliased.variableCollectionId) { ac = allCols[i]; break; } }
      if (!ac) break;
      if (!ac.modes || !ac.modes.length) break;
      val = aliased.valuesByMode[ac.modes[0].modeId];
    } catch(e) { break; }
  }
  return val;
}
function cxColorToHex(rgb) {
  if (!rgb || !("r" in rgb)) return null;
  return "#" + [rgb.r, rgb.g, rgb.b].map(function(ch) { return Math.round(Math.min(255, Math.max(0, ch * 255))).toString(16).padStart(2, "0"); }).join("").toUpperCase();
}
function cxFindCol(allCols, pattern) {
  for (var i = 0; i < allCols.length; i++) { if (allCols[i].name.toLowerCase().indexOf(pattern) !== -1) return allCols[i]; }
  return null;
}
function cxGetFloats(col, allVars, allCols) {
  if (!col || !col.modes || !col.modes.length) return [];
  var mid = col.modes[0].modeId;
  var out = [];
  for (var i = 0; i < allVars.length; i++) {
    var v = allVars[i];
    if (v.variableCollectionId !== col.id || v.resolvedType !== "FLOAT") continue;
    var val = cxResolveVar(v, mid, allCols);
    var num = typeof val === "number" ? val : parseFloat(val) || 0;
    var parts = v.name.split("/");
    out.push({ name: parts[parts.length - 1], fullName: v.name, value: num, variable: v });
  }
  return out;
}
function cxStripPrefix(name) { var i = name.indexOf("/"); return i !== -1 ? name.substring(i + 1) : name; }

function ensureEssentialColors() {
  var cols = figma.variables.getLocalVariableCollections();
  var colorCol = null;
  for (var i = 0; i < cols.length; i++) { if (cols[i].name === "Colors") { colorCol = cols[i]; break; } }
  if (!colorCol) colorCol = figma.variables.createVariableCollection("Colors");
  var existing = figma.variables.getLocalVariables().filter(function(v) {
    return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR";
  });
  var nameMap = {};
  for (var ei = 0; ei < existing.length; ei++) nameMap[existing[ei].name] = true;
  var modeId = colorCol.modes[0].modeId;
  var essential = [
    { name: "black",        color: { r: 0, g: 0, b: 0 } },
    { name: "white",        color: { r: 1, g: 1, b: 1 } },
    { name: "gray",         color: hexToFigma("#E3E3E3") },
    { name: "focus/border", color: { r: 0, g: 0, b: 0 } },
    { name: "focus/color",  color: hexToFigma("#79797B") },
    { name: "error/border", color: hexToFigma("#E32E22") },
    { name: "error/color",  color: hexToFigma("#E32E22") },
  ];
  for (var j = 0; j < essential.length; j++) {
    if (!nameMap[essential[j].name]) {
      try {
        var v = figma.variables.createVariable(essential[j].name, colorCol, "COLOR");
        v.setValueForMode(modeId, essential[j].color);
      } catch(e) {}
    }
  }
}

async function ensureComponentTextStyles() {
  var existing = figma.getLocalTextStyles();
  var nameMap = {};
  for (var i = 0; i < existing.length; i++) nameMap[existing[i].name] = true;

  // Detect primary font family from existing text styles or typography vars
  var primaryFam = "Inter";
  for (var si = 0; si < existing.length; si++) {
    var fam = existing[si].fontName.family;
    if (fam && fam !== "Inter") { primaryFam = fam; break; }
  }
  if (primaryFam === "Inter") {
    var allCols = figma.variables.getLocalVariableCollections();
    var typCol = cxFindCol(allCols, "typography");
    if (typCol) {
      var allVars = figma.variables.getLocalVariables();
      var typMid = typCol.modes[0].modeId;
      for (var vi = 0; vi < allVars.length; vi++) {
        if (allVars[vi].variableCollectionId === typCol.id && allVars[vi].resolvedType === "STRING" && allVars[vi].name.toLowerCase().indexOf("family") !== -1) {
          var fv = String(cxResolveVar(allVars[vi], typMid, allCols) || "").split(",")[0].trim().replace(/['"]/g, "");
          if (fv && fv !== "Inter") { primaryFam = fv; break; }
        }
      }
    }
  }

  // Load needed font weights
  var weights = [400, 500, 600, 700];
  for (var wi = 0; wi < weights.length; wi++) {
    await loadFontWithFallback(primaryFam, weights[wi]);
  }

  // Define required component text styles
  var required = [
    { name: "buttons/lg",       family: primaryFam, weight: 600, size: 18 },
    { name: "buttons/default",  family: primaryFam, weight: 600, size: 16 },
    { name: "buttons/sm",       family: primaryFam, weight: 600, size: 14 },
    { name: "input/default",    family: primaryFam, weight: 400, size: 14 },
    { name: "label/default",    family: primaryFam, weight: 500, size: 12 },
    { name: "label/focused",    family: primaryFam, weight: 500, size: 12 },
    { name: "label/error",      family: primaryFam, weight: 500, size: 12 },
  ];

  for (var ri = 0; ri < required.length; ri++) {
    var r = required[ri];
    if (nameMap[r.name]) continue;
    try {
      var actualStyle = await loadFontWithFallback(r.family, r.weight);
      var ts = figma.createTextStyle();
      ts.name = r.name;
      ts.fontName = { family: r.family, style: actualStyle };
      ts.fontSize = r.size;
      ts.lineHeight = { unit: "PERCENT", value: 150 };
    } catch(e) {}
  }
}

async function generateFoundationsPageComplex() {
  var allVars = figma.variables.getLocalVariables();
  var allCols = figma.variables.getLocalVariableCollections();
  var textStyles = figma.getLocalTextStyles();
  var effectStyles = figma.getLocalEffectStyles();

  var page = findPageByHint("foundations");
  if (!page) return;
  figma.currentPage = page;

  // Load Inter weights
  var stdW = [100,200,300,400,500,600,700,800,900];
  for (var iw = 0; iw < stdW.length; iw++) await loadFontWithFallback("Inter", stdW[iw]);

  // Load user fonts from text styles
  var loadedFams = {};
  for (var tsi = 0; tsi < textStyles.length; tsi++) {
    var fam = textStyles[tsi].fontName.family;
    if (!loadedFams[fam] && fam !== "Inter") {
      loadedFams[fam] = true;
      for (var fw = 0; fw < stdW.length; fw++) await loadFontWithFallback(fam, stdW[fw]);
    }
  }
  // Also load fonts from Typography STRING vars
  var typCol = cxFindCol(allCols, "typography");
  var userFontFamilies = [];
  if (typCol) {
    var typMid = typCol.modes[0].modeId;
    for (var vi = 0; vi < allVars.length; vi++) {
      if (allVars[vi].variableCollectionId === typCol.id && allVars[vi].resolvedType === "STRING" && allVars[vi].name.toLowerCase().indexOf("family") !== -1) {
        var fv = String(cxResolveVar(allVars[vi], typMid, allCols) || "").split(",")[0].trim().replace(/['"]/g, "");
        if (fv && !loadedFams[fv]) {
          loadedFams[fv] = true;
          for (var fw2 = 0; fw2 < stdW.length; fw2++) await loadFontWithFallback(fv, stdW[fw2]);
        }
        if (fv && userFontFamilies.indexOf(fv) === -1) userFontFamilies.push(fv);
      }
    }
  }

  // Remove existing
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

  function sectionTitle(title) {
    var t = createSpecText(frame, title, PAD, y, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    y += t.height + 8;
    var div = figma.createRectangle(); div.resize(W - PAD * 2, 1);
    div.x = PAD; div.y = y; div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div); y += 24;
  }

  // Detect brand color from Colors collection + build color var map for binding
  var colorCol = null;
  for (var ci = 0; ci < allCols.length; ci++) { if (allCols[ci].name === "Colors") { colorCol = allCols[ci]; break; } }
  var brandHex = "#3B82F6";
  var fColorVarMap = {};
  if (colorCol) {
    var cMid = colorCol.modes[0].modeId;
    var fColorVars = allVars.filter(function(v) { return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR"; });
    for (var fcvi = 0; fcvi < fColorVars.length; fcvi++) fColorVarMap[fColorVars[fcvi].name] = fColorVars[fcvi];
    for (var bvi = 0; bvi < allVars.length; bvi++) {
      if (allVars[bvi].variableCollectionId === colorCol.id && allVars[bvi].name === "brand/primary") {
        var bVal = cxResolveVar(allVars[bvi], cMid, allCols);
        var bh = cxColorToHex(bVal);
        if (bh) brandHex = bh;
        break;
      }
    }
  }
  function fBindFill(node, varName) {
    var v = fColorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PRIMITIVE COLORS — palette grid grouped by color family
  // ══════════════════════════════════════════════════════════════════════════
  var primCol = null;
  for (var pci = 0; pci < allCols.length; pci++) { if (allCols[pci].name === "Primitives") { primCol = allCols[pci]; break; } }
  if (primCol) {
    var primMid = primCol.modes[0].modeId;
    var primVars = allVars.filter(function(v) { return v.variableCollectionId === primCol.id && v.resolvedType === "COLOR"; });
    // Group by first segment: red/100 → group "red"
    var colorGroups = {};
    var groupOrder = [];
    for (var pvi = 0; pvi < primVars.length; pvi++) {
      var parts = primVars[pvi].name.split("/");
      var group = parts.length > 1 ? parts[0] : "other";
      var shade = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
      if (!colorGroups[group]) { colorGroups[group] = []; groupOrder.push(group); }
      var val = cxResolveVar(primVars[pvi], primMid, allCols);
      var hex = cxColorToHex(val);
      if (hex) colorGroups[group].push({ shade: shade, hex: hex, variable: primVars[pvi] });
    }
    // Sort shades numerically within each group
    for (var gk in colorGroups) {
      colorGroups[gk].sort(function(a, b) { return (parseInt(a.shade) || 0) - (parseInt(b.shade) || 0); });
    }

    if (groupOrder.length > 0) {
      sectionTitle("Color Primitives");
      var SW = 72, SH = 48, SGAP = 4;
      for (var gi = 0; gi < groupOrder.length; gi++) {
        var gName = groupOrder[gi];
        var gColors = colorGroups[gName];
        // Group label
        createSpecText(frame, gName.charAt(0).toUpperCase() + gName.slice(1), PAD, y, 12, "SemiBold", { r: 0.25, g: 0.25, b: 0.25 });
        y += 20;
        for (var sci = 0; sci < gColors.length; sci++) {
          var sc = gColors[sci];
          var sx = PAD + sci * (SW + SGAP);
          if (sx + SW > W - PAD) { y += SH + 24; sx = PAD + 0 * (SW + SGAP); }
          var sr = figma.createRectangle();
          sr.name = gName + "/" + sc.shade;
          sr.resize(SW, SH); sr.x = sx; sr.y = y;
          sr.cornerRadius = 4;
          sr.fills = [{ type: "SOLID", color: hexToFigma(sc.hex) }];
          // Bind to variable
          try { sr.fills = [figma.variables.setBoundVariableForPaint(sr.fills[0], "color", sc.variable)]; } catch(e) {}
          frame.appendChild(sr);
          createSpecText(frame, sc.shade, sx, y + SH + 2, 9, "Medium", { r: 0.35, g: 0.35, b: 0.35 });
        }
        y += SH + 20 + 8;
      }
      y += SECTION_GAP;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEMANTIC COLORS — from Colors collection, with mode columns
  // ══════════════════════════════════════════════════════════════════════════
  if (colorCol) {
    var cModes = colorCol.modes;
    var semVars = allVars.filter(function(v) { return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR"; });
    // Group by first segment
    var semGroups = {};
    var semOrder = [];
    for (var svi = 0; svi < semVars.length; svi++) {
      var sp = semVars[svi].name.split("/");
      var sg = sp.length > 1 ? sp[0] : "other";
      if (!semGroups[sg]) { semGroups[sg] = []; semOrder.push(sg); }
      semGroups[sg].push(semVars[svi]);
    }

    if (semOrder.length > 0) {
      sectionTitle("Semantic Colors" + (cModes.length > 1 ? " (Light / Dark)" : ""));
      var hasModes = cModes.length > 1;
      var COL_W = hasModes ? Math.floor((W - PAD * 2 - 40) / 2) : (W - PAD * 2);
      var modeLabels = cModes.map(function(m) { return m.name; });
      var SSW = 56, SSH = 40, SSGAP = 6;

      if (hasModes) {
        // Mode column headers
        for (var mhi = 0; mhi < Math.min(modeLabels.length, 2); mhi++) {
          createSpecText(frame, modeLabels[mhi], PAD + mhi * (COL_W + 40), y, 13, "SemiBold", { r: 0.3, g: 0.3, b: 0.3 });
        }
        y += 24;
      }

      for (var sgi = 0; sgi < semOrder.length; sgi++) {
        var sgName = semOrder[sgi];
        var sgVars = semGroups[sgName];
        createSpecText(frame, sgName, PAD, y, 11, "SemiBold", { r: 0.4, g: 0.4, b: 0.4 });
        y += 18;
        var rowH = 0;

        for (var mci = 0; mci < Math.min(cModes.length, 2); mci++) {
          var modeId = cModes[mci].modeId;
          var mx = PAD + mci * (COL_W + 40);
          var myStart = y;
          var svx = mx;
          for (var svj = 0; svj < sgVars.length; svj++) {
            var sv = sgVars[svj];
            var svName = cxStripPrefix(sv.name);
            var svVal = cxResolveVar(sv, modeId, allCols);
            var svHex = cxColorToHex(svVal) || "#000000";
            if (svx + SSW + 48 > mx + COL_W) { myStart += SSH + 22; svx = mx; }
            var svRect = figma.createRectangle();
            svRect.name = sv.name; svRect.resize(SSW, SSH);
            svRect.x = svx; svRect.y = myStart; svRect.cornerRadius = 4;
            svRect.fills = [{ type: "SOLID", color: hexToFigma(svHex) }];
            try { svRect.fills = [figma.variables.setBoundVariableForPaint(svRect.fills[0], "color", sv)]; } catch(e) {}
            svRect.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }]; svRect.strokeWeight = 1;
            frame.appendChild(svRect);
            createSpecText(frame, svName, svx, myStart + SSH + 2, 9, "Medium", { r: 0.3, g: 0.3, b: 0.3 });
            svx += SSW + SSGAP + 48;
            var hr = (myStart + SSH + 16) - y;
            if (hr > rowH) rowH = hr;
          }
        }
        y += rowH + 12;
      }
      y += SECTION_GAP;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FONT FAMILIES — from Typography STRING vars or text styles
  // ══════════════════════════════════════════════════════════════════════════
  var fontFamList = userFontFamilies.slice();
  for (var tfi = 0; tfi < textStyles.length; tfi++) {
    var tfFam = textStyles[tfi].fontName.family;
    if (fontFamList.indexOf(tfFam) === -1) fontFamList.push(tfFam);
  }
  if (fontFamList.length > 0) {
    sectionTitle("Font Families");
    var FF_W = 380, FF_H = 160, FF_GAP = 24;
    var ffCols = Math.min(fontFamList.length, Math.floor((W - PAD * 2 + FF_GAP) / (FF_W + FF_GAP)));
    for (var ffi = 0; ffi < fontFamList.length; ffi++) {
      var ffFam = fontFamList[ffi];
      var ffCol = ffi % ffCols;
      var ffRow = Math.floor(ffi / ffCols);
      var ffX = PAD + ffCol * (FF_W + FF_GAP);
      var ffY = y + ffRow * (FF_H + FF_GAP);

      var ffCard = figma.createFrame();
      ffCard.name = "font/" + ffFam.toLowerCase();
      ffCard.resize(FF_W, FF_H); ffCard.x = ffX; ffCard.y = ffY;
      ffCard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      ffCard.cornerRadius = 12;
      ffCard.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }]; ffCard.strokeWeight = 1;
      ffCard.clipsContent = true;
      frame.appendChild(ffCard);

      var ffRole = figma.createText();
      ffRole.fontName = { family: "Inter", style: "Regular" }; ffRole.fontSize = 10;
      ffRole.characters = ffi === 0 ? "PRIMARY" : (ffi === 1 ? "SECONDARY" : "FONT " + (ffi + 1));
      ffRole.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      ffRole.letterSpacing = { value: 1.5, unit: "PIXELS" };
      ffRole.x = 24; ffRole.y = 20; ffCard.appendChild(ffRole);

      var ffNameStyle = await loadFontWithFallback(ffFam, 700);
      var ffName = figma.createText();
      ffName.fontName = { family: ffFam, style: ffNameStyle }; ffName.fontSize = 28;
      ffName.characters = ffFam;
      ffName.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
      ffName.x = 24; ffName.y = 42; ffCard.appendChild(ffName);

      var ffSampleStyle = await loadFontWithFallback(ffFam, 400);
      var ffSample = figma.createText();
      ffSample.fontName = { family: ffFam, style: ffSampleStyle }; ffSample.fontSize = 14;
      ffSample.characters = "AaBbCcDdEeFfGgHhIiJjKkLl";
      ffSample.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
      ffSample.x = 24; ffSample.y = 86; ffCard.appendChild(ffSample);

      var ffWS = [{ w: 300, l: "Light" }, { w: 400, l: "Regular" }, { w: 600, l: "SemiBold" }, { w: 700, l: "Bold" }];
      var ffwx = 24;
      for (var fwi = 0; fwi < ffWS.length; fwi++) {
        var fws = await loadFontWithFallback(ffFam, ffWS[fwi].w);
        var fwn = figma.createText();
        fwn.fontName = { family: ffFam, style: fws }; fwn.fontSize = 11;
        fwn.characters = ffWS[fwi].l;
        fwn.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
        fwn.x = ffwx; fwn.y = 118; ffCard.appendChild(fwn);
        ffwx += fwn.width + 16;
      }
    }
    y += Math.ceil(fontFamList.length / ffCols) * (FF_H + FF_GAP) + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TEXT STYLES — from Figma local text styles
  // ══════════════════════════════════════════════════════════════════════════
  if (textStyles.length > 0) {
    try {
    // Build text style map for binding
    var tsMap = {};
    for (var tmi = 0; tmi < textStyles.length; tmi++) tsMap[textStyles[tmi].name] = textStyles[tmi];

    // Group by first path segment
    var tsGroups = {};
    var tsOrder = [];
    for (var tgi = 0; tgi < textStyles.length; tgi++) {
      var tsparts = textStyles[tgi].name.split("/");
      var tsGroup = tsparts.length > 1 ? tsparts[0] : "other";
      if (!tsGroups[tsGroup]) { tsGroups[tsGroup] = []; tsOrder.push(tsGroup); }
      tsGroups[tsGroup].push(textStyles[tgi]);
    }

    // Headings
    if (tsGroups["heading"]) {
      sectionTitle("Headings");
      var heads = tsGroups["heading"];
      for (var hi = 0; hi < heads.length; hi++) {
        var hts = heads[hi];
        var hFam = hts.fontName.family;
        await loadFontWithFallback(hFam, 700);
        var hNode = figma.createText();
        hNode.textStyleId = hts.id;
        var hLabel = hts.name.split("/").pop();
        hNode.characters = hLabel.toUpperCase() + " — The quick brown fox jumps over the lazy dog";
        hNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        fBindFill(hNode, "text/primary");
        hNode.x = PAD; hNode.y = y; frame.appendChild(hNode);
        var hMeta = hLabel + " · " + hts.fontSize + "px / " + hts.fontName.style;
        createSpecText(frame, hMeta, PAD, y + Math.max(hNode.height, 20) + 2, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
        y += Math.max(hNode.height, 24) + 26;
      }
      y += SECTION_GAP;
    }

    // Body / Paragraphs
    if (tsGroups["body"]) {
      sectionTitle("Paragraphs");
      var paraText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.";
      var bods = tsGroups["body"];
      for (var bdi = 0; bdi < bods.length; bdi++) {
        var bts = bods[bdi];
        await loadFontWithFallback(bts.fontName.family, 400);
        var bLabel = bts.name.split("/").pop();
        createSpecText(frame, "body/" + bLabel + " · " + bts.fontSize + "px / " + bts.fontName.style, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        var bNode = figma.createText();
        bNode.textStyleId = bts.id;
        bNode.characters = paraText;
        bNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        fBindFill(bNode, "text/primary");
        bNode.x = PAD; bNode.y = y; bNode.resize(W - PAD * 2, bNode.height);
        bNode.textAutoResize = "HEIGHT";
        frame.appendChild(bNode);
        y += bNode.height + 24;
      }
      y += SECTION_GAP;
    }

    // Links
    if (tsGroups["links"]) {
      sectionTitle("Links");
      var lnks = tsGroups["links"];
      var linkColor = hexToFigma(brandHex);
      for (var lki = 0; lki < lnks.length; lki++) {
        var lts = lnks[lki];
        await loadFontWithFallback(lts.fontName.family, 500);
        var lLabel = lts.name.split("/").pop();
        createSpecText(frame, "links/" + lLabel + " · " + lts.fontSize + "px", PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        var lNode = figma.createText();
        lNode.textStyleId = lts.id;
        lNode.characters = "This is a link example — click here to learn more";
        lNode.fills = [{ type: "SOLID", color: linkColor }];
        fBindFill(lNode, "brand/primary");
        lNode.textDecoration = "UNDERLINE";
        lNode.x = PAD; lNode.y = y; frame.appendChild(lNode);
        y += Math.max(lNode.height, 20) + 20;
      }
      y += SECTION_GAP;
    }

    // Other groups (buttons, input, label, etc.)
    var uiGroups = ["buttons", "input", "label"];
    var uiStyles = [];
    for (var ugi = 0; ugi < uiGroups.length; ugi++) {
      if (tsGroups[uiGroups[ugi]]) {
        for (var usi = 0; usi < tsGroups[uiGroups[ugi]].length; usi++) uiStyles.push(tsGroups[uiGroups[ugi]][usi]);
      }
    }
    if (uiStyles.length > 0) {
      sectionTitle("UI Text Styles");
      for (var uis = 0; uis < uiStyles.length; uis++) {
        var uts = uiStyles[uis];
        await loadFontWithFallback(uts.fontName.family, 400);
        createSpecText(frame, uts.name + " · " + uts.fontSize + "px / " + uts.fontName.style, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        var uNode = figma.createText();
        uNode.textStyleId = uts.id;
        uNode.characters = uts.name + " — Sample text preview";
        uNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        fBindFill(uNode, "text/primary");
        uNode.x = PAD; uNode.y = y; frame.appendChild(uNode);
        y += Math.max(uNode.height, 20) + 16;
      }
      y += SECTION_GAP;
    }
    } catch(tsErr) { console.log("[Complex Foundations] Text Styles error: " + tsErr); }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TYPOGRAPHY SCALE — sizes, weights, line-heights from Typography collection
  // ══════════════════════════════════════════════════════════════════════════
  if (typCol) {
    var typFloats = cxGetFloats(typCol, allVars, allCols);
    var tSizes = [], tWeights = [], tLH = [];
    for (var tfi2 = 0; tfi2 < typFloats.length; tfi2++) {
      var tf = typFloats[tfi2];
      var tfn = tf.fullName.toLowerCase();
      if (tfn.indexOf("size") !== -1) tSizes.push(tf);
      else if (tfn.indexOf("weight") !== -1) tWeights.push(tf);
      else if (tfn.indexOf("line") !== -1) tLH.push(tf);
    }

    if (tSizes.length || tWeights.length || tLH.length) {
      sectionTitle("Typography Scale");
      var primaryFam = userFontFamilies.length > 0 ? userFontFamilies[0] : "Inter";

      if (tSizes.length) {
        createSpecText(frame, "Font Sizes", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 }); y += 24;
        for (var fsi = 0; fsi < tSizes.length; fsi++) {
          var sz = tSizes[fsi]; var px = Math.min(sz.value, 60);
          var szStyle = await loadFontWithFallback(primaryFam, 400);
          var szText = figma.createText();
          szText.fontName = { family: primaryFam, style: szStyle }; szText.fontSize = px;
          szText.characters = sz.name + " — " + sz.value + "px";
          szText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          szText.x = PAD; szText.y = y; frame.appendChild(szText);
          y += Math.max(szText.height, 20) + 8;
        }
        y += 24;
      }

      if (tWeights.length) {
        createSpecText(frame, "Font Weights", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 }); y += 24;
        var wx = PAD;
        for (var fwi2 = 0; fwi2 < tWeights.length; fwi2++) {
          var wt = tWeights[fwi2];
          var wtStyle = await loadFontWithFallback(primaryFam, wt.value);
          var wtText = figma.createText();
          wtText.fontName = { family: primaryFam, style: wtStyle }; wtText.fontSize = 16;
          wtText.characters = wt.name + " (" + wt.value + ")";
          wtText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          wtText.x = wx; wtText.y = y; frame.appendChild(wtText);
          wx += 160;
          if (wx + 160 > W - PAD) { wx = PAD; y += 32; }
        }
        y += 40;
      }

      if (tLH.length) {
        createSpecText(frame, "Line Heights", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 }); y += 24;
        var lhSample = "The quick brown fox jumps\nover the lazy dog. Pack my\nbox with five dozen\nliquor jugs.";
        var lhColW = Math.floor((W - PAD * 2 - (tLH.length - 1) * 24) / Math.max(tLH.length, 1));
        var lhX = PAD, lhMaxH = 0;
        for (var lhi = 0; lhi < tLH.length; lhi++) {
          var lh = tLH[lhi]; var lhVal = lh.value || 1.5;
          createSpecText(frame, lh.name + " (" + lh.value + ")", lhX, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
          var lhNode = figma.createText();
          lhNode.fontName = { family: "Inter", style: "Regular" }; lhNode.fontSize = 16;
          lhNode.lineHeight = { value: lhVal * 100, unit: "PERCENT" };
          lhNode.characters = lhSample;
          lhNode.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          lhNode.x = lhX; lhNode.y = y + 16; lhNode.resize(lhColW, lhNode.height);
          lhNode.textAutoResize = "HEIGHT"; frame.appendChild(lhNode);
          if (lhNode.height + 16 > lhMaxH) lhMaxH = lhNode.height + 16;
          lhX += lhColW + 24;
        }
        y += lhMaxH + 24;
      }
      y += SECTION_GAP;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RADIUS
  // ══════════════════════════════════════════════════════════════════════════
  var radiusItems = cxGetFloats(cxFindCol(allCols, "radius"), allVars, allCols);
  if (radiusItems.length > 0) {
    sectionTitle("Radius");
    var rx = PAD;
    for (var ri = 0; ri < radiusItems.length; ri++) {
      var rad = radiusItems[ri]; var rv = rad.value;
      var rRect = figma.createRectangle();
      rRect.name = "radius/" + rad.name; rRect.resize(80, 80);
      rRect.x = rx; rRect.y = y; rRect.cornerRadius = Math.min(rv, 40);
      rRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      rRect.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.12 }]; rRect.strokeWeight = 1.5;
      try { rRect.setBoundVariable("cornerRadius", rad.variable); } catch(e) {}
      frame.appendChild(rRect);
      createSpecText(frame, rad.name, rx, y + 86, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, rv + "px", rx, y + 100, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      rx += 112;
      if (rx + 112 > W - PAD) { rx = PAD; y += 120; }
    }
    y += 120 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SHADOWS — from effect styles
  // ══════════════════════════════════════════════════════════════════════════
  var shadowStyles = effectStyles.filter(function(es) { return es.name.toLowerCase().indexOf("shadow") !== -1 && es.effects.length > 0; });
  if (shadowStyles.length > 0) {
    sectionTitle("Shadows");
    var shx = PAD;
    for (var shi = 0; shi < shadowStyles.length; shi++) {
      var shEs = shadowStyles[shi];
      var shEff = shEs.effects[0];
      var shRect = figma.createRectangle();
      shRect.name = shEs.name; shRect.resize(120, 80);
      shRect.x = shx; shRect.y = y; shRect.cornerRadius = 8;
      shRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      try { shRect.effectStyleId = shEs.id; } catch(e) {}
      frame.appendChild(shRect);
      var shLabel = shEs.name.replace(/^shadow\//, "");
      var shVal = (shEff.offset ? shEff.offset.x : 0) + "px " + (shEff.offset ? shEff.offset.y : 0) + "px " + (shEff.radius || 0) + "px";
      createSpecText(frame, shLabel, shx, y + 86, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, shVal, shx, y + 100, 9, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      shx += 152;
      if (shx + 152 > W - PAD) { shx = PAD; y += 130; }
    }
    y += 120 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BORDERS
  // ══════════════════════════════════════════════════════════════════════════
  var borderItems = cxGetFloats(cxFindCol(allCols, "border"), allVars, allCols);
  if (borderItems.length > 0) {
    sectionTitle("Borders");
    var bx = PAD;
    for (var bi = 0; bi < borderItems.length; bi++) {
      var bd = borderItems[bi]; var bv = bd.value;
      var bRect = figma.createRectangle();
      bRect.name = "border/" + bd.name; bRect.resize(100, 60);
      bRect.x = bx; bRect.y = y; bRect.cornerRadius = 4;
      bRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      bRect.strokes = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }]; bRect.strokeWeight = bv;
      try { bRect.setBoundVariable("strokeWeight", bd.variable); } catch(e) {}
      frame.appendChild(bRect);
      createSpecText(frame, bd.name, bx, y + 66, 11, "Medium", { r: 0.2, g: 0.2, b: 0.2 });
      createSpecText(frame, bv + "px", bx, y + 80, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
      bx += 132;
      if (bx + 132 > W - PAD) { bx = PAD; y += 100; }
    }
    y += 100 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Z-INDEX — overlapping stacked cards
  // ══════════════════════════════════════════════════════════════════════════
  var zItems = cxGetFloats(cxFindCol(allCols, "z-index"), allVars, allCols);
  if (zItems.length === 0) zItems = cxGetFloats(cxFindCol(allCols, "zindex"), allVars, allCols);
  if (zItems.length > 0) {
    sectionTitle("Z-Index");
    var zBrand = hexToFigma(brandHex);
    var zSorted = zItems.slice().sort(function(a, b) { return a.value - b.value; });
    var zCardW = 220, zCardH = 80, zOffX = 32, zOffY = -36;
    var zCount = zSorted.length;
    var zBaseX = PAD, zBaseY = y + (zCount - 1) * Math.abs(zOffY);
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
    for (var zi = 0; zi < zCount; zi++) {
      var zItem = zSorted[zi];
      var zx = zBaseX + zi * zOffX, zy = zBaseY + zi * zOffY;
      var zOp = 0.06 + 0.12 * (zi / Math.max(zCount - 1, 1));
      var zCard = figma.createFrame();
      zCard.name = "zindex/" + zItem.name; zCard.resize(zCardW, zCardH);
      zCard.x = zx; zCard.y = zy;
      zCard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      zCard.strokes = [{ type: "SOLID", color: zBrand, opacity: 0.2 + 0.4 * (zi / Math.max(zCount - 1, 1)) }];
      zCard.strokeWeight = 1; zCard.cornerRadius = 6;
      zCard.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: zOp }, offset: { x: 0, y: 2 }, radius: 6, spread: 0, visible: true, blendMode: "NORMAL" }];
      frame.appendChild(zCard);
      var zNameTxt = figma.createText(); zNameTxt.name = "label";
      zNameTxt.fontName = { family: "Inter", style: "Semi Bold" }; zNameTxt.fontSize = 12;
      zNameTxt.characters = zItem.name;
      zNameTxt.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
      zNameTxt.x = 12; zNameTxt.y = zCardH - 34; zCard.appendChild(zNameTxt);
      var zValTxt = figma.createText(); zValTxt.name = "value";
      zValTxt.fontName = { family: "Inter", style: "Regular" }; zValTxt.fontSize = 11;
      zValTxt.characters = String(zItem.value);
      zValTxt.fills = [{ type: "SOLID", color: zBrand, opacity: 0.8 }];
      zValTxt.x = 12; zValTxt.y = zCardH - 18; zCard.appendChild(zValTxt);
    }
    y = zBaseY + zCardH + 16 + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // OPACITY — static 5–95% scale, bound to opacity variables when available
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Opacity");
  var opacityCol2 = cxFindCol(allCols, "opacity");
  var opVarByPct = {};
  if (opacityCol2) {
    var opMid2 = opacityCol2.modes[0].modeId;
    var opAllVars = allVars.filter(function(v) { return v.variableCollectionId === opacityCol2.id && v.resolvedType === "FLOAT"; });
    for (var ovi = 0; ovi < opAllVars.length; ovi++) {
      try { var ovVal = opAllVars[ovi].valuesByMode[opMid2]; opVarByPct[Math.round(ovVal * 100)] = opAllVars[ovi]; } catch(e) {}
    }
  }
  var opCols2 = 10, opGap = 8;
  var opSW = Math.floor((W - PAD * 2 - (opCols2 - 1) * opGap) / opCols2), opSH = 40, opX = PAD;
  for (var opi = 5; opi <= 95; opi += 5) {
    var opRect = figma.createRectangle();
    opRect.name = "opacity/" + opi; opRect.resize(opSW, opSH);
    opRect.x = opX; opRect.y = y;
    opRect.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }]; opRect.opacity = opi / 100;
    fBindFill(opRect, "black");
    if (opVarByPct[opi]) { try { opRect.setBoundVariable("opacity", opVarByPct[opi]); } catch(e) {} }
    frame.appendChild(opRect);
    createSpecText(frame, opi + "%", opX, y + opSH + 4, 10, "Medium", { r: 0.3, g: 0.3, b: 0.3 });
    opX += opSW + opGap;
    if (opX + opSW > W - PAD) { opX = PAD; y += opSH + 24; }
  }
  y += opSH + 24 + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // SPACING — nested squares visualization
  // ══════════════════════════════════════════════════════════════════════════
  var spItems = cxGetFloats(cxFindCol(allCols, "spacing"), allVars, allCols);
  if (spItems.length > 0) {
    sectionTitle("Spacing");
    var spBrand = hexToFigma(brandHex);
    var spColsN = 3, spGutX = 24, spInner = 32, spRowGap = 16;
    var spRowY = y, spRowMax = y;
    for (var spi = 0; spi < spItems.length; spi++) {
      var sp = spItems[spi]; var spVal = sp.value;
      var spColIdx = spi % spColsN;
      var spPad = Math.max(spVal, 4);
      var spOuter = spInner + spPad * 2;
      if (spColIdx === 0 && spi > 0) { spRowY = spRowMax + spRowGap; spRowMax = spRowY; }
      var spCellW = Math.floor((W - PAD * 2 - spGutX) / spColsN);
      var spX = PAD + spColIdx * (spCellW + spGutX);
      // Use auto-layout frame so we can bind padding to spacing variable
      var spFrame = figma.createFrame();
      spFrame.name = "spacing/" + sp.name;
      spFrame.layoutMode = "HORIZONTAL";
      spFrame.primaryAxisAlignItems = "CENTER";
      spFrame.counterAxisAlignItems = "CENTER";
      spFrame.primaryAxisSizingMode = "AUTO";
      spFrame.counterAxisSizingMode = "AUTO";
      spFrame.paddingTop = spPad; spFrame.paddingBottom = spPad;
      spFrame.paddingLeft = spPad; spFrame.paddingRight = spPad;
      spFrame.x = spX; spFrame.y = spRowY;
      spFrame.fills = [{ type: "SOLID", color: spBrand, opacity: 0.12 }];
      spFrame.strokes = [{ type: "SOLID", color: spBrand, opacity: 0.35 }]; spFrame.strokeWeight = 1; spFrame.cornerRadius = 4;
      try {
        spFrame.setBoundVariable("paddingTop", sp.variable);
        spFrame.setBoundVariable("paddingBottom", sp.variable);
        spFrame.setBoundVariable("paddingLeft", sp.variable);
        spFrame.setBoundVariable("paddingRight", sp.variable);
      } catch(e) {}
      frame.appendChild(spFrame);
      var spInnerRect = figma.createRectangle();
      spInnerRect.name = "inner"; spInnerRect.resize(spInner, spInner);
      spInnerRect.fills = [{ type: "SOLID", color: { r: 0.78, g: 0.78, b: 0.82 } }]; spInnerRect.cornerRadius = 2;
      spFrame.appendChild(spInnerRect);
      spOuter = spFrame.width;
      var spLX = spX + spOuter + 12, spLCY = spRowY + (spOuter / 2) - 7;
      createSpecText(frame, sp.name, spLX, spLCY - 1, 12, "Medium", { r: 0.15, g: 0.15, b: 0.15 });
      createSpecText(frame, spVal + "px", spLX, spLCY + 14, 11, "Regular", { r: 0.45, g: 0.45, b: 0.45 });
      if (spRowY + spOuter > spRowMax) spRowMax = spRowY + spOuter;
    }
    y = spRowMax + spRowGap + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BREAKPOINTS — from Breakpoints collection (nested portrait rectangles)
  // ══════════════════════════════════════════════════════════════════════════
  var bpItems = cxGetFloats(cxFindCol(allCols, "breakpoint"), allVars, allCols);
  if (bpItems.length > 0) {
    sectionTitle("Breakpoints");
    var bpBrand = hexToFigma(brandHex);
    var bpAsc = bpItems.slice().sort(function(a, b) { return a.value - b.value; });
    var bpAvailW = W - PAD * 2;
    var bpOuterVal = (bpAsc[bpAsc.length - 1].value || 991) * 1.15;
    var bpScale = bpAvailW / bpOuterVal;
    var bpH = 320, bpCenterX = PAD + bpAvailW / 2, bpBaseY = y;
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
    for (var bpi = bpAsc.length - 1; bpi >= 0; bpi--) {
      var bp = bpAsc[bpi]; var bpVal = bp.value;
      var bpRectW;
      if (bpi === bpAsc.length - 1) { bpRectW = Math.round(bpOuterVal * bpScale); }
      else { bpRectW = Math.round(Math.max(bpVal, 280) * bpScale); }
      var bpX = Math.round(bpCenterX - bpRectW / 2);
      var bpOp = 0.06 + 0.06 * (bpAsc.length - 1 - bpi);
      var bpRect = figma.createRectangle();
      bpRect.name = "breakpoint/" + bp.name; bpRect.resize(bpRectW, bpH);
      bpRect.x = bpX; bpRect.y = bpBaseY;
      bpRect.fills = [{ type: "SOLID", color: bpBrand, opacity: bpOp }];
      bpRect.strokes = [{ type: "SOLID", color: bpBrand, opacity: 0.15 + 0.1 * (bpAsc.length - 1 - bpi) }];
      bpRect.strokeWeight = 1; bpRect.cornerRadius = bpi === bpAsc.length - 1 ? 8 : 4;
      frame.appendChild(bpRect);
      var bpRange;
      if (bpi === bpAsc.length - 1) bpRange = bp.name + " \u2265 " + bpVal + "px";
      else if (bpi === 0) bpRange = bp.name + " < " + bpAsc[1].value + "px";
      else bpRange = bp.name + ": " + bpVal + "\u2013" + bpAsc[bpi + 1].value + "px";
      var bpLabel = figma.createText(); bpLabel.name = "bp-label/" + bp.name;
      bpLabel.fontName = { family: "Inter", style: "Semi Bold" }; bpLabel.fontSize = 11;
      bpLabel.characters = bpRange;
      bpLabel.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
      if (bpi === bpAsc.length - 1) { bpLabel.x = bpX + 10; bpLabel.y = bpBaseY + 10; }
      else { bpLabel.x = bpX + 6; bpLabel.y = bpBaseY + bpH - 20 - bpi * 16; }
      frame.appendChild(bpLabel);
    }
    y = bpBaseY + bpH + 16 + PAD;
  }

  // Resize frame to fit
  var maxBot = y;
  for (var mi = 0; mi < frame.children.length; mi++) {
    var cb = frame.children[mi].y + frame.children[mi].height;
    if (cb > maxBot) maxBot = cb;
  }
  frame.resize(W, Math.max(maxBot + PAD, 400));
  frame.clipsContent = true;
}

// ── Complex Components Page ─────────────────────────────────────────────────
async function generateComponentsPageComplex() {
  var allVars = figma.variables.getLocalVariables();
  var allCols = figma.variables.getLocalVariableCollections();
  var localTextStyles = figma.getLocalTextStyles();

  var page = findPageByHint("components");
  if (!page) return;
  figma.currentPage = page;

  // Load Inter
  var compW = [400, 500, 600, 700];
  for (var cw = 0; cw < compW.length; cw++) await loadFontWithFallback("Inter", compW[cw]);

  // Load user fonts from text styles + Typography STRING vars
  var loadedFams = {};
  for (var tsi = 0; tsi < localTextStyles.length; tsi++) {
    var fam = localTextStyles[tsi].fontName.family;
    if (!loadedFams[fam] && fam !== "Inter") {
      loadedFams[fam] = true;
      for (var cwi = 0; cwi < compW.length; cwi++) await loadFontWithFallback(fam, compW[cwi]);
    }
  }

  // Remove existing
  var existing = page.children.filter(function(n) { return n.name === "Components"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  var W = 1440, PAD = 80, SECTION_GAP = 80;
  var frame = figma.createFrame();
  frame.name = "Components";
  frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  page.appendChild(frame);
  var y = PAD;

  // Detect brand color
  var brandHex = "#3B82F6";
  var colorCol = null;
  for (var ci = 0; ci < allCols.length; ci++) { if (allCols[ci].name === "Colors") { colorCol = allCols[ci]; break; } }
  if (colorCol) {
    var cMid = colorCol.modes[0].modeId;
    for (var bvi = 0; bvi < allVars.length; bvi++) {
      if (allVars[bvi].variableCollectionId === colorCol.id && allVars[bvi].name === "brand/primary") {
        var bVal = cxResolveVar(allVars[bvi], cMid, allCols);
        var bh = cxColorToHex(bVal); if (bh) brandHex = bh; break;
      }
    }
  }
  var brandColor = hexToFigma(brandHex);

  // Color variable binding helpers
  if (!colorCol) {
    colorCol = figma.variables.createVariableCollection("Colors");
  }
  var colorVarMap = {};
  // Re-read vars to pick up essential colors created by ensureEssentialColors()
  var cvars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR"; });
  for (var cvi = 0; cvi < cvars.length; cvi++) colorVarMap[cvars[cvi].name] = cvars[cvi];

  function bindFill(node, varName) {
    var v = colorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }
  function bindStroke(node, varName) {
    var v = colorVarMap[varName]; if (!v) return;
    try { node.strokes = [figma.variables.setBoundVariableForPaint(node.strokes[0], "color", v)]; } catch(e) {}
  }

  function sectionTitle(title) {
    var t = createSpecText(frame, title, PAD, y, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    y += t.height + 8;
    var div = figma.createRectangle(); div.resize(W - PAD * 2, 1);
    div.x = PAD; div.y = y; div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div); y += 24;
  }

  function findStyle(group, name) {
    var sn = group + "/" + name;
    for (var i = 0; i < localTextStyles.length; i++) { if (localTextStyles[i].name === sn) return localTextStyles[i]; }
    return null;
  }

  // Radius
  var defaultRadius = 8;
  var defaultRadiusVar = null;
  var radiusCol = cxFindCol(allCols, "radius");
  if (radiusCol) {
    var rVars = cxGetFloats(radiusCol, allVars, allCols);
    for (var rvi = 0; rvi < rVars.length; rvi++) {
      if (rVars[rvi].name === "md" || rVars[rvi].name === "default") {
        defaultRadius = rVars[rvi].value; defaultRadiusVar = rVars[rvi].variable; break;
      }
    }
  }
  function bindRadius(node) {
    if (!defaultRadiusVar) return;
    try { node.setBoundVariable("cornerRadius", defaultRadiusVar); } catch(e) {}
  }

  // Spacing variable binding
  var spacingCol = cxFindCol(allCols, "spacing");
  var spacingVarMap = {};
  if (spacingCol) {
    var spVars = allVars.filter(function(v) { return v.variableCollectionId === spacingCol.id && v.resolvedType === "FLOAT"; });
    var spMid = spacingCol.modes[0].modeId;
    for (var svi = 0; svi < spVars.length; svi++) {
      try {
        var spv = cxResolveVar(spVars[svi], spMid, allCols);
        if (typeof spv === "number") spacingVarMap[spv] = spVars[svi];
      } catch(e) {}
    }
  }
  function bindCompSpacing(fr) {
    var props = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing","counterAxisSpacing"];
    for (var pi = 0; pi < props.length; pi++) {
      if (!(props[pi] in fr)) continue;
      var val = fr[props[pi]]; if (!val || val <= 0) continue;
      var sv = spacingVarMap[val];
      if (sv) { try { fr.setBoundVariable(props[pi], sv); } catch(e) {} }
    }
  }

  // ── Look up opacity variables for binding ──
  var opacityCol = cxFindCol(allCols, "opacity");
  var opacityVarMapComp = {};
  if (opacityCol) {
    var opVars = allVars.filter(function(v) { return v.variableCollectionId === opacityCol.id && v.resolvedType === "FLOAT"; });
    var opModeId = opacityCol.modes[0].modeId;
    for (var opi = 0; opi < opVars.length; opi++) {
      try {
        var opVal = cxResolveVar(opVars[opi], opModeId, allCols);
        if (typeof opVal === "number") opacityVarMapComp[Math.round(opVal * 100)] = opVars[opi];
      } catch(e) {}
    }
  }
  function bindOpacity(node) {
    if (!("opacity" in node) || node.opacity >= 1 || node.opacity <= 0) return;
    var pct = Math.round(node.opacity * 100);
    var ov = opacityVarMapComp[pct];
    if (ov) { try { node.setBoundVariable("opacity", ov); } catch(e) {} }
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
  for (var bvi2 = 0; bvi2 < btnVariants.length; bvi2++) {
    var variant = btnVariants[bvi2];
    for (var bsi = 0; bsi < btnSizes.length; bsi++) {
      var bs = btnSizes[bsi];
      var ts = findStyle("buttons", bs.style);
      var padH = bs.style === "lg" ? 16 : (bs.style === "sm" ? 8 : 12);
      var padW = bs.style === "lg" ? 32 : (bs.style === "sm" ? 16 : 24);

      var btnComp = figma.createComponent();
      btnComp.name = "Variant=" + variant.label + ", Size=" + bs.label;
      btnComp.cornerRadius = defaultRadius;
      bindRadius(btnComp);

      if (variant.filled) {
        btnComp.fills = [{ type: "SOLID", color: brandColor }];
        bindFill(btnComp, "brand/primary");
      } else {
        btnComp.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        btnComp.strokes = [{ type: "SOLID", color: brandColor }];
        bindFill(btnComp, "white");
        bindStroke(btnComp, "brand/primary");
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
      bindFill(btnText, variant.filled ? "white" : "brand/primary");

      btnComp.layoutMode = "HORIZONTAL";
      btnComp.primaryAxisAlignItems = "CENTER";
      btnComp.counterAxisAlignItems = "CENTER";
      btnComp.paddingTop = padH; btnComp.paddingBottom = padH;
      btnComp.paddingLeft = padW; btnComp.paddingRight = padW;
      btnComp.primaryAxisSizingMode = "AUTO";
      btnComp.counterAxisSizingMode = "AUTO";
      btnComp.appendChild(btnText);
      bindCompSpacing(btnComp);

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
  bindCompSpacing(btnSet);
  y += btnSet.height + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // INPUTS — 3 component sets (one per type), stacked vertically with titles
  // Types: Placeholder, Floating Label, Label + Placeholder
  // Each has State variants: Default, Focused, Error, Disabled
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Inputs");
  var inputStyle = findStyle("input", "default");
  var labelStyle = findStyle("label", "default");
  var labelStyleFocused = findStyle("label", "focused");
  var labelStyleError   = findStyle("label", "error");
  function pickLabelStyle(state) {
    if (state === "Focused" && labelStyleFocused) return labelStyleFocused;
    if (state === "Error"   && labelStyleError)   return labelStyleError;
    return labelStyle;
  }

  var inputTypes = [
    { type: "Placeholder",         hasLabel: false, hasPlaceholder: true,  floatingLabel: false },
    { type: "Floating Label",      hasLabel: true,  hasPlaceholder: false, floatingLabel: true  },
    { type: "Label + Placeholder", hasLabel: true,  hasPlaceholder: true,  floatingLabel: false },
  ];
  var inputStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5, borderVar: "border/default" },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2, borderVar: "focus/border" },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5, borderVar: "error/border" },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1, borderVar: "border/default" },
  ];

  for (var iti = 0; iti < inputTypes.length; iti++) {
    var itype = inputTypes[iti];
    var typeComps = [];

    // ── Type title ──
    var typeTitle = figma.createText();
    typeTitle.fontName = { family: "Inter", style: "Semi Bold" };
    typeTitle.fontSize = 14;
    typeTitle.characters = itype.type;
    typeTitle.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
    bindFill(typeTitle, "text/primary");
    frame.appendChild(typeTitle);
    typeTitle.x = PAD; typeTitle.y = y;
    y += typeTitle.height + 12;

    for (var isi = 0; isi < inputStates.length; isi++) {
      var ist = inputStates[isi];
      var isError = ist.label === "Error";
      var isDisabled = ist.label === "Disabled";

      var inputComp = figma.createComponent();
      inputComp.name = "State=" + ist.label;
      inputComp.resize(260, 44);
      inputComp.layoutMode = "VERTICAL";
      inputComp.primaryAxisSizingMode = "AUTO";
      inputComp.counterAxisSizingMode = "FIXED";
      inputComp.itemSpacing = 0;
      inputComp.fills = [];

      if (itype.floatingLabel) {
        // ── Floating Label type: form-field > field-wrapper > field + label ──
        var isDefault = ist.label === "Default";

        var formField = figma.createFrame();
        formField.name = "form-field";
        formField.layoutMode = "VERTICAL";
        formField.primaryAxisSizingMode = "AUTO";
        formField.counterAxisSizingMode = "AUTO";
        formField.fills = [];

        var fieldWrapper = figma.createFrame();
        fieldWrapper.name = "field-wrapper";
        fieldWrapper.layoutMode = "VERTICAL";
        fieldWrapper.primaryAxisSizingMode = "AUTO";
        fieldWrapper.counterAxisSizingMode = "AUTO";
        fieldWrapper.fills = [];

        var field;
        if (isDefault) {
          field = figma.createRectangle();
          field.name = "field";
          field.resize(260, 44);
          field.cornerRadius = defaultRadius;
          bindRadius(field);
          field.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
          bindFill(field, "white");
          field.strokes = [{ type: "SOLID", color: ist.borderColor }];
          bindStroke(field, ist.borderVar);
          field.strokeWeight = ist.strokeW;
        } else {
          field = figma.createFrame();
          field.name = "field";
          field.resize(260, 44);
          field.layoutMode = "VERTICAL";
          field.primaryAxisSizingMode = "FIXED";
          field.counterAxisSizingMode = "FIXED";
          field.paddingLeft = 14; field.paddingRight = 14;
          field.paddingTop = 20; field.paddingBottom = 6;
          field.cornerRadius = defaultRadius;
          bindRadius(field);
          field.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
          if (!isDisabled) bindFill(field, "white");
          field.strokes = [{ type: "SOLID", color: ist.borderColor }];
          bindStroke(field, ist.borderVar);
          field.strokeWeight = ist.strokeW;

          var floatInput = figma.createText();
          if (inputStyle) {
            floatInput.textStyleId = inputStyle.id;
          } else {
            floatInput.fontName = { family: "Inter", style: "Regular" };
            floatInput.fontSize = 14;
            floatInput.fills = [{ type: "SOLID", color: { r: 0.13, g: 0.13, b: 0.13 } }];
          }
          floatInput.characters = isDisabled ? "Disabled" : "Value";
          if (isDisabled) { floatInput.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }]; floatInput.opacity = 0.5; bindOpacity(floatInput); }
          else { bindFill(floatInput, "text/primary"); }
          field.appendChild(floatInput);
          bindCompSpacing(field);
        }

        fieldWrapper.appendChild(field);
        field.layoutSizingHorizontal = "FILL";

        var floatLbl = figma.createText();
        if (isDefault) {
          if (inputStyle) {
            floatLbl.textStyleId = inputStyle.id;
          } else {
            floatLbl.fontName = { family: "Inter", style: "Regular" };
            floatLbl.fontSize = 14;
            floatLbl.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
          }
          floatLbl.characters = "Label";
          bindFill(floatLbl, "focus/color");
        } else {
          var flStyle = pickLabelStyle(ist.label);
          if (flStyle) {
            floatLbl.textStyleId = flStyle.id;
          } else {
            floatLbl.fontName = { family: "Inter", style: "Medium" };
            floatLbl.fontSize = 10;
            floatLbl.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
          }
          floatLbl.characters = isError ? "Error Label" : "Label";
          if (isError) { floatLbl.fills = [{ type: "SOLID", color: hexToFigma("#E32E22") }]; bindFill(floatLbl, "error/color"); }
          else { bindFill(floatLbl, "text/primary"); }
          if (isDisabled) { floatLbl.opacity = 0.5; bindOpacity(floatLbl); }
        }
        floatLbl.name = "label";
        fieldWrapper.appendChild(floatLbl);
        floatLbl.layoutPositioning = "ABSOLUTE";
        floatLbl.x = 14;
        floatLbl.y = isDefault ? 12 : 4;

        formField.appendChild(fieldWrapper);
        fieldWrapper.layoutSizingHorizontal = "FILL";
        inputComp.appendChild(formField);
        formField.layoutSizingHorizontal = "FILL";

      } else if (itype.hasLabel && itype.hasPlaceholder) {
        // ── Label + Placeholder type: label above, then field with placeholder ──
        inputComp.itemSpacing = 6;

        var lbl = figma.createText();
        var lblSt = pickLabelStyle(ist.label);
        if (lblSt) {
          lbl.textStyleId = lblSt.id;
        } else {
          lbl.fontName = { family: "Inter", style: "Medium" };
          lbl.fontSize = 12;
          lbl.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
        }
        lbl.characters = isError ? "Error Label" : "Label";
        if (isError) { lbl.fills = [{ type: "SOLID", color: hexToFigma("#E32E22") }]; bindFill(lbl, "error/color"); }
        else { bindFill(lbl, "text/primary"); }
        if (isDisabled) { lbl.opacity = 0.5; bindOpacity(lbl); }
        inputComp.appendChild(lbl);

        var inputField = figma.createFrame();
        inputField.name = "field";
        inputField.resize(260, 44);
        inputField.cornerRadius = defaultRadius;
        bindRadius(inputField);
        inputField.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
        if (!isDisabled) bindFill(inputField, "white");
        inputField.strokes = [{ type: "SOLID", color: ist.borderColor }];
        bindStroke(inputField, ist.borderVar);
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
          inputText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
        }
        inputText.characters = isDisabled ? "Disabled" : "Placeholder text";
        bindFill(inputText, "focus/color");
        if (isDisabled) { inputText.opacity = 0.5; bindOpacity(inputText); }
        inputField.appendChild(inputText);
        bindCompSpacing(inputField);
        bindCompSpacing(inputComp);
        inputComp.appendChild(inputField);
        inputField.layoutSizingHorizontal = "FILL";

      } else {
        // ── Placeholder only type: just field with placeholder, no label ──
        var inputField2 = figma.createFrame();
        inputField2.name = "field";
        inputField2.resize(260, 44);
        inputField2.cornerRadius = defaultRadius;
        bindRadius(inputField2);
        inputField2.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
        if (!isDisabled) bindFill(inputField2, "white");
        inputField2.strokes = [{ type: "SOLID", color: ist.borderColor }];
        bindStroke(inputField2, ist.borderVar);
        inputField2.strokeWeight = ist.strokeW;
        inputField2.layoutMode = "HORIZONTAL";
        inputField2.counterAxisAlignItems = "CENTER";
        inputField2.paddingLeft = 14; inputField2.paddingRight = 14;
        inputField2.paddingTop = 10; inputField2.paddingBottom = 10;
        inputField2.primaryAxisSizingMode = "FIXED";
        inputField2.counterAxisSizingMode = "FIXED";

        var inputText2 = figma.createText();
        if (inputStyle) {
          inputText2.textStyleId = inputStyle.id;
        } else {
          inputText2.fontName = { family: "Inter", style: "Regular" };
          inputText2.fontSize = 14;
          inputText2.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
        }
        inputText2.characters = isDisabled ? "Disabled" : "Placeholder text";
        bindFill(inputText2, "focus/color");
        if (isDisabled) { inputText2.opacity = 0.5; bindOpacity(inputText2); }
        inputField2.appendChild(inputText2);
        bindCompSpacing(inputField2);
        inputComp.appendChild(inputField2);
        inputField2.layoutSizingHorizontal = "FILL";
      }

      typeComps.push(inputComp);
    }

    var INPUT_SET_W = 4 * 260 + 3 * 24 + 2 * 24;
    var typeSet = figma.combineAsVariants(typeComps, frame);
    typeSet.name = "Input / " + itype.type;
    typeSet.x = PAD; typeSet.y = y;
    typeSet.resize(INPUT_SET_W, typeSet.height);
    typeSet.layoutMode = "HORIZONTAL";
    typeSet.itemSpacing = 24;
    typeSet.paddingTop = 24; typeSet.paddingBottom = 24;
    typeSet.paddingLeft = 24; typeSet.paddingRight = 24;
    typeSet.primaryAxisSizingMode = "FIXED";
    typeSet.counterAxisSizingMode = "AUTO";
    typeSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    typeSet.cornerRadius = 12;
    typeSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    typeSet.strokeWeight = 1;
    bindCompSpacing(typeSet);
    for (var vi = 0; vi < typeSet.children.length; vi++) {
      typeSet.children[vi].layoutSizingHorizontal = "FILL";
    }
    y += typeSet.height + 24;
  }
  y += SECTION_GAP - 24;

  // ══════════════════════════════════════════════════════════════════════════
  // LABELS (component set with State property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Labels");
  var labelDefaultStyle = findStyle("label", "default");
  var labelFocusedStyle = findStyle("label", "focused");
  var labelErrorStyle   = findStyle("label", "error");
  if (labelDefaultStyle) {
    var lblStates = [
      { label: "Default", text: "Label",       style: labelDefaultStyle },
      { label: "Focused", text: "Label",       style: labelFocusedStyle || labelDefaultStyle },
      { label: "Error",   text: "Error Label", style: labelErrorStyle   || labelDefaultStyle },
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
      lblNode.textStyleId = ls.style.id;
      lblNode.characters = ls.text;
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
    bindCompSpacing(lblSet);
    y += lblSet.height + 30;
  }
  y += SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // DROPDOWN (component set with State property)
  // Same structure as Floating Label input but with a chevron arrow
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Dropdown");
  var dropdownStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5, borderVar: "border/default" },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2, borderVar: "focus/border" },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5, borderVar: "error/border" },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1, borderVar: "border/default" },
  ];

  var chevronImageHash = figma.createImage(
    figma.base64Decode("iVBORw0KGgoAAAANSUhEUgAAABEAAAAKCAMAAABlokWQAAAAUVBMVEUAAAAmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJibJjcPCAAAAGnRSTlMA12X77M24LBMG5INzXkgZ9M7FwKaZUU80D09PB/wAAABWSURBVAjXRchHDsAgAMTAJRBI79X/f2gUhMAna2TMrNJsjBx1k6FZcQpdobemC9Jj2dsIrWcJ/0wWH8ljJ8UuOCSdcCs1Qq8eRuUq2KAq8FOC0uCGdB+C4gRExbf0IwAAAABJRU5ErkJggg==")
  ).hash;

  var allDropComps = [];
  for (var dsi = 0; dsi < dropdownStates.length; dsi++) {
    var dst = dropdownStates[dsi];
    var dIsError = dst.label === "Error";
    var dIsDisabled = dst.label === "Disabled";


    var dropComp = figma.createComponent();
    dropComp.name = "State=" + dst.label;
    dropComp.resize(260, 44);
    dropComp.layoutMode = "VERTICAL";
    dropComp.primaryAxisSizingMode = "AUTO";
    dropComp.counterAxisSizingMode = "FIXED";
    dropComp.itemSpacing = 0;
    dropComp.fills = [];

    var dFormField = figma.createFrame();
    dFormField.name = "form-field";
    dFormField.layoutMode = "VERTICAL";
    dFormField.primaryAxisSizingMode = "AUTO";
    dFormField.counterAxisSizingMode = "AUTO";
    dFormField.fills = [];

    var dFieldWrapper = figma.createFrame();
    dFieldWrapper.name = "field-wrapper";
    dFieldWrapper.layoutMode = "VERTICAL";
    dFieldWrapper.primaryAxisSizingMode = "AUTO";
    dFieldWrapper.counterAxisSizingMode = "AUTO";
    dFieldWrapper.fills = [];

    var dField = figma.createFrame();
    dField.name = "field";
    dField.resize(260, 44);
    dField.layoutMode = "HORIZONTAL";
    dField.primaryAxisSizingMode = "FIXED";
    dField.counterAxisSizingMode = "FIXED";
    dField.counterAxisAlignItems = "CENTER";
    dField.paddingLeft = 14; dField.paddingRight = 14;
    dField.paddingTop = 10; dField.paddingBottom = 10;
    dField.cornerRadius = defaultRadius;
    bindRadius(dField);
    dField.fills = [{ type: "SOLID", color: dIsDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
    if (!dIsDisabled) bindFill(dField, "white");
    dField.strokes = [{ type: "SOLID", color: dst.borderColor }];
    bindStroke(dField, dst.borderVar);
    dField.strokeWeight = dst.strokeW;

    var dText = figma.createText();
    if (inputStyle) {
      dText.textStyleId = inputStyle.id;
    } else {
      dText.fontName = { family: "Inter", style: "Regular" };
      dText.fontSize = 14;
      dText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
    }
    dText.characters = dIsDisabled ? "Disabled" : "Select option";
    bindFill(dText, "focus/color");
    if (dIsDisabled) { dText.opacity = 0.5; bindOpacity(dText); }
    dField.appendChild(dText);
    dText.layoutSizingHorizontal = "FILL";

    var chevron = figma.createRectangle();
    chevron.name = "chevron";
    chevron.resize(17, 10);
    chevron.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: chevronImageHash }];
    if (dIsDisabled) { chevron.opacity = 0.5; bindOpacity(chevron); }
    dField.appendChild(chevron);

    bindCompSpacing(dField);
    dFieldWrapper.appendChild(dField);
    dField.layoutSizingHorizontal = "FILL";

    dFormField.appendChild(dFieldWrapper);
    dFieldWrapper.layoutSizingHorizontal = "FILL";

    dropComp.appendChild(dFormField);
    dFormField.layoutSizingHorizontal = "FILL";

    allDropComps.push(dropComp);
  }

  var dropSet = figma.combineAsVariants(allDropComps, frame);
  dropSet.name = "Dropdown";
  dropSet.x = PAD; dropSet.y = y;
  var DROP_SET_W = 4 * 260 + 3 * 24 + 2 * 24;
  dropSet.resize(DROP_SET_W, dropSet.height);
  dropSet.layoutMode = "HORIZONTAL";
  dropSet.itemSpacing = 24;
  dropSet.paddingTop = 24; dropSet.paddingBottom = 24;
  dropSet.paddingLeft = 24; dropSet.paddingRight = 24;
  dropSet.primaryAxisSizingMode = "FIXED";
  dropSet.counterAxisSizingMode = "AUTO";
  dropSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  dropSet.cornerRadius = 12;
  dropSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  dropSet.strokeWeight = 1;
  bindCompSpacing(dropSet);
  for (var dvi = 0; dvi < dropSet.children.length; dvi++) {
    dropSet.children[dvi].layoutSizingHorizontal = "FILL";
  }
  y += dropSet.height + SECTION_GAP;

  // ══════════════════════════════════════════════════════════════════════════
  // IMAGE WRAPPERS (component set with Radius property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Images");

  var radiusVarMap = {};
  if (radiusCol) {
    var allRadiusVars = allVars.filter(function(v) {
      return v.variableCollectionId === radiusCol.id && v.resolvedType === "FLOAT";
    });
    for (var rvi2 = 0; rvi2 < allRadiusVars.length; rvi2++) {
      var rv = allRadiusVars[rvi2];
      var rvName = rv.name.split("/").pop();
      radiusVarMap[rvName] = rv;
    }
  }

  var imgRadii = [];
  var usedRadiusNames = {};
  for (var rvk in radiusVarMap) {
    if (radiusVarMap.hasOwnProperty(rvk)) {
      var rvVal = 0;
      try {
        var rModeId = radiusCol.modes[0].modeId;
        rvVal = parseFloat(radiusVarMap[rvk].valuesByMode[rModeId]) || 0;
      } catch(e) {}
      imgRadii.push({ label: rvk, value: rvVal, variable: radiusVarMap[rvk] });
      usedRadiusNames[rvk] = true;
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
    var compW2 = isFull ? IMG_H : IMG_W;
    var compH = IMG_H;

    var imgComp = figma.createComponent();
    imgComp.name = "Radius=" + imgR.label;
    imgComp.resize(compW2, compH);
    imgComp.clipsContent = true;
    imgComp.fills = [];

    var appliedR = isFull ? compH / 2 : imgR.value;
    imgComp.cornerRadius = appliedR;

    if (imgR.variable) {
      try {
        imgComp.setBoundVariable("topLeftRadius", imgR.variable);
        imgComp.setBoundVariable("topRightRadius", imgR.variable);
        imgComp.setBoundVariable("bottomLeftRadius", imgR.variable);
        imgComp.setBoundVariable("bottomRightRadius", imgR.variable);
      } catch(e) {}
    }

    var imgRect = figma.createRectangle();
    imgRect.name = "image";
    imgRect.resize(compW2, compH);
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
    bindCompSpacing(imgSet);
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
  if(fn.indexOf("opacity")!==-1)     return "opacity";
  if(fn.indexOf("shadow")!==-1)     return "shadows";
  if(fn.indexOf("z-index")!==-1)    return "zindex";
  if(fn.indexOf("breakpoint")!==-1) return "breakpoints";
  if(fn.indexOf("grid")!==-1)       return "grid";
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
  if(type==="opacity")       return importFlat(data,"Opacity","opacity",false);
  if(type==="zindex")        return importFlat(data,"Z-Index","z-index",false);
  if(type==="breakpoints")   return importFlat(data,"Breakpoints","breakpoint",false);
  if(type==="grid")          return importGrid(data);
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
function importColors(data,modeName){var col=findOrCreateCollection("Colors"),modeId=null;for(var i=0;i<col.modes.length;i++){if(col.modes[i].name===modeName){modeId=col.modes[i].modeId;break;}}if(!modeId){if(col.modes.length===1&&col.modes[0].name==="Mode 1"){col.renameMode(col.modes[0].modeId,modeName);modeId=col.modes[0].modeId;}else modeId=col.addMode(modeName);}var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object")return;if(g["$value"]!==undefined&&g["$type"]==="color"){try{var v=getOrCreateVar(gk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(g["$value"]));count++;}catch(e){}return;}Object.keys(g).forEach(function(tk){var t=g[tk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+tk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return"Imported "+count+" variables";}
function importFlat(data,colName,prefix,isDim){var col=findOrCreateCollection(colName),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(key){var t=data[key];if(!t||t["$value"]===undefined)return;try{var raw=t["$value"],num=isDim&&typeof raw==="object"?raw.value:parseFloat(raw)||0;var v=getOrCreateVar(prefix+"/"+key,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}catch(e){}});return"Imported "+count+" variables";}
function parseCssShadow(str) {
  if (!str || typeof str !== "string") return null;
  var inset = /\binset\b/.test(str);
  var clean = str.replace(/\binset\b/, "").trim();
  var rgbaMatch = clean.match(/rgba?\(([^)]+)\)/);
  var hexMatch = clean.match(/#([0-9a-fA-F]{3,8})/);
  var r = 0, g = 0, b = 0, a = 0.2;
  if (rgbaMatch) {
    var parts = rgbaMatch[1].split(",").map(function(v) { return parseFloat(v.trim()); });
    r = (parts[0] || 0) / 255; g = (parts[1] || 0) / 255; b = (parts[2] || 0) / 255; a = parts[3] !== undefined ? parts[3] : 1;
  } else if (hexMatch) {
    var h = hexMatch[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    r = parseInt(h.slice(0,2),16)/255; g = parseInt(h.slice(2,4),16)/255; b = parseInt(h.slice(4,6),16)/255;
    if (h.length === 8) a = parseInt(h.slice(6,8),16)/255;
  }
  var nums = clean.replace(/rgba?\([^)]+\)/, "").replace(/#[0-9a-fA-F]{3,8}/, "").trim().split(/\s+/).map(function(v) { return parseFloat(v) || 0; });
  return {
    type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: { r: r, g: g, b: b, a: a },
    offset: { x: nums[0] || 0, y: nums[1] || 0 },
    radius: nums[2] || 0,
    spread: nums[3] || 0,
    visible: true,
    blendMode: "NORMAL"
  };
}
function importShadows(data){
  var existingStyles = figma.getLocalEffectStyles();
  var styleMap = {};
  for (var i = 0; i < existingStyles.length; i++) { styleMap[existingStyles[i].name] = existingStyles[i]; }
  var count = 0;
  Object.keys(data).forEach(function(key) {
    var t = data[key];
    if (!t || t["$value"] === undefined) return;
    var shadowStr = String(t["$value"]);
    var parsed = parseCssShadow(shadowStr);
    if (!parsed) return;
    try {
      var styleName = "shadow/" + key;
      var style = styleMap[styleName] || figma.createEffectStyle();
      style.name = styleName;
      style.effects = [parsed];
      if (t["$description"]) style.description = t["$description"];
      styleMap[styleName] = style;
      count++;
    } catch(e) {}
  });
  return "Created/updated " + count + " effect style" + (count !== 1 ? "s" : "");
}
function importTypography(data){var col=findOrCreateCollection("Typography"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object")return;Object.keys(g).forEach(function(key){var t=g[key];if(!t||t["$value"]===undefined)return;try{var vn=gk+"/"+key,val=t["$value"];if(t["$type"]==="fontFamily"){var v=getOrCreateVar(vn,col,"STRING",map);v.setValueForMode(modeId,String(val));count++;}else if(t["$type"]==="dimension"){var num=typeof val==="object"?val.value:parseFloat(val)||0;var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}else if(t["$type"]==="number"){var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,parseFloat(val)||0);count++;}}catch(e){}});});return"Imported "+count+" variables";}

function importGrid(data) {
  var col = findOrCreateCollection("Grid");
  var breakpointNames = ["xs", "sm", "md", "lg"];
  // Ensure modes exist for each breakpoint
  var modeIds = {};
  for (var bi = 0; bi < breakpointNames.length; bi++) {
    var bpName = breakpointNames[bi];
    var found = false;
    for (var mi = 0; mi < col.modes.length; mi++) {
      if (col.modes[mi].name === bpName) { modeIds[bpName] = col.modes[mi].modeId; found = true; break; }
    }
    if (!found) {
      if (bi === 0 && col.modes.length === 1 && col.modes[0].name === "Mode 1") {
        col.renameMode(col.modes[0].modeId, bpName);
        modeIds[bpName] = col.modes[0].modeId;
      } else {
        modeIds[bpName] = col.addMode(bpName);
      }
    }
  }
  var map = buildVarMap(col);
  var count = 0;
  // data structure: { "grid/columns": { xs: 4, sm: 8, md: 12, lg: 12 }, "grid/gutter": {...}, "grid/col-1": {...}, ... }
  Object.keys(data).forEach(function(varName) {
    var entry = data[varName];
    if (!entry || typeof entry !== "object") return;
    try {
      var v = getOrCreateVar(varName, col, "FLOAT", map);
      for (var bp in entry) {
        if (modeIds[bp] !== undefined) {
          v.setValueForMode(modeIds[bp], entry[bp]);
        }
      }
      count++;
    } catch(e) {}
  });
  return "Imported " + count + " grid variables";
}

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

function generateOpacityData() {
  var tokens = {};
  for (var i = 5; i <= 95; i += 5) {
    tokens[i] = { "$type": "number", "$value": i / 100 };
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

function generateGridData() {
  // 12-column grid system with 4 breakpoints
  // xs: 4 cols, 16px gutter, 16px margin
  // sm: 8 cols, 16px gutter, 24px margin
  // md: 12 cols, 24px gutter, 32px margin
  // lg: 12 cols, 32px gutter, auto margin (0 = auto)
  var data = {
    "grid/columns":   { xs: 4,  sm: 8,  md: 12, lg: 12 },
    "grid/gutter":    { xs: 16, sm: 16, md: 24, lg: 32 },
    "grid/margin":    { xs: 16, sm: 24, md: 32, lg: 0 }
  };
  // Column span widths as percentages of container (span / totalCols * 100)
  // These represent the fractional width each span occupies
  for (var span = 1; span <= 12; span++) {
    var key = "grid/col-" + span;
    data[key] = {
      xs: Math.round((span / 4)  * 10000) / 100,  // % of 4-col grid
      sm: Math.round((span / 8)  * 10000) / 100,  // % of 8-col grid
      md: Math.round((span / 12) * 10000) / 100,  // % of 12-col grid
      lg: Math.round((span / 12) * 10000) / 100   // % of 12-col grid
    };
  }
  return data;
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
    case "opacity":      return { filename: "opacity.json",      data: generateOpacityData() };
    case "shadows":      return { filename: "shadows.json",      data: generateShadowsData(shadowsData) };
    case "zindex":       return { filename: "z-index.json",      data: generateZIndexData(zindexData) };
    case "breakpoints":  return { filename: "breakpoints.json",  data: generateBreakpointsData() };
    case "grid":         return { filename: "grid.json",         data: generateGridData() };
    default: throw new Error("Unknown generator category: " + category);
  }
}