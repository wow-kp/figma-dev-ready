// Build-time constant injected by esbuild --define (from proxy-config.json)
declare const BUILTIN_PROXY_URL: string;

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
import { detectFileType, analyzeDesign, archiveExistingContent, createTokensFromAnalysis, reorganizeFrames, bindTokensToDesign, cleanupOriginalPages, scanExistingVariables, matchTokensWithExisting } from './design-import';
import {
  _htmlImageNameCount, htmlWalkNode, htmlCountImages, htmlCollectImages,
  htmlRenderCSS, htmlSanitizeName, htmlRenderNodeClean,
  htmlBuildUtilityMap, htmlBuildSpacingLookup, htmlAddColorUtilities, htmlAssignUtilities
} from './html-export';

figma.showUI(__html__, { width: 920, height: 680, title: "Dev-Ready Tools for Designers by wowbrands" });

// Helper: scan pages for content presence
function getPageContentFlags() {
  var flags = { hasDesktopContent: false, hasMobileContent: false, hasFoundationsContent: false, hasComponentsContent: false };
  for (var pi = 0; pi < figma.root.children.length; pi++) {
    var pg = figma.root.children[pi];
    var pn = pg.name.toLowerCase();
    if (pn.indexOf("desktop") !== -1 && pg.children.length > 0) flags.hasDesktopContent = true;
    if (pn.indexOf("mobile") !== -1 && pg.children.length > 0) flags.hasMobileContent = true;
    if (pn.indexOf("foundations") !== -1 && pg.children.length > 0) flags.hasFoundationsContent = true;
    if (pn.indexOf("components") !== -1 && pg.children.length > 0) flags.hasComponentsContent = true;
  }
  return flags;
}

// Helper: check if Desktop/Mobile pages have content and notify UI
async function sendPageContentUpdate() {
  try { await figma.loadAllPagesAsync(); } catch(e) {}
  var flags = getPageContentFlags();
  figma.ui.postMessage({ type: "page-content-update", hasDesktopContent: flags.hasDesktopContent, hasMobileContent: flags.hasMobileContent, hasFoundationsContent: flags.hasFoundationsContent, hasComponentsContent: flags.hasComponentsContent });
}

// Helper: gather token counts and send tokens-data message
async function refreshTokenCounts() {
  var allVars = await figma.variables.getLocalVariablesAsync();
  var cols = await figma.variables.getLocalVariableCollectionsAsync();
  var ts = await figma.getLocalTextStylesAsync();
  var es = await figma.getLocalEffectStylesAsync();
  var counts = countTokensByCategory(allVars, cols);
  for (var i = 0; i < es.length; i++) { if (es[i].name.toLowerCase().indexOf("shadow") !== -1) counts.shadows++; }
  counts.textStyles = ts.length;
  counts.effectStyles = es.length;
  counts.collections = cols.map(function(c) { return { name: c.name, count: allVars.filter(function(v) { return v.variableCollectionId === c.id; }).length }; });
  figma.ui.postMessage({ type: "tokens-data", tokens: counts });
}

