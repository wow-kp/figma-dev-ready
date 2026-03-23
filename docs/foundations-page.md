# Foundations Page

## Overview
The Foundations page is an auto-generated visual specimen of your entire design system. It shows every token, variable, and style as visual samples, making it easy to review and share the design language with stakeholders and developers.

The page is generated automatically during Step 2 of both Route A and Route B.

## Two Generators

### Route A: Config-Driven (`foundations.ts`)
Reads directly from the message payload (colors, fonts, text styles, spacing, etc.) and creates visual elements. Used when generating tokens from UI configuration.

### Route B: Variable-Driven (`foundations-complex.ts`)
Reads from the Figma file's existing variable collections, text styles, and effect styles. Used after Route B token import, ensuring the specimens reflect the actual variables in the file.

Both generators produce the same visual format — a 1440px-wide frame with 80px padding and consistent section spacing.

## Sections

### Color Primitives (Route B only)
Displays the Primitives variable collection grouped by color family (red, blue, green, etc.):
- Each shade rendered as a swatch rectangle
- Hex value label below each swatch
- Bound to the source COLOR variable via `setBoundVariable('fills')`
- Grouped by the first path segment of the variable name

### Semantic Colors
Displays the Colors variable collection:
- **Route A:** Single-column swatches from the generated palette
- **Route B:** Two-column layout showing Light and Dark mode values side by side
- Each swatch bound to its COLOR variable
- Labels show variable name and resolved hex value

### Font Families
One card per detected font family:
- **Role label:** PRIMARY, SECONDARY, TERTIARY, or FONT N (uppercase, 10px Inter)
- **Font name:** displayed in the font's own bold weight at 28px
- **Sample alphabet:** "AaBbCcDdEeFfGgHhIiJjKkLl" in the font's regular weight
- **Weight samples row:** Light, Regular, SemiBold, Bold — each rendered in that weight

**Font-not-installed handling:**
- Detects if the font is available by attempting `figma.loadFontAsync()`
- If unavailable: renders the card using Inter as fallback, shows "(not installed)" suffix in red text, and replaces the sample with "Font not available — install to preview"
- The variable and token are still created correctly — only the visual preview is affected

**Dynamic font count:**
- Supports any number of font families (not limited to 3)
- Font families derived from typography combos sorted by usage frequency
- First 3 named: primary, secondary, tertiary. Additional fonts: font-4, font-5, etc.

### Text Styles
Groups text styles by their path prefix (headings, body, links, buttons, input, label, etc.):
- Each style shown as a sample text line
- Font family, size, weight, and line height displayed as metadata
- Applied via `textStyleId` binding to the Figma text style
- Route B: reads from `figma.getLocalTextStylesAsync()`

### Typography Scale
From the Typography variable collection:
- **Font sizes:** visual blocks sized proportionally with pixel value labels
- **Font weights:** sample text rendered in each weight
- **Line heights:** sample text with vertical lines showing the height

### Radius
From the Radius variable collection:
- Rounded rectangle previews at each radius value
- Bound to cornerRadius variable via `setBoundVariable('topLeftRadius')` etc.
- Value label below each preview

### Shadows
From local effect styles filtered for "shadow" in the name:
- Card with shadow effect applied
- Style name and description shown
- Bound via `effectStyleId`

### Borders
From the Border Width variable collection:
- Rectangles with varying stroke weights
- Bound to strokeWeight variable
- Value label below each preview

### Z-Index
From the Z-Index variable collection:
- Stacked overlapping cards showing visual depth
- Each card labeled with its z-index name and value
- Cards positioned with increasing offset

### Opacity
From the Opacity variable collection:
- Horizontal scale of squares at different opacity levels
- Values shown as percentages (0% to 100%)
- Bound to opacity variable

### Spacing
From the Spacing variable collection:
- Nested frame visualization with colored padding areas
- Inner frame shows the spacing value
- Padding bound to spacing variables via `setBoundVariable('paddingTop')` etc.

### Breakpoints
From the Breakpoints variable collection:
- Nested portrait rectangles showing each breakpoint range
- Labels: xs (<567px), sm (567-767px), md (767-991px), lg (>991px)

## Layout

- **Frame width:** 1440px
- **Padding:** 80px on all sides
- **Section gap:** 60px between sections
- **Section titles:** 28px Inter Bold, dark text
- **Background:** White (#FFFFFF)
- **Frame name:** "foundations" (lowercase)

## Regeneration

The foundations page is regenerated from scratch each time:
1. Finds the existing "Foundations" frame on the Foundations page
2. Removes it
3. Creates a new frame with all sections
4. Auto-sizes height to fit all content

This means any manual edits to the Foundations page will be lost on regeneration.

## Variable Binding

A key feature of the foundations page is that visual elements are bound to their source variables. This means:
- Changing a color variable value automatically updates the swatch on the Foundations page
- Changing a spacing value updates the spacing preview
- The page serves as a live reference that stays in sync with the token definitions

Route B's variable-driven generator creates the most thorough bindings since it reads directly from the variable collections.
