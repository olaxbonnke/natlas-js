// node examples/streaming.mjs
import { NAtlas } from "@olaxbonnke/natlas-js";

const natlas = new NAtlas();
for await (const chunk of natlas.chatStream("Ka bani shawarwari guda uku don inganta noman masara.", { replyIn: "ha" })) {
  process.stdout.write(chunk.delta);
}
process.stdout.write("\n");
