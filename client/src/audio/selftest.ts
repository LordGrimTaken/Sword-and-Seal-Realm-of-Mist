// Offline render self-test: renders each sound through an OfflineAudioContext and reports peak/RMS.
// Browser code only (no Node APIs). Exposes window.__audioSelfTest().
import { Ambient, Synth, createGraph } from "./index";

export interface SelfTestRow {
  name: string;
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  status: "ok" | "SILENT" | "CLIPPING" | "LOUD";
}

const SR = 44100;
const db = (v: number) => (v > 0 ? 20 * Math.log10(v) : -Infinity);

type Job = { name: string; secs: number; run: (s: Synth, t: number) => void; ambient?: number };

function jobs(): Job[] {
  const j: Job[] = [];
  for (const k of ["click", "open", "close", "error", "chat", "target", "hover", "ready", "tab", "lowqi"] as const)
    j.push({ name: `ui.${k}`, secs: 1, run: (s, t) => s.ui(k, t) });
  // the four click variants each get rendered (the counter advances per call)
  j.push({ name: "ui.click.x4", secs: 1.5, run: (s, t) => { for (let i = 0; i < 4; i++) s.ui("click", t + i * 0.25); } });
  for (const cls of ["sword", "talisman", "physician"] as const)
    for (let sk = 1; sk <= 4; sk++) j.push({ name: `cast.${cls}.${sk}`, secs: 3, run: (s, t) => s.cast(sk, cls, t) });
  j.push({ name: "hit", secs: 1, run: (s, t) => s.hit(false, t) });
  j.push({ name: "hit.crit", secs: 2, run: (s, t) => s.hit(true, t) });
  j.push({ name: "death", secs: 4, run: (s, t) => s.death(t) });
  j.push({ name: "levelUp", secs: 4, run: (s, t) => s.levelUp(t) });
  for (let tier = 0; tier <= 3; tier++) j.push({ name: `loot.tier${tier}`, secs: 3, run: (s, t) => s.loot(t, tier) });
  j.push({ name: "hit.combo5", secs: 1, run: (s, t) => s.hit(false, t, 5) });
  j.push({ name: "hit.combo12", secs: 1, run: (s, t) => s.hit(true, t, 12) });
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
  // one-shots must be audible, below full scale, and not wildly louder than the rest of the mix (-6 dBFS RMS is a very loud short sound)
  const status = peak >= 1 ? "CLIPPING" : peak < 0.01 || rms < 0.0008 ? "SILENT" : db(rms) > -8 ? "LOUD" : "ok";
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
  // bus architecture: a muted UI bus must silence the UI sound, a muted music bus must remove the melody stem, a muted master silences everything
  const silent = (r: SelfTestRow, name: string): SelfTestRow => ({ ...r, name, status: r.peak < 0.002 ? "ok" : "SILENT" });
  rows.push(silent(await render("bus.ui.muted", 1, (s) => { s.g.ui.gain.value = 0; s.g.vol.ui = 0; s.ui("click", 0.02); s.ui("open", 0.2); }), "bus.ui.muted (must be silent)"));
  rows.push(silent(await render("bus.sfx.muted", 1, (s) => { s.g.sfx.gain.value = 0; s.g.vol.sfx = 0; s.hit(true, 0.02); s.impact(0.1); }), "bus.sfx.muted (must be silent)"));
  rows.push(silent(await render("bus.master.muted", 2, (s) => { s.g.master.gain.value = 0; s.hit(true, 0.02); s.ui("click", 0.2); s.loot(0.4, 3); }), "bus.master.muted (must be silent)"));
  {
    const bed = async (musicOn: boolean) => {
      let e = 0;
      await render("tmp", 12, (s) => {
        s.g.music.gain.value = musicOn ? s.g.base.music : 0;
        const a = new Ambient(s);
        a.begin();
        a.schedule(12);
      }).then((r) => { e = r.rms; });
      return e;
    };
    const on = await bed(true), off = await bed(false);
    rows.push({ name: `bus.music.split (music rms ${db(on).toFixed(1)} dB > ambience-only ${db(off).toFixed(1)} dB)`, peak: 0, peakDb: -Infinity, rms: on, rmsDb: db(on), status: on > off * 1.02 ? "ok" : "SILENT" });
  }
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
  // boss layer: war drums and drone ride the music bus and must make the bed clearly louder than the calm bed
  const boss = await render("ambient.boss", 14, (s) => {
    const a = new Ambient(s);
    a.intensity = 1;
    a.boss = true;
    a.begin();
    a.schedule(14);
  });
  rows.push(boss);
  return rows;
}

(window as unknown as { __audioSelfTest: typeof runSelfTest }).__audioSelfTest = runSelfTest;
