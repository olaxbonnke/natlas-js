/** Read the N-ATLaS endpoint from env at request time, so changing it in Vercel needs no code change. */
export function getUpstream(): { baseUrl?: string; apiKey?: string } {
  const raw = process.env.NATLAS_BASE_URL?.trim();
  let baseUrl = raw || undefined;
  if (baseUrl) {
    baseUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1$/i, "");
  }
  const apiKey = process.env.NATLAS_API_KEY?.trim() || undefined;
  return { baseUrl, apiKey };
}

const hits = new Map<string, number[]>();

/** Best-effort in-memory per-IP limiter (per serverless instance). */
export function rateLimited(ip: string): boolean {
  const limit = Number(process.env.NATLAS_RATE_LIMIT_PER_MIN ?? 20) || 20;
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > limit;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "anonymous"
  );
}

export function jsonError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return Response.json({ error: { code, message } }, { status, headers: { "cache-control": "no-store", ...headers } });
}
