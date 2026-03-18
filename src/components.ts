// components.ts — Components page generator (simple / msg-based)
import { findPageByHint, hexToFigma, createSpecText, loadFontWithFallback, createPlaceholderImageHash, cxResolveVar } from './utils';
import { DESKTOP_WIDTH, PAGE_PADDING, STANDARD_EXPORT_SETTINGS } from './constants';

export async function generateComponentsPage(msg) {
  var page = findPageByHint("components");
  if (!page) return;
  figma.currentPage = page;

  var compWeights = [400, 500, 600, 700];
  for (var cw = 0; cw < compWeights.length; cw++) {
    await loadFontWithFallback("Inter", compWeights[cw]);
  }

  var fontFamilies = msg.fontFamilies || {};
  var userFonts = [fontFamilies.primary, fontFamilies.secondary, fontFamilies.tertiary].filter(Boolean);
  for (var fi = 0; fi < userFonts.length; fi++) {
    var fam = userFonts[fi].split(",")[0].trim().replace(/['"]/g, "");
    if (fam === "Inter") continue;
    for (var cwi = 0; cwi < compWeights.length; cwi++) {
      await loadFontWithFallback(fam, compWeights[cwi]);
    }
  }

  // Remove existing specimens
  var existing = page.children.filter(function(n) { return n.name === "Components"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  var W = DESKTOP_WIDTH, PAD = PAGE_PADDING, SECTION_GAP = 80;
  var frame = figma.createFrame();
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
  // Note: bindCompSpacing(frame) called after helpers are defined (see below)

  var brandColor = hexToFigma(msg.brandColor || "#3B82F6");

  // ── Look up color variables for binding ──
  var colorCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name === "Colors"; });
  var colorVarMap = {};
  if (colorCols.length > 0) {
    var colorVars = figma.variables.getLocalVariables().filter(function(v) {
      return v.variableCollectionId === colorCols[0].id && v.resolvedType === "COLOR";
    });
    for (var cvi = 0; cvi < colorVars.length; cvi++) {
      colorVarMap[colorVars[cvi].name] = colorVars[cvi];
    }
  }
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

  // Find text styles by group/name
  var localStyles = figma.getLocalTextStyles();
  function findStyle(group, name) {
    var styleName = group + "/" + name;
    for (var i = 0; i < localStyles.length; i++) {
      if (localStyles[i].name === styleName) return localStyles[i];
    }
    return null;
  }

  // Get radius value and variable
  var radiusData = msg.radius || [];
  var defaultRadius = 8;
  for (var ri = 0; ri < radiusData.length; ri++) {
    if (radiusData[ri].name === "md" || radiusData[ri].name === "default") {
      defaultRadius = parseFloat(radiusData[ri].value) || 8;
      break;
    }
  }
  var radiusCols2 = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("radius") !== -1; });
  var defaultRadiusVar = null;
  if (radiusCols2.length > 0) {
    var rvars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === radiusCols2[0].id && v.resolvedType === "FLOAT"; });
    for (var rvi = 0; rvi < rvars.length; rvi++) {
      var rvn = rvars[rvi].name.split("/").pop();
      if (rvn === "md" || rvn === "default") { defaultRadiusVar = rvars[rvi]; break; }
    }
  }
  function bindRadius(node) {
    if (!defaultRadiusVar) return;
    try { node.setBoundVariable("cornerRadius", defaultRadiusVar); } catch(e) {}
  }

  // ── Look up spacing variables for binding ──
  var spacingCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("spacing") !== -1; });
  var spacingVarMapComp = {};
  if (spacingCols.length > 0) {
    var spVars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === spacingCols[0].id && v.resolvedType === "FLOAT"; });
    var allColsBasic = figma.variables.getLocalVariableCollections();
    for (var svi = 0; svi < spVars.length; svi++) {
      var spv = spVars[svi];
      var modeId = spacingCols[0].modes[0].modeId;
      try {
        var val = spv.valuesByMode[modeId];
        if (val && typeof val === "object" && val.type === "VARIABLE_ALIAS") {
          val = cxResolveVar(spv, modeId, allColsBasic);
        }
        if (typeof val === "number") spacingVarMapComp[val] = spv;
      } catch(e) {}
    }
  }
  function bindCompSpacing(frame) {
    var props = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing","counterAxisSpacing"];
    for (var pi = 0; pi < props.length; pi++) {
      var prop = props[pi];
      if (!(prop in frame)) continue;
      var val = frame[prop];
      if (val === undefined || val === null) continue;
      var sv = spacingVarMapComp[val];
      if (sv) { try { frame.setBoundVariable(prop, sv); } catch(e) {} }
    }
  }

  // ── Look up border width variables for binding ──
  var borderCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("border") !== -1 && c.name.toLowerCase().indexOf("width") !== -1; });
  var borderVarMapComp = {};
  if (borderCols.length > 0) {
    var bwVars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === borderCols[0].id && v.resolvedType === "FLOAT"; });
    var allColsBw = figma.variables.getLocalVariableCollections();
    var bwModeId = borderCols[0].modes[0].modeId;
    for (var bwi = 0; bwi < bwVars.length; bwi++) {
      try {
        var bwVal = bwVars[bwi].valuesByMode[bwModeId];
        if (bwVal && typeof bwVal === "object" && bwVal.type === "VARIABLE_ALIAS") {
          bwVal = cxResolveVar(bwVars[bwi], bwModeId, allColsBw);
        }
        if (typeof bwVal === "number") borderVarMapComp[bwVal] = bwVars[bwi];
      } catch(e) {}
    }
  }
  function bindBorderWidth(node) {
    if (!("strokeWeight" in node)) return;
    var val = node.strokeWeight;
    if (val === undefined || val === null || typeof val !== "number") return;
    var bv = borderVarMapComp[val];
    if (bv) { try { node.setBoundVariable("strokeWeight", bv); } catch(e) {} }
  }

  // ── Look up radius variables by value for binding ──
  var radiusVarByValueComp = {};
  if (radiusCols2.length > 0) {
    var rvars2 = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === radiusCols2[0].id && v.resolvedType === "FLOAT"; });
    var allColsRv = figma.variables.getLocalVariableCollections();
    var rvModeId = radiusCols2[0].modes[0].modeId;
    for (var rvi2 = 0; rvi2 < rvars2.length; rvi2++) {
      try {
        var rvv = rvars2[rvi2].valuesByMode[rvModeId];
        if (rvv && typeof rvv === "object" && rvv.type === "VARIABLE_ALIAS") {
          rvv = cxResolveVar(rvars2[rvi2], rvModeId, allColsRv);
        }
        if (typeof rvv === "number") radiusVarByValueComp[rvv] = rvars2[rvi2];
      } catch(e) {}
    }
  }
  function bindRadiusByValue(node) {
    if (!("cornerRadius" in node)) return;
    var val = node.cornerRadius;
    if (val === undefined || val === null || typeof val !== "number") return;
    var rv = radiusVarByValueComp[val];
    if (rv) { try { node.setBoundVariable("cornerRadius", rv); } catch(e) {} }
  }

  // ── Look up opacity variables for binding ──
  var opacityCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name.toLowerCase().indexOf("opacity") !== -1; });
  var opacityVarMapComp = {};
  var opacityColIdComp = null;
  var opacityPctModeIdComp = null;  // Percentage mode for Figma "Opacity" binding
  if (opacityCols.length > 0) {
    opacityColIdComp = opacityCols[0].id;
    var opModesComp = opacityCols[0].modes || [];
    for (var omi = 0; omi < opModesComp.length; omi++) {
      if (opModesComp[omi].name === "Percentage") { opacityPctModeIdComp = opModesComp[omi].modeId; break; }
    }
    var opVars = figma.variables.getLocalVariables().filter(function(v) { return v.variableCollectionId === opacityCols[0].id && v.resolvedType === "FLOAT"; });
    var opModeId = opacityCols[0].modes[0].modeId;
    var allColsBasicOp = figma.variables.getLocalVariableCollections();
    for (var opi = 0; opi < opVars.length; opi++) {
      try {
        var opVal = cxResolveVar(opVars[opi], opModeId, allColsBasicOp);
        if (typeof opVal === "number") opacityVarMapComp[Math.round(opVal * 100)] = opVars[opi];
      } catch(e) {}
    }
  }
  function bindOpacity(node) {
    if (!("opacity" in node)) return;
    var pct = Math.round(node.opacity * 100);
    var ov = opacityVarMapComp[pct];
    if (ov) { try { node.setBoundVariable("opacity", ov); } catch(e) {} }
  }
  // Figma's "Opacity" property uses percentage values — set Percentage mode on main frame
  if (opacityColIdComp && opacityPctModeIdComp) {
    try { frame.setExplicitVariableModeForCollection(opacityColIdComp, opacityPctModeIdComp); } catch(e) {}
  }

  // Bind the main frame spacing now that helpers are defined
  bindCompSpacing(frame);

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
  for (var bvi = 0; bvi < btnVariants.length; bvi++) {
    var variant = btnVariants[bvi];
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
        bindBorderWidth(btnComp);
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
  bindFill(btnSet, "white");
  btnSet.cornerRadius = 12;
  bindRadiusByValue(btnSet);
  btnSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  btnSet.strokeWeight = 1;
  bindBorderWidth(btnSet);
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

        // Input field — the styled element with border, bg, radius
        var field;
        if (isDefault) {
          // Default state: no children, use a rectangle
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
          bindBorderWidth(field);
        } else {
          // Non-default states: frame with value text inside
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
          bindBorderWidth(field);

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

        // Label — absolutely positioned over the field
        var floatLbl = figma.createText();
        if (isDefault) {
          // Default: label looks like a placeholder, uses input font size
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
          // Focused/Error/Disabled: small label at top
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
        bindBorderWidth(inputField);
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
        bindBorderWidth(inputField2);
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
    bindFill(typeSet, "white");
    typeSet.cornerRadius = 12;
    bindRadiusByValue(typeSet);
    typeSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    typeSet.strokeWeight = 1;
    bindBorderWidth(typeSet);
    // Make each variant fill equally
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
    bindFill(lblSet, "white");
    lblSet.cornerRadius = 12;
    bindRadiusByValue(lblSet);
    lblSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    lblSet.strokeWeight = 1;
    bindBorderWidth(lblSet);
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

    // form-field wrapper
    var dFormField = figma.createFrame();
    dFormField.name = "form-field";
    dFormField.layoutMode = "VERTICAL";
    dFormField.primaryAxisSizingMode = "AUTO";
    dFormField.counterAxisSizingMode = "AUTO";
    dFormField.fills = [];

    // field-wrapper
    var dFieldWrapper = figma.createFrame();
    dFieldWrapper.name = "field-wrapper";
    dFieldWrapper.layoutMode = "VERTICAL";
    dFieldWrapper.primaryAxisSizingMode = "AUTO";
    dFieldWrapper.counterAxisSizingMode = "AUTO";
    dFieldWrapper.fills = [];

    // field — the styled select element
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
    bindBorderWidth(dField);

    // Select text (placeholder)
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

    // Chevron arrow (base64 PNG)
    var chevron = figma.createRectangle();
    chevron.name = "chevron";
    chevron.resize(17, 10);
    chevron.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: chevronImageHash }];
    chevron.exportSettings = STANDARD_EXPORT_SETTINGS;
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
  bindFill(dropSet, "white");
  dropSet.cornerRadius = 12;
  bindRadiusByValue(dropSet);
  dropSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
  dropSet.strokeWeight = 1;
  bindBorderWidth(dropSet);
  bindCompSpacing(dropSet);
  for (var dvi = 0; dvi < dropSet.children.length; dvi++) {
    dropSet.children[dvi].layoutSizingHorizontal = "FILL";
  }
  dropSet.layoutSizingHorizontal = "FILL";

  // ══════════════════════════════════════════════════════════════════════════
  // IMAGE WRAPPERS (component set with Radius property)
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Images");

  // Look up the Radius variable collection and build a name→variable map
  var radiusCols = figma.variables.getLocalVariableCollections().filter(function(c) {
    return c.name.toLowerCase().indexOf("radius") !== -1;
  });
  var radiusVarMap = {};
  if (radiusCols.length > 0) {
    var radiusCol = radiusCols[0];
    var allRadiusVars = figma.variables.getLocalVariables().filter(function(v) {
      return v.variableCollectionId === radiusCol.id && v.resolvedType === "FLOAT";
    });
    for (var rvi = 0; rvi < allRadiusVars.length; rvi++) {
      var rv = allRadiusVars[rvi];
      // Use the last segment of the variable name as key (e.g. "radius/sm" → "sm")
      var rvName = rv.name.split("/").pop();
      radiusVarMap[rvName] = rv;
    }
  }

  // Build radius entries from the variable map, falling back to radiusData config
  var imgRadii = [];
  var usedRadiusNames = {};
  // Prefer variables (they carry the binding)
  for (var rvk in radiusVarMap) {
    if (radiusVarMap.hasOwnProperty(rvk)) {
      var rvVal = 0;
      try {
        var modeId = radiusCols[0].modes[0].modeId;
        rvVal = parseFloat(radiusVarMap[rvk].valuesByMode[modeId]) || 0;
      } catch(e) {}
      imgRadii.push({ label: rvk, value: rvVal, variable: radiusVarMap[rvk] });
      usedRadiusNames[rvk] = true;
    }
  }
  // Fill in any from config that aren't already covered
  if (imgRadii.length === 0) {
    for (var iri = 0; iri < radiusData.length; iri++) {
      if (!usedRadiusNames[radiusData[iri].name]) {
        imgRadii.push({ label: radiusData[iri].name, value: parseFloat(radiusData[iri].value) || 0, variable: null });
      }
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
    var compW = isFull ? IMG_H : IMG_W; // square for "full" so it's a perfect circle
    var compH = IMG_H;

    var imgComp = figma.createComponent();
    imgComp.name = "Radius=" + imgR.label;
    imgComp.resize(compW, compH);
    imgComp.clipsContent = true;
    imgComp.fills = [];

    var appliedR = isFull ? compH / 2 : imgR.value;
    imgComp.cornerRadius = appliedR;

    // Bind corner radius to the Figma variable if available
    if (imgR.variable) {
      try {
        imgComp.setBoundVariable("topLeftRadius", imgR.variable);
        imgComp.setBoundVariable("topRightRadius", imgR.variable);
        imgComp.setBoundVariable("bottomLeftRadius", imgR.variable);
        imgComp.setBoundVariable("bottomRightRadius", imgR.variable);
      } catch(e) {}
    }

    // Child rectangle with placeholder image — user replaces the image fill
    var imgRect = figma.createRectangle();
    imgRect.name = "image";
    imgRect.resize(compW, compH);
    imgRect.x = 0; imgRect.y = 0;
    imgRect.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
    imgRect.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    imgRect.exportSettings = STANDARD_EXPORT_SETTINGS;
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
    bindFill(imgSet, "white");
    imgSet.cornerRadius = 12;
    bindRadiusByValue(imgSet);
    imgSet.strokes = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.06 }];
    imgSet.strokeWeight = 1;
    bindBorderWidth(imgSet);
    bindCompSpacing(imgSet);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BACKGROUND IMAGE COMPONENT
  // ══════════════════════════════════════════════════════════════════════════
  sectionTitle("Background Image");

  var bgImgPlaceholder = createPlaceholderImageHash(0xCC, 0xCF, 0xD2);
  var bgImgComp = figma.createComponent();
  bgImgComp.name = "Background Image";
  bgImgComp.setPluginData("role", "background-image");
  bgImgComp.resize(400, 300);
  bgImgComp.clipsContent = true;
  bgImgComp.fills = [{ type: "IMAGE", imageHash: bgImgPlaceholder, scaleMode: "FILL" }];
  bgImgComp.exportSettings = [
    { format: "PNG", suffix: "", constraint: { type: "SCALE", value: 1 } },
    { format: "PNG", suffix: "@2x", constraint: { type: "SCALE", value: 2 } }
  ];

  frame.appendChild(bgImgComp);
}
