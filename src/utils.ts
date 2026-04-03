// Barrel re-export — utils.ts now delegates to focused sub-modules.
// Existing imports from './utils' continue to work unchanged.
// New code can import directly from the sub-module for clarity.

// Color conversion and parsing
export { rgb01ToHex, hexToFigma, cxColorToHex, parseCssShadow } from './color-utils';

// Font loading and style resolution
export { weightToStyleCandidates, weightToStyle, loadFontWithFallback, setFontName } from './font-utils';

// Variable resolution and collection utilities
export { resolveChain, countTokensByCategory, cxResolveVar, cxFindCol, cxGetFloats, cxStripPrefix } from './variable-utils';

// ── Page & DOM utilities (remain here — too coupled to Figma API to split cleanly) ──

export function getAuditPages() {
  const hints = ["mobile","desktop","components"];
  const pages: PageNode[] = [];
  for (let i = 0; i < figma.root.children.length; i++) {
    const p = figma.root.children[i];
    const n = p.name.toLowerCase().replace(/[^a-z]/g,"");
    for (let h = 0; h < hints.length; h++) {
      if (n.indexOf(hints[h]) !== -1) { pages.push(p); break; }
    }
  }
  return pages;
}

export function findPageByHint(hint: string): PageNode {
  for (let i = 0; i < figma.root.children.length; i++) {
    if (figma.root.children[i].name.toLowerCase().replace(/[^a-z]/g, "").indexOf(hint) !== -1) {
      return figma.root.children[i];
    }
  }
  const pageName = hint.charAt(0).toUpperCase() + hint.slice(1);
  const newPage = figma.createPage();
  newPage.name = pageName;
  try { (newPage as any).devStatus = null; } catch(e) {}
  return newPage;
}

export function createSpecText(parent: FrameNode | GroupNode, text: string, x: number, y: number, size: number, style?: string, color?: RGB, opacity?: number): TextNode {
  const t = figma.createText();
  const s = style || "Regular";
  const variants = [s];
  if (s === "SemiBold") variants.push("Semi Bold", "Semibold");
  else if (s === "Semi Bold") variants.push("SemiBold", "Semibold");
  else if (s === "ExtraBold") variants.push("Extra Bold", "Extrabold");
  else if (s === "ExtraLight") variants.push("Extra Light", "Extralight");
  variants.push("Regular");
  for (let vi = 0; vi < variants.length; vi++) {
    try { t.fontName = { family: "Inter", style: variants[vi] }; break; } catch(e) {}
  }
  t.fontSize = size || 14;
  t.characters = text;
  t.fills = [{ type: "SOLID", color: color || { r:0.2, g:0.2, b:0.2 }, opacity: opacity ?? 1 }];
  t.x = x; t.y = y;
  parent.appendChild(t);
  return t;
}

export function createPlaceholderImageHash(r: number, g: number, b: number): string {
  const crcT: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    crcT[n] = c;
  }
  function crc32(buf: number[]) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) crc = crcT[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }
  function chunk(type: string, data: number[]) {
    const tb = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    const crcIn = tb.concat(data);
    const cv = crc32(crcIn);
    const len = data.length;
    return [(len >>> 24) & 0xFF, (len >>> 16) & 0xFF, (len >>> 8) & 0xFF, len & 0xFF]
      .concat(tb).concat(data)
      .concat([(cv >>> 24) & 0xFF, (cv >>> 16) & 0xFF, (cv >>> 8) & 0xFF, cv & 0xFF]);
  }
  const ihdr = chunk("IHDR", [0,0,0,1, 0,0,0,1, 8, 2, 0, 0, 0]);
  const raw = [0x00, r, g, b];
  let s1 = 1, s2 = 1;
  for (let ai = 0; ai < raw.length; ai++) { s1 = (s1 + raw[ai]) % 65521; s2 = (s2 + s1) % 65521; }
  const adler = ((s2 << 16) | s1) >>> 0;
  const lenLo = raw.length & 0xFF, lenHi = (raw.length >> 8) & 0xFF;
  const idat = chunk("IDAT", [0x78, 0x01, 0x01, lenLo, lenHi, lenLo ^ 0xFF, lenHi ^ 0xFF]
    .concat(raw)
    .concat([(adler >>> 24) & 0xFF, (adler >>> 16) & 0xFF, (adler >>> 8) & 0xFF, adler & 0xFF]));
  const iend = chunk("IEND", []);
  const sig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  const all = sig.concat(ihdr).concat(idat).concat(iend);
  const img = figma.createImage(new Uint8Array(all));
  return img.hash;
}

// ── Ensure/setup utilities (Figma API-heavy, stay here) ──

import { cxFindCol, cxResolveVar } from './variable-utils';
import { hexToFigma } from './color-utils';
import { loadFontWithFallback } from './font-utils';

