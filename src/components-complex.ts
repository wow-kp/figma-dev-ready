// components-complex.ts — Complex Components page generator (reads directly from Figma variables)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, createPlaceholderImageHash, cxResolveVar, cxColorToHex, cxFindCol, cxGetFloats } from './utils';

export async function generateComponentsPageComplex() {
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
  frame.layoutMode = "VERTICAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "FIXED";
  frame.resize(W, 100);
  frame.paddingTop = PAD; frame.paddingBottom = PAD;
  frame.paddingLeft = PAD; frame.paddingRight = PAD;
  frame.itemSpacing = 24;
  page.appendChild(frame);

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
    createSpecText(frame, title, 0, 0, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 });
    var div = figma.createRectangle();
    div.resize(100, 1);
    div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
    frame.appendChild(div);
    div.layoutSizingHorizontal = "FILL";
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

    var typeSet = figma.combineAsVariants(typeComps, frame);
    typeSet.name = "Input / " + itype.type;
    typeSet.layoutMode = "HORIZONTAL";
    typeSet.itemSpacing = 24;
    typeSet.paddingTop = 24; typeSet.paddingBottom = 24;
    typeSet.paddingLeft = 24; typeSet.paddingRight = 24;
    typeSet.primaryAxisSizingMode = "AUTO";
    typeSet.counterAxisSizingMode = "AUTO";
    typeSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    typeSet.cornerRadius = 12;
    typeSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    typeSet.strokeWeight = 1;
    bindCompSpacing(typeSet);
    for (var vi = 0; vi < typeSet.children.length; vi++) {
      typeSet.children[vi].layoutSizingHorizontal = "FILL";
    }
    typeSet.layoutSizingHorizontal = "FILL";
  }

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
  }

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
  dropSet.layoutMode = "HORIZONTAL";
  dropSet.itemSpacing = 24;
  dropSet.paddingTop = 24; dropSet.paddingBottom = 24;
  dropSet.paddingLeft = 24; dropSet.paddingRight = 24;
  dropSet.primaryAxisSizingMode = "AUTO";
  dropSet.counterAxisSizingMode = "AUTO";
  dropSet.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  dropSet.cornerRadius = 12;
  dropSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  dropSet.strokeWeight = 1;
  bindCompSpacing(dropSet);
  for (var dvi = 0; dvi < dropSet.children.length; dvi++) {
    dropSet.children[dvi].layoutSizingHorizontal = "FILL";
  }
  dropSet.layoutSizingHorizontal = "FILL";

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
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BACKGROUND IMAGE COMPONENT
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Background Image");

  var bgImgPlaceholder2 = createPlaceholderImageHash(0xCC, 0xCF, 0xD2);
  var bgImgComp = figma.createComponent();
  bgImgComp.name = "Background Image";
  bgImgComp.setPluginData("role", "background-image");
  bgImgComp.resize(400, 300);
  bgImgComp.clipsContent = true;
  bgImgComp.fills = [{ type: "IMAGE", imageHash: bgImgPlaceholder2, scaleMode: "FILL" }];

  frame.appendChild(bgImgComp);
}
