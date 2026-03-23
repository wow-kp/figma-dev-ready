# Architecture

## Overview

The plugin follows Figma's sandboxed plugin architecture: a **backend** (code.js) runs in Figma's main thread with access to the document API, and a **UI** (ui.html) runs in an iframe with access to the network and DOM. They communicate exclusively via `postMessage`.

```
┌─────────────────────────────────────────┐
│  Figma Main Thread (code.js)            │
│                                         │
│  main.ts ─── message router             │
│    ├── design-import.ts                 │
│    ├── component-detection.ts           │
│    ├── tokens-import.ts                 │
│    ├── tokens-generate.ts               │
│    ├── foundations.ts / foundations-complex.ts  │
│    ├── components.ts / components-complex.ts   │
│    ├── audit.ts                         │
│    ├── html-export.ts                   │
│    ├── wireframes.ts                    │
│    ├── cover.ts                         │
│    └── utils.ts                         │
│                                         │
│         ▲ postMessage ▼                 │
│                                         │
│  UI iframe (ui.html)                    │
│    ├── Workflow state machine            │
│    ├── Settings persistence              │
│    ├── AI API calls (XHR)               │
│    └── HTML/CSS output rendering         │
└─────────────────────────────────────────┘
```

## Backend (code.js)

### Entry Point: `src/main.ts`

Initializes the plugin UI and routes all incoming messages to the appropriate handler module.

**Key responsibilities:**
- `figma.showUI(__html__)` — opens the UI at 920x680
- Message routing — switch on `msg.type` to dispatch to handler functions
- Progress reporting — sends `*-progress` messages back to UI during long operations
- Settings persistence — reads/writes `clientStorage` for per-file state and AI config

### Module Organization

| Module | Responsibility |
|--------|---------------|
| `main.ts` | Message router, plugin init, settings I/O |
| `design-import.ts` | Design analysis engine: walks nodes, extracts tokens, creates variables, binds variables |
| `component-detection.ts` | Serializes design for AI, creates components, applies layout, swaps instances |
| `tokens-import.ts` | DTCG JSON → Figma Variables and text styles |
| `tokens-generate.ts` | Config → DTCG data structures (color palettes, spacing scales, etc.) |
| `foundations.ts` | Route A foundations page: reads from message config |
| `foundations-complex.ts` | Route B foundations page: reads from Figma variable collections |
| `components.ts` | Route A components page: reads from message config |
| `components-complex.ts` | Route B components page: reads from Figma variable collections |
| `audit.ts` | 14-check quality audit, fix system, variable matching, debug data |
| `html-export.ts` | Figma tree → HTML/CSS conversion, variable → CSS custom property mapping |
| `wireframes.ts` | Promo section generation (hero, popup, banner) for desktop and mobile |
| `cover.ts` | Cover page generation and status badge updates |
| `constants.ts` | Shared layout constants (DESKTOP_WIDTH, PAGE_PADDING, etc.) |
| `utils.ts` | Color math, font loading, variable resolution, page finding, text creation |

### Dependency Graph

```
main.ts
  ├── design-import.ts
  │     ├── tokens-generate.ts
  │     ├── tokens-import.ts
  │     └── utils.ts
  ├── component-detection.ts
  │     ├── audit.ts (findNearestFloatVar, findNearestColorVar)
  │     └── utils.ts
  ├── tokens-import.ts
  │     └── utils.ts
  ├── tokens-generate.ts (standalone)
  ├── foundations.ts
  │     └── utils.ts
  ├── foundations-complex.ts
  │     └── utils.ts
  ├── components.ts
  │     └── utils.ts
  ├── components-complex.ts
  │     └── utils.ts
  ├── audit.ts
  │     └── utils.ts
  ├── html-export.ts
  │     └── constants.ts
  ├── wireframes.ts
  │     ├── audit.ts (findNearestColorVar)
  │     ├── constants.ts
  │     └── utils.ts
  └── cover.ts
        └── utils.ts
```

## UI (ui.html)

