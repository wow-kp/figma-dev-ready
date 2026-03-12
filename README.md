# Is it ready for dev? — Figma Plugin

A Figma plugin with three tools in one: a **weighted design audit** that scores your file against handoff best practices, a **token debugger** that inspects variable bindings and alias chains live, and a **variables importer** that turns DTCG JSON files into native Figma Variables.

---

## Features

### 🔍 Audit Tab — "Is it ready for dev?"

Scans every node on the current page and produces a weighted score from 0–100. Each check has a priority level — critical issues hurt the score far more than low-priority hygiene issues.

#### Naming & Structure

| Priority | Check | What it flags |
|---|---|---|
| 🔴 Critical | **Default Layer Names** | Layers still using Figma auto-generated names (`Frame 3`, `Rectangle`, `Group 12`, etc.) |
| 🟡 Medium | **Duplicate Layer Names** | Sibling layers sharing the same name — ambiguous in inspect and in code |
| 🟡 Medium | **Deep Nesting** | Frames or groups nested 6+ levels deep — signals missing componentization |

#### Layout

| Priority | Check | What it flags |
|---|---|---|
| 🔴 Critical | **Auto Layout** | Frames with 2+ children not using Auto Layout — devs can't infer flex direction or spacing intent |

#### Variables & Styles

| Priority | Check | What it flags |
|---|---|---|
| 🔴 Critical | **Color Variables** | Solid fills or strokes with raw hex values not bound to a variable |
| 🔴 Critical | **Spacing Variables** | Auto layout padding or gap values not bound to a variable |
| 🟠 High | **Radius Variables** | Corner radius values not bound to a variable |
| ⚫ Low | **Opacity Variables** | Non-default opacity values not bound to a variable |

#### Typography

| Priority | Check | What it flags |
|---|---|---|
| 🔴 Critical | **Text Styles** | Text layers not attached to a text style |
| 🟠 High | **Mixed Text Styles** | Text layers with multiple conflicting styles — inspect panel returns bad data |

#### Hygiene

| Priority | Check | What it flags |
|---|---|---|
| ⚫ Low | **Hidden Layers** | Invisible layers that are likely forgotten clutter |
| ⚫ Trivial | **Empty Containers** | Frames or groups with no children |
| 🟡 Medium | **Unsaved Effect Styles** | Shadows or blurs not saved as a reusable effect style |

#### Score weighting

| Weight | Priority | Checks |
|---|---|---|
| 5 | 🔴 Critical | Color Variables, Text Styles, Auto Layout, Spacing Variables, Default Names |
| 4 | 🟠 High | Mixed Text Styles, Radius Variables |
| 3 | 🟡 Medium | Duplicate Names, Deep Nesting, Unsaved Effect Styles |
| 2 | ⚫ Low | Opacity Variables, Hidden Layers |
| 1 | ⚫ Trivial | Empty Containers |

Each failing check produces a penalty scaled by issue count (2 issues = mild, 20+ issues = severe), multiplied by its weight. A score of 80+ means the critical checks are genuinely clean.

#### 🔧 Auto-fix

When fixable issues are found, a fix panel appears between the score bar and results. Available safe fixes:

| Fix | What it does |
|---|---|
| Rename default names | Infers a name from text content, dominant child type, or node type |
| Delete empty containers | Removes all empty frames and groups |
| Delete hidden layers | Removes all invisible layers |
| Bind fills to nearest variable | Matches raw hex fills to the closest COLOR variable (within ~4% color distance) |

Fixes run in a safe order (hidden → empty → names → colors), then the audit re-runs automatically. All changes are undoable with ⌘Z.

---

### 🪙 Token Debugger Tab

Select any single layer on the canvas and see every variable binding and style reference in real time — updates live as you click around without any button press.

**For each bound property, shows the full alias chain:**
```
Fill
  ○  button/surface     Semantic     ↓
  ○  surface/default    Colors       ↓
  ●  gray/50            Primitives   ■ #F9FAFB
```

**Three states per property:**
- 🟢 **Bound** — full alias chain with collection name badges and resolved value
- 🟡 **Unbound** — raw value displayed with a warning badge (hex swatch for colors)
- 🔴 **Broken** — variable was deleted or renamed after being applied

