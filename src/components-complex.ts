// components-complex.ts — Complex Components page generator (reads directly from Figma variables)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, createPlaceholderImageHash, cxResolveVar, cxColorToHex, cxFindCol, cxGetFloats } from './utils';
import { DESKTOP_WIDTH, PAGE_PADDING, STANDARD_EXPORT_SETTINGS } from './constants';
import { bindFill, bindStroke, bindRadius, bindCompSpacing, bindBorderWidth, bindRadiusByValue, bindOpacity, sectionTitle, findStyle, pickLabelStyle } from './component-helpers';

export async function generateComponentsPageComplex() {
  const allVars = await figma.variables.getLocalVariablesAsync();
  const allCols = await figma.variables.getLocalVariableCollectionsAsync();
  const localTextStyles = await figma.getLocalTextStylesAsync();

  const page = findPageByHint("components");
  if (!page) return;
  await figma.setCurrentPageAsync(page);

  // Load Inter
  const compW = [400, 500, 600, 700];
  for (let cw = 0; cw < compW.length; cw++) await loadFontWithFallback("Inter", compW[cw]);

  // Load user fonts from text styles + Typography STRING vars
  const loadedFams = {};
  for (let tsi = 0; tsi < localTextStyles.length; tsi++) {
    const fam = localTextStyles[tsi].fontName.family;
    if (!loadedFams[fam] && fam !== "Inter") {
      loadedFams[fam] = true;
      for (let cwi = 0; cwi < compW.length; cwi++) await loadFontWithFallback(fam, compW[cwi]);
    }
  }

  // Remove existing
  const existing = page.children.filter(function(n) { return n.name === "Components"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  const W = DESKTOP_WIDTH, PAD = PAGE_PADDING, SECTION_GAP = 80;
  const frame = figma.createFrame();
  frame.name = "components";
  frame.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.resize(W, 100);
  frame.paddingTop = PAD; frame.paddingBottom = PAD;
  frame.paddingLeft = PAD; frame.paddingRight = PAD;
  frame.itemSpacing = 24;
  page.appendChild(frame);
  // Note: bindCompSpacing(frame, spacingVarMap) called after helpers are defined (see below)

  // Detect brand color
  let brandHex = "#3B82F6";
  let colorCol = null;
  for (let ci = 0; ci < allCols.length; ci++) { if (allCols[ci].name === "Colors") { colorCol = allCols[ci]; break; } }
  if (colorCol) {
    const cMid = colorCol.modes[0].modeId;
    for (let bvi = 0; bvi < allVars.length; bvi++) {
      if (allVars[bvi].variableCollectionId === colorCol.id && allVars[bvi].name === "brand/primary") {
        const bVal = await cxResolveVar(allVars[bvi], cMid, allCols);
        const bh = cxColorToHex(bVal); if (bh) brandHex = bh; break;
      }
    }
  }
  const brandColor = hexToFigma(brandHex);

  // Color variable binding helpers
  if (!colorCol) {
    colorCol = figma.variables.createVariableCollection("Colors");
  }
  const colorVarMap = {};
  // Re-read vars to pick up essential colors created by ensureEssentialColors()
  const cvarsAll = await figma.variables.getLocalVariablesAsync();
  const cvars = cvarsAll.filter(function(v) { return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR"; });
  for (let cvi = 0; cvi < cvars.length; cvi++) colorVarMap[cvars[cvi].name] = cvars[cvi];


  // Radius
  let defaultRadius = 8;
  let defaultRadiusVar = null;
  const radiusCol = cxFindCol(allCols, "radius");
  if (radiusCol) {
    const rVars = await cxGetFloats(radiusCol, allVars, allCols);
    for (let rvi = 0; rvi < rVars.length; rvi++) {
      if (rVars[rvi].name === "md" || rVars[rvi].name === "default") {
        defaultRadius = rVars[rvi].value; defaultRadiusVar = rVars[rvi].variable; break;
      }
    }
  }

  // Spacing variable binding
  const spacingCol = cxFindCol(allCols, "spacing");
  const spacingVarMap = {};
  if (spacingCol) {
    const spVars = allVars.filter(function(v) { return v.variableCollectionId === spacingCol.id && v.resolvedType === "FLOAT"; });
    const spMid = spacingCol.modes[0].modeId;
    for (let svi = 0; svi < spVars.length; svi++) {
      try {
        const spv = await cxResolveVar(spVars[svi], spMid, allCols);
        if (typeof spv === "number") spacingVarMap[spv] = spVars[svi];
      } catch(e) {}
    }
  }

  // ── Look up border width variables for binding ──
  let borderCol = cxFindCol(allCols, "border");
  if (!borderCol) borderCol = cxFindCol(allCols, "border width");
  const borderVarMap = {};
  if (borderCol) {
    const bwVars = allVars.filter(function(v) { return v.variableCollectionId === borderCol.id && v.resolvedType === "FLOAT"; });
    const bwModeId = borderCol.modes[0].modeId;
    for (let bwi = 0; bwi < bwVars.length; bwi++) {
      try {
        const bwVal = await cxResolveVar(bwVars[bwi], bwModeId, allCols);
        if (typeof bwVal === "number") borderVarMap[bwVal] = bwVars[bwi];
      } catch(e) {}
    }
  }

  // ── Look up radius variables by value for binding ──
  const radiusVarByValue = {};
  if (radiusCol) {
    const rvars2 = allVars.filter(function(v) { return v.variableCollectionId === radiusCol.id && v.resolvedType === "FLOAT"; });
    const rvModeId = radiusCol.modes[0].modeId;
    for (let rvi3 = 0; rvi3 < rvars2.length; rvi3++) {
      try {
        const rvv = await cxResolveVar(rvars2[rvi3], rvModeId, allCols);
        if (typeof rvv === "number") radiusVarByValue[rvv] = rvars2[rvi3];
      } catch(e) {}
    }
  }

  // ── Look up opacity variables for binding ──
  const opacityCol = cxFindCol(allCols, "opacity");
  const opacityVarMapComp = {};
  let opacityPctModeIdCx = null;  // Percentage mode for Figma "Opacity" binding
  if (opacityCol) {
    const opModesCx = opacityCol.modes || [];
    for (let omi = 0; omi < opModesCx.length; omi++) {
      if (opModesCx[omi].name === "Percentage") { opacityPctModeIdCx = opModesCx[omi].modeId; break; }
    }
    const opVars = allVars.filter(function(v) { return v.variableCollectionId === opacityCol.id && v.resolvedType === "FLOAT"; });
    const opModeId = opacityCol.modes[0].modeId;
    for (let opi = 0; opi < opVars.length; opi++) {
      try {
        const opVal = await cxResolveVar(opVars[opi], opModeId, allCols);
        if (typeof opVal === "number") opacityVarMapComp[Math.round(opVal * 100)] = opVars[opi];
      } catch(e) {}
    }
  }
  // Figma's "Opacity" property uses percentage values — set Percentage mode on main frame
  if (opacityCol && opacityPctModeIdCx) {
    try { frame.setExplicitVariableModeForCollection(opacityCol.id, opacityPctModeIdCx); } catch(e) {}
  }

  // Bind the main frame spacing now that helpers are defined
  bindCompSpacing(frame, spacingVarMap);

  // ══════════════════════════════════════════════════════════════════════════
  // BUTTONS (component set with Variant + Size properties)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle(frame, "Buttons");
  const btnSizes = [
    { label: "Large",   style: "lg" },
    { label: "Default", style: "default" },
    { label: "Small",   style: "sm" }
  ];
  const btnVariants = [
    { label: "Primary",   filled: true },
    { label: "Secondary", filled: false },
  ];

  const allBtnComps = [];
  for (let bvi2 = 0; bvi2 < btnVariants.length; bvi2++) {
    const variant = btnVariants[bvi2];
    for (let bsi = 0; bsi < btnSizes.length; bsi++) {
      const bs = btnSizes[bsi];
      const ts = findStyle("buttons", bs.style, localTextStyles);
      const padH = bs.style === "lg" ? 16 : (bs.style === "sm" ? 8 : 12);
      const padW = bs.style === "lg" ? 32 : (bs.style === "sm" ? 16 : 24);

      const btnComp = figma.createComponent();
      btnComp.name = "Variant=" + variant.label + ", Size=" + bs.label;
      btnComp.cornerRadius = defaultRadius;
      bindRadius(btnComp, defaultRadiusVar);

      if (variant.filled) {
        btnComp.fills = [{ type: "SOLID", color: brandColor }];
        bindFill(btnComp, "brand/primary", colorVarMap);
      } else {
        btnComp.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        btnComp.strokes = [{ type: "SOLID", color: brandColor }];
        bindFill(btnComp, "white", colorVarMap);
        bindStroke(btnComp, "brand/primary", colorVarMap);
        btnComp.strokeWeight = 1.5;
        bindBorderWidth(btnComp, borderVarMap);
      }

      const btnText = figma.createText();
      if (ts) {
        await btnText.setTextStyleIdAsync(ts.id);
      } else {
        btnText.fontName = { family: "Inter", style: "Semi Bold" };
        btnText.fontSize = bs.style === "lg" ? 18 : (bs.style === "sm" ? 14 : 16);
      }
      btnText.characters = "Button";
      btnText.fills = [{ type: "SOLID", color: variant.filled ? { r: 1, g: 1, b: 1 } : brandColor }];
      bindFill(btnText, variant.filled ? "white" : "brand/primary", colorVarMap);

      btnComp.layoutMode = "HORIZONTAL";
      btnComp.primaryAxisAlignItems = "CENTER";
      btnComp.counterAxisAlignItems = "CENTER";
      btnComp.paddingTop = padH; btnComp.paddingBottom = padH;
      btnComp.paddingLeft = padW; btnComp.paddingRight = padW;
      btnComp.primaryAxisSizingMode = "AUTO";
      btnComp.counterAxisSizingMode = "AUTO";
      btnComp.appendChild(btnText);
      bindCompSpacing(btnComp, spacingVarMap);

      allBtnComps.push(btnComp);
    }
  }

  const btnSet = figma.combineAsVariants(allBtnComps, frame);
  btnSet.name = "Button";
  btnSet.layoutMode = "HORIZONTAL";
  btnSet.layoutWrap = "WRAP";
  btnSet.itemSpacing = 16;
  btnSet.counterAxisSpacing = 16;
  btnSet.paddingTop = 24; btnSet.paddingBottom = 24;
  btnSet.paddingLeft = 24; btnSet.paddingRight = 24;
  btnSet.primaryAxisSizingMode = "AUTO";
  btnSet.counterAxisSizingMode = "AUTO";
  btnSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  bindFill(btnSet, "white", colorVarMap);
  btnSet.cornerRadius = 12;
  bindRadiusByValue(btnSet, radiusVarByValue);
  btnSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  btnSet.strokeWeight = 1;
  bindBorderWidth(btnSet, borderVarMap);
  bindCompSpacing(btnSet, spacingVarMap);

  // ══════════════════════════════════════════════════════════════════════════
  // INPUTS — 3 component sets (one per type), stacked vertically with titles
  // Types: Placeholder, Floating Label, Label + Placeholder
  // Each has State variants: Default, Focused, Error, Disabled
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle(frame, "Inputs");
  const inputStyle = findStyle("input", "default", localTextStyles);
  const labelStyle = findStyle("label", "default", localTextStyles);
  const labelStyleFocused = findStyle("label", "focused", localTextStyles);
  const labelStyleError   = findStyle("label", "error", localTextStyles);
  const inputTypes = [
    { type: "Placeholder",         hasLabel: false, hasPlaceholder: true,  floatingLabel: false },
    { type: "Floating Label",      hasLabel: true,  hasPlaceholder: false, floatingLabel: true  },
    { type: "Label + Placeholder", hasLabel: true,  hasPlaceholder: true,  floatingLabel: false },
  ];
  const inputStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5, borderVar: "border/default" },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2, borderVar: "focus/border" },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5, borderVar: "error/border" },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1, borderVar: "border/default" },
  ];

  for (let iti = 0; iti < inputTypes.length; iti++) {
    const itype = inputTypes[iti];
    const typeComps = [];

    // ── Type title ──
    const typeTitle = figma.createText();
    typeTitle.fontName = { family: "Inter", style: "Semi Bold" };
    typeTitle.fontSize = 14;
    typeTitle.characters = itype.type;
    typeTitle.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
    bindFill(typeTitle, "text/primary", colorVarMap);
    frame.appendChild(typeTitle);

    for (let isi = 0; isi < inputStates.length; isi++) {
      const ist = inputStates[isi];
      const isError = ist.label === "Error";
      const isDisabled = ist.label === "Disabled";

      const inputComp = figma.createComponent();
      inputComp.name = "State=" + ist.label;
      inputComp.resize(260, 44);
      inputComp.layoutMode = "VERTICAL";
      inputComp.primaryAxisSizingMode = "AUTO";
      inputComp.counterAxisSizingMode = "FIXED";
      inputComp.itemSpacing = 0;
      inputComp.fills = [];

      if (itype.floatingLabel) {
        // ── Floating Label type: form-field > field-wrapper > field + label ──
        const isDefault = ist.label === "Default";

        const formField = figma.createFrame();
        formField.name = "form-field";
        formField.layoutMode = "VERTICAL";
        formField.primaryAxisSizingMode = "AUTO";
        formField.counterAxisSizingMode = "AUTO";
        formField.fills = [];

        const fieldWrapper = figma.createFrame();
        fieldWrapper.name = "field-wrapper";
        fieldWrapper.layoutMode = "VERTICAL";
        fieldWrapper.primaryAxisSizingMode = "AUTO";
        fieldWrapper.counterAxisSizingMode = "AUTO";
        fieldWrapper.fills = [];

        let field;
        if (isDefault) {
          field = figma.createRectangle();
          field.name = "field";
          field.resize(260, 44);
          field.cornerRadius = defaultRadius;
          bindRadius(field, defaultRadiusVar);
          field.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
          bindFill(field, "white", colorVarMap);
          field.strokes = [{ type: "SOLID", color: ist.borderColor }];
          bindStroke(field, ist.borderVar, colorVarMap);
          field.strokeWeight = ist.strokeW;
          bindBorderWidth(field, borderVarMap);
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
          bindRadius(field, defaultRadiusVar);
          field.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
          if (!isDisabled) bindFill(field, "white", colorVarMap);
          field.strokes = [{ type: "SOLID", color: ist.borderColor }];
          bindStroke(field, ist.borderVar, colorVarMap);
          field.strokeWeight = ist.strokeW;
          bindBorderWidth(field, borderVarMap);

          const floatInput = figma.createText();
          if (inputStyle) {
            await floatInput.setTextStyleIdAsync(inputStyle.id);
          } else {
            floatInput.fontName = { family: "Inter", style: "Regular" };
            floatInput.fontSize = 14;
            floatInput.fills = [{ type: "SOLID", color: { r: 0.13, g: 0.13, b: 0.13 } }];
          }
          floatInput.characters = isDisabled ? "Disabled" : "Value";
          if (isDisabled) { floatInput.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }]; floatInput.opacity = 0.5; bindOpacity(floatInput, opacityVarMapComp); }
          else { bindFill(floatInput, "text/primary", colorVarMap); }
          field.appendChild(floatInput);
          bindCompSpacing(field, spacingVarMap);
        }

        fieldWrapper.appendChild(field);
        field.layoutSizingHorizontal = "FILL";

        const floatLbl = figma.createText();
        if (isDefault) {
          if (inputStyle) {
            await floatLbl.setTextStyleIdAsync(inputStyle.id);
          } else {
            floatLbl.fontName = { family: "Inter", style: "Regular" };
            floatLbl.fontSize = 14;
            floatLbl.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
          }
          floatLbl.characters = "Label";
          bindFill(floatLbl, "focus/color", colorVarMap);
        } else {
          const flStyle = pickLabelStyle(ist.label, labelStyle, labelStyleFocused, labelStyleError);
          if (flStyle) {
            await floatLbl.setTextStyleIdAsync(flStyle.id);
          } else {
            floatLbl.fontName = { family: "Inter", style: "Medium" };
            floatLbl.fontSize = 10;
            floatLbl.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.4 } }];
          }
          floatLbl.characters = isError ? "Error Label" : "Label";
          if (isError) { floatLbl.fills = [{ type: "SOLID", color: hexToFigma("#E32E22") }]; bindFill(floatLbl, "error/color", colorVarMap); }
          else { bindFill(floatLbl, "text/primary", colorVarMap); }
          if (isDisabled) { floatLbl.opacity = 0.5; bindOpacity(floatLbl, opacityVarMapComp); }
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

        const lbl = figma.createText();
        const lblSt = pickLabelStyle(ist.label, labelStyle, labelStyleFocused, labelStyleError);
        if (lblSt) {
          await lbl.setTextStyleIdAsync(lblSt.id);
        } else {
          lbl.fontName = { family: "Inter", style: "Medium" };
          lbl.fontSize = 12;
          lbl.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
        }
        lbl.characters = isError ? "Error Label" : "Label";
        if (isError) { lbl.fills = [{ type: "SOLID", color: hexToFigma("#E32E22") }]; bindFill(lbl, "error/color", colorVarMap); }
        else { bindFill(lbl, "text/primary", colorVarMap); }
        if (isDisabled) { lbl.opacity = 0.5; bindOpacity(lbl, opacityVarMapComp); }
        inputComp.appendChild(lbl);

        const inputField = figma.createFrame();
        inputField.name = "field";
        inputField.resize(260, 44);
        inputField.cornerRadius = defaultRadius;
        bindRadius(inputField, defaultRadiusVar);
        inputField.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
        if (!isDisabled) bindFill(inputField, "white", colorVarMap);
        inputField.strokes = [{ type: "SOLID", color: ist.borderColor }];
        bindStroke(inputField, ist.borderVar, colorVarMap);
        inputField.strokeWeight = ist.strokeW;
        bindBorderWidth(inputField, borderVarMap);
        inputField.layoutMode = "HORIZONTAL";
        inputField.counterAxisAlignItems = "CENTER";
        inputField.paddingLeft = 14; inputField.paddingRight = 14;
        inputField.paddingTop = 10; inputField.paddingBottom = 10;
        inputField.primaryAxisSizingMode = "FIXED";
        inputField.counterAxisSizingMode = "FIXED";

        const inputText = figma.createText();
        if (inputStyle) {
          await inputText.setTextStyleIdAsync(inputStyle.id);
        } else {
          inputText.fontName = { family: "Inter", style: "Regular" };
          inputText.fontSize = 14;
          inputText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
        }
        inputText.characters = isDisabled ? "Disabled" : "Placeholder text";
        bindFill(inputText, "focus/color", colorVarMap);
        if (isDisabled) { inputText.opacity = 0.5; bindOpacity(inputText, opacityVarMapComp); }
        inputField.appendChild(inputText);
        bindCompSpacing(inputField, spacingVarMap);
        bindCompSpacing(inputComp, spacingVarMap);
        inputComp.appendChild(inputField);
        inputField.layoutSizingHorizontal = "FILL";

      } else {
        // ── Placeholder only type: just field with placeholder, no label ──
        const inputField2 = figma.createFrame();
        inputField2.name = "field";
        inputField2.resize(260, 44);
        inputField2.cornerRadius = defaultRadius;
        bindRadius(inputField2, defaultRadiusVar);
        inputField2.fills = [{ type: "SOLID", color: isDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
        if (!isDisabled) bindFill(inputField2, "white", colorVarMap);
        inputField2.strokes = [{ type: "SOLID", color: ist.borderColor }];
        bindStroke(inputField2, ist.borderVar, colorVarMap);
        inputField2.strokeWeight = ist.strokeW;
        bindBorderWidth(inputField2, borderVarMap);
        inputField2.layoutMode = "HORIZONTAL";
        inputField2.counterAxisAlignItems = "CENTER";
        inputField2.paddingLeft = 14; inputField2.paddingRight = 14;
        inputField2.paddingTop = 10; inputField2.paddingBottom = 10;
        inputField2.primaryAxisSizingMode = "FIXED";
        inputField2.counterAxisSizingMode = "FIXED";

        const inputText2 = figma.createText();
        if (inputStyle) {
          await inputText2.setTextStyleIdAsync(inputStyle.id);
        } else {
          inputText2.fontName = { family: "Inter", style: "Regular" };
          inputText2.fontSize = 14;
          inputText2.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
        }
        inputText2.characters = isDisabled ? "Disabled" : "Placeholder text";
        bindFill(inputText2, "focus/color", colorVarMap);
        if (isDisabled) { inputText2.opacity = 0.5; bindOpacity(inputText2, opacityVarMapComp); }
        inputField2.appendChild(inputText2);
        bindCompSpacing(inputField2, spacingVarMap);
        inputComp.appendChild(inputField2);
        inputField2.layoutSizingHorizontal = "FILL";
      }

      typeComps.push(inputComp);
    }

    const typeSet = figma.combineAsVariants(typeComps, frame);
    typeSet.name = "Input / " + itype.type;
    typeSet.layoutMode = "HORIZONTAL";
    typeSet.itemSpacing = 24;
    typeSet.paddingTop = 24; typeSet.paddingBottom = 24;
    typeSet.paddingLeft = 24; typeSet.paddingRight = 24;
    typeSet.primaryAxisSizingMode = "AUTO";
    typeSet.counterAxisSizingMode = "AUTO";
    typeSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    bindFill(typeSet, "white", colorVarMap);
    typeSet.cornerRadius = 12;
    bindRadiusByValue(typeSet, radiusVarByValue);
    typeSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    typeSet.strokeWeight = 1;
    bindBorderWidth(typeSet, borderVarMap);
    bindCompSpacing(typeSet, spacingVarMap);
    for (let vi = 0; vi < typeSet.children.length; vi++) {
      typeSet.children[vi].layoutSizingHorizontal = "FILL";
    }
    typeSet.layoutSizingHorizontal = "FILL";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LABELS (component set with State property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle(frame, "Labels");
  const labelDefaultStyle = findStyle("label", "default", localTextStyles);
  const labelFocusedStyle = findStyle("label", "focused", localTextStyles);
  const labelErrorStyle   = findStyle("label", "error", localTextStyles);
  if (labelDefaultStyle) {
    const lblStates = [
      { label: "Default", text: "Label",       style: labelDefaultStyle },
      { label: "Focused", text: "Label",       style: labelFocusedStyle || labelDefaultStyle },
      { label: "Error",   text: "Error Label", style: labelErrorStyle   || labelDefaultStyle },
    ];
    const allLblComps = [];
    for (let li = 0; li < lblStates.length; li++) {
      const ls = lblStates[li];
      const lblComp = figma.createComponent();
      lblComp.name = "State=" + ls.label;
      lblComp.layoutMode = "HORIZONTAL";
      lblComp.primaryAxisSizingMode = "AUTO";
      lblComp.counterAxisSizingMode = "AUTO";
      lblComp.fills = [];

      const lblNode = figma.createText();
      await lblNode.setTextStyleIdAsync(ls.style.id);
      lblNode.characters = ls.text;
      lblComp.appendChild(lblNode);

      allLblComps.push(lblComp);
    }

    const lblSet = figma.combineAsVariants(allLblComps, frame);
    lblSet.name = "Label";
    lblSet.layoutMode = "HORIZONTAL";
    lblSet.itemSpacing = 24;
    lblSet.paddingTop = 24; lblSet.paddingBottom = 24;
    lblSet.paddingLeft = 24; lblSet.paddingRight = 24;
    lblSet.primaryAxisSizingMode = "AUTO";
    lblSet.counterAxisSizingMode = "AUTO";
    lblSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    bindFill(lblSet, "white", colorVarMap);
    lblSet.cornerRadius = 12;
    bindRadiusByValue(lblSet, radiusVarByValue);
    lblSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    lblSet.strokeWeight = 1;
    bindBorderWidth(lblSet, borderVarMap);
    bindCompSpacing(lblSet, spacingVarMap);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DROPDOWN (component set with State property)
  // Same structure as Floating Label input but with a chevron arrow
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle(frame, "Dropdown");
  const dropdownStates = [
    { label: "Default",  borderColor: { r: 0.8, g: 0.8, b: 0.8 }, strokeW: 1.5, borderVar: "border/default" },
    { label: "Focused",  borderColor: hexToFigma("#000000"), strokeW: 2, borderVar: "focus/border" },
    { label: "Error",    borderColor: hexToFigma("#E32E22"), strokeW: 1.5, borderVar: "error/border" },
    { label: "Disabled", borderColor: { r: 0.88, g: 0.88, b: 0.88 }, strokeW: 1, borderVar: "border/default" },
  ];

  const chevronImageHash = figma.createImage(
    figma.base64Decode("iVBORw0KGgoAAAANSUhEUgAAABEAAAAKCAMAAABlokWQAAAAUVBMVEUAAAAmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJiYmJibJjcPCAAAAGnRSTlMA12X77M24LBMG5INzXkgZ9M7FwKaZUU80D09PB/wAAABWSURBVAjXRchHDsAgAMTAJRBI79X/f2gUhMAna2TMrNJsjBx1k6FZcQpdobemC9Jj2dsIrWcJ/0wWH8ljJ8UuOCSdcCs1Qq8eRuUq2KAq8FOC0uCGdB+C4gRExbf0IwAAAABJRU5ErkJggg==")
  ).hash;

  const allDropComps = [];
  for (let dsi = 0; dsi < dropdownStates.length; dsi++) {
    const dst = dropdownStates[dsi];
    const dIsError = dst.label === "Error";
    const dIsDisabled = dst.label === "Disabled";


    const dropComp = figma.createComponent();
    dropComp.name = "State=" + dst.label;
    dropComp.resize(260, 44);
    dropComp.layoutMode = "VERTICAL";
    dropComp.primaryAxisSizingMode = "AUTO";
    dropComp.counterAxisSizingMode = "FIXED";
    dropComp.itemSpacing = 0;
    dropComp.fills = [];

    const dFormField = figma.createFrame();
    dFormField.name = "form-field";
    dFormField.layoutMode = "VERTICAL";
    dFormField.primaryAxisSizingMode = "AUTO";
    dFormField.counterAxisSizingMode = "AUTO";
    dFormField.fills = [];

    const dFieldWrapper = figma.createFrame();
    dFieldWrapper.name = "field-wrapper";
    dFieldWrapper.layoutMode = "VERTICAL";
    dFieldWrapper.primaryAxisSizingMode = "AUTO";
    dFieldWrapper.counterAxisSizingMode = "AUTO";
    dFieldWrapper.fills = [];

    const dField = figma.createFrame();
    dField.name = "field";
    dField.resize(260, 44);
    dField.layoutMode = "HORIZONTAL";
    dField.primaryAxisSizingMode = "FIXED";
    dField.counterAxisSizingMode = "FIXED";
    dField.counterAxisAlignItems = "CENTER";
    dField.paddingLeft = 14; dField.paddingRight = 14;
    dField.paddingTop = 10; dField.paddingBottom = 10;
    dField.cornerRadius = defaultRadius;
    bindRadius(dField, defaultRadiusVar);
    dField.fills = [{ type: "SOLID", color: dIsDisabled ? { r: 0.96, g: 0.96, b: 0.96 } : { r: 1, g: 1, b: 1 } }];
    if (!dIsDisabled) bindFill(dField, "white", colorVarMap);
    dField.strokes = [{ type: "SOLID", color: dst.borderColor }];
    bindStroke(dField, dst.borderVar, colorVarMap);
    dField.strokeWeight = dst.strokeW;
    bindBorderWidth(dField, borderVarMap);

    const dText = figma.createText();
    if (inputStyle) {
      await dText.setTextStyleIdAsync(inputStyle.id);
    } else {
      dText.fontName = { family: "Inter", style: "Regular" };
      dText.fontSize = 14;
      dText.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
    }
    dText.characters = dIsDisabled ? "Disabled" : "Select option";
    bindFill(dText, "focus/color", colorVarMap);
    if (dIsDisabled) { dText.opacity = 0.5; bindOpacity(dText, opacityVarMapComp); }
    dField.appendChild(dText);
    dText.layoutSizingHorizontal = "FILL";

    const chevron = figma.createRectangle();
    chevron.name = "icon-chevron";
    chevron.resize(17, 10);
    chevron.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: chevronImageHash }];
    chevron.exportSettings = STANDARD_EXPORT_SETTINGS;
    if (dIsDisabled) { chevron.opacity = 0.5; bindOpacity(chevron, opacityVarMapComp); }
    dField.appendChild(chevron);

    bindCompSpacing(dField, spacingVarMap);
    dFieldWrapper.appendChild(dField);
    dField.layoutSizingHorizontal = "FILL";

    dFormField.appendChild(dFieldWrapper);
    dFieldWrapper.layoutSizingHorizontal = "FILL";

    dropComp.appendChild(dFormField);
    dFormField.layoutSizingHorizontal = "FILL";

    allDropComps.push(dropComp);
  }

  const dropSet = figma.combineAsVariants(allDropComps, frame);
  dropSet.name = "Dropdown";
  dropSet.layoutMode = "HORIZONTAL";
  dropSet.itemSpacing = 24;
  dropSet.paddingTop = 24; dropSet.paddingBottom = 24;
  dropSet.paddingLeft = 24; dropSet.paddingRight = 24;
  dropSet.primaryAxisSizingMode = "AUTO";
  dropSet.counterAxisSizingMode = "AUTO";
  dropSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  bindFill(dropSet, "white", colorVarMap);
  dropSet.cornerRadius = 12;
  bindRadiusByValue(dropSet, radiusVarByValue);
  dropSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  dropSet.strokeWeight = 1;
  bindBorderWidth(dropSet, borderVarMap);
  bindCompSpacing(dropSet, spacingVarMap);
  for (let dvi = 0; dvi < dropSet.children.length; dvi++) {
    dropSet.children[dvi].layoutSizingHorizontal = "FILL";
  }
  dropSet.layoutSizingHorizontal = "FILL";

  // ══════════════════════════════════════════════════════════════════════════
  // IMAGE WRAPPERS (component set with Radius property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle(frame, "Images");

  const radiusVarMap = {};
  if (radiusCol) {
    const allRadiusVars = allVars.filter(function(v) {
      return v.variableCollectionId === radiusCol.id && v.resolvedType === "FLOAT";
    });
    for (let rvi2 = 0; rvi2 < allRadiusVars.length; rvi2++) {
      const rv = allRadiusVars[rvi2];
      const rvName = rv.name.split("/").pop();
      radiusVarMap[rvName] = rv;
    }
  }

  const imgRadii = [];
  const usedRadiusNames = {};
  for (const rvk in radiusVarMap) {
    if (radiusVarMap.hasOwnProperty(rvk)) {
      let rvVal = 0;
      try {
        const rModeId = radiusCol.modes[0].modeId;
        rvVal = parseFloat(radiusVarMap[rvk].valuesByMode[rModeId]) || 0;
      } catch(e) {}
      imgRadii.push({ label: rvk, value: rvVal, variable: radiusVarMap[rvk] });
      usedRadiusNames[rvk] = true;
    }
  }
  // Always add a "full" (circle) variant
  imgRadii.push({ label: "full", value: 9999, variable: null });

  const placeholderHash = createPlaceholderImageHash(0xE8, 0xEB, 0xED);
  const IMG_W = 240, IMG_H = 160;

  const allImgComps = [];
  for (let imri = 0; imri < imgRadii.length; imri++) {
    const imgR = imgRadii[imri];

    const isFull = imgR.label === "full";
    const compW2 = isFull ? IMG_H : IMG_W;
    const compH = IMG_H;

    const imgComp = figma.createComponent();
    imgComp.name = "Radius=" + imgR.label;
    imgComp.resize(compW2, compH);
    imgComp.clipsContent = true;
    imgComp.fills = [];

    const appliedR = isFull ? compH / 2 : imgR.value;
    imgComp.cornerRadius = appliedR;

    if (imgR.variable) {
      try {
        imgComp.setBoundVariable("topLeftRadius", imgR.variable);
        imgComp.setBoundVariable("topRightRadius", imgR.variable);
        imgComp.setBoundVariable("bottomLeftRadius", imgR.variable);
        imgComp.setBoundVariable("bottomRightRadius", imgR.variable);
      } catch(e) {}
    }

    const imgRect = figma.createRectangle();
    imgRect.name = "image";
    imgRect.resize(compW2, compH);
    imgRect.x = 0; imgRect.y = 0;
    imgRect.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
    imgRect.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    imgRect.exportSettings = STANDARD_EXPORT_SETTINGS;
    imgComp.appendChild(imgRect);

    allImgComps.push(imgComp);
  }

  if (allImgComps.length > 0) {
    const imgSet = figma.combineAsVariants(allImgComps, frame);
    imgSet.name = "Image";
    imgSet.layoutMode = "HORIZONTAL";
    imgSet.itemSpacing = 24;
    imgSet.paddingTop = 24; imgSet.paddingBottom = 24;
    imgSet.paddingLeft = 24; imgSet.paddingRight = 24;
    imgSet.primaryAxisSizingMode = "AUTO";
    imgSet.counterAxisSizingMode = "AUTO";
    imgSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    bindFill(imgSet, "white", colorVarMap);
    imgSet.cornerRadius = 12;
    bindRadiusByValue(imgSet, radiusVarByValue);
    imgSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    imgSet.strokeWeight = 1;
    bindBorderWidth(imgSet, borderVarMap);
    bindCompSpacing(imgSet, spacingVarMap);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BACKGROUND IMAGE COMPONENT
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle(frame, "Background Image");

  const bgImgPlaceholder2 = createPlaceholderImageHash(0xCC, 0xCF, 0xD2);
  const bgImgComp = figma.createComponent();
  bgImgComp.name = "Background Image";
  bgImgComp.setPluginData("role", "background-image");
  bgImgComp.resize(400, 300);
  bgImgComp.clipsContent = true;
  bgImgComp.fills = [{ type: "IMAGE", imageHash: bgImgPlaceholder2, scaleMode: "FILL" }];
  bgImgComp.exportSettings = [
    { format: "PNG", suffix: "", constraint: { type: "SCALE", value: 1 } },
    { format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } }
  ];

  frame.appendChild(bgImgComp);
}
