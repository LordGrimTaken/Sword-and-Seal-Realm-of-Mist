import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: { "@shared": path.resolve(__dirname, "../shared") },
  },
  server: { port: 5173, fs: { allow: [path.resolve(__dirname, "..")] } },
  preview: { port: 4173 },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
