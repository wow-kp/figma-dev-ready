# Workflow Guide

The plugin provides a guided multi-step workflow to transform a Figma file into a production-ready design system. It supports two routes depending on your starting point.

---

## Route Detection

When the plugin opens for the first time on a file, it checks whether the file contains existing design work:

- **Empty file** — automatically starts Route A
- **File with content** — shows a detection banner asking you to choose:
  - **Route A (Fresh Start)** — ignores existing content and builds from scratch
  - **Route B (Import Existing)** — analyzes existing design and extracts tokens

The chosen route is persisted per file. Reopening the plugin on the same file restores your progress.

---

## Route A — Fresh Start

Build a complete design system from configuration. Best for new projects where you want to define tokens, generate specimen pages, and create wireframes from scratch.

### Step 1: File Structure

Creates the standard page hierarchy:

| Page | Purpose |
|------|---------|
| `_Cover` | Project metadata, status badge, version info |
| `Foundations` | Design system specimen page (colors, typography, spacing, etc.) |
| `Components` | Reusable component library (buttons, inputs, dropdowns, etc.) |
| `Desktop` | Desktop-sized design frames |
| `Mobile` | Mobile-sized design frames |
| `_Archive` | Preserved original content (Route B only) |

Also generates a **Cover page** with project name, version, date, designer names, and a status badge (In Progress / Ready for Review / Dev Ready).

**Completion indicator:** Green when all required pages exist.

### Step 2: Design Tokens

Configure your design system tokens through the UI:

#### Colors
- **Primary, Secondary, Tertiary** — brand colors with auto-generated 10-shade palettes (50–950)
- **Text color** — main text color
- **Custom colors** — add any named color
- **Auto-generated** — black, white, gray palette, focus ring, error color
- **Semantic colors** — brand, text, border, overlay groups derived from your palette

#### Font Families
- **Primary, Secondary, Tertiary** — font family selections
- Each creates a `family/{role}` STRING variable in the Typography collection

#### Text Styles
- Define groups (headings, body, links, buttons, input, label)
- Per style: font role, size, weight, line height, letter spacing, paragraph spacing
- Creates native Figma text styles

#### Spacing
- Named spacing scale (e.g., xs: 4, sm: 8, md: 16, lg: 24, xl: 32)
- Creates FLOAT variables in Spacing collection

#### Radius
- Named radius scale (e.g., sm: 4, md: 8, lg: 12, xl: 16, full: 9999)

#### Shadows
- Named shadow definitions using CSS shadow syntax
- Creates Figma effect styles

#### Borders
- Named border width scale (e.g., thin: 1, default: 2, thick: 4)

#### Z-Index
- Named z-index scale for layering

**What gets generated:**
- Figma Variable collections: Colors, Primitives, Spacing, Radius, Border Width, Opacity, Typography, Z-Index, Breakpoints, Grid
- Figma text styles from your definitions
- Figma effect styles from shadows
- A **Foundations page** with visual specimens of all tokens
- A **Components page** with Button, Input, Label, Dropdown, and Image components (all bound to variables)

### Step 3: Page Structures

Generate wireframe sections for promotional pages:

- **Hero section** — full-width hero with heading, subtext, CTA button, background image
- **Popup/Modal** — overlay with form fields, close button, submit action
- **Banner** — notification/announcement bar with dismiss option

Form configuration:
- Add/remove form fields with label, required flag, and type (text/email/dropdown)
- Arrange fields in a grid layout (1-4 columns)
- Grid column spans are configurable per field

Generates both Desktop (1440px) and Mobile (567px) versions with proper responsive adjustments.

**Can be skipped** — not all projects need wireframes.

### Step 4: Audit & Validation

Runs 14 weighted quality checks across Desktop, Mobile, and Components pages. See [audit.md](audit.md) for full details.

**Completion indicator:** Green when all critical and high-priority checks pass.

### Step 5: Ready for Dev

Checklist verifying all previous steps are complete:

- Pages created
- Design tokens generated
- Wireframes built (or explicitly skipped)
- Audit passed (all critical + high priority)

