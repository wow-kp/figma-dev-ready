// Main entry point — plugin init, selection listener, and message router
import { countTokensByCategory, ensureEssentialColors, ensureComponentTextStyles, getAuditPages } from './utils';
import { pushDebugData, runAudit, runFixes, findNearestColorVar } from './audit';
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
  htmlRenderCSS, htmlSanitizeName, htmlRenderNodeClean
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
})();

figma.on("selectionchange", function() { pushDebugData(); });

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
      var classCounter = {};
      // Reset image name dedup counter
      for (var k in _htmlImageNameCount) { if (_htmlImageNameCount.hasOwnProperty(k)) delete _htmlImageNameCount[k]; }

      // Phase 2: Walk desktop tree
      figma.ui.postMessage({ type: "build-html-progress", phase: "Resolving variables…", percent: 25 });
      var desktopTrees = [];
      for (var dci = 0; dci < desktopPage.children.length; dci++) {
        var dChild = desktopPage.children[dci];
        if (dChild.visible === false) continue;
        var dTree = htmlWalkNode(dChild, cssVars, images, 0, classCounter);
        if (dTree) desktopTrees.push(dTree);
      }

      // Walk mobile tree if requested — SHARE classCounter so class names match desktop
      var mobileTrees = null;
      if (includeMobile && mobilePage) {
        mobileTrees = [];
        var mobileClassCounter = {};
        var dKeys = Object.keys(classCounter);
        for (var cki = 0; cki < dKeys.length; cki++) mobileClassCounter[dKeys[cki]] = 0;
        for (var mci = 0; mci < mobilePage.children.length; mci++) {
          var mChild = mobilePage.children[mci];
          if (mChild.visible === false) continue;
          var mTree = htmlWalkNode(mChild, cssVars, images, 0, mobileClassCounter);
          if (mTree) mobileTrees.push(mTree);
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

      // Phase 4: Compile — one HTML file per top-level frame
      figma.ui.postMessage({ type: "build-html-progress", phase: "Generating HTML…", percent: 80 });

      var combinedDesktop = { className: "", styles: {}, children: desktopTrees, tag: "body", text: null, isImage: false, imageName: null, nodeName: "body", nodeId: null };
      var combinedMobile = mobileTrees ? { className: "", styles: {}, children: mobileTrees, tag: "body", text: null, isImage: false, imageName: null, nodeName: "body", nodeId: null } : null;
      var css = htmlRenderCSS(cssVars, combinedDesktop, combinedMobile);

      var htmlFiles = [];
      for (var bri = 0; bri < desktopTrees.length; bri++) {
        var frameTree = desktopTrees[bri];
        var frameName = htmlSanitizeName(frameTree.nodeName || ("section-" + bri));
        var frameBody = htmlRenderNodeClean(frameTree, 2);
        var frameHtml = '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>' + (frameTree.nodeName || "Page") + '</title>\n  <link rel="stylesheet" href="styles.css" />\n</head>\n<body>\n' + frameBody + '\n</body>\n</html>';
        htmlFiles.push({ name: frameName + ".html", content: frameHtml, frameName: frameTree.nodeName || frameName });
      }

      figma.ui.postMessage({ type: "build-html-progress", phase: "Done!", percent: 100 });
      figma.ui.postMessage({
        type: "build-html-result",
        htmlFiles: htmlFiles,
        css: css,
        images: images,
        stats: { nodes: desktopTrees.length, files: htmlFiles.length, images: images.length, variables: Object.keys(cssVars).length }
      });
    } catch(e) {
      figma.ui.postMessage({ type: "build-html-error", error: String(e) });
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
