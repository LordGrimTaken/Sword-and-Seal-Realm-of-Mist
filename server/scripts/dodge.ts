// 0.4.0 test: Qi pool, per-skill Qi costs, dodge roll (dash, i-frames, cooldown, Qi cost, movement accounting) and the wire fields.
//   npm run test:dodge            -> World-level unit checks (no network) + a spawned TEST_MODE server on DODGE_PORT (default 8975)
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import WebSocket from "ws";
import { PROTOCOL_VERSION, TICK_RATE } from "../../shared/protocol.ts";
import type { ClassId, GameEvent, ServerMsg } from "../../shared/protocol.ts";
import { CLASSES, QI } from "../src/data.ts";
import { hurtPlayer } from "../src/game/combat.ts";
import { World } from "../src/game/world.ts";
import type { Player } from "../src/game/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const PORT = Number(process.env.DODGE_PORT) || 8975;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: Array<{ name: string; ok: boolean }> = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}

// ---------------------------------------------------------------- unit (World only)
function mk(w: World, cls: ClassId, name: string) {
  const evs: GameEvent[] = [];
  const p = w.addPlayer({ name, cls, level: 5, xp: 0, x: 0, z: -80 }, (s) => { const m = JSON.parse(s) as ServerMsg; if (m.t === "ev") evs.push(m.e); });
  return { p, evs };
}
const run = (w: World, secs: number) => { for (let i = 0; i < Math.round(secs * TICK_RATE); i++) w.step(); };
const chats = (evs: GameEvent[]) => evs.filter((e): e is Extract<GameEvent, { k: "chat" }> => e.k === "chat").map((e) => e.text);