**Mark as Dev Ready:**
- Updates Cover page status badge to "Dev Ready" (green)
- Sets Figma's built-in `devStatus` to `READY_FOR_DEV` on Desktop and Mobile top-level frames
- Unlocks the Build HTML tab
- Can be revoked to return to "In Progress"

---

## Route B — Import Existing Design

Transform an existing unmanaged Figma file into a proper design system. Best for designs that were built without variables, text styles, or component organization.

### Step 1: Structure

1. **Archives existing pages** — moves all current pages to `_Archive` with original names preserved
2. **Creates required pages** — same as Route A (Cover, Foundations, Components, Desktop, Mobile)
3. **Classifies frames** — detects which archived frames are desktop-sized (>800px wide), mobile-sized (<800px), or components, and copies them to the appropriate new page

Progress is tracked through three phases: analyzing, archiving, and classifying.

### Step 2: Design Tokens

This is the most complex step in Route B, with multiple sub-phases:

#### Phase 1: Design Analysis

Scans all design pages to extract:
- **Colors** — all unique solid fills/strokes, clustered by similarity (0.02 distance), sorted by frequency, auto-named by hue (red, blue, green, etc.)
- **Typography** — all unique font family + size + weight + style combinations, grouped and auto-named (h1, h2, body-lg, body-default, etc.)
- **Spacing** — all unique padding/gap values, deduplicated within 2px tolerance
- **Radius** — all unique corner radii
- **Borders** — all unique stroke weights
- **Shadows** — all unique drop shadow/inner shadow effects as CSS strings
- **Font families** — derived from typography combos, sorted by usage frequency (primary/secondary/tertiary/font-N)
- **Frame classification** — desktop vs mobile vs component based on dimensions

#### Phase 2: Token Review & AI Refinement

Shows extracted tokens with editable names. You can:
- Rename any token manually
- Click **"Refine Names with AI"** to get semantic name suggestions (uses Claude Haiku)
- Adjust frame classifications (Desktop/Mobile/Component/Skip)

#### Phase 3: Apply Tokens

Creates all Figma Variables and text styles from the reviewed tokens, then:
1. **Binds variables to the design** — walks all nodes on Desktop/Mobile pages, finds nearest matching variable for each fill, stroke, spacing, radius, border, and opacity value, and binds it
2. **Generates Foundations page** — creates a visual specimen page from the newly created variables (same output as Route A but reads from variables instead of config)

#### Phase 4: Component Detection (AI)

Uses Claude Sonnet 4.6 in a two-round process:

**Round 1 — Per-frame analysis:**
- Serializes each top-level frame into a compact JSON tree
- Sends each chunk to AI: "Find repeating UI patterns in this frame"
- Returns candidate component patterns with node IDs

**Round 2 — Cross-frame aggregation:**
- Sends all Round 1 results to AI in one call
- Unifies duplicate patterns across frames
- Groups variants (Primary/Secondary, Default/Error/Focused, etc.)
- Produces final component list with variant structure

**Review:**
- Shows detected components with checkboxes, editable names, instance counts
- Toggle individual components on/off
- Edit component and variant names

**Create & Swap:**
1. Creates component sets on the Components page with proper variant properties
2. Applies responsive auto-layout (infers direction, gap, padding, alignment from original geometry)
3. Binds spacing variables (creates new ones if needed)
4. Renames layers to semantic kebab-case names
5. Swaps original nodes with component instances, preserving position, size, and text content

See [component-detection.md](component-detection.md) for technical details.

### Step 3: Audit & Validation

Same as Route A Step 4.

### Step 4: Ready for Dev

Same as Route A Step 5.

---

## Settings Persistence

All workflow state is saved per file using Figma's `clientStorage` API:

- Current route and step progress
- Token configuration (colors, fonts, spacing, etc.)
- Audit results and scores
- Component detection state
- Dev-ready status

Switching between files automatically loads/saves the correct state. The plugin tracks a unique file ID to prevent cross-file state contamination.

---

## Settings Tab

### API Configuration
- **API Key** — Anthropic API key for AI features (stored locally, never sent to Figma servers)
- **Proxy URL** — optional team proxy for centralized API key management
- **Connection Test** — verifies API key or proxy connectivity

### Workflow Reset
- **Reset All** — clears all workflow state for the current file and starts over
