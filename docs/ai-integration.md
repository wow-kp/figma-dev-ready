# AI Integration

## Overview
The plugin integrates with Claude (Anthropic's AI) for five distinct features. All AI features are optional — the plugin works fully without an API key.

## Configuration

### API Key
1. Open the **Settings** tab
2. Enter your Anthropic API key (`sk-ant-...`)
3. Click **Check** to verify the connection

The key is stored locally via Figma's `clientStorage` API. It is never sent to Figma's servers — only to the Anthropic API (or your proxy).

### Connection Modes

The plugin supports two connection modes:

**Direct API (default):**
- Calls `https://api.anthropic.com/v1/messages` directly from the plugin UI
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`
- Each user needs their own API key

**Team Proxy:**
- Calls your custom proxy URL (e.g., `https://figma-dev-ready-proxy.your-team.workers.dev/v1/messages`)
- Headers: `X-Figma-User-Id`, `X-Figma-User-Name`, optional `x-api-key`
- Can use a server-side API key so individual users don't need their own
- See [proxy-setup.md](proxy-setup.md) for deployment

**Priority:** If both API key and proxy are configured:
- Uses direct API if the API key is set and proxy is not the preferred method
- Falls back to proxy if direct API fails
- Proxy health is checked on startup

## AI Features

### 1. Token Name Refinement (Route B)

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 2,048
**When:** Route B Step 2, after design analysis

Sends a compact summary of extracted tokens (colors with hex values and usage counts, typography with family/size/weight combos) and receives semantic name suggestions.

**Input example:**
```
Colors: #3B82F6 (used 47 times), #EF4444 (used 12 times), #1A1A1A (used 89 times)
Typography: Inter 16/400 (used 34 times), Inter 24/700 (used 8 times)
```

**Output:** Updated token names (e.g., "blue-500" → "brand-primary", "16/400" → "body-default")

### 2. Layer Naming

**Model:** `claude-haiku-4-5-20251001`
**Max tokens:** 2,048
**When:** Audit tab, per-issue "AI Suggest" button or batch "AI Name All"

Serializes node context (type, dimensions, children summary, parent info, text content, visual properties) and receives kebab-case name suggestions.

**Serialized context includes:**
- Node type, dimensions, child count
- Parent name and type
- Sibling names (for pattern context)
- Children structure (first 5 children: type, name, text, size)
- Fill/stroke colors, radius, opacity
- Text content (first 100 chars)
- Auto-layout properties

**Output:** JSON array `[{id, name}]` with suggested kebab-case names.

### 3. Component Detection (Route B)

**Model:** `claude-sonnet-4-6`
**Max tokens:** 4,096
**Timeout:** 60 seconds per call
**When:** Route B Step 2, "Detect Components with AI" button

Two-round detection process:

**Round 1 — Per-frame analysis:**
- System prompt instructs Claude to find repeating UI patterns in a serialized node tree
- Explains the compact node format (type codes, abbreviated fields)
- Lists pattern types: buttons, inputs, cards, nav items, tags, badges, avatars, list items, custom
- Expects JSON output with pattern instances and differentiators

**Round 2 — Cross-frame aggregation:**
- Sends all Round 1 results combined
- Instructs Claude to merge duplicates, identify variants, name components, match desktop/mobile versions, remove false positives
- Expects JSON output with final component list including variant structure

### 4. Audit Review

**Model:** `claude-sonnet-4-6`
**Max tokens:** 1,024
**When:** After running audit, "AI Review" button

Sends serialized audit results (check names, issue counts, weights, available auto-fixes) and receives a markdown-formatted action plan:
- Prioritized by severity
- Groups related fixes
- Recommends batch operations
- Kept under 250 words

### 5. HTML Enhancement

**Model:** `claude-sonnet-4-6`
**Max tokens:** 16,384
**Thinking budget:** 10,000 tokens
**When:** Build HTML tab with "Enhance with Claude AI" enabled

Sends:
- Raw generated HTML files
- CSS file with variable definitions
- JPEG screenshots of each frame (base64-encoded)
- Design context (breakpoints, token names, page type)

Receives:
- Refined HTML with semantic elements and accessibility
- Optimized CSS
- Streaming response with real-time progress display

For large designs, processes frames individually to stay within context limits.

## Error Handling & Retry

All AI calls use a retry mechanism:

| Error | Retryable | Backoff |
|-------|-----------|---------|
| HTTP 429 (rate limit) | Yes | Exponential: 1s → 2s → 4s (max 10s) |
| HTTP 529 (overloaded) | Yes | Same |
| Network error | Yes | Same |
| HTTP 400 (bad request) | No | — |
| HTTP 401 (auth) | No | — |
| HTTP 500+ (server) | No | — |

**Max retries:** 2 attempts (configurable)

If all retries fail, the UI shows an error message with a manual retry button. No heuristic fallback — AI features require AI to be available.

## Privacy & Security

- API keys are stored locally in Figma's `clientStorage` (per-user, per-device)
- Keys are never sent to Figma's servers or any third party except Anthropic (or your proxy)
- Design data sent to AI is serialized compactly — only structural/visual properties needed for the specific task, not full file contents
- The `anthropic-dangerous-direct-browser-access: true` header is required for browser-based API calls (Figma plugins run in a browser sandbox)
- The optional proxy adds CORS handling, rate limiting, and optional user allowlisting

## Rate Limiting

**Direct API:** Subject to Anthropic's standard API rate limits (per API key).

**Proxy:** Configurable per-user rate limiting via Cloudflare KV:
- Default: 30 requests per hour per Figma user
- Configurable via `RATE_LIMIT_MAX` environment variable on the proxy