function unit() {
  console.log("\n[U1] data: every skill has a Qi cost, balance sanity");
  for (const cls of Object.keys(CLASSES) as ClassId[]) {
    const sk = CLASSES[cls].skills;
    check(`${cls}: 4 skills with positive integer Qi costs`, sk.every((s) => Number.isInteger(s.def.qi) && s.def.qi! > 0), sk.map((s) => s.def.qi).join("/"));
    const perSec = sk.reduce((n, s) => n + s.def.qi! / s.def.cooldown, 0);
    check(`${cls}: spamming everything on cooldown costs ${perSec.toFixed(1)} Qi/s (more than regen ${QI.regenPerSec}, less than 1.6x)`, perSec > QI.regenPerSec && perSec < QI.regenPerSec * 1.6);
    check(`${cls}: no single skill costs more than 1/3 of the pool; a dodge is affordable alongside the basic attack`, sk.every((s) => s.def.qi! <= QI.max / 3) && QI.dodgeCost + sk[0].def.qi! < QI.max / 4);
  }

  console.log("\n[U2] Qi spend / refuse / regen");
  const w = new World();
  const { p, evs } = mk(w, "sword", "QiTester");
  check("new player starts with a full pool", p.qi === QI.max && p.mqi === QI.max);
  const mob = w.mobs.find((m) => m.def.type === "bamboo_spirit")!;
  p.x = mob.x - 2; p.z = mob.z; w.resync(p);
  w.cast(p, { skill: 1, target: mob.id });
  check("Flowing Slash spends its Qi", Math.abs(p.qi - (QI.max - 3)) < 1e-6, `qi ${p.qi}`);
  p.qi = 2; p.cdReady[1] = 0; p.gcdReady = 0;
  const before = evs.filter((e) => e.k === "cast").length;
  w.cast(p, { skill: 1, target: mob.id });
  check("cast with too little Qi is refused: no cast event, clear message, cooldown not consumed", evs.filter((e) => e.k === "cast").length === before && chats(evs).some((t) => /Not enough Qi/.test(t)) && p.cdReady[1] === 0 && p.qi === 2, chats(evs).slice(-1)[0]);
  const n0 = chats(evs).length;
  w.cast(p, { skill: 1, target: mob.id }); w.cast(p, { skill: 1, target: mob.id });
  check("the refusal message is rate limited (no chat spam)", chats(evs).length === n0);
  p.qi = 0; p.qiResumeAt = 0; run(w, 2);
  check(`regeneration ~${QI.regenPerSec}/s (2 s -> ${p.qi.toFixed(1)})`, p.qi > QI.regenPerSec * 2 - 2 && p.qi < QI.regenPerSec * 2 + 0.5);
  run(w, 20);
  check("regen is capped at the pool size", p.qi === p.mqi);
  p.cdReady[1] = 0; p.gcdReady = 0; p.x = mob.x - 40; w.resync(p);
  const q1 = p.qi;
  w.cast(p, { skill: 1, target: mob.id });
  check("a cast that fails range validation costs no Qi", p.qi === q1);

  console.log("\n[U3] dodge roll");
  const { p: d, evs: de } = mk(w, "talisman", "Roller");
  d.x = 0; d.z = 0; d.r = 0; w.resync(d); run(w, 0.2);
  w.dodge(d, { dx: 1, dz: 0 });
  check("dodge costs Qi and emits a dodge event", Math.abs(d.qi - (QI.max - QI.dodgeCost)) < 1.0 && de.some((e) => e.k === "dodge" && e.id === d.id), `qi ${d.qi.toFixed(1)}`);
  const x0 = d.x, z0 = d.z;
  run(w, 0.05);
  check("invulnerable during the roll: a hit does nothing and sends `dodged`", hurtPlayer(w, d, 50, 999) === 0 && d.hp === d.mhp && de.some((e) => e.k === "dodged" && e.id === d.id));
  run(w, QI.dodgeTime + 0.1);
  const dd = Math.hypot(d.x - x0, d.z - z0);
  check(`rolled ${QI.dodgeDist} units (${dd.toFixed(2)}) in the requested direction`, Math.abs(dd - QI.dodgeDist) < 0.5 && d.x > x0 && Math.abs(d.z - z0) < 0.01, `dx ${(d.x - x0).toFixed(2)}`);
  check("rolling is not flagged by the movement accounting", w.moveViolations(d) === 0);
  const hp = d.hp;
  check("i-frames end after the roll: a hit lands", hurtPlayer(w, d, 10, 999) > 0 && d.hp < hp);
  const qBefore = d.qi, nDodges = de.filter((e) => e.k === "dodge").length;
  w.dodge(d, { dx: 0, dz: 1 });
  check(`cooldown ${QI.dodgeCooldown} s enforced (a second roll right away is ignored, no Qi spent)`, de.filter((e) => e.k === "dodge").length === nDodges && d.qi >= qBefore);
  run(w, QI.dodgeCooldown);
  d.qi = QI.dodgeCost - 1; d.qiResumeAt = 1e9;
  const evCount = de.filter((e) => e.k === "dodge").length;
  w.dodge(d, { dx: 0, dz: 1 });
  check("dodge refused without enough Qi (message, no event)", de.filter((e) => e.k === "dodge").length === evCount && chats(de).some((t) => /Not enough Qi for a dodge/.test(t)));
  d.qi = 50; d.qiResumeAt = 0;
  d.x = 0; d.z = 0; d.r = Math.PI / 2; w.resync(d);
  w.dodge(d, {}); run(w, 0.4);
  check("no direction given: rolls toward the facing", d.x > 5 && Math.abs(d.z) < 0.5, `(${d.x.toFixed(1)}, ${d.z.toFixed(1)})`);
  run(w, 2);
  d.x = 99; d.z = 0; w.resync(d); w.dodge(d, { dx: 1, dz: 0 }); run(w, 0.4);
  check("dodging into the world edge is clamped", d.x <= w.half + 1e-6, `x ${d.x.toFixed(2)}`);
  run(w, 2);
  w.dodge(d, { dx: "x", dz: 1e9 } as never); w.dodge(d, { dx: NaN, dz: NaN } as never);
  check("garbage dodge payloads never crash or move the player oddly", Number.isFinite(d.x) && Number.isFinite(d.z));
  w.debugKill(d); const q2 = d.qi, n2 = de.filter((e) => e.k === "dodge").length;
  w.dodge(d, { dx: 1, dz: 0 });
  check("a dead player cannot dodge", d.st === "dead" && de.filter((e) => e.k === "dodge").length === n2 && d.qi === q2);
  run(w, 6);
  check("respawn refills Qi and clears roll state", d.qi === d.mqi && d.dashLeft === 0);
  check("a fresh hit after respawn is not negated", hurtPlayer(w, d, 5, 999) > 0);
}