The entire UI is a single HTML file containing inline CSS and JavaScript. This is required by Figma's plugin format — no external files can be loaded.

### State Management

All state is managed via plain JavaScript variables (no framework). Key state groups:

| Group | Variables | Purpose |
|-------|-----------|---------|
| Route & Progress | `wfRoute`, `wfStepStatus`, `wfRouteBStep` | Which route, which step, completion status |
| Token Config | `wfColors`, `wfFonts`, `wfTextStyles`, `wfSpacing`, `wfRadius`, etc. | User-configured design tokens |
| Audit | `wfAuditData`, `wfAuditScore`, `wfAuditPassed` | Last audit results |
| Components | `wfRouteBComponentStep`, `wfRouteBComponentDetections` | AI component detection state |
| Form State | `wfFormState` | Project metadata for cover page |

### Rendering

The UI uses imperative DOM manipulation — `innerHTML` with template strings for sections that change, and direct DOM updates for individual fields. The main render function `reRenderFromStep()` rebuilds the workflow panel from the current state.

### AI Calls

All AI API calls are made from the UI via `XMLHttpRequest` (not `fetch`, for broader compatibility). The UI handles:
- API key / proxy URL selection
- Request construction with appropriate headers
- Streaming response parsing (for HTML enhancement)
- Retry logic with exponential backoff
- Progress UI updates

## Message Protocol

All communication between backend and UI uses `postMessage` with a `type` field:

### UI → Backend

| Message Type | Purpose | Key Payload |
|-------------|---------|-------------|
| `create-pages` | Create file structure | — |
| `generate-cover` | Generate cover page | `project`, `version`, `date`, `designers`, `status` |
| `generate-tokens` | Generate tokens from config | `categories[]`, `colorOpts`, `fontFamilies`, `textStyles`, `spacing[]`, etc. |
| `import-tokens` | Import DTCG JSON file | `filename`, `data` |
| `reset-tokens` | Delete all variables/styles | — |
| `routeb-step1` | Route B file structure setup | — |
| `routeb-apply-tokens` | Apply extracted tokens | `analysis` |
| `routeb-detect-components` | Start component detection | — |
| `routeb-create-components` | Create components from AI results | `components[]` |
| `routeb-swap-instances` | Swap originals with instances | `swapMap` |
| `run-audit` | Run design audit | — |
| `fix-all-check` | Auto-fix all issues of a type | `checkKey` |
| `focus-node` | Select and zoom to a node | `nodeId` |
| `rename-node` | Rename a layer | `nodeId`, `name` |
| `bind-fill` / `bind-stroke` / `bind-spacing` | Bind variable to node | `nodeId`, `varId`, `prop` |
| `create-and-bind` | Create variable and bind | `nodeId`, `name`, `value`, `type`, `prop` |
| `generate-promo-pages` | Generate wireframes | `sections`, `formFields[]`, `formGrid`, `brandColor` |
| `build-html` | Generate HTML/CSS | `options` |
| `update-cover-status` | Update cover badge | `status` |
| `save-settings` | Persist workflow state | `fileId`, `settings` |
| `save-ai-config` | Save API configuration | `config` |

### Backend → UI

| Message Type | Purpose | Key Payload |
|-------------|---------|-------------|
| `pages-checked` | Page structure status | `pages{}`, `existingContent` |
| `tokens-counted` | Variable counts per collection | `counts{}` |
| `wireframes-checked` | Which wireframe sections exist | `desktop{}`, `mobile{}` |
| `routeb-step1-done` | File structure complete | `classifications` |
| `routeb-analysis-done` | Design analysis complete | `analysis` |
| `routeb-tokens-applied` | Tokens created and bound | `tokenResults`, `bindStats` |
| `routeb-tokens-progress` | Token progress update | `phase`, `percent` |
| `routeb-tree-chunks` | Serialized design for AI | `chunks[]` |
| `routeb-component-progress` | Component creation progress | `message`, `current`, `total` |
| `routeb-components-created` | Components done | `stats`, `swapMap` |
| `routeb-swap-progress` | Instance swap progress | `current`, `total` |
| `routeb-swap-completed` | All swaps done | `stats` |
| `audit-result` | Audit complete | `checks{}`, `score`, `issues`, `fixableCounts` |
| `build-html-progress` | HTML gen progress | `phase`, `data` |
| `build-html-done` | HTML generation complete | `html[]`, `css`, `assets[]` |
| `load-settings` | Loaded persisted state | `fileId`, `settings` |
| `ai-config-loaded` | Loaded AI config | `config` |
| `document-change` | Document was modified | `timestamp` |

