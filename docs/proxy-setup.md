# Self-Hosted Proxy Setup

The plugin can optionally route AI requests through a proxy server instead of calling the Anthropic API directly from the browser. This is useful for teams that want centralized API key management or additional security.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/): `npm install -g wrangler`

## Steps

### 1. Authenticate with Cloudflare

```bash
wrangler login
```

### 2. Create KV namespace for rate limiting

```bash
wrangler kv namespace create RATE_LIMIT_KV
```

Copy the `id` from the output and update `proxy/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "your-namespace-id-here"
```

### 3. Set your Anthropic API key as a secret

```bash
cd proxy
wrangler secret put ANTHROPIC_API_KEY
```

Enter your `sk-ant-...` key when prompted. This is stored encrypted on Cloudflare — it never appears in code or logs.

### 4. (Optional) Restrict access to specific users

```bash
wrangler secret put ALLOWED_USERS
```

Enter a comma-separated list of Figma user IDs (e.g., `12345,67890`). Leave empty to allow all users.

### 5. Deploy

```bash
cd proxy
wrangler deploy
```

The output will show your proxy URL, e.g., `https://figma-dev-ready-proxy.your-subdomain.workers.dev`

### 6. Configure the plugin

1. Open the plugin in Figma
2. Go to **Settings** tab
3. Expand **Advanced: Custom Proxy URL**
4. Paste your proxy URL
5. Click **Check** to verify the connection

## Configuration

The proxy supports these environment variables:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | No* | Server-side API key (fallback if client doesn't send one) |
| `ALLOWED_USERS` | No | Comma-separated Figma user IDs to allow |
| `RATE_LIMIT_MAX` | No | Max requests per hour per user (default: 30) |

\* The proxy can operate in two modes:
- **Server key mode**: Set `ANTHROPIC_API_KEY` on the server — users don't need their own key
- **Passthrough mode**: Don't set a server key — users send their own key via the plugin, and the proxy just handles CORS

## How it works

The proxy is a Cloudflare Worker that:
1. Accepts POST requests to `/v1/messages`
2. Validates the `X-Figma-User-Id` header
3. Checks rate limits (KV storage)
4. Optionally checks the user allowlist
5. Forwards the request to `https://api.anthropic.com/v1/messages`
6. Returns the response with CORS headers

The proxy source code is in the `proxy/` directory of this repository.
