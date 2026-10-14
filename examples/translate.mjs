// node examples/translate.mjs
import { NAtlas, LANGUAGE_CODES } from "@olaxbonnke/natlas-js";

const natlas = new NAtlas();
const text = "Wash your hands with soap before eating.";
for (const to of LANGUAGE_CODES.filter((c) => c !== "en")) {
  const r = await natlas.translate(text, { from: "en", to, domain: "health" });
  console.log(`${to}: ${r.text}`);
}
