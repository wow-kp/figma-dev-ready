# Is it ready for dev? — Figma Plugin

A Figma plugin with two tools in one: a **design audit checker** that scores your file against handoff best practices, and a **variables importer** that turns DTCG JSON files into native Figma Variables.

---

## Features

### 🔍 Audit Tab — "Is it ready for dev?"
Scans every node on the current page and scores your file from 0–100 across six checks:

| Check | What it flags |
|---|---|
| 🏷 **Layer Naming** | Layers still using default Figma names (`Frame 3`, `Rectangle`, `Group 12`, etc.) |
| ⬜ **Auto Layout** | Frames with 2 or more children that aren't using Auto Layout |
| 🎨 **Color Variables** | Solid fills or strokes with raw hex values not bound to a variable |
| ✏️ **Text Styles** | Text layers not attached to a text style |
| 🙈 **Hidden Layers** | Invisible layers that are likely forgotten clutter |
| 📦 **Empty Containers** | Frames or groups with no children |

Each failing check is expandable — click any individual issue to **jump directly to that node** in the canvas.

---

### 📥 Import Variables Tab
Imports DTCG-format JSON files (exported from the [Figma Variables Generator](https://github.com/your-org/figma-variables-generator)) directly into native Figma Variable collections.

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

Collection type is **auto-detected from the filename** — keep the original names from the generator.

---

## Installation

### Development (local)

1. Clone or download this repo
2. Open Figma Desktop
3. Go to **Plugins → Development → Import plugin from manifest**
4. Select the `manifest.json` file from this folder
5. Run via **Plugins → Development → Is it ready for dev?**

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
4. Review the score and expand any failing checks
5. Click an issue row to select and zoom to that layer in the canvas
6. Fix issues and click **Re-run audit** to update the score

### Importing variables

1. Export JSON files from the [Figma Variables Generator](https://github.com/your-org/figma-variables-generator)
2. Switch to the **Import Variables** tab in the plugin
3. Click the drop zone or drag and drop one or more JSON files
4. Verify the detected type shown under each filename
5. Click **Import to Figma**
6. Check the **Local Variables** panel — collections will be created automatically

> ⚠️ **For Colors:** always import `colors-light.json` before `colors-dark.json`. The plugin creates the Light mode first, then adds Dark as a second mode to the same collection.

---

## Notes

- The audit runs on the **current page only** — switch pages and re-run to audit others
- Re-running the importer on an already-imported file will **update existing variables** in place rather than creating duplicates
- The plugin requires **Edit access** to the file to create or update variables
- Figma's plugin sandbox uses an older JS engine — no optional chaining (`?.`) or nullish coalescing (`??`) in `code.js`

---

## Contributing

Issues and PRs welcome. When editing `code.js`, keep in mind:

- Use `var` or explicit `&&` guards instead of `?.`
- Avoid `??`, `Array.prototype.flat`, and other ES2020+ features
- Test with the Figma Desktop app, not just the browser version

---

## License

MIT