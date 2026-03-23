// Token import system
import { weightToStyleCandidates, weightToStyle, loadFontWithFallback, setFontName, parseCssShadow } from './utils';

export async function findOrCreateCollection(name){var cols=await figma.variables.getLocalVariableCollectionsAsync();for(var i=0;i<cols.length;i++){if(cols[i].name===name)return cols[i];}return figma.variables.createVariableCollection(name);}

export async function buildVarMap(col){var map={},all=await figma.variables.getLocalVariablesAsync();for(var i=0;i<all.length;i++){if(all[i].variableCollectionId===col.id)map[all[i].name]=all[i];}return map;}

export async function getOrCreateVar(name,col,type,map){if(map[name]&&map[name].resolvedType===type)return map[name];var v=figma.variables.createVariable(name,col,type);map[name]=v;return v;}

export function dtcgToFigmaColor(val){return{r:val.components[0],g:val.components[1],b:val.components[2],a:val.alpha!==undefined?val.alpha:1};}

export function detectType(fn){
  fn=fn.toLowerCase();
  if(fn.indexOf("text-style")!==-1||fn.indexOf("textstyle")!==-1) return "text-styles";
  if(fn.indexOf("primitive")!==-1)  return "primitives";
  if(fn.indexOf("dark")!==-1)       return "colors-dark";
  if(fn.indexOf("light")!==-1)      return "colors-light";
  if(fn.indexOf("color")!==-1||fn.indexOf("colour")!==-1) return "colors-light";
  if(fn.indexOf("spacing")!==-1)    return "spacing";
  if(fn.indexOf("typography")!==-1) return "typography";
  if(fn.indexOf("radius")!==-1)     return "radius";
  if(fn.indexOf("border")!==-1)     return "border";
  if(fn.indexOf("opacity")!==-1)     return "opacity";
  if(fn.indexOf("shadow")!==-1)     return "shadows";
  if(fn.indexOf("z-index")!==-1)    return "zindex";
  if(fn.indexOf("breakpoint")!==-1) return "breakpoints";
  if(fn.indexOf("grid")!==-1)       return "grid";
  return "unknown";
}

export async function importTokens(filename,data){
  var type=detectType(filename);
  if(type==="text-styles")   return await importTextStyles(data);
  if(type==="primitives")    return await importPrimitives(data);
  if(type==="colors-light")  return await importColors(data,"Light");
  if(type==="colors-dark")   return await importColors(data,"Dark");
  if(type==="spacing")       return await importFlat(data,"Spacing","spacing",true);
  if(type==="radius")        return await importFlat(data,"Radius","radius",true);
  if(type==="border")        return await importFlat(data,"Border Width","border",true);
  if(type==="opacity")       return await importOpacity(data);
  if(type==="zindex")        return await importFlat(data,"Z-Index","z-index",false);
  if(type==="breakpoints")   return await importFlat(data,"Breakpoints","breakpoint",false);
  if(type==="grid")          return await importGrid(data);
  if(type==="shadows")       return await importShadows(data);
  if(type==="typography")    return await importTypography(data);
  throw new Error('Cannot detect type from "'+filename+'". Keep original filenames.');
}

