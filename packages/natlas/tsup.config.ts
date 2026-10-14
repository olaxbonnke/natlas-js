import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2020",
    treeshake: true,
  },
  {
    // React bindings: `@olaxbonnke/natlas-js/react`. The core SDK is imported by
    // package name and kept external so apps load a single copy of NAtlas.
    entry: { react: "src/react.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: false,
    target: "es2020",
    // Rollup-based treeshake strips the "use client" directive; esbuild keeps it.
    // Output is already minimal (two hooks, everything else external).
    treeshake: false,
    external: ["react", "@olaxbonnke/natlas-js"],
  },
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    sourcemap: false,
    clean: false,
    target: "node18",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
