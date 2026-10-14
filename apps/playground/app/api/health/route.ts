import { NAtlas } from "@olaxbonnke/natlas-js";
import { getUpstream } from "@/lib/server-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Status = "online" | "loading" | "offline" | "unauthorized" | "not_configured";
let cache: { at: number; base: string; body: { status: Status; latencyMs?: number } } | undefined;

/**
 * Health of the configured N-ATLaS endpoint. 200 when online, 503 otherwise,
 * so the natlas-js `health()` helper works against this route too.
 */
export async function GET() {
  const { baseUrl, apiKey } = getUpstream();
  if (!baseUrl) {
    return Response.json(
      { status: "not_configured", error: { message: "NATLAS_BASE_URL is not set" } },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (!cache || cache.base !== baseUrl || Date.now() - cache.at > 10_000) {
    const h = await new NAtlas({ baseUrl, apiKey, maxRetries: 0 }).health({ timeoutMs: 8_000 });
    // Never echo upstream details: they would reveal the private tunnel URL.
    cache = { at: Date.now(), base: baseUrl, body: { status: h.status, latencyMs: h.latencyMs } };
  }
  const { body } = cache;
  const message =
    body.status === "loading" ? "Loading model" : body.status === "online" ? "ok" : `N-ATLaS endpoint is ${body.status}`;
  return Response.json(
    { ...body, error: body.status === "online" ? undefined : { message } },
    { status: body.status === "online" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
