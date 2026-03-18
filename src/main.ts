// Main entry point — plugin init, selection listener, and message router
import { countTokensByCategory, ensureEssentialColors, ensureComponentTextStyles, getAuditPages, hexToFigma } from './utils';
import { pushDebugData, runAudit, runFixes, findNearestColorVar, findNearestFloatVar, serializeNodeForNaming } from './audit';
import { generateCover, updateCoverStatus } from './cover';
import { generatePromoStructure } from './wireframes';
import { generateFoundationsPage } from './foundations';
import { generateComponentsPage } from './components';
import { generateFoundationsPageComplex } from './foundations-complex';
import { generateComponentsPageComplex } from './components-complex';
import { importTokens } from './tokens-import';
import { generateTokenData } from './tokens-generate';
import {
  _htmlImageNameCount, htmlWalkNode, htmlCountImages, htmlCollectImages,
  htmlRenderCSS, htmlSanitizeName, htmlRenderNodeClean,
  htmlBuildUtilityMap, htmlBuildSpacingLookup, htmlAddColorUtilities, htmlAssignUtilities
} from './html-export';

figma.showUI(__html__, { width: 920, height: 680, title: "Dev-Ready Tools for Designers by wowbrands" });

// Load saved settings and send to UI
(async function() {
  try {
    var saved = await figma.clientStorage.getAsync("wf-settings");
    if (saved) {
      figma.ui.postMessage({ type: "load-settings", settings: saved });
    }
  } catch(e) {}
  // Send Figma user info for proxy auth
  if (figma.currentUser) {
    figma.ui.postMessage({
      type: "user-info",
      userId: figma.currentUser.id || "",
      userName: figma.currentUser.name || ""
    });
  }
})();

figma.on("selectionchange", function() { pushDebugData(); });

