# Dev-Ready Tools for Designers

A Figma plugin that takes you from an empty file — or an existing unmanaged design — to a fully tokenized, audited, dev-ready design system with specimen pages, component libraries, and production HTML/CSS export.

---

## What's Inside

| Tab | Purpose | Access |
|-----|---------|--------|
| **Workflow** | Guided multi-step setup: file structure, tokens, wireframes/components, audit, handoff | Always visible |
| **Tools** | Design audit, token debugger, variable import | Always visible |
| **Build HTML** | Generate production HTML/CSS from your design | Unlocked after "Dev Ready" handoff |
| **Settings** | AI configuration: API key, optional proxy URL, connection test | Always visible |

---

## Two Workflow Routes

| Route | Starting Point | Steps |
|-------|---------------|-------|
| **Route A — Fresh Start** | Empty file | Structure → Design Tokens → Wireframes → Audit → Handoff |
| **Route B — Import Existing** | Existing design | Structure → Extract & Bind Tokens + AI Component Detection → Audit → Handoff |

The plugin auto-detects which route to offer based on file content.

---

## Installation

1. `npm install`
2. `npm run build` (or `npm run watch` for development)
3. In Figma Desktop: **Plugins > Development > Import plugin from manifest** → select `manifest.json`

For team deployment, publish as a private org plugin or to the Figma Community.

---

## AI Features (Optional)

All AI features work with an Anthropic API key configured in the **Settings** tab. The plugin works fully without one.

| Feature | Model | Purpose |
|---------|-------|---------|
| Token Name Refinement | Haiku 4.5 | Semantic names for extracted tokens |
| Component Detection | Sonnet 4.6 | Detect repeating UI patterns, create components |
| Layer Naming | Haiku 4.5 | Purpose-based kebab-case names |
| Audit Review | Sonnet 4.6 | Prioritized action plan from audit results |
| HTML Enhancement | Sonnet 4.6 | Semantic HTML/CSS with visual context |

Teams can deploy a [Cloudflare Worker proxy](docs/proxy-setup.md) for centralized API key management.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Workflow](docs/workflow.md) | Route A and Route B step-by-step guide |
| [Design Tokens](docs/design-tokens.md) | Token generation, import, DTCG format, variable collections |
| [Component Detection](docs/component-detection.md) | AI component detection, creation, and instance swapping |
| [Foundations Page](docs/foundations-page.md) | Auto-generated design system specimen page |
| [Audit](docs/audit.md) | 14 weighted quality checks, scoring, auto-fix, AI review |
| [HTML Export](docs/html-export.md) | Production HTML/CSS generation with AI enhancement |
| [AI Integration](docs/ai-integration.md) | API configuration, models, proxy, privacy |
| [Architecture](docs/architecture.md) | Codebase structure, message protocol, data flow |
| [Naming Guide](docs/naming-guide.md) | Detection patterns, generated names, naming conventions |
| [Proxy Setup](docs/proxy-setup.md) | Self-hosted Cloudflare Worker proxy deployment |

---

## Project Structure

```
figma-dev-ready/
├── manifest.json            Plugin manifest (auto-updated by build)
├── build.js                 Build script (esbuild + proxy config)
├── ui.html                  Plugin UI (single-file, Figma iframe)
├── code.js                  Bundled backend (generated — do not edit)
├── src/
│   ├── main.ts              Entry point & message routing
│   ├── design-import.ts     Design analysis engine (Route B)
│   ├── component-detection.ts  AI component detection & responsive layout
│   ├── tokens-import.ts     DTCG JSON → Figma Variables
│   ├── tokens-generate.ts   Token data generation
│   ├── foundations.ts        Route A foundations page
│   ├── foundations-complex.ts  Route B foundations page (variable-driven)
│   ├── components.ts        Route A component library
│   ├── components-complex.ts  Route B component library (variable-driven)
│   ├── audit.ts             14-check quality audit engine
│   ├── html-export.ts       HTML/CSS generation
│   ├── wireframes.ts        Promo wireframe generation
│   ├── cover.ts             Cover page generation
│   ├── constants.ts         Shared layout constants
│   └── utils.ts             Color math, font loading, variable resolution
├── docs/                    Documentation
└── proxy/                   Cloudflare Worker proxy source
```

---

## Contributing

```bash
git config core.hooksPath .githooks   # enable pre-commit hook
npm run build                          # compile before testing
```

- Use `var` declarations — no `let`/`const`
- Avoid `?.` optional chaining (use ternaries instead)
- Test with **Figma Desktop**

---

## License

Private plugin by wowbrands.
