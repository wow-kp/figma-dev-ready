// Font loading and style resolution utilities

export function weightToStyleCandidates(w: number | string): string[] {
  const n = parseInt(String(w)) || 400;
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

export function weightToStyle(w: number | string): string { return weightToStyleCandidates(w)[0]; }

export async function loadFontWithFallback(family: string, weight: number): Promise<string> {
  const candidates = weightToStyleCandidates(weight);
  for (let i = 0; i < candidates.length; i++) {
    try {
      await figma.loadFontAsync({ family: family, style: candidates[i] });
      return candidates[i];
    } catch(e) {}
  }
  try { await figma.loadFontAsync({ family: family, style: "Regular" }); } catch(e) {}
  return "Regular";
}

export function setFontName(node: TextNode, family: string, weight: number): string {
  const candidates = weightToStyleCandidates(weight);
  for (let i = 0; i < candidates.length; i++) {
    try {
      node.fontName = { family: family, style: candidates[i] };
      return candidates[i];
    } catch(e) {}
  }
  try { node.fontName = { family: "Inter", style: "Regular" }; } catch(e) {}
  return "Regular";
}
