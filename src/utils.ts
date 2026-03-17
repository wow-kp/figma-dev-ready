// Shared utilities for the Figma Dev-Ready plugin

export function rgb01ToHex(r,g,b) {
  return "#"+[r,g,b].map(function(v){ return Math.round(Math.min(255,Math.max(0,v*255))).toString(16).padStart(2,"0"); }).join("").toUpperCase();
}

export function resolveChain(variableId) {
  var chain=[],currentId=variableId,maxSteps=12,seen={};
  while (currentId && maxSteps-->0) {
    if (seen[currentId]){chain.push({name:"⚠ Circular reference",broken:true});break;}
    seen[currentId]=true;
    var v=figma.variables.getVariableById(currentId);
    if(!v){chain.push({name:"Broken reference — variable deleted or renamed",broken:true});break;}
    var col=figma.variables.getVariableCollectionById(v.variableCollectionId);
    var colName=col?col.name:"?";
    var modeId=col&&col.modes&&col.modes.length>0?col.modes[0].modeId:null;
    var val=modeId&&v.valuesByMode?v.valuesByMode[modeId]:null;
    if(val&&typeof val==="object"&&val.type==="VARIABLE_ALIAS"){
      chain.push({name:v.name,collection:colName,isAlias:true,resolvedType:v.resolvedType});
      currentId=val.id;
    } else {
      var display=null,hexColor=null;
      if(v.resolvedType==="COLOR"&&val){hexColor=rgb01ToHex(val.r||0,val.g||0,val.b||0);var a=val.a!==undefined?val.a:1;display=hexColor+(a<1?" / "+Math.round(a*100)+"%":"");}
      else if(v.resolvedType==="FLOAT") display=String(Math.round((Number(val)||0)*100)/100);
      else if(v.resolvedType==="STRING"){var s=String(val);display=s.length>44?s.slice(0,44)+"…":s;}
      else if(v.resolvedType==="BOOLEAN") display=String(val);
      chain.push({name:v.name,collection:colName,isAlias:false,resolvedType:v.resolvedType,displayValue:display,hexColor:hexColor});
      break;
    }
  }
  return chain;
}

export function countTokensByCategory(allVars, allCols) {
  var colorVars = 0, spacingVars = 0, radiusVars = 0, typographyVars = 0, shadowVars = 0, borderVars = 0, zindexVars = 0, breakpointVars = 0, gridVars = 0, opacityVars = 0, otherVars = 0;
  for (var vi = 0; vi < allVars.length; vi++) {
    var v = allVars[vi];
    var colName = "";
    for (var ci = 0; ci < allCols.length; ci++) {
      if (allCols[ci].id === v.variableCollectionId) { colName = allCols[ci].name.toLowerCase(); break; }
    }
    if (v.resolvedType === "COLOR") colorVars++;
    else if (colName === "grid") gridVars++;
    else if (colName.indexOf("spacing") !== -1 || colName.indexOf("gap") !== -1) spacingVars++;
    else if (colName.indexOf("radius") !== -1 || colName.indexOf("corner") !== -1) radiusVars++;
    else if (colName.indexOf("typography") !== -1 || colName.indexOf("font") !== -1) typographyVars++;
    else if (colName.indexOf("border") !== -1) borderVars++;
    else if (colName.indexOf("opacity") !== -1) opacityVars++;
    else if (colName.indexOf("z-index") !== -1 || colName.indexOf("zindex") !== -1) zindexVars++;
    else if (colName.indexOf("breakpoint") !== -1) breakpointVars++;
    else otherVars++;
  }
  return { colors: colorVars, spacing: spacingVars, radius: radiusVars, typography: typographyVars, shadows: shadowVars, border: borderVars, opacity: opacityVars, zindex: zindexVars, breakpoints: breakpointVars, grid: gridVars, other: otherVars };
}

export function getAuditPages(){
  var hints=["mobile","desktop"];
  var pages=[];
  for(var i=0;i<figma.root.children.length;i++){
    var p=figma.root.children[i];
    var n=p.name.toLowerCase().replace(/[^a-z]/g,"");
    for(var h=0;h<hints.length;h++){
      if(n.indexOf(hints[h])!==-1){pages.push(p);break;}
    }
  }
  return pages;
}

