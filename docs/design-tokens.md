# Design Tokens

## Overview
The plugin creates native Figma Variables organized into collections. Tokens can be generated from configuration (Route A) or extracted from existing designs (Route B).

## Variable Collections

### Colors Collection
- Modes: Light, Dark
- Contains semantic color tokens (brand/primary, brand/secondary, text/primary, text/secondary, border/default, overlay/default, etc.)
- Bound to fills and strokes on design nodes

### Primitives Collection
- Mode: Value
- Contains raw color primitives (e.g., blue/500, red/200, gray/100)
- Generated as 10-shade palettes (50, 100, 200, 300, 400, 500, 600, 700, 800, 950) from each brand color
- Uses Tailwind-inspired shade generation with HSL manipulation

### Spacing Collection
- Mode: Value
- Named spacing scale (e.g., spacing/xs: 4, spacing/sm: 8, spacing/md: 16, spacing/lg: 24, spacing/xl: 32, spacing/2xl: 48)
- FLOAT type variables
- Bound to padding and gap (itemSpacing) properties

### Radius Collection
- Mode: Value
- Named radius scale (e.g., radius/sm: 4, radius/md: 8, radius/lg: 12, radius/xl: 16, radius/2xl: 24, radius/full: 9999)
- FLOAT type variables
- Bound to cornerRadius property

### Border Width Collection
- Mode: Value
- Named border width scale (e.g., border/thin: 1, border/default: 2, border/thick: 4)
- FLOAT type variables
- Bound to strokeWeight property

### Opacity Collection
- Mode: Value
- Pre-generated scale: 0, 5, 10, 15, 20, 25, 30... up to 95, 100
- FLOAT type variables, values stored as percentage (0-100)
- Scope set to OPACITY
- Bound to opacity property

### Typography Collection
- Mode: Value
- Contains sub-groups:
  - family/primary, family/secondary, family/tertiary, family/font-N — STRING type for font families
  - size/h1, size/h2, size/body-lg, etc. — FLOAT type for font sizes
  - weight/regular, weight/semibold, weight/bold — FLOAT type for font weights
  - line-height/tight, line-height/normal, line-height/relaxed — FLOAT type for line heights

### Z-Index Collection
- Mode: Value
- Named z-index scale (e.g., z-index/dropdown: 100, z-index/modal: 200)

### Breakpoints Collection
- Mode: Value
- Fixed values: xs: 0, sm: 567, md: 767, lg: 991

### Grid Collection
- Modes: xs, sm, md, lg (one per breakpoint)
- Variables: grid/columns, grid/gutter, grid/margin, grid/col-1 through grid/col-12
- Column values are percentage-based widths

## Text Styles
- Created as native Figma text styles (not variables)
- Grouped by path: headings/h1, body/default, buttons/lg, input/default, label/default, etc.
- Properties: fontName, fontSize, lineHeight, letterSpacing, paragraphSpacing, textDecoration, textCase
- Font loading with weight-based fallback (tries exact weight, then nearest alternatives)

## Effect Styles
- Shadow tokens create native Figma effect styles
- Named as shadow/sm, shadow/md, shadow/lg, etc.
- Parsed from CSS shadow syntax: "offsetX offsetY blurRadius spreadRadius color"

## DTCG JSON Import
The Import sub-tab accepts drag-and-drop JSON files in DTCG (Design Token Community Group) format.

File type detection is automatic based on filename:
- Files containing "text-style" or "textstyle" → text styles
- Files containing "primitive" → primitive color variables
- Files containing "dark" → dark mode colors
- Files containing "light" or "color"/"colour" → light mode colors
- Files containing "spacing" → spacing variables
- Files containing "typography" → typography variables (family, size, weight)
- Files containing "radius" → radius variables
- Files containing "border" → border width variables
- Files containing "opacity" → opacity variables
- Files containing "shadow" → effect styles
- Files containing "z-index" → z-index variables
- Files containing "breakpoint" → breakpoint variables
- Files containing "grid" → grid variables with breakpoint modes

### DTCG Format Example
```json
{
  "spacing": {
    "xs": { "$type": "dimension", "$value": { "value": 4, "unit": "px" } },
    "sm": { "$type": "dimension", "$value": { "value": 8, "unit": "px" } }
  }
}
```

For colors:
```json
{
  "blue": {
    "500": {
      "$type": "color",
      "$value": { "components": [0.231, 0.51, 0.965], "alpha": 1 }
    }
  }
}
```

## Route B Token Extraction
When importing existing designs, the analysis engine:
1. Walks every visible node across all pages
2. Extracts fill/stroke colors, spacing values, radii, border weights, shadows, and typography combos
3. Clusters near-duplicate colors (within Euclidean distance 0.02)
4. Deduplicates spacing values within 2px tolerance
5. Auto-names tokens based on hue (colors) or typographic hierarchy (h1, body-lg, etc.)
6. Derives font families from typography combos only (not raw text node counts), sorted by usage frequency
7. Names fonts: primary, secondary, tertiary, then font-4, font-5, etc.

## Variable Binding
After creating variables, the plugin walks the design tree and binds nodes to their nearest matching variable:
- Color fills/strokes → nearest COLOR variable (Euclidean distance < 0.04)
- Padding/gap → nearest FLOAT variable in Spacing collection (within 10% or 1px)
- Corner radius → nearest FLOAT variable in Radius collection
- Stroke weight → nearest FLOAT variable in Border Width collection
- Opacity → nearest FLOAT variable in Opacity collection

Binding uses `setBoundVariable()` on Figma nodes to create live variable connections.
