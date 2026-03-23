# HTML Export

## Overview
The Build HTML tab generates production-ready HTML and CSS from your Figma design frames. It converts Figma's visual tree into semantic HTML elements with CSS custom properties derived from your design tokens. Optionally, Claude AI can enhance the output with visual context.

## Access
The Build HTML tab is unlocked after marking the file as "Dev Ready" in Step 5 of the workflow.

## Options

| Option | Description |
|--------|-------------|
| **Include mobile responsive styles** | Generates `@media` queries for mobile breakpoints using the mobile page frames |
| **Enhance with Claude AI** | Sends the raw HTML + screenshots to Claude Sonnet 4.6 for refinement |

## Generation Process

### Step 1: Image Export Check
Before generating HTML, the plugin scans for image nodes and checks their export settings:
- Nodes with image fills should have export settings (PNG @1x + @2x)
- If images lack export settings, shows a warning with option to continue anyway

### Step 2: Raw HTML Generation

The backend (`html-export.ts`) walks each frame on the Desktop page and converts nodes to HTML:

**Node-to-element mapping:**
- FRAME with auto-layout → `<div>` with flexbox
- FRAME without auto-layout → `<div>` with absolute positioning
- TEXT → `<p>`, `<h1>`-`<h6>`, `<span>`, or `<a>` depending on text style
- RECTANGLE/ELLIPSE → `<div>` with shape-specific CSS
- IMAGE fill → `<img>` with exported asset reference
- INSTANCE → resolved to its underlying structure

**CSS custom properties:**
Variables bound to nodes are converted to CSS custom properties:
- `spacing/md` → `--spacing-md`
- `colors/brand/primary` → `--colors-brand-primary`
- Color variables → resolved to hex values for the CSS variable definitions
- Spacing/radius variables → resolved to pixel values

**CSS generation:**
- Each frame generates its own HTML file
- All frames share a single `styles.css`
- CSS uses BEM-like class naming derived from layer names
- Flexbox for auto-layout frames, grid where applicable
- Proper font-face declarations for used fonts

**Image export:**
- Images are exported as PNG (1x and 2x) or SVG
- Saved to an `assets/` directory
- Referenced via relative paths in the HTML
- Base64 data URLs used for inline small icons

### Step 3: AI Enhancement (Optional)

If "Enhance with Claude AI" is enabled:

1. **Screenshots** — takes JPEG screenshots of each frame (reduced quality for token efficiency)
2. **Sends to Claude Sonnet 4.6** with:
   - The raw HTML files
   - The CSS file
   - Screenshots as base64-encoded images for visual reference
   - Design context (breakpoints, tokens, page type)
3. **Claude refines:**
   - Semantic HTML structure (proper `<header>`, `<main>`, `<section>`, `<footer>`)
   - Accessibility attributes (alt text, ARIA labels, roles)
   - Responsive behavior
   - CSS optimization (removing redundant rules, combining selectors)
   - Visual accuracy (comparing output to screenshots)

**Streaming:** The AI response streams in real-time with a terminal-like progress display showing thinking status.

**Model settings:**
- Model: `claude-sonnet-4-6`
- Max tokens: 16,384
- Thinking budget: 10,000 tokens
- Per-frame processing for large designs

### Step 4: Output

Two output versions are available (when AI is enabled):
- **Raw** — the direct Figma-to-HTML conversion
- **AI Enhanced** — Claude's refined version

**Export options:**
- **Copy HTML** — copies all HTML to clipboard
- **Save to Folder** — uses File System Access API to save to a local directory (with zip fallback for unsupported browsers)
- **Preview** — collapsible code blocks showing HTML and CSS

**Output structure:**
```
project-name/
  index.html          (or per-frame HTML files)
  styles.css
  assets/
    hero-image.png
    hero-image@2x.png
    logo.svg
    ...
```

## Variable-to-CSS Mapping

Figma Variables are resolved to CSS custom properties:

| Figma Variable | CSS Custom Property | CSS Value |
|---------------|--------------------|----|
| `colors/brand/primary` | `--colors-brand-primary` | `#3B82F6` |
| `spacing/md` | `--spacing-md` | `16px` |
| `radius/lg` | `--radius-lg` | `12px` |
| `border/default` | `--border-default` | `2px` |
| `opacity/50` | `--opacity-50` | `0.5` |

The `:root` block defines all used variables, and individual elements reference them:

```css
:root {
  --colors-brand-primary: #3B82F6;
  --spacing-md: 16px;
  --radius-lg: 12px;
}

.hero-section {
  padding: var(--spacing-md);
  border-radius: var(--radius-lg);
  background-color: var(--colors-brand-primary);
}
```

## Mobile Responsive

When "Include mobile responsive styles" is checked:
- Mobile page frames are matched to their desktop counterparts by name
- CSS generates `@media (max-width: 567px)` queries
- Mobile-specific layout changes (stack direction, font sizes, spacing) are included
- The mobile breakpoint value (567px) comes from the Breakpoints variable collection

## Retry Logic

API calls use exponential backoff for transient errors:
- Retryable: HTTP 429 (rate limit), 529 (overloaded), network errors
- Backoff: 1s, 2s, 4s (max 10s)
- Max retries: 2 attempts
