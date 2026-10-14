#!/usr/bin/env node
/**
 * DEVELOPMENT / TEST ONLY - a tiny fake of llama.cpp's OpenAI-compatible server.
 *
 * It does NOT run any model. It echoes canned "[mock]" text so you can work on
 * the SDK or the playground UI without a GPU. Never point a public deployment
 * at it: the real playground must always talk to N-ATLaS.
 *
 *   node scripts/mock-natlas-server.mjs            # http://localhost:8000
 *   MOCK_MODE=loading node scripts/mock-natlas-server.mjs
 */
import http from "node:http";

const PORT = Number(process.env.PORT ?? 8000);
const MODE = process.env.MOCK_MODE ?? "online"; // online | loading
const API_KEY = process.env.MOCK_API_KEY;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (API_KEY && req.headers.authorization !== `Bearer ${API_KEY}`) {
    return send(res, 401, { error: { code: 401, message: "Invalid API Key", type: "authentication_error" } });
  }
  if (MODE === "loading") return send(res, 503, { error: { code: 503, message: "Loading model", type: "unavailable_error" } });

  if (req.method === "GET" && req.url === "/health") return send(res, 200, { status: "ok" });
  if (req.method === "GET" && req.url === "/v1/models")
    return send(res, 200, { object: "list", data: [{ id: "mock-N-ATLaS.Q4_K_M.gguf", object: "model" }] });

  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let raw = "";
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || "{}");
    const last = body.messages?.at(-1)?.content ?? "";
    const reply = `[mock] Mo gbọ́ ọ: "${String(last).slice(0, 80)}"`;
    if (!body.stream) {
      return send(res, 200, {
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: reply }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const words = reply.split(/(?<= )/);
    for (const [i, w] of words.entries()) {
      const chunk = { object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: w }, finish_reason: i === words.length - 1 ? "stop" : null }] };
      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      await new Promise((r) => setTimeout(r, 30));
    }
    res.end("data: [DONE]\n\n");
    return;
  }
  send(res, 404, { error: { code: 404, message: "Not Found" } });
});

server.listen(PORT, () => console.log(`[mock] fake N-ATLaS server on http://localhost:${PORT} (mode=${MODE}) - dev/test only`));