export async function ensureBackgroundImageVar(): Promise<Variable> {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  let flagsCol: VariableCollection | null = null;
  for (let i = 0; i < cols.length; i++) { if (cols[i].name === "Flags") { flagsCol = cols[i]; break; } }
  if (!flagsCol) flagsCol = figma.variables.createVariableCollection("Flags");
  const allVars = await figma.variables.getLocalVariablesAsync();
  const existing: Variable[] = [];
  for (let ei = 0; ei < allVars.length; ei++) {
    if (allVars[ei].variableCollectionId === flagsCol.id && allVars[ei].resolvedType === "BOOLEAN") {
      existing.push(allVars[ei]);
    }
  }
  for (let j = 0; j < existing.length; j++) {
    if (existing[j].name === "background-image") return existing[j];
  }
  const v = figma.variables.createVariable("background-image", flagsCol, "BOOLEAN");
  v.setValueForMode(flagsCol.modes[0].modeId, true);
  return v;
}

export async function ensureEssentialColors(): Promise<void> {
  const cols = await figma.variables.getLocalVariableCollectionsAsync();
  let colorCol: VariableCollection | null = null;
  for (let i = 0; i < cols.length; i++) { if (cols[i].name === "Colors") { colorCol = cols[i]; break; } }
  if (!colorCol) colorCol = figma.variables.createVariableCollection("Colors");
  const allVars = await figma.variables.getLocalVariablesAsync();
  const existing: Variable[] = [];
  for (let ei = 0; ei < allVars.length; ei++) {
    if (allVars[ei].variableCollectionId === colorCol.id && allVars[ei].resolvedType === "COLOR") {
      existing.push(allVars[ei]);
    }
  }
  const nameMap: Record<string, boolean> = {};
  for (let ei = 0; ei < existing.length; ei++) nameMap[existing[ei].name] = true;
  const modeId = colorCol.modes[0].modeId;
  const essential = [
    { name: "black",        color: { r: 0, g: 0, b: 0 } },
    { name: "white",        color: { r: 1, g: 1, b: 1 } },
    { name: "gray",         color: hexToFigma("#E3E3E3") },
    { name: "focus/border", color: { r: 0, g: 0, b: 0 } },
    { name: "focus/color",  color: hexToFigma("#79797B") },
    { name: "error/border", color: hexToFigma("#E32E22") },
    { name: "error/color",  color: hexToFigma("#E32E22") },
  ];
  for (let j = 0; j < essential.length; j++) {
    if (!nameMap[essential[j].name]) {
      try {
        const v = figma.variables.createVariable(essential[j].name, colorCol, "COLOR");
        v.setValueForMode(modeId, essential[j].color);
      } catch(e) {}
    }
  }
}

export async function ensureComponentTextStyles(): Promise<void> {
  const existing = await figma.getLocalTextStylesAsync();
  const nameMap: Record<string, boolean> = {};
  for (let i = 0; i < existing.length; i++) nameMap[existing[i].name] = true;

  let primaryFam = "Inter";
  for (let si = 0; si < existing.length; si++) {
    const fam = existing[si].fontName.family;
    if (fam && fam !== "Inter") { primaryFam = fam; break; }
  }
  if (primaryFam === "Inter") {
    const allCols = await figma.variables.getLocalVariableCollectionsAsync();
    const typCol = cxFindCol(allCols, "typography");
    if (typCol) {
      const allVars = await figma.variables.getLocalVariablesAsync();
      const typMid = typCol.modes[0].modeId;
      for (let vi = 0; vi < allVars.length; vi++) {
        if (allVars[vi].variableCollectionId === typCol.id && allVars[vi].resolvedType === "STRING" && allVars[vi].name.toLowerCase().indexOf("family") !== -1) {
          const fv = String(await cxResolveVar(allVars[vi], typMid, allCols) || "").split(",")[0].trim().replace(/['"]/g, "");
          if (fv && fv !== "Inter") { primaryFam = fv; break; }
        }
      }
    }
  }

  const weights = [400, 500, 600, 700];
  for (let wi = 0; wi < weights.length; wi++) {
    await loadFontWithFallback(primaryFam, weights[wi]);
  }

  const required = [
    { name: "buttons/lg",       family: primaryFam, weight: 600, size: 18 },
    { name: "buttons/default",  family: primaryFam, weight: 600, size: 16 },
    { name: "buttons/sm",       family: primaryFam, weight: 600, size: 14 },
    { name: "input/default",    family: primaryFam, weight: 400, size: 14 },
    { name: "label/default",    family: primaryFam, weight: 500, size: 12 },
    { name: "label/focused",    family: primaryFam, weight: 500, size: 12 },
    { name: "label/error",      family: primaryFam, weight: 500, size: 12 },
  ];

  for (let ri = 0; ri < required.length; ri++) {
    const r = required[ri];
    if (nameMap[r.name]) continue;
    try {
      const actualStyle = await loadFontWithFallback(r.family, r.weight);
      const ts = figma.createTextStyle();
      ts.name = r.name;
      ts.fontName = { family: r.family, style: actualStyle };
      ts.fontSize = r.size;
      ts.lineHeight = { unit: "PERCENT", value: 150 };
    } catch(e) {}
  }
}
