// Token import system
import { weightToStyleCandidates, weightToStyle, loadFontWithFallback, setFontName, parseCssShadow } from './utils';

export function findOrCreateCollection(name){var cols=figma.variables.getLocalVariableCollections();for(var i=0;i<cols.length;i++){if(cols[i].name===name)return cols[i];}return figma.variables.createVariableCollection(name);}

export function buildVarMap(col){var map={},all=figma.variables.getLocalVariables();for(var i=0;i<all.length;i++){if(all[i].variableCollectionId===col.id)map[all[i].name]=all[i];}return map;}

export function getOrCreateVar(name,col,type,map){if(map[name]&&map[name].resolvedType===type)return map[name];var v=figma.variables.createVariable(name,col,type);map[name]=v;return v;}

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
  if(type==="primitives")    return importPrimitives(data);
  if(type==="colors-light")  return importColors(data,"Light");
  if(type==="colors-dark")   return importColors(data,"Dark");
  if(type==="spacing")       return importFlat(data,"Spacing","spacing",true);
  if(type==="radius")        return importFlat(data,"Radius","radius",true);
  if(type==="border")        return importFlat(data,"Border Width","border",true);
  if(type==="opacity")       return importFlat(data,"Opacity","opacity",false);
  if(type==="zindex")        return importFlat(data,"Z-Index","z-index",false);
  if(type==="breakpoints")   return importFlat(data,"Breakpoints","breakpoint",false);
  if(type==="grid")          return importGrid(data);
  if(type==="shadows")       return importShadows(data);
  if(type==="typography")    return importTypography(data);
  throw new Error('Cannot detect type from "'+filename+'". Keep original filenames.');
}

