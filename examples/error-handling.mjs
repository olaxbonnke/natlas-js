// node examples/error-handling.mjs
import { NAtlas, NAtlasConnectionError, NAtlasModelLoadingError, NAtlasTimeoutError } from "@olaxbonnke/natlas-js";

const natlas = new NAtlas({ timeoutMs: 60_000, maxRetries: 2 });

const health = await natlas.health();
if (!health.ok) {
  console.log(`N-ATLaS is ${health.status}; start the Kaggle notebook (server/README.md).`);
  process.exit(1);
}

try {
  const r = await natlas.chat("Kedụ ka ị mere?", { replyIn: "ig" });
  console.log(r.content);
} catch (err) {
  if (err instanceof NAtlasModelLoadingError) console.log("Model is still loading, retry shortly.");
  else if (err instanceof NAtlasConnectionError) console.log("Endpoint offline:", err.message);
  else if (err instanceof NAtlasTimeoutError) console.log("Timed out after", err.timeoutMs, "ms");
  else throw err;
}
