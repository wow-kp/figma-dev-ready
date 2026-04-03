// foundations.ts — Foundations page generator (simple / message-driven)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, parseCssShadow, setFontName } from './utils';
import { bindFill as bindFillShared } from './component-helpers';

export async function generateFoundationsPage(msg) {
  const page = findPageByHint("foundations");
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  // Load all Inter + user font weights using fallback-aware loader
  const stdWeights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  for (let iw = 0; iw < stdWeights.length; iw++) {
    await loadFontWithFallback("Inter", stdWeights[iw]);
  }

  const fontFamilies = msg.fontFamilies || {};
  const userFonts = Object.keys(fontFamilies).map(function(k) { return fontFamilies[k]; }).filter(Boolean);
  const loadedFamilies = {};
  for (let fi = 0; fi < userFonts.length; fi++) {
    const fam = userFonts[fi].split(",")[0].trim().replace(/['"]/g, "");
    if (loadedFamilies[fam] || fam === "Inter") continue;
    loadedFamilies[fam] = true;
    for (let fw = 0; fw < stdWeights.length; fw++) {
      await loadFontWithFallback(fam, stdWeights[fw]);
    }
  }

  // Remove existing specimens
  const existing = page.children.filter(function(n) { return n.name === "Foundations"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  const W = 1440, PAD = 80, SECTION_GAP = 60;
  const frame = figma.createFrame();
  frame.name = "foundations";
  frame.clipsContent = false;
  frame.resize(W, 20000);
  frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  page.appendChild(frame);

  let y = PAD;

  // ── Look up color variables for binding ──
  const fColorColsAll = await figma.variables.getLocalVariableCollectionsAsync();
  const fColorCols = [];
  for (let fcci = 0; fcci < fColorColsAll.length; fcci++) {
    if (fColorColsAll[fcci].name === "Colors") fColorCols.push(fColorColsAll[fcci]);
  }
  const fColorVarMap = {};
  if (fColorCols.length > 0) {
    const fColorVarsAll = await figma.variables.getLocalVariablesAsync();
    const fColorVars = [];
    for (let fcfi = 0; fcfi < fColorVarsAll.length; fcfi++) {
      if (fColorVarsAll[fcfi].variableCollectionId === fColorCols[0].id && fColorVarsAll[fcfi].resolvedType === "COLOR") {
        fColorVars.push(fColorVarsAll[fcfi]);
      }
    }
    for (let fcvi = 0; fcvi < fColorVars.length; fcvi++) {
      fColorVarMap[fColorVars[fcvi].name] = fColorVars[fcvi];
    }
  }
  function bindFill(node, varName) { bindFillShared(node, varName, fColorVarMap); }

  // ── Section title helper ──
  function sectionTitle(title) {
    const t = createSpecText(frame, title, PAD, y, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    y += t.height + 8;
    const div = figma.createRectangle();
    div.resize(W - PAD * 2, 1);
    div.x = PAD; div.y = y;
    div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div);
    y += 24;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // COLORS
  // ══════════════════════════════════════════════════════════════════════════
  const colorOpts = msg.colorOpts || {};
  const allColors = [];
  if (colorOpts.primary) allColors.push({ name: "primary", hex: colorOpts.primary });
  if (colorOpts.secondary) allColors.push({ name: "secondary", hex: colorOpts.secondary });
  if (colorOpts.tertiary) allColors.push({ name: "tertiary", hex: colorOpts.tertiary });
  if (colorOpts.textColor) allColors.push({ name: "text", hex: colorOpts.textColor });
  const customs = colorOpts.custom || [];
  for (let ci = 0; ci < customs.length; ci++) {
    if (customs[ci].name && customs[ci].hex) allColors.push(customs[ci]);
  }
  // Auto colors
  const autoColors = [
    { name: "black", hex: "#000000" }, { name: "white", hex: "#FFFFFF" }, { name: "gray", hex: "#E3E3E3" },
    { name: "focus-border", hex: "#000000" }, { name: "focus-color", hex: "#79797B" },
    { name: "error-border", hex: "#E32E22" }, { name: "error-color", hex: "#E32E22" }
  ];
  for (let ai = 0; ai < autoColors.length; ai++) {
    const hasIt = allColors.some(function(c) { return c.name === autoColors[ai].name; });
    if (!hasIt) allColors.push(autoColors[ai]);
  }

  if (allColors.length > 0) {
    sectionTitle("Colors");
    const SWATCH_W = 120, SWATCH_H = 80, SWATCH_GAP = 16, COLS = Math.min(8, Math.floor((W - PAD * 2 + SWATCH_GAP) / (SWATCH_W + SWATCH_GAP)));
    for (let si = 0; si < allColors.length; si++) {
      const col = si % COLS;
      const row = Math.floor(si / COLS);
      const sx = PAD + col * (SWATCH_W + SWATCH_GAP);
      const sy = y + row * (SWATCH_H + 36);

      const rect = figma.createRectangle();
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
    const colorRows = Math.ceil(allColors.length / COLS);
    y += colorRows * (SWATCH_H + 36) + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FONT FAMILIES
  // ══════════════════════════════════════════════════════════════════════════
  try {
    const ff = msg.fontFamilies || {};
    const ffEntries = [];
    const ffKeys = Object.keys(ff);
    const ffSeen = {};
    for (let ffki = 0; ffki < ffKeys.length; ffki++) {
      const ffVal = ff[ffKeys[ffki]];
      if (!ffVal || ffSeen[ffVal]) continue;
      ffSeen[ffVal] = true;
      const ffRole = ffKeys[ffki].charAt(0).toUpperCase() + ffKeys[ffki].slice(1);
      ffEntries.push({ role: ffRole, family: ffVal });
    }

    if (ffEntries.length > 0) {
      sectionTitle("Font Families");
      const FF_CARD_W = 380, FF_CARD_H = 160, FF_GAP = 24;
      const ffCols = Math.min(ffEntries.length, Math.floor((W - PAD * 2 + FF_GAP) / (FF_CARD_W + FF_GAP)));

      for (let ffi = 0; ffi < ffEntries.length; ffi++) {
        const ffe = ffEntries[ffi];
        const ffCol = ffi % ffCols;
        const ffRow = Math.floor(ffi / ffCols);
        const ffX = PAD + ffCol * (FF_CARD_W + FF_GAP);
        const ffY = y + ffRow * (FF_CARD_H + FF_GAP);
        const ffFam = ffe.family.split(",")[0].trim().replace(/['"]/g, "");

        // Card background
        const ffCard = figma.createFrame();
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
        const ffRoleLabel = figma.createText();
        ffRoleLabel.fontName = { family: "Inter", style: "Regular" };
        ffRoleLabel.fontSize = 10;
        ffRoleLabel.characters = ffe.role.toUpperCase();
        ffRoleLabel.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
        ffRoleLabel.letterSpacing = { value: 1.5, unit: "PIXELS" };
        ffRoleLabel.x = 24; ffRoleLabel.y = 20;
        ffCard.appendChild(ffRoleLabel);

        // Detect if font is installed
        let ffInstalled = true;
        try { await figma.loadFontAsync({ family: ffFam, style: "Regular" }); } catch(e) { ffInstalled = false; }

        if (ffInstalled) {
          const ffNameStyle = await loadFontWithFallback(ffFam, 700);
          const ffNameNode = figma.createText();
          ffNameNode.fontName = { family: ffFam, style: ffNameStyle };
          ffNameNode.fontSize = 28;
          ffNameNode.characters = ffFam;
          ffNameNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
          ffNameNode.x = 24; ffNameNode.y = 42;
          ffCard.appendChild(ffNameNode);

          const ffSampleStyle = await loadFontWithFallback(ffFam, 400);
          const ffSampleNode = figma.createText();
          ffSampleNode.fontName = { family: ffFam, style: ffSampleStyle };
          ffSampleNode.fontSize = 14;
          ffSampleNode.characters = "AaBbCcDdEeFfGgHhIiJjKkLl";
          ffSampleNode.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
          ffSampleNode.x = 24; ffSampleNode.y = 86;
          ffCard.appendChild(ffSampleNode);

          const ffValueNode = figma.createText();
          ffValueNode.fontName = { family: "Inter", style: "Regular" };
          ffValueNode.fontSize = 11;
          ffValueNode.characters = ffe.family;
          ffValueNode.fills = [{ type: "SOLID", color: { r: 0.55, g: 0.55, b: 0.55 } }];
          ffValueNode.x = 24; ffValueNode.y = 118;
          ffCard.appendChild(ffValueNode);

          const ffWeightSamples = [
            { w: 300, label: "Light" },
            { w: 400, label: "Regular" },
            { w: 600, label: "SemiBold" },
            { w: 700, label: "Bold" }
          ];
          let ffwX = 24;
          for (let ffwi = 0; ffwi < ffWeightSamples.length; ffwi++) {
            const ffw = ffWeightSamples[ffwi];
            const ffwStyle = await loadFontWithFallback(ffFam, ffw.w);
            const ffwNode = figma.createText();
            ffwNode.fontName = { family: ffFam, style: ffwStyle };
            ffwNode.fontSize = 11;
            ffwNode.characters = ffw.label;
            ffwNode.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
            ffwNode.x = ffwX; ffwNode.y = 138;
            ffCard.appendChild(ffwNode);
            ffwX += ffwNode.width + 16;
          }
        } else {
          createSpecText(ffCard, ffFam, 24, 42, 20, "Bold", { r: 0.6, g: 0.3, b: 0.3 });
          createSpecText(ffCard, "Font not installed — add to your system to preview", 24, 76, 11, "Regular", { r: 0.6, g: 0.3, b: 0.3 });
        }
      }

      const ffRows = Math.ceil(ffEntries.length / ffCols);
      y += ffRows * (FF_CARD_H + FF_GAP) + SECTION_GAP;
    }
  } catch(ffErr) { /* font families section failed */ }

  // ══════════════════════════════════════════════════════════════════════════
  // TEXT STYLES
  // ══════════════════════════════════════════════════════════════════════════
  const textStylesData = msg.textStylesData || [];
  if (textStylesData.length > 0) {
    try {
    // Helper: find style by group + optional name
    function findTS(group, name) {
      for (let i = 0; i < textStylesData.length; i++) {
        if (textStylesData[i].group === group && (!name || textStylesData[i].name === name)) return textStylesData[i];
      }
      return null;
    }
    function filterTS(group) {
      const r = [];
      for (let i = 0; i < textStylesData.length; i++) {
        if (textStylesData[i].group === group) r.push(textStylesData[i]);
      }
      return r;
    }
    // Helper: create a styled text node from a text style entry
    const figmaTextStyles = await figma.getLocalTextStylesAsync();
    const figmaTextStyleMap = {};
    for (let fts = 0; fts < figmaTextStyles.length; fts++) {
      figmaTextStyleMap[figmaTextStyles[fts].name] = figmaTextStyles[fts];
    }
    async function makeStyledText(tsEntry, text, x, yPos) {
      const styleName = tsEntry.group + "/" + tsEntry.name;
      const figmaStyle = figmaTextStyleMap[styleName];
      const fam = (tsEntry.fontFamily || "Inter").split(",")[0].trim().replace(/['"]/g, "");
      const weight = tsEntry.fontWeight || 400;
      await loadFontWithFallback(fam, weight);
      const node = figma.createText();
      if (figmaStyle) {
        await node.setTextStyleIdAsync(figmaStyle.id);
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

    const brandHexSpec = msg.brandColor || "#3B82F6";

    // ── Headings ──
    const headings = filterTS("heading");
    if (headings.length > 0) {
      sectionTitle("Headings");
      for (let hi = 0; hi < headings.length; hi++) {
        const hd = headings[hi];
        const hNode = await makeStyledText(hd, hd.name.toUpperCase() + " — The quick brown fox jumps over the lazy dog", PAD, y);
        const hMeta = hd.name + " · " + hd.fontSize + "px / " + hd.fontWeight + " / " + hd.lineHeight;
        createSpecText(frame, hMeta, PAD, y + Math.max(hNode.height, 20) + 2, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
        y += Math.max(hNode.height, 24) + 26;
      }
      y += SECTION_GAP;
    }

    // ── Body / Paragraphs ──
    const bodies = filterTS("body");
    if (bodies.length > 0) {
      sectionTitle("Paragraphs");
      const paraText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.";
      for (let bdi = 0; bdi < bodies.length; bdi++) {
        const bd = bodies[bdi];
        createSpecText(frame, "body/" + bd.name + " · " + bd.fontSize + "px / " + bd.fontWeight + " / lh:" + bd.lineHeight, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        const bNode = await makeStyledText(bd, paraText, PAD, y);
        bNode.resize(W - PAD * 2, bNode.height);
        bNode.textAutoResize = "HEIGHT";
        y += bNode.height + 24;
      }
      y += SECTION_GAP;
    }

    // ── Lists ──
    const bodyDefault = findTS("body", "default") || findTS("body", "lg") || (bodies && bodies[0] ? bodies[0] : null);
    if (bodyDefault) {
      sectionTitle("Lists");
      const COL_W = Math.floor((W - PAD * 2 - 40) / 2);

      createSpecText(frame, "Unordered List", PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
      createSpecText(frame, "Ordered List", PAD + COL_W + 40, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
      y += 18;

      const ulItems = ["First item in the list", "Second item with more text", "Third item to show rhythm", "Fourth and final item"];
      const olItems = ["Prepare the design tokens", "Configure typography settings", "Review color palette choices", "Export and hand off to dev"];

      const ulStartY = y;
      for (let uli = 0; uli < ulItems.length; uli++) {
        const bullet = await makeStyledText(bodyDefault, "\u2022   " + ulItems[uli], PAD, y);
        y += Math.max(bullet.height, 20) + 6;
      }
      const ulEndY = y;

      let olY = ulStartY;
      for (let oli = 0; oli < olItems.length; oli++) {
        const olNode = await makeStyledText(bodyDefault, (oli + 1) + ".  " + olItems[oli], PAD + COL_W + 40, olY);
        olY += Math.max(olNode.height, 20) + 6;
      }
      y = Math.max(ulEndY, olY);
      y += SECTION_GAP;
    }

    // ── Links ──
    const links = filterTS("links");
    if (links.length > 0) {
      sectionTitle("Links");
      const linkColor = hexToFigma(brandHexSpec);
      for (let lki = 0; lki < links.length; lki++) {
        const lk = links[lki];
        const lkFam = (lk.fontFamily || "Inter").split(",")[0].trim().replace(/['"]/g, "");
        const lkWt = lk.fontWeight || 500;
        await loadFontWithFallback(lkFam, lkWt);

        createSpecText(frame, "links/" + lk.name + " · " + lk.fontSize + "px / " + lk.fontWeight, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;

        const lkNode = figma.createText();
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
    const otherGroups = ["buttons", "input", "label"];
    const otherStyles = [];
    for (let ogi = 0; ogi < otherGroups.length; ogi++) {
      const gs = filterTS(otherGroups[ogi]);
      for (let gsi = 0; gsi < gs.length; gsi++) otherStyles.push(gs[gsi]);
    }
    if (otherStyles.length > 0) {
      sectionTitle("UI Text Styles");
      for (let usi = 0; usi < otherStyles.length; usi++) {
        const us = otherStyles[usi];
        const usLabel = us.group + "/" + us.name;
        createSpecText(frame, usLabel + " · " + us.fontSize + "px / " + us.fontWeight, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        const usNode = await makeStyledText(us, usLabel + " — Sample text preview", PAD, y);
        y += Math.max(usNode.height, 20) + 16;
      }
      y += SECTION_GAP;
    }
    } catch(tsErr) { /* text styles section failed */ }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TYPOGRAPHY VARIABLES (sizes, weights, line-heights)
  // ══════════════════════════════════════════════════════════════════════════
  const typo = msg.typography || { sizes: [], weights: [], lineHeights: [] };
  const hasSizes = typo.sizes?.length > 0;
  const hasWeights = typo.weights?.length > 0;
  const hasLH = typo.lineHeights?.length > 0;

  if (hasSizes || hasWeights || hasLH) {
    sectionTitle("Typography Scale");
    const scaleFam = userFonts.length > 0 ? userFonts[0].split(",")[0].trim().replace(/['"]/g, "") : "";
    let scaleInstalled = false;
    if (scaleFam) { try { await figma.loadFontAsync({ family: scaleFam, style: "Regular" }); scaleInstalled = true; } catch(e) {} }

    if (!scaleInstalled) {
      const scaleMsg = scaleFam ? (scaleFam + " is not installed — install font to preview typography scale") : "No primary font found";
      createSpecText(frame, scaleMsg, PAD, y, 12, "Regular", { r: 0.6, g: 0.3, b: 0.3 });
      y += 32 + SECTION_GAP;
    } else {
    // ── Font Sizes ──
    if (hasSizes) {
      try {
        createSpecText(frame, "Font Sizes", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 });
        y += 24;
        for (let fsi = 0; fsi < typo.sizes.length; fsi++) {
          const sz = typo.sizes[fsi];
          const pxVal = parseFloat(sz.value) || 16;
          const sizeText = figma.createText();
          const scSz = await loadFontWithFallback(scaleFam, 400);
          sizeText.fontName = { family: scaleFam, style: scSz };
          sizeText.fontSize = Math.min(pxVal, 60);
          sizeText.characters = sz.name + " — " + sz.value + "px";
          sizeText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          sizeText.x = PAD; sizeText.y = y;
          frame.appendChild(sizeText);
          y += Math.max(sizeText.height, 20) + 8;
        }
        y += 24;
      } catch(e) { /* font sizes failed */ }
    }

    // ── Font Weights ──
    if (hasWeights) {
      try {
        createSpecText(frame, "Font Weights", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 });
        y += 24;
        let wx = PAD;
        for (let fwi = 0; fwi < typo.weights.length; fwi++) {
          const wt = typo.weights[fwi];
          await loadFontWithFallback(scaleFam, wt.value);
          const wtText = figma.createText();
          setFontName(wtText, scaleFam, wt.value);
          wtText.fontSize = 16;
          wtText.characters = wt.name + " (" + wt.value + ")";
          wtText.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
          wtText.x = wx; wtText.y = y;
          frame.appendChild(wtText);
          wx += 140;
          if (wx + 140 > W - PAD) { wx = PAD; y += 32; }
        }
        y += 40;
      } catch(e) { /* font weights failed */ }
    }

    // ── Line Heights ──
    if (hasLH) {
      try {
        createSpecText(frame, "Line Heights", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 });
        y += 24;
        const lhSampleText = "The quick brown fox jumps\nover the lazy dog. Pack my\nbox with five dozen\nliquor jugs.";
        const lhColW = Math.floor((W - PAD * 2 - (typo.lineHeights.length - 1) * 24) / typo.lineHeights.length);
        let lhX = PAD;
        let lhMaxH = 0;
        for (let lhi = 0; lhi < typo.lineHeights.length; lhi++) {
          const lh = typo.lineHeights[lhi];
          const lhVal = parseFloat(lh.value) || 1.5;
          createSpecText(frame, lh.name + " (" + lh.value + ")", lhX, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
          const lhNode = figma.createText();
          const lhSt = await loadFontWithFallback(scaleFam, 400);
          lhNode.fontName = { family: scaleFam, style: lhSt };
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
      } catch(e) { /* line heights failed */ }
    }
    y += SECTION_GAP;
    } // end scaleInstalled
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RADIUS
  // ══════════════════════════════════════════════════════════════════════════
  const radiusData = msg.radius || [];
  if (radiusData.length > 0) {
    sectionTitle("Radius");
    let rx = PAD;
    for (let ri = 0; ri < radiusData.length; ri++) {
      const rad = radiusData[ri];
      const rv = parseFloat(rad.value) || 0;
      const rRect = figma.createRectangle();
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
  const shadowsData = msg.shadows || [];
  if (shadowsData.length > 0) {
    sectionTitle("Shadows");
    const shEffectStyles = await figma.getLocalEffectStylesAsync();
    const shStyleMap = {};
    for (let sem = 0; sem < shEffectStyles.length; sem++) { shStyleMap[shEffectStyles[sem].name] = shEffectStyles[sem]; }
    let shx = PAD;
    for (let shi = 0; shi < shadowsData.length; shi++) {
      const sh = shadowsData[shi];
      const shRect = figma.createRectangle();
      shRect.name = "shadow/" + sh.name;
      shRect.resize(120, 80);
      shRect.x = shx; shRect.y = y;
      shRect.cornerRadius = 8;
      shRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      const shStyle = shStyleMap["shadow/" + sh.name];
      if (shStyle) { try { await shRect.setEffectStyleIdAsync(shStyle.id); } catch(e) {} }
      else { const effect = parseCssShadow(sh.value); if (effect) shRect.effects = [effect]; }
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
  const bordersData = msg.borders || [];
  if (bordersData.length > 0) {
    sectionTitle("Borders");
    let bx = PAD;
    for (let bi = 0; bi < bordersData.length; bi++) {
      const bd = bordersData[bi];
      const bv = parseFloat(bd.value) || 1;
      const bRect = figma.createRectangle();
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
  const zindexData = msg.zindex || [];
  if (zindexData.length > 0) {
    sectionTitle("Z-Index");
    const zBrandColor = hexToFigma(msg.brandColor || "#3B82F6");
    // Sort by value ascending so lowest z-index is at the back
    const zSorted = zindexData.slice().sort(function(a, b) {
      return (parseFloat(a.value) || 0) - (parseFloat(b.value) || 0);
    });
    const zCardW = 220;
    const zCardH = 80;
    const zOffsetX = 32; // horizontal shift per layer
    const zOffsetY = -36; // vertical shift per layer (negative = upward)
    const zCount = zSorted.length;
    // Start from bottom-left so first (lowest) card is at bottom
    const zBaseX = PAD;
    const zBaseY = y + (zCount - 1) * Math.abs(zOffsetY);

    for (let zi2 = 0; zi2 < zCount; zi2++) {
      const zItem = zSorted[zi2];
      const zv = parseFloat(zItem.value) || 0;
      const zx = zBaseX + zi2 * zOffsetX;
      const zy = zBaseY + zi2 * zOffsetY;
      const zOpacity = 0.06 + 0.12 * (zi2 / Math.max(zCount - 1, 1));

      // Card
      const zCard = figma.createFrame();
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
      const zNameTxt = figma.createText();
      zNameTxt.name = "label";
      await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
      zNameTxt.fontName = { family: "Inter", style: "Semi Bold" };
      zNameTxt.fontSize = 12;
      zNameTxt.characters = zItem.name;
      zNameTxt.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
      zNameTxt.x = 12; zNameTxt.y = zCardH - 34;
      zCard.appendChild(zNameTxt);

      // Value label inside card
      const zValTxt = figma.createText();
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
  const opCols = 10;
  const opGap = 8;
  const opSwatchW = Math.floor((W - PAD * 2 - (opCols - 1) * opGap) / opCols);
  const opSwatchH = 40;
  let opX = PAD;
  for (let opi = 5; opi <= 95; opi += 5) {
    const opRect = figma.createRectangle();
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
  const spacingData = msg.spacing || [];
  if (spacingData.length > 0) {
    sectionTitle("Spacing");
    const spBrandColor = hexToFigma(msg.brandColor || "#3B82F6");
    const spCols = 3;
    const spGutterX = 24;
    const spInnerSize = 32; // fixed inner square size
    const spRowGap = 16;
    let spRowY = y;
    let spRowMaxBottom = y;

    for (let spi = 0; spi < spacingData.length; spi++) {
      const sp = spacingData[spi];
      const spVal = parseFloat(sp.value) || 0;
      const spCol = spi % spCols;
      const spPad = Math.max(spVal, 4); // minimum visible padding
      const spOuterSize = spInnerSize + spPad * 2;

      // Start a new row
      if (spCol === 0 && spi > 0) {
        spRowY = spRowMaxBottom + spRowGap;
        spRowMaxBottom = spRowY;
      }

      const spCellW = Math.floor((W - PAD * 2 - spGutterX) / spCols);
      const spX = PAD + spCol * (spCellW + spGutterX);

      // Outer square (brand-colored, represents the spacing)
      const spOuter = figma.createRectangle();
      spOuter.name = "spacing/" + sp.name + "/outer";
      spOuter.resize(spOuterSize, spOuterSize);
      spOuter.x = spX; spOuter.y = spRowY;
      spOuter.fills = [{ type: "SOLID", color: spBrandColor, opacity: 0.12 }];
      spOuter.strokes = [{ type: "SOLID", color: spBrandColor, opacity: 0.35 }];
      spOuter.strokeWeight = 1;
      spOuter.cornerRadius = 4;
      frame.appendChild(spOuter);

      // Inner square (gray, centered inside outer)
      const spInner = figma.createRectangle();
      spInner.name = "spacing/" + sp.name + "/inner";
      spInner.resize(spInnerSize, spInnerSize);
      spInner.x = spX + spPad; spInner.y = spRowY + spPad;
      spInner.fills = [{ type: "SOLID", color: { r: 0.78, g: 0.78, b: 0.82 } }];
      spInner.cornerRadius = 2;
      frame.appendChild(spInner);

      // Label to the right of the squares
      const spLabelX = spX + spOuterSize + 12;
      const spLabelCenterY = spRowY + (spOuterSize / 2) - 7;
      createSpecText(frame, sp.name, spLabelX, spLabelCenterY - 1, 12, "Medium", { r: 0.15, g: 0.15, b: 0.15 });
      createSpecText(frame, spVal + "px", spLabelX, spLabelCenterY + 14, 11, "Regular", { r: 0.45, g: 0.45, b: 0.45 });

      const spItemBottom = spRowY + spOuterSize;
      if (spItemBottom > spRowMaxBottom) spRowMaxBottom = spItemBottom;
    }
    y = spRowMaxBottom + spRowGap;
    y += SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BREAKPOINTS
  // ══════════════════════════════════════════════════════════════════════════
  const breakpoints = [
    { name: "xs", value: 0 }, { name: "sm", value: 567 },
    { name: "md", value: 767 }, { name: "lg", value: 991 }
  ];
  sectionTitle("Breakpoints");
  const bpBrandColor = hexToFigma(msg.brandColor || "#3B82F6");
  // Sort ascending by value: xs(0), sm(567), md(767), lg(991)
  const bpAsc = breakpoints.slice().sort(function(a, b) { return (parseFloat(a.value)||0) - (parseFloat(b.value)||0); });
  const bpAvailW = W - PAD * 2;
  // lg is the outermost; scale so lg fills the available width
  const bpOuterVal = (parseFloat(bpAsc[bpAsc.length - 1].value) || 991) * 1.15; // add 15% so lg rect isn't edge-to-edge
  const bpScale = bpAvailW / bpOuterVal;
  const bpH = 320; // same height for all
  const bpCenterX = PAD + bpAvailW / 2;
  const bpBaseY = y;
  // Opacity steps: outermost (lg) lightest, innermost (xs) darkest
  const bpCount = bpAsc.length;
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  // Draw from outermost (lg) to innermost (xs)
  for (let bpi = bpCount - 1; bpi >= 0; bpi--) {
    const bp = bpAsc[bpi];
    const bpVal = parseFloat(bp.value) || 0;
    // Width: use the breakpoint value, but for lg use the outer boundary, for xs use the next bp value
    let bpRectW;
    if (bpi === bpCount - 1) {
      // lg — outermost, use full scaled width
      bpRectW = Math.round(bpOuterVal * bpScale);
    } else {
      // others — width = their breakpoint value
      const bpPixelVal = Math.max(bpVal, 280); // minimum visual size for xs
      bpRectW = Math.round(bpPixelVal * bpScale);
    }
    const bpX = Math.round(bpCenterX - bpRectW / 2);
    const bpOpacity = 0.06 + 0.06 * (bpCount - 1 - bpi); // outermost lightest, innermost darkest

    const bpRect = figma.createRectangle();
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
    let bpRangeStr;
    if (bpi === bpCount - 1) {
      bpRangeStr = bp.name + " \u2265 " + bpVal + "px";
    } else if (bpi === 0) {
      bpRangeStr = bp.name + " < " + (parseFloat(bpAsc[1].value) || 0) + "px";
    } else {
      bpRangeStr = bp.name + ": " + bpVal + "\u2013" + (parseFloat(bpAsc[bpi + 1].value) || 0) + "px";
    }

    // Position label at the top of the band between this rect edge and the next inner rect edge
    const bpNameTxt = figma.createText();
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
  let maxBottom = y;
  for (let mi = 0; mi < frame.children.length; mi++) {
    const child = frame.children[mi];
    const childBottom = child.y + child.height;
    if (childBottom > maxBottom) maxBottom = childBottom;
  }
  const finalH = maxBottom + PAD;
  frame.resize(W, Math.max(finalH, 400));
  frame.clipsContent = true;
}
