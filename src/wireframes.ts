// Promo wireframe generation
import { hexToFigma, findPageByHint, loadFontWithFallback, createPlaceholderImageHash, cxResolveVar, cxFindCol } from './utils';
import { findNearestColorVar } from './audit';
import { MOBILE_BREAKPOINT, STANDARD_EXPORT_SETTINGS } from './constants';

interface PromoContext {
  brandFigma: RGB;
  textFigma: RGB;
  placeholderHash: string;
  contentImageHash: string;
  closeImageHash: string;
  overlayVar: Variable | null;
  promoShadowStyle: EffectStyle | null;
  applyPromoShadow: (node: SceneNode) => void;
  spacingVarMap: Record<string, Variable>;
  radiusVarMap: Record<string, Variable>;
  opacityVarMap: Record<number, Variable>;
  borderWidthVarMap: Record<number, Variable>;
  gridColVarMap: Record<string, Variable>;
  gridGutterVar: Variable | null;
  promoColorVarMap: Record<string, Variable>;
  defaultRadius: number;
  tsH1: TextStyle | null;
  tsH1Mobile: TextStyle | null;
  tsBody: TextStyle | null;
  tsBodyMobile: TextStyle | null;
  tsSmall: TextStyle | null;
  tsBtnDefault: TextStyle | null;
  tsBtnSm: TextStyle | null;
  tsLabel: TextStyle | null;
  btnVariant: ComponentNode | null;
  inputVariant: ComponentNode | null;
  labelVariant: ComponentNode | null;
  dropdownVariant: ComponentNode | null;
  bgImageVariant: ComponentNode | null;
  opacityColId: string | null;
  opacityValueModeId: string | null;
  opacityPctModeId: string | null;
  findSpacingVar: (targetPx: number) => Promise<Variable | null>;
  findRadiusVar: (name: string) => Variable | null;
  bindPromoOpacity: (node: SceneNode) => void;
  bindPaddingXY: (frame: FrameNode, padXPx: number, padYPx: number) => Promise<void>;
  bindSpacing: (frame: FrameNode, padPx: number, gapPx: number) => Promise<void>;
  bindBorderWidth: (node: SceneNode) => void;
  bindRadius: (frame: FrameNode, radiusName: string) => void;
  promoBindFill: (node: SceneNode, varName: string) => void;
  promoBindStroke: (node: SceneNode, varName: string) => void;
  findPromoTextStyle: (group: string, name: string) => TextStyle | null;
  allColorVars: Variable[];
  exportSettings: any[];
}

interface BreakpointContext {
  page: PageNode;
  W: number;
  isMobile: boolean;
  GAP: number;
  pageX: number;
  createdFrames: FrameNode[];
  createSectionFrame: (name: string, width: number, height: number) => FrameNode;
  createCta: (parent: FrameNode, text: string) => Promise<InstanceNode | null>;
  createInput: (parent: FrameNode, labelText: string) => Promise<InstanceNode | null>;
  createDropdown: (parent: FrameNode, placeholderText: string) => Promise<InstanceNode | null>;
  applyOverlayFill: (node: SceneNode) => void;
}

