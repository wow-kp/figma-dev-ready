# Dev-Ready Tools for Designers

A Figma plugin that takes you from an empty file to a fully tokenized, audited, dev-ready design system — with specimen pages, promotional wireframes, and production HTML/CSS export.

---

## What's Inside

The plugin has three main tabs:

| Tab | Purpose | Access |
|-----|---------|--------|
| **Workflow** | 5-step guided setup: file structure, tokens, wireframes, audit, handoff | Always visible (default tab) |
| **Tools** | Design audit, token debugger, variable import | Always visible |
| **Build HTML** | Generate production HTML/CSS from your wireframes | Unlocked after "Dev Ready" handoff in Step 5 |

The **Tools** tab has three sub-tabs:

| Sub-tab | Purpose |
|---------|---------|
| **Audit** | Score your file against 14 weighted checks, auto-fix common issues |
| **Tokens** | Inspect variable bindings and alias chains live on any selected layer |
| **Import** | Drag-and-drop DTCG JSON files to create native Figma Variables |

---

## Installation

### Local Development

1. Clone or download this repo
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the plugin:
   ```bash
   npm run build
   ```
   Or for live rebuilds during development:
   ```bash
   npm run watch
   ```
4. Open **Figma Desktop**
5. Go to **Plugins > Development > Import plugin from manifest**
6. Select the `manifest.json` file from this folder
7. Run via **Plugins > Development > Dev-Ready Tools for Designers by wowbrands**

### Private Org Plugin (Figma Organisation Plan)

1. In Figma, go to **Plugins > Manage plugins > Publish new plugin**
2. Select your organization
3. Upload the plugin files and submit

### Figma Community (Public)

1. Go to your plugin's page in **Plugins > Manage plugins**
2. Click **Publish to Community**
3. Write a description and submit for review (usually takes a few days)

### File Structure

```
/
├── manifest.json              # Plugin manifest (name, permissions, entry points)
├── build.js                   # Build script (proxy-config injection + esbuild ES2020 IIFE bundle)
├── package.json               # Dependencies & build scripts
├── proxy-config.example.json  # Example proxy config (copy to proxy-config.json)
├── ui.html                    # Plugin UI (runs in Figma iframe)
├── code.js                    # Built plugin logic (generated — do not edit directly)
├── src/
│   ├── main.ts                # Entry point & message routing
│   ├── audit.ts               # Design audit engine (14 checks, weighted scoring)
│   ├── cover.ts               # Cover page generator
│   ├── constants.ts           # Shared constants (breakpoints, dimensions)
│   ├── utils.ts               # Shared helpers (color math, font loading, etc.)
│   ├── tokens-generate.ts     # Token data generation (colors, spacing, typography, etc.)
│   ├── tokens-import.ts       # DTCG JSON → Figma Variables importer
│   ├── foundations.ts          # Foundations specimen page generator
│   ├── foundations-complex.ts  # Foundations from existing variables
│   ├── components.ts          # Components specimen page generator
│   ├── components-complex.ts  # Components from existing variables
│   ├── wireframes.ts          # Promotional wireframe generator (hero, popup, banner)
│   └── html-export.ts         # HTML/CSS export engine
└── proxy/                     # Cloudflare Worker proxy for Claude API
    ├── src/index.ts           # Worker entry point (CORS, rate limiting, forwarding)
    ├── package.json           # Proxy dependencies (wrangler, workers-types)
    ├── tsconfig.json          # TypeScript config for worker
    └── wrangler.example.toml  # Example Wrangler config (copy to wrangler.toml)
```

---

## Naming Conventions & Reserved Names

The plugin relies on naming conventions for detection, export, and cleanup. This section documents **every name that triggers special behavior**. Renaming these elements will break or degrade features.

### Page Names

Pages are discovered by **case-insensitive partial match**. The plugin looks for these keywords anywhere in the page name (non-alpha characters are stripped before matching):

| Keyword | Page Purpose | Created As |
|---------|-------------|------------|
| `cover` | Project metadata + status badge | `_Cover` |
| `foundations` | Design token specimens | `Foundations` |
| `components` | Component library specimens | `Components` |
| `mobile` | Mobile wireframe layouts | `Mobile` |
| `desktop` | Desktop wireframe layouts | `Desktop` |
| `archive` | Deprecated designs | `Archive` |

`🖥️ Desktop`, `Desktop Page`, and `desktop` all match. If no match is found, the plugin auto-creates the page.

### Variable Collection Names

Collections are matched by **exact name**. The plugin creates and looks up these collections:

| Collection Name | Variable Type | Used For |
|-----------------|--------------|----------|
| `Colors` | COLOR | All fill/stroke color bindings |
| `Spacing` | FLOAT | Padding, gap, margins |
| `Radius` | FLOAT | Corner radius values |
| `Border` | FLOAT | Border width values |
| `Opacity` | FLOAT | Opacity values (two modes: Value + Percentage) |
| `Typography` | STRING + FLOAT | Font families, sizes, weights, line heights |
| `Z-Index` | FLOAT | Stacking order values |
| `Breakpoints` | FLOAT | Responsive breakpoint values |
| `Grid` | FLOAT | Grid column and gutter values |
| `Primitives` | COLOR | Raw color palette (shade scales) |
| `Flags` | BOOLEAN | Feature flags (e.g., background-image visibility) |

If a collection doesn't exist when needed, the plugin creates it. But if you rename an existing collection (e.g., `Colors` to `Brand Colors`), the plugin won't find it and will create a duplicate.

### Variable Mode Names

