# Naming Guide

This document covers every name that triggers special behavior in the plugin — both for **detection** (how the plugin finds things) and **generation** (what names the plugin creates). Renaming these elements will break or degrade features.

---

## Pages

### Detection

Pages are found by **case-insensitive partial match**. Non-alpha characters are stripped before matching, so `Desktop`, `🖥️ Desktop`, and `Desktop Page` all match.

| Keyword | What It Finds |
|---------|--------------|
| `cover` | Cover page (project metadata, status badge) |
| `foundations` | Foundations specimen page |
| `components` | Component library page |
| `desktop` | Desktop design frames |
| `mobile` | Mobile design frames |
| `archive` | Archived/deprecated designs |

If no match is found, the plugin auto-creates the page.

### Generated Names

| Page Name | When Created |
|-----------|-------------|
| `_Cover` | Step 1 (both routes) |
| `Foundations` | Step 1 |
| `Components` | Step 1 |
| `Desktop` | Step 1 |
| `Mobile` | Step 1 |
| `_Archive` | Route B Step 1 (archiving existing content) |

The underscore prefix on `_Cover` and `_Archive` keeps them sorted to the edges in Figma's page list.

---

## Variable Collections

### Detection

Collections are matched by **exact name**:

| Collection Name | Type | Used For |
|-----------------|------|----------|
| `Colors` | COLOR | Fill/stroke bindings (Light + Dark modes) |
| `Primitives` | COLOR | Raw color palette shade scales |
| `Spacing` | FLOAT | Padding, gap |
| `Radius` | FLOAT | Corner radius |
| `Border Width` | FLOAT | Stroke weight |
| `Opacity` | FLOAT | Opacity (0–100 percentage) |
| `Typography` | STRING + FLOAT | Font families, sizes, weights, line heights |
| `Z-Index` | FLOAT | Stacking order |
| `Breakpoints` | FLOAT | Responsive breakpoints |
| `Grid` | FLOAT | Column/gutter values per breakpoint |
| `Flags` | BOOLEAN | Feature flags |

If you rename a collection (e.g., `Colors` → `Brand Colors`), the plugin won't find it and will create a duplicate.

### Mode Names

