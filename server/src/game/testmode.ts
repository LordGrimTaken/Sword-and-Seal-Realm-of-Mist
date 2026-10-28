// TEST-ONLY admin hooks, enabled exclusively when the server process is started with env TEST_MODE=1.
// Without it these chat commands do not exist (they fall through to normal chat handling like any other text).
//   /testlevel N        set level (1..MAX_LEVEL = 20), xp 0, full hp
//   /testtp X Z         teleport (clamped to the world)
//   /testquest S [st]   set quest stage S (0-based) and status (default 1 = active, progress 0)
//   /testgive Item_Name N  add items to the pack (exercises the stack cap)
//   /testdrops          every loot roll for this player succeeds (deterministic drop tests)
//   /testkill [type] [N] kill the N (default 1) nearest living non-boss mobs of that type (any if omitted) with full credit: xp, loot, quest progress
//   /testheal           full hp, clears poison
//   /testxp N           grant N xp through the normal path (level-ups, cap clamp, 'earn XP' daily)
//   /testdaily [n]      complete all of today's daily tasks (or only task n, 1-based); sends `daily`
//   /testwallet C J     add C coin and J jade (negative allowed, never below 0); sends `wallet`
//   /testclock H        shift the SERVER clock by H hours (affects every player; 0 or `reset` = real time) to test the 00:00 UTC rollover
import { MAX_LEVEL, QUESTS, maxHpFor } from "../data.ts";
import { addItem, sendInv } from "./inventory.ts";
import { progressLine } from "./quests.ts";
import { xpEvent, killMob, grantXp } from "./combat.ts";
import { economy, testClock } from "../economy.ts";
import type { Player } from "./types.ts";
import type { World } from "./world.ts";
import { clamp } from "./util.ts";


export const TEST_MODE = () => process.env.TEST_MODE === "1";

export function testCommand(w: World, p: Player, text: string): boolean {
  if (!TEST_MODE()) return false;
  const [cmd, ...a] = text.trim().split(/\s+/);
  const n = a.map(Number);
  switch (cmd.toLowerCase()) {
    case "/testlevel": {
      if (!Number.isFinite(n[0])) return true;
      p.lv = clamp(Math.floor(n[0]), 1, MAX_LEVEL); p.xp = 0; p.mhp = maxHpFor(p.cls, p.lv); p.hp = p.mhp;
      w.emitTo(p, xpEvent(p, 0));
      w.sysTo(p, `[test] level ${p.lv}`);
      return true;
    }
    case "/testtp":
      if (Number.isFinite(n[0]) && Number.isFinite(n[1])) { p.x = clamp(n[0], -w.half, w.half); p.z = clamp(n[1], -w.half, w.half); }
      return true;
    case "/testgive": { // /testgive Item_Name qty  (underscores become spaces)
      const item = (a[0] ?? "").replace(/_/g, " ");
      if (item && Number.isFinite(n[1])) addItem(w, p, item, "", Math.floor(n[1]));
      return true;
    }
    case "/testdrops":
      p.testDrops = true;
      return true;
    case "/testkill": {
      const type = a.find((x) => /^[a-z_]+$/.test(x));
      const cnt = Math.max(1, Math.min(20, Math.floor(n.find((x) => Number.isFinite(x)) ?? 1)));
      const near = w.mobs.filter((m) => m.st !== "dead" && m.hp > 0 && !m.def.boss && (!type || m.def.type === type)).sort((m1, m2) => Math.hypot(m1.x - p.x, m1.z - p.z) - Math.hypot(m2.x - p.x, m2.z - p.z)).slice(0, cnt);
      for (const m of near) { m.threat.set(p.id, 1); killMob(w, m, p); }
      return true;
    }
    case "/testxp":
      if (Number.isFinite(n[0]) && n[0] > 0) grantXp(w, p, Math.floor(n[0]), "quest");
      return true;
    case "/testdaily":
      economy()?.completeAll(w, p, Number.isFinite(n[0]) ? Math.floor(n[0]) : 0);
      return true;
    case "/testwallet":
      if (Number.isFinite(n[0]) && Number.isFinite(n[1])) economy()?.adjust(w, p, n[0], n[1]);
      return true;
    case "/testclock":
      testClock.offsetMs = a[0] === "reset" ? 0 : Number.isFinite(n[0]) ? Math.round(n[0] * 3_600_000) : testClock.offsetMs;
      w.sysTo(p, `[test] clock offset ${testClock.offsetMs / 3_600_000} h`);
      return true;
    case "/testheal":
      p.hp = p.mhp; p.poisonUntil = 0; p.lastHurt = -99;
      return true;
    case "/testquest": {
      const stage = Math.floor(n[0]);
      if (!Number.isFinite(stage) || stage < 0 || stage > QUESTS.length) return true;
      const status = n[1] === 2 ? 2 : n[1] === 0 ? 0 : 1;
      p.quest.stage = stage; p.quest.status = stage >= QUESTS.length ? 0 : status; p.quest.progress = 0; p.quest.progress2 = 0;
      w.onQuestChange?.(p);
      if (stage < QUESTS.length && p.quest.status === 1) w.sysTo(p, `[test] ${progressLine(p)}`);
      sendInv(p);
      return true;
    }
  }
  return false;
}