## Build System

### build.js

1. Reads optional `proxy-config.json` for custom proxy URL
2. Updates `manifest.json` `networkAccess.allowedDomains`
3. Runs esbuild: `src/main.ts` → `code.js` (IIFE, ES2020)
4. Injects `BUILTIN_PROXY_URL` as compile-time constant

### Commands

```bash
npm run build    # One-time build
npm run watch    # Watch mode with auto-rebuild
```

### Output

- `code.js` — bundled backend (~500KB, auto-generated, gitignored)
- `manifest.json` — updated allowedDomains (committed)
- `ui.html` — unchanged by build (hand-edited)

## TypeScript Configuration

- **Target:** ES2020 (supports optional chaining, nullish coalescing)
- **Module:** ESNext
- **Strict:** false (for flexibility with Figma's API types)
- **Type roots:** `@figma/plugin-typings`

**Note:** While the compile target is ES2020, the code avoids optional chaining (`?.`) because the Figma plugin runtime may not support it in all cases. Use ternary expressions instead.

## Data Flow Examples

### Route A Token Generation

```
UI: User configures colors, fonts, spacing
UI → Backend: { type: "generate-tokens", categories: ["colors", "spacing", ...], colorOpts, fontFamilies, ... }
Backend: tokens-generate.ts creates DTCG data structures
Backend: tokens-import.ts creates Figma Variables from DTCG data
Backend: foundations.ts generates Foundations page
Backend: components.ts generates Components page
Backend → UI: { type: "tokens-generated", counts: { colors: 45, spacing: 8, ... } }
```

### Route B Design Import

```
UI → Backend: { type: "routeb-apply-tokens", analysis: {...} }
Backend: tokens-generate.ts creates DTCG data from analysis
Backend: tokens-import.ts creates Variables
Backend: design-import.ts binds variables to existing nodes
Backend: foundations-complex.ts generates Foundations page from variables
Backend → UI: { type: "routeb-tokens-applied", tokenResults, bindStats }

UI → Backend: { type: "routeb-detect-components" }
Backend: component-detection.ts serializes design into chunks
Backend → UI: { type: "routeb-tree-chunks", chunks: [...] }
UI: Calls Claude Sonnet for 2-round detection
UI → Backend: { type: "routeb-create-components", components: [...] }
Backend: component-detection.ts creates component sets, applies layout
Backend → UI: { type: "routeb-components-created", stats, swapMap }
UI → Backend: { type: "routeb-swap-instances", swapMap }
Backend: component-detection.ts replaces originals with instances
Backend → UI: { type: "routeb-swap-completed", stats }
```

### Audit

```
UI → Backend: { type: "run-audit" }
Backend: audit.ts walks Desktop/Mobile/Components pages
Backend: Checks 14 categories, finds nearest variable matches
Backend → UI: { type: "audit-result", checks: {...}, score: 87, issues: 12 }

UI → Backend: { type: "fix-all-check", checkKey: "colors" }
Backend: audit.ts binds all unbound colors to nearest variables
Backend → UI: { type: "fix-all-done", fixed: 23 }
```

## Settings Storage

Settings are stored in two locations via Figma's `clientStorage` API:

| Key | Content | Scope |
|-----|---------|-------|
| `settings_{fileId}` | Workflow state, token config, audit results, component state | Per file |
| `ai-config` | API key, proxy URL, welcome state | Global |

File ID is derived from the document and tracked in `wfCurrentFileId`. Switching files triggers a save of the current state and load of the new file's state.