| Mode | Collection | Purpose |
|------|-----------|---------|
| `Value` | Most collections | Default mode (renamed from Figma's `Mode 1`) |
| `Light` | Colors | Light theme |
| `Dark` | Colors | Dark theme |
| `xs`, `sm`, `md`, `lg` | Grid | Breakpoint-specific values |

---

## Special Variable Names

These variable names trigger specific behavior:

| Variable | Collection | Behavior |
|----------|-----------|----------|
| `brand/primary` | Colors | Used as accent color in specimens, wireframes, and components. Falls back to `#3B82F6` if not found |
| `text/primary` | Colors | Used as default text color in wireframes |
| `background-image` | Flags | Boolean flag — controls background image component visibility, triggers `background-image` CSS absorption during export |
| `grid/col-1` through `grid/col-12` | Grid | Column span percentage widths |
| `grid/gutter` | Grid | Gap between grid columns |
| `family/primary` | Typography | Primary font family (STRING) |
| `family/secondary` | Typography | Secondary font family (STRING) |
| `family/tertiary` | Typography | Tertiary font family (STRING) |
| `family/font-N` | Typography | Additional font families (font-4, font-5, etc.) |

Radius variables with a last segment of `md` or `default` are used as the default corner radius. Falls back to `8px`.

### Generated Variable Names

| Pattern | Example | Source |
|---------|---------|--------|
| `{hue}/{shade}` | `blue/500`, `gray/100` | Primitive color palettes |
| `brand/{role}` | `brand/primary`, `brand/secondary` | Semantic colors |
| `text/{role}` | `text/primary`, `text/secondary` | Text semantic colors |
| `border/{role}` | `border/default`, `border/strong` | Border semantic colors |
| `overlay/{role}` | `overlay/default` | Overlay semantic colors |
| `spacing/{name}` | `spacing/xs`, `spacing/md` | Spacing scale |
| `radius/{name}` | `radius/sm`, `radius/full` | Radius scale |
| `border/{name}` | `border/thin`, `border/default` | Border width scale |
| `opacity/{value}` | `opacity/50`, `opacity/75` | Opacity scale |
| `z-index/{name}` | `z-index/dropdown`, `z-index/modal` | Z-index scale |
| `shadow/{name}` | `shadow/sm`, `shadow/lg` | Effect styles |

---

## Component Sets

### Detection

Wireframe generators look for component sets by **exact name**:

| Component Set Name | Expected Variants | Used In |
|-------------------|-------------------|---------|
| `Button` | `Variant=Primary\|Secondary`, `Size=Default\|Large\|Small` | Hero CTA, popup CTA, banner CTA |
| `Input / Floating Label` | `State=Default\|Focused\|Error\|Disabled` | Popup form fields |
| `Input / Placeholder` | `State=Default\|Focused\|Error\|Disabled` | Popup form fields (alternative) |
| `Label` | `State=Default\|Focused\|Error\|Disabled` | Form field labels |
| `Dropdown` | `State=Default\|Focused\|Error\|Disabled` | Select fields in forms |
| `Background Image` | Any | Background image containers |
| `Image` | `Radius=full\|lg\|md\|sm\|xs` | Content images |

If a component set is not found, the wireframe generator creates fallback frames.

### Generated Component Names (Route A)

The Components page generator creates these component sets:

| Component Set | Variants Created |
|--------------|-----------------|
| `Button` | Primary × (Large, Default, Small) + Secondary × (Large, Default, Small) |
| `Input / Floating Label` | Default, Focused, Error, Disabled |
| `Input / Placeholder` | Default, Focused, Error, Disabled |
| `Input / Label+Placeholder` | Default, Focused, Error, Disabled |
| `Label` | Default, Focused, Error, Disabled |
| `Dropdown` | Default, Focused, Error, Disabled |
| `Image` | xs, sm, md, lg, xl, 2xl, full (radius variants) |
| `Background Image` | Single variant |

---

## Text Styles

### Detection

Text styles are matched by **hierarchical name** (`group/name`):

| Text Style | Used For |
|------------|----------|
| `heading/h1` | Hero headline |
| `heading/h2` | Section headings |
| `body/default` | Default body text |
| `body/lg` | Large body text (hero subtext) |
| `body/sm` | Small body text |
| `buttons/default` | Button labels |
| `buttons/lg` | Large button labels |
| `buttons/sm` | Small button labels |
| `input/default` | Input field text |
| `label/default` | Form field labels |
| `label/focused` | Focused state labels |
| `label/error` | Error state labels |

Falls back to Inter at the appropriate weight if styles aren't found.

### Generated Text Styles

The plugin creates component text styles with these exact names:

| Style Name | Weight | Size |
|-----------|--------|------|
| `buttons/lg` | 600 | 18px |
| `buttons/default` | 600 | 16px |
| `buttons/sm` | 600 | 14px |
| `input/default` | 400 | 14px |
| `label/default` | 500 | 12px |
| `label/focused` | 500 | 12px |
| `label/error` | 500 | 12px |

Route A also creates user-defined text styles from the configuration (e.g., `heading/h1`, `body/default`, etc.).

---

## Layer Names

### Naming Convention

The plugin enforces **kebab-case** naming. The audit flags violations.

**Valid:** `hero-content`, `cta-button`, `popup-inner`, `form-row`
**Invalid:** `HeroContent` (PascalCase), `hero content` (spaces), `hero_content` (underscores)

**Exceptions** (not flagged):
- COMPONENT and INSTANCE nodes (may use PascalCase by convention)
- SECTION nodes
- TEXT nodes whose name matches their text content
- Children of mask groups

### Default Name Detection

These auto-generated Figma names are flagged by the audit:

```
Frame, Frame 1, Rectangle, Rectangle 2, Ellipse, Polygon, Star,
Vector, Line, Arrow, Text, Group, Component, Instance, Image,
Section, Slice (with optional trailing number)
```

Pattern: `/^(Frame|Rectangle|Ellipse|Polygon|Star|Vector|Line|Arrow|Text|Group|Component|Instance|Image|Section|Slice)(\s+\d+)?$/i`

### Kebab-Case Conversion Rules

When converting names to kebab-case:
- CamelCase split: `myButton` → `my-button`
- Acronym split: `HTMLParser` → `html-parser`
- Spaces/underscores → hyphens
- Special characters stripped
- Path separators (`/`) preserved: `heading/h1` stays `heading/h1`

---

## Wireframe Frame Names

### Generated Names

These names are created during wireframe generation and used for detection/cleanup:

| Frame Name | Element |
|------------|---------|
| `promo/hero` | Hero section |
| `promo/popup` | Popup/modal |
| `promo/popup-thankyou` | Thank-you popup variant |
| `promo/banner` | Promotional banner |

**Internal elements:**

| Name | Element |
|------|---------|
| `hero-bg-image` | Hero background image |
| `hero-content` | Hero content container |
| `hero-image` | Hero content image |
| `popup-overlay` | Semi-transparent overlay |
| `popup-content` | Popup content wrapper |
| `popup-bg-image` | Popup background image |
| `popup-inner` | Inner content area |
| `form` | Form container |
| `form-row` | Form field row |
| `form-div` | Form section wrapper |
| `form-actions` | CTA button container |
| `close-button` | Popup close button |
| `close-icon` | X icon inside close button |
| `inner-banner` | Banner content wrapper |
| `banner-bg-image` | Banner background image |
| `banner-image` | Banner content image |
| `input-{name}` | Form field (e.g., `input-email`) |

### Cleanup

**Delete wireframes** removes all frames matching: `promo/*`, `form-row`, `form-div`, `input-*`.

---

## Cover Page

### Detection

Cover page found by: name lowercase contains `"cover"`.

### Generated Names

| Element Name | Purpose |
|-------------|---------|
| `cover` | Main cover frame (1440×960) |
| `accent-bar` | Left edge accent bar |
| `logo-placeholder` | Logo area |
| `project-name` | Project title text |
| `divider` | Horizontal divider line |
| `status-badge-bg` | Status badge background |

### Status Values

The status badge text matches exactly:

| Value | Badge Color |
|-------|------------|
| `In Progress` | Yellow |
| `Ready for Review` | Blue |
| `Dev Ready` | Green |

---

## HTML Export Name-to-Tag Mapping

Node names (and component names) are mapped to HTML tags. Checked case-insensitive:

### Layout Tags

| Name Contains | HTML Tag | Note |
|---------------|----------|------|
| `nav` | `<nav>` | Skipped on promo pages |
| `header` (exact match) | `<nav>` | Skipped on promo pages |
| `header` (substring) | `<header>` | Skipped on promo pages |
| `footer` | `<footer>` | Skipped on promo pages |
| `hero` | `<section>` | |
| `banner` | `<section>` | |
| `popup`, `modal`, `dialog` | `<div>` | |

### Interactive Tags

| Name Contains | HTML Tag |
|---------------|----------|
| `button`, `btn`, `cta` | `<button>` |
| `form` (exact match) | `<form>` |
| `dropdown`, `select` | Floating label form field |
| `floating label`, `floatinglabel`, `floating-label` | Floating label form field |
| `input`, `field`, `text-field` (component name) | Standard form field |
| `input`, `field`, `textarea` (node name) | `<input>` |
| `link` | `<a>` |
| `image`, `img`, `icon` (instance/component only) | `<img>` (requires exportSettings) |

### Text Tags

| Condition | HTML Tag |
|-----------|----------|
| Display/Heading text style | `<h1>` through `<h6>` |
| Body text | `<p>` |
| Unmatched text | `<p>` |

### CSS Class Generation

| HTML Tag | CSS Class |
|----------|-----------|
| `<nav>`, `<header>`, `<footer>` | Tag name (`nav`, `header`, `footer`) |
| `<section>` | Abbreviated node name or `section` |
| `<button>` | `btn` |
| `<form>` | `form` |
| Form fields | `form-field` |
| `<input>` | `input` |
| `<a>` | `link` |
| `<h1>`–`<h6>` | Tag name (`h1`, `h2`, etc.) |
| `<p>` | `text` |
| `<img>` | `img` |
| `<div>` | Abbreviated node name or `box` |

**Name abbreviation** strips filler words: `the`, `a`, `an`, `and`, `or`, `frame`, `group`, `auto`, `layout`, `wrapper`, `container`, `component`, `instance`, `section`, `page`, `div`, `block`, `element`, `item`, `default`, `variant`, `property`. Takes first 2 meaningful words, max 20 characters.

---

## Audit Skip Patterns

The **Fixed Sizing** check skips elements whose name contains (case-insensitive):

```
button, btn, icon, img, image, input, field, logo, close, chevron,
arrow, label, dropdown, badge, tag, chip, avatar, dot, indicator,
separator, divider
```

These are considered small elements expected to have fixed dimensions.

---

## Token File Import Detection

When importing DTCG JSON files, the type is auto-detected from the filename (case-insensitive):

| Filename Contains | Token Type | Collection |
|-------------------|-----------|------------|
| `text-style` or `textstyle` | Text styles | (Figma text styles) |
| `primitive` | Primitives | Primitives |
| `dark` | Dark mode colors | Colors (Dark mode) |
| `light` | Light mode colors | Colors (Light mode) |
| `color` or `colour` | Light mode colors | Colors (Light mode) |
| `spacing` | Spacing | Spacing |
| `typography` | Typography | Typography |
| `radius` | Radius | Radius |
| `border` | Border width | Border Width |
| `opacity` | Opacity | Opacity |
| `shadow` | Shadows | (Effect styles) |
| `z-index` | Z-index | Z-Index |
| `breakpoint` | Breakpoints | Breakpoints |
| `grid` | Grid | Grid |

**Import order matters:** Import `colors-light.json` before `colors-dark.json` to get proper Light/Dark modes in a single collection.

---

## pluginData Roles

The plugin stores metadata on nodes using `setPluginData("role", value)`:

| Role Value | Meaning | Set By |
|------------|---------|--------|
| `background-image` | Marks node as a background image container | Component generators |

**Detection cascade** during HTML export:
1. Direct `pluginData("role")` on the node
2. Instance's main component pluginData
3. Component set pluginData
4. Variable binding: `visible` bound to a variable named `background-image`
5. Component name contains `background-image` or `background image`

---

## Component Detection Layer Naming (Route B)

When AI-detected components are created, layers are renamed to semantic kebab-case:

### TEXT Nodes

| Original Name Contains | Renamed To |
|-----------------------|-----------|
| `label` | `label` |
| `placeholder` | `placeholder` |
| `title`, `heading` | `title` |
| `description`, `desc` | `description` |
| (default) | `text` |

### FRAME Nodes

Named by detected role in the component structure: `button`, `card`, `input-field`, `icon-wrapper`, `image-container`, etc.

### Figma Default Names

Any `Frame 12`, `Rectangle 45`, etc. are replaced with purpose-based names derived from node content, children, and visual properties.
