export interface Env {
  ANTHROPIC_API_KEY: string;
  RATE_LIMIT_KV: KVNamespace;
  ALLOWED_USERS?: string;
  RATE_LIMIT_MAX?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Figma-User-Id, X-Figma-User-Name, x-api-key",
  "Access-Control-Max-Age": "86400",
};

function corsResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

function errorResponse(status: number, message: string): Response {
  return corsResponse(status, JSON.stringify({ error: { type: "proxy_error", message } }));
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // unix timestamp (seconds) when the window resets
}

async function checkRateLimit(kv: KVNamespace, userId: string, maxRequests: number): Promise<RateLimitResult> {
  const key = `rl:${userId}`;
  const now = Date.now();
  const windowMs = 60 * 60 * 1000; // 1 hour

  try {
    const stored = await kv.get(key, "json") as { count: number; windowStart: number } | null;

    if (!stored || (now - stored.windowStart) >= windowMs) {
      // New window
      await kv.put(key, JSON.stringify({ count: 1, windowStart: now }), { expirationTtl: 3600 });
      return { allowed: true, remaining: maxRequests - 1, limit: maxRequests, resetAt: Math.ceil((now + windowMs) / 1000) };
    }

    const resetAt = Math.ceil((stored.windowStart + windowMs) / 1000);

    if (stored.count >= maxRequests) {
      return { allowed: false, remaining: 0, limit: maxRequests, resetAt };
    }

    // Increment
    const newCount = stored.count + 1;
    await kv.put(key, JSON.stringify({ count: newCount, windowStart: stored.windowStart }), {
      expirationTtl: Math.ceil((stored.windowStart + windowMs - now) / 1000),
    });
    return { allowed: true, remaining: maxRequests - newCount, limit: maxRequests, resetAt };
  } catch {
    // If KV fails, allow the request (fail open)
    return { allowed: true, remaining: maxRequests, limit: maxRequests, resetAt: Math.ceil((now + windowMs) / 1000) };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Health check endpoint
    if (request.method === "GET" && url.pathname === "/health") {
      return corsResponse(200, JSON.stringify({ status: "ok" }));
    }

    // Only POST /v1/messages
    if (request.method !== "POST" || url.pathname !== "/v1/messages") {
      return errorResponse(404, "Not found. Use POST /v1/messages");
    }

    // Validate user ID
    const userId = request.headers.get("X-Figma-User-Id");
    if (!userId) {
      return errorResponse(401, "Missing X-Figma-User-Id header.");
    }

    // Check allowlist (if configured)
    if (env.ALLOWED_USERS) {
      const allowed = env.ALLOWED_USERS.split(",").map(s => s.trim()).filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(userId)) {
        return errorResponse(403, "User not authorized.");
      }
    }

    // Rate limiting
    const maxRequests = parseInt(env.RATE_LIMIT_MAX || "30", 10);
    const rl = await checkRateLimit(env.RATE_LIMIT_KV, userId, maxRequests);
    const rlHeaders: Record<string, string> = {
      "X-RateLimit-Limit": String(rl.limit),
      "X-RateLimit-Remaining": String(rl.remaining),
      "X-RateLimit-Reset": String(rl.resetAt),
    };
    if (!rl.allowed) {
      const resetSec = Math.max(0, rl.resetAt - Math.floor(Date.now() / 1000));
      return new Response(JSON.stringify({
        error: { type: "rate_limit_error", message: "Rate limit exceeded. Max " + maxRequests + " requests per hour." },
        remaining: 0, limit: rl.limit, resetAt: rl.resetAt, retryAfterSeconds: resetSec
      }), { status: 429, headers: { ...CORS_HEADERS, ...rlHeaders, "Content-Type": "application/json", "Retry-After": String(resetSec) } });
    }

    // Forward to Anthropic
    try {
      const body = await request.text();
      // Use client's API key if provided, otherwise fall back to server key
      const clientKey = request.headers.get("x-api-key");
      const apiKey = clientKey || env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return errorResponse(401, "No API key provided and no server key configured.");
      }

      // Detect streaming requests
      let isStream = false;
      try { isStream = JSON.parse(body).stream === true; } catch { /* ignore */ }

      const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body,
        redirect: "follow",
      });

      if (isStream && anthropicResponse.ok && anthropicResponse.body) {
        return new Response(anthropicResponse.body, {
          status: anthropicResponse.status,
          headers: {
            ...CORS_HEADERS,
            ...rlHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      const responseBody = await anthropicResponse.text();
      return new Response(responseBody, {
        status: anthropicResponse.status,
        headers: {
          ...CORS_HEADERS,
          ...rlHeaders,
          "Content-Type": "application/json",
        },
      });
    } catch (e) {
      return errorResponse(502, "Failed to reach Anthropic API: " + String(e));
    }
  },
};
