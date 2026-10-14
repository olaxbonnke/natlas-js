/**
 * Plain Node HTTP server for any host (Render, Railway, Fly, a VPS, or local + a tunnel).
 *   npm run build && npm start   ->  webhook at http://localhost:3000/webhook
 */
import { createServer, type IncomingMessage } from "node:http";
import { handlerFromEnv } from "./webhook.js";

const port = Number(process.env.PORT ?? 3000);
const handle = handlerFromEnv();

function toRequest(req: IncomingMessage, body: Buffer): Request {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, { method: req.method, headers, body: hasBody ? new Uint8Array(body) : undefined });
}

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c: Buffer) => chunks.push(c));
  req.on("end", async () => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/webhook" && path !== "/api/webhook" && path !== "/") {
        res.writeHead(404).end("Not Found");
        return;
      }
      const response = await handle(toRequest(req, Buffer.concat(chunks)));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch (e) {
      console.error(e);
      res.writeHead(500).end("Internal Server Error");
    }
  });
}).listen(port, () => {
  console.log(`natlas-js WhatsApp bot listening on http://localhost:${port}/webhook`);
});
