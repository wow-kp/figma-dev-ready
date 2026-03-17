// foundations.ts — Foundations page generator (simple / message-driven)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, parseCssShadow, setFontName } from './utils';

export async function generateFoundationsPage(msg) {
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
        var bullet = await makeStyledText(bodyDefault, "\u2022   " + ulItems[uli], PAD, y);
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
      bpRangeStr = bp.name + " \u2265 " + bpVal + "px";
    } else if (bpi === 0) {
      bpRangeStr = bp.name + " < " + (parseFloat(bpAsc[1].value) || 0) + "px";
    } else {
      bpRangeStr = bp.name + ": " + bpVal + "\u2013" + (parseFloat(bpAsc[bpi + 1].value) || 0) + "px";
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