// ---------------------------------------------------------------- wire (spawned server)
let child: ChildProcess | undefined;
async function wire() {
  console.log("\n[W] wire: snap qi fields, dodge message, skills carry Qi cost");
  const tmp = mkdtempSync(join(tmpdir(), "jiuzhou-dodge-"));
  child = spawn(join(ROOT, "node_modules/.bin/tsx"), ["src/server.ts"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DB_PATH: join(tmp, "d.db"), NODE_NO_WARNINGS: "1", TEST_MODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr!.on("data", (x) => process.stderr.write(`[server!] ${x}`));
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { await sleep(100); } }
    if (!up) throw new Error("server did not start");
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
    await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("error", j); });
    let id = 0, skills: Array<{ qi?: number }> = [];
    const snaps: Array<Extract<ServerMsg, { t: "snap" }>> = [], evs: GameEvent[] = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === "welcome") { id = m.id; skills = m.skills; }
      else if (m.t === "snap") snaps.push(m);
      else if (m.t === "ev") evs.push(m.e);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    send({ t: "login", name: "DodgeBot" + (Date.now() % 10000), cls: "sword", v: PROTOCOL_VERSION, pw: "dodge-pass-1" });
    for (let i = 0; i < 50 && !snaps.length; i++) await sleep(100);
    check("protocol version unchanged (v3 clients still log in)", PROTOCOL_VERSION === 3 && id > 0);
    check("welcome skills carry Qi costs", skills.length === 4 && skills.every((s) => (s.qi ?? 0) > 0));
    const last = () => snaps[snaps.length - 1];
    check("snapshots carry own qi / mqi / dcd", last().qi === QI.max && last().mqi === QI.max && last().dcd === 0, JSON.stringify([last().qi, last().mqi, last().dcd]));
    const z0 = last().ents.find((e) => e.id === id)!.z; // spawn points are scattered around the plaza: measure from where this player really stood
    send({ t: "dodge", dx: 0, dz: 1 });
    await sleep(350);
    const dodgeEv = evs.find((e) => e.k === "dodge");
    check("dodge message produces a dodge event", !!dodgeEv);
    await sleep(500);
    const own = last().ents.find((e) => e.id === id)!;
    check("snapshot shows the player moved ~6 units", Math.abs(own.z - z0) > 4 && Math.abs(own.z - z0) < 8.5, `z ${z0} -> ${own.z}`);
    check("snapshot dcd counts down, qi below max and regenerating", (last().dcd ?? 0) > 0 && (last().dcd ?? 0) <= QI.dodgeCooldown && (last().qi ?? 100) < QI.max, `dcd ${last().dcd} qi ${last().qi}`);
    send({ t: "dodge", dx: 0, dz: 1 }); // within the cooldown
    await sleep(200);
    check("dodge during the cooldown is ignored", evs.filter((e) => e.k === "dodge").length === 1);
    send({ t: "chat", text: "/testqi 4" });
    await sleep(300);
    send({ t: "cast", skill: 4 }); // Qi Guard costs 15
    await sleep(300);
    check("self-cast refused at 4 Qi: no cast event and a message", !evs.some((e) => e.k === "cast") && evs.some((e) => e.k === "chat" && /Not enough Qi/.test(e.text)));
    ws.close();
  } finally {
    child?.kill();
    await sleep(200);
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function main() {
  unit();
  await wire();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); child?.kill(); process.exit(1); });