// Load saved settings, then load all pages and register documentchange
(async function() {
  // Settings first (fast, non-blocking) — per-file storage keyed by file ID
  var _settingsKey = "wf-settings-" + figma.root.id;
  try {
    var saved = await figma.clientStorage.getAsync(_settingsKey);
    // Migration: if no per-file settings, check for old global key
    if (!saved) {
      var oldSaved = await figma.clientStorage.getAsync("wf-settings");
      if (oldSaved) {
        saved = oldSaved;
        await figma.clientStorage.setAsync(_settingsKey, saved);
        await figma.clientStorage.deleteAsync("wf-settings");
      }
    }
    if (saved) {
      figma.ui.postMessage({ type: "load-settings", settings: saved });
    }
  } catch(e) {}
  try {
    var aiConfig = await figma.clientStorage.getAsync("ai-config") || {};
    // Inject build-time proxy URL so UI doesn't need build-time modification
    aiConfig.builtinProxyUrl = BUILTIN_PROXY_URL || "";
    figma.ui.postMessage({ type: "ai-config-loaded", config: aiConfig });
  } catch(e) {}
  if (figma.currentUser) {
    figma.ui.postMessage({
      type: "user-info",
      userId: figma.currentUser.id || "",
      userName: figma.currentUser.name || ""
    });
  }
  // Load all pages (required before registering documentchange in dynamic-page mode)
  try {
    await figma.loadAllPagesAsync();
    var _docChangeTimer: ReturnType<typeof setTimeout> | null = null;
    var _auditRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    figma.on("documentchange", function() {
      if (_docChangeTimer) clearTimeout(_docChangeTimer);
      _docChangeTimer = setTimeout(sendPageContentUpdate, 300);
      // Notify UI that the document changed so it can auto-refresh the audit
      if (_auditRefreshTimer) clearTimeout(_auditRefreshTimer);
      _auditRefreshTimer = setTimeout(function() {
        figma.ui.postMessage({ type: "document-changed" });
      }, 800);
    });
  } catch(e) {}
})();

figma.on("selectionchange", function() { pushDebugData(); });

