"use client";

import { DEFAULT_SYSTEM_PROMPT, NAtlas, NAtlasAPIError, NAtlasError } from "@olaxbonnke/natlas-js";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The browser talks to this app's own OpenAI-compatible relay at /api,
 * using the very same SDK developers install from npm.
 */
export const natlas = new NAtlas({ baseUrl: "/api", maxRetries: 0, timeoutMs: 90_000 });
export { DEFAULT_SYSTEM_PROMPT };

export type EndpointStatus = "checking" | "online" | "loading" | "offline" | "unauthorized" | "not_configured";

export function useEndpointHealth() {
  const [status, setStatus] = useState<EndpointStatus>("checking");
  const [latencyMs, setLatency] = useState<number | undefined>();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      const body = (await res.json()) as { status?: EndpointStatus; latencyMs?: number };
      setStatus(body.status ?? (res.ok ? "online" : "offline"));
      setLatency(body.latencyMs);
      return body.status;
    } catch {
      setStatus("offline");
      return "offline" as const;
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      const s = await check();
      if (!alive) return;
      timer.current = setTimeout(loop, s === "loading" ? 10_000 : 30_000);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer.current);
    };
  }, [check]);

  return { status, latencyMs, refresh: check, setStatus };
}

export interface FriendlyError {
  kind: "offline" | "loading" | "rate" | "config" | "aborted" | "other";
  message: string;
}

export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof NAtlasError && err.code === "aborted") return { kind: "aborted", message: "Stopped." };
  if (err instanceof NAtlasAPIError) {
    const code = (err.body as { error?: { code?: string } } | undefined)?.error?.code;
    if (code === "model_offline")
      return { kind: "offline", message: "N-ATLaS is resting right now (the free GPU notebook that serves it is switched off). The live SDK code still shows exactly how to call it." };
    if (code === "model_loading" || err.code === "model_loading")
      return { kind: "loading", message: "N-ATLaS is waking up (loading weights onto the GPU). Try again in a minute." };
    if (code === "not_configured")
      return { kind: "config", message: "Demo mode: the model isn't connected to this deployment yet, so replies are paused. The live SDK code still shows exactly how to call it." };
    if (err.status === 429) return { kind: "rate", message: "You're sending messages quickly. Give it a few seconds." };
    return { kind: "other", message: err.message };
  }
  if (err instanceof NAtlasError) {
    if (err.code === "timeout") return { kind: "offline", message: "N-ATLaS took too long to answer. The GPU may be busy; try a shorter prompt." };
    if (err.code === "connection_error") return { kind: "offline", message: "Could not reach the playground server." };
    return { kind: "other", message: err.message };
  }
  return { kind: "other", message: err instanceof Error ? err.message : String(err) };
}
