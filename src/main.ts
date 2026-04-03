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
import { analyzeDesign, archiveExistingContent, createTokensFromAnalysis, reorganizeFrames, bindTokensToDesign, cleanupOriginalPages, scanExistingVariables, matchTokensWithExisting } from './design-import';
import { startChunkedSerialization, serializeNextFrame, startComponentCreation, loadVarsAndStartCreation, createNextComponent, startSwapInstances, swapNextInstance } from './component-detection';
import {
  _htmlImageNameCount, htmlWalkNode, htmlCountImages, htmlCollectImages,
  htmlRenderCSS, htmlSanitizeName, htmlRenderNodeClean,
  htmlBuildUtilityMap, htmlBuildSpacingLookup, htmlAddColorUtilities, htmlAssignUtilities
} from './html-export';

figma.showUI(__html__, { width: 920, height: 680, title: "Dev-Ready Tools for Designers by wowbrands" });

// Unique file identifier — stored in the document via pluginData, used to key per-file settings
let _fileUid = figma.root.getPluginData("fileUid");
if (!_fileUid) {
  _fileUid = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  figma.root.setPluginData("fileUid", _fileUid);
}

// Helper: scan pages for content presence
function getPageContentFlags() {
  const flags = { hasDesktopContent: false, hasMobileContent: false, hasFoundationsContent: false, hasComponentsContent: false };
  for (let pi = 0; pi < figma.root.children.length; pi++) {
    const pg = figma.root.children[pi];
    const pn = pg.name.toLowerCase();
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
  const flags = getPageContentFlags();
  figma.ui.postMessage({ type: "page-content-update", hasDesktopContent: flags.hasDesktopContent, hasMobileContent: flags.hasMobileContent, hasFoundationsContent: flags.hasFoundationsContent, hasComponentsContent: flags.hasComponentsContent });
}

// Helper: gather token counts and send tokens-data message
async function refreshTokenCounts() {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  const ts = await figma.getLocalTextStylesAsync();
  const es = await figma.getLocalEffectStylesAsync();
  const counts = countTokensByCategory(allVars, cols);
  for (let i = 0; i < es.length; i++) { if (es[i].name.toLowerCase().indexOf("shadow") !== -1) counts.shadows++; }
  counts.textStyles = ts.length;
  counts.effectStyles = es.length;
  counts.collections = cols.map(function(c) { return { name: c.name, count: allVars.filter(function(v) { return v.variableCollectionId === c.id; }).length }; });
  figma.ui.postMessage({ type: "tokens-data", tokens: counts });
}

// Load saved settings, then load all pages and register documentchange
(async function() {
  const _settingsKey = "wf-settings-" + _fileUid;
  try {
    let saved = await figma.clientStorage.getAsync(_settingsKey);
    // Migration: if no per-file settings, check for old global key
    if (!saved) {
      const oldSaved = await figma.clientStorage.getAsync("wf-settings");
      if (oldSaved) {
        // Strip route/workflow state — old global settings may be from a different file
        delete oldSaved.route;
        delete oldSaved.importMode;
        delete oldSaved.stepStatus;
        delete oldSaved.routeBStep;
        delete oldSaved.routeBAnalysis;
        delete oldSaved.routeBExistingVars;
        delete oldSaved.routeBBindStats;
        delete oldSaved.currentFileId;
        saved = oldSaved;
        await figma.clientStorage.setAsync(_settingsKey, saved);
        await figma.clientStorage.deleteAsync("wf-settings");
      }
      // Also migrate from old 0:0-keyed settings
      const old00 = await figma.clientStorage.getAsync("wf-settings-0:0");
      if (old00 && !saved) {
        saved = old00;
        await figma.clientStorage.setAsync(_settingsKey, saved);
      }
    }
    figma.ui.postMessage({ type: "load-settings", settings: saved || null, fileId: _fileUid });
  } catch(e) {}
  try {
    const aiConfig = await figma.clientStorage.getAsync("ai-config") || {};
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
    let _docChangeTimer: ReturnType<typeof setTimeout> | null = null;
    let _auditRefreshTimer: ReturnType<typeof setTimeout> | null = null;
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
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node) {
      // Switch to the node's page if needed
      let pg = node;
      while (pg && pg.type !== "PAGE") pg = pg.parent;
      if (pg && pg.type === "PAGE" && figma.currentPage !== pg) await figma.setCurrentPageAsync(pg);
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
    }
  }
  // ── Per-issue inline fixes ────────────────────────────────────────────────
  if (msg.type === "rename-node") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && msg.name && msg.name.trim()) { node.name = msg.name.trim(); }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "delete-node") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node) { try { node.remove(); } catch(e) {} }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-fill") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "fills" in node && Array.isArray(node.fills)) {
      const colorVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "COLOR"; });
      if (colorVars.length > 0) {
        const newFills = [];
        for (let _bfi = 0; _bfi < node.fills.length; _bfi++) {
          const fill = node.fills[_bfi];
          if (fill.type !== "SOLID" || fill.visible === false) { newFills.push(fill); continue; }
          const bv = node.boundVariables?.fills?.[_bfi];
          if (bv) { newFills.push(fill); continue; }
          const nearest = await findNearestColorVar(fill.color, colorVars);
          if (nearest) { try { newFills.push(figma.variables.setBoundVariableForPaint(fill,"color",nearest)); } catch(e) { newFills.push(fill); } }
          else { newFills.push(fill); }
        }
        try { node.fills = newFills; } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-stroke") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "strokes" in node && Array.isArray(node.strokes)) {
      const colorVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "COLOR"; });
      if (colorVars.length > 0) {
        const newStrokes = [];
        for (let _bsi = 0; _bsi < node.strokes.length; _bsi++) {
          const stroke = node.strokes[_bsi];
          if (stroke.type !== "SOLID" || stroke.visible === false) { newStrokes.push(stroke); continue; }
          const bv = node.boundVariables?.strokes?.[_bsi];
          if (bv) { newStrokes.push(stroke); continue; }
          const nearest = await findNearestColorVar(stroke.color, colorVars);
          if (nearest) { try { newStrokes.push(figma.variables.setBoundVariableForPaint(stroke,"color",nearest)); } catch(e) { newStrokes.push(stroke); } }
          else { newStrokes.push(stroke); }
        }
        try { node.strokes = newStrokes; } catch(e) {}
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-spacing") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "layoutMode" in node && node.layoutMode !== "NONE") {
      const floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      const spacingProps = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"];
      for (let spi = 0; spi < spacingProps.length; spi++) {
        const prop = spacingProps[spi];
        if (!(prop in node)) continue;
        const val = node[prop];
        if (val === figma.mixed || !val || val <= 0) continue;
        const bv = node.boundVariables?.[prop];
        if (bv) continue;
        const nearest = await findNearestFloatVar(val, floatVars);
        if (nearest) { try { node.setBoundVariable(prop, nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-radius") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "cornerRadius" in node) {
      const floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      const radiusProps = ["cornerRadius","topLeftRadius","topRightRadius","bottomLeftRadius","bottomRightRadius"];
      for (let rpi = 0; rpi < radiusProps.length; rpi++) {
        const prop = radiusProps[rpi];
        if (!(prop in node)) continue;
        const val = node[prop];
        if (val === figma.mixed || !val || val <= 0) continue;
        const bv = node.boundVariables?.[prop];
        if (bv) continue;
        const nearest = await findNearestFloatVar(val, floatVars);
        if (nearest) { try { node.setBoundVariable(prop, nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-opacity") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "opacity" in node && node.opacity < 1 && node.opacity > 0) {
      const floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      const bv = node.boundVariables?.opacity;
      if (!bv) {
        const nearest = await findNearestFloatVar(node.opacity, floatVars);
        if (nearest) { try { node.setBoundVariable("opacity", nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-border-width") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && "strokeWeight" in node && node.strokeWeight > 0) {
      const floatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v){ return v.resolvedType === "FLOAT"; });
      const bv = node.boundVariables?.strokeWeight;
      if (!bv) {
        const nearest = await findNearestFloatVar(node.strokeWeight, floatVars);
        if (nearest) { try { node.setBoundVariable("strokeWeight", nearest); } catch(e) {} }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "bind-text-style") {
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && node.type === "TEXT" && msg.styleId) {
      const ts = await figma.getStyleByIdAsync(msg.styleId);
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
    const node = await figma.getNodeByIdAsync(msg.id);
    if (node && node.type === "TEXT" && msg.styleName) {
      try {
        const fn = node.fontName !== figma.mixed ? node.fontName : { family: "Inter", style: "Regular" };
        await figma.loadFontAsync(fn);
        const newTs = figma.createTextStyle();
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
    const node = await figma.getNodeByIdAsync(msg.nodeId);
    if (node && msg.varName) {
      try {
        const cols = await figma.variables.getLocalVariableCollectionsAsync();
        let targetCol = null;
        const colName = msg.collection || "";
        // Find or create the target collection
        for (let ci = 0; ci < cols.length; ci++) {
          if (cols[ci].name.toLowerCase() === colName.toLowerCase()) { targetCol = cols[ci]; break; }
        }
        if (!targetCol) {
          targetCol = figma.variables.createVariableCollection(colName || "Variables");
        }
        const modeId = targetCol.modes[0].modeId;
        if (msg.varType === "COLOR") {
          const newVar = figma.variables.createVariable(msg.varName, targetCol, "COLOR");
          const rgb = hexToFigma(msg.rawValue || "#000000");
          newVar.setValueForMode(modeId, { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 });
          // Bind to the appropriate paint
          if (msg.bindType === "fill" && "fills" in node && Array.isArray(node.fills)) {
            const idx = msg.bindIndex || 0;
            if (idx < node.fills.length) {
              const nf = node.fills.slice();
              try { nf[idx] = figma.variables.setBoundVariableForPaint(nf[idx], "color", newVar); node.fills = nf; } catch(e) {}
            }
          } else if (msg.bindType === "stroke" && "strokes" in node && Array.isArray(node.strokes)) {
            const idx = msg.bindIndex || 0;
            if (idx < node.strokes.length) {
              const ns = node.strokes.slice();
              try { ns[idx] = figma.variables.setBoundVariableForPaint(ns[idx], "color", newVar); node.strokes = ns; } catch(e) {}
            }
          }
        } else {
          // FLOAT variable
          const newVar = figma.variables.createVariable(msg.varName, targetCol, "FLOAT");
          newVar.setValueForMode(modeId, parseFloat(msg.rawValue) || 0);
          // Bind based on type
          if (msg.bindType === "spacing") {
            ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing"].forEach(function(prop) {
              if (!(prop in node)) return;
              const val = node[prop];
              if (val === figma.mixed || !val || val <= 0) return;
              const b = node.boundVariables?.[prop];
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
    const nodeIds = msg.nodeIds || [];
    const serialized = [];
    for (let ni = 0; ni < nodeIds.length; ni++) {
      const node = await figma.getNodeByIdAsync(nodeIds[ni]);
      if (node) serialized.push(serializeNodeForNaming(node));
    }
    figma.ui.postMessage({ type: "ai-name-context", nodes: serialized });
  }
  // ── AI Naming: apply AI-suggested names ────────────────────────────────────
  if (msg.type === "apply-ai-names") {
    const names = msg.names || [];
    for (let ani = 0; ani < names.length; ani++) {
      const entry = names[ani];
      if (entry.id && entry.name) {
        const node = await figma.getNodeByIdAsync(entry.id);
        if (node && node.type !== "TEXT") {
          try { node.name = entry.name; } catch(e) {}
        }
      }
    }
    figma.ui.postMessage({ type:"audit-results", results:await runAudit() });
  }
  if (msg.type === "fix-all-check") {
    await figma.loadAllPagesAsync();
    const checkKey = msg.checkKey;
    const auditResult = await runAudit();
    const checkData = auditResult.checks[checkKey];
    if (checkData && checkData.issues.length > 0) {
      const ids = [];
      for (let fai = 0; fai < checkData.issues.length; fai++) {
        const fid = checkData.issues[fai].id;
        if (ids.indexOf(fid) === -1) ids.push(fid);
      }
      for (let fi = 0; fi < ids.length; fi++) {
        const fakeMsg = { id: ids[fi] };
        if (checkKey === "naming") {
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n && n.type !== "TEXT") {
            const iss = checkData.issues.filter(function(is){ return is.id === ids[fi]; })[0];
            if (iss && iss.suggestedName) n.name = iss.suggestedName;
          }
        } else if (checkKey === "namingFormat") {
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n && n.type !== "TEXT") {
            const iss = checkData.issues.filter(function(is){ return is.id === ids[fi]; })[0];
            if (iss && iss.suggestedName) n.name = iss.suggestedName;
          }
        } else if (checkKey === "hidden") {
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) { try { n.remove(); } catch(e) {} }
        } else if (checkKey === "empty") {
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) { try { n.remove(); } catch(e) {} }
        } else if (checkKey === "colors") {
          // Only bind issues that have a suggestedVar
          const issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            for (let ii = 0; ii < issuesForNode.length; ii++) {
              const iss = issuesForNode[ii];
              const v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
              if (!v) continue;
              if (iss.bindType === "fill" && "fills" in n && Array.isArray(n.fills)) {
                const idx = iss.bindIndex || 0;
                if (n.fills[idx]) {
                  try { const nf = n.fills.slice(); nf[idx] = figma.variables.setBoundVariableForPaint(nf[idx],"color",v); n.fills = nf; } catch(e) {}
                }
              } else if (iss.bindType === "stroke" && "strokes" in n && Array.isArray(n.strokes)) {
                const idx = iss.bindIndex || 0;
                if (n.strokes[idx]) {
                  try { const ns = n.strokes.slice(); ns[idx] = figma.variables.setBoundVariableForPaint(ns[idx],"color",v); n.strokes = ns; } catch(e) {}
                }
              }
            }
          }
        } else if (checkKey === "spacingVars") {
          const issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            for (let ii = 0; ii < issuesForNode.length; ii++) {
              const iss = issuesForNode[ii];
              const v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
              if (!v || !iss.bindType) continue;
              try { n.setBoundVariable(iss.bindType, v); } catch(e) {}
            }
          }
        } else if (checkKey === "radiusVars") {
          const issuesForNode = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; });
          if (issuesForNode.length === 0) continue;
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            for (let ii = 0; ii < issuesForNode.length; ii++) {
              const iss = issuesForNode[ii];
              const v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
              if (!v || !iss.bindType) continue;
              try { n.setBoundVariable(iss.bindType, v); } catch(e) {}
            }
          }
        } else if (checkKey === "opacityVars") {
          const iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; })[0];
          if (!iss) continue;
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            const v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
            if (v) { try { n.setBoundVariable("opacity", v); } catch(e) {} }
          }
        } else if (checkKey === "borderVars") {
          const iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedVar; })[0];
          if (!iss) continue;
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n) {
            const v = await figma.variables.getVariableByIdAsync(iss.suggestedVar.id);
            if (v) { try { n.setBoundVariable("strokeWeight", v); } catch(e) {} }
          }
        } else if (checkKey === "textStyles") {
          const iss = checkData.issues.filter(function(is){ return is.id === ids[fi] && is.suggestedStyle; })[0];
          if (!iss) continue;
          const n = await figma.getNodeByIdAsync(ids[fi]);
          if (n && n.type === "TEXT" && iss.suggestedStyle.id) {
            const ts = await figma.getStyleByIdAsync(iss.suggestedStyle.id);
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
      const result = await importTokens(msg.filename, msg.data);
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
  // ── Route B Step 1: Full pipeline ─────────────────────────────────────────
  if (msg.type === "routeb-step1") {
    await figma.loadAllPagesAsync();
    try {
      // 1. Create standard pages
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Creating standard pages…", percent: 5 });
      const PAGE_DEFS: Record<string, string> = {
        cover: "_Cover", foundations: "🎨 Foundations", components: "🧩 Components",
        mobile: "📱 Mobile", desktop: "🖥️ Desktop", archive: "🗄️ Archive"
      };
      const ORDER = ["cover","foundations","components","mobile","desktop","archive"];
      ORDER.forEach(function(key) {
        const hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
        const exists = figma.root.children.some(function(p: PageNode) {
          return p.name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1;
        });
        if (!exists) {
          const newPage = figma.createPage();
          newPage.name = PAGE_DEFS[key];
          try { (newPage as any).devStatus = null; } catch(e) {}
        }
      });

      // 2. Archive existing content
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Archiving existing content…", percent: 15 });
      const archiveResult = await archiveExistingContent();

      // 3. Analyze design
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Analyzing design…", percent: 35 });
      const analysis = await analyzeDesign();

      // 4. Reorganize frames
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Organizing frames…", percent: 55 });
      const reorgResult = await reorganizeFrames(analysis.frames);

      // 5. Cleanup original pages
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Cleaning up empty pages…", percent: 70 });
      const cleanupResult = await cleanupOriginalPages();

      // 6. Scan existing variables
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Scanning existing variables…", percent: 80 });
      const existingVars = await scanExistingVariables();

      // 7. Match tokens with existing
      figma.ui.postMessage({ type: "routeb-step1-progress", phase: "Matching tokens…", percent: 90 });
      const matchedAnalysis = matchTokensWithExisting(analysis, existingVars);

      // 8. Sort pages
      const allPages = figma.root.children.slice();
      const sorted: PageNode[] = [];
      ORDER.forEach(function(key) {
        const hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
        for (let i = 0; i < allPages.length; i++) {
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
      figma.ui.postMessage({ type: "routeb-step1-error", error: String(e) });
    }
  }
  // ── Route B Apply Tokens ────────────────────────────────────────────────
  if (msg.type === "routeb-apply-tokens") {
    await figma.loadAllPagesAsync();
    try {
      figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Creating tokens…", percent: 15 });
      const tokenResults = await createTokensFromAnalysis(msg.analysis);

      figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Binding variables…", percent: 40 });
      const bindStats = await bindTokensToDesign(function(phase: string, count: number, total: number) {
        const pct = 40 + Math.round((count / Math.max(total, 1)) * 35);
        figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Binding… (" + count + "/" + total + ")", percent: pct });
      });

      // Generate Foundations page from the newly created variables
      figma.ui.postMessage({ type: "routeb-tokens-progress", phase: "Generating Foundations page…", percent: 80 });
      ensureEssentialColors();
      await ensureComponentTextStyles();
      await generateFoundationsPageComplex();

      figma.ui.postMessage({
        type: "routeb-tokens-applied",
        tokenResults: tokenResults,
        bindStats: bindStats
      });
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-tokens-error", error: String(e) });
    }
  }
  // ── Route B Component Detection ─────────────────────────────────────────
  if (msg.type === "routeb-detect-components") {
    try {
      figma.ui.postMessage({ type: "routeb-components-progress", phase: "Scanning design structure…", percent: 5 });
      await startChunkedSerialization();
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  if (msg.type === "routeb-serialize-next") {
    try {
      await serializeNextFrame();
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  if (msg.type === "routeb-create-components") {
    try {
      await startComponentCreation(msg.components);
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  if (msg.type === "routeb-create-load-vars") {
    try {
      await loadVarsAndStartCreation();
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  if (msg.type === "routeb-create-next") {
    try {
      await createNextComponent();
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  if (msg.type === "routeb-swap-instances") {
    try {
      await startSwapInstances(msg.swapMap);
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  if (msg.type === "routeb-swap-next") {
    try {
      await swapNextInstance();
    } catch (e) {
      figma.ui.postMessage({ type: "routeb-components-error", error: String(e) });
    }
  }
  // ── Workflow: page structure ──────────────────────────────────────────────
  if (msg.type === "check-pages") {
    await figma.loadAllPagesAsync();
    try {
      const pages = [];
      let totalTopLevelChildren = 0;
      for (let pi = 0; pi < figma.root.children.length; pi++) {
        const pg = figma.root.children[pi];
        pages.push({ id: pg.id, name: pg.name });
        totalTopLevelChildren += pg.children.length;
      }
      const contentFlags = getPageContentFlags();
      const fileInfo = {
        fileId: _fileUid,
        fileName: figma.root.name || "Untitled",
        userName: figma.currentUser?.name || "",
        hasDesktopContent: contentFlags.hasDesktopContent,
        hasMobileContent: contentFlags.hasMobileContent,
        hasFoundationsContent: contentFlags.hasFoundationsContent,
        hasComponentsContent: contentFlags.hasComponentsContent,
        totalTopLevelChildren: totalTopLevelChildren,
      };
      figma.ui.postMessage({ type: "pages-data", pages: pages, fileInfo: fileInfo });
    } catch(e) {
      figma.ui.postMessage({ type: "pages-data", pages: [], fileInfo: { fileId: "", fileName: "", userName: "" }, error: String(e) });
    }
  }
  if (msg.type === "create-pages") {
    const PAGE_DEFS = {
      cover:       "_Cover",
      foundations: "🎨 Foundations",
      components:  "🧩 Components",
      mobile:      "📱 Mobile",
      desktop:     "🖥️ Desktop",
      archive:     "🗄️ Archive",
    };
    const ORDER = ["cover","foundations","components","mobile","desktop","archive"];
    msg.keys.forEach(function(key) {
      if (!PAGE_DEFS[key]) return;
      const hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
      const exists = figma.root.children.some(function(p) {
        return p.name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1;
      });
      if (!exists) {
        const newPage = figma.createPage();
        newPage.name = PAGE_DEFS[key];
        try { (newPage as any).devStatus = null; } catch(e) {}
      }
    });
    const allPages = figma.root.children.slice();
    const sorted = [];
    ORDER.forEach(function(key) {
      const hint = key === "cover" ? "cover" : PAGE_DEFS[key].toLowerCase().replace(/[^a-z]/g,"");
      for (let i = 0; i < allPages.length; i++) {
        if (allPages[i].name.toLowerCase().replace(/[^a-z]/g,"").indexOf(hint) !== -1) {
          sorted.push(allPages.splice(i,1)[0]); break;
        }
      }
    });
    allPages.forEach(function(p) { sorted.push(p); });
    sorted.forEach(function(p, i) { figma.root.insertChild(i, p); });
    const updatedPages = [];
    let totalChildren2 = 0;
    for (let pi = 0; pi < figma.root.children.length; pi++) {
      const cpg = figma.root.children[pi];
      updatedPages.push({ id: cpg.id, name: cpg.name });
      totalChildren2 += cpg.children.length;
    }
    const contentFlags2 = getPageContentFlags();
    figma.ui.postMessage({ type: "pages-data", pages: updatedPages, fileInfo: {
      fileId: _fileUid,
      fileName: figma.root.name || "Untitled",
      userName: figma.currentUser?.name || "",
      hasDesktopContent: contentFlags2.hasDesktopContent,
      hasMobileContent: contentFlags2.hasMobileContent,
      hasFoundationsContent: contentFlags2.hasFoundationsContent,
      hasComponentsContent: contentFlags2.hasComponentsContent,
      totalTopLevelChildren: totalChildren2,
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
    const brandHex = msg.brandColor || "#3B82F6";
    const secondaryHex = msg.secondaryColor || "";
    const tertiaryHex = msg.tertiaryColor || "";
    const colorOpts = {
      primary: brandHex, secondary: secondaryHex, tertiary: tertiaryHex,
      textColor: msg.textColor || "#1A1A1A",
      custom: msg.customColors || []
    };
    const fontFamilies = msg.fontFamilies || { primary: "Inter, sans-serif" };
    const textStylesData = (msg.textStyles || []).map(function(s) {
      const resolved = {};
      for (const k in s) resolved[k] = s[k];
      resolved.fontFamily = fontFamilies[s.fontRole] || fontFamilies.primary;
      return resolved;
    });
    const spacingData = msg.spacing || [];
    const radiusData = msg.radius || [];
    const shadowsData = msg.shadows || [];
    const bordersData = msg.borders || [];
    const zindexData = msg.zindex || [];
    const typographyData = msg.typography || { sizes: [], weights: [], lineHeights: [] };
    const enabledCats = msg.enabledCategories || null;
    const GEN_ORDER = ["colors","colors-light","typography","spacing","text-styles","radius","border","opacity","shadows","zindex","breakpoints","grid"];

    const catsToRun = enabledCats ? GEN_ORDER.filter(function(c) { return enabledCats.indexOf(c) !== -1; }) : GEN_ORDER;

    for (let gi = 0; gi < catsToRun.length; gi++) {
      try {
        const gd = generateTokenData(catsToRun[gi], colorOpts, textStylesData, spacingData, radiusData, shadowsData, bordersData, zindexData, typographyData, fontFamilies);
        const gr = await importTokens(gd.filename, gd.data);
        figma.ui.postMessage({ type:"generate-result", category:catsToRun[gi], success:true, message:gr });
      } catch(e) {
        figma.ui.postMessage({ type:"generate-result", category:catsToRun[gi], success:false, message:String(e) });
      }
    }
    // Generate specimen pages (Foundations & Components)
    try {
      const specimenMsg = {
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
      const sectionsToDelete = msg.sections || null;
      const allPages = figma.root.children;
      for (let pi = 0; pi < allPages.length; pi++) {
        const pg = allPages[pi];
        const pgName = pg.name.toLowerCase().replace(/[^a-z]/g, "");
        if (pgName.indexOf("desktop") !== -1 || pgName.indexOf("mobile") !== -1) {
          const toRemove = pg.children.filter(function(n) {
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
          for (let ri = 0; ri < toRemove.length; ri++) {
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
      const wfResult: any = { desktop: { hero: false, popup: false, banner: false }, mobile: { hero: false, popup: false, banner: false } };
      const allPages2 = figma.root.children;
      for (let pi2 = 0; pi2 < allPages2.length; pi2++) {
        const pg2 = allPages2[pi2];
        const pgn = pg2.name.toLowerCase().replace(/[^a-z]/g, "");
        const pageKey = pgn.indexOf("desktop") !== -1 ? "desktop" : (pgn.indexOf("mobile") !== -1 ? "mobile" : null);
        if (!pageKey) continue;
        for (let ci2 = 0; ci2 < pg2.children.length; ci2++) {
          const child = pg2.children[ci2];
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
      const auditPages2 = getAuditPages();
      const missingExport = [];
      for (let api = 0; api < auditPages2.length; api++) {
        const apName = auditPages2[api].name.toLowerCase().replace(/[^a-z]/g, "");
        if (apName.indexOf("desktop") === -1 && apName.indexOf("mobile") === -1) continue;
        auditPages2[api].findAll(function(n) {
          // Image fills on non-text nodes
          if (n.type !== "TEXT" && n.fills && Array.isArray(n.fills)) {
            for (let fi = 0; fi < n.fills.length; fi++) {
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
      const opts = msg.options || {};
      const includeMobile = opts.includeMobile !== false;
      const includeScreenshots = opts.includeScreenshots === true;
      const pageType = opts.pageType || "promo";

      // Phase 1: Scan
      figma.ui.postMessage({ type: "build-html-progress", phase: "Scanning node tree…", percent: 10 });
      const auditPages = getAuditPages();
      let desktopPage = null, mobilePage = null;
      for (let bhi = 0; bhi < auditPages.length; bhi++) {
        const bhName = auditPages[bhi].name.toLowerCase().replace(/[^a-z]/g, "");
        if (bhName.indexOf("desktop") !== -1) desktopPage = auditPages[bhi];
        if (bhName.indexOf("mobile") !== -1) mobilePage = auditPages[bhi];
      }
      if (!desktopPage) {
        figma.ui.postMessage({ type: "build-html-error", error: "No Desktop page found. Generate wireframes first." });
        return;
      }

      const cssVars = {};
      const images = [];
      // Reset image name dedup counter
      for (const k in _htmlImageNameCount) { if (_htmlImageNameCount.hasOwnProperty(k)) delete _htmlImageNameCount[k]; }

      // Phase 2: Walk desktop tree
      figma.ui.postMessage({ type: "build-html-progress", phase: "Resolving variables…", percent: 25 });
      const desktopTrees = [];
      for (let dci = 0; dci < desktopPage.children.length; dci++) {
        const dChild = desktopPage.children[dci];
        if (dChild.visible === false) continue;
        const dTree = await htmlWalkNode(dChild, cssVars, images, 0, null, pageType);
        if (dTree) desktopTrees.push(dTree);
      }

      // Walk mobile tree if requested
      let mobileTrees = null;
      if (includeMobile && mobilePage) {
        mobileTrees = [];
        for (let mci = 0; mci < mobilePage.children.length; mci++) {
          const mChild = mobilePage.children[mci];
          if (mChild.visible === false) continue;
          const mTree = await htmlWalkNode(mChild, cssVars, images, 0, null, pageType);
          if (mTree) mobileTrees.push(mTree);
        }
      }

      // Phase 2b: Assign utility classes
      const tokens = opts.tokens || null;
      const utilMap = htmlBuildUtilityMap(tokens);
      const spacingLookup = htmlBuildSpacingLookup(tokens, cssVars);
      htmlAddColorUtilities(utilMap, cssVars);
      for (let uti = 0; uti < desktopTrees.length; uti++) {
        await htmlAssignUtilities(desktopTrees[uti], utilMap, spacingLookup);
      }
      if (mobileTrees) {
        for (let muti = 0; muti < mobileTrees.length; muti++) {
          await htmlAssignUtilities(mobileTrees[muti], utilMap, spacingLookup);
        }
      }

      // Phase 3: Export images
      let totalImages = 0;
      for (let dti = 0; dti < desktopTrees.length; dti++) totalImages += htmlCountImages(desktopTrees[dti]);
      figma.ui.postMessage({ type: "build-html-progress", phase: "Exporting images (0/" + totalImages + ")…", percent: 40 });
      const counter = { done: 0, total: totalImages };
      const imageErrors = [];
      for (let dei = 0; dei < desktopTrees.length; dei++) {
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

      const combinedDesktop = { className: "", styles: {}, children: desktopTrees, tag: "body", text: null, isImage: false, imageName: null, nodeName: "body", nodeId: null };
      const combinedMobile = mobileTrees ? { className: "", styles: {}, children: mobileTrees, tag: "body", text: null, isImage: false, imageName: null, nodeName: "body", nodeId: null } : null;
      const css = htmlRenderCSS(cssVars, combinedDesktop, combinedMobile, tokens);

      const htmlFiles = [];
      if (pageType === "promo") {
        // Promo: one HTML file per top-level frame (each is a <section>)
        for (let bri = 0; bri < desktopTrees.length; bri++) {
          const frameTree = desktopTrees[bri];
          const frameName = htmlSanitizeName(frameTree.nodeName || ("section-" + bri));
          const frameBody = htmlRenderNodeClean(frameTree, 2);
          const frameHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + (frameTree.nodeName || "Page") + '</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n' + frameBody + '\n</body>\n</html>';
          htmlFiles.push({ name: frameName + ".html", content: frameHtml, frameName: frameTree.nodeName || frameName });
        }
      } else {
        // Landing / Full Site: top-level frames represent <body>, render children directly
        // All frames go into a single index.html
        let bodyContent = "";
        for (let bri = 0; bri < desktopTrees.length; bri++) {
          // htmlRenderNodeClean unwraps "body" tags automatically
          bodyContent += htmlRenderNodeClean(desktopTrees[bri], 2) + "\n";
        }
        const pageTitle = desktopTrees.length > 0 ? (desktopTrees[0].nodeName || "Page") : "Page";
        const indexHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + pageTitle + '</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n' + bodyContent + '</body>\n</html>';
        htmlFiles.push({ name: "index.html", content: indexHtml, frameName: pageTitle });
      }

      // Phase 5: Export frame screenshots for AI visual context (only when AI enhancement is enabled)
      const screenshots = [];
      if (includeScreenshots) {
        figma.ui.postMessage({ type: "build-html-progress", phase: "Capturing design screenshots…", percent: 95 });
        for (let sci = 0; sci < desktopPage.children.length; sci++) {
          const scChild = desktopPage.children[sci];
          if (scChild.visible === false || !("exportAsync" in scChild)) continue;
          try {
            const scBytes = await scChild.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: 1 } });
            screenshots.push({ name: scChild.name || ("frame-" + sci), page: "desktop", bytes: Array.prototype.slice.call(scBytes) });
          } catch(e) {}
        }
        if (includeMobile && mobilePage) {
          for (let smci = 0; smci < mobilePage.children.length; smci++) {
            const smChild = mobilePage.children[smci];
            if (smChild.visible === false || !("exportAsync" in smChild)) continue;
            try {
              const smBytes = await smChild.exportAsync({ format: "JPG", constraint: { type: "SCALE", value: 1 } });
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
    // Only save if fileId matches current file (prevents cross-file contamination on file switch)
    if (!msg.fileId || msg.fileId === _fileUid) {
      try {
        await figma.clientStorage.setAsync("wf-settings-" + _fileUid, msg.settings);
      } catch(e) {}
    }
  }

  if (msg.type === "save-ai-config") {
    try {
      await figma.clientStorage.setAsync("ai-config", msg.config);
    } catch(e) {}
  }

  if (msg.type === "reset-settings") {
    try {
      await figma.clientStorage.deleteAsync("wf-settings-" + _fileUid);
      figma.ui.postMessage({ type: "settings-reset" });
    } catch(e) {}
  }

  if (msg.type === "reset-tokens") {
    await figma.loadAllPagesAsync();
    try {
      const localTS = await figma.getLocalTextStylesAsync();
      for (let ti = 0; ti < localTS.length; ti++) {
        localTS[ti].remove();
      }
      const localES = await figma.getLocalEffectStylesAsync();
      for (let ei = 0; ei < localES.length; ei++) {
        localES[ei].remove();
      }
      const localVars = await figma.variables.getLocalVariablesAsync();
      for (let vi = 0; vi < localVars.length; vi++) {
        localVars[vi].remove();
      }
      const localCols = await figma.variables.getLocalVariableCollectionsAsync();
      for (let ci = 0; ci < localCols.length; ci++) {
        localCols[ci].remove();
      }
      const specimenHints = ["foundations", "components"];
      for (let spi = 0; spi < specimenHints.length; spi++) {
        for (let pi = 0; pi < figma.root.children.length; pi++) {
          if (figma.root.children[pi].name.toLowerCase().replace(/[^a-z]/g, "").indexOf(specimenHints[spi]) !== -1) {
            const spChildren = figma.root.children[pi].children.slice();
            for (let sci = 0; sci < spChildren.length; sci++) {
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
