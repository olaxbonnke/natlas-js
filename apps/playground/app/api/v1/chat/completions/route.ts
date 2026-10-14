import { clientIp, getUpstream, jsonError, rateLimited } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby allows up to 60 s without Fluid Compute; streaming keeps the connection busy.
export const maxDuration = 60;

const TUNNEL_DOWN = new Set([502, 521, 522, 523, 524, 530]);
const MAX_MESSAGES = 40;
const MAX_CHARS = 24_000;
const ROLES = new Set(["system", "user", "assistant"]);

const OFFLINE_MESSAGE =
  "N-ATLaS is offline right now. The free GPU notebook that serves it is not running. Please try again later.";

function clamp(v: unknown, min: number, max: number, fallback?: number): number | undefined {
  const n = typeof v === "number" ? v : Number.NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * OpenAI-compatible relay: the browser (using natlas-js with baseUrl "/api")
 * POSTs here, and we forward to NATLAS_BASE_URL with the server-side API key.
 * Only N-ATLaS is ever called; there is no fallback model.
 */
export async function POST(req: Request) {
  const { baseUrl, apiKey } = getUpstream();
  if (!baseUrl) {
    return jsonError(
      503,
      "not_configured",
      "This playground has no N-ATLaS endpoint configured yet. Set NATLAS_BASE_URL in the deployment settings.",
    );
  }
  if (rateLimited(clientIp(req))) {
    return jsonError(429, "rate_limited", "Too many requests. Please wait a minute and try again.", { "retry-after": "30" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid_json", "Request body must be JSON.");
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    return jsonError(400, "invalid_messages", `messages must be an array of 1-${MAX_MESSAGES} items.`);
  }
  let chars = 0;
  for (const m of messages) {
    if (!m || typeof m !== "object" || !ROLES.has((m as { role: string }).role) || typeof (m as { content: unknown }).content !== "string") {
      return jsonError(400, "invalid_messages", "Each message needs a role (system/user/assistant) and string content.");
    }
    chars += (m as { content: string }).content.length;
  }
  if (chars > MAX_CHARS) {
    return jsonError(413, "too_long", "Conversation is too long for the demo. Clear the chat and start again.");
  }

  const upstreamBody = Object.fromEntries(
    Object.entries({
      model: "n-atlas",
      messages: (messages as Array<{ role: string; content: string }>).map(({ role, content }) => ({ role, content })),
      stream: body.stream === true,
      temperature: clamp(body.temperature, 0, 1.5),
      max_tokens: clamp(body.max_tokens, 1, 1024, 512),
      top_p: clamp(body.top_p, 0, 1),
      repeat_penalty: clamp(body.repeat_penalty, 0.8, 2),
      frequency_penalty: clamp(body.frequency_penalty, -2, 2),
      presence_penalty: clamp(body.presence_penalty, -2, 2),
      seed: clamp(body.seed, 0, 2 ** 31),
      stop: typeof body.stop === "string" || Array.isArray(body.stop) ? body.stop : undefined,
    }).filter(([, v]) => v !== undefined),
  );

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55_000);
  req.signal.addEventListener("abort", () => ctl.abort(), { once: true });

  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(upstreamBody),
      signal: ctl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
  } catch {
    clearTimeout(timer);
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return jsonError(503, "model_offline", OFFLINE_MESSAGE);
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    if (TUNNEL_DOWN.has(upstream.status)) return jsonError(503, "model_offline", OFFLINE_MESSAGE);
    if (upstream.status === 503 && /load/i.test(text)) {
      return jsonError(503, "model_loading", "Loading model: N-ATLaS is waking up on the GPU. Try again in a minute.");
    }
    if (upstream.status === 401 || upstream.status === 403) {
      return jsonError(502, "upstream_auth", "The playground's API key does not match the N-ATLaS server.");
    }
    let message = `N-ATLaS server returned HTTP ${upstream.status}.`;
    try {
      const j = JSON.parse(text);
      message = j?.error?.message ?? j?.error ?? message;
    } catch {
      /* not JSON */
    }
    return jsonError(upstream.status >= 500 ? 502 : upstream.status, "upstream_error", String(message));
  }

  // Headers arrived: from here on Vercel's maxDuration bounds the stream.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
      "x-served-by": "N-ATLaS",
    },
  });
}
