// Bundles server/src/server.ts (+ ws) into one self-contained server/dist/server.mjs.
// Result needs only Node >= 22.5: no node_modules, no tsx, platform independent.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(path.join(root, "server", "package.json"));
const esbuild = req("esbuild");
const out = path.join(root, "server", "dist", "server.mjs");
fs.mkdirSync(path.dirname(out), { recursive: true });
await esbuild.build({
  entryPoints: [path.join(root, "server", "src", "server.ts")],
  outfile: out, bundle: true, platform: "node", format: "esm", target: "node22",
  external: ["bufferutil", "utf-8-validate"], // optional native speedups of ws
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
console.log("server bundle:", path.relative(root, out), (fs.statSync(out).size / 1024).toFixed(0) + " KB");