async function initPromoContext(msg): Promise<PromoContext> {
  const brandHex = msg.brandColor || "#3B82F6";
  const textHex = msg.textColor || "#1A1A1A";
  const brandFigma = hexToFigma(brandHex);
  const textFigma = hexToFigma(textHex);
  const radiusData = msg.radius || [];
  let defaultRadius = 8;
  for (let dri = 0; dri < radiusData.length; dri++) {
    if (radiusData[dri].name === "md" || radiusData[dri].name === "default") {
      defaultRadius = parseFloat(radiusData[dri].value) || 8; break;
    }
  }

  const preloadWeights = [400, 500, 600, 700];
  for (let pw = 0; pw < preloadWeights.length; pw++) {
    await loadFontWithFallback("Inter", preloadWeights[pw]);
  }

  // Placeholder image for backgrounds (light gray)
  const placeholderHash = createPlaceholderImageHash(0xCC, 0xCF, 0xD2);
  // Placeholder image for content images (darker, visible on any background)
  const contentImageHash = createPlaceholderImageHash(0x8A, 0x8F, 0x99);

  // Close button image
  const closeImageHash = figma.createImage(
    figma.base64Decode("iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAYAAAByUDbMAAABQUlEQVQ4jZ3UvUtcQRQF8J+IIAqWFoqdGxXbkMIU/h9WGgI2ESxstbNUxM5K0oiNiBYimCatGAjb+C0EQUIUMYUIWqwMvIXHOG/3rQduc+aeM3Pv3Jl2fMUyPuESd8qjD/OYQ1cgfqOWxX2WUBZ7Oe1xINZyRIgqRkoYrUa6rUBWcBItPOBLgUlvIj/EZNGR6zEeGVVwFOXc4mO8Yz82E4aL2fpAJqzl4gofGvViNmE4hbOIu0Fnid4mDfOx3exEMRbwFJk84od34lei2cOtmvRl8/acKPFPg7F5gzbsN+lZDZ/LmFUj0Tkm8L3glgtL24mS/6K7wUb/MRobdeBnlPgPQ4kWLCWe3lg9IQguErc2qBgriZLDV2YjIsM4hDfYDDOR7iCQp1Fp4Vcoi2857Vk7XtCDXUzjugWzw6wloZfrr6cznFx8NDn5AAAAAElFTkSuQmCC")
  ).hash;

  // Look up overlay variable for popup-overlay background
  let overlayVar = null;
  const allColorVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v) { return v.resolvedType === "COLOR"; });
  for (let ovi = 0; ovi < allColorVars.length; ovi++) {
    const ovName = allColorVars[ovi].name.toLowerCase();
    if (ovName.indexOf("overlay") !== -1 || ovName.indexOf("scrim") !== -1) {
      overlayVar = allColorVars[ovi]; break;
    }
  }

  // Look up shadow effect styles for binding
  const promoEffectStyles = await figma.getLocalEffectStylesAsync();
  let promoShadowStyle = null;
  for (let esi = 0; esi < promoEffectStyles.length; esi++) {
    const esName = promoEffectStyles[esi].name.toLowerCase();
    if (esName.indexOf("shadow") !== -1 && (esName.indexOf("default") !== -1 || esName.indexOf("md") !== -1)) {
      promoShadowStyle = promoEffectStyles[esi]; break;
    }
  }
  // Fallback: use any shadow style
  if (!promoShadowStyle) {
    for (let esi2 = 0; esi2 < promoEffectStyles.length; esi2++) {
      if (promoEffectStyles[esi2].name.toLowerCase().indexOf("shadow") !== -1) {
        promoShadowStyle = promoEffectStyles[esi2]; break;
      }
    }
  }
  async function applyPromoShadow(node) {
    if (!promoShadowStyle) return;
    try { await node.setEffectStyleIdAsync(promoShadowStyle.id); } catch(e) {}
  }

  // Look up spacing, radius & opacity variables for binding
  const spacingVarMap = {};
  const radiusVarMap = {};
  const opacityVarMap = {};
  const borderWidthVarMap = {};
  let opacityColId = null;
  let opacityValueModeId = null;   // decimal 0-1 (for resolving / CSS)
  let opacityPctModeId = null;     // percentage 0-100 (for Figma "Opacity" binding)
  const allFloatVars = (await figma.variables.getLocalVariablesAsync()).filter(function(v) { return v.resolvedType === "FLOAT"; });
  const allColls = await figma.variables.getLocalVariableCollectionsAsync();
  for (let fvi = 0; fvi < allFloatVars.length; fvi++) {
    const fv = allFloatVars[fvi];
    let collName = "";
    for (let fci = 0; fci < allColls.length; fci++) {
      if (allColls[fci].id === fv.variableCollectionId) { collName = allColls[fci].name.toLowerCase(); break; }
    }
    const shortName = fv.name.split("/").pop();
    if (collName.indexOf("spacing") !== -1 || collName.indexOf("gap") !== -1) {
      spacingVarMap[shortName] = fv;
    } else if (collName.indexOf("opacity") !== -1) {
      // Save collection info for explicit mode binding
      if (!opacityColId) {
        for (let oci2 = 0; oci2 < allColls.length; oci2++) {
          if (allColls[oci2].id === fv.variableCollectionId) {
            opacityColId = allColls[oci2].id;
            const opModes = allColls[oci2].modes || [];
            if (opModes.length) opacityValueModeId = opModes[0].modeId;
            for (let omi = 0; omi < opModes.length; omi++) {
              if (opModes[omi].name === "Percentage") { opacityPctModeId = opModes[omi].modeId; break; }
            }
            break;
          }
        }
      }
      let opModeId2 = null;
      for (let oci = 0; oci < allColls.length; oci++) { if (allColls[oci].id === fv.variableCollectionId) { if (allColls[oci].modes?.length) { opModeId2 = allColls[oci].modes[0].modeId; } break; } }
      if (opModeId2) { try { const opVal2 = await cxResolveVar(fv, opModeId2, allColls); if (typeof opVal2 === "number") opacityVarMap[Math.round(opVal2 * 100)] = fv; } catch(e) {} }
    } else if (collName.indexOf("radius") !== -1 || collName.indexOf("corner") !== -1) {
      radiusVarMap[shortName] = fv;
    } else if (collName.indexOf("border") !== -1 && collName.indexOf("width") !== -1) {
      // Build border width variable map by resolved value
      let bwModeIdW = null;
      for (let bwci = 0; bwci < allColls.length; bwci++) { if (allColls[bwci].id === fv.variableCollectionId && allColls[bwci].modes?.length) { bwModeIdW = allColls[bwci].modes[0].modeId; break; } }
      if (bwModeIdW) { try { const bwv = await cxResolveVar(fv, bwModeIdW, allColls); if (typeof bwv === "number") borderWidthVarMap[bwv] = fv; } catch(e) {} }
    }
  }

  // Helper: find best spacing variable for a target px value
  async function findSpacingVar(targetPx) {
    let best = null, bestDiff = Infinity;
    let spCol = null;
    for (let sci = 0; sci < allColls.length; sci++) { if (allColls[sci].name.toLowerCase().indexOf("spacing") !== -1) { spCol = allColls[sci]; break; } }
    if (!spCol || !spCol.modes || !spCol.modes.length) return null;
    const spModeId = spCol.modes[0].modeId;
    for (const sk in spacingVarMap) {
      if (!spacingVarMap.hasOwnProperty(sk)) continue;
      let val = 0;
      try {
        val = await cxResolveVar(spacingVarMap[sk], spModeId, allColls);
        if (typeof val !== "number") val = parseFloat(val) || 0;
      } catch(e) {}
      const diff = Math.abs(val - targetPx);
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
    const pct = Math.round(node.opacity * 100);
    const ov = opacityVarMap[pct];
    if (ov) { try { node.setBoundVariable("opacity", ov); } catch(e) {} }
  }

  // Look up grid column span variables (grid/col-1 through grid/col-12)
  const gridColVarMap = {};
  for (let gvi = 0; gvi < allFloatVars.length; gvi++) {
    const gv = allFloatVars[gvi];
    let gCollName = "";
    for (let gci = 0; gci < allColls.length; gci++) {
      if (allColls[gci].id === gv.variableCollectionId) { gCollName = allColls[gci].name.toLowerCase(); break; }
    }
    if (gCollName === "grid" && gv.name.indexOf("grid/col-") === 0) {
      const spanNum = parseInt(gv.name.replace("grid/col-", ""));
      if (spanNum >= 1 && spanNum <= 12) gridColVarMap[spanNum] = gv;
    }
  }
  // Also look up grid/gutter variable for form row gap binding
  let gridGutterVar = null;
  for (let ggi = 0; ggi < allFloatVars.length; ggi++) {
    const ggv = allFloatVars[ggi];
    let ggCollName = "";
    for (let ggci = 0; ggci < allColls.length; ggci++) {
      if (allColls[ggci].id === ggv.variableCollectionId) { ggCollName = allColls[ggci].name.toLowerCase(); break; }
    }
    if (ggCollName === "grid" && ggv.name === "grid/gutter") { gridGutterVar = ggv; break; }
  }

  // Helper: bind separate horizontal/vertical padding to spacing variables
  async function bindPaddingXY(frame, padXPx, padYPx) {
    frame.paddingLeft = padXPx; frame.paddingRight = padXPx;
    frame.paddingTop = padYPx; frame.paddingBottom = padYPx;
    const xVar = await findSpacingVar(padXPx);
    const yVar = await findSpacingVar(padYPx);
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
  async function bindSpacing(frame, padPx, gapPx) {
    const padVar = await findSpacingVar(padPx);
    const gapVar = await findSpacingVar(gapPx);
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
    const val = node.strokeWeight;
    if (val === undefined || val === null || typeof val !== "number") return;
    const bv = borderWidthVarMap[val];
    if (bv) { try { node.setBoundVariable("strokeWeight", bv); } catch(e) {} }
  }

  // Helper: bind corner radius to variable
  function bindRadius(frame, radiusName) {
    const rv = findRadiusVar(radiusName);
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
  const promoTextStyles = await figma.getLocalTextStylesAsync();
  function findPromoTextStyle(group, name) {
    const styleName = group + "/" + name;
    for (let i = 0; i < promoTextStyles.length; i++) {
      if (promoTextStyles[i].name === styleName) return promoTextStyles[i];
    }
    return null;
  }
  // Semantic text style lookup: heading, body, button
  const tsH1 = findPromoTextStyle("heading", "h1");
  const tsH1Mobile = findPromoTextStyle("heading", "h2") || tsH1;
  const tsBody = findPromoTextStyle("body", "default") || findPromoTextStyle("body", "lg");
  const tsBodyMobile = findPromoTextStyle("body", "sm") || tsBody;
  const tsSmall = findPromoTextStyle("body", "sm");

  // Pre-load fonts for text styles we'll use
  const tsBtnDefault = findPromoTextStyle("buttons", "default");
  const tsBtnSm = findPromoTextStyle("buttons", "sm");
  const tsLabel = findPromoTextStyle("label", "default");
  const promoTsArr = [tsH1, tsH1Mobile, tsBody, tsBodyMobile, tsSmall, tsBtnDefault, tsBtnSm, tsLabel];
  for (let ptsi = 0; ptsi < promoTsArr.length; ptsi++) {
    if (promoTsArr[ptsi]) {
      try { await figma.loadFontAsync(promoTsArr[ptsi].fontName); } catch(e) {}
    }
  }

  // ── Color variable binding helpers for wireframe ──
  const colorCols = (await figma.variables.getLocalVariableCollectionsAsync()).filter(function(c) { return c.name === "Colors"; });
  const promoColorVarMap = {};
  if (colorCols.length > 0) {
    for (let pcvi = 0; pcvi < allColorVars.length; pcvi++) {
      if (allColorVars[pcvi].variableCollectionId === colorCols[0].id) {
        promoColorVarMap[allColorVars[pcvi].name] = allColorVars[pcvi];
      }
    }
  }
  function promoBindFill(node, varName) {
    const v = promoColorVarMap[varName]; if (!v) return;
    try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", v)]; } catch(e) {}
  }
  function promoBindStroke(node, varName) {
    const v = promoColorVarMap[varName]; if (!v) return;
    try { node.strokes = [figma.variables.setBoundVariableForPaint(node.strokes[0], "color", v)]; } catch(e) {}
  }

  // ── Find component sets created on the Components page ──
  let btnVariant = null;      // Button: Variant=Primary, Size=Default
  let inputVariant = null;    // Input / Floating Label: State=Default
  let labelVariant = null;    // Label: State=Default
  let dropdownVariant = null; // Dropdown: State=Default
  let bgImageVariant = null;  // Background Image component
  const allCompSets = figma.root.findAll(function(n) { return n.type === "COMPONENT_SET"; });
  for (let csi = 0; csi < allCompSets.length; csi++) {
    const cs = allCompSets[csi];
    if (cs.name === "Button") {
      for (let vi = 0; vi < cs.children.length; vi++) {
        const vp = cs.children[vi].variantProperties;
        if (vp && vp["Variant"] === "Primary" && vp["Size"] === "Default") {
          btnVariant = cs.children[vi]; break;
        }
      }
    } else if (cs.name === "Input / Floating Label") {
      for (let ii = 0; ii < cs.children.length; ii++) {
        const ip = cs.children[ii].variantProperties;
        if (ip && ip["State"] === "Default") {
          inputVariant = cs.children[ii]; break;
        }
      }
    } else if (cs.name === "Label") {
      for (let li = 0; li < cs.children.length; li++) {
        const lp = cs.children[li].variantProperties;
        if (lp && lp["State"] === "Default") {
          labelVariant = cs.children[li]; break;
        }
      }
    } else if (cs.name === "Dropdown") {
      for (let di = 0; di < cs.children.length; di++) {
        const dp = cs.children[di].variantProperties;
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
    const allComps = figma.root.findAll(function(n) { return n.type === "COMPONENT" && (!n.parent || n.parent.type !== "COMPONENT_SET"); });
    for (let sci = 0; sci < allComps.length; sci++) {
      const sc = allComps[sci];
      if (sc.getPluginData?.("role") === "background-image") { bgImageVariant = sc; break; }
      if (sc.name === "Background Image") { bgImageVariant = sc; break; }
    }
  }

  return {
    brandFigma,
    textFigma,
    placeholderHash,
    contentImageHash,
    closeImageHash,
    overlayVar,
    promoShadowStyle,
    applyPromoShadow,
    spacingVarMap,
    radiusVarMap,
    opacityVarMap,
    borderWidthVarMap,
    gridColVarMap,
    gridGutterVar,
    promoColorVarMap,
    defaultRadius,
    tsH1,
    tsH1Mobile,
    tsBody,
    tsBodyMobile,
    tsSmall,
    tsBtnDefault,
    tsBtnSm,
    tsLabel,
    btnVariant,
    inputVariant,
    labelVariant,
    dropdownVariant,
    bgImageVariant,
    opacityColId,
    opacityValueModeId,
    opacityPctModeId,
    findSpacingVar,
    findRadiusVar,
    bindPromoOpacity,
    bindPaddingXY,
    bindSpacing,
    bindBorderWidth,
    bindRadius,
    promoBindFill,
    promoBindStroke,
    findPromoTextStyle,
    allColorVars,
    exportSettings: STANDARD_EXPORT_SETTINGS,
  };
}

async function initBreakpointContext(bp, sections, ctx: PromoContext, msg): Promise<BreakpointContext> {
  const page = findPageByHint(bp.hint);
  if (!page) return null;
  await figma.setCurrentPageAsync(page);

  // Map existing promo frame positions before removing anything
  const SECTION_ORDER = ["promo/hero", "promo/popup", "promo/popup-thankyou", "promo/banner"];
  const existingPositions = {}; // name → { x, width }
  for (let epi = 0; epi < page.children.length; epi++) {
    const epChild = page.children[epi];
    if (SECTION_ORDER.indexOf(epChild.name) !== -1) {
      existingPositions[epChild.name] = { x: epChild.x, width: epChild.width };
    }
  }

  // Remove only existing promo frames for sections being (re)generated
  const toRemove = page.children.filter(function(n) {
    if (n.name === "promo/hero" && sections.hero) return true;
    if ((n.name === "promo/popup" || n.name === "promo/popup-thankyou") && sections.popup) return true;
    if (n.name === "promo/banner" && sections.banner) return true;
    // Remove orphaned wireframe helpers only if popup is being regenerated
    if (sections.popup && (n.name === "form-row" || n.name === "form-div" || n.name.indexOf("input-") === 0)) return true;
    return false;
  });
  toRemove.forEach(function(n) { try { n.remove(); } catch(e) {} });

  const W = bp.width;
  const isMobile = bp.hint === "mobile";
  const GAP = 80;

  // Calculate pageX: position new frames after existing ones that are kept,
  // or in the correct slot if generating into a gap
  let hasAnyExisting = false;
  for (const ek in existingPositions) {
    // Only count frames that were NOT removed (i.e. kept sections)
    let isKept = true;
    if (ek === "promo/hero" && sections.hero) isKept = false;
    if ((ek === "promo/popup" || ek === "promo/popup-thankyou") && sections.popup) isKept = false;
    if (ek === "promo/banner" && sections.banner) isKept = false;
    if (isKept) hasAnyExisting = true;
  }

  // Build a slot map: for each section in order, determine the x position it should occupy
  let pageX = 0;
  if (hasAnyExisting) {
    // Find the rightmost edge of all kept frames to place new frames after them,
    // or use existing slot positions for sections that had a known position
    let slotX = 0;
    for (let si = 0; si < SECTION_ORDER.length; si++) {
      const sName = SECTION_ORDER[si];
      const ep = existingPositions[sName];
      if (ep) {
        // This section existed — if it's kept, advance past it; if removed, this is the slot for regeneration
        let isRemoved = false;
        if (sName === "promo/hero" && sections.hero) isRemoved = true;
        if ((sName === "promo/popup" || sName === "promo/popup-thankyou") && sections.popup) isRemoved = true;
        if (sName === "promo/banner" && sections.banner) isRemoved = true;
        if (!isRemoved) {
          slotX = ep.x + ep.width + GAP;
        }
      }
    }
    // Start new frames at the rightmost kept frame's edge
    pageX = slotX;
  }

  // Track created frames so we can fix layer order at the end
  const createdFrames = [];

  const popupIncludeForm = msg.popupIncludeForm !== false;

  // ── Helper: create a top-level section frame ──
  function createSectionFrame(name, width, height) {
    const f = figma.createFrame();
    f.name = name;
    f.resize(width, height);
    f.x = bpCtx.pageX; f.y = 0;
    f.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    ctx.promoBindFill(f, "white");
    f.clipsContent = true;
    // Set constraints so frame scales horizontally
    try { f.constraints = { horizontal: "SCALE", vertical: "MIN" }; } catch(e) {}
    // Figma's "Opacity" property uses percentage values (0-100), so set Percentage mode
    if (ctx.opacityColId && ctx.opacityPctModeId) {
      try { f.setExplicitVariableModeForCollection(ctx.opacityColId, ctx.opacityPctModeId); } catch(e) {}
    }
    page.appendChild(f);
    createdFrames.push(f);
    return f;
  }

  // ── Helper: create a CTA using Button component instance ──
  async function createCta(parent, text) {
    if (ctx.btnVariant) {
      let inst = null;
      try {
        inst = ctx.btnVariant.createInstance();
        const txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
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
    const btn = figma.createFrame();
    btn.name = "cta-button";
    btn.cornerRadius = ctx.defaultRadius;
    ctx.bindRadius(btn, "md");
    btn.fills = [{ type: "SOLID", color: ctx.brandFigma }];
    btn.layoutMode = "HORIZONTAL";
    btn.primaryAxisAlignItems = "CENTER";
    btn.counterAxisAlignItems = "CENTER";
    btn.primaryAxisSizingMode = "AUTO";
    btn.counterAxisSizingMode = "AUTO";
    const btnPadH = isMobile ? 20 : 28;
    const btnPadV = isMobile ? 10 : 14;
    btn.paddingLeft = btnPadH; btn.paddingRight = btnPadH;
    btn.paddingTop = btnPadV; btn.paddingBottom = btnPadV;
    const btnPadHVar = await ctx.findSpacingVar(btnPadH);
    if (btnPadHVar) {
      try { btn.setBoundVariable("paddingLeft", btnPadHVar); btn.setBoundVariable("paddingRight", btnPadHVar); } catch(e) {}
    }
    const btnPadVVar = await ctx.findSpacingVar(btnPadV);
    if (btnPadVVar) {
      try { btn.setBoundVariable("paddingTop", btnPadVVar); btn.setBoundVariable("paddingBottom", btnPadVVar); } catch(e) {}
    }
    const txt = figma.createText();
    const btnTxtStyle = ctx.findPromoTextStyle("buttons", isMobile ? "sm" : "default");
    if (btnTxtStyle) {
      await txt.setTextStyleIdAsync(btnTxtStyle.id);
    } else {
      txt.fontName = { family: "Inter", style: "Semi Bold" };
      txt.fontSize = isMobile ? 14 : 16;
    }
    txt.characters = text;
    txt.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    ctx.promoBindFill(txt, "white");
    btn.fills = [{ type: "SOLID", color: ctx.brandFigma }];
    ctx.promoBindFill(btn, "brand/primary");
    btn.appendChild(txt);
    parent.appendChild(btn);
    return btn;
  }

  // ── Helper: create an Input component instance with label override ──
  async function createInput(parent, labelText) {
    if (ctx.inputVariant) {
      let inst = null;
      try {
        inst = ctx.inputVariant.createInstance();
        const txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
        for (let ti = 0; ti < txtNodes.length; ti++) {
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
    const wrapper = figma.createFrame();
    wrapper.name = "input-" + labelText.toLowerCase().replace(/\s+/g, "-");
    wrapper.layoutMode = "VERTICAL";
    wrapper.primaryAxisSizingMode = "AUTO";
    wrapper.counterAxisSizingMode = "FILL_PARENT";
    wrapper.itemSpacing = 6;
    const wrapGapVar = await ctx.findSpacingVar(6);
    if (wrapGapVar) { try { wrapper.setBoundVariable("itemSpacing", wrapGapVar); } catch(e) {} }
    wrapper.fills = [];
    const lbl = figma.createText();
    const lblFbStyle = ctx.findPromoTextStyle("label", "default");
    if (lblFbStyle) {
      await lbl.setTextStyleIdAsync(lblFbStyle.id);
    } else {
      lbl.fontName = { family: "Inter", style: "Medium" };
      lbl.fontSize = 12;
    }
    lbl.characters = labelText;
    lbl.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
    ctx.promoBindFill(lbl, "text/primary");
    wrapper.appendChild(lbl);
    const fld = figma.createFrame();
    fld.name = "field";
    fld.cornerRadius = ctx.defaultRadius;
    ctx.bindRadius(fld, "md");
    fld.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.98 } }];
    ctx.promoBindFill(fld, "white");
    fld.strokes = [{ type: "SOLID", color: { r: 0.82, g: 0.82, b: 0.82 } }];
    ctx.promoBindStroke(fld, "border/default");
    fld.strokeWeight = 1;
    ctx.bindBorderWidth(fld);
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
    if (ctx.dropdownVariant) {
      let inst = null;
      try {
        inst = ctx.dropdownVariant.createInstance();
        const txtNodes = inst.findAll(function(n) { return n.type === "TEXT"; });
        for (let ti = 0; ti < txtNodes.length; ti++) {
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
    if (ctx.overlayVar) {
      node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }];
      try { node.fills = [figma.variables.setBoundVariableForPaint(node.fills[0], "color", ctx.overlayVar)]; } catch(e) {
        node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.85 }];
      }
    } else {
      node.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.85 }];
    }
  }

  const bpCtx: BreakpointContext = {
    page,
    W,
    isMobile,
    GAP,
    pageX,
    createdFrames,
    createSectionFrame,
    createCta,
    createInput,
    createDropdown,
    applyOverlayFill,
  };

  return bpCtx;
}

// ════════════════════════════════════════════════════════════════════
// 1. HERO
// ════════════════════════════════════════════════════════════════════
async function generateHeroSection(ctx: PromoContext, bpCtx: BreakpointContext, msg): Promise<void> {
  const { W, isMobile } = bpCtx;
  const heroMinH = isMobile ? 400 : 500;
  const hero = bpCtx.createSectionFrame("promo/hero", W, heroMinH);
  // Auto-layout: center children both axes
  hero.layoutMode = "VERTICAL";
  hero.primaryAxisAlignItems = "CENTER";
  hero.counterAxisAlignItems = "CENTER";
  hero.primaryAxisSizingMode = "AUTO";
  hero.counterAxisSizingMode = "FIXED";
  hero.minHeight = heroMinH;
  await ctx.bindPaddingXY(hero, 0, 128);

  // Background placeholder image (absolute, fills parent)
  let heroBg;
  if (ctx.bgImageVariant) {
    heroBg = ctx.bgImageVariant.createInstance();
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
    heroBg.fills = [{ type: "IMAGE", imageHash: ctx.placeholderHash, scaleMode: "FILL" }];
    heroBg.exportSettings = ctx.exportSettings;
  }

  // Centered content frame (auto-layout vertical, centered, fills parent width)
  const content = figma.createFrame();
  content.name = "hero-content";
  content.resize(isMobile ? W - 40 : 800, 1);
  content.fills = [];
  content.layoutMode = "VERTICAL";
  content.primaryAxisAlignItems = "CENTER";
  content.counterAxisAlignItems = "CENTER";
  content.primaryAxisSizingMode = "AUTO";
  content.counterAxisSizingMode = "AUTO";
  content.itemSpacing = isMobile ? 12 : 16;
  ctx.bindSpacing(content, 0, isMobile ? 12 : 16);
  hero.appendChild(content);
  content.layoutSizingHorizontal = "FILL";
  content.maxWidth = isMobile ? W - 40 : 800;

  // Heading
  const h1 = figma.createText();
  const h1Style = isMobile ? ctx.tsH1Mobile : ctx.tsH1;
  if (h1Style) {
    await h1.setTextStyleIdAsync(h1Style.id);
  } else {
    h1.fontName = { family: "Inter", style: "Bold" };
    h1.fontSize = isMobile ? 28 : 48;
  }
  h1.characters = "Headline goes here";
  const h1Fill = { type: "SOLID", color: { r: 1, g: 1, b: 1 } };
  const h1ColorVar = await findNearestColorVar(h1Fill.color, ctx.allColorVars);
  h1.fills = h1ColorVar ? [figma.variables.setBoundVariableForPaint(h1Fill, "color", h1ColorVar)] : [h1Fill];
  h1.textAlignHorizontal = "CENTER";
  content.appendChild(h1);

  // Placeholder image between heading and paragraph
  const heroImg = figma.createRectangle();
  heroImg.name = "hero-image";
  heroImg.resize(isMobile ? W - 60 : 400, isMobile ? 160 : 240);
  heroImg.cornerRadius = ctx.defaultRadius;
  ctx.bindRadius(heroImg, "md");
  heroImg.fills = [{ type: "IMAGE", imageHash: ctx.contentImageHash, scaleMode: "FILL" }];
  heroImg.exportSettings = ctx.exportSettings;
  content.appendChild(heroImg);
  try { heroImg.layoutSizingHorizontal = "FILL"; } catch(e) {}
  heroImg.maxWidth = isMobile ? W - 60 : 400;

  // Paragraph
  const sub = figma.createText();
  const subStyle = isMobile ? ctx.tsBodyMobile : ctx.tsBody;
  if (subStyle) {
    await sub.setTextStyleIdAsync(subStyle.id);
  } else {
    sub.fontName = { family: "Inter", style: "Regular" };
    sub.fontSize = isMobile ? 14 : 18;
  }
  sub.characters = "Supporting text that describes the promo offer or key message.";
  const subFill = { type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } };
  const subColorVar = await findNearestColorVar(subFill.color, ctx.allColorVars);
  sub.fills = subColorVar ? [figma.variables.setBoundVariableForPaint(subFill, "color", subColorVar)] : [subFill];
  sub.textAlignHorizontal = "CENTER";
  sub.textAutoResize = "HEIGHT";
  content.appendChild(sub);
  try { sub.layoutSizingHorizontal = "FILL"; } catch(e) {
    sub.resize((isMobile ? W - 40 : 800) - 40, sub.height);
  }

  // CTA
  await bpCtx.createCta(content, "Call to Action");

  // Resize bg to match final parent size
  heroBg.resize(hero.width, hero.height);

  bpCtx.pageX += W + bpCtx.GAP;
}

// ════════════════════════════════════════════════════════════════════
// 2. POPUP (default screen — with or without form)
// ════════════════════════════════════════════════════════════════════
async function generatePopupSection(ctx: PromoContext, bpCtx: BreakpointContext, msg): Promise<void> {
  const { W, isMobile } = bpCtx;
  const popupIncludeForm = msg.popupIncludeForm !== false;
  const popMinH = isMobile ? 400 : 420;
  const popup = bpCtx.createSectionFrame("promo/popup", W, popMinH);
  popup.fills = [];
  // Auto-layout: center popup-content
  popup.layoutMode = "VERTICAL";
  popup.primaryAxisAlignItems = "CENTER";
  popup.counterAxisAlignItems = "CENTER";
  popup.primaryAxisSizingMode = "AUTO";
  popup.counterAxisSizingMode = "FIXED";
  popup.minHeight = popMinH;
  await ctx.bindPaddingXY(popup, 0, 128);

  // popup-overlay (absolute, fills parent, uses overlay variable)
  const overlay = figma.createRectangle();
  overlay.name = "popup-overlay";
  overlay.resize(W, popMinH);
  popup.appendChild(overlay);
  overlay.layoutPositioning = "ABSOLUTE";
  overlay.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
  overlay.x = 0; overlay.y = 0;
  bpCtx.applyOverlayFill(overlay);

  // popup-content (fills parent, uses native maxWidth)
  popup.paddingLeft = 16; popup.paddingRight = 16;
  const popPadVar = await ctx.findSpacingVar(16);
  if (popPadVar) {
    try {
      popup.setBoundVariable("paddingLeft", popPadVar);
      popup.setBoundVariable("paddingRight", popPadVar);
    } catch(e) {}
  }
  const pcMaxW = isMobile ? 375 : 700;
  const pcMinH = isMobile ? 300 : 320;
  const pc = figma.createFrame();
  pc.name = "popup-content";
  pc.resize(pcMaxW, pcMinH);
  pc.cornerRadius = ctx.defaultRadius * 2;
  ctx.bindRadius(pc, "lg");
  pc.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  ctx.promoBindFill(pc, "white");
  await ctx.applyPromoShadow(pc);
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
  let pcBg;
  if (ctx.bgImageVariant) {
    pcBg = ctx.bgImageVariant.createInstance();
    pcBg.name = "popup-bg-image";
    pcBg.resize(pcMaxW, pcMinH);
    pc.appendChild(pcBg);
    pcBg.layoutPositioning = "ABSOLUTE";
    pcBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    pcBg.x = 0; pcBg.y = 0;
    pcBg.opacity = 0.15;
    ctx.bindPromoOpacity(pcBg);
  } else {
    pcBg = figma.createRectangle();
    pcBg.name = "popup-bg-image";
    pcBg.resize(pcMaxW, pcMinH);
    pc.appendChild(pcBg);
    pcBg.layoutPositioning = "ABSOLUTE";
    pcBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    pcBg.x = 0; pcBg.y = 0;
    pcBg.fills = [{ type: "IMAGE", imageHash: ctx.placeholderHash, scaleMode: "FILL" }];
    pcBg.exportSettings = ctx.exportSettings;
    pcBg.opacity = 0.15;
    ctx.bindPromoOpacity(pcBg);
  }

  if (popupIncludeForm) {
    // ── Popup with form — auto-layout popup-inner ──
    const fPad = 32;
    const fGap = isMobile ? 12 : 16;

    const formInner = figma.createFrame();
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
    ctx.bindSpacing(formInner, fPad, fGap);
    pc.appendChild(formInner);
    try {
      formInner.layoutSizingHorizontal = "FILL";
      formInner.layoutSizingVertical = "HUG";
    } catch(e) {}

    // Paragraph
    const pText = figma.createText();
    const pStyle = isMobile ? ctx.tsSmall : ctx.tsBody;
    if (pStyle) {
      await pText.setTextStyleIdAsync(pStyle.id);
    } else {
      pText.fontName = { family: "Inter", style: "Regular" };
      pText.fontSize = isMobile ? 13 : 15;
    }
    pText.characters = "Fill in the form below to claim your offer.";
    pText.fills = [{ type: "SOLID", color: { r: 0.3, g: 0.3, b: 0.3 } }];
    ctx.promoBindFill(pText, "text/primary");
    pText.textAlignHorizontal = "CENTER";
    pText.textAutoResize = "HEIGHT";
    formInner.appendChild(pText);
    try { pText.layoutSizingHorizontal = "FILL"; } catch(e) {
      pText.resize(pcMaxW - fPad * 2, pText.height);
    }

    // Form wrapper
    const formDiv = figma.createFrame();
    formDiv.name = "form";
    formDiv.fills = [];
    formDiv.layoutMode = "VERTICAL";
    formDiv.primaryAxisSizingMode = "AUTO";
    formDiv.counterAxisSizingMode = "AUTO";
    formDiv.itemSpacing = 16;
    ctx.bindSpacing(formDiv, 0, isMobile ? 12 : 16);
    formInner.appendChild(formDiv);
    formDiv.layoutSizingHorizontal = "FILL";

    // Form rows — from grid layout (array of arrays) or fallback
    let formRows;
    if (msg.formRows?.length > 0) {
      formRows = msg.formRows;
    } else {
      // Legacy fallback
      formRows = [
        [{ label: "First name", required: true }, { label: "Last name", required: true }],
        [{ label: "Email address", required: true }, { label: "Phone number", required: true }],
        [{ label: "Select your store", dropdown: true, required: true }]
      ];
    }
    const colGap = isMobile ? 12 : 16;

    for (let ri = 0; ri < formRows.length; ri++) {
      const rowData = formRows[ri];
      const rowFrame = figma.createFrame();
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
      const rowGapVar = ctx.gridGutterVar || await ctx.findSpacingVar(colGap);
      if (rowGapVar) {
        try { rowFrame.setBoundVariable("itemSpacing", rowGapVar); } catch(e) {}
        if (!isMobile) {
          try { rowFrame.setBoundVariable("counterAxisSpacing", rowGapVar); } catch(e) {}
        }
      }
      formDiv.appendChild(rowFrame);
      rowFrame.layoutSizingHorizontal = "FILL";

      // Calculate 12-column grid unit width
      const rowWidth = rowFrame.width;
      const unitCol = (rowWidth - 11 * colGap) / 12;

      for (let ci = 0; ci < rowData.length; ci++) {
        const fld = rowData[ci];
        const span = fld.colSpan || Math.floor(12 / rowData.length);
        const fieldLabel = fld.required ? fld.label + " *" : fld.label;
        const inp = fld.dropdown
          ? await bpCtx.createDropdown(rowFrame, fieldLabel)
          : await bpCtx.createInput(rowFrame, fieldLabel);

        try { inp.layoutSizingHorizontal = "FILL"; } catch(e) {}

        // Store grid column span for HTML export
        try { inp.setPluginData("colSpan", String(span)); } catch(e) {}

        // Set maxWidth proportionally so fields respect grid proportions in Figma
        if (!isMobile) {
          let totalRowSpan = 0;
          for (let si = 0; si < rowData.length; si++) totalRowSpan += (rowData[si].colSpan || Math.floor(12 / rowData.length));
          const fieldMaxW = Math.round((span / totalRowSpan) * (rowWidth - Math.max(0, rowData.length - 1) * colGap));
          try { inp.maxWidth = fieldMaxW; } catch(e) {}
          // Set minWidth for wrapping breakpoint
          const fieldMinW = Math.round(span * unitCol + Math.max(0, span - 1) * colGap);
          try { inp.minWidth = fieldMinW; } catch(e) {}
          if (ctx.gridColVarMap[span]) {
            try { inp.setBoundVariable("minWidth", ctx.gridColVarMap[span]); } catch(e) {}
          }
        }
        // Color the asterisk red on required fields and store required state
        if (fld.required) {
          try { inp.setPluginData("required", "true"); } catch(e) {}
          const txtNodes = inp.findAll(function(n) { return n.type === "TEXT"; });
          for (let ti = 0; ti < txtNodes.length; ti++) {
            const tn = txtNodes[ti];
            const starIdx = tn.characters.lastIndexOf(" *");
            if (starIdx !== -1) {
              try {
                tn.setRangeFills(starIdx + 1, starIdx + 2, [{ type: "SOLID", color: { r: 0.9, g: 0.2, b: 0.2 } }]);
              } catch(e) {}
            }
          }
        }
        const innerField = inp.findOne(function(n) { return n.name === "field"; });
        if (innerField) {
          try { innerField.layoutSizingHorizontal = "FILL"; } catch(e) {}
        }
      }
    }

    // Submit CTA in form-actions wrapper
    const formActions = figma.createFrame();
    formActions.name = "form-actions";
    formActions.fills = [];
    formActions.layoutMode = "HORIZONTAL";
    formActions.primaryAxisAlignItems = "CENTER";
    formActions.primaryAxisSizingMode = "AUTO";
    formActions.counterAxisSizingMode = "AUTO";
    formDiv.appendChild(formActions);
    formActions.layoutSizingHorizontal = "FILL";
    await bpCtx.createCta(formActions, "Submit");

  } else {
    // ── Popup without form — text + CTA centered ──
    const nfPad = 32;
    const nfGap = isMobile ? 12 : 20;
    const innerFrame = figma.createFrame();
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
    ctx.bindSpacing(innerFrame, nfPad, nfGap);
    pc.appendChild(innerFrame);
    try {
      innerFrame.layoutSizingHorizontal = "FILL";
      innerFrame.layoutSizingVertical = "HUG";
    } catch(e) {}

    const popTxt = figma.createText();
    const popTxtStyle = isMobile ? ctx.tsBodyMobile : ctx.tsBody;
    if (popTxtStyle) {
      await popTxt.setTextStyleIdAsync(popTxtStyle.id);
    } else {
      popTxt.fontName = { family: "Inter", style: "Regular" };
      popTxt.fontSize = isMobile ? 14 : 16;
    }
    popTxt.characters = "Promotional message or announcement text goes here.";
    popTxt.fills = [{ type: "SOLID", color: ctx.textFigma }];
    ctx.promoBindFill(popTxt, "text/primary");
    popTxt.textAlignHorizontal = "CENTER";
    popTxt.textAutoResize = "HEIGHT";
    innerFrame.appendChild(popTxt);
    try { popTxt.layoutSizingHorizontal = "FILL"; } catch(e) {
      popTxt.resize(pcMaxW - 64 - 40, popTxt.height);
    }

    await bpCtx.createCta(innerFrame, "Call to Action");
  }

  // Close button (absolute, top-right) — appended last so it layers on top
  const closeSize = isMobile ? 15 : 19;
  const closeBtn = figma.createFrame();
  closeBtn.name = "close-button";
  closeBtn.fills = [];
  closeBtn.layoutMode = "HORIZONTAL";
  closeBtn.primaryAxisSizingMode = "AUTO";
  closeBtn.counterAxisSizingMode = "AUTO";
  closeBtn.primaryAxisAlignItems = "CENTER";
  closeBtn.counterAxisAlignItems = "CENTER";
  await ctx.bindPaddingXY(closeBtn, isMobile ? 16 : 28, isMobile ? 20 : 32);
  const closeIcon = figma.createRectangle();
  closeIcon.name = "close-icon";
  closeIcon.resize(closeSize, closeSize);
  closeIcon.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: ctx.closeImageHash }];
  closeIcon.exportSettings = ctx.exportSettings;
  closeBtn.appendChild(closeIcon);
  pc.appendChild(closeBtn);
  closeBtn.layoutPositioning = "ABSOLUTE";
  closeBtn.constraints = { horizontal: "MAX", vertical: "MIN" };
  closeBtn.x = pcMaxW - closeBtn.width;
  closeBtn.y = 0;

  // Resize overlay to match final parent size
  overlay.resize(popup.width, popup.height);

  bpCtx.pageX += W + bpCtx.GAP;
}

