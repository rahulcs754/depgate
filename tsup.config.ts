import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/main.ts", cli: "src/cli.ts" },
  format: ["esm"],
  target: "node20",
  platform: "node",
  noExternal: [/.*/],
  clean: true,
  splitting: false,
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