figma.ui.onmessage = async function(msg) {
  if (msg.type === "run-audit") {
    await figma.loadAllPagesAsync();
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "focus-node") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node) {
      // Switch to the node's page if needed
      var pg = node;
      while (pg && pg.type !== "PAGE") pg = pg.parent;
      if (pg && pg.type === "PAGE" && figma.currentPage !== pg) await figma.setCurrentPageAsync(pg);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
    }
  }
  // ── Per-issue inline fixes ────────────────────────────────────────────────
  if (msg.type === "rename-node") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && msg.name && msg.name.trim()) { node.name = msg.name.trim(); }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "delete-node") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node) { try { node.remove(); } catch(e) {} }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-fill") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && "fills" in node && Array.isArray(node.fills)) {
      var colorVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "COLOR"; });
      if (colorVars.length > 0) {
        var newFills = [];
        for (var _bfi = 0; _bfi < node.fills.length; _bfi++) {
          var fill = node.fills[_bfi];
          if (fill.type !== "SOLID" || fill.visible === false) { newFills.push(fill); continue; }
          var bv = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[_bfi];
          if (bv) { newFills.push(fill); continue; }
          var nearest = await findNearestColorVar(fill.color, colorVars);
          if (nearest) { try { newFills.push(figma.variables.setBoundVariableForPaint(fill,"color",nearest)); } catch(e) { newFills.push(fill); } }
          else { newFills.push(fill); }
        }
        try { node.fills = newFills; } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-stroke") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && "strokes" in node && Array.isArray(node.strokes)) {
      var colorVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "COLOR"; });
      if (colorVars.length > 0) {
        var newStrokes = [];
        for (var _bsi = 0; _bsi < node.strokes.length; _bsi++) {
          var stroke = node.strokes[_bsi];
          if (stroke.type !== "SOLID" || stroke.visible === false) { newStrokes.push(stroke); continue; }
          var bv = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[_bsi];
          if (bv) { newStrokes.push(stroke); continue; }
          var nearest = await findNearestColorVar(stroke.color, colorVars);
          if (nearest) { try { newStrokes.push(figma.variables.setBoundVariableForPaint(stroke,"color",nearest)); } catch(e) { newStrokes.push(stroke); } }
          else { newStrokes.push(stroke); }
        }
        try { node.strokes = newStrokes; } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-spacing") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && "layoutMode" in node && node.layoutMode !== "NONE") {
      var floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      var spacingProps = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"];
      for (var spi = 0; spi < spacingProps.length; spi++) {
        var prop = spacingProps[spi];
        if (!(prop in node)) continue;
        var val = node[prop];
        if (val === figma.mixed || !val || val <= 0) continue;
        var bv = node.boundVariables && node.boundVariables[prop];
        if (bv) continue;
        var nearest = await findNearestFloatVar(val, floatVars);
        if (nearest) { try { node.setBoundVariable(prop, nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-radius") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && "cornerRadius" in node) {
      var floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      var radiusProps = ["cornerRadius","topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"];
      for (var rpi = 0; rpi < radiusProps.length; rpi++) {
        var prop = radiusProps[rpi];
        if (!(prop in node)) continue;
        var val = node[prop];
        if (val === figma.mixed || !val || val <= 0) continue;
        var bv = node.boundVariables && node.boundVariables[prop];
        if (bv) continue;
        var nearest = await findNearestFloatVar(val, floatVars);
        if (nearest) { try { node.setBoundVariable(prop, nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-opacity") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && "opacity" in node && node.opacity < 1 && node.opacity > 0) {
      var floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      var bv = node.boundVariables && node.boundVariables.opacity;
      if (!bv) {
        var nearest = await findNearestFloatVar(node.opacity, floatVars);
        if (nearest) { try { node.setBoundVariable("opacity", nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-border-width") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && "strokeWeight" in node && node.strokeWeight > 0) {
      var floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      var bv = node.boundVariables && node.boundVariables.strokeWeight;
      if (!bv) {
        var nearest = await findNearestFloatVar(node.strokeWeight, floatVars);
        if (nearest) { try { node.setBoundVariable("strokeWeight", nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-text-style") {
    var node = await figma.getNodeByIdAsync(msg.id);
    if (node && node.type === "TEXT" && msg.styleId) {
      var ts = await figma.getStyleByIdAsync(msg.styleId);
      if (ts) {
        try {
          await figma.loadFontAsync(ts.fontName);
          await node.setTextStyleIdAsync(ts.id);
        } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "create-text-style") {
    var node = await figma.getNodeByIdAsync(msg.id);
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
        await node.setTextStyleIdAsync(newTs.id);
      } catch(e) {}
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "create-and-bind") {
    // Create a new variable and bind it to the node property
    var node = await figma.getNodeByIdAsync(msg.nodeId);
    if (node && msg.varName) {
      try {
        var cols = await figma.variables.getLocalVariableCollectionsAsync();
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
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  // ── AI Naming: serialize node context for AI ───────────────────────────────
  if (msg.type === "ai-name-suggest") {
    var nodeIds = msg.nodeIds || [];
    var serialized = [];
    for (var ni = 0; ni < nodeIds.length; ni++) {
      var node = await figma.getNodeByIdAsync(nodeIds[ni]);
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
        var node = await figma.getNodeByIdAsync(entry.id);
        if (node && node.type !== "TEXT") {
          try { node.name = entry.name; } catch(e) {}
        }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "fix-all-check") {
    await figma.loadAllPagesAsync();
    var checkKey = msg.checkKey;
    var auditResult = await runAudit();
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
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n && n.type !== "TEXT") {
            var iss = checkData.issues.filter(function(is){ return is.id === ids[fi]; })[0];
            if (iss && iss.suggestedName) n.name = iss.suggestedName;
          }
        } else if (checkKey === "namingFormat") {
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n && n.type !== "TEXT") {
            var iss = checkData.issues.filter(function(is){ return is.id === ids[fi]; })[0];
            if (iss && iss.suggestedName) n.name = iss.suggestedName;
          }
        } else if (checkKey === "hidden") {
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) { try { n.remove(); } catch(e) {} }
        } else if (checkKey === "empty") {
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) { try { n.remove(); } catch(e) {} }
        } else if (checkKey === "colors") {
          // Only bind issues that have a suggestedVar
          var issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            for (var ii = 0; ii < issuesForNode.length; ii++) {
              var iss = issuesForNode[ii];
              var v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
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
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            for (var ii = 0; ii < issuesForNode.length; ii++) {
              var iss = issuesForNode[ii];
              var v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
              if (!v || !iss.bindType) continue;
              try { n.setBoundVariable(iss.bindType, v); } catch(e) {}
            }
          }
        } else if (checkKey === "radiusVars") {
          var issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            for (var ii = 0; ii < issuesForNode.length; ii++) {
              var iss = issuesForNode[ii];
              var v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
              if (!v || !iss.bindType) continue;
              try { n.setBoundVariable(iss.bindType, v); } catch(e) {}
            }
          }
        } else if (checkKey === "opacityVars") {
          var iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; })[0];
          if (!iss) continue;
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            var v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
            if (v) { try { n.setBoundVariable("opacity", v); } catch(e) {} }
          }
        } else if (checkKey === "borderVars") {
          var iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; })[0];
          if (!iss) continue;
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            var v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
            if (v) { try { n.setBoundVariable("strokeWeight", v); } catch(e) {} }
          }
        } else if (checkKey === "textStyles") {
          var iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedStyle; })[0];
          if (!iss) continue;
          var n = await figma.getNodeByIdAsync(ids[fi]);
          if (n && n.type === "TEXT" && iss.suggestedStyle.id) {
            var ts = await figma.getStyleByIdAsync(iss.suggestedStyle.id);
            if (ts && ts.type === "TEXT") {
              try {
                await figma.loadFontAsync(ts.fontName);
                await n.setTextStyleIdAsync(ts.id);
              } catch(e) {}
            }
          }
        }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  // ── Bulk fix (kept for backward compat) ──────────────────────────────────
  if (msg.type === "run-fixes") {
    await figma.loadAllPagesAsync();
    await runFixes(msg.fixes); figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "generate-cover") {
    await figma.loadAllPagesAsync();
    await generateCover(msg);
    figma.ui.postMessage({ type: "cover-generated" });
  }
  if (msg.type === "update-cover-status") {
    await figma.loadAllPagesAsync();
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
    await figma.loadAllPagesAsync();
    try {
      ensureEssentialColors();
      await ensureComponentTextStyles();
      await generateFoundationsPageComplex();
      await generateComponentsPageComplex();
      figma.ui.postMessage({ type: "specimens-generated", success: true });
    } catch(e) {
      figma.ui.postMessage({ type: "specimens-generated", success: false, message: String(e) });
    }
    try { await refreshTokenCounts(); } catch(e) {}
  }
  if (msg.type === "request-debug") { pushDebugData(); }
  // ── Design Import (Route B) ────────────────────────────────────────────
  if (msg.type === "detect-file-type") {
    await figma.loadAllPagesAsync();
    try {
      var fileType = await detectFileType();
      figma.ui.postMessage({ type: "file-type-detected", fileType: fileType });
    } catch (e) {
      figma.ui.postMessage({ type: "file-type-detected", fileType: "fresh", error: String(e) });
    }
  }
  // ── Route B Step 1: Full pipeline ─────────────────────────────────────────
  if (msg.type === "routeb-step1") {
    await figma.loadAllPagesAsync();
    try {
      // 1. Create standard pages
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Creating standard pages…", percent: 5 });
      var PAGE_DEFS: Record<string, string> = {
        cover: "_Cover", foundations: "🎨 Foundations", components: "🧩 Components",
        mobile: "📱 Mobile", desktop: "🖥️ Desktop", archive: "🗄️ Archive"
      };
      var ORDER = ["cover","foundations","components","mobile","desktop","archive"];
      ORDER.forEach(function(key) {
        var hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
        var exists = figma.root.children.some(function(p: PageNode) {
          return p.name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1;
        });
        if (!exists) {
          var newPage = figma.createPage();
          newPage.name = PAGE_DEFS[key];
          try { (newPage as any).devStatus = null; } catch(e) {}
        }
      });

      // 2. Archive existing content
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Archiving existing content…", percent: 15 });
      var archiveResult = await archiveExistingContent();

      // 3. Analyze design
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Analyzing design…", percent: 35 });
      var analysis = await analyzeDesign();

      // 4. Reorganize frames
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Organizing frames…", percent: 55 });
      var reorgResult = await reorganizeFrames(analysis.frames);

      // 5. Cleanup original pages
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Cleaning up empty pages…", percent: 70 });
      var cleanupResult = await cleanupOriginalPages();

      // 6. Scan existing variables
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Scanning existing variables…", percent: 80 });
      var existingVars = await scanExistingVariables();

      // 7. Match tokens with existing
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Matching tokens…", percent: 90 });
      var matchedAnalysis = matchTokensWithExisting(analysis, existingVars);

      // 8. Sort pages
      var allPages = figma.root.children.slice();
      var sorted: PageNode[] = [];
      ORDER.forEach(function(key) {
        var hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
        for (var i = 0; i < allPages.length; i++) {
          if (allPages[i].name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1) {
            sorted.push(allPages.splice(i,1)[0] as PageNode); break;
          }
        }
      });
      allPages.forEach(function(p) { sorted.push(p as PageNode); });
      sorted.forEach(function(p, i) { figma.root.insertChild(i, p); });

      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Done!", percent: 100 });
      figma.ui.postMessage({
        type: "routeb-step1-done",
        analysis: matchedAnalysis,
        existingVars: existingVars,
        reorgResult: reorgResult,
        archiveResult: archiveResult,
        cleanupResult: cleanupResult
      });
    } catch (e) {
      console.error("routeb-step1 error:", e);
      figma.ui.postMessage({ type: "routeb-step1-error", error: String(e) });
    }
  }
  // ── Route B Apply Tokens ────────────────────────────────────────────────
  if (msg.type === "routeb-apply-tokens") {
    await figma.loadAllPagesAsync();
    try {
      figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Creating tokens…", percent: 20 });
      var tokenResults = await createTokensFromAnalysis(msg.analysis);

      figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Binding variables…", percent: 50 });
      var bindStats = await bindTokensToDesign(function(phase: string, count: number, total: number) {
        var pct = 50 + Math.round((count / Math.max(total, 1)) * 45);
        figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Binding… (" + count + "/" + total + ")", percent: pct });
      });

      figma.ui.postMessage({
        type: "routeb-tokens-applied",
        tokenResults: tokenResults,
        bindStats: bindStats
      });
    } catch (e) {
      console.error("routeb-apply-tokens error:", e);
      figma.ui.postMessage({ type: "routeb-tokens-error", error: String(e) });
    }
  }
  // ── Workflow: page structure ──────────────────────────────────────────────
  if (msg.type === "check-pages") {
    await figma.loadAllPagesAsync();
    try {
      var pages = [];
      for (var pi = 0; pi < figma.root.children.length; pi++) {
        pages.push({ id: figma.root.children[pi].id, name: figma.root.children[pi].name });
      }
      var contentFlags = getPageContentFlags();
      var fileInfo = {
        fileId: figma.root.id,
        fileName: figma.root.name || "Untitled",
        userName: figma.currentUser ? (figma.currentUser.name || "") : "",
        hasDesktopContent: contentFlags.hasDesktopContent,
        hasMobileContent: contentFlags.hasMobileContent,
        hasFoundationsContent: contentFlags.hasFoundationsContent,
        hasComponentsContent: contentFlags.hasComponentsContent,
      };
      figma.ui.postMessage({ type: "pages-data", pages: pages, fileInfo: fileInfo });
    } catch(e) {
      figma.ui.postMessage({ type: "pages-data", pages: [], fileInfo: { fileId: "", fileName: "", userName: "" }, error: String(e) });
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
      if (!exists) {
        var newPage = figma.createPage();
        newPage.name = PAGE_DEFS[key];
        try { (newPage as any).devStatus = null; } catch(e) {}
      }
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
    var contentFlags2 = getPageContentFlags();
    figma.ui.postMessage({ type: "pages-data", pages: updatedPages, fileInfo: {
      fileId: figma.root.id,
      fileName: figma.root.name || "Untitled",
      userName: figma.currentUser ? (figma.currentUser.name || "") : "",
      hasDesktopContent: contentFlags2.hasDesktopContent,
      hasMobileContent: contentFlags2.hasMobileContent,
      hasFoundationsContent: contentFlags2.hasFoundationsContent,
      hasComponentsContent: contentFlags2.hasComponentsContent,
    }});
  }
  // ── Workflow: design tokens check ─────────────────────────────────────────
  if (msg.type === "check-tokens") {
    try { await refreshTokenCounts(); } catch(e) {
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
    try { await refreshTokenCounts(); } catch(e) {}
  }

  if (msg.type === "generate-promo-pages") {
    await figma.loadAllPagesAsync();
    try {
      await generatePromoStructure(msg);
      figma.ui.postMessage({ type: "promo-generated", success: true });
    } catch(e) {
      figma.ui.postMessage({ type: "promo-generated", success: false, message: String(e) });
    }
  }

  if (msg.type === "delete-wireframes") {
    await figma.loadAllPagesAsync();
    try {
      // Selective deletion: msg.sections = { hero: true, popup: true, banner: true }
      // If no sections specified, delete all wireframes (backward compat)
      var sectionsToDelete = msg.sections || null;
      var allPages = figma.root.children;
      for (var pi = 0; pi < allPages.length; pi++) {
        var pg = allPages[pi];
        var pgName = pg.name.toLowerCase().replace(/[^a-z]/g, "");
        if (pgName.indexOf("desktop") !== -1 || pgName.indexOf("mobile") !== -1) {
          var toRemove = pg.children.filter(function(n) {
            if (sectionsToDelete) {
              // Selective: only delete frames matching requested sections
              if (n.name === "promo/hero" && sectionsToDelete.hero) return true;
              if ((n.name === "promo/popup" || n.name === "promo/popup-thankyou") && sectionsToDelete.popup) return true;
              if (n.name === "promo/banner" && sectionsToDelete.banner) return true;
              // Also delete form helpers if popup is being deleted
              if (sectionsToDelete.popup && (n.name === "form-row" || n.name === "form-div" || n.name.indexOf("input-") === 0)) return true;
              return false;
            }
            // Delete all wireframes
            return n.name.indexOf("promo/") === 0
              || n.name === "form-row" || n.name === "form-div"
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

  if (msg.type === "check-wireframes") {
    await figma.loadAllPagesAsync();
    try {
      var wfResult: any = { desktop: { hero: false, popup: false, banner: false }, mobile: { hero: false, popup: false, banner: false } };
      var allPages2 = figma.root.children;
      for (var pi2 = 0; pi2 < allPages2.length; pi2++) {
        var pg2 = allPages2[pi2];
        var pgn = pg2.name.toLowerCase().replace(/[^a-z]/g, "");
        var pageKey = pgn.indexOf("desktop") !== -1 ? "desktop" : (pgn.indexOf("mobile") !== -1 ? "mobile" : null);
        if (!pageKey) continue;
        for (var ci2 = 0; ci2 < pg2.children.length; ci2++) {
          var child = pg2.children[ci2];
          if (child.name === "promo/hero") wfResult[pageKey].hero = true;
          if (child.name === "promo/popup" || child.name === "promo/popup-thankyou") wfResult[pageKey].popup = true;
          if (child.name === "promo/banner") wfResult[pageKey].banner = true;
        }
      }
      figma.ui.postMessage({ type: "wireframes-data", wireframes: wfResult });
    } catch(e) {
      figma.ui.postMessage({ type: "wireframes-data", wireframes: null, error: String(e) });
    }
  }

  if (msg.type === "check-images-export") {
    await figma.loadAllPagesAsync();
    try {
      var auditPages2 = getAuditPages();
      var missingExport = [];
      for (var api = 0; api < auditPages2.length; api++) {
        var apName = auditPages2[api].name.toLowerCase().replace(/[^a-z]/g, "");
        if (apName.indexOf("desktop") === -1 && apName.indexOf("mobile") === -1) continue;
        auditPages2[api].findAll(function(n) {
          // Image fills on non-text nodes
          if (n.type !== "TEXT" && n.fills && Array.isArray(n.fills)) {
            for (var fi = 0; fi < n.fills.length; fi++) {
              if (n.fills[fi].type === "IMAGE" && n.fills[fi].visible !== false) {
                if (!n.exportSettings || n.exportSettings.length === 0) {
                  missingExport.push(n.name || n.id);
                }
                break;
              }
            }
          }
          // Leaf shape nodes that look like images (RECTANGLE/ELLIPSE with image fill)
          return false;
        });
      }
      figma.ui.postMessage({ type: "check-images-export-result", missing: missingExport });
    } catch(e) {
      figma.ui.postMessage({ type: "check-images-export-result", missing: [] });
    }
  }

  if (msg.type === "build-html") {
    await figma.loadAllPagesAsync();
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
        var dTree = await htmlWalkNode(dChild, cssVars, images, 0, null, pageType);
        if (dTree) desktopTrees.push(dTree);
      }

      // Walk mobile tree if requested
      var mobileTrees = null;
      if (includeMobile && mobilePage) {
        mobileTrees = [];
        for (var mci = 0; mci < mobilePage.children.length; mci++) {
          var mChild = mobilePage.children[mci];
          if (mChild.visible === false) continue;
          var mTree = await htmlWalkNode(mChild, cssVars, images, 0, null, pageType);
          if (mTree) mobileTrees.push(mTree);
        }
      }

      // Phase 2b: Assign utility classes
      var tokens = opts.tokens || null;
      var utilMap = htmlBuildUtilityMap(tokens);
      var spacingLookup = htmlBuildSpacingLookup(tokens, cssVars);
      htmlAddColorUtilities(utilMap, cssVars);
      for (var uti = 0; uti < desktopTrees.length; uti++) {
        await htmlAssignUtilities(desktopTrees[uti], utilMap, spacingLookup);
      }
      if (mobileTrees) {
        for (var muti = 0; muti < mobileTrees.length; muti++) {
          await htmlAssignUtilities(mobileTrees[muti], utilMap, spacingLookup);
        }
      }

      // Phase 3: Export images
      var totalImages = 0;
      for (var dti = 0; dti < desktopTrees.length; dti++) totalImages += htmlCountImages(desktopTrees[dti]);
      figma.ui.postMessage({ type: "build-html-progress", phase: "Exporting images (0/" + totalImages + ")…", percent: 40 });
      var counter = { done: 0, total: totalImages };
      var imageErrors = [];
      for (var dei = 0; dei < desktopTrees.length; dei++) {
        try {
          await htmlCollectImages(desktopTrees[dei], images, function(done, total) {
            figma.ui.postMessage({ type: "build-html-progress", phase: "Exporting images (" + done + "/" + total + ")…", percent: 40 + Math.round((done / Math.max(total, 1)) * 30) });
          }, counter);
        } catch(imgErr) {
          imageErrors.push(String(imgErr));
        }
      }
      if (imageErrors.length > 0) {
        figma.ui.postMessage({ type: "build-html-warning", message: "Some images failed to export: " + imageErrors.join("; ") });
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
      await figma.clientStorage.setAsync("wf-settings-" + figma.root.id, msg.settings);
    } catch(e) {}
  }

  if (msg.type === "save-ai-config") {
    try {
      await figma.clientStorage.setAsync("ai-config", msg.config);
    } catch(e) {}
  }

  if (msg.type === "reset-settings") {
    try {
      await figma.clientStorage.deleteAsync("wf-settings-" + figma.root.id);
      figma.ui.postMessage({ type: "settings-reset" });
    } catch(e) {}
  }

  if (msg.type === "reset-tokens") {
    await figma.loadAllPagesAsync();
    try {
      var localTS = await figma.getLocalTextStylesAsync();
      for (var ti = 0; ti < localTS.length; ti++) {
        localTS[ti].remove();
      }
      var localES = await figma.getLocalEffectStylesAsync();
      for (var ei = 0; ei < localES.length; ei++) {
        localES[ei].remove();
      }
      var localVars = await figma.variables.getLocalVariablesAsync();
      for (var vi = 0; vi < localVars.length; vi++) {
        localVars[vi].remove();
      }
      var localCols = await figma.variables.getLocalVariableCollectionsAsync();
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
