// Color conversion and parsing utilities

export function rgb01ToHex(r: number, g: number, b: number): string {
  return "#"+[r,g,b].map(function(v){ return Math.round(Math.min(255,Math.max(0,v*255))).toString(16).padStart(2,"0"); }).join("").toUpperCase();
}

export function hexToFigma(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return { r: parseInt(h.slice(0,2),16)/255, g: parseInt(h.slice(2,4),16)/255, b: parseInt(h.slice(4,6),16)/255 };
}

export function cxColorToHex(rgb: any): string | null {
  if (!rgb || !("r" in rgb)) return null;
  return "#" + [rgb.r, rgb.g, rgb.b].map(function(ch) { return Math.round(Math.min(255, Math.max(0, ch * 255))).toString(16).padStart(2, "0"); }).join("").toUpperCase();
}

export function parseCssShadow(str: string): any {
  if (!str || typeof str !== "string") return null;
  const inset = /\binset\b/.test(str);
  const clean = str.replace(/\binset\b/, "").trim();
  const rgbaMatch = clean.match(/rgba?\(([^)]+)\)/);
  const hexMatch = clean.match(/#([0-9a-fA-F]{3,8})/);
  let r = 0, g = 0, b = 0, a = 0.2;
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(",").map(function(v) { return parseFloat(v.trim()); });
    r = (parts[0] || 0) / 255; g = (parts[1] || 0) / 255; b = (parts[2] || 0) / 255; a = parts[3] ?? 1;
  } else if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    r = parseInt(h.slice(0,2),16)/255; g = parseInt(h.slice(2,4),16)/255; b = parseInt(h.slice(4,6),16)/255;
    if (h.length === 8) a = parseInt(h.slice(6,8),16)/255;
  }
  const nums = clean.replace(/rgba?\([^)]+\)/, "").replace(/#[0-9a-fA-F]{3,8}/, "").trim().split(/\s+/).map(function(v) { return parseFloat(v) || 0; });
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
