// Shared helpers used by both components.ts and components-complex.ts
// These were previously duplicated between the two files.

import { createSpecText } from './utils';

// ── Binding context: holds all variable lookup maps ──
export interface BindContext {
  colorVarMap: Record<string, Variable>;
  spacingVarMap: Record<number, Variable>;
  borderVarMap: Record<number, Variable>;
  radiusVarByValue: Record<number, Variable>;
  opacityVarMap: Record<number, Variable>;
  defaultRadiusVar: Variable | null;
}

// ── Variable binding helpers ──

export function bindFill(node: SceneNode, varName: string, colorVarMap: Record<string, Variable>) {
  const v = colorVarMap[varName]; if (!v) return;
  try { (node as any).fills = [figma.variables.setBoundVariableForPaint((node as any).fills[0], "color", v)]; } catch(e) {}
}

export function bindStroke(node: SceneNode, varName: string, colorVarMap: Record<string, Variable>) {
  const v = colorVarMap[varName]; if (!v) return;
  try { (node as any).strokes = [figma.variables.setBoundVariableForPaint((node as any).strokes[0], "color", v)]; } catch(e) {}
}

export function bindRadius(node: SceneNode, defaultRadiusVar: Variable | null) {
  if (!defaultRadiusVar) return;
  try { (node as any).setBoundVariable("cornerRadius", defaultRadiusVar); } catch(e) {}
}

export function bindCompSpacing(frame: FrameNode, spacingVarMap: Record<number, Variable>) {
  const props = ["paddingLeft","paddingRight","paddingTop","paddingBottom","itemSpacing","counterAxisSpacing"];
  for (let pi = 0; pi < props.length; pi++) {
    const prop = props[pi];
    if (!(prop in frame)) continue;
    const val = (frame as any)[prop];
    if (val === undefined || val === null) continue;
    const sv = spacingVarMap[val];
    if (sv) { try { frame.setBoundVariable(prop as any, sv); } catch(e) {} }
  }
}

export function bindBorderWidth(node: SceneNode, borderVarMap: Record<number, Variable>) {
  if (!("strokeWeight" in node)) return;
  const val = (node as any).strokeWeight;
  if (val === undefined || val === null || typeof val !== "number") return;
  const bv = borderVarMap[val];
  if (bv) { try { (node as any).setBoundVariable("strokeWeight", bv); } catch(e) {} }
}

export function bindRadiusByValue(node: SceneNode, radiusVarByValue: Record<number, Variable>) {
  if (!("cornerRadius" in node)) return;
  const val = (node as any).cornerRadius;
  if (val === undefined || val === null || typeof val !== "number") return;
  const rv = radiusVarByValue[val];
  if (rv) { try { (node as any).setBoundVariable("cornerRadius", rv); } catch(e) {} }
}

export function bindOpacity(node: SceneNode, opacityVarMap: Record<number, Variable>) {
  if (!("opacity" in node)) return;
  const pct = Math.round((node as any).opacity * 100);
  const ov = opacityVarMap[pct];
  if (ov) { try { (node as any).setBoundVariable("opacity", ov); } catch(e) {} }
}

// ── UI helpers ──

export function sectionTitle(frame: FrameNode, title: string) {
  createSpecText(frame, title, 0, 0, 28, "Bold", { r: 0.1, g: 0.1, b: 0.1 }, undefined);
  const div = figma.createRectangle();
  div.resize(100, 1);
  div.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity: 0.08 }];
  frame.appendChild(div);
  (div as any).layoutSizingHorizontal = "FILL";
}

export function findStyle(group: string, name: string, styles: TextStyle[]): TextStyle | null {
  const styleName = group + "/" + name;
  for (let i = 0; i < styles.length; i++) {
    if (styles[i].name === styleName) return styles[i];
  }
  return null;
}

export function pickLabelStyle(
  state: string,
  labelDefaultStyle: TextStyle | null,
  labelFocusedStyle: TextStyle | null,
  labelErrorStyle: TextStyle | null
): TextStyle | null {
  if (state === "Focused" && labelFocusedStyle) return labelFocusedStyle;
  if (state === "Error" && labelErrorStyle) return labelErrorStyle;
  return labelDefaultStyle;
}