// ══════════════════════════════════════════════════════════════════
// 3. POPUP THANK-YOU (only when popup has a form)
// ══════════════════════════════════════════════════════════════════
async function generateThankYouSection(ctx: PromoContext, bpCtx: BreakpointContext, msg): Promise<void> {
  const { W, isMobile } = bpCtx;
  const tyPopMinH = isMobile ? 400 : 420;
  const tyPopup = bpCtx.createSectionFrame("promo/popup-thankyou", W, tyPopMinH);
  tyPopup.fills = [];
  // Auto-layout: center popup-content
  tyPopup.layoutMode = "VERTICAL";
  tyPopup.primaryAxisAlignItems = "CENTER";
  tyPopup.counterAxisAlignItems = "CENTER";
  tyPopup.primaryAxisSizingMode = "AUTO";
  tyPopup.counterAxisSizingMode = "FIXED";
  tyPopup.minHeight = tyPopMinH;
  await ctx.bindPaddingXY(tyPopup, 0, 128);
  if (isMobile) {
    tyPopup.maxWidth = MOBILE_BREAKPOINT;
  }

  // overlay (absolute, fills parent)
  const tyOverlay = figma.createRectangle();
  tyOverlay.name = "popup-overlay";
  tyOverlay.resize(W, tyPopMinH);
  tyPopup.appendChild(tyOverlay);
  tyOverlay.layoutPositioning = "ABSOLUTE";
  tyOverlay.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
  tyOverlay.x = 0; tyOverlay.y = 0;
  bpCtx.applyOverlayFill(tyOverlay);

  // popup-content (fills parent, uses native maxWidth)
  tyPopup.paddingLeft = 16; tyPopup.paddingRight = 16;
  const tyPopPadVar = await ctx.findSpacingVar(16);
  if (tyPopPadVar) {
    try {
      tyPopup.setBoundVariable("paddingLeft", tyPopPadVar);
      tyPopup.setBoundVariable("paddingRight", tyPopPadVar);
    } catch(e) {}
  }
  const tyPcMaxW = isMobile ? 375 : 700;
  const tyPcMinH = isMobile ? 300 : 320;
  const tyPc = figma.createFrame();
  tyPc.name = "popup-content";
  tyPc.resize(tyPcMaxW, tyPcMinH);
  tyPc.cornerRadius = ctx.defaultRadius * 2;
  ctx.bindRadius(tyPc, "lg");
  tyPc.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  ctx.promoBindFill(tyPc, "white");
  await ctx.applyPromoShadow(tyPc);
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
  let tyBg;
  if (ctx.bgImageVariant) {
    tyBg = ctx.bgImageVariant.createInstance();
    tyBg.name = "popup-bg-image";
    tyBg.resize(tyPcMaxW, tyPcMinH);
    tyPc.appendChild(tyBg);
    tyBg.layoutPositioning = "ABSOLUTE";
    tyBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    tyBg.x = 0; tyBg.y = 0;
    tyBg.opacity = 0.15;
    ctx.bindPromoOpacity(tyBg);
  } else {
    tyBg = figma.createRectangle();
    tyBg.name = "popup-bg-image";
    tyBg.resize(tyPcMaxW, tyPcMinH);
    tyPc.appendChild(tyBg);
    tyBg.layoutPositioning = "ABSOLUTE";
    tyBg.constraints = { horizontal: "SCALE", vertical: "SCALE" };
    tyBg.x = 0; tyBg.y = 0;
    tyBg.fills = [{ type: "IMAGE", imageHash: ctx.placeholderHash, scaleMode: "FILL" }];
    tyBg.exportSettings = ctx.exportSettings;
    tyBg.opacity = 0.15;
    ctx.bindPromoOpacity(tyBg);
  }

  // Centered text + CTA
  const tyPad = 32;
  const tyGap = isMobile ? 12 : 20;
  const tyInner = figma.createFrame();
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
  ctx.bindSpacing(tyInner, tyPad, tyGap);
  tyPc.appendChild(tyInner);
  try {
    tyInner.layoutSizingHorizontal = "FILL";
    tyInner.layoutSizingVertical = "HUG";
  } catch(e) {}

  const tyTxt = figma.createText();
  const tyTxtStyle = isMobile ? ctx.tsBodyMobile : ctx.tsBody;
  if (tyTxtStyle) {
    await tyTxt.setTextStyleIdAsync(tyTxtStyle.id);
  } else {
    tyTxt.fontName = { family: "Inter", style: "Regular" };
    tyTxt.fontSize = isMobile ? 14 : 16;
  }
  tyTxt.characters = "Thank you! Your submission has been received.";
  tyTxt.fills = [{ type: "SOLID", color: ctx.textFigma }];
  ctx.promoBindFill(tyTxt, "text/primary");
  tyTxt.textAlignHorizontal = "CENTER";
  tyTxt.textAutoResize = "HEIGHT";
  tyInner.appendChild(tyTxt);
  try { tyTxt.layoutSizingHorizontal = "FILL"; } catch(e) {
    tyTxt.resize(tyPcMaxW - 64 - 40, tyTxt.height);
  }

  // Placeholder image
  const tyImg = figma.createRectangle();
  tyImg.name = "thankyou-image";
  tyImg.resize(isMobile ? 140 : 200, isMobile ? 100 : 140);
  tyImg.cornerRadius = ctx.defaultRadius;
  ctx.bindRadius(tyImg, "md");
  tyImg.fills = [{ type: "IMAGE", imageHash: ctx.contentImageHash, scaleMode: "FILL" }];
  tyInner.appendChild(tyImg);

  await bpCtx.createCta(tyInner, "Continue");

  // Close button (absolute, top-right) — appended last so it layers on top
  const tyCloseSize = isMobile ? 15 : 19;
  const tyCloseBtn = figma.createFrame();
  tyCloseBtn.name = "close-button";
  tyCloseBtn.fills = [];
  tyCloseBtn.layoutMode = "HORIZONTAL";
  tyCloseBtn.primaryAxisSizingMode = "AUTO";
  tyCloseBtn.counterAxisSizingMode = "AUTO";
  tyCloseBtn.primaryAxisAlignItems = "CENTER";
  tyCloseBtn.counterAxisAlignItems = "CENTER";
  await ctx.bindPaddingXY(tyCloseBtn, isMobile ? 16 : 28, isMobile ? 20 : 32);
  const tyCloseIcon = figma.createRectangle();
  tyCloseIcon.name = "close-icon";
  tyCloseIcon.resize(tyCloseSize, tyCloseSize);
  tyCloseIcon.fills = [{ type: "IMAGE", scaleMode: "FIT", imageHash: ctx.closeImageHash }];
  tyCloseBtn.appendChild(tyCloseIcon);
  tyPc.appendChild(tyCloseBtn);
  tyCloseBtn.layoutPositioning = "ABSOLUTE";
  tyCloseBtn.constraints = { horizontal: "MAX", vertical: "MIN" };
  tyCloseBtn.x = tyPcMaxW - tyCloseBtn.width;
  tyCloseBtn.y = 0;

  // Resize overlay to match final parent size
  tyOverlay.resize(tyPopup.width, tyPopup.height);

  bpCtx.pageX += W + bpCtx.GAP;
}

