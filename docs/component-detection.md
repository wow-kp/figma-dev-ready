# Component Detection

## Overview
Route B Step 2 includes AI-powered component detection that identifies repeating UI patterns in your existing design, creates proper Figma component sets with variants, and swaps the original nodes with instances.

## How It Works

### Phase 1: Design Serialization

The plugin serializes your design into compact JSON chunks for AI analysis. Each top-level frame becomes a separate chunk.

**Serialized node format:**
| Field | Meaning |
|-------|---------|
| `id` | Figma node ID |
| `t` | Type code: F (Frame), T (Text), R (Rectangle), V (Vector), I (Instance), G (Group), S (Section), E (Ellipse), L (Line), P (Polygon) |
| `n` | Node name (max 40 chars) |
| `x`, `y` | Position |
| `w`, `h` | Dimensions (rounded) |
| `f` | First solid fill hex color |
| `s` | First solid stroke hex color |
| `sw` | Stroke weight |
| `r` | Corner radius (rounded) |
| `o` | Opacity (only if < 1) |
| `l` | Layout direction: H (horizontal), V (vertical), W (wrap) |
| `p` | Padding [top, right, bottom, left] |
| `g` | Gap / itemSpacing |
| `ax` | Primary axis alignment |
| `cx` | Counter axis alignment |
| `txt` | Text content (first 60 chars) |
| `fs` | Font size |
| `fw` | Font weight |
| `ta` | Text alignment |
| `td` | Text decoration |
| `ff` | Font family (first 20 chars) |
| `img` | Has image fill (boolean) |
| `clip` | Clips content (boolean) |
| `abs` | Absolute positioned (boolean) |
| `exp` | Has export settings (boolean) |
| `shadow` | Has shadow effect (boolean) |
| `c` | Children (recursive) |
| `cc` | Child count (when children are truncated) |

**Adaptive depth control:**
- Fully serializes subtrees with < 30 descendants
- Summarizes large subtrees: first 2 levels, then child count
- Skips: hidden nodes, nodes < 4x4px
- Truncates text to 60 chars, names to 40 chars

### Phase 2: AI Detection (Two Rounds)

**Round 1 — Per-frame pattern extraction:**
For each serialized frame chunk, sends a separate API call to Claude Sonnet 4.6:
- Identifies repeating structural patterns (buttons, inputs, cards, badges, nav items, tags, etc.)
- Returns candidate patterns with instance node IDs and differentiators
- Progress shown as "Analyzing [frameName]... (1/6)"

**Round 2 — Cross-frame aggregation:**
Sends all Round 1 results to a single API call:
- Merges duplicate patterns across frames
- Identifies variants (color = Variant, dimensions = Size, border/state = State)
- Names components using design system conventions
- Matches Desktop and Mobile versions
- Removes false positives (one-off elements, layout containers)
- Ensures minimum 2 instances per component

**Output format:**
```json
{
  "components": [
    {
      "name": "Button",
      "type": "button",
      "description": "Primary action button",
      "variants": [
        {
          "name": "Primary",
          "properties": { "Variant": "Primary" },
          "nodeIds": ["1:234", "5:678"],
          "associatedNodeIds": ["1:235", "5:679"]
        }
      ]
    }
  ]
}
```

### Phase 3: Review UI

After AI detection, the review screen shows:
- Each detected component with icon, name, instance count, variant count
- Checkbox to enable/disable each component
- Editable name field per component
- Variant breakdown showing variant names and instance counts

### Phase 4: Component Creation

For each enabled component:

1. **Loads the representative node** — first nodeId from each variant
2. **Clones as component** — creates a COMPONENT node, clones original children
3. **Renames layers** — converts all layer names to semantic kebab-case:
   - TEXT nodes named by role: "label", "title", "placeholder", "description"
   - Frames named by structure: "button", "card", "input-field", "icon-wrapper"
   - Figma default names (Frame 12, Rectangle 45) get purpose-based names
4. **Applies responsive auto-layout** — infers layout from original geometry
5. **Binds spacing variables** — padding and gap bound to existing or new Spacing variables
6. **Combines as variant set** — `figma.combineAsVariants()` with AI-suggested name

### Phase 5: Instance Swapping

Replaces original detected nodes with component instances:

1. Records parent, position (x, y), size, and index in parent
2. Creates instance from the matching component variant
3. Positions and resizes to match original
4. Copies `layoutSizingHorizontal` / `layoutSizingVertical` for auto-layout parents
5. Walks both trees to update text content on matching TEXT nodes
6. Loads fonts before text changes
7. Inserts instance at the same parent index
8. Removes the original node

## Responsive Layout Inference

The `applyResponsiveLayout()` function converts static absolute-positioned frames to responsive auto-layout:

### Pre-recording
Before recursing into children, records each child's original x, y, width, height. This prevents nested auto-layout conversions from corrupting parent-level geometry inference.

### Overlap Detection
`childrenCanAutoLayout()` checks if any two children overlap more than 50% of the smaller element's area. If overlap is detected, the node keeps absolute positioning.

### Direction Inference
Analyzes the spatial spread of children:
- If horizontal spread > vertical spread → HORIZONTAL layout
- Otherwise → VERTICAL layout

Children are sorted by their position along the primary axis.

### Gap Inference
Calculates distances between consecutive children along the primary axis. Uses the mode (most common value) as the gap, rounded to nearest integer.

### Padding Inference
Calculates distance from frame edges to the nearest child:
- Top padding = minimum child.y
- Left padding = minimum child.x
- Bottom padding = frame.height - maximum (child.y + child.height)
- Right padding = frame.width - maximum (child.x + child.width)

### Alignment Inference
Calculates average center-offset of children relative to frame center:
- Counter axis: if average offset < 10% of frame dimension → CENTER, else check which side children cluster toward → MIN or MAX
- Primary axis: checks gap distribution for SPACE_BETWEEN

### Sizing Rules
For each child in an auto-layout frame:
- If child width > 80% of frame content width → FILL (horizontal)
- If child height > 80% of frame content height → FILL (vertical)
- Otherwise → HUG

### Variable Binding
Padding and gap values are bound to Spacing variables:
- First looks for an existing variable within tolerance
- If no match, creates a new `spacing/{value}` variable in the Spacing collection

## Edge Cases

| Scenario | Handling |
|----------|----------|
| No components found | Shows "No repeating patterns detected" with skip button |
| AI unavailable/error | Shows error with retry button |
| Existing components on page | New component sets appended alongside existing ones |
| Node in auto-layout parent | Preserves layoutSizingHorizontal/Vertical on instance |
| Different text between variants | Kept as overridable text (not a variant property) |
| Single top-level frame | Sends directly to Round 1, Round 2 still runs |
| Very large frame (500+ descendants) | Adaptive depth truncation kicks in |
| Node is already an INSTANCE | Skipped during detection |
