// Variable resolution and collection utilities

import { rgb01ToHex } from './color-utils';

export async function resolveChain(variableId: string) {
  const chain: any[] = []; let currentId = variableId; let maxSteps = 12; const seen: Record<string, boolean> = {};
  while (currentId && maxSteps-- > 0) {
    if (seen[currentId]){chain.push({name:"⚠ Circular reference",broken:true});break;}
    seen[currentId]=true;
    const v = await figma.variables.getVariableByIdAsync(currentId);
    if(!v){chain.push({name:"Broken reference — variable deleted or renamed",broken:true});break;}
    const col = await figma.variables.getVariableCollectionByIdAsync(v.variableCollectionId);
    const colName = col?.name ?? "?";
    const modeId = col?.modes?.[0]?.modeId ?? null;
    const val = modeId ? (v.valuesByMode?.[modeId] ?? null) : null;
    if(val && typeof val === "object" && val.type === "VARIABLE_ALIAS"){
      chain.push({name:v.name,collection:colName,isAlias:true,resolvedType:v.resolvedType});
      currentId = val.id;
    } else {
      let display: string | null = null; let hexColor: string | null = null;
      if(v.resolvedType==="COLOR"&&val){hexColor=rgb01ToHex(val.r||0,val.g||0,val.b||0);const a=val.a ?? 1;display=hexColor+(a<1?" / "+Math.round(a*100)+"%":"");}
      else if(v.resolvedType==="FLOAT") display=String(Math.round((Number(val)||0)*100)/100);
      else if(v.resolvedType==="STRING"){const s=String(val);display=s.length>44?s.slice(0,44)+"…":s;}
      else if(v.resolvedType==="BOOLEAN") display=String(val);
      chain.push({name:v.name,collection:colName,isAlias:false,resolvedType:v.resolvedType,displayValue:display,hexColor:hexColor});
      break;
    }
  }
  return chain;
}

export function countTokensByCategory(allVars: Variable[], allCols: VariableCollection[]) {
  let colorVars = 0, spacingVars = 0, radiusVars = 0, typographyVars = 0, shadowVars = 0, borderVars = 0, zindexVars = 0, breakpointVars = 0, gridVars = 0, opacityVars = 0, otherVars = 0;
  for (let vi = 0; vi < allVars.length; vi++) {
    const v = allVars[vi];
    let colName = "";
    for (let ci = 0; ci < allCols.length; ci++) {
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

export async function cxResolveVar(v: Variable, modeId: string, allCols: VariableCollection[]) {
  let val = v.valuesByMode[modeId];
  const seen: Record<string, boolean> = {};
  while (val && typeof val === "object" && val.type === "VARIABLE_ALIAS" && val.id && !seen[val.id]) {
    seen[val.id] = true;
    try {
      const aliased = await figma.variables.getVariableByIdAsync(val.id);
      if (!aliased) break;
      let ac: VariableCollection | null = null;
      for (let i = 0; i < allCols.length; i++) { if (allCols[i].id === aliased.variableCollectionId) { ac = allCols[i]; break; } }
      if (!ac?.modes?.length) break;
      val = aliased.valuesByMode[ac.modes[0].modeId];
    } catch(e) { break; }
  }
  return val;
}

export function cxFindCol(allCols: VariableCollection[], pattern: string): VariableCollection | null {
  for (let i = 0; i < allCols.length; i++) { if (allCols[i].name.toLowerCase().indexOf(pattern) !== -1) return allCols[i]; }
  return null;
}

export async function cxGetFloats(col: VariableCollection, allVars: Variable[], allCols: VariableCollection[]) {
  if (!col?.modes?.length) return [];
  const mid = col.modes[0].modeId;
  const out: any[] = [];
  for (let i = 0; i < allVars.length; i++) {
    const v = allVars[i];
    if (v.variableCollectionId !== col.id || v.resolvedType !== "FLOAT") continue;
    const val = await cxResolveVar(v, mid, allCols);
    const num = typeof val === "number" ? val : parseFloat(val as any) || 0;
    const parts = v.name.split("/");
    out.push({ name: parts[parts.length - 1], fullName: v.name, value: num, variable: v });
  }
  return out;
}

export function cxStripPrefix(name: string): string { const i = name.indexOf("/"); return i !== -1 ? name.substring(i + 1) : name; }