// ════════════════════════════════════════════════════════════════════
// 4. BANNER
// ════════════════════════════════════════════════════════════════════
async function generateBannerSection(ctx: PromoContext, bpCtx: BreakpointContext, msg): Promise<void> {
  const { W, isMobile } = bpCtx;
  const innerW = isMobile ? W - 24 : 1315;
  const innerH = isMobile ? 160 : 240;
  const bannerH = innerH + 60;
  const banner = bpCtx.createSectionFrame("promo/banner", W, bannerH);
  banner.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  ctx.promoBindFill(banner, "white");
  // Auto-layout to center inner-banner
  banner.layoutMode = "VERTICAL";
  banner.primaryAxisAlignItems = "CENTER";
  banner.counterAxisAlignItems = "CENTER";
  banner.primaryAxisSizingMode = "AUTO";
  banner.counterAxisSizingMode = "FIXED";
  await ctx.bindPaddingXY(banner, 0, 24);

  // inner-banner with background image, horizontal layout: image + CTA
  const innerBanner = figma.createFrame();
  innerBanner.name = "inner-banner";
  innerBanner.resize(innerW, innerH);
  innerBanner.clipsContent = true;
  innerBanner.cornerRadius = ctx.defaultRadius;
  ctx.bindRadius(innerBanner, "md");
  innerBanner.layoutMode = isMobile ? "VERTICAL" : "HORIZONTAL";
  innerBanner.primaryAxisAlignItems = "CENTER";
  innerBanner.counterAxisAlignItems = "CENTER";
  innerBanner.primaryAxisSizingMode = "AUTO";
  innerBanner.counterAxisSizingMode = "FIXED";
  if (ctx.bgImageVariant) {
    innerBanner.fills = [];
    const bannerBg = ctx.bgImageVariant.createInstance();
    bannerBg.name = "banner-bg-image";
    bannerBg.resize(innerW, innerH);
    innerBanner.appendChild(bannerBg);
    bannerBg.layoutPositioning = "ABSOLUTE";
    bannerBg.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    bannerBg.x = 0; bannerBg.y = 0;
  } else {
    innerBanner.fills = [{ type: "IMAGE", imageHash: ctx.placeholderHash, scaleMode: "FILL" }];
  }
  const bannerPadPx = isMobile ? 16 : 40;
  const bannerGapPx = isMobile ? 16 : 32;
  innerBanner.paddingLeft = bannerPadPx;
  innerBanner.paddingRight = bannerPadPx;
  innerBanner.paddingTop = 24; innerBanner.paddingBottom = 24;
  innerBanner.itemSpacing = bannerGapPx;
  const innerBannerTBVar = await ctx.findSpacingVar(24);
  if (innerBannerTBVar) {
    try {
      innerBanner.setBoundVariable("paddingTop", innerBannerTBVar);
      innerBanner.setBoundVariable("paddingBottom", innerBannerTBVar);
    } catch(e) {}
  }
  const bannerPadVar = await ctx.findSpacingVar(bannerPadPx);
  const bannerGapVar = await ctx.findSpacingVar(bannerGapPx);
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
  const bannerImg = figma.createRectangle();
  bannerImg.name = "banner-image";
  bannerImg.resize(isMobile ? 100 : 200, isMobile ? 80 : 140);
  bannerImg.cornerRadius = ctx.defaultRadius;
  ctx.bindRadius(bannerImg, "md");
  bannerImg.fills = [{ type: "IMAGE", imageHash: ctx.contentImageHash, scaleMode: "FILL" }];
  bannerImg.exportSettings = ctx.exportSettings;
  innerBanner.appendChild(bannerImg);
  bannerImg.maxWidth = isMobile ? 100 : 200;

  await bpCtx.createCta(innerBanner, "Learn More");

  bpCtx.pageX += W + bpCtx.GAP;
}

