// Offline render self-test: renders each sound through an OfflineAudioContext and reports peak/RMS.
// Browser code only (no Node APIs). Exposes window.__audioSelfTest().
import { Ambient, Synth, createGraph } from "./index";

export interface SelfTestRow {
  name: string;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  status: "ok" | "SILENT" | "CLIPPING";
}

const SR = 44100;
const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

type Job = { name: string; secs: number; run: (s: Synth, t: number) => void; ambient?: number };

function jobs(): Job[] {
  const j: Job[] = [];
  for (const k of ["click", "open", "close", "error", "chat", "target"] as const)
    j.push({ name: `ui.${k}`, secs: 1, run: (s, t) => s.ui(k, t) });
  for (const cls of ["sword", "talisman", "physician"] as const)
    for (let sk = 1; sk <= 4; sk++) j.push({ name: `cast.${cls}.${sk}`, secs: 3, run: (s, t) => s.cast(sk, cls, t) });
  j.push({ name: "hit", secs: 1, run: (s, t) => s.hit(false, t) });
  j.push({ name: "hit.crit", secs: 2, run: (s, t) => s.hit(true, t) });
  j.push({ name: "death", secs: 4, run: (s, t) => s.death(t) });
  j.push({ name: "levelUp", secs: 4, run: (s, t) => s.levelUp(t) });
  j.push({ name: "loot", secs: 2, run: (s, t) => s.loot(t) });
  j.push({ name: "mobDeath", secs: 1.5, run: (s, t) => s.mobDeath(t) });
  j.push({ name: "bossRoar", secs: 5, run: (s, t) => s.bossRoar(t) });
  j.push({ name: "warn", secs: 2.5, run: (s, t) => s.warn(t) });
  j.push({ name: "impact", secs: 1.5, run: (s, t) => s.impact(t) });
  j.push({ name: "footstep", secs: 0.5, run: (s, t) => s.footstep(t) });
  return j;
}

async function render(name: string, secs: number, build: (s: Synth, ctx: OfflineAudioContext) => void): Promise<SelfTestRow> {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * secs), SR);
  const g = createGraph(ctx);
  const s = new Synth(g);
  build(s, ctx);
  const buf = await ctx.startRendering();
  let peak = 0;
  let sum = 0;
  let n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      n++;
    }
  }
  const rms = Math.sqrt(sum / n);
  const status = peak >= 1 ? "CLIPPING" : peak < 0.01 || rms < 0.0008 ? "SILENT" : "ok";
  return { name, peak, peakDb: db(peak), rms, rmsDb: db(rms), status };
}

export async function runSelfTest(): Promise<SelfTestRow[]> {
  const rows: SelfTestRow[] = [];
  for (const j of jobs()) rows.push(await render(j.name, j.secs, (s) => j.run(s, 0.02)));
  // spam test: 40 hits + 20 crits + casts in 1 second must not exceed 0 dBFS
  rows.push(
    await render("spam.combat", 3, (s) => {
      for (let i = 0; i < 60; i++) {
        const t = 0.02 + i * 0.016;
        s.hit(i % 3 === 0, t);
        if (i % 4 === 0) s.cast((i % 4) + 1, (["sword", "talisman", "physician"] as const)[i % 3], t);
      }
      s.bossRoar(0.1);
      s.levelUp(0.2);
    }),
  );
  for (const c of [0, 1]) {
    rows.push(
      await render(`ambient.intensity${c}`, 14, (s, ctx) => {
        const a = new Ambient(s);
        a.intensity = c;
        a.begin();
        a.schedule(14);
        void ctx;
      }),
    );
  }
  return rows;
}

(window as unknown as { __audioSelfTest: typeof runSelfTest }).__audioSelfTest = runSelfTest;
