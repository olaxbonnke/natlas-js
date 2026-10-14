// node examples/basic-chat.mjs   (needs NATLAS_BASE_URL; run `npm run build:sdk` first)
import { NAtlas } from "@olaxbonnke/natlas-js";

const natlas = new NAtlas(); // reads NATLAS_BASE_URL / NATLAS_API_KEY

const { content, usage } = await natlas.chat("Báwo ni? Ṣàlàyé ohun tí o lè ṣe fún mi.", {
  replyIn: "yo",
  temperature: 0.2,
  maxTokens: 200,
});
console.log(content);
console.log(usage);
