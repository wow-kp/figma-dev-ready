// foundations-complex.ts — Foundations page generator (complex / variable-driven)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, cxResolveVar, cxColorToHex, cxFindCol, cxGetFloats, cxStripPrefix } from './utils';

export async function generateFoundationsPageComplex() {
  var allVars = await figma.variables.getLocalVariablesAsync();
  var allCols = await figma.variables.getLocalVariableCollectionsAsync();
  var textStyles = await figma.getLocalTextStylesAsync();
  var effectStyles = await figma.getLocalEffectStylesAsync();

  var page = findPageByHint("foundations");
  if (!page) return;
  await figma.setCurrentPageAsync(page);

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
  frame.name = "foundations";
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
        var bVal = await cxResolveVar(allVars[bvi], cMid, allCols);
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
      var val = await cxResolveVar(primVars[pvi], primMid, allCols);
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
            var svVal = await cxResolveVar(sv, modeId, allCols);
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
        await hNode.setTextStyleIdAsync(hts.id);
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
      var lnks = tsGroups["links"];
      var linkColor = hexToFigma(brandHex);
      for (var lki = 0; lki < lnks.length; lki++) {
        var lts = lnks[lki];
        await loadFontWithFallback(lts.fontName.family, 500);
        var lLabel = lts.name.split("/").pop();
        createSpecText(frame, "links/" + lLabel + " · " + lts.fontSize + "px", PAD, y, 10, "Medium", { r: 0.5, g: 0.5, b: 0.5 });
        y += 16;
        var lNode = figma.createText();
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
        await uNode.setTextStyleIdAsync(uts.id);
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
    var typFloats = await cxGetFloats(typCol, allVars, allCols);
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
  var radiusItems = await cxGetFloats(cxFindCol(allCols, "radius"), allVars, allCols);
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
      try { await shRect.setEffectStyleIdAsync(shEs.id); } catch(e) {}
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
  var borderItems = await cxGetFloats(cxFindCol(allCols, "border"), allVars, allCols);
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
  var zItems = await cxGetFloats(cxFindCol(allCols, "z-index"), allVars, allCols);
  if (zItems.length === 0) zItems = await cxGetFloats(cxFindCol(allCols, "zindex"), allVars, allCols);
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
  var spItems = await cxGetFloats(cxFindCol(allCols, "spacing"), allVars, allCols);
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
  var bpItems = await cxGetFloats(cxFindCol(allCols, "breakpoint"), allVars, allCols);
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
