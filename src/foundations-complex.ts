// foundations-complex.ts — Foundations page generator (complex / variable-driven)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, cxResolveVar, cxColorToHex, cxFindCol, cxGetFloats, cxStripPrefix } from './utils';
import { bindFill as bindFillShared } from './component-helpers';

export async function generateFoundationsPageComplex() {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allCols = await figma.variables.getLocalVariableCollectionsAsync();
  const textStyles = await figma.getLocalTextStylesAsync();
  const effectStyles = await figma.getLocalEffectStylesAsync();

  const page = findPageByHint("foundations");
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  // Load Inter weights
  const stdW = [100,200,300,400,500,600,700,800,900];
  for (let iw = 0; iw < stdW.length; iw++) await loadFontWithFallback("Inter", stdW[iw]);

  // Load user fonts from text styles
  const loadedFams = {};
  for (let tsi = 0; tsi < textStyles.length; tsi++) {
    const fam = textStyles[tsi].fontName.family;
    if (!loadedFams[fam] && fam !== "Inter") {
      loadedFams[fam] = true;
      for (let fw = 0; fw < stdW.length; fw++) await loadFontWithFallback(fam, stdW[fw]);
    }
  }
  // Also load fonts from Typography STRING vars
  const typCol = cxFindCol(allCols, "typography");
  const userFontFamilies = [];
  if (typCol) {
    const typMid = typCol.modes[0].modeId;
    for (let vi = 0; vi < allVars.length; vi++) {
      if (allVars[vi].variableCollectionId === typCol.id && allVars[vi].resolvedType === "STRING" && allVars[vi].name.toLowerCase().indexOf("family") !== -1) {
        const fv = String((await cxResolveVar(allVars[vi], typMid, allCols)) || "").split(",")[0].trim().replace(/['"]/g, "");
        if (fv && !loadedFams[fv]) {
          loadedFams[fv] = true;
          for (let fw2 = 0; fw2 < stdW.length; fw2++) await loadFontWithFallback(fv, stdW[fw2]);
        }
        if (fv && userFontFamilies.indexOf(fv) === -1) userFontFamilies.push(fv);
      }
    }
  }

  // Remove existing
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

  function sectionTitle(title) {
    const t = createSpecText(frame, title, PAD, y, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    y += t.height + 8;
    const div = figma.createRectangle(); div.resize(W - PAD * 2, 1);
    div.x = PAD; div.y = y; div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div); y += 24;
  }

  // Detect brand color from Colors collection + build color var map for binding
  let colorCol = null;
  for (let ci = 0; ci < allCols.length; ci++) { if (allCols[ci].name === "Colors") { colorCol = allCols[ci]; break; } }
  let brandHex = "#3B82F6";
  const fColorVarMap = {};
  if (colorCol) {
    const cMid = colorCol.modes[0].modeId;
    const fColorVars = allVars.filter(function(v) { return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR"; });
    for (let fcvi = 0; fcvi < fColorVars.length; fcvi++) fColorVarMap[fColorVars[fcvi].name] = fColorVars[fcvi];
    for (let bvi = 0; bvi < allVars.length; bvi++) {
      if (allVars[bvi].variableCollectionId === colorCol.id && allVars[bvi].name === "brand/primary") {
        const bVal = await cxResolveVar(allVars[bvi], cMid, allCols);
        const bh = cxColorToHex(bVal);
        if (bh) brandHex = bh;
        break;
      }
    }
  }
  function fBindFill(node, varName) { bindFillShared(node, varName, fColorVarMap); }

  // ══════════════════════════════════════════════════════════════════════════
  // PRIMITIVE COLORS — palette grid grouped by color family
  // ══════════════════════════════════════════════════════════════════════════
  let primCol = null;
  for (let pci = 0; pci < allCols.length; pci++) { if (allCols[pci].name === "Primitives") { primCol = allCols[pci]; break; } }
  if (primCol) {
    const primMid = primCol.modes[0].modeId;
    const primVars = allVars.filter(function(v) { return v.variableCollectionId === primCol.id && v.resolvedType === "COLOR"; });
    // Group by first segment: red/100 → group "red"
    const colorGroups = {};
    const groupOrder = [];
    for (let pvi = 0; pvi < primVars.length; pvi++) {
      const parts = primVars[pvi].name.split("/");
      const group = parts.length > 1 ? parts[0] : "other";
      const shade = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
      if (!colorGroups[group]) { colorGroups[group] = []; groupOrder.push(group); }
      const val = await cxResolveVar(primVars[pvi], primMid, allCols);
      const hex = cxColorToHex(val);
      if (hex) colorGroups[group].push({ shade: shade, hex: hex, variable: primVars[pvi] });
    }
    // Sort shades numerically within each group
    for (const gk in colorGroups) {
      colorGroups[gk].sort(function(a, b) { return (parseInt(a.shade) || 0) - (parseInt(b.shade) || 0); });
    }

    if (groupOrder.length > 0) {
      sectionTitle("Color Primitives");
      const SW = 72, SH = 48, SGAP = 4;
      for (let gi = 0; gi < groupOrder.length; gi++) {
        const gName = groupOrder[gi];
        const gColors = colorGroups[gName];
        // Group label
        createSpecText(frame, gName.charAt(0).toUpperCase() + gName.slice(1), PAD, y, 12, "SemiBold", { r: 0.25, g: 0.25, b: 0.25 });
        y += 20;
        for (let sci = 0; sci < gColors.length; sci++) {
          const sc = gColors[sci];
          let sx = PAD + sci * (SW + SGAP);
          if (sx + SW > W - PAD) { y += SH + 24; sx = PAD + 0 * (SW + SGAP); }
          const sr = figma.createRectangle();
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
    const cModes = colorCol.modes;
    const semVars = allVars.filter(function(v) { return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR"; });
    // Group by first segment
    const semGroups = {};
    const semOrder = [];
    for (let svi = 0; svi < semVars.length; svi++) {
      const sp = semVars[svi].name.split("/");
      const sg = sp.length > 1 ? sp[0] : "other";
      if (!semGroups[sg]) { semGroups[sg] = []; semOrder.push(sg); }
      semGroups[sg].push(semVars[svi]);
    }

    if (semOrder.length > 0) {
      sectionTitle("Semantic Colors" + (cModes.length > 1 ? " (Light / Dark)" : ""));
      const hasModes = cModes.length > 1;
      const COL_W = hasModes ? Math.floor((W - PAD * 2 - 40) / 2) : (W - PAD * 2);
      const modeLabels = cModes.map(function(m) { return m.name; });
      const SSW = 56, SSH = 40, SSGAP = 6;

      if (hasModes) {
        // Mode column headers
        for (let mhi = 0; mhi < Math.min(modeLabels.length, 2); mhi++) {
          createSpecText(frame, modeLabels[mhi], PAD + mhi * (COL_W + 40), y, 13, "SemiBold", { r: 0.3, g: 0.3, b: 0.3 });
        }
        y += 24;
      }

      for (let sgi = 0; sgi < semOrder.length; sgi++) {
        const sgName = semOrder[sgi];
        const sgVars = semGroups[sgName];
        createSpecText(frame, sgName, PAD, y, 11, "SemiBold", { r: 0.4, g: 0.4, b: 0.4 });
        y += 18;
        let rowH = 0;

        for (let mci = 0; mci < Math.min(cModes.length, 2); mci++) {
          const modeId = cModes[mci].modeId;
          const mx = PAD + mci * (COL_W + 40);
          let myStart = y;
          let svx = mx;
          for (let svj = 0; svj < sgVars.length; svj++) {
            const sv = sgVars[svj];
            const svName = cxStripPrefix(sv.name);
            const svVal = await cxResolveVar(sv, modeId, allCols);
            const svHex = cxColorToHex(svVal) || "#000000";
            if (svx + SSW + 48 > mx + COL_W) { myStart += SSH + 22; svx = mx; }
            const svRect = figma.createRectangle();
            svRect.name = sv.name; svRect.resize(SSW, SSH);
            svRect.x = svx; svRect.y = myStart; svRect.cornerRadius = 4;
            svRect.fills = [{ type: "SOLID", color: hexToFigma(svHex) }];
            try { svRect.fills = [figma.variables.setBoundVariableForPaint(svRect.fills[0], "color", sv)]; } catch(e) {}
            svRect.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }]; svRect.strokeWeight = 1;
            frame.appendChild(svRect);
            createSpecText(frame, svName, svx, myStart + SSH + 2, 9, "Medium", { r: 0.3, g: 0.3, b: 0.3 });
            svx += SSW + SSGAP + 48;
            const hr = (myStart + SSH + 16) - y;
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
  const fontFamList = userFontFamilies.slice();
  if (fontFamList.length > 0) {
    sectionTitle("Font Families");
    const FF_W = 380, FF_H = 160, FF_GAP = 24;
    const ffCols = Math.min(fontFamList.length, Math.floor((W - PAD * 2 + FF_GAP) / (FF_W + FF_GAP)));
    for (let ffi = 0; ffi < fontFamList.length; ffi++) {
      const ffFam = fontFamList[ffi];
      const ffCol = ffi % ffCols;
      const ffRow = Math.floor(ffi / ffCols);
      const ffX = PAD + ffCol * (FF_W + FF_GAP);
      const ffY = y + ffRow * (FF_H + FF_GAP);

      const ffCard = figma.createFrame();
      ffCard.name = "font/" + ffFam.toLowerCase();
      ffCard.resize(FF_W, FF_H); ffCard.x = ffX; ffCard.y = ffY;
      ffCard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      ffCard.cornerRadius = 12;
      ffCard.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }]; ffCard.strokeWeight = 1;
      ffCard.clipsContent = true;
      frame.appendChild(ffCard);

      const ffRole = figma.createText();
      ffRole.fontName = { family: "Inter", style: "Regular" }; ffRole.fontSize = 10;
      ffRole.characters = ffi === 0 ? "PRIMARY" : (ffi === 1 ? "SECONDARY" : (ffi === 2 ? "TERTIARY" : "FONT " + (ffi + 1)));
      ffRole.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      ffRole.letterSpacing = { value: 1.5, unit: "PIXELS" };
      ffRole.x = 24; ffRole.y = 20; ffCard.appendChild(ffRole);

      // Detect if font is installed
      let ffInstalled = true;
      try { await figma.loadFontAsync({ family: ffFam, style: "Regular" }); } catch(e) { ffInstalled = false; }

      if (ffInstalled) {
        const ffNameStyle = await loadFontWithFallback(ffFam, 700);
        const ffName = figma.createText();
        ffName.fontName = { family: ffFam, style: ffNameStyle }; ffName.fontSize = 28;
        ffName.characters = ffFam;
        ffName.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        ffName.x = 24; ffName.y = 42; ffCard.appendChild(ffName);

        const ffSampleStyle = await loadFontWithFallback(ffFam, 400);
        const ffSample = figma.createText();
        ffSample.fontName = { family: ffFam, style: ffSampleStyle }; ffSample.fontSize = 14;
        ffSample.characters = "AaBbCcDdEeFfGgHhIiJjKkLl";
        ffSample.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
        ffSample.x = 24; ffSample.y = 86; ffCard.appendChild(ffSample);

        const ffWS = [{ w: 300, l: "Light" }, { w: 400, l: "Regular" }, { w: 600, l: "SemiBold" }, { w: 700, l: "Bold" }];
        let ffwx = 24;
        for (let fwi = 0; fwi < ffWS.length; fwi++) {
          const fws = await loadFontWithFallback(ffFam, ffWS[fwi].w);
          const fwn = figma.createText();
          fwn.fontName = { family: ffFam, style: fws }; fwn.fontSize = 11;
          fwn.characters = ffWS[fwi].l;
          fwn.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
          fwn.x = ffwx; fwn.y = 118; ffCard.appendChild(fwn);
          ffwx += fwn.width + 16;
        }
      } else {
        createSpecText(ffCard, ffFam, 24, 42, 20, "Bold", { r: 0.6, g: 0.3, b: 0.3 });
        createSpecText(ffCard, "Font not installed — add to your system to preview", 24, 76, 11, "Regular", { r: 0.6, g: 0.3, b: 0.3 });
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
    const tsMap = {};
    for (let tmi = 0; tmi < textStyles.length; tmi++) tsMap[textStyles[tmi].name] = textStyles[tmi];

    // Group by first path segment
    const tsGroups = {};
    const tsOrder = [];
    for (let tgi = 0; tgi < textStyles.length; tgi++) {
      const tsparts = textStyles[tgi].name.split("/");
      const tsGroup = tsparts.length > 1 ? tsparts[0] : "other";
      if (!tsGroups[tsGroup]) { tsGroups[tsGroup] = []; tsOrder.push(tsGroup); }
      tsGroups[tsGroup].push(textStyles[tgi]);
    }

    // Headings
    if (tsGroups["heading"]) {
      sectionTitle("Headings");
      const heads = tsGroups["heading"];
      for (let hi = 0; hi < heads.length; hi++) {
        const hts = heads[hi];
        const hFam = hts.fontName.family;
        await loadFontWithFallback(hFam, 700);
        const hNode = figma.createText();
        await hNode.setTextStyleIdAsync(hts.id);
        const hLabel = hts.name.split("/").pop();
        hNode.characters = hLabel.toUpperCase() + " — The quick brown fox jumps over the lazy dog";
        hNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        fBindFill(hNode, "text/primary");
        hNode.x = PAD; hNode.y = y; frame.appendChild(hNode);
        const hMeta = hLabel + " · " + hts.fontSize + "px / " + hts.fontName.style;
        createSpecText(frame, hMeta, PAD, y + Math.max(hNode.height, 20) + 2, 10, "Regular", { r: 0.5, g: 0.5, b: 0.5 });
        y += Math.max(hNode.height, 24) + 26;
      }
      y += SECTION_GAP;
    }

    // Body / Paragraphs
    if (tsGroups["body"]) {
      sectionTitle("Paragraphs");
      const paraText = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.";
      const bods = tsGroups["body"];
      for (let bdi = 0; bdi < bods.length; bdi++) {
        const bts = bods[bdi];
        await loadFontWithFallback(bts.fontName.family, 400);
        const bLabel = bts.name.split("/").pop();
        createSpecText(frame, "body/" + bLabel + " · " + bts.fontSize + "px / " + bts.fontName.style, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        const bNode = figma.createText();
        await bNode.setTextStyleIdAsync(bts.id);
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
      const lnks = tsGroups["links"];
      const linkColor = hexToFigma(brandHex);
      for (let lki = 0; lki < lnks.length; lki++) {
        const lts = lnks[lki];
        await loadFontWithFallback(lts.fontName.family, 500);
        const lLabel = lts.name.split("/").pop();
        createSpecText(frame, "links/" + lLabel + " · " + lts.fontSize + "px", PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        const lNode = figma.createText();
        await lNode.setTextStyleIdAsync(lts.id);
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
    const uiGroups = ["buttons", "input", "label"];
    const uiStyles = [];
    for (let ugi = 0; ugi < uiGroups.length; ugi++) {
      if (tsGroups[uiGroups[ugi]]) {
        for (let usi = 0; usi < tsGroups[uiGroups[ugi]].length; usi++) uiStyles.push(tsGroups[uiGroups[ugi]][usi]);
      }
    }
    if (uiStyles.length > 0) {
      sectionTitle("UI Text Styles");
      for (let uis = 0; uis < uiStyles.length; uis++) {
        const uts = uiStyles[uis];
        await loadFontWithFallback(uts.fontName.family, 400);
        createSpecText(frame, uts.name + " · " + uts.fontSize + "px / " + uts.fontName.style, PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        const uNode = figma.createText();
        await uNode.setTextStyleIdAsync(uts.id);
        uNode.characters = uts.name + " — Sample text preview";
        uNode.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
        fBindFill(uNode, "text/primary");
        uNode.x = PAD; uNode.y = y; frame.appendChild(uNode);
        y += Math.max(uNode.height, 20) + 16;
      }
      y += SECTION_GAP;
    }
    } catch(tsErr) { /* text styles section failed */ }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TYPOGRAPHY SCALE — sizes, weights, line-heights from Typography collection
  // ══════════════════════════════════════════════════════════════════════════
  if (typCol) {
    const typFloats = await cxGetFloats(typCol, allVars, allCols);
    const tSizes = [], tWeights = [], tLH = [];
    for (let tfi2 = 0; tfi2 < typFloats.length; tfi2++) {
      const tf = typFloats[tfi2];
      const tfn = tf.fullName.toLowerCase();
      if (tfn.indexOf("size") !== -1) tSizes.push(tf);
      else if (tfn.indexOf("weight") !== -1) tWeights.push(tf);
      else if (tfn.indexOf("line") !== -1) tLH.push(tf);
    }

    if (tSizes.length || tWeights.length || tLH.length) {
      sectionTitle("Typography Scale");
      const primaryFam = userFontFamilies.length > 0 ? userFontFamilies[0] : "";
      let primaryInstalled = false;
      if (primaryFam) { try { await figma.loadFontAsync({ family: primaryFam, style: "Regular" }); primaryInstalled = true; } catch(e) {} }

      if (!primaryInstalled) {
        const noFontMsg = primaryFam ? (primaryFam + " is not installed — install font to preview typography scale") : "No primary font found";
        createSpecText(frame, noFontMsg, PAD, y, 12, "Regular", { r: 0.6, g: 0.3, b: 0.3 });
        y += 32 + SECTION_GAP;
      } else {
        if (tSizes.length) {
          createSpecText(frame, "Font Sizes", PAD, y, 14, "SemiBold", { r: 0.2, g: 0.2, b: 0.2 }); y += 24;
          for (let fsi = 0; fsi < tSizes.length; fsi++) {
            const sz = tSizes[fsi]; const px = Math.min(sz.value, 60);
            const szStyle = await loadFontWithFallback(primaryFam, 400);
            const szText = figma.createText();
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
          let wx = PAD;
          for (let fwi2 = 0; fwi2 < tWeights.length; fwi2++) {
            const wt = tWeights[fwi2];
            const wtStyle = await loadFontWithFallback(primaryFam, wt.value);
            const wtText = figma.createText();
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
          const lhSample = "The quick brown fox jumps\nover the lazy dog. Pack my\nbox with five dozen\nliquor jugs.";
          const lhColW = Math.floor((W - PAD * 2 - (tLH.length - 1) * 24) / Math.max(tLH.length, 1));
          let lhX = PAD, lhMaxH = 0;
          for (let lhi = 0; lhi < tLH.length; lhi++) {
            const lh = tLH[lhi]; const lhVal = lh.value || 1.5;
            createSpecText(frame, lh.name + " (" + lh.value + ")", lhX, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
            const lhNode = figma.createText();
            const lhStyle = await loadFontWithFallback(primaryFam, 400);
            lhNode.fontName = { family: primaryFam, style: lhStyle }; lhNode.fontSize = 16;
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
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RADIUS
  // ══════════════════════════════════════════════════════════════════════════
  const radiusItems = await cxGetFloats(cxFindCol(allCols, "radius"), allVars, allCols);
  if (radiusItems.length > 0) {
    sectionTitle("Radius");
    let rx = PAD;
    for (let ri = 0; ri < radiusItems.length; ri++) {
      const rad = radiusItems[ri]; const rv = rad.value;
      const rRect = figma.createRectangle();
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
  const shadowStyles = effectStyles.filter(function(es) { return es.name.toLowerCase().indexOf("shadow") !== -1 && es.effects.length > 0; });
  if (shadowStyles.length > 0) {
    sectionTitle("Shadows");
    let shx = PAD;
    for (let shi = 0; shi < shadowStyles.length; shi++) {
      const shEs = shadowStyles[shi];
      const shEff = shEs.effects[0];
      const shRect = figma.createRectangle();
      shRect.name = shEs.name; shRect.resize(120, 80);
      shRect.x = shx; shRect.y = y; shRect.cornerRadius = 8;
      shRect.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      try { await shRect.setEffectStyleIdAsync(shEs.id); } catch(e) {}
      frame.appendChild(shRect);
      const shLabel = shEs.name.replace(/^shadow\//, "");
      const shVal = (shEff.offset ? shEff.offset.x : 0) + "px " + (shEff.offset ? shEff.offset.y : 0) + "px " + (shEff.radius || 0) + "px";
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
  const borderItems = await cxGetFloats(cxFindCol(allCols, "border"), allVars, allCols);
  if (borderItems.length > 0) {
    sectionTitle("Borders");
    let bx = PAD;
    for (let bi = 0; bi < borderItems.length; bi++) {
      const bd = borderItems[bi]; const bv = bd.value;
      const bRect = figma.createRectangle();
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
  let zItems = await cxGetFloats(cxFindCol(allCols, "z-index"), allVars, allCols);
  if (zItems.length === 0) zItems = await cxGetFloats(cxFindCol(allCols, "zindex"), allVars, allCols);
  if (zItems.length > 0) {
    sectionTitle("Z-Index");
    const zBrand = hexToFigma(brandHex);
    const zSorted = zItems.slice().sort(function(a, b) { return a.value - b.value; });
    const zCardW = 220, zCardH = 80, zOffX = 32, zOffY = -36;
    const zCount = zSorted.length;
    const zBaseX = PAD, zBaseY = y + (zCount - 1) * Math.abs(zOffY);
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
    for (let zi = 0; zi < zCount; zi++) {
      const zItem = zSorted[zi];
      const zx = zBaseX + zi * zOffX, zy = zBaseY + zi * zOffY;
      const zOp = 0.06 + 0.12 * (zi / Math.max(zCount - 1, 1));
      const zCard = figma.createFrame();
      zCard.name = "zindex/" + zItem.name; zCard.resize(zCardW, zCardH);
      zCard.x = zx; zCard.y = zy;
      zCard.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      zCard.strokes = [{ type: "SOLID", color: zBrand, opacity: 0.2 + 0.4 * (zi / Math.max(zCount - 1, 1)) }];
      zCard.strokeWeight = 1; zCard.cornerRadius = 6;
      zCard.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: zOp }, offset: { x: 0, y: 2 }, radius: 6, spread: 0, visible: true, blendMode: "NORMAL" }];
      frame.appendChild(zCard);
      const zNameTxt = figma.createText(); zNameTxt.name = "label";
      zNameTxt.fontName = { family: "Inter", style: "Semi Bold" }; zNameTxt.fontSize = 12;
      zNameTxt.characters = zItem.name;
      zNameTxt.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.15, b: 0.15 } }];
      zNameTxt.x = 12; zNameTxt.y = zCardH - 34; zCard.appendChild(zNameTxt);
      const zValTxt = figma.createText(); zValTxt.name = "value";
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
  const opacityCol2 = cxFindCol(allCols, "opacity");
  const opVarByPct = {};
  if (opacityCol2) {
    const opMid2 = opacityCol2.modes[0].modeId;
    const opAllVars = allVars.filter(function(v) { return v.variableCollectionId === opacityCol2.id && v.resolvedType === "FLOAT"; });
    for (let ovi = 0; ovi < opAllVars.length; ovi++) {
      try { const ovVal = opAllVars[ovi].valuesByMode[opMid2]; opVarByPct[Math.round(ovVal * 100)] = opAllVars[ovi]; } catch(e) {}
    }
  }
  const opCols2 = 10, opGap = 8;
  const opSW = Math.floor((W - PAD * 2 - (opCols2 - 1) * opGap) / opCols2), opSH = 40;
  let opX = PAD;
  for (let opi = 5; opi <= 95; opi += 5) {
    const opRect = figma.createRectangle();
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
  const spItems = await cxGetFloats(cxFindCol(allCols, "spacing"), allVars, allCols);
  if (spItems.length > 0) {
    sectionTitle("Spacing");
    const spBrand = hexToFigma(brandHex);
    const spColsN = 3, spGutX = 24, spInner = 32, spRowGap = 16;
    let spRowY = y, spRowMax = y;
    for (let spi = 0; spi < spItems.length; spi++) {
      const sp = spItems[spi]; const spVal = sp.value;
      const spColIdx = spi % spColsN;
      const spPad = Math.max(spVal, 4);
      let spOuter = spInner + spPad * 2;
      if (spColIdx === 0 && spi > 0) { spRowY = spRowMax + spRowGap; spRowMax = spRowY; }
      const spCellW = Math.floor((W - PAD * 2 - spGutX) / spColsN);
      const spX = PAD + spColIdx * (spCellW + spGutX);
      // Use auto-layout frame so we can bind padding to spacing variable
      const spFrame = figma.createFrame();
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
      const spInnerRect = figma.createRectangle();
      spInnerRect.name = "inner"; spInnerRect.resize(spInner, spInner);
      spInnerRect.fills = [{ type: "SOLID", color: { r: 0.78, g: 0.78, b: 0.82 } }]; spInnerRect.cornerRadius = 2;
      spFrame.appendChild(spInnerRect);
      spOuter = spFrame.width;
      const spLX = spX + spOuter + 12, spLCY = spRowY + (spOuter / 2) - 7;
      createSpecText(frame, sp.name, spLX, spLCY - 1, 12, "Medium", { r: 0.15, g: 0.15, b: 0.15 });
      createSpecText(frame, spVal + "px", spLX, spLCY + 14, 11, "Regular", { r: 0.45, g: 0.45, b: 0.45 });
      if (spRowY + spOuter > spRowMax) spRowMax = spRowY + spOuter;
    }
    y = spRowMax + spRowGap + SECTION_GAP;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BREAKPOINTS — from Breakpoints collection (nested portrait rectangles)
  // ══════════════════════════════════════════════════════════════════════════
  const bpItems = await cxGetFloats(cxFindCol(allCols, "breakpoint"), allVars, allCols);
  if (bpItems.length > 0) {
    sectionTitle("Breakpoints");
    const bpBrand = hexToFigma(brandHex);
    const bpAsc = bpItems.slice().sort(function(a, b) { return a.value - b.value; });
    const bpAvailW = W - PAD * 2;
    const bpOuterVal = (bpAsc[bpAsc.length - 1].value || 991) * 1.15;
    const bpScale = bpAvailW / bpOuterVal;
    const bpH = 320, bpCenterX = PAD + bpAvailW / 2, bpBaseY = y;
    await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
    for (let bpi = bpAsc.length - 1; bpi >= 0; bpi--) {
      const bp = bpAsc[bpi]; const bpVal = bp.value;
      let bpRectW;
      if (bpi === bpAsc.length - 1) { bpRectW = Math.round(bpOuterVal * bpScale); }
      else { bpRectW = Math.round(Math.max(bpVal, 280) * bpScale); }
      const bpX = Math.round(bpCenterX - bpRectW / 2);
      const bpOp = 0.06 + 0.06 * (bpAsc.length - 1 - bpi);
      const bpRect = figma.createRectangle();
      bpRect.name = "breakpoint/" + bp.name; bpRect.resize(bpRectW, bpH);
      bpRect.x = bpX; bpRect.y = bpBaseY;
      bpRect.fills = [{ type: "SOLID", color: bpBrand, opacity: bpOp }];
      bpRect.strokes = [{ type: "SOLID", color: bpBrand, opacity: 0.15 + 0.1 * (bpAsc.length - 1 - bpi) }];
      bpRect.strokeWeight = 1; bpRect.cornerRadius = bpi === bpAsc.length - 1 ? 8 : 4;
      frame.appendChild(bpRect);
      let bpRange;
      if (bpi === bpAsc.length - 1) bpRange = bp.name + " \u2265 " + bpVal + "px";
      else if (bpi === 0) bpRange = bp.name + " < " + bpAsc[1].value + "px";
      else bpRange = bp.name + ": " + bpVal + "\u2013" + bpAsc[bpi + 1].value + "px";
      const bpLabel = figma.createText(); bpLabel.name = "bp-label/" + bp.name;
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
  let maxBot = y;
  for (let mi = 0; mi < frame.children.length; mi++) {
    const cb = frame.children[mi].y + frame.children[mi].height;
    if (cb > maxBot) maxBot = cb;
  }
  frame.resize(W, Math.max(maxBot + PAD, 400));
  frame.clipsContent = true;
}