export async function importTextStyles(data){
  // Pre-load all needed fonts — try exact fontStyle first, fall back to weight-based
  var fontsToLoad=[],seen={};
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var weight=val.fontWeight||400;var exactStyle=val.fontStyle||"";var k=family+":"+weight+":"+exactStyle;if(!seen[k]){seen[k]=true;fontsToLoad.push({family:family,weight:weight,exactStyle:exactStyle});}});});
  // Resolve actual style names — prefer exact style from source
  var resolvedStyles={};
  for(var fi=0;fi<fontsToLoad.length;fi++){
    var f=fontsToLoad[fi];
    var resolved=null;
    // Try loading the exact style name from the source design first
    if(f.exactStyle){
      try{await figma.loadFontAsync({family:f.family,style:f.exactStyle});resolved=f.exactStyle;}catch(e){}
    }
    // Fall back to weight-based resolution
    if(!resolved){resolved=await loadFontWithFallback(f.family,f.weight);}
    resolvedStyles[f.family+":"+f.weight+":"+f.exactStyle]=resolved;
  }
  var existingStyles=await figma.getLocalTextStylesAsync(),styleMap={};existingStyles.forEach(function(s){styleMap[s.name]=s;});
  var count=0,skipped=0;
  var groupKeys=Object.keys(data);for(var gi=0;gi<groupKeys.length;gi++){var groupKey=groupKeys[gi];var group=data[groupKey];if(!group||typeof group!=="object")continue;var keys=Object.keys(group);for(var ki=0;ki<keys.length;ki++){var key=keys[ki];var token=group[key];if(!token||!token["$value"])continue;var val=token["$value"];var styleName=groupKey+"/"+key;try{var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var weight=val.fontWeight||400;var exactStyle=val.fontStyle||"";var fontStyle=resolvedStyles[family+":"+weight+":"+exactStyle]||"Regular";var style=styleMap[styleName]||figma.createTextStyle();style.name=styleName;style.fontName={family:family,style:fontStyle};var fs=val.fontSize;style.fontSize=typeof fs==="object"?(fs.value||16):(parseFloat(fs)||16);var lh=val.lineHeight;if(lh){if(typeof lh==="object"){if(lh.unit==="PIXELS")style.lineHeight={unit:"PIXELS",value:lh.value||24};else if(lh.unit==="MULTIPLIER"){var lhPx=(lh.value||1.5)*style.fontSize;style.lineHeight={unit:"PIXELS",value:lhPx};}else style.lineHeight={unit:"PERCENT",value:(lh.value||1.5)*100};}else style.lineHeight={unit:"PERCENT",value:(parseFloat(lh)||1.5)*100};}var ls=val.letterSpacing;if(ls!==undefined){var lsVal=typeof ls==="object"?ls.value:(parseFloat(ls)||0);var lsU=(typeof ls==="object"&&ls.unit==="PERCENT")?"PERCENT":"PIXELS";style.letterSpacing={unit:lsU,value:lsVal};}var ps=val.paragraphSpacing;if(ps!==undefined)style.paragraphSpacing=typeof ps==="object"?(ps.value||0):(parseFloat(ps)||0);var td=val.textDecoration;style.textDecoration=(td&&td!=="NONE")?td:"NONE";var txc=val.textCase;if(txc&&txc!=="ORIGINAL")style.textCase=txc;if(token["$description"])style.description=token["$description"];styleMap[styleName]=style;count++;}catch(e){skipped++;}}}
  var msg="Created/updated "+count+" text style"+(count!==1?"s":"");if(skipped>0)msg+=" ("+skipped+" skipped — font not installed)";return msg;
}

