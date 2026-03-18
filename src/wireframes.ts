// Promo wireframe generation
import { hexToFigma, findPageByHint, loadFontWithFallback, createPlaceholderImageHash, cxResolveVar, cxFindCol } from './utils';
import { findNearestColorVar } from './audit';
import { MOBILE_BREAKPOINT, STANDARD_EXPORT_SETTINGS } from './constants';

export async function generatePromoStructure(msg) {
  var sections = msg.sections || {};
  var popupIncludeForm = msg.popupIncludeForm !== false;
  var brandHex = msg.brandColor || "#3B82F6";
  var textHex = msg.textColor || "#1A1A1A";
  var brandFigma = hexToFigma(brandHex);
  var textFigma = hexToFigma(textHex);
  var radiusData = msg.radius || [];
  var defaultRadius = 8;
  for (var dri = 0; dri < radiusData.length; dri++) {
    if (radiusData[dri].name === "md" || radiusData[dri].name === "default") {
      defaultRadius = parseFloat(radiusData[dri].value) || 8; break;
    }
  }

  var preloadWeights = [400, 500, 600, 700];
  for (var pw = 0; pw < preloadWeights.length; pw++) {
    await loadFontWithFallback("Inter", preloadWeights[pw]);
  }

  // Placeholder image for backgrounds (light gray)
  var placeholderHash = createPlaceholderImageHash(0xCC, 0xCF, 0xD2);
  // Placeholder image for content images (darker, visible on any background)
  var contentImageHash = createPlaceholderImageHash(0x8A, 0x8F, 0x99);

  // Close button image
  var closeImageHash = figma.createImage(
    figma.base64Decode("iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAYAAAByUDbMAAABQUlEQVQ4jZ3UvUtcQRQF8J+IIAqWFoqdGxXbkMIU/h9WGgI2ESxstbNUxM5K0oiNiBYimCatGAjb+C0EQUIUMYUIWqwMvIXHOG/3rQduc+aeM3Pv3Jl2fMUyPuESd8qjD/OYQ1cgfqOWxX2WUBZ7Oe1xINZyRIgqRkoYrUa6rUBWcBItPOBLgUlvIj/EZNGR6zEeGVVwFOXc4mO8Yz82E4aL2fpAJqzl4gofGvViNmE4hbOIu0Fnid4mDfOx3exEMRbwFJk84od34lei2cOtmvRl8/acKPFPg7F5gzbsN+lZDZ/LmFUj0Tkm8L3glgtL24mS/6K7wUb/MRobdeBnlPgPQ4kWLCWe3lg9IQguErc2qBgriZLDV2YjIsM4hDfYDDOR7iCQp1Fp4Vcoi2857Vk7XtCDXUzjugWzw6wloZfrr6cznFx8NDn5AAAAAElFTkSuQmCC")
  ).hash;

  // Look up overlay variable for popup-overlay background
  var overlayVar = null;
  var allColorVars = figma.variables.getLocalVariables().filter(function(v) { return v.resolvedType === "COLOR"; });
  for (var ovi = 0; ovi < allColorVars.length; ovi++) {
    var ovName = allColorVars[ovi].name.toLowerCase();
    if (ovName.indexOf("overlay") !== -1 || ovName.indexOf("scrim") !== -1) {
      overlayVar = allColorVars[ovi]; break;
    }
  }

  // Look up shadow effect styles for binding
  var promoEffectStyles = figma.getLocalEffectStyles();
  var promoShadowStyle = null;
  for (var esi = 0; esi < promoEffectStyles.length; esi++) {
    var esName = promoEffectStyles[esi].name.toLowerCase();
    if (esName.indexOf("shadow") !== -1 && (esName.indexOf("default") !== -1 || esName.indexOf("md") !== -1)) {
      promoShadowStyle = promoEffectStyles[esi]; break;
    }
  }
  // Fallback: use any shadow style
  if (!promoShadowStyle) {
    for (var esi2 = 0; esi2 < promoEffectStyles.length; esi2++) {
      if (promoEffectStyles[esi2].name.toLowerCase().indexOf("shadow") !== -1) {
        promoShadowStyle = promoEffectStyles[esi2]; break;
      }
    }
  }
  function applyPromoShadow(node) {
    if (!promoShadowStyle) return;
    try { node.effectStyleId = promoShadowStyle.id; } catch(e) {}
  }

  // Look up spacing, radius & opacity variables for binding
  var spacingVarMap = {};
  var radiusVarMap = {};
  var opacityVarMap = {};
  var borderWidthVarMap = {};
  var opacityColId = null;
  var opacityValueModeId = null;   // decimal 0-1 (for resolving / CSS)
  var opacityPctModeId = null;     // percentage 0-100 (for Figma "Opacity" binding)
  var allFloatVars = figma.variables.getLocalVariables().filter(function(v) { return v.resolvedType === "FLOAT"; });
  var allColls = figma.variables.getLocalVariableCollections();
  for (var fvi = 0; fvi < allFloatVars.length; fvi++) {
    var fv = allFloatVars[fvi];
    var collName = "";
    for (var fci = 0; fci < allColls.length; fci++) {
      if (allColls[fci].id === fv.variableCollectionId) { collName = allColls[fci].name.toLowerCase(); break; }
    }
    var shortName = fv.name.split("/").pop();
    if (collName.indexOf("spacing") !== -1 || collName.indexOf("gap") !== -1) {
      spacingVarMap[shortName] = fv;
    } else if (collName.indexOf("opacity") !== -1) {
      // Save collection info for explicit mode binding
      if (!opacityColId) {
        for (var oci2 = 0; oci2 < allColls.length; oci2++) {
          if (allColls[oci2].id === fv.variableCollectionId) {
            opacityColId = allColls[oci2].id;
            var opModes = allColls[oci2].modes || [];
            if (opModes.length) opacityValueModeId = opModes[0].modeId;
            for (var omi = 0; omi < opModes.length; omi++) {
              if (opModes[omi].name === "Percentage") { opacityPctModeId = opModes[omi].modeId; break; }
            }
            break;
          }
        }
      }
      var opModeId2 = null;
      for (var oci = 0; oci < allColls.length; oci++) { if (allColls[oci].id === fv.variableCollectionId) { if (allColls[oci].modes && allColls[oci].modes.length) { opModeId2 = allColls[oci].modes[0].modeId; } break; } }
      if (opModeId2) { try { var opVal2 = cxResolveVar(fv, opModeId2, allColls); if (typeof opVal2 === "number") opacityVarMap[Math.round(opVal2 * 100)] = fv; } catch(e) {} }
    } else if (collName.indexOf("radius") !== -1 || collName.indexOf("corner") !== -1) {
      radiusVarMap[shortName] = fv;
    } else if (collName.indexOf("border") !== -1 && collName.indexOf("width") !== -1) {
      // Build border width variable map by resolved value
      var bwModeIdW = null;
      for (var bwci = 0; bwci < allColls.length; bwci++) { if (allColls[bwci].id === fv.variableCollectionId && allColls[bwci].modes && allColls[bwci].modes.length) { bwModeIdW = allColls[bwci].modes[0].modeId; break; } }
      if (bwModeIdW) { try { var bwv = cxResolveVar(fv, bwModeIdW, allColls); if (typeof bwv === "number") borderWidthVarMap[bwv] = fv; } catch(e) {} }
    }
  }

  // Helper: find best spacing variable for a target px value
  function findSpacingVar(targetPx) {
    var best = null, bestDiff = Infinity;
    var spCol = null;
    for (var sci = 0; sci < allColls.length; sci++) { if (allColls[sci].name.toLowerCase().indexOf("spacing") !== -1) { spCol = allColls[sci]; break; } }
    if (!spCol || !spCol.modes || !spCol.modes.length) return null;
    var spModeId = spCol.modes[0].modeId;
    for (var sk in spacingVarMap) {
      if (!spacingVarMap.hasOwnProperty(sk)) continue;
      var val = 0;
      try {
        val = cxResolveVar(spacingVarMap[sk], spModeId, allColls);
        if (typeof val !== "number") val = parseFloat(val) || 0;
      } catch(e) {}
      var diff = Math.abs(val - targetPx);
      if (diff < bestDiff) { bestDiff = diff; best = spacingVarMap[sk]; }
    }
    return bestDiff <= 4 ? best : null; // only use if within 4px
  }

  // Helper: find radius variable by name or closest value
  function findRadiusVar(name) {
    if (radiusVarMap[name]) return radiusVarMap[name];
    return null;
  }

  // Helper: bind opacity to variable
  function bindPromoOpacity(node) {
    if (!("opacity" in node)) return;
    var pct = Math.round(node.opacity * 100);
    var ov = opacityVarMap[pct];
    if (ov) { try { node.setBoundVariable("opacity", ov); } catch(e) {} }
  }

  // Look up grid column span variables (grid/col-1 through grid/col-12)
  var gridColVarMap = {};
  for (var gvi = 0; gvi < allFloatVars.length; gvi++) {
    var gv = allFloatVars[gvi];
    var gCollName = "";
    for (var gci = 0; gci < allColls.length; gci++) {
      if (allColls[gci].id === gv.variableCollectionId) { gCollName = allColls[gci].name.toLowerCase(); break; }
    }
    if (gCollName === "grid" && gv.name.indexOf("grid/col-") === 0) {
      var spanNum = parseInt(gv.name.replace("grid/col-", ""));
      if (spanNum >= 1 && spanNum <= 12) gridColVarMap[spanNum] = gv;
    }
  }
  // Also look up grid/gutter variable for form row gap binding
  var gridGutterVar = null;
  for (var ggi = 0; ggi < allFloatVars.length; ggi++) {
    var ggv = allFloatVars[ggi];
    var ggCollName = "";
    for (var ggci = 0; ggci < allColls.length; ggci++) {
      if (allColls[ggci].id === ggv.variableCollectionId) { ggCollName = allColls[ggci].name.toLowerCase(); break; }
    }
    if (ggCollName === "grid" && ggv.name === "grid/gutter") { gridGutterVar = ggv; break; }
  }

  // Helper: bind separate horizontal/vertical padding to spacing variables
  function bindPaddingXY(frame, padXPx, padYPx) {
    frame.paddingLeft = padXPx; frame.paddingRight = padXPx;
    frame.paddingTop = padYPx; frame.paddingBottom = padYPx;
    var xVar = findSpacingVar(padXPx);
    var yVar = findSpacingVar(padYPx);
    if (xVar) {
      try {
        frame.setBoundVariable("paddingLeft", xVar);
        frame.setBoundVariable("paddingRight", xVar);
      } catch(e) {}
    }
    if (yVar) {
      try {
        frame.setBoundVariable("paddingTop", yVar);
        frame.setBoundVariable("paddingBottom", yVar);
      } catch(e) {}
    }
  }

  // Helper: bind padding and gap to spacing variables on an auto-layout frame
  function bindSpacing(frame, padPx, gapPx) {
    var padVar = findSpacingVar(padPx);
    var gapVar = findSpacingVar(gapPx);
    if (padVar) {
      try {
        frame.setBoundVariable("paddingLeft", padVar);
        frame.setBoundVariable("paddingRight", padVar);
        frame.setBoundVariable("paddingTop", padVar);
        frame.setBoundVariable("paddingBottom", padVar);
      } catch(e) {}
    }
    if (gapVar) {
      try { frame.setBoundVariable("itemSpacing", gapVar); } catch(e) {}
    }
  }

  // Helper: bind stroke weight to border width variable
  function bindBorderWidth(node) {
    if (!("strokeWeight" in node)) return;
    var val = node.strokeWeight;
    if (val === undefined || val === null || typeof val !== "number") return;
    var bv = borderWidthVarMap[val];
    if (bv) { try { node.setBoundVariable("strokeWeight", bv); } catch(e) {} }
  }

  // Helper: bind corner radius to variable
  function bindRadius(frame, radiusName) {
    var rv = findRadiusVar(radiusName);
    if (rv) {
      try { frame.setBoundVariable("cornerRadius", rv); } catch(e) {}
      try {
        frame.setBoundVariable("topLeftRadius", rv);
        frame.setBoundVariable("topRightRadius", rv);
        frame.setBoundVariable("bottomLeftRadius", rv);
        frame.setBoundVariable("bottomRightRadius", rv);
      } catch(e) {}
    }
  }

  // ── Look up text styles for wireframe text nodes ──
  var promoTextStyles = figma.getLocalTextStyles();
  function findPromoTextStyle(group, name) {
    var styleName = group + "/" + name;
    for (var i = 0; i < promoTextStyles.length; i++) {
      if (promoTextStyles[i].name === styleName) return promoTextStyles[i];
    }
    return null;
  }
  // Semantic text style lookup: heading, body, button
  var tsH1 = findPromoTextStyle("heading", "h1");
  var tsH1Mobile = findPromoTextStyle("heading", "h2") || tsH1;
  var tsBody = findPromoTextStyle("body", "default") || findPromoTextStyle("body", "lg");
  var tsBodyMobile = findPromoTextStyle("body", "sm") || tsBody;
  var tsSmall = findPromoTextStyle("body", "sm");

  // Pre-load fonts for text styles we'll use
  var tsBtnDefault = findPromoTextStyle("buttons", "default");
  var tsBtnSm = findPromoTextStyle("buttons", "sm");
  var tsLabel = findPromoTextStyle("label", "default");
  var promoTsArr = [tsH1, tsH1Mobile, tsBody, tsBodyMobile, tsSmall, tsBtnDefault, tsBtnSm, tsLabel];
  for (var ptsi = 0; ptsi < promoTsArr.length; ptsi++) {
    if (promoTsArr[ptsi]) {
      try { await figma.loadFontAsync(promoTsArr[ptsi].fontName); } catch(e) {}
    }
  }

  // ── Color variable binding helpers for wireframe ──
  var colorCols = figma.variables.getLocalVariableCollections().filter(function(c) { return c.name === "Colors"; });
  var promoColorVarMap = {};
  if (colorCols.length > 0) {
    for (var pcvi = 0; pcvi < allColorVars.length; pcvi++) {
      if (allColorVars[pcvi].variableCollectionId === colorCols[0].id) {
        promoColorVarMap[allColorVars[pcvi].name] = allColorVars[pcvi];
      }
    }
  }
  function promoBindFill(node, varName) {
    var v = promoColorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }
  function promoBindStroke(node, varName) {
    var v = promoColorVarMap[varName]; if (!v) return;
    try { node.strokes = [figma.variables.setBoundVariableForPaint(node.strokes[0], "color", v)]; } catch(e) {}
  }

  var standardExportSettings = STANDARD_EXPORT_SETTINGS;

  // ── Find component sets created on the Components page ──
  var btnVariant = null;      // Button: Variant=Primary, Size=Default
  var inputVariant = null;    // Input / Floating Label: State=Default
  var labelVariant = null;    // Label: State=Default
  var dropdownVariant = null; // Dropdown: State=Default
  var bgImageVariant = null;  // Background Image component
  var allCompSets = figma.root.findAll(function(n) { return n.type === "COMPONENT_SET"; });
  for (var csi = 0; csi < allCompSets.length; csi++) {
    var cs = allCompSets[csi];
    if (cs.name === "Button") {
      for (var vi = 0; vi < cs.children.length; vi++) {
        var vp = cs.children[vi].variantProperties;
        if (vp && vp["Variant"] === "Primary" && vp["Size"] === "Default") {
          btnVariant = cs.children[vi]; break;
        }
      }
    } else if (cs.name === "Input / Floating Label") {
      for (var ii = 0; ii < cs.children.length; ii++) {
        var ip = cs.children[ii].variantProperties;
        if (ip && ip["State"] === "Default") {
          inputVariant = cs.children[ii]; break;
        }
      }
    } else if (cs.name === "Label") {
      for (var li = 0; li < cs.children.length; li++) {
        var lp = cs.children[li].variantProperties;
        if (lp && lp["State"] === "Default") {
          labelVariant = cs.children[li]; break;
        }
      }
    } else if (cs.name === "Dropdown") {
      for (var di = 0; di < cs.children.length; di++) {
        var dp = cs.children[di].variantProperties;
        if (dp && dp["State"] === "Default") {
          dropdownVariant = cs.children[di]; break;
        }
      }
    } else if (cs.name === "Background Image") {
      // Background Image has a single variant (the component itself)
      if (cs.children.length > 0) bgImageVariant = cs.children[0];
    }
  }

  // Also search standalone components (not inside a component set) — match by pluginData or name
  if (!bgImageVariant) {
    var allComps = figma.root.findAll(function(n) { return n.type === "COMPONENT" && (!n.parent || n.parent.type !== "COMPONENT_SET"); });
    for (var sci = 0; sci < allComps.length; sci++) {
      var sc = allComps[sci];
      if (sc.getPluginData && sc.getPluginData("role") === "background-image") { bgImageVariant = sc; break; }
      if (sc.name === "Background Image") { bgImageVariant = sc; break; }
    }
  }

  var BREAKPOINTS = [
    { hint: "desktop", width: 1920 },
    { hint: "mobile",  width: MOBILE_BREAKPOINT }
  ];

  // Names of all frames we create — used for cleanup
  var PROMO_FRAME_NAMES = ["promo/hero", "promo/popup", "promo/popup-thankyou", "promo/banner"];

  for (var bi = 0; bi < BREAKPOINTS.length; bi++) {
    var bp = BREAKPOINTS[bi];
    var page = findPageByHint(bp.hint);
    if (!page) continue;
    figma.currentPage = page;

    // Remove existing promo frames and any orphaned wireframe elements
    var toRemove = page.children.filter(function(n) {
      return PROMO_FRAME_NAMES.indexOf(n.name) !== -1
        || n.name === "form-row" || n.name === "form-div"
        || n.name.indexOf("promo/") === 0
        || n.name.indexOf("input-") === 0;
    });
    toRemove.forEach(function(n) { try { n.remove(); } catch(e) {} });

    var W = bp.width;
    var isMobile = bp.hint === "mobile";
    var pageX = 0;
    var GAP = 80;

    // Track created frames so we can fix layer order at the end
    var createdFrames = [];

    // ── Helper: create a top-level section frame ──
    function createSectionFrame(name, width, height) {
      var f = figma.createFrame();
      f.name = name;
      f.resize(width, height);
      f.x = pageX; f.y = 0;
      f.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(f, "white");
      f.clipsContent = true;
      // Set constraints so frame scales horizontally
      try { f.constraints = { horizontal: "SCALE", vertical: "MIN" }; } catch(e) {}
      // Figma's "Opacity" property uses percentage values (0-100), so set Percentage mode
      if (opacityColId && opacityPctModeId) {
        try { f.setExplicitVariableModeForCollection(opacityColId, opacityPctModeId); } catch(e) {}
      }
      page.appendChild(f);
      createdFrames.push(f);
      return f;
    }

    // ── Helper: create a CTA using Button component instance ──
    async function createCta(parent, text) {
      if (btnVariant) {
        var inst = null;
        try {
          inst = btnVariant.createInstance();
          var txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
          if (txtNodes.length > 0) {
            await figma.loadFontAsync(txtNodes[0].fontName);
            txtNodes[0].characters = text;
          }
          parent.appendChild(inst);
          return inst;
        } catch(e) {
          if (inst) try { inst.remove(); } catch(e2) {}
        }
      }
      // Fallback if component not found
      var btn = figma.createFrame();
      btn.name = "cta-button";
      btn.cornerRadius = defaultRadius;
      bindRadius(btn, "md");
      btn.fills = [{ type: "SOLID", color: brandFigma }];
      btn.layoutMode = "HORIZONTAL";
      btn.primaryAxisAlignItems = "CENTER";
      btn.counterAxisAlignItems = "CENTER";
      btn.primaryAxisSizingMode = "AUTO";
      btn.counterAxisSizingMode = "AUTO";
      var btnPadH = isMobile ? 20 : 28;
      var btnPadV = isMobile ? 10 : 14;
      btn.paddingLeft = btnPadH; btn.paddingRight = btnPadH;
      btn.paddingTop = btnPadV; btn.paddingBottom = btnPadV;
      var btnPadHVar = findSpacingVar(btnPadH);
      if (btnPadHVar) {
        try { btn.setBoundVariable("paddingLeft", btnPadHVar); btn.setBoundVariable("paddingRight", btnPadHVar); } catch(e) {}
      }
      var btnPadVVar = findSpacingVar(btnPadV);
      if (btnPadVVar) {
        try { btn.setBoundVariable("paddingTop", btnPadVVar); btn.setBoundVariable("paddingBottom", btnPadVVar); } catch(e) {}
      }
      var txt = figma.createText();
      var btnTxtStyle = findPromoTextStyle("buttons", isMobile ? "sm" : "default");
      if (btnTxtStyle) {
        txt.textStyleId = btnTxtStyle.id;
      } else {
        txt.fontName = { family: "Inter", style: "Semi Bold" };
        txt.fontSize = isMobile ? 14 : 16;
      }
      txt.characters = text;
      txt.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(txt, "white");
      btn.fills = [{ type: "SOLID", color: brandFigma }];
      promoBindFill(btn, "brand/primary");
      btn.appendChild(txt);
      parent.appendChild(btn);
      return btn;
    }

    // ── Helper: create an Input component instance with label override ──
    async function createInput(parent, labelText) {
      if (inputVariant) {
        var inst = null;
        try {
          inst = inputVariant.createInstance();
          var txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
          for (var ti = 0; ti < txtNodes.length; ti++) {
            await figma.loadFontAsync(txtNodes[ti].fontName);
          }
          if (txtNodes.length > 0) txtNodes[0].characters = labelText;
          parent.appendChild(inst);
          inst.layoutSizingHorizontal = "FILL";
          return inst;
        } catch(e) {
          if (inst) try { inst.remove(); } catch(e2) {}
        }
      }
      // Fallback: label + field frame
      var wrapper = figma.createFrame();
      wrapper.name = "input-" + labelText.toLowerCase().replace(/\s+/g, "-");
      wrapper.layoutMode = "VERTICAL";
      wrapper.primaryAxisSizingMode = "AUTO";
      wrapper.counterAxisSizingMode = "FILL_PARENT";
      wrapper.itemSpacing = 6;
      var wrapGapVar = findSpacingVar(6);
      if (wrapGapVar) { try { wrapper.setBoundVariable("itemSpacing", wrapGapVar); } catch(e) {} }
      wrapper.fills = [];
      var lbl = figma.createText();
      var lblFbStyle = findPromoTextStyle("label", "default");
      if (lblFbStyle) {
        lbl.textStyleId = lblFbStyle.id;
      } else {
        lbl.fontName = { family: "Inter", style: "Medium" };
        lbl.fontSize = 12;
      }
      lbl.characters = labelText;
      lbl.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
      promoBindFill(lbl, "text/primary");
      wrapper.appendChild(lbl);
      var fld = figma.createFrame();
      fld.name = "field";
      fld.cornerRadius = defaultRadius;
      bindRadius(fld, "md");
      fld.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
      promoBindFill(fld, "white");
      fld.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.82 } }];
      promoBindStroke(fld, "border/default");
      fld.strokeWeight = 1;
      bindBorderWidth(fld);
      fld.layoutMode = "HORIZONTAL";
      fld.counterAxisAlignItems = "CENTER";
      fld.primaryAxisSizingMode = "AUTO";
      fld.counterAxisSizingMode = "AUTO";
      fld.paddingLeft = 14; fld.paddingRight = 14;
      fld.paddingTop = 10; fld.paddingBottom = 10;
      wrapper.appendChild(fld);
      fld.layoutSizingHorizontal = "FILL";
      parent.appendChild(wrapper);
      wrapper.layoutSizingHorizontal = "FILL";
      return wrapper;
    }

    // ── Helper: create a Dropdown component instance ──
    async function createDropdown(parent, placeholderText) {
      if (dropdownVariant) {
        var inst = null;
        try {
          inst = dropdownVariant.createInstance();
          var txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
          for (var ti = 0; ti < txtNodes.length; ti++) {
            await figma.loadFontAsync(txtNodes[ti].fontName);
          }
          if (txtNodes.length > 0) txtNodes[0].characters = placeholderText;
          parent.appendChild(inst);
          inst.layoutSizingHorizontal = "FILL";
          return inst;
        } catch(e) {
          if (inst) try { inst.remove(); } catch(e2) {}
        }
      }
      // Fallback: use createInput
      return await createInput(parent, placeholderText);
    }

    // ── Helper: apply overlay fill (with variable binding if available) ──
    function applyOverlayFill(node) {
      if (overlayVar) {
        node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
        try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", overlayVar)]; } catch(e) {
          node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.85 }];
        }
      } else {
        node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.85 }];
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 1. HERO
    // ════════════════════════════════════════════════════════════════════
    if (sections.hero) {
      var heroMinH = isMobile ? 400 : 500;
      var hero = createSectionFrame("promo/hero", W, heroMinH);
      // Auto-layout: center children both axes
      hero.layoutMode = "VERTICAL";
      hero.primaryAxisAlignItems = "CENTER";
      hero.counterAxisAlignItems = "CENTER";
      hero.primaryAxisSizingMode = "AUTO";
      hero.counterAxisSizingMode = "FIXED";
      hero.minHeight = heroMinH;
      bindPaddingXY(hero, 0, 128);

      // Background placeholder image (absolute, fills parent)
      var heroBg;
      if (bgImageVariant) {
        heroBg = bgImageVariant.createInstance();
        heroBg.name = "hero-bg-image";
        heroBg.resize(W, heroMinH);
        hero.appendChild(heroBg);
        heroBg.layoutPositioning = "ABSOLUTE";
        heroBg.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
        heroBg.x = 0; heroBg.y = 0;
      } else {
        heroBg = figma.createRectangle();
        heroBg.name = "hero-bg-image";
        heroBg.resize(W, heroMinH);
        hero.appendChild(heroBg);
        heroBg.layoutPositioning = "ABSOLUTE";
        heroBg.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
        heroBg.x = 0; heroBg.y = 0;
        heroBg.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
        heroBg.exportSettings = standardExportSettings;
      }

      // Centered content frame (auto-layout vertical, centered, fills parent width)
      var content = figma.createFrame();
      content.name = "hero-content";
      content.resize(isMobile ? W - 40 : 800, 1);
      content.fills = [];
      content.layoutMode = "VERTICAL";
      content.primaryAxisAlignItems = "CENTER";
      content.counterAxisAlignItems = "CENTER";
      content.primaryAxisSizingMode = "AUTO";
      content.counterAxisSizingMode = "AUTO";
      content.itemSpacing = isMobile ? 12 : 16;
      bindSpacing(content, 0, isMobile ? 12 : 16);
      hero.appendChild(content);
      content.layoutSizingHorizontal = "FILL";
      content.maxWidth = isMobile ? W - 40 : 800;

      // Heading
      var h1 = figma.createText();
      var h1Style = isMobile ? tsH1Mobile : tsH1;
      if (h1Style) {
        h1.textStyleId = h1Style.id;
      } else {
        h1.fontName = { family: "Inter", style: "Bold" };
        h1.fontSize = isMobile ? 28 : 48;
      }
      h1.characters = "Headline goes here";
      var h1Fill = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };
      var h1ColorVar = findNearestColorVar(h1Fill.color, allColorVars);
      h1.fills = h1ColorVar ? [figma.variables.setBoundVariableForPaint(h1Fill, "color", h1ColorVar)] : [h1Fill];
      h1.textAlignHorizontal = "CENTER";
      content.appendChild(h1);

      // Placeholder image between heading and paragraph
      var heroImg = figma.createRectangle();
      heroImg.name = "hero-image";
      heroImg.resize(isMobile ? W - 60 : 400, isMobile ? 160 : 240);
      heroImg.cornerRadius = defaultRadius;
      bindRadius(heroImg, "md");
      heroImg.fills = [{ type: "IMAGE", imageHash: contentImageHash, scaleMode: "FILL" }];
      heroImg.exportSettings = standardExportSettings;
      content.appendChild(heroImg);
      try { heroImg.layoutSizingHorizontal = "FILL"; } catch(e) {}
      heroImg.maxWidth = isMobile ? W - 60 : 400;

      // Paragraph
      var sub = figma.createText();
      var subStyle = isMobile ? tsBodyMobile : tsBody;
      if (subStyle) {
        sub.textStyleId = subStyle.id;
      } else {
        sub.fontName = { family: "Inter", style: "Regular" };
        sub.fontSize = isMobile ? 14 : 18;
      }
      sub.characters = "Supporting text that describes the promo offer or key message.";
      var subFill = { type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } };
      var subColorVar = findNearestColorVar(subFill.color, allColorVars);
      sub.fills = subColorVar ? [figma.variables.setBoundVariableForPaint(subFill, "color", subColorVar)] : [subFill];
      sub.textAlignHorizontal = "CENTER";
      sub.textAutoResize = "HEIGHT";
      content.appendChild(sub);
      try { sub.layoutSizingHorizontal = "FILL"; } catch(e) {
        sub.resize((isMobile ? W - 40 : 800) - 40, sub.height);
      }

      // CTA
      await createCta(content, "Call to Action");

      // Resize bg to match final parent size
      heroBg.resize(hero.width, hero.height);

      pageX += W + GAP;
    }

    // ════════════════════════════════════════════════════════════════════
    // 2. POPUP (default screen — with or without form)
    // ════════════════════════════════════════════════════════════════════
    if (sections.popup) {
      var popMinH = isMobile ? 400 : 420;
      var popup = createSectionFrame("promo/popup", W, popMinH);
      popup.fills = [];
      // Auto-layout: center popup-content
      popup.layoutMode = "VERTICAL";
      popup.primaryAxisAlignItems = "CENTER";
      popup.counterAxisAlignItems = "CENTER";
      popup.primaryAxisSizingMode = "AUTO";
      popup.counterAxisSizingMode = "FIXED";
      popup.minHeight = popMinH;
      bindPaddingXY(popup, 0, 128);

      // popup-overlay (absolute, fills parent, uses overlay variable)
      var overlay = figma.createRectangle();
      overlay.name = "popup-overlay";
      overlay.resize(W, popMinH);
      popup.appendChild(overlay);
      overlay.layoutPositioning = "ABSOLUTE";
      overlay.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
      overlay.x = 0; overlay.y = 0;
      applyOverlayFill(overlay);

      // popup-content (fills parent, uses native maxWidth)
      popup.paddingLeft = 16; popup.paddingRight = 16;
      var popPadVar = findSpacingVar(16);
      if (popPadVar) {
        try {
          popup.setBoundVariable("paddingLeft", popPadVar);
          popup.setBoundVariable("paddingRight", popPadVar);
        } catch(e) {}
      }
      var pcMaxW = isMobile ? 375 : 700;
      var pcMinH = isMobile ? 300 : 320;
      var pc = figma.createFrame();
      pc.name = "popup-content";
      pc.resize(pcMaxW, pcMinH);
      pc.cornerRadius = defaultRadius * 2;
      bindRadius(pc, "lg");
      pc.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(pc, "white");
      applyPromoShadow(pc);
      pc.clipsContent = true;
      // Auto-layout: content-driven height with minHeight
      pc.layoutMode = "VERTICAL";
      pc.primaryAxisSizingMode = "AUTO";
      pc.counterAxisSizingMode = "FIXED";
      pc.minHeight = pcMinH;
      popup.appendChild(pc);
      pc.layoutSizingHorizontal = "FILL";
      pc.maxWidth = pcMaxW;

      // Background image inside popup-content (absolute behind content)
      var pcBg;
      if (bgImageVariant) {
        pcBg = bgImageVariant.createInstance();
        pcBg.name = "popup-bg-image";
        pcBg.resize(pcMaxW, pcMinH);
        pc.appendChild(pcBg);
        pcBg.layoutPositioning = "ABSOLUTE";
        pcBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
        pcBg.x = 0; pcBg.y = 0;
        pcBg.opacity = 0.15;
        bindPromoOpacity(pcBg);
      } else {
        pcBg = figma.createRectangle();
        pcBg.name = "popup-bg-image";
        pcBg.resize(pcMaxW, pcMinH);
        pc.appendChild(pcBg);
        pcBg.layoutPositioning = "ABSOLUTE";
        pcBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
        pcBg.x = 0; pcBg.y = 0;
        pcBg.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
        pcBg.exportSettings = standardExportSettings;
        pcBg.opacity = 0.15;
        bindPromoOpacity(pcBg);
      }

      if (popupIncludeForm) {
        // ── Popup with form — auto-layout popup-inner ──
        var fPad = 32;
        var fGap = isMobile ? 12 : 16;

        var formInner = figma.createFrame();
        formInner.name = "popup-inner";
        formInner.fills = [];
        formInner.layoutMode = "VERTICAL";
        formInner.primaryAxisAlignItems = "CENTER";
        formInner.counterAxisAlignItems = "CENTER";
        formInner.primaryAxisSizingMode = "AUTO";
        formInner.counterAxisSizingMode = "AUTO";
        formInner.paddingTop = fPad; formInner.paddingBottom = fPad;
        formInner.paddingLeft = fPad; formInner.paddingRight = fPad;
        formInner.itemSpacing = fGap;
        bindSpacing(formInner, fPad, fGap);
        pc.appendChild(formInner);
        try {
          formInner.layoutSizingHorizontal = "FILL";
          formInner.layoutSizingVertical = "HUG";
        } catch(e) {}

        // Paragraph
        var pText = figma.createText();
        var pStyle = isMobile ? tsSmall : tsBody;
        if (pStyle) {
          pText.textStyleId = pStyle.id;
        } else {
          pText.fontName = { family: "Inter", style: "Regular" };
          pText.fontSize = isMobile ? 13 : 15;
        }
        pText.characters = "Fill in the form below to claim your offer.";
        pText.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
        promoBindFill(pText, "text/primary");
        pText.textAlignHorizontal = "CENTER";
        pText.textAutoResize = "HEIGHT";
        formInner.appendChild(pText);
        try { pText.layoutSizingHorizontal = "FILL"; } catch(e) {
          pText.resize(pcMaxW - fPad * 2, pText.height);
        }

        // Form wrapper
        var formDiv = figma.createFrame();
        formDiv.name = "form";
        formDiv.fills = [];
        formDiv.layoutMode = "VERTICAL";
        formDiv.primaryAxisSizingMode = "AUTO";
        formDiv.counterAxisSizingMode = "AUTO";
        formDiv.itemSpacing = 16;
        bindSpacing(formDiv, 0, isMobile ? 12 : 16);
        formInner.appendChild(formDiv);
        formDiv.layoutSizingHorizontal = "FILL";

        // Form rows — from grid layout (array of arrays) or fallback
        var formRows;
        if (msg.formRows && msg.formRows.length > 0) {
          formRows = msg.formRows;
        } else {
          // Legacy fallback
          formRows = [
            [{ label: "First name", required: true }, { label: "Last name", required: true }],
            [{ label: "Email address", required: true }, { label: "Phone number", required: true }],
            [{ label: "Select your store", dropdown: true, required: true }]
          ];
        }
        var colGap = isMobile ? 12 : 16;

        for (var ri = 0; ri < formRows.length; ri++) {
          var rowData = formRows[ri];
          var rowFrame = figma.createFrame();
          rowFrame.name = "form-row";
          rowFrame.fills = [];

          if (isMobile) {
            rowFrame.layoutMode = "VERTICAL";
            rowFrame.primaryAxisSizingMode = "AUTO";
            rowFrame.counterAxisSizingMode = "AUTO";
            rowFrame.itemSpacing = colGap;
          } else {
            // Auto-layout with wrap — Figma displays this as Grid in the UI
            rowFrame.layoutMode = "HORIZONTAL";
            rowFrame.layoutWrap = "WRAP";
            rowFrame.primaryAxisSizingMode = "FIXED";
            rowFrame.counterAxisSizingMode = "AUTO";
            rowFrame.itemSpacing = colGap;
            rowFrame.counterAxisSpacing = colGap;
          }
          // Bind gaps to grid gutter variable, fall back to spacing variable
          var rowGapVar = gridGutterVar || findSpacingVar(colGap);
          if (rowGapVar) {
            try { rowFrame.setBoundVariable("itemSpacing", rowGapVar); } catch(e) {}
            if (!isMobile) {
              try { rowFrame.setBoundVariable("counterAxisSpacing", rowGapVar); } catch(e) {}
            }
          }
          formDiv.appendChild(rowFrame);
          rowFrame.layoutSizingHorizontal = "FILL";

          // Calculate 12-column grid unit width
          var rowWidth = rowFrame.width;
          var unitCol = (rowWidth - 11 * colGap) / 12;

          for (var ci = 0; ci < rowData.length; ci++) {
            var fld = rowData[ci];
            var span = fld.colSpan || Math.floor(12 / rowData.length);
            var fieldLabel = fld.required ? fld.label + " *" : fld.label;
            var inp = fld.dropdown
              ? await createDropdown(rowFrame, fieldLabel)
              : await createInput(rowFrame, fieldLabel);

            try { inp.layoutSizingHorizontal = "FILL"; } catch(e) {}

            // Store grid column span for HTML export
            try { inp.setPluginData("colSpan", String(span)); } catch(e) {}

            // Set maxWidth proportionally so fields respect grid proportions in Figma
            if (!isMobile) {
              var totalRowSpan = 0;
              for (var si = 0; si < rowData.length; si++) totalRowSpan += (rowData[si].colSpan || Math.floor(12 / rowData.length));
              var fieldMaxW = Math.round((span / totalRowSpan) * (rowWidth - Math.max(0, rowData.length - 1) * colGap));
              try { inp.maxWidth = fieldMaxW; } catch(e) {}
              // Set minWidth for wrapping breakpoint
              var fieldMinW = Math.round(span * unitCol + Math.max(0, span - 1) * colGap);
              try { inp.minWidth = fieldMinW; } catch(e) {}
              if (gridColVarMap[span]) {
                try { inp.setBoundVariable("minWidth", gridColVarMap[span]); } catch(e) {}
              }
            }
            // Color the asterisk red on required fields
            if (fld.required) {
              var txtNodes = inp.findAll(function(n) { return n.type === "TEXT"; });
              for (var ti = 0; ti < txtNodes.length; ti++) {
                var tn = txtNodes[ti];
                var starIdx = tn.characters.lastIndexOf(" *");
                if (starIdx !== -1) {
                  try {
                    tn.setRangeFills(starIdx + 1, starIdx + 2, [{ type: "SOLID", color: { r: 0.9, g: 0.2, b: 0.2 } }]);
                  } catch(e) {}
                }
              }
            }
            var innerField = inp.findOne(function(n) { return n.name === "field"; });
            if (innerField) {
              try { innerField.layoutSizingHorizontal = "FILL"; } catch(e) {}
            }
          }
        }

        // Submit CTA in form-actions wrapper
        var formActions = figma.createFrame();
        formActions.name = "form-actions";
        formActions.fills = [];
        formActions.layoutMode = "HORIZONTAL";
        formActions.primaryAxisAlignItems = "CENTER";
        formActions.primaryAxisSizingMode = "AUTO";
        formActions.counterAxisSizingMode = "AUTO";
        formDiv.appendChild(formActions);
        formActions.layoutSizingHorizontal = "FILL";
        await createCta(formActions, "Submit");

      } else {
        // ── Popup without form — text + CTA centered ──
        var nfPad = 32;
        var nfGap = isMobile ? 12 : 20;
        var innerFrame = figma.createFrame();
        innerFrame.name = "popup-inner";
        innerFrame.fills = [];
        innerFrame.layoutMode = "VERTICAL";
        innerFrame.primaryAxisAlignItems = "CENTER";
        innerFrame.counterAxisAlignItems = "CENTER";
        innerFrame.primaryAxisSizingMode = "AUTO";
        innerFrame.counterAxisSizingMode = "AUTO";
        innerFrame.paddingLeft = nfPad; innerFrame.paddingRight = nfPad;
        innerFrame.paddingTop = nfPad; innerFrame.paddingBottom = nfPad;
        innerFrame.itemSpacing = nfGap;
        bindSpacing(innerFrame, nfPad, nfGap);
        pc.appendChild(innerFrame);
        try {
          innerFrame.layoutSizingHorizontal = "FILL";
          innerFrame.layoutSizingVertical = "HUG";
        } catch(e) {}

        var popTxt = figma.createText();
        var popTxtStyle = isMobile ? tsBodyMobile : tsBody;
        if (popTxtStyle) {
          popTxt.textStyleId = popTxtStyle.id;
        } else {
          popTxt.fontName = { family: "Inter", style: "Regular" };
          popTxt.fontSize = isMobile ? 14 : 16;
        }
        popTxt.characters = "Promotional message or announcement text goes here.";
        popTxt.fills = [{ type: "SOLID", color: textFigma }];
        promoBindFill(popTxt, "text/primary");
        popTxt.textAlignHorizontal = "CENTER";
        popTxt.textAutoResize = "HEIGHT";
        innerFrame.appendChild(popTxt);
        try { popTxt.layoutSizingHorizontal = "FILL"; } catch(e) {
          popTxt.resize(pcMaxW - 64 - 40, popTxt.height);
        }

        await createCta(innerFrame, "Call to Action");
      }

      // Close button (absolute, top-right) — appended last so it layers on top
      var closeSize = isMobile ? 15 : 19;
      var closeBtn = figma.createFrame();
      closeBtn.name = "close-button";
      closeBtn.fills = [];
      closeBtn.layoutMode = "HORIZONTAL";
      closeBtn.primaryAxisSizingMode = "AUTO";
      closeBtn.counterAxisSizingMode = "AUTO";
      closeBtn.primaryAxisAlignItems = "CENTER";
      closeBtn.counterAxisAlignItems = "CENTER";
      bindPaddingXY(closeBtn, isMobile ? 16 : 28, isMobile ? 20 : 32);
      var closeIcon = figma.createRectangle();
      closeIcon.name = "close-icon";
      closeIcon.resize(closeSize, closeSize);
      closeIcon.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: closeImageHash }];
      closeIcon.exportSettings = standardExportSettings;
      closeBtn.appendChild(closeIcon);
      pc.appendChild(closeBtn);
      closeBtn.layoutPositioning = "ABSOLUTE";
      closeBtn.constraints = { horizontal: "MAX", vertical: "MIN" };
      closeBtn.x = pcMaxW - closeBtn.width;
      closeBtn.y = 0;

      // Resize overlay to match final parent size
      overlay.resize(popup.width, popup.height);

      pageX += W + GAP;

      // ══════════════════════════════════════════════════════════════════
      // 3. POPUP THANK-YOU (only when popup has a form)
      // ══════════════════════════════════════════════════════════════════
      if (popupIncludeForm) {
        var tyPopMinH = popMinH;
        var tyPopup = createSectionFrame("promo/popup-thankyou", W, tyPopMinH);
        tyPopup.fills = [];
        // Auto-layout: center popup-content
        tyPopup.layoutMode = "VERTICAL";
        tyPopup.primaryAxisAlignItems = "CENTER";
        tyPopup.counterAxisAlignItems = "CENTER";
        tyPopup.primaryAxisSizingMode = "AUTO";
        tyPopup.counterAxisSizingMode = "FIXED";
        tyPopup.minHeight = tyPopMinH;
        bindPaddingXY(tyPopup, 0, 128);
        if (isMobile) {
          tyPopup.maxWidth = MOBILE_BREAKPOINT;
        }

        // overlay (absolute, fills parent)
        var tyOverlay = figma.createRectangle();
        tyOverlay.name = "popup-overlay";
        tyOverlay.resize(W, tyPopMinH);
        tyPopup.appendChild(tyOverlay);
        tyOverlay.layoutPositioning = "ABSOLUTE";
        tyOverlay.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
        tyOverlay.x = 0; tyOverlay.y = 0;
        applyOverlayFill(tyOverlay);

        // popup-content (fills parent, uses native maxWidth)
        tyPopup.paddingLeft = 16; tyPopup.paddingRight = 16;
        var tyPopPadVar = findSpacingVar(16);
        if (tyPopPadVar) {
          try {
            tyPopup.setBoundVariable("paddingLeft", tyPopPadVar);
            tyPopup.setBoundVariable("paddingRight", tyPopPadVar);
          } catch(e) {}
        }
        var tyPcMaxW = isMobile ? 375 : 700;
        var tyPcMinH = isMobile ? 300 : 320;
        var tyPc = figma.createFrame();
        tyPc.name = "popup-content";
        tyPc.resize(tyPcMaxW, tyPcMinH);
        tyPc.cornerRadius = defaultRadius * 2;
        bindRadius(tyPc, "lg");
        tyPc.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
        promoBindFill(tyPc, "white");
        applyPromoShadow(tyPc);
        tyPc.clipsContent = true;
        // Auto-layout: content-driven height with minHeight
        tyPc.layoutMode = "VERTICAL";
        tyPc.primaryAxisSizingMode = "AUTO";
        tyPc.counterAxisSizingMode = "FIXED";
        tyPc.minHeight = tyPcMinH;
        tyPopup.appendChild(tyPc);
        tyPc.layoutSizingHorizontal = "FILL";
        tyPc.maxWidth = tyPcMaxW;

        // Background image (absolute behind content)
        var tyBg;
        if (bgImageVariant) {
          tyBg = bgImageVariant.createInstance();
          tyBg.name = "popup-bg-image";
          tyBg.resize(tyPcMaxW, tyPcMinH);
          tyPc.appendChild(tyBg);
          tyBg.layoutPositioning = "ABSOLUTE";
          tyBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
          tyBg.x = 0; tyBg.y = 0;
          tyBg.opacity = 0.15;
          bindPromoOpacity(tyBg);
        } else {
          tyBg = figma.createRectangle();
          tyBg.name = "popup-bg-image";
          tyBg.resize(tyPcMaxW, tyPcMinH);
          tyPc.appendChild(tyBg);
          tyBg.layoutPositioning = "ABSOLUTE";
          tyBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
          tyBg.x = 0; tyBg.y = 0;
          tyBg.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
          tyBg.exportSettings = standardExportSettings;
          tyBg.opacity = 0.15;
          bindPromoOpacity(tyBg);
        }

        // Centered text + CTA
        var tyPad = 32;
        var tyGap = isMobile ? 12 : 20;
        var tyInner = figma.createFrame();
        tyInner.name = "popup-inner";
        tyInner.fills = [];
        tyInner.layoutMode = "VERTICAL";
        tyInner.primaryAxisAlignItems = "CENTER";
        tyInner.counterAxisAlignItems = "CENTER";
        tyInner.primaryAxisSizingMode = "AUTO";
        tyInner.counterAxisSizingMode = "AUTO";
        tyInner.paddingLeft = tyPad; tyInner.paddingRight = tyPad;
        tyInner.paddingTop = tyPad; tyInner.paddingBottom = tyPad;
        tyInner.itemSpacing = tyGap;
        bindSpacing(tyInner, tyPad, tyGap);
        tyPc.appendChild(tyInner);
        try {
          tyInner.layoutSizingHorizontal = "FILL";
          tyInner.layoutSizingVertical = "HUG";
        } catch(e) {}

        var tyTxt = figma.createText();
        var tyTxtStyle = isMobile ? tsBodyMobile : tsBody;
        if (tyTxtStyle) {
          tyTxt.textStyleId = tyTxtStyle.id;
        } else {
          tyTxt.fontName = { family: "Inter", style: "Regular" };
          tyTxt.fontSize = isMobile ? 14 : 16;
        }
        tyTxt.characters = "Thank you! Your submission has been received.";
        tyTxt.fills = [{ type: "SOLID", color: textFigma }];
        promoBindFill(tyTxt, "text/primary");
        tyTxt.textAlignHorizontal = "CENTER";
        tyTxt.textAutoResize = "HEIGHT";
        tyInner.appendChild(tyTxt);
        try { tyTxt.layoutSizingHorizontal = "FILL"; } catch(e) {
          tyTxt.resize(tyPcMaxW - 64 - 40, tyTxt.height);
        }

        // Placeholder image
        var tyImg = figma.createRectangle();
        tyImg.name = "thankyou-image";
        tyImg.resize(isMobile ? 140 : 200, isMobile ? 100 : 140);
        tyImg.cornerRadius = defaultRadius;
        bindRadius(tyImg, "md");
        tyImg.fills = [{ type: "IMAGE", imageHash: contentImageHash, scaleMode: "FILL" }];
        tyInner.appendChild(tyImg);

        await createCta(tyInner, "Continue");

        // Close button (absolute, top-right) — appended last so it layers on top
        var tyCloseSize = isMobile ? 15 : 19;
        var tyCloseBtn = figma.createFrame();
        tyCloseBtn.name = "close-button";
        tyCloseBtn.fills = [];
        tyCloseBtn.layoutMode = "HORIZONTAL";
        tyCloseBtn.primaryAxisSizingMode = "AUTO";
        tyCloseBtn.counterAxisSizingMode = "AUTO";
        tyCloseBtn.primaryAxisAlignItems = "CENTER";
        tyCloseBtn.counterAxisAlignItems = "CENTER";
        bindPaddingXY(tyCloseBtn, isMobile ? 16 : 28, isMobile ? 20 : 32);
        var tyCloseIcon = figma.createRectangle();
        tyCloseIcon.name = "close-icon";
        tyCloseIcon.resize(tyCloseSize, tyCloseSize);
        tyCloseIcon.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: closeImageHash }];
        tyCloseBtn.appendChild(tyCloseIcon);
        tyPc.appendChild(tyCloseBtn);
        tyCloseBtn.layoutPositioning = "ABSOLUTE";
        tyCloseBtn.constraints = { horizontal: "MAX", vertical: "MIN" };
        tyCloseBtn.x = tyPcMaxW - tyCloseBtn.width;
        tyCloseBtn.y = 0;

        // Resize overlay to match final parent size
        tyOverlay.resize(tyPopup.width, tyPopup.height);

        pageX += W + GAP;
      }
    }

    // ════════════════════════════════════════════════════════════════════
    // 4. BANNER
    // ════════════════════════════════════════════════════════════════════
    if (sections.banner) {
      var innerW = isMobile ? W - 24 : 1315;
      var innerH = isMobile ? 160 : 240;
      var bannerH = innerH + 60;
      var banner = createSectionFrame("promo/banner", W, bannerH);
      banner.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      promoBindFill(banner, "white");
      // Auto-layout to center inner-banner
      banner.layoutMode = "VERTICAL";
      banner.primaryAxisAlignItems = "CENTER";
      banner.counterAxisAlignItems = "CENTER";
      banner.primaryAxisSizingMode = "AUTO";
      banner.counterAxisSizingMode = "FIXED";
      bindPaddingXY(banner, 0, 24);

      // inner-banner with background image, horizontal layout: image + CTA
      var innerBanner = figma.createFrame();
      innerBanner.name = "inner-banner";
      innerBanner.resize(innerW, innerH);
      innerBanner.clipsContent = true;
      innerBanner.cornerRadius = defaultRadius;
      bindRadius(innerBanner, "md");
      innerBanner.layoutMode = isMobile ? "VERTICAL" : "HORIZONTAL";
      innerBanner.primaryAxisAlignItems = "CENTER";
      innerBanner.counterAxisAlignItems = "CENTER";
      innerBanner.primaryAxisSizingMode = "AUTO";
      innerBanner.counterAxisSizingMode = "FIXED";
      if (bgImageVariant) {
        innerBanner.fills = [];
        var bannerBg = bgImageVariant.createInstance();
        bannerBg.name = "banner-bg-image";
        bannerBg.resize(innerW, innerH);
        innerBanner.appendChild(bannerBg);
        bannerBg.layoutPositioning = "ABSOLUTE";
        bannerBg.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
        bannerBg.x = 0; bannerBg.y = 0;
      } else {
        innerBanner.fills = [{ type: "IMAGE", imageHash: placeholderHash, scaleMode: "FILL" }];
      }
      var bannerPadPx = isMobile ? 16 : 40;
      var bannerGapPx = isMobile ? 16 : 32;
      innerBanner.paddingLeft = bannerPadPx;
      innerBanner.paddingRight = bannerPadPx;
      innerBanner.paddingTop = 24; innerBanner.paddingBottom = 24;
      innerBanner.itemSpacing = bannerGapPx;
      var innerBannerTBVar = findSpacingVar(24);
      if (innerBannerTBVar) {
        try {
          innerBanner.setBoundVariable("paddingTop", innerBannerTBVar);
          innerBanner.setBoundVariable("paddingBottom", innerBannerTBVar);
        } catch(e) {}
      }
      var bannerPadVar = findSpacingVar(bannerPadPx);
      var bannerGapVar = findSpacingVar(bannerGapPx);
      if (bannerPadVar) {
        try {
          innerBanner.setBoundVariable("paddingLeft", bannerPadVar);
          innerBanner.setBoundVariable("paddingRight", bannerPadVar);
        } catch(e) {}
      }
      if (bannerGapVar) {
        try { innerBanner.setBoundVariable("itemSpacing", bannerGapVar); } catch(e) {}
      }
      banner.appendChild(innerBanner);
      innerBanner.layoutSizingHorizontal = "FILL";
      innerBanner.maxWidth = isMobile ? 375 : innerW;

      // Placeholder image inside banner
      var bannerImg = figma.createRectangle();
      bannerImg.name = "banner-image";
      bannerImg.resize(isMobile ? 100 : 200, isMobile ? 80 : 140);
      bannerImg.cornerRadius = defaultRadius;
      bindRadius(bannerImg, "md");
      bannerImg.fills = [{ type: "IMAGE", imageHash: contentImageHash, scaleMode: "FILL" }];
      bannerImg.exportSettings = standardExportSettings;
      innerBanner.appendChild(bannerImg);
      bannerImg.maxWidth = isMobile ? 100 : 200;

      await createCta(innerBanner, "Learn More");

      pageX += W + GAP;
    }

    // Fix page-level layer order: first frame (hero) = top of layer panel.
    // Figma: last child = top of panel. So re-append in order, making
    // the last one (banner) end up at the top — then reverse.
    // Simplest: insert each frame at index 0 in creation order,
    // so the first created (hero) ends up as the last child (top of panel).
    for (var lri = 0; lri < createdFrames.length; lri++) {
      page.insertChild(0, createdFrames[lri]);
    }
  }
}
