import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // src/react.ts imports the core via the package name (so the built react
    // entry shares one copy of the SDK); point it at the source in tests.
    alias: { "@olaxbonnke/natlas-js": fileURLToPath(new URL("./src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
  },
});