figma.ui.onmessage = async function(msg) {
  if (msg.type === "run-audit") {
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "focus-node") {
    var node = figma.getNodeById(msg.id);
    if (node) {
      // Switch to the node's page if needed
      var pg = node;
      while (pg && pg.type !== "PAGE") pg = pg.parent;
      if (pg && pg.type === "PAGE" && figma.currentPage !== pg) figma.currentPage = pg;
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
    }
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
  if (msg.type === "bind-stroke") {
    var node = figma.getNodeById(msg.id);
    if (node && "strokes" in node && Array.isArray(node.strokes)) {
      var colorVars = figma.variables.getLocalVariables().filter(function(v){ return v.resolvedType === "COLOR"; });
      if (colorVars.length > 0) {
        var newStrokes = node.strokes.map(function(stroke, i) {
          if (stroke.type !== "SOLID" || stroke.visible === false) return stroke;
          var bv = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[i];
          if (bv) return stroke;
          var nearest = findNearestColorVar(stroke.color, colorVars);
          if (nearest) { try { return figma.variables.setBoundVariableForPaint(stroke,"color",nearest); } catch(e) { return stroke; } }
          return stroke;
        });
        try { node.strokes = newStrokes; } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "bind-spacing") {
    var node = figma.getNodeById(msg.id);
    if (node && "layoutMode" in node && node.layoutMode !== "NONE") {
      var floatVars = figma.variables.getLocalVariables().filter(function(v){ return v.resolvedType === "FLOAT"; });
      var spacingProps = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"];
      for (var spi = 0; spi < spacingProps.length; spi++) {
        var prop = spacingProps[spi];
        if (!(prop in node)) continue;
        var val = node[prop];
        if (val === figma.mixed || !val || val <= 0) continue;
        var bv = node.boundVariables && node.boundVariables[prop];
        if (bv) continue;
        var nearest = findNearestFloatVar(val, floatVars);
        if (nearest) { try { node.setBoundVariable(prop, nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "bind-radius") {
    var node = figma.getNodeById(msg.id);
    if (node && "cornerRadius" in node) {
      var floatVars = figma.variables.getLocalVariables().filter(function(v){ return v.resolvedType === "FLOAT"; });
      var radiusProps = ["cornerRadius","topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"];
      for (var rpi = 0; rpi < radiusProps.length; rpi++) {
        var prop = radiusProps[rpi];
        if (!(prop in node)) continue;
        var val = node[prop];
        if (val === figma.mixed || !val || val <= 0) continue;
        var bv = node.boundVariables && node.boundVariables[prop];
        if (bv) continue;
        var nearest = findNearestFloatVar(val, floatVars);
        if (nearest) { try { node.setBoundVariable(prop, nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "bind-opacity") {
    var node = figma.getNodeById(msg.id);
    if (node && "opacity" in node && node.opacity < 1 && node.opacity > 0) {
      var floatVars = figma.variables.getLocalVariables().filter(function(v){ return v.resolvedType === "FLOAT"; });
      var bv = node.boundVariables && node.boundVariables.opacity;
      if (!bv) {
        var nearest = findNearestFloatVar(node.opacity, floatVars);
        if (nearest) { try { node.setBoundVariable("opacity", nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "bind-border-width") {
    var node = figma.getNodeById(msg.id);
    if (node && "strokeWeight" in node && node.strokeWeight > 0) {
      var floatVars = figma.variables.getLocalVariables().filter(function(v){ return v.resolvedType === "FLOAT"; });
      var bv = node.boundVariables && node.boundVariables.strokeWeight;
      if (!bv) {
        var nearest = findNearestFloatVar(node.strokeWeight, floatVars);
        if (nearest) { try { node.setBoundVariable("strokeWeight", nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "bind-text-style") {
    var node = figma.getNodeById(msg.id);
    if (node && node.type === "TEXT" && msg.styleId) {
      var ts = figma.getStyleById(msg.styleId);
      if (ts) {
        try {
          await figma.loadFontAsync(ts.fontName);
          node.textStyleId = ts.id;
        } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "create-text-style") {
    var node = figma.getNodeById(msg.id);
    if (node && node.type === "TEXT" && msg.styleName) {
      try {
        var fn = node.fontName !== figma.mixed ? node.fontName : { family: "Inter", style: "Regular" };
        await figma.loadFontAsync(fn);
        var newTs = figma.createTextStyle();
        newTs.name = msg.styleName;
        newTs.fontName = fn;
        newTs.fontSize = node.fontSize !== figma.mixed ? node.fontSize : 14;
        if (node.lineHeight !== figma.mixed && node.lineHeight) newTs.lineHeight = node.lineHeight;
        if (node.letterSpacing !== figma.mixed && node.letterSpacing) newTs.letterSpacing = node.letterSpacing;
        node.textStyleId = newTs.id;
      } catch(e) {}
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "create-and-bind") {
    // Create a new variable and bind it to the node property
    var node = figma.getNodeById(msg.nodeId);
    if (node && msg.varName) {
      try {
        var cols = figma.variables.getLocalVariableCollections();
        var targetCol = null;
        var colName = msg.collection || "";
        // Find or create the target collection
        for (var ci = 0; ci < cols.length; ci++) {
          if (cols[ci].name.toLowerCase() === colName.toLowerCase()) { targetCol = cols[ci]; break; }
        }
        if (!targetCol) {
          targetCol = figma.variables.createVariableCollection(colName || "Variables");
        }
        var modeId = targetCol.modes[0].modeId;
        if (msg.varType === "COLOR") {
          var newVar = figma.variables.createVariable(msg.varName, targetCol, "COLOR");
          var rgb = hexToFigma(msg.rawValue || "#000000");
          newVar.setValueForMode(modeId, { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 });
          // Bind to the appropriate paint
          if (msg.bindType === "fill" && "fills" in node && Array.isArray(node.fills)) {
            var idx = msg.bindIndex || 0;
            if (idx < node.fills.length) {
              var nf = node.fills.slice();
              try { nf[idx] = figma.variables.setBoundVariableForPaint(nf[idx], "color", newVar); node.fills = nf; } catch(e) {}
            }
          } else if (msg.bindType === "stroke" && "strokes" in node && Array.isArray(node.strokes)) {
            var idx = msg.bindIndex || 0;
            if (idx < node.strokes.length) {
              var ns = node.strokes.slice();
              try { ns[idx] = figma.variables.setBoundVariableForPaint(ns[idx], "color", newVar); node.strokes = ns; } catch(e) {}
            }
          }
        } else {
          // FLOAT variable
          var newVar = figma.variables.createVariable(msg.varName, targetCol, "FLOAT");
          newVar.setValueForMode(modeId, parseFloat(msg.rawValue) || 0);
          // Bind based on type
          if (msg.bindType === "spacing") {
            ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"].forEach(function(prop) {
              if (!(prop in node)) return;
              var val = node[prop];
              if (val === figma.mixed || !val || val <= 0) return;
              var b = node.boundVariables && node.boundVariables[prop];
              if (b) return;
              // Only bind props whose value is close to the new variable value
              if (Math.abs(val - (parseFloat(msg.rawValue) || 0)) < Math.max(val * 0.1, 1)) {
                try { node.setBoundVariable(prop, newVar); } catch(e) {}
              }
            });
          } else if (msg.bindType === "radius") {
            try { node.setBoundVariable("cornerRadius", newVar); } catch(e) {}
          } else if (msg.bindType === "opacity") {
            try { node.setBoundVariable("opacity", newVar); } catch(e) {}
          } else if (msg.bindType === "borderWidth") {
            try { node.setBoundVariable("strokeWeight", newVar); } catch(e) {}
          }
        }
      } catch(e) {}
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  // ── AI Naming: serialize node context for AI ───────────────────────────────
  if (msg.type === "ai-name-suggest") {
    var nodeIds = msg.nodeIds || [];
    var serialized = [];
    for (var ni = 0; ni < nodeIds.length; ni++) {
      var node = figma.getNodeById(nodeIds[ni]);
      if (node) serialized.push(serializeNodeForNaming(node));
    }
    figma.ui.postMessage({ type: "ai-name-context", nodes: serialized });
  }
  // ── AI Naming: apply AI-suggested names ────────────────────────────────────
  if (msg.type === "apply-ai-names") {
    var names = msg.names || [];
    for (var ani = 0; ani < names.length; ani++) {
      var entry = names[ani];
      if (entry.id && entry.name) {
        var node = figma.getNodeById(entry.id);
        if (node && node.type !== "TEXT") {
          try { node.name = entry.name; } catch(e) {}
        }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:runAudit() });
  }
  if (msg.type === "fix-all-check") {
    var checkKey = msg.checkKey;
    var auditResult = runAudit();
    var checkData = auditResult.checks[checkKey];
    if (checkData && checkData.issues.length > 0) {
      var ids = [];
      for (var fai = 0; fai < checkData.issues.length; fai++) {
        var fid = checkData.issues[fai].id;
        if (ids.indexOf(fid) === -1) ids.push(fid);
      }
      for (var fi = 0; fi < ids.length; fi++) {
        var fakeMsg = { id: ids[fi] };
        if (checkKey === "naming") {
          var n = figma.getNodeById(ids[fi]);
          if (n && n.type !== "TEXT") {
            var iss = checkData.issues.filter(function(is){ return is.id === ids[fi]; })[0];
            if (iss && iss.suggestedName) n.name = iss.suggestedName;
          }
        } else if (checkKey === "namingFormat") {
          var n = figma.getNodeById(ids[fi]);
          if (n && n.type !== "TEXT") {
            var iss = checkData.issues.filter(function(is){ return is.id === ids[fi]; })[0];
            if (iss && iss.suggestedName) n.name = iss.suggestedName;
          }
        } else if (checkKey === "hidden") {
          var n = figma.getNodeById(ids[fi]);
          if (n) { try { n.remove(); } catch(e) {} }
        } else if (checkKey === "empty") {
          var n = figma.getNodeById(ids[fi]);
          if (n) { try { n.remove(); } catch(e) {} }
        } else if (checkKey === "colors") {
          // Only bind issues that have a suggestedVar
          var issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          var n = figma.getNodeById(ids[fi]);
          if (n) {
            for (var ii = 0; ii < issuesForNode.length; ii++) {
              var iss = issuesForNode[ii];
              var v = figma.variables.getVariableById(iss.suggestedVar.id);
              if (!v) continue;
              if (iss.bindType === "fill" && "fills" in n && Array.isArray(n.fills)) {
                var idx = iss.bindIndex || 0;
                if (n.fills[idx]) {
                  try { var nf = n.fills.slice(); nf[idx] = figma.variables.setBoundVariableForPaint(nf[idx],"color",v); n.fills = nf; } catch(e) {}
                }
              } else if (iss.bindType === "stroke" && "strokes" in n && Array.isArray(n.strokes)) {
                var idx = iss.bindIndex || 0;
                if (n.strokes[idx]) {
                  try { var ns = n.strokes.slice(); ns[idx] = figma.variables.setBoundVariableForPaint(ns[idx],"color",v); n.strokes = ns; } catch(e) {}
                }
              }
            }
          }
        } else if (checkKey === "spacingVars") {
          var issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          var n = figma.getNodeById(ids[fi]);
          if (n) {
            for (var ii = 0; ii < issuesForNode.length; ii++) {
              var iss = issuesForNode[ii];
              var v = figma.variables.getVariableById(iss.suggestedVar.id);
              if (!v || !iss.bindType) continue;
              try { n.setBoundVariable(iss.bindType, v); } catch(e) {}
            }
          }
        } else if (checkKey === "radiusVars") {
          var issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          var n = figma.getNodeById(ids[fi]);
          if (n) {
            for (var ii = 0; ii < issuesForNode.length; ii++) {
              var iss = issuesForNode[ii];
              var v = figma.variables.getVariableById(iss.suggestedVar.id);
              if (!v || !iss.bindType) continue;
              try { n.setBoundVariable(iss.bindType, v); } catch(e) {}
            }
          }
        } else if (checkKey === "opacityVars") {
          var iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; })[0];
          if (!iss) continue;
          var n = figma.getNodeById(ids[fi]);
          if (n) {
            var v = figma.variables.getVariableById(iss.suggestedVar.id);
            if (v) { try { n.setBoundVariable("opacity", v); } catch(e) {} }
          }
        } else if (checkKey === "borderVars") {
          var iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; })[0];
          if (!iss) continue;
          var n = figma.getNodeById(ids[fi]);
          if (n) {
            var v = figma.variables.getVariableById(iss.suggestedVar.id);
            if (v) { try { n.setBoundVariable("strokeWeight", v); } catch(e) {} }
          }
        } else if (checkKey === "textStyles") {
          var iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedStyle; })[0];
          if (!iss) continue;
          var n = figma.getNodeById(ids[fi]);
          if (n && n.type === "TEXT" && iss.suggestedStyle.id) {
            var ts = figma.getStyleById(iss.suggestedStyle.id);
            if (ts && ts.type === "TEXT") {
              try {
                await figma.loadFontAsync(ts.fontName);
                n.textStyleId = ts.id;
              } catch(e) {}
            }
          }
        }
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
  if (msg.type === "update-cover-status") {
    await updateCoverStatus(msg);
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
      var hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
      var exists = figma.root.children.some(function(p) {
        return p.name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1;
      });
      if (!exists) figma.createPage().name = PAGE_DEFS[key];
    });
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
    allPages.forEach(function(p) { sorted.push(p); });
    sorted.forEach(function(p, i) { figma.root.insertChild(i, p); });
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

  if (msg.type === "build-html") {
    try {
      var opts = msg.options || {};
      var includeMobile = opts.includeMobile !== false;
      var includeScreenshots = opts.includeScreenshots === true;
      var pageType = opts.pageType || "promo";

      // Phase 1: Scan
      figma.ui.postMessage({ type: "build-html-progress", phase: "Scanning node tree…", percent: 10 });
      var auditPages = getAuditPages();
      var desktopPage = null, mobilePage = null;
      for (var bhi = 0; bhi < auditPages.length; bhi++) {
        var bhName = auditPages[bhi].name.toLowerCase().replace(/[^a-z]/g, "");
        if (bhName.indexOf("desktop") !== -1) desktopPage = auditPages[bhi];
        if (bhName.indexOf("mobile") !== -1) mobilePage = auditPages[bhi];
      }
      if (!desktopPage) {
        figma.ui.postMessage({ type: "build-html-error", error: "No Desktop page found. Generate wireframes first." });
        return;
      }

      var cssVars = {};
      var images = [];
      // Reset image name dedup counter
      for (var k in _htmlImageNameCount) { if (_htmlImageNameCount.hasOwnProperty(k)) delete _htmlImageNameCount[k]; }

      // Phase 2: Walk desktop tree
      figma.ui.postMessage({ type: "build-html-progress", phase: "Resolving variables…", percent: 25 });
      var desktopTrees = [];
      for (var dci = 0; dci < desktopPage.children.length; dci++) {
        var dChild = desktopPage.children[dci];
        if (dChild.visible === false) continue;
        var dTree = htmlWalkNode(dChild, cssVars, images, 0, null, pageType);
        if (dTree) desktopTrees.push(dTree);
      }

      // Walk mobile tree if requested
      var mobileTrees = null;
      if (includeMobile && mobilePage) {
        mobileTrees = [];
        for (var mci = 0; mci < mobilePage.children.length; mci++) {
          var mChild = mobilePage.children[mci];
          if (mChild.visible === false) continue;
          var mTree = htmlWalkNode(mChild, cssVars, images, 0, null, pageType);
          if (mTree) mobileTrees.push(mTree);
        }
      }

      // Phase 2b: Assign utility classes
      var tokens = opts.tokens || null;
      var utilMap = htmlBuildUtilityMap(tokens);
      var spacingLookup = htmlBuildSpacingLookup(tokens, cssVars);
      htmlAddColorUtilities(utilMap, cssVars);
      for (var uti = 0; uti < desktopTrees.length; uti++) {
        htmlAssignUtilities(desktopTrees[uti], utilMap, spacingLookup);
      }
      if (mobileTrees) {
        for (var muti = 0; muti < mobileTrees.length; muti++) {
          htmlAssignUtilities(mobileTrees[muti], utilMap, spacingLookup);
        }
      }

      // Phase 3: Export images
      var totalImages = 0;
      for (var dti = 0; dti < desktopTrees.length; dti++) totalImages += htmlCountImages(desktopTrees[dti]);
      figma.ui.postMessage({ type: "build-html-progress", phase: "Exporting images (0/" + totalImages + ")…", percent: 40 });
      var counter = { done: 0, total: totalImages };
      for (var dei = 0; dei < desktopTrees.length; dei++) {
        await htmlCollectImages(desktopTrees[dei], images, function(done, total) {
          figma.ui.postMessage({ type: "build-html-progress", phase: "Exporting images (" + done + "/" + total + ")…", percent: 40 + Math.round((done / Math.max(total, 1)) * 30) });
        }, counter);
      }

      // Phase 4: Compile
      figma.ui.postMessage({ type: "build-html-progress", phase: "Generating HTML…", percent: 80 });

      var combinedDesktop = { className: "", styles: {}, children: desktopTrees, tag: "body", text: null, isImage: false, imageName: null, nodeName: "body", nodeId: null };
      var combinedMobile = mobileTrees ? { className: "", styles: {}, children: mobileTrees, tag: "body", text: null, isImage: false, imageName: null, nodeName: "body", nodeId: null } : null;
      var css = htmlRenderCSS(cssVars, combinedDesktop, combinedMobile, tokens);

      var htmlFiles = [];
      if (pageType === "promo") {
        // Promo: one HTML file per top-level frame (each is a <section>)
        for (var bri = 0; bri < desktopTrees.length; bri++) {
          var frameTree = desktopTrees[bri];
          var frameName = htmlSanitizeName(frameTree.nodeName || ("section-" + bri));
          var frameBody = htmlRenderNodeClean(frameTree, 2);
          var frameHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + (frameTree.nodeName || "Page") + '</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n' + frameBody + '\n</body>\n</html>';
          htmlFiles.push({ name: frameName + ".html", content: frameHtml, frameName: frameTree.nodeName || frameName });
        }
      } else {
        // Landing / Full Site: top-level frames represent <body>, render children directly
        // All frames go into a single index.html
        var bodyContent = "";
        for (var bri = 0; bri < desktopTrees.length; bri++) {
          // htmlRenderNodeClean unwraps "body" tags automatically
          bodyContent += htmlRenderNodeClean(desktopTrees[bri], 2) + "\n";
        }
        var pageTitle = desktopTrees.length > 0 ? (desktopTrees[0].nodeName || "Page") : "Page";
        var indexHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + pageTitle + '</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n' + bodyContent + '</body>\n</html>';
        htmlFiles.push({ name: "index.html", content: indexHtml, frameName: pageTitle });
      }

      // Phase 5: Export frame screenshots for AI visual context (only when AI enhancement is enabled)
      var screenshots = [];
      if (includeScreenshots) {
        figma.ui.postMessage({ type: "build-html-progress", phase: "Capturing design screenshots…", percent: 95 });
        for (var sci = 0; sci < desktopPage.children.length; sci++) {
          var scChild = desktopPage.children[sci];
          if (scChild.visible === false || !("exportAsync" in scChild)) continue;
          try {
            var scBytes = await scChild.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: 1 } });
            screenshots.push({ name: scChild.name || ("frame-" + sci), page: "desktop", bytes: Array.prototype.slice.call(scBytes) });
          } catch(e) {}
        }
        if (includeMobile && mobilePage) {
          for (var smci = 0; smci < mobilePage.children.length; smci++) {
            var smChild = mobilePage.children[smci];
            if (smChild.visible === false || !("exportAsync" in smChild)) continue;
            try {
              var smBytes = await smChild.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: 1 } });
              screenshots.push({ name: smChild.name || ("frame-" + smci), page: "mobile", bytes: Array.prototype.slice.call(smBytes) });
            } catch(e) {}
          }
        }
      }

      figma.ui.postMessage({ type: "build-html-progress", phase: "Done!", percent: 100 });
      figma.ui.postMessage({
        type: "build-html-result",
        htmlFiles: htmlFiles,
        css: css,
        images: images,
        screenshots: screenshots,
        stats: { nodes: desktopTrees.length, files: htmlFiles.length, images: images.length, variables: Object.keys(cssVars).length }
      });
    } catch(e) {
      figma.ui.postMessage({ type: "build-html-error", error: String(e) });
    }
  }

  // API key is session-only (not persisted) for security

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
      var localTS = figma.getLocalTextStyles();
      for (var ti = 0; ti < localTS.length; ti++) {
        localTS[ti].remove();
      }
      var localES = figma.getLocalEffectStyles();
      for (var ei = 0; ei < localES.length; ei++) {
        localES[ei].remove();
      }
      var localVars = figma.variables.getLocalVariables();
      for (var vi = 0; vi < localVars.length; vi++) {
        localVars[vi].remove();
      }
      var localCols = figma.variables.getLocalVariableCollections();
      for (var ci = 0; ci < localCols.length; ci++) {
        localCols[ci].remove();
      }
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