export async function generatePromoStructure(msg) {
  const sections = msg.sections || {};
  const popupIncludeForm = msg.popupIncludeForm !== false;

  const ctx = await initPromoContext(msg);

  const BREAKPOINTS = [
    { hint: "desktop", width: 1920 },
    { hint: "mobile",  width: MOBILE_BREAKPOINT }
  ];

  for (let bi = 0; bi < BREAKPOINTS.length; bi++) {
    const bpCtx = await initBreakpointContext(BREAKPOINTS[bi], sections, ctx, msg);
    if (!bpCtx) continue;

    if (sections.hero) await generateHeroSection(ctx, bpCtx, msg);
    if (sections.popup) await generatePopupSection(ctx, bpCtx, msg);
    if (sections.popup && popupIncludeForm) await generateThankYouSection(ctx, bpCtx, msg);
    if (sections.banner) await generateBannerSection(ctx, bpCtx, msg);

    // Fix page-level layer order: first frame (hero) = top of layer panel.
    // Figma: last child = top of panel. So re-append in order, making
    // the last one (banner) end up at the top — then reverse.
    // Simplest: insert each frame at index 0 in creation order,
    // so the first created (hero) ends up as the last child (top of panel).
    for (let lri = 0; lri < bpCtx.createdFrames.length; lri++) {
      bpCtx.page.insertChild(0, bpCtx.createdFrames[lri]);
    }
  }
}