export async function importPrimitives(data){var col=await findOrCreateCollection("Primitives"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=await buildVarMap(col),count=0;var gks=Object.keys(data);for(var gi=0;gi<gks.length;gi++){var gk=gks[gi];var g=data[gk];if(!g||typeof g!=="object"||g["$value"]!==undefined)continue;var sks=Object.keys(g);for(var si=0;si<sks.length;si++){var sk=sks[si];var t=g[sk];if(!t||t["$value"]===undefined||t["$type"]!=="color")continue;try{var v=await getOrCreateVar(gk+"/"+sk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}}}return"Imported "+count+" variables";}

export async function importColors(data,modeName){var col=await findOrCreateCollection("Colors"),modeId=null;for(var i=0;i<col.modes.length;i++){if(col.modes[i].name===modeName){modeId=col.modes[i].modeId;break;}}if(!modeId){if(col.modes.length===1&&col.modes[0].name==="Mode 1"){col.renameMode(col.modes[0].modeId,modeName);modeId=col.modes[0].modeId;}else modeId=col.addMode(modeName);}var map=await buildVarMap(col),count=0;var gks=Object.keys(data);for(var gi=0;gi<gks.length;gi++){var gk=gks[gi];var g=data[gk];if(!g||typeof g!=="object")continue;if(g["$value"]!==undefined&&g["$type"]==="color"){try{var v=await getOrCreateVar(gk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(g["$value"]));count++;}catch(e){}continue;}var tks=Object.keys(g);for(var ti=0;ti<tks.length;ti++){var tk=tks[ti];var t=g[tk];if(!t||t["$value"]===undefined||t["$type"]!=="color")continue;try{var v=await getOrCreateVar(gk+"/"+tk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}}}return"Imported "+count+" variables";}

export async function importFlat(data,colName,prefix,isDim){var col=await findOrCreateCollection(colName),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=await buildVarMap(col),count=0;var keys=Object.keys(data);for(var ki=0;ki<keys.length;ki++){var key=keys[ki];var t=data[key];if(!t||t["$value"]===undefined)continue;try{var raw=t["$value"],num=isDim&&typeof raw==="object"?raw.value:parseFloat(raw)||0;var v=await getOrCreateVar(prefix+"/"+key,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}catch(e){}}return"Imported "+count+" variables";}

export async function importOpacity(data){
  var col=await findOrCreateCollection("Opacity");
  var modeId=col.modes[0].modeId;
  col.renameMode(modeId,"Value");
  var map=await buildVarMap(col),count=0;
  var keys=Object.keys(data);for(var ki=0;ki<keys.length;ki++){
    var key=keys[ki];var t=data[key];if(!t||t["$value"]===undefined)continue;
    try{
      var decimal=parseFloat(t["$value"])||0;
      var pct=Math.round(decimal*100);
      var v=await getOrCreateVar("opacity/"+key,col,"FLOAT",map);
      v.setValueForMode(modeId,pct);
      v.scopes=["OPACITY"];
      count++;
    }catch(e){}
  }
  return"Imported "+count+" opacity variables";
}

export async function importShadows(data){
  var existingStyles = await figma.getLocalEffectStylesAsync();
  var styleMap = {};
  for (var i = 0; i < existingStyles.length; i++) { styleMap[existingStyles[i].name] = existingStyles[i]; }
  var count = 0;
  var keys = Object.keys(data);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var t = data[key];
    if (!t || t["$value"] === undefined) continue;
    var shadowStr = String(t["$value"]);
    var parsed = parseCssShadow(shadowStr);
    if (!parsed) continue;
    try {
      var styleName = "shadow/" + key;
      var style = styleMap[styleName] || figma.createEffectStyle();
      style.name = styleName;
      style.effects = [parsed];
      if (t["$description"]) style.description = t["$description"];
      styleMap[styleName] = style;
      count++;
    } catch(e) {}
  }
  return "Created/updated " + count + " effect style" + (count !== 1 ? "s" : "");
}

export async function importTypography(data){var col=await findOrCreateCollection("Typography"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=await buildVarMap(col),count=0;var gks=Object.keys(data);for(var gi=0;gi<gks.length;gi++){var gk=gks[gi];var g=data[gk];if(!g||typeof g!=="object")continue;var keys=Object.keys(g);for(var ki=0;ki<keys.length;ki++){var key=keys[ki];var t=g[key];if(!t||t["$value"]===undefined)continue;try{var vn=gk+"/"+key,val=t["$value"];if(t["$type"]==="fontFamily"){var v=await getOrCreateVar(vn,col,"STRING",map);v.setValueForMode(modeId,String(val));count++;}else if(t["$type"]==="dimension"){var num=typeof val==="object"?val.value:parseFloat(val)||0;var v=await getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}else if(t["$type"]==="number"){var v=await getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,parseFloat(val)||0);count++;}}catch(e){}}}return"Imported "+count+" variables";}

export async function importGrid(data) {
  var col = await findOrCreateCollection("Grid");
  var breakpointNames = ["xs", "sm", "md", "lg"];
  // Ensure modes exist for each breakpoint
  var modeIds = {};
  for (var bi = 0; bi < breakpointNames.length; bi++) {
    var bpName = breakpointNames[bi];
    var found = false;
    for (var mi = 0; mi < col.modes.length; mi++) {
      if (col.modes[mi].name === bpName) { modeIds[bpName] = col.modes[mi].modeId; found = true; break; }
    }
    if (!found) {
      if (bi === 0 && col.modes.length === 1 && col.modes[0].name === "Mode 1") {
        col.renameMode(col.modes[0].modeId, bpName);
        modeIds[bpName] = col.modes[0].modeId;
      } else {
        modeIds[bpName] = col.addMode(bpName);
      }
    }
  }
  var map = await buildVarMap(col);
  var count = 0;
  // data structure: { "grid/columns": { xs: 4, sm: 8, md: 12, lg: 12 }, "grid/gutter": {...}, "grid/col-1": {...}, ... }
  var varNames = Object.keys(data);
  for (var vi = 0; vi < varNames.length; vi++) {
    var varName = varNames[vi];
    var entry = data[varName];
    if (!entry || typeof entry !== "object") continue;
    try {
      var v = await getOrCreateVar(varName, col, "FLOAT", map);
      for (var bp in entry) {
        if (modeIds[bp] !== undefined) {
          v.setValueForMode(modeIds[bp], entry[bp]);
        }
      }
      count++;
    } catch(e) {}
  }
  return "Imported " + count + " grid variables";
}