export async function importTextStyles(data){
  // Pre-load all needed fonts with fallback
  var fontsToLoad=[],seen={};
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var weight=val.fontWeight||400;var k=family+":"+weight;if(!seen[k]){seen[k]=true;fontsToLoad.push({family:family,weight:weight});}});});
  // Resolve actual style names per family+weight
  var resolvedStyles={};
  for(var fi=0;fi<fontsToLoad.length;fi++){
    var f=fontsToLoad[fi];
    var actualStyle=await loadFontWithFallback(f.family,f.weight);
    resolvedStyles[f.family+":"+f.weight]=actualStyle;
  }
  var existingStyles=figma.getLocalTextStyles(),styleMap={};existingStyles.forEach(function(s){styleMap[s.name]=s;});
  var count=0,skipped=0;
  Object.keys(data).forEach(function(groupKey){var group=data[groupKey];if(!group||typeof group!=="object")return;Object.keys(group).forEach(function(key){var token=group[key];if(!token||!token["$value"])return;var val=token["$value"];var styleName=groupKey+"/"+key;try{var family=String(val.fontFamily||"Inter").split(",")[0].trim().replace(/['"]/g,"");var weight=val.fontWeight||400;var fontStyle=resolvedStyles[family+":"+weight]||"Regular";var style=styleMap[styleName]||figma.createTextStyle();style.name=styleName;style.fontName={family:family,style:fontStyle};var fs=val.fontSize;style.fontSize=typeof fs==="object"?(fs.value||16):(parseFloat(fs)||16);var lh=val.lineHeight;if(lh){if(typeof lh==="object"){if(lh.unit==="PIXELS")style.lineHeight={unit:"PIXELS",value:lh.value||24};else if(lh.unit==="MULTIPLIER"){var lhPx=(lh.value||1.5)*style.fontSize;style.lineHeight={unit:"PIXELS",value:lhPx};}else style.lineHeight={unit:"PERCENT",value:(lh.value||1.5)*100};}else style.lineHeight={unit:"PERCENT",value:(parseFloat(lh)||1.5)*100};}var ls=val.letterSpacing;if(ls!==undefined){var lsVal=typeof ls==="object"?ls.value:(parseFloat(ls)||0);style.letterSpacing={unit:"PIXELS",value:lsVal};}var ps=val.paragraphSpacing;if(ps!==undefined)style.paragraphSpacing=typeof ps==="object"?(ps.value||0):(parseFloat(ps)||0);var td=val.textDecoration;style.textDecoration=(td&&td!=="NONE")?td:"NONE";if(token["$description"])style.description=token["$description"];styleMap[styleName]=style;count++;}catch(e){skipped++;}});});
  var msg="Created/updated "+count+" text style"+(count!==1?"s":"");if(skipped>0)msg+=" ("+skipped+" skipped — font not installed)";return msg;
}

export function importPrimitives(data){var col=findOrCreateCollection("Primitives"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object"||g["$value"]!==undefined)return;Object.keys(g).forEach(function(sk){var t=g[sk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+sk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return"Imported "+count+" variables";}

export function importColors(data,modeName){var col=findOrCreateCollection("Colors"),modeId=null;for(var i=0;i<col.modes.length;i++){if(col.modes[i].name===modeName){modeId=col.modes[i].modeId;break;}}if(!modeId){if(col.modes.length===1&&col.modes[0].name==="Mode 1"){col.renameMode(col.modes[0].modeId,modeName);modeId=col.modes[0].modeId;}else modeId=col.addMode(modeName);}var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object")return;if(g["$value"]!==undefined&&g["$type"]==="color"){try{var v=getOrCreateVar(gk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(g["$value"]));count++;}catch(e){}return;}Object.keys(g).forEach(function(tk){var t=g[tk];if(!t||t["$value"]===undefined||t["$type"]!=="color")return;try{var v=getOrCreateVar(gk+"/"+tk,col,"COLOR",map);v.setValueForMode(modeId,dtcgToFigmaColor(t["$value"]));count++;}catch(e){}});});return"Imported "+count+" variables";}

export function importFlat(data,colName,prefix,isDim){var col=findOrCreateCollection(colName),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(key){var t=data[key];if(!t||t["$value"]===undefined)return;try{var raw=t["$value"],num=isDim&&typeof raw==="object"?raw.value:parseFloat(raw)||0;var v=getOrCreateVar(prefix+"/"+key,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}catch(e){}});return"Imported "+count+" variables";}

export function importShadows(data){
  var existingStyles = figma.getLocalEffectStyles();
  var styleMap = {};
  for (var i = 0; i < existingStyles.length; i++) { styleMap[existingStyles[i].name] = existingStyles[i]; }
  var count = 0;
  Object.keys(data).forEach(function(key) {
    var t = data[key];
    if (!t || t["$value"] === undefined) return;
    var shadowStr = String(t["$value"]);
    var parsed = parseCssShadow(shadowStr);
    if (!parsed) return;
    try {
      var styleName = "shadow/" + key;
      var style = styleMap[styleName] || figma.createEffectStyle();
      style.name = styleName;
      style.effects = [parsed];
      if (t["$description"]) style.description = t["$description"];
      styleMap[styleName] = style;
      count++;
    } catch(e) {}
  });
  return "Created/updated " + count + " effect style" + (count !== 1 ? "s" : "");
}

export function importTypography(data){var col=findOrCreateCollection("Typography"),modeId=col.modes[0].modeId;col.renameMode(modeId,"Value");var map=buildVarMap(col),count=0;Object.keys(data).forEach(function(gk){var g=data[gk];if(!g||typeof g!=="object")return;Object.keys(g).forEach(function(key){var t=g[key];if(!t||t["$value"]===undefined)return;try{var vn=gk+"/"+key,val=t["$value"];if(t["$type"]==="fontFamily"){var v=getOrCreateVar(vn,col,"STRING",map);v.setValueForMode(modeId,String(val));count++;}else if(t["$type"]==="dimension"){var num=typeof val==="object"?val.value:parseFloat(val)||0;var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,num);count++;}else if(t["$type"]==="number"){var v=getOrCreateVar(vn,col,"FLOAT",map);v.setValueForMode(modeId,parseFloat(val)||0);count++;}}catch(e){}});});return"Imported "+count+" variables";}

export function importGrid(data) {
  var col = findOrCreateCollection("Grid");
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
  var map = buildVarMap(col);
  var count = 0;
  // data structure: { "grid/columns": { xs: 4, sm: 8, md: 12, lg: 12 }, "grid/gutter": {...}, "grid/col-1": {...}, ... }
  Object.keys(data).forEach(function(varName) {
    var entry = data[varName];
    if (!entry || typeof entry !== "object") return;
    try {
      var v = getOrCreateVar(varName, col, "FLOAT", map);
      for (var bp in entry) {
        if (modeIds[bp] !== undefined) {
          v.setValueForMode(modeIds[bp], entry[bp]);
        }
      }
      count++;
    } catch(e) {}
  });
  return "Imported " + count + " grid variables";
}