| Mode Name | Collection | Purpose |
|-----------|-----------|---------|
| `Value` | Most collections | Default mode (renamed from Figma's auto-generated `Mode 1`) |
| `Percentage` | Opacity | Stores 0-100 values alongside the 0-1 decimal mode |
| `Light` | Colors | Light theme colors |
| `Dark` | Colors | Dark theme colors |

The `Percentage` mode is **required** for opacity binding — the plugin creates it if missing.

### Variable Name Patterns

These variable names have special meaning:

| Variable Name | Collection | Purpose |
|---------------|-----------|---------|
| `brand/primary` | Colors | Brand's primary color — used as accent throughout specimens and wireframes. Falls back to `#3B82F6` if not found. |
| `background-image` | Flags | Boolean flag bound to bg-image component visibility — triggers background image detection during export |
| `grid/col-1` through `grid/col-12` | Grid | Column span widths for grid layout |
| `grid/gutter` | Grid | Gap between grid columns |

Radius variables named `md` or `default` (last segment of the hierarchical name) are used as the default corner radius. Falls back to `8px`.

### Component Set Names

The wireframe and specimen generators look for component sets by **exact name**:

| Component Set Name | Expected Variants | Used For |
|-------------------|-------------------|----------|
| `Button` | `Primary`, `Default` | CTA buttons in wireframes |
| `Input / Floating Label` | `State=Default` | Form fields in wireframes |
| `Label` | `State=Default` | Field labels in wireframes |
| `Dropdown` | `State=Default` | Select fields in wireframes |
| `Background Image` | Any | Background image containers |

If a component set is not found, the wireframe generator creates fallback frames instead.

### Text Style Names

Text styles are discovered by hierarchical names (`group/name`):

| Text Style Name | Used For |
|----------------|----------|
| `heading/h1` | Hero headline |
| `heading/h2` | Section headings |
| `body/default`, `body/lg`, `body/sm` | Body text |
| `buttons/default`, `buttons/sm` | Button labels |
| `label/default` | Form field labels |

Falls back to loading `Inter` at the appropriate weight if styles aren't found.

### Wireframe Frame Names

These names are assigned during wireframe generation and used for **cleanup/deletion**:

| Frame Name | Element |
|------------|---------|
| `promo/hero` | Hero section (desktop + mobile) |
| `promo/popup` | Popup/modal |
| `promo/popup-thankyou` | Thank-you popup variant |
| `promo/banner` | Promotional banner |
| `popup-content` | Inner popup wrapper |
| `popup-inner` | Content area inside popup |
| `popup-overlay` | Semi-transparent overlay behind popup |
| `close-button` | Popup close button |
| `close-icon` | X icon inside close button |
| `form-row` | Row container for form fields |
| `form-div` | Wrapper for form section |
| `form-actions` | CTA button container in forms |
| `input-*` | Form fields (e.g., `input-email`, `input-name`) |
| `field` | The actual input element inside a form field |
| `form-field` | Form field component container |
| `field-wrapper` | Wrapper inside form-field component |

**Cleanup:** When you click **Delete wireframes**, the plugin removes all frames matching `promo/*`, `form-row`, `form-div`, and `input-*` patterns.

### pluginData Roles

The plugin stores metadata on nodes using `setPluginData("role", value)`:

| Role Value | Meaning |
|------------|---------|
| `background-image` | Marks a component as a background image container — triggers absorption into parent's CSS `background-image` during export |

This is set automatically during component generation. The export checks for it with multiple fallbacks:
1. Direct `pluginData("role")` check on the node
2. Instance's main component pluginData
3. Component set pluginData
4. Variable binding: `visible` bound to a variable named `background-image`
5. Component name contains `background-image` or `background image`

### HTML Export — Name-to-Tag Mapping

During HTML export, node names are mapped to semantic HTML tags. The mapping checks both the node name and its main component's name (lowercased):

| Name Contains | HTML Tag | Notes |
|---------------|----------|-------|
| `nav` | `<nav>` | Skipped on promo pages |
| `header` (exact match) | `<nav>` | Skipped on promo pages |
| `header` (substring) | `<header>` | Skipped on promo pages |
| `footer` | `<footer>` | Skipped on promo pages |
| `hero` | `<section>` | |
| `banner` | `<section>` | |
| `popup`, `modal`, `dialog` | `<div>` | |
| `form` (exact match) | `<form>` | |
| `button`, `btn`, `cta` | `<button>` | |
| `dropdown`, `select` | `<select>` | |
| `floating label` (component name) | Form field with floating label | Wraps in `<div class="form-field">` |
| `input`, `field`, `text-field` (component name) | Form field | Wraps in `<div class="form-field">` |
| `input`, `field`, `textarea` (node name) | `<input>` | |
| `link` | `<a>` | |
| `image`, `img`, `icon` (component name) | `<img>` | Only if node has `exportSettings` |

**Text nodes** are mapped based on their text style:
- Display/Heading styles → `<h1>` through `<h6>`
- Body text → `<p>`

**Fallback:** Unmatched frames become `<div>`. Unmatched text becomes `<p>`.

### HTML Export — CSS Class Names

| Tag | CSS Class |
|-----|-----------|
| `<nav>`, `<header>`, `<footer>`, `<main>` | Tag name (e.g., `nav`, `header`) |
| `<section>` | Abbreviated node name or `section` |
| `<button>` | `btn` |
| `<form>` | `form` |
| Form fields | `form-field` |
| `<input>` | `input` |
| `<select>` | `select` |
| `<a>` | `link` |
| `<h1>`-`<h6>` | Tag name |
| `<p>` | `text` |
| `<img>` | `img` |
| `<div>` | Abbreviated node name or `box` |

### Audit — Name-Based Skip Patterns

The audit skips the **Fixed Sizing** check for elements whose names match this pattern (case-insensitive):

```
button|btn|icon|img|image|input|field|logo|close|chevron|arrow|label|dropdown
```

These are considered "small elements" expected to have fixed dimensions.

---

## Workflow Tab (5 Steps)

The Workflow tab is the main guided experience. It walks you through 5 sequential steps, each unlocking the next. Steps collapse when complete and lock when prerequisites aren't met.

### Step 1: File Structure

Creates the standard page hierarchy for your design file.

**Pages created:**

| Page | Purpose |
|------|---------|
| `_Cover` | Project metadata: name, version, designer, status badge |
| `Foundations` | Color swatches, typography, spacing, radius, shadow specimens |
| `Components` | Button, form field, card, badge, avatar, list examples |
| `Mobile` | Mobile wireframe layouts (567px breakpoint) |
| `Desktop` | Desktop wireframe layouts (1440px) |
| `Archive` | For removed or deprecated designs |

**Cover page configuration:**

The cover page has a collapsible form with fields for:
- **Project Name** (text input)
- **Version** (text input)
- **Last Updated** (date input)
- **Designer(s)** (text input)
- **Status** (dropdown): In Progress / Ready for Review / Dev Ready

The cover frame is 1440x960px with a dark background (#1a1a18), a blue accent bar on the left edge, and a status badge that changes color:
- **In Progress** — yellow
- **Ready for Review** — blue
- **Dev Ready** — green

Click **Generate Cover Page** to create or update it.

For the remaining pages, the plugin shows which exist and which are missing. Click **Create missing pages** to scaffold them all at once.

### Step 2: Design Tokens

Unlocked after Step 1 is complete. Has two subsections: **Basic Variables** and **Complex Variables**.

#### Basic Variables

Each token category has a checkbox to enable/disable it, an expandable configuration panel, and a count of existing tokens.

**Colors** — configurable:
- **Primary color** (hex picker) — default `#3B82F6`
- **Secondary color** (hex picker) — default `#8B5CF6`
- **Tertiary color** (hex picker) — default `#06B6D4`
- **Text color** (hex picker)
- **Custom color slots** — add as many as needed
- Auto-generated: black, white, gray scale (50-900), focus ring, error, success, warning, info
- Shade scales: 10 shades per hue (50 through 900) via HSL curves

**Text Styles** — configurable table:
- Each style has: Name, Font, Size, Weight, Line Height, Letter Spacing, Paragraph Spacing
- Style groups: Display (L/M/S), Heading (H1-H6), Body (L/M/S), Caption (L/S), Label (L/S), Link (L/S)
- Add/delete individual styles per group

**Typography** — configurable:
- Font sizes, font weights, line heights (editable grids)

**Radius** — configurable:
- Visual radius cards with preview + input
- Defaults: 0, 2, 4, 6, 8, 12, 16, 24, 32 px

**Shadows** — configurable:
- Shadow picker with sliders for X, Y, Blur, Spread + color swatch
- Define using CSS `box-shadow` syntax: `0 1px 3px rgba(0,0,0,0.12)`

**Border** — configurable:
- Border width values. Defaults: 0, 1, 2, 4 px

**Z-Index** — configurable:
- Stacking order levels. Defaults: 0, 10, 20, 30, 40, 50

**Opacity** — always enabled:
- 5% through 95% in 5% steps
- Stored as both decimal (0-1) and percentage (0-100) in two modes

**Spacing** — always enabled:
- Scale: 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 px

**Breakpoints** — always enabled:
- Mobile (567px), Tablet, Desktop (1440px)

**Grid** — always enabled:
- 12-column layout with gutter

Click **Generate Enabled Tokens** to create all selected categories as native Figma Variables, Variable Collections, Text Styles, and Effect Styles. Click **Reset Variables & Text Styles** to delete everything and start over.

#### Complex Variables

For advanced token setups imported from external tools:
- Links to the [Figma Variables Generator](https://figma-variables-generator.netlify.app/)
- Drag-and-drop zone for DTCG JSON files (same as the Import sub-tab in Tools)
- Inline file queue with status indicators
- Import button

### Step 3: Page Structures

Unlocked after Step 2 is complete. Generates wireframe pages from your design tokens.

If you want to design your own pages instead of using generated wireframes, click **"Skip — I'll design my own pages"** to bypass this step and proceed directly to the audit. You can undo the skip at any time.

**Page type selector** (tabs):
- **Promo** — promotional pages (hero, popup, banner)
- **Landing Page** — (future)
- **Full Site Build** — (future)

**For Promo type, section checkboxes:**

| Section | Description |
|---------|-------------|
| **Hero Section** | Full-width background image + headline + subheadline + CTA |
| **Popup** | Modal with overlay, background image, form fields, CTA, close button |
| **Banner** | Horizontal promotional bar with background image + text + CTA |

**Popup form builder** (when Popup is checked + "Include form fields" is enabled):
- **Form Layout** — visual grid builder
  - Add rows with configurable column counts
  - Drag-and-drop field placement into grid cells
  - Resize handles between columns
  - Row controls: move up/down, delete
- **Field Pool** — available field types as draggable chips
  - Each field has: label, input type dropdown tag, required toggle, delete button

**Wireframe details:**

*Hero Section:*
| Element | Figma Setup |
|---------|-------------|
| Background image | Absolute positioned, STRETCH constraints, `scaleMode: FILL` (cover) |
| Content container | Auto-layout vertical, centered |
| Headline | Bound to `heading/h1` text style |
| Subheadline | Bound to `body/lg` text style |
| CTA button | Instance of `Button` component (or fallback frame) |

*Popup / Modal:*
| Element | Figma Setup |
|---------|-------------|
| Overlay (`popup-overlay`) | Absolute, STRETCH constraints, bound to opacity variable |
| Content area (`popup-content`) | Auto-layout vertical |
| Background image | Inside content, absolute positioned, SCALE constraints |
| Inner content (`popup-inner`) | Auto-layout vertical, padding from spacing variables |
| Form fields | Instances of `Input / Floating Label` component |
| CTA button | Instance of `Button` component |
| Close button (`close-button`) | Absolute, MAX + MIN constraints (top-right corner) |
| Thank-you variant | Same structure without form, with success message |

*Banner:*
| Element | Figma Setup |
|---------|-------------|
| Background image | Absolute positioned |
| Content | Horizontal auto-layout with text + CTA |

All wireframes are generated on both Desktop and Mobile pages simultaneously. All elements auto-bind to your color, spacing, radius, border, opacity, and shadow variables.

Click **Generate** to create wireframes, or **Regenerate** to delete and recreate.

### Step 4: Audit & Validation

Unlocked after Step 3 is complete. Runs the same audit engine as the Tools > Audit sub-tab, but embedded in the workflow.

- Shows the score bar with circular progress indicator
- Lists all check results grouped by category
- **Run Audit** / **Re-run Audit** button

You must pass all **Critical** and **High** priority checks to proceed to Step 5.

### Step 5: Ready for Dev

Unlocked after Step 4 passes. Shows a summary checklist:

| Checklist Item | Detail |
|----------------|--------|
| Pages created | Lists which pages exist |
| Design tokens generated | Token count details |
| Wireframes built | Which wireframe sections were generated |
| Audit passed | Score and critical/high check status |

**Actions:**
- **Mark as Dev Ready** — sets the project status, updates the cover page badge to green, and **unlocks the Build HTML tab**
- **Revoke — Back to In Progress** — reverts status, hides the Build HTML tab

---

## Tools Tab

### Audit (Sub-tab)

Scans every node on the current page and produces a weighted score from 0 to 100.

#### How to Run

1. Click **Run audit on current page**
2. Review the score (circular progress indicator with verdict)
3. Expand any failing check to see individual issues
4. Click an issue row to select and zoom to that layer in the canvas
5. Use inline action buttons (Rename, Delete, Bind) on individual issues
6. Fix remaining issues manually and click **Re-run audit**

#### Checks

**Naming & Structure:**

| Priority | Check | What It Flags |
|----------|-------|---------------|
| Critical | **Default Layer Names** | Auto-generated names (`Frame 3`, `Rectangle`, `Group 12`) |
| High | **Naming Convention** | Non-kebab-case names (spaces, PascalCase, snake_case) |
| Medium | **Deep Nesting** | Frames or groups nested 6+ levels deep |

**Layout:**

| Priority | Check | What It Flags |
|----------|-------|---------------|
| Critical | **Auto Layout** | Frames with 2+ children not using Auto Layout |
| High | **Fixed Sizing** | Layout containers with fixed width instead of fill (skips small elements — see naming patterns) |

**Variables & Styles:**

| Priority | Check | What It Flags |
|----------|-------|---------------|
| Critical | **Color Variables** | Solid fills/strokes not bound to a variable |
| Critical | **Spacing Variables** | Auto layout padding/gap not bound to a variable |
| High | **Radius Variables** | Corner radius not bound to a variable |
| Low | **Opacity Variables** | Non-default opacity not bound to a variable |

**Typography:**

| Priority | Check | What It Flags |
|----------|-------|---------------|
| Critical | **Text Styles** | Text layers not attached to a text style |
| High | **Mixed Text Styles** | Text with multiple conflicting inline styles |

**Hygiene:**

| Priority | Check | What It Flags |
|----------|-------|---------------|
| Low | **Hidden Layers** | Invisible layers |
| Trivial | **Empty Containers** | Frames/groups with no children |
| Medium | **Unsaved Effect Styles** | Shadows/blurs not saved as effect style |

#### Score Weighting

| Weight | Priority |
|--------|----------|
| 5 | Critical |
| 4 | High |
| 3 | Medium |
| 2 | Low |
| 1 | Trivial |

Penalty per check scales with issue count (2 = mild, 20+ = severe), multiplied by weight. Score **80+** means critical checks are clean.

#### Auto-Fix

Inline action buttons appear on individual issue rows:

| Action | What It Does |
|--------|--------------|
| **Rename** | Infers a name from text content, dominant child type, or node type |
| **Delete** | Removes the flagged node |
| **Bind** | Matches raw hex fill to the closest COLOR variable (~4% color distance) |

All changes are **undoable with Cmd+Z**.

### Tokens (Sub-tab / Token Debugger)

Select any single layer on the canvas to see every variable binding and style reference in real time. Updates live as you click — no button press needed.

**Three states:**
- **No selection** — "Select a layer to inspect" message
- **Multi-selection** — "Select a single layer" message
- **Single selection** — full inspection panel

#### Inspection Panel

**Header:** Node type badge + layer name + stats row (bound / unbound / broken counts with colored dots)

**Property groups** (with icons and counts):

| Group | Properties Inspected |
|-------|---------------------|
| **Color** | Fills (per fill), strokes (per stroke) — with color swatches |
| **Shape** | Corner radius (uniform + per-corner: topLeft, topRight, bottomLeft, bottomRight) |
| **Spacing** | Padding (top, right, bottom, left), gap (itemSpacing), counter-axis spacing |
| **Size** | Width, height (only when variable-bound) |
| **Typography** | Text style reference, font family, font size, font weight, line height, letter spacing |
| **Effects** | Effect style reference, shadow/blur parameters |
| **Other** | Opacity |

**For each property, the full alias chain is displayed:**

```
Fill
  ○  button/surface     Semantic     ↓
  ○  surface/default    Colors       ↓
  ●  gray/50            Primitives   ■ #F9FAFB
```

Each step shows: variable name, collection badge, arrow (if alias continues), terminal value with color swatch.

**Three states per property:**

| Badge | Meaning |
|-------|---------|
| (green) Bound | Full alias chain with resolved value |
| (yellow) Unbound | Raw value — hex swatch for colors, px for dimensions |
| (red) Broken | Variable deleted or renamed after binding |

### Import (Sub-tab)

Imports DTCG-format JSON files into native Figma Variable collections.

#### Supported File Types

Auto-detected from filename (case-insensitive):

| Filename Contains | Collection Created | Variable Type |
|-------------------|-------------------|---------------|
| `primitives` | Primitives | COLOR |
| `color` or `colours` (not `dark`) | Colors (Light mode) | COLOR |
| `dark` | Colors (Dark mode) | COLOR |
| `text-style` or `textstyle` | (Text Styles) | Text Styles |
| `spacing` or `gap` | Spacing | FLOAT |
| `radius` or `corner` | Radius | FLOAT |
| `border` | Border | FLOAT |
| `opacity` | Opacity | FLOAT (two modes) |
| `shadow` | (Effect Styles) | Effect Styles |
| `typography` | Typography | STRING + FLOAT |
| `z-index` or `zindex` | Z-Index | FLOAT |
| `breakpoint` | Breakpoints | FLOAT |
| `grid` | Grid | FLOAT |

#### Import Order

For color tokens with light/dark modes:
1. **`colors-light.json` first** — creates the Colors collection + Light mode
2. **`colors-dark.json` second** — adds Dark as a second mode

Importing dark before light creates a separate collection.

#### Re-importing

Updates variables in place rather than creating duplicates. Matched by variable name within the collection.

#### How to Import

1. Click the drop zone or drag-and-drop one or more JSON files
2. Verify the detected type shown under each filename (status: ok or error)
3. Remove unwanted files with the × button
4. Click **Import to Figma**
5. Check the **Local Variables** panel — collections are created automatically

---

## Build HTML Tab

Unlocked after completing Step 5 (marking as "Dev Ready") in the Workflow tab. Generates production-ready HTML and CSS from your Figma wireframes.

### Controls

| Control | Description |
|---------|-------------|
| **Include mobile responsive styles** | Checkbox (on by default) — includes Mobile page diff as `@media` overrides |
| **Enhance with Claude AI** | Checkbox (on by default) — sends screenshots to Claude for semantic HTML improvements |
| **Anthropic API Key** | Password field (shown only if proxy is down or you switch to key mode) — your Claude API key |
| **Generate HTML** | Primary action button — starts the export pipeline |

### Claude AI Enhancement

When **Enhance with Claude AI** is checked, the plugin sends your generated HTML, CSS, and frame screenshots to Claude for semantic improvements — better tag choices, accessibility attributes, and CSS quality.

There are two ways to authenticate with the Claude API:

#### Option A: Cloudflare Worker Proxy (Recommended for Teams)

The proxy keeps your Anthropic API key on the server side so individual designers never see it. It also adds per-user rate limiting and an optional allowlist.

**How it works:**
1. The plugin checks `proxy/health` on load
2. If the proxy is healthy, AI enhancement uses it automatically — no API key input needed
3. The plugin sends the user's Figma User ID via `X-Figma-User-Id` header for rate limiting and allowlisting
4. The proxy forwards requests to `https://api.anthropic.com/v1/messages` with the server-side API key
5. If the proxy is down, the plugin falls back to asking for a personal API key

**Setting up the Cloudflare Worker:**

Prerequisites:
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) v18+
- An [Anthropic API key](https://console.anthropic.com/) with credits

Steps:

```bash
# 1. Install Wrangler (Cloudflare's CLI)
npm install -g wrangler

# 2. Log in to Cloudflare
wrangler login

# 3. Navigate to the proxy directory
cd proxy

# 4. Install dependencies
npm install

# 5. Copy the example config and fill in your KV namespace ID (see step 6)
cp wrangler.example.toml wrangler.toml

# 6. Create a KV namespace for rate limiting
wrangler kv namespace create "RATE_LIMIT_KV"
#    This outputs an ID like: { id = "abc123..." }
#    Paste that ID into wrangler.toml under [[kv_namespaces]]

# 7. Store your Anthropic API key as a secret (never in wrangler.toml)
wrangler secret put ANTHROPIC_API_KEY
#    Paste your sk-ant-... key when prompted

# 8. Deploy
npm run deploy
#    Output: https://figma-dev-ready-proxy.<your-subdomain>.workers.dev
```

**Configure `wrangler.toml`:**

```toml
name = "figma-dev-ready-proxy"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
# Comma-separated Figma user IDs allowed to use the proxy.
# Leave empty to allow anyone (open mode).
ALLOWED_USERS = ""
# Max requests per user per rolling 1-hour window.
RATE_LIMIT_MAX = "30"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "<paste-your-kv-namespace-id-here>"
```

**Point the plugin to your worker:**

Copy the example config and paste your worker URL:

```bash
cd ..   # back to project root
cp proxy-config.example.json proxy-config.json
```

Edit `proxy-config.json`:

```json
{
  "proxyUrl": "https://figma-dev-ready-proxy.YOUR_SUBDOMAIN.workers.dev"
}
```

Replace `YOUR_SUBDOMAIN` with the subdomain from your `wrangler deploy` output. Then rebuild:

```bash
npm run build
```

The build script (`build.js`) reads `proxy-config.json` and automatically:
- Injects the proxy URL into `ui.html` (the `_bhProxyUrl` variable)
- Adds your worker domain to `manifest.json`'s `networkAccess.allowedDomains`

If `proxy-config.json` is missing or contains `YOUR_SUBDOMAIN`, the plugin builds in **API-key-only mode** (proxy disabled).

> **Note:** `proxy-config.json` is gitignored — each developer/deployment has its own config. Only `proxy-config.example.json` is committed.

**Finding Figma User IDs for the allowlist:**

Each designer's Figma User ID is sent as the `X-Figma-User-Id` header. To find it:
1. Have each designer open the plugin and click **Generate HTML** with AI enhancement on
2. Check Cloudflare Worker logs: `wrangler tail` — the user ID appears in each request
3. Add the IDs to `ALLOWED_USERS` in `wrangler.toml` as a comma-separated list, then redeploy

**Proxy endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check — plugin calls this on load to detect proxy availability |
| `/v1/messages` | POST | Proxied Claude API call — forwards to `api.anthropic.com/v1/messages` |

**Rate limiting:**

- Tracked per Figma User ID in Cloudflare KV
- Rolling 1-hour window, default 30 requests/hour
- Configurable via `RATE_LIMIT_MAX` in `wrangler.toml`
- If KV is unreachable, requests are allowed (fail-open)

#### Option B: Personal API Key (Individual Use)

If no proxy is configured or the proxy is down, the plugin shows an API key input field.

1. Go to [console.anthropic.com](https://console.anthropic.com/)
2. Sign up or log in
3. Navigate to **API Keys**
4. Create a new key (starts with `sk-ant-...`)
5. Paste it into the **Anthropic API Key** field in the Build HTML tab
6. The key is **session-only** — it stays in memory while the plugin is open and is never persisted to storage. You'll need to re-enter it each time you reopen the plugin

In this mode, the plugin calls the Anthropic API directly from the Figma sandbox using the `anthropic-dangerous-direct-browser-access` header. This requires `https://api.anthropic.com` in `manifest.json`'s `networkAccess.allowedDomains`.

**Switching between modes:**

- When the proxy is healthy, the plugin shows: **"Using secure proxy"** with a link to switch to personal key mode
- When in key mode, a link to switch back to proxy mode appears (if proxy is available)
- The toggle is session-only — on next plugin open, proxy is auto-detected again

### Export Pipeline

When you click **Generate HTML**, a terminal-style console appears showing progress through 7 phases:

| Phase | Progress | What Happens |
|-------|----------|--------------|
| Scan | 10% | Finds Desktop & Mobile pages, validates Desktop exists |
| Resolve Variables | 25% | Walks entire Desktop node tree, extracts CSS styles & variable references |
| Build Utility Map | 40% | Creates Tailwind-like utility class mappings from your tokens |
| Assign Utilities | 40% | Applies utility classes to every node |
| Export Images | 70% | Exports each image node as JPG/WebP at 1x and @2x |
| Generate HTML/CSS | 80% | Renders semantic HTML markup + full CSS stylesheet |
| Capture Screenshots | 95% | (If AI enabled) Exports frame screenshots for Claude context |
| Done | 100% | Files ready for download |

### Output

After generation completes, the results panel shows:

- **Stats** — node count, file count, image count, variable count
- **Version toggle** — switch between Raw and AI Enhanced versions (when AI is enabled)
- **Save to Folder** — downloads everything as a zip file
- **Copy HTML** — copies to clipboard
- **Preview HTML** — collapsible code preview
- **Preview CSS** — collapsible code preview

### What Gets Exported

| Artifact | Contents |
|----------|----------|
| **CSS file** | `:root` custom properties, reset styles, utility classes, component styles, mobile `@media` overrides |
| **HTML files** | One per top-level frame (promo mode) or single `index.html` (landing mode) |
| **Image assets** | 1x and @2x resolution, JPG + WebP formats |

### CSS Custom Properties

Every Figma Variable becomes a CSS custom property:

```css
:root {
  --color-brand-primary: #3B82F6;
  --color-surface-default: #FFFFFF;
  --spacing-md: 16px;
  --radius-md: 8px;
  --opacity-50: 0.5;
}
```

Variable names are converted: `brand/primary` → `--color-brand-primary` (collection prefix + kebab-case).

### CSS Extraction Pipeline

The export uses 10 focused extractors that resolve variable bindings and emit `var(--name)` references:

| Extractor | Figma Properties | CSS Output |
|-----------|-----------------|------------|
| **extractPosition** | `layoutPositioning`, `constraints`, `x`, `y` | `position: absolute`, positioning, `z-index`, dimensions |
| **extractLayout** | `layoutMode`, alignment, `itemSpacing`, `padding*`, `layoutWrap` | `display: flex/grid`, direction, justify, align, gap, padding, wrap |
| **extractSizing** | `layoutSizingHorizontal/Vertical`, dimensions, `clipsContent` | `width`, `height`, `flex`, min/max dimensions, `overflow` |
| **extractFills** | `fills` (Solid, Gradient, Image) | `background-color`, `background`, `background-image`, `background-size` |
| **extractCorners** | `cornerRadius`, per-corner radii | `border-radius` (uniform or per-corner) |
| **extractStrokes** | `strokes`, weight, align, dash | `border`, `outline`, `border-style` |
| **extractEffects** | DropShadow, InnerShadow, Blur, Glass | `box-shadow`, `filter`, `backdrop-filter` |
| **extractOpacity** | `opacity` | `opacity` |
| **extractBlendMode** | `blendMode` (18 modes) | `mix-blend-mode` |
| **extractText** | Font properties, styles, decoration, case | `font-*`, `line-height`, `letter-spacing`, `text-*`, `font-variant-caps` |

#### Fill Types

| Figma Fill | CSS |
|-----------|-----|
| SolidPaint | `background-color: var(--color-name)` or `rgb(...)` |
| LinearGradient | `linear-gradient(angle, stops)` |
| RadialGradient | `radial-gradient(stops)` |
| AngularGradient | `conic-gradient(from angle, stops)` |
| DiamondGradient | `radial-gradient(stops)` (approximation) |
| ImagePaint | `background-image: url(...)` with size from scaleMode |
| Multiple fills | Comma-separated `background` layers |

#### Text Properties

| Figma | CSS |
|-------|-----|
| `fontFamily` | `font-family` |
| `fontSize` | `font-size` (variable-bound) |
| `fontWeight` | `font-weight` (variable-bound) |
| `lineHeight` | `line-height` (variable-bound) |
| `letterSpacing` | `letter-spacing` |
| `textCase: UPPER/LOWER/TITLE` | `text-transform` |
| `textCase: SMALL_CAPS` | `font-variant-caps: small-caps` |
| `textCase: SMALL_CAPS_FORCED` | `font-variant-caps: all-small-caps` |
| `textDecoration` | `text-decoration` with style/offset/thickness/color |
| `paragraphIndent` | `text-indent` |

#### Effects

| Figma Effect | CSS |
|-------------|-----|
| DropShadowEffect | `box-shadow: x y blur spread color` |
| InnerShadowEffect | `box-shadow: inset x y blur spread color` |
| BlurEffect (LAYER) | `filter: blur(r)` |
| BlurEffect (BACKGROUND) | `backdrop-filter: blur(r)` |
| GlassEffect | `backdrop-filter: blur(r)` |

Effect parameters (color, radius, spread, offsets) support variable bindings.

#### Blend Modes

All 18 Figma blend modes mapped to `mix-blend-mode`:

| Figma | CSS |
|-------|-----|
| PASS_THROUGH | (omitted) |
| NORMAL | normal |
| DARKEN | darken |
| MULTIPLY | multiply |
| COLOR_BURN, LINEAR_BURN | color-burn |
| LIGHTEN | lighten |
| SCREEN | screen |
| COLOR_DODGE, LINEAR_DODGE | color-dodge |
| OVERLAY | overlay |
| SOFT_LIGHT | soft-light |
| HARD_LIGHT | hard-light |
| DIFFERENCE | difference |
| EXCLUSION | exclusion |
| HUE | hue |
| SATURATION | saturation |
| COLOR | color |
| LUMINOSITY | luminosity |

### Absolute Positioning

All five Figma constraint types are supported:

| Figma UI Label | API Value | CSS Output | Responsive |
|----------------|-----------|------------|------------|
| Left / Top | MIN | `left: N%` / `top: N%` | % of parent |
| Right / Bottom | MAX | `right: N%` / `bottom: N%` | % of parent |
| Left and Right / Top and Bottom | STRETCH | `left: 0; right: 0` / `top: 0; bottom: 0` | Fills parent |
| Center | CENTER | `left: 50%; transform: translateX(-50%)` | Always centered |
| Scale | SCALE | `left: N%; width: N%` | Position + size scale |

**Responsive sizing for MIN, MAX, and CENTER constraints:**
- `width` in pixels (designed size)
- `max-width` as percentage of parent (responsive cap)
- `aspect-ratio` to scale height proportionally when `max-width` activates

Elements maintain their designed pixel size when space allows, but shrink gracefully on narrower screens.

**Z-index** is auto-assigned from the Figma layer order (child index + 1).

**Absolute elements skip `extractSizing`** — dimensions are fully handled by `extractPosition`. Only `overflow: hidden` passes through when `clipsContent` is true.

### Background Images

Background image elements are detected and absorbed into their parent's CSS `background-image`. The image's **Fill mode** in Figma is preserved:

| Figma Fill Mode | CSS |
|-----------------|-----|
| Fill | `background-size: cover` |
| Fit | `background-size: contain` |
| Tile | `background-size: auto; background-repeat: repeat` |
| Crop | `background-size: cover` |

To set fill mode: select the background image element, open **Fill** in the right panel, use the dropdown (Fill / Fit / Crop / Tile).

### Mobile Responsiveness

Two-page diff system:
1. **Desktop page** → default CSS
2. **Mobile page** → only differences output inside `@media (max-width: 567px)`

Additional mobile behaviors:
- Grid layouts collapse to `grid-template-columns: 1fr`
- Grid column spans reset to `span 1`

### Utility Classes

Generated from your design tokens:

| Pattern | Example | Source |
|---------|---------|--------|
| `.p-{name}` | `.p-md { padding: var(--spacing-md); }` | Spacing |
| `.px-{name}`, `.py-{name}` | `.px-lg { padding-left: ...; padding-right: ...; }` | Spacing |
| `.m-{name}` | `.m-sm { margin: var(--spacing-sm); }` | Spacing |
| `.gap-{name}` | `.gap-md { gap: var(--spacing-md); }` | Spacing |
| `.text-{name}` | `.text-brand-primary { color: var(--color-brand-primary); }` | Colors |
| `.bg-{name}` | `.bg-surface-default { background-color: ...; }` | Colors |
| `.rounded-{name}` | `.rounded-md { border-radius: var(--radius-md); }` | Radius |
| `.text-{style}` | `.text-heading-h1 { font-size: ...; }` | Text Styles |

---

## Design Token Format (DTCG)

The plugin works with **DTCG (Design Token Community Group)** format JSON. Each token has `$value` and `$type` fields.

### Colors
```json
{
  "brand": {
    "primary": { "$value": "#2563EB", "$type": "color" }
  },
  "surface": {
    "default": { "$value": "#FFFFFF", "$type": "color" }
  }
}
```

### Spacing / Radius / Border Width
```json
{
  "xs": { "$value": "4px", "$type": "dimension" },
  "sm": { "$value": "8px", "$type": "dimension" },
  "md": { "$value": "16px", "$type": "dimension" }
}
```

### Opacity
```json
{
  "0": { "$value": 0, "$type": "number" },
  "50": { "$value": 0.5, "$type": "number" },
  "100": { "$value": 1, "$type": "number" }
}
```

### Typography
```json
{
  "font-family": {
    "primary": { "$value": "Inter", "$type": "string" }
  },
  "font-size": {
    "sm": { "$value": "14px", "$type": "dimension" },
    "md": { "$value": "16px", "$type": "dimension" }
  },
  "font-weight": {
    "regular": { "$value": 400, "$type": "number" },
    "bold": { "$value": 700, "$type": "number" }
  },
  "line-height": {
    "tight": { "$value": "1.25", "$type": "number" },
    "normal": { "$value": "1.5", "$type": "number" }
  }
}
```

### Shadows
```json
{
  "sm": { "$value": "0 1px 2px rgba(0,0,0,0.05)", "$type": "shadow" },
  "md": { "$value": "0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1)", "$type": "shadow" }
}
```

### Text Styles
```json
{
  "heading-h1": {
    "$value": {
      "fontFamily": "Inter",
      "fontSize": 48,
      "fontWeight": 700,
      "lineHeight": 1.2,
      "letterSpacing": -0.02
    },
    "$type": "textStyle"
  }
}
```

### Z-Index / Breakpoints / Grid
```json
{
  "base": { "$value": 0, "$type": "number" },
  "dropdown": { "$value": 10, "$type": "number" },
  "modal": { "$value": 30, "$type": "number" }
}
```

---

## Tips & Best Practices

### For the Best Audit Score

- Use **Auto Layout** on every frame with 2+ children
- Bind **all colors** to variables — even black and white
- Bind **spacing** (padding + gap) to spacing variables
- Bind **corner radius** to radius variables
- Attach **text styles** to every text layer
- Use **kebab-case** naming (e.g., `hero-content`, `cta-button`, `popup-inner`)
- Delete hidden layers and empty containers before handoff
- Save shadows and blurs as **effect styles**

### For Clean Token Setup

- Generate tokens through the **Workflow tab** for a consistent starting point
- Customize colors, fonts, and spacing values in the config panels before generating
- Import `colors-light.json` **before** `colors-dark.json`
- Use the **Token Debugger** to verify bindings after generation
- Re-run the audit to catch any unbound properties

### For Wireframes

- Generate wireframes **after** tokens are set up — they auto-bind to your variables
- Both desktop and mobile variants are created simultaneously
- Background images support **Fill** (cover) and **Fit** (contain) — set this in the image fill dropdown in Figma's right panel
- Absolute positioned elements support all constraint types for responsive behavior
- Don't rename wireframe frames (e.g., `promo/hero`) if you plan to use **Delete wireframes** — cleanup relies on these exact names
- Use the form builder in Step 3 to configure popup form fields with drag-and-drop

### For HTML Export

- Complete the full workflow (Steps 1-5) before exporting — the Build HTML tab only unlocks after "Dev Ready"
- **Name your layers semantically** — names like `nav`, `header`, `footer`, `hero`, `cta-button` produce correct HTML tags
- Mark images for export by adding **Export Settings** in Figma's right panel — nodes without export settings won't become `<img>` tags
- Component instances of form fields (`Input / Floating Label`) auto-structure as `<label>` + `<input>` in HTML
- For background images, use the Background Image component or ensure `pluginData("role")` is set to `background-image`
- Enable **AI enhancement** for better semantic HTML (requires Anthropic API key)

---

## Constants

Defined in `src/constants.ts`, modifiable:

| Constant | Value | Purpose |
|----------|-------|---------|
| `DESKTOP_WIDTH` | `1440` | Design canvas width (px) |
| `PAGE_PADDING` | `80` | Specimen page margins (px) |
| `SECTION_GAP` | `80` | Vertical space between specimen sections (px) |
| `MOBILE_BREAKPOINT` | `567` | Mobile responsive threshold (px) |
| `DEFAULT_RADIUS` | `8` | Fallback corner radius (px) |
| `STANDARD_EXPORT_SETTINGS` | 1x PNG + @2x PNG | Image export scales |

---

## Technical Notes

- The audit runs on the **current page only** — switch pages and re-run to audit others
- The token debugger requires **exactly one layer selected**
- The plugin requires **Edit access** to create or update variables
- Figma's plugin sandbox uses an older JS engine — the codebase uses `var` declarations, explicit `&&` guards instead of `?.`, and avoids ES2020+ features
- Network access is restricted to `https://api.anthropic.com` plus your proxy domain (set via `proxy-config.json` at build time — see [Claude AI Enhancement](#claude-ai-enhancement))
- Workflow state is persisted to Figma client storage and restored when the plugin reopens

---

## Contributing

Issues and PRs welcome. When editing source files:

- Use `var` declarations throughout — no `let` or `const`
- Replace all `?.` optional chaining with explicit `&&` guards
- Avoid `??`, `Array.prototype.flat`, and other ES2020+ features
- Test with the **Figma Desktop** app, not just the browser version
- Run `npm run build` to compile before testing

---

## License

MIT
