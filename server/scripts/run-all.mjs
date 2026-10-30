// Runs every server test script one after another and reports ALL results (npm test used to stop at the first failure).
//   npm test                      -> all scripts
//   npm test -- dodge content     -> only the named ones
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const ALL = ["bots", "telegraph", "economy", "api-test", "dodge", "content"];
const wanted = process.argv.slice(2);
const list = wanted.length ? ALL.filter((n) => wanted.includes(n) || wanted.includes(n.replace("-test", ""))) : ALL;
if (!list.length) { console.error("no matching script; known: " + ALL.join(", ")); process.exit(2); }

const results = [];
for (const name of list) {
  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  const code = await new Promise((res) => {
    const c = spawn(process.execPath, ["--import", "tsx", `scripts/${name}.ts`], { cwd: ROOT, stdio: "inherit" });
    c.on("exit", (k, sig) => res(k ?? (sig ? 128 : 1)));
    c.on("error", () => res(127));
  });
  results.push({ name, code, secs: (Date.now() - t0) / 1000 });
}
console.log("\n=== summary ===");
for (const r of results) console.log(`  ${r.code === 0 ? "PASS" : "FAIL"}  ${r.name.padEnd(10)} ${r.secs.toFixed(0)}s${r.code ? `  (exit ${r.code})` : ""}`);
const bad = results.filter((r) => r.code !== 0);
console.log(bad.length ? `\n${bad.length} of ${results.length} FAILED: ${bad.map((r) => r.name).join(", ")}` : `\nall ${results.length} passed`);
process.exit(bad.length ? 1 : 0);
