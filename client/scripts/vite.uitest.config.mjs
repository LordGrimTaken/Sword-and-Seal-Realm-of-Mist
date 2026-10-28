// Dev-server config for ui-test.mjs: no file watching / HMR, so concurrent edits never reload the page mid-test.
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export default defineConfig({
  root,
  base: "./",
  resolve: { alias: { "@shared": path.resolve(root, "../shared") } },
  server: { watch: null, hmr: false, fs: { allow: [path.resolve(root, "..")] } },
  optimizeDeps: { holdUntilCrawlEnd: true },
});