export function createPlaceholderImageHash(r, g, b) {
  // CRC32 table
  var crcT = [];
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcT[n] = c;
  }
  function crc32(buf) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < buf.length; i++) crc = crcT[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type, data) {
    var tb = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    var crcIn = tb.concat(data);
    var cv = crc32(crcIn);
    var len = data.length;
    return [(len >>> 24) & 0xFF, (len >>> 16) & 0xFF, (len >>> 8) & 0xFF, len & 0xFF]
      .concat(tb).concat(data)
      .concat([(cv >>> 24) & 0xFF, (cv >>> 16) & 0xFF, (cv >>> 8) & 0xFF, cv & 0xFF]);
  }
  // IHDR: 1x1, 8-bit RGB
  var ihdr = chunk("IHDR", [0,0,0,1, 0,0,0,1, 8, 2, 0, 0, 0]);
  // IDAT: zlib stored block wrapping filter-byte + RGB
  var raw = [0x00, r, g, b];
  var s1 = 1, s2 = 1;
  for (var ai = 0; ai < raw.length; ai++) { s1 = (s1 + raw[ai]) % 65521; s2 = (s2 + s1) % 65521; }
  var adler = ((s2 << 16) | s1) >>> 0;
  var lenLo = raw.length & 0xFF, lenHi = (raw.length >> 8) & 0xFF;
  var idat = chunk("IDAT", [0x78, 0x01, 0x01, lenLo, lenHi, lenLo ^ 0xFF, lenHi ^ 0xFF]
    .concat(raw)
    .concat([(adler >>> 24) & 0xFF, (adler >>> 16) & 0xFF, (adler >>> 8) & 0xFF, adler & 0xFF]));
  var iend = chunk("IEND", []);
  var sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  var all = sig.concat(ihdr).concat(idat).concat(iend);
  var img = figma.createImage(new Uint8Array(all));
  return img.hash;
}

export function findPageByHint(hint) {
  for (var i = 0; i < figma.root.children.length; i++) {
    if (figma.root.children[i].name.toLowerCase().replace(/[^a-z]/g, "").indexOf(hint) !== -1) {
      return figma.root.children[i];
    }
  }
  // Auto-create the page if not found
  var pageName = hint.charAt(0).toUpperCase() + hint.slice(1);
  var newPage = figma.createPage();
  newPage.name = pageName;
  return newPage;
}

export function hexToFigma(hex) {
  var h = hex.replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
}

export function createSpecText(parent, text, x, y, size, style, color, opacity) {
  var t = figma.createText();
  var s = style || "Regular";
  // Try exact style, then common variants
  var variants = [s];
  if (s === "SemiBold") variants.push("Semi Bold", "Semibold");
  else if (s === "Semi Bold") variants.push("SemiBold", "Semibold");
  else if (s === "ExtraBold") variants.push("Extra Bold", "Extrabold");
  else if (s === "ExtraLight") variants.push("Extra Light", "Extralight");
  variants.push("Regular"); // last resort
  for (var vi = 0; vi < variants.length; vi++) {
    try { t.fontName = { family: "Inter", style: variants[vi] }; break; } catch(e) {}
  }
  t.fontSize = size || 14;
  t.characters = text;
  t.fills = [{ type: "SOLID", color: color || { r:0.2, g:0.2, b:0.2 }, opacity: opacity !== undefined ? opacity : 1 }];
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
}