**Properties inspected:**
- Fills and strokes (with color swatches)
- Corner radius (uniform and per-corner)
- Auto layout spacing (all padding sides + gap)
- Opacity
- Width and height (when variable-bound)
- Typography (text style + individual font properties)
- Effect styles

A stats row at the top of each inspection shows a quick tally of bound / unbound / broken counts at a glance.

---

### 📥 Import Variables Tab

Imports DTCG-format JSON files (exported from the [Figma Variables Generator](https://github.com/your-org/figma-variables-generator)) directly into native Figma Variable collections. Drag and drop one or more files, verify the auto-detected collection type, and click Import.

| File | Collection created | Variable type |
|---|---|---|
| `primitives.json` | Primitives | COLOR |
| `colors-light.json` | Colors — Light mode | COLOR |
| `colors-dark.json` | Colors — Dark mode | COLOR |
| `spacing.json` | Spacing | FLOAT |
| `typography.json` | Typography | STRING + FLOAT |
| `radius.json` | Radius | FLOAT |
| `border-width.json` | Border Width | FLOAT |
| `shadows.json` | Shadows | STRING |
| `z-index.json` | Z-Index | FLOAT |
| `breakpoints.json` | Breakpoints | FLOAT |

Collection type is auto-detected from the filename — keep the original names from the generator. Re-importing an existing file updates variables in place rather than creating duplicates.

> ⚠️ **For Colors:** always import `colors-light.json` before `colors-dark.json`. The plugin creates the Light mode first, then adds Dark as a second mode to the same collection.

---

## Installation

### Development (local)

1. Clone or download this repo
2. Open Figma Desktop
3. Go to **Plugins → Development → Import plugin from manifest**
4. Select the `manifest.json` file from this folder
5. Run via **Plugins → Development → Is it ready for dev?**

### Private org plugin (Figma Organisation plan)

Publish it privately so anyone in your org can install it without it being publicly listed.

### Figma Community (public)

1. Go to [figma.com/plugin-templates](https://figma.com/plugin-templates) → Submit a plugin
2. Upload the files, write a description, submit for review
3. Figma reviews it (usually a few days) and lists it publicly

### File structure

```
/
├── manifest.json   # Plugin manifest
├── code.js         # Plugin logic (runs in Figma sandbox)
├── ui.html         # Plugin UI (runs in iframe)
└── README.md
```

---

## Usage

### Running an audit

1. Open the plugin on the file you want to check
2. Navigate to the page you want to audit
3. Click **Run audit on current page**
4. Review the score and expand any failing check to see individual issues
5. Click an issue row to select and zoom to that layer in the canvas
6. Apply safe fixes from the fix panel if available
7. Fix remaining issues manually and click **Re-run audit** to update the score

### Using the Token Debugger

1. Switch to the **Token Debugger** tab
2. Click any layer in the canvas — bindings appear immediately
3. Expand alias chains to trace a variable all the way to its resolved value
4. Look for 🟡 Unbound or 🔴 Broken badges to find problems

### Importing variables

1. Export JSON files from the [Figma Variables Generator](https://github.com/your-org/figma-variables-generator)
2. Switch to the **Import Variables** tab
3. Click the drop zone or drag and drop one or more JSON files
4. Verify the detected type shown under each filename
5. Click **Import to Figma**
6. Check the **Local Variables** panel — collections are created automatically

---

## Notes

- The audit runs on the **current page only** — switch pages and re-run to audit others
- The token debugger requires **exactly one layer selected** to display results
- The plugin requires **Edit access** to create or update variables
- Figma's plugin sandbox uses an older JS engine — no optional chaining (`?.`), nullish coalescing (`??`), or other ES2020+ features in `code.js`

---

## Contributing

Issues and PRs welcome. When editing `code.js`, keep in mind:

- Use `var` declarations throughout — no `let` or `const`
- Replace all `?.` optional chaining with explicit `&&` guards
- Avoid `??`, `Array.prototype.flat`, and other ES2020+ features
- Test with the Figma Desktop app, not just the browser version

---

## Roadmap

- [ ] Contrast checker — WCAG AA/AAA ratio for text vs background
- [ ] Spacing auditor — detect padding/gap values that deviate from the spacing scale
- [ ] Coverage report — % of colors, spacing and text bound to tokens over time
- [ ] Style → Variable migrator — convert old color/text styles to Variables in one click

---

## License

MIT