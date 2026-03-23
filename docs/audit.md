# Design Audit

## Overview
The audit system scores your Figma file against 14 weighted quality checks, identifies issues with actionable fixes, and provides auto-fix capabilities. It scans all pages whose names contain "desktop", "mobile", or "components".

## Scoring

The audit produces a score from 0 to 100 based on weighted issue counts.

**Score interpretation:**
| Score | Status | Meaning |
|-------|--------|---------|
| 80-100 | Green | Looking good! Ready or nearly ready |
| 50-79 | Yellow | Needs some work |
| 0-49 | Red | Not ready yet |

Each check has a weight (1-5) that determines its impact on the overall score. Higher-weight checks affect the score more when they have issues.

**Dev-ready requirement:** All critical (weight 5) and high (weight 4) priority checks must pass for the file to be eligible for dev handoff.

## Checks

### Naming & Structure

#### Unnamed Layers (weight: 5)
Detects nodes with Figma's auto-generated default names like "Frame 12", "Rectangle 45", "Group 3", "Ellipse 2", etc.

**Auto-fix:** Generates purpose-based names from node content:
- TEXT nodes → content-based (e.g., "submit-button-label")
- Frames with images → "image-container"
- Frames with specific structure → "card", "button", "input-field", etc.
- Falls back to type-based naming

**AI fix:** "AI Suggest" button sends node context to Claude Haiku for intelligent naming.

#### Non-Kebab-Case Names (weight: 4)
Detects names containing uppercase letters, spaces, underscores, or special characters. Design system convention requires `kebab-case` naming (e.g., `hero-section`, `cta-button`).

**Auto-fix:** Converts to kebab-case preserving slash hierarchy for path-based names.

#### Deep Nesting (weight: 3)
Detects nodes nested more than 5 levels deep in the layer tree. Deep nesting makes designs harder to maintain and export.

**Fix:** Manual restructuring. No auto-fix available.

### Layout

#### Missing Auto-Layout (weight: 5)
Detects frames that contain children but don't use auto-layout. Auto-layout ensures responsive behavior.

**Exceptions:** Nodes with absolute-positioned children or single-child containers may be excluded.

**Fix:** Convert to auto-layout manually or use the component detection flow which auto-infers layout.

#### Fixed Size in Flex Containers (weight: 4)
Detects children inside auto-layout frames that use fixed dimensions instead of FILL or HUG. Fixed sizes break responsive behavior.

**Fix:** Set layoutSizingHorizontal/Vertical to "FILL" or "HUG" as appropriate.

### Variables & Styles

#### Unbound Colors (weight: 5)
Detects solid fill or stroke colors not bound to a COLOR variable. Every color in the design should reference a variable for consistency and theme support.

**Auto-fix:** Binds to the nearest matching COLOR variable (Euclidean distance < 0.04).

**Per-issue actions:**
- Shows matched variable name + swatch
- "Bind" button to apply the match
- If no match: shows hex value with "Create & Bind" to create a new variable

#### Unbound Spacing (weight: 5)
Detects padding (paddingTop/Right/Bottom/Left) and gap (itemSpacing) values not bound to a Spacing collection variable.

**Auto-fix:** Binds to the nearest matching FLOAT variable (within 10% or 1px).

#### Unbound Radius (weight: 4)
Detects corner radius values not bound to a Radius collection variable.

**Auto-fix:** Same matching logic as spacing.

#### Unbound Border Width (weight: 3)
Detects stroke weight values not bound to a Border Width collection variable.

#### Unbound Opacity (weight: 2)
Detects opacity values (< 1.0) not bound to an Opacity collection variable.

#### Inconsistent Spacing (weight: 3)
Detects padding or gap values that don't match any value in the spacing scale. Even if bound, the value might not be a "standard" spacing token.

### Typography

#### Missing Text Styles (weight: 5)
Detects TEXT nodes that don't have a text style applied. All text should use a defined text style for consistency.

**Per-issue actions:**
- Shows matching text style suggestion
- "Apply" button to bind the style
- If no match: "Create Style" to create and apply a new text style

#### Mixed Text (weight: 4)
Detects components or top-level frames that use more than one font family. Components should use a single consistent font family.

### Hygiene

#### Hidden Layers (weight: 2)
Detects nodes where `visible === false`. Hidden layers add clutter and can cause confusion during dev handoff.

**Auto-fix:** Deletes hidden nodes.

#### Empty Containers (weight: 1)
Detects frames or groups with zero children. Empty containers serve no purpose and add noise.

**Auto-fix:** Deletes empty containers.

## Auto-Fix System

### Fix All
Each check with auto-fixable issues shows a "Fix All (N)" button. Clicking it applies the fix to all issues of that type in one batch.

**Important:** Fix All for variable binding checks requires that the file already has variables. The button is disabled if no variables exist.

### Per-Issue Fixes
Each issue in the expanded check list shows inline action buttons:
- **Naming:** text input + Rename button + AI Suggest
- **Variables:** matched variable preview + Bind button, or Create & Bind form
- **Text Styles:** matched style + Apply button, or Create Style button
- **Delete:** Delete button for hidden/empty nodes
- **Focus:** Click any issue to select and zoom to the node in Figma

## AI Review

After running the audit, if any issues exist, an "AI Review" button appears. This sends the audit results to Claude Sonnet 4.6 which returns a prioritized action plan in markdown format:
- Groups issues by severity
- Recommends which to fix first
- Suggests batch operations where possible
- Keeps the plan under 250 words

## Token Debugger

The Tokens sub-tab provides live inspection of any selected layer's variable bindings:

**Shows for the selected node:**
- **Color** group: fill colors (bound variable or raw hex), stroke colors
- **Shape** group: corner radius binding, stroke weight binding
- **Size** group: width and height values/bindings
- **Spacing** group: padding (T/R/B/L) and gap bindings
- **Typography** group: text style, font family, font size, font weight, line height
- **Effects** group: opacity binding, effect style binding

Each property shows:
- The current value
- The bound variable name (if any) with the full alias resolution chain
- Whether the binding is valid or orphaned

## Stale Audit Detection

The plugin tracks timestamps for the last audit and the last document change. If the document has been modified since the last audit, results are marked as stale and a re-audit is recommended.