export function parseCssShadow(str) {
  if (!str || typeof str !== "string") return null;
  var inset = /\binset\b/.test(str);
  var clean = str.replace(/\binset\b/, "").trim();
  var rgbaMatch = clean.match(/rgba?\(([^)]+)\)/);
  var hexMatch = clean.match(/#([0-9a-fA-F]{3,8})/);
  var r = 0, g = 0, b = 0, a = 0.2;
  if (rgbaMatch) {
    var parts = rgbaMatch[1].split(",").map(function(v) { return parseFloat(v.trim()); });
    r = (parts[0] || 0) / 255; g = (parts[1] || 0) / 255; b = (parts[2] || 0) / 255; a = parts[3] !== undefined ? parts[3] : 1;
  } else if (hexMatch) {
    var h = hexMatch[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    r = parseInt(h.slice(0,2),16)/255; g = parseInt(h.slice(2,4),16)/255; b = parseInt(h.slice(4,6),16)/255;
    if (h.length === 8) a = parseInt(h.slice(6,8),16)/255;
  }
  var nums = clean.replace(/rgba?\([^)]+\)/, "").replace(/#[0-9a-fA-F]{3,8}/, "").trim().split(/\s+/).map(function(v) { return parseFloat(v) || 0; });
  return {
    type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: { r: r, g: g, b: b, a: a },
    offset: { x: nums[0] || 0, y: nums[1] || 0 },
    radius: nums[2] || 0,
    spread: nums[3] || 0,
    visible: true,
    blendMode: "NORMAL"
  };
}

export function cxResolveVar(v, modeId, allCols) {
  var val = v.valuesByMode[modeId];
  var seen = {};
  while (val && typeof val === "object" && val.type === "VARIABLE_ALIAS" && val.id && !seen[val.id]) {
    seen[val.id] = true;
    try {
      var aliased = figma.variables.getVariableById(val.id);
      if (!aliased) break;
      var ac = null;
      for (var i = 0; i < allCols.length; i++) { if (allCols[i].id === aliased.variableCollectionId) { ac = allCols[i]; break; } }
      if (!ac) break;
      if (!ac.modes || !ac.modes.length) break;
      val = aliased.valuesByMode[ac.modes[0].modeId];
    } catch(e) { break; }
  }
  return val;
}

export function cxColorToHex(rgb) {
  if (!rgb || !("r" in rgb)) return null;
  return "#" + [rgb.r, rgb.g, rgb.b].map(function(ch) { return Math.round(Math.min(255, Math.max(0, ch * 255))).toString(16).padStart(2, "0"); }).join("").toUpperCase();
}

export function cxFindCol(allCols, pattern) {
  for (var i = 0; i < allCols.length; i++) { if (allCols[i].name.toLowerCase().indexOf(pattern) !== -1) return allCols[i]; }
  return null;
}

export function cxGetFloats(col, allVars, allCols) {
  if (!col || !col.modes || !col.modes.length) return [];
  var mid = col.modes[0].modeId;
  var out = [];
  for (var i = 0; i < allVars.length; i++) {
    var v = allVars[i];
    if (v.variableCollectionId !== col.id || v.resolvedType !== "FLOAT") continue;
    var val = cxResolveVar(v, mid, allCols);
    var num = typeof val === "number" ? val : parseFloat(val) || 0;
    var parts = v.name.split("/");
    out.push({ name: parts[parts.length - 1], fullName: v.name, value: num, variable: v });
  }
  return out;
}

export function cxStripPrefix(name) { var i = name.indexOf("/"); return i !== -1 ? name.substring(i + 1) : name; }

export function ensureBackgroundImageVar() {
  var cols = figma.variables.getLocalVariableCollections();
  var flagsCol = null;
  for (var i = 0; i < cols.length; i++) { if (cols[i].name === "Flags") { flagsCol = cols[i]; break; } }
  if (!flagsCol) flagsCol = figma.variables.createVariableCollection("Flags");
  var existing = figma.variables.getLocalVariables().filter(function(v) {
    return v.variableCollectionId === flagsCol.id && v.resolvedType === "BOOLEAN";
  });
  for (var j = 0; j < existing.length; j++) {
    if (existing[j].name === "background-image") return existing[j];
  }
  var v = figma.variables.createVariable("background-image", flagsCol, "BOOLEAN");
  v.setValueForMode(flagsCol.modes[0].modeId, true);
  return v;
}

export function ensureEssentialColors() {
  var cols = figma.variables.getLocalVariableCollections();
  var colorCol = null;
  for (var i = 0; i < cols.length; i++) { if (cols[i].name === "Colors") { colorCol = cols[i]; break; } }
  if (!colorCol) colorCol = figma.variables.createVariableCollection("Colors");
  var existing = figma.variables.getLocalVariables().filter(function(v) {
    return v.variableCollectionId === colorCol.id && v.resolvedType === "COLOR";
  });
  var nameMap = {};
  for (var ei = 0; ei < existing.length; ei++) nameMap[existing[ei].name] = true;
  var modeId = colorCol.modes[0].modeId;
  var essential = [
    { name: "black",        color: { r: 0, g: 0, b: 0 } },
    { name: "white",        color: { r: 1, g: 1, b: 1 } },
    { name: "gray",         color: hexToFigma("#E3E3E3") },
    { name: "focus/border", color: { r: 0, g: 0, b: 0 } },
    { name: "focus/color",  color: hexToFigma("#79797B") },
    { name: "error/border", color: hexToFigma("#E32E22") },
    { name: "error/color",  color: hexToFigma("#E32E22") },
  ];
  for (var j = 0; j < essential.length; j++) {
    if (!nameMap[essential[j].name]) {
      try {
        var v = figma.variables.createVariable(essential[j].name, colorCol, "COLOR");
        v.setValueForMode(modeId, essential[j].color);
      } catch(e) {}
    }
  }
}

export async function ensureComponentTextStyles() {
  var existing = figma.getLocalTextStyles();
  var nameMap = {};
  for (var i = 0; i < existing.length; i++) nameMap[existing[i].name] = true;

  // Detect primary font family from existing text styles or typography vars
  var primaryFam = "Inter";
  for (var si = 0; si < existing.length; si++) {
    var fam = existing[si].fontName.family;
    if (fam && fam !== "Inter") { primaryFam = fam; break; }
  }
  if (primaryFam === "Inter") {
    var allCols = figma.variables.getLocalVariableCollections();
    var typCol = cxFindCol(allCols, "typography");
    if (typCol) {
      var allVars = figma.variables.getLocalVariables();
      var typMid = typCol.modes[0].modeId;
      for (var vi = 0; vi < allVars.length; vi++) {
        if (allVars[vi].variableCollectionId === typCol.id && allVars[vi].resolvedType === "STRING" && allVars[vi].name.toLowerCase().indexOf("family") !== -1) {
          var fv = String(cxResolveVar(allVars[vi], typMid, allCols) || "").split(",")[0].trim().replace(/['"]/g, "");
          if (fv && fv !== "Inter") { primaryFam = fv; break; }
        }
      }
    }
  }

  // Load needed font weights
  var weights = [400, 500, 600, 700];
  for (var wi = 0; wi < weights.length; wi++) {
    await loadFontWithFallback(primaryFam, weights[wi]);
  }

  // Define required component text styles
  var required = [
    { name: "buttons/lg",       family: primaryFam, weight: 600, size: 18 },
    { name: "buttons/default",  family: primaryFam, weight: 600, size: 16 },
    { name: "buttons/sm",       family: primaryFam, weight: 600, size: 14 },
    { name: "input/default",    family: primaryFam, weight: 400, size: 14 },
    { name: "label/default",    family: primaryFam, weight: 500, size: 12 },
    { name: "label/focused",    family: primaryFam, weight: 500, size: 12 },
    { name: "label/error",      family: primaryFam, weight: 500, size: 12 },
  ];

  for (var ri = 0; ri < required.length; ri++) {
    var r = required[ri];
    if (nameMap[r.name]) continue;
    try {
      var actualStyle = await loadFontWithFallback(r.family, r.weight);
      var ts = figma.createTextStyle();
      ts.name = r.name;
      ts.fontName = { family: r.family, style: actualStyle };
      ts.fontSize = r.size;
      ts.lineHeight = { unit: "PERCENT", value: 150 };
    } catch(e) {}
  }
}

export function weightToStyleCandidates(w) {
  var n = parseInt(w) || 400;
  if (n <= 100) return ["Thin"];
  if (n <= 200) return ["ExtraLight", "Extra Light", "UltraLight", "Ultra Light"];
  if (n <= 300) return ["Light"];
  if (n <= 400) return ["Regular"];
  if (n <= 500) return ["Medium"];
  if (n <= 600) return ["SemiBold", "Semi Bold", "DemiBold", "Demi Bold"];
  if (n <= 700) return ["Bold"];
  if (n <= 800) return ["ExtraBold", "Extra Bold", "UltraBold", "Ultra Bold"];
  return ["Black", "Heavy"];
}

export function weightToStyle(w) { return weightToStyleCandidates(w)[0]; }

export async function loadFontWithFallback(family, weight) {
  var candidates = weightToStyleCandidates(weight);
  for (var i = 0; i < candidates.length; i++) {
    try {
      await figma.loadFontAsync({ family: family, style: candidates[i] });
      return candidates[i]; // return the style that worked
    } catch(e) {}
  }
  // Last resort: try Regular
  try { await figma.loadFontAsync({ family: family, style: "Regular" }); } catch(e) {}
  return "Regular";
}

export function setFontName(node, family, weight) {
  var candidates = weightToStyleCandidates(weight);
  for (var i = 0; i < candidates.length; i++) {
    try {
      node.fontName = { family: family, style: candidates[i] };
      return candidates[i];
    } catch(e) {}
  }
  try { node.fontName = { family: "Inter", style: "Regular" }; } catch(e) {}
  return "Regular";
}

// Color math (hexToRgb255, rgbToHsl, hslToRgb01, hue2rgb, clamp) lives in tokens-generate.ts
