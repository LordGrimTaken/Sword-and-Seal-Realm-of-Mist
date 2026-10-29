// JIUZHOU procedural audio. Pure WebAudio, no assets.
// Public API: createGameAudio(). Internals (createGraph/Synth/Ambient) are exported for selftest.

export type UiKind = "click" | "open" | "close" | "error" | "chat" | "target" | "hover" | "ready" | "tab" | "lowqi";
/** Mixer buses the player can balance (master is separate). */
export type BusName = "music" | "amb" | "sfx" | "ui";
export type AudioClass = "sword" | "talisman" | "physician";

export interface GameAudio {
  resume(): void;
  setMasterVolume(v: number): void;
  setMuted(m: boolean): void;
  isMuted(): boolean;
  startAmbient(): void;
  stopAmbient(): void;
  ui(kind: UiKind): void;
  /** Balance one mixer bus, 0..1 (1 = the designed mix). */
  setBusVolume(bus: BusName, v: number): void;
  /** Silence everything while the window is not focused (the caller decides when). */
  setBlurMuted(m: boolean): void;
  /** Boss music layer: war drums, pipa tremolo and a drone, entering and leaving on the next bar. */
  setBoss(on: boolean): void;
  /** Current mixer state (for the settings panel and tests): the levels the buses were last set to. */
  levels(): { master: number; music: number; amb: number; sfx: number; ui: number; muted: boolean; blurMuted: boolean; boss: boolean };
  cast(skill: number, cls: "sword" | "talisman" | "physician"): void;
  /** Consecutive hits within 1.5 s climb the pentatonic scale. */
  hit(crit: boolean): void;
  death(): void;
  levelUp(): void;
  /** Pickup sound by rarity tier: 0 common click, 1 uncommon chime, 2 rare guzheng arpeggio, 3 epic gong and bell. */
  loot(tier?: number): void;
  mobDeath(): void;
  bossRoar(): void;
  /** Low gong sounded when a boss telegraphs a ground attack. */
  warn(): void;
  /** Heavy thud when a telegraphed attack lands. */
  impact(): void;
  footstep(): void;
  /** Dodge roll: soft cloth whoosh (kind "roll") or the bright tick when i-frames negate a hit (kind "dodged"). */
  dodge(kind: "roll" | "dodged"): void;
  setListenerIntensity(combat: number): void;
}

// ---------------------------------------------------------------- helpers
const PENT = [0, 2, 4, 7, 9]; // gong shang jue zhi yu (D major pentatonic)
const ROOT = 146.83; // D3
/** Frequency of pentatonic scale index (0 = D3, 5 = D4, negative goes lower). */
export function pent(idx: number): number {
  const oct = Math.floor(idx / 5);
  const d = ((idx % 5) + 5) % 5;
  return ROOT * Math.pow(2, (PENT[d] + 12 * oct) / 12);
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
/** clamp a frequency to the range WebAudio accepts (avoids out-of-nominal-range warnings) */
function clampF(f: number, hi = 20000, lo = 1): number {
  return Number.isFinite(f) ? Math.min(hi, Math.max(lo, f)) : lo;
}
const EPS = 0.0001;

export interface Graph {
  ctx: BaseAudioContext;
  master: GainNode;
  sfx: GainNode;
  amb: GainNode;
  music: GainNode;
  ui: GainNode;
  rev: GainNode;
  /** Designed per-bus levels; a bus slider scales these. */
  base: Record<BusName, number>;
  /** Current slider position per bus (0..1). Reverb sends are scaled by it so a muted bus leaves no reverb tail. */
  vol: Record<BusName, number>;
  /** Which bus a destination node belongs to (sounds that name no bus count as sfx). Ambient registers its own sub-buses here. */
  busOf: WeakMap<AudioNode, BusName>;
}

function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const env = Math.pow(1 - i / n, 2.6);
      lp += (Math.random() * 2 - 1 - lp) * 0.45; // darken
      d[i] = lp * env;
    }
  }
  return buf;
}

/** Master chain: sfx/amb/reverb -> master -> compressor -> tanh soft-clip -> out. */
export function createGraph(ctx: BaseAudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 10;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(1.3 * x) / Math.tanh(1.3);
  }
  clip.curve = curve;
  clip.oversample = "2x";
  const out = ctx.createGain();
  out.gain.value = 0.92;
  master.connect(comp);
  comp.connect(clip);
  clip.connect(out);
  out.connect(ctx.destination);

  const sfx = ctx.createGain();
  sfx.gain.value = 0.9;
  sfx.connect(master);
  const amb = ctx.createGain();
  amb.gain.value = 0.45;
  amb.connect(master);
  const music = ctx.createGain();
  music.gain.value = 0.45;
  music.connect(master);
  const uib = ctx.createGain();
  uib.gain.value = 0.9;
  uib.connect(master);

  const rev = ctx.createGain(); // reverb send input
  const conv = ctx.createConvolver();
  conv.buffer = makeImpulse(ctx, 2.2);
  const wet = ctx.createGain();
  wet.gain.value = 0.45;
  rev.connect(conv);
  conv.connect(wet);
  wet.connect(master);
  const busOf = new WeakMap<AudioNode, BusName>([[sfx, "sfx"], [amb, "amb"], [music, "music"], [uib, "ui"]]);
  return { ctx, master, sfx, amb, music, ui: uib, rev, base: { music: 0.45, amb: 0.45, sfx: 0.9, ui: 0.9 }, vol: { music: 1, amb: 1, sfx: 1, ui: 1 }, busOf };
}

interface FiltSpec {
  type: BiquadFilterType;
  f: number;
  f2?: number;
  q?: number;
}
interface OscSpec {
  type?: OscillatorType;
  f: number;
  f2?: number;
  t: number;
  dur: number;
  peak: number;
  atk?: number;
  dest?: AudioNode;
  send?: number;
  filt?: FiltSpec;
  vib?: { rate: number; depth: number; delay?: number };
}
interface NoiseSpec {
  t: number;
  dur: number;
  peak: number;
  atk?: number;
  dest?: AudioNode;
  send?: number;
  filt?: FiltSpec;
  am?: number; // amplitude modulation Hz
}

export class Synth {
  private noiseBuf: AudioBuffer;
  private ksCache = new Map<string, AudioBuffer>();
  private active: number[] = [];
  /** Default destination for sounds that name none (the UI sounds switch it to the UI bus). */
  private dflt: AudioNode | null = null;
  private clickN = 0;
  constructor(public g: Graph, private maxVoices = 28) {
    const ctx = g.ctx;
    const n = ctx.sampleRate * 4;
    this.noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }

  /** Polyphony gate for public one-shots. */
  gate(t: number, dur: number): boolean {
    const now = this.g.ctx.currentTime;
    this.active = this.active.filter((e) => e > now);
    if (this.active.length >= this.maxVoices) return false;
    this.active.push(t + dur);
    return true;
  }

  private filt(f: FiltSpec | undefined, t: number, dur: number): BiquadFilterNode | null {
    if (!f) return null;
    const b = this.g.ctx.createBiquadFilter();
    b.type = f.type;
    b.Q.value = f.q ?? 0.8;
    b.frequency.setValueAtTime(clampF(f.f, 18000, 20), t);
    if (f.f2 !== undefined) b.frequency.exponentialRampToValueAtTime(clampF(f.f2, 18000, 20), t + Math.max(0.005, dur));
    return b;
  }

  private wire(src: AudioScheduledSourceNode, nodes: AudioNode[], gain: GainNode, dest: AudioNode, send?: number) {
    gain.connect(dest);
    if (send && send > 0) {
      const s = this.g.ctx.createGain();
      s.gain.value = send * this.g.vol[this.g.busOf.get(dest) ?? "sfx"];
      gain.connect(s);
      s.connect(this.g.rev);
      nodes.push(s);
    }
    src.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already gone */
        }
      }
    };
  }

  private env(g: GainNode, t: number, dur: number, peak: number, atk: number) {
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(Math.min(4, Math.max(EPS * 2, peak)), t + Math.max(0.002, atk));
    g.gain.exponentialRampToValueAtTime(EPS, t + Math.max(0.01, dur));
  }

  osc(o: OscSpec) {
    const ctx = this.g.ctx;
    const src = ctx.createOscillator();
    src.type = o.type ?? "sine";
    const nyq = ctx.sampleRate / 2 - 100;
    src.frequency.setValueAtTime(clampF(o.f, nyq), o.t);
    if (o.f2 !== undefined) src.frequency.exponentialRampToValueAtTime(clampF(o.f2, nyq), o.t + Math.max(0.005, o.dur));
    const nodes: AudioNode[] = [src];
    const gain = ctx.createGain();
    this.env(gain, o.t, o.dur, o.peak, o.atk ?? 0.004);
    const fl = this.filt(o.filt, o.t, o.dur);
    if (fl) {
      src.connect(fl);
      fl.connect(gain);
      nodes.push(fl);
    } else src.connect(gain);
    nodes.push(gain);
    if (o.vib) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vib.rate;
      const lg = ctx.createGain();
      const delay = o.vib.delay ?? 0;
      lg.gain.setValueAtTime(0, o.t);
      lg.gain.linearRampToValueAtTime(o.vib.depth, o.t + delay + 0.25);
      lfo.connect(lg);
      lg.connect(src.frequency);
      lfo.start(o.t);
      lfo.stop(o.t + o.dur + 0.05);
      nodes.push(lfo, lg);
    }
    this.wire(src, nodes, gain, o.dest ?? this.dflt ?? this.g.sfx, o.send);
    src.start(o.t);
    src.stop(o.t + o.dur + 0.05);
  }

  noise(o: NoiseSpec) {
    const ctx = this.g.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const nodes: AudioNode[] = [src];
    const gain = ctx.createGain();
    this.env(gain, o.t, o.dur, o.peak, o.atk ?? 0.003);
    let node: AudioNode = src;
    const fl = this.filt(o.filt, o.t, o.dur);
    if (fl) {
      node.connect(fl);
      node = fl;
      nodes.push(fl);
    }
    if (o.am) {
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.am;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg);
      lg.connect(amg.gain);
      lfo.start(o.t);
      lfo.stop(o.t + o.dur + 0.05);
      node.connect(amg);
      node = amg;
      nodes.push(amg, lfo, lg);
    }
    node.connect(gain);
    nodes.push(gain);
    this.wire(src, nodes, gain, o.dest ?? this.dflt ?? this.g.sfx, o.send);
    src.start(o.t, Math.random() * 3);
    src.stop(o.t + o.dur + 0.05);
  }

  /** Karplus-Strong plucked string (guzheng / pipa-ish). */
  private ks(freq: number, dur: number, bright: number): AudioBuffer {
    const sr = this.g.ctx.sampleRate;
    const key = `${freq.toFixed(1)}|${dur}|${bright}|${sr}`;
    const hit = this.ksCache.get(key);
    if (hit) return hit;
    const N = Math.max(2, Math.round(sr / freq));
    const len = Math.floor(sr * dur);
    const buf = this.g.ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < N; i++) {
      lp += (Math.random() * 2 - 1 - lp) * bright;
      d[i] = lp;
    }
    const damp = 0.5 * (0.9985 + 0.0013 * Math.min(1, freq / 800));
    for (let i = N; i < len; i++) d[i] = (d[i - N] + d[i - N + 1]) * damp;
    let pk = 0;
    for (let i = 0; i < len; i++) pk = Math.max(pk, Math.abs(d[i]));
    const k = pk > 0 ? 1 / pk : 1;
    const fade = Math.floor(sr * 0.03);
    for (let i = 0; i < len; i++) d[i] *= k * (i > len - fade ? (len - i) / fade : 1);
    if (this.ksCache.size > 80) this.ksCache.clear();
    this.ksCache.set(key, buf);
    return buf;
  }

  pluck(freq: number, t: number, vel: number, o: { dur?: number; dest?: AudioNode; send?: number; bright?: number } = {}) {
    const ctx = this.g.ctx;
    const dur = o.dur ?? 2.2;
    const src = ctx.createBufferSource();
    src.buffer = this.ks(freq, dur, o.bright ?? 0.55);
    const fl = ctx.createBiquadFilter();
    fl.type = "lowpass";
    fl.frequency.value = 1200 + 5000 * vel;
    const gain = ctx.createGain();
    gain.gain.value = 0.55 * vel;
    src.connect(fl);
    fl.connect(gain);
    this.wire(src, [src, fl, gain], gain, o.dest ?? this.dflt ?? this.g.sfx, o.send ?? 0.35);
    src.start(t);
  }

  bell(f: number, t: number, peak: number, dur: number, send = 0.4, dest?: AudioNode) {
    const r = [1, 2.76, 5.4, 8.93];
    const a = [1, 0.5, 0.25, 0.12];
    for (let i = 0; i < r.length; i++)
      this.osc({ f: f * r[i], t, dur: dur / (1 + i * 0.7), peak: peak * a[i], atk: 0.002, send, dest });
  }

  chime(f: number, t: number, peak: number, dur: number, send = 0.5) {
    const r = [1, 2.32, 4.25, 6.63];
    const a = [1, 0.45, 0.22, 0.1];
    for (let i = 0; i < r.length; i++)
      this.osc({ f: f * r[i], t, dur: dur / (1 + i * 0.6), peak: peak * a[i], atk: 0.002, send });
  }

  flute(f: number, t: number, dur: number, peak: number, dest?: AudioNode) {
    this.osc({ f, t, dur, peak, atk: 0.14, dest, send: 0.55, vib: { rate: 5, depth: f * 0.007, delay: 0.2 } });
    this.osc({ f: f * 2, t, dur, peak: peak * 0.12, atk: 0.16, dest, send: 0.5 });
    this.noise({ t, dur, peak: peak * 0.35, atk: 0.12, dest, send: 0.5, filt: { type: "bandpass", f: f * 2, q: 5 } });
  }

  // ------------------------------------------------------------ UI
  ui(kind: UiKind, t: number) {
    this.dflt = this.g.ui;
    try {
      this.uiSound(kind, t);
    } finally {
      this.dflt = null;
    }
  }

  private uiSound(kind: UiKind, t: number) {
    const wood = (f: number, tt: number, p: number) => {
      this.osc({ type: "triangle", f, f2: f * 0.7, t: tt, dur: 0.07, peak: p, atk: 0.001 });
      this.noise({ t: tt, dur: 0.025, peak: p * 0.5, atk: 0.001, filt: { type: "bandpass", f: f * 2.2, q: 3 } });
    };
    /** Paper rustle: a short band-passed noise sweep (page turn / scroll unrolling). */
    const paper = (tt: number, up: boolean, p: number) =>
      this.noise({ t: tt, dur: 0.14, peak: p, atk: 0.03, filt: { type: "bandpass", f: up ? 1100 : 3600, f2: up ? 3600 : 1100, q: 0.9 } });
    switch (kind) {
      case "click": {
        const v = [1, 1.122, 0.944, 1.26][this.clickN++ % 4]; // four pitched variants avoid repetition fatigue
        wood(880 * v, t, 0.28);
        break;
      }
      case "open": paper(t, true, 0.16); wood(660, t + 0.05, 0.16); wood(990, t + 0.11, 0.18); break;
      case "close": paper(t, false, 0.14); wood(990, t + 0.03, 0.16); wood(660, t + 0.09, 0.16); break;
      case "tab": paper(t, true, 0.08); wood(1240, t + 0.02, 0.1); break;
      case "hover": this.osc({ type: "sine", f: 2100, f2: 1900, t, dur: 0.03, peak: 0.035, atk: 0.001 }); break;
      case "ready": this.osc({ f: 1760, t, dur: 0.22, peak: 0.1, atk: 0.003, send: 0.3 }); this.osc({ f: 2349, t: t + 0.07, dur: 0.18, peak: 0.07, atk: 0.003, send: 0.3 }); break;
      case "lowqi": this.osc({ f: pent(0) * 1.5, t, dur: 0.3, peak: 0.12, atk: 0.02, send: 0.2, filt: { type: "lowpass", f: 900 } }); break;
      case "error": // a muted wood knock and a soft low dyad, never a harsh buzz
        wood(240, t, 0.26);
        this.osc({ type: "sine", f: 147, t: t + 0.02, dur: 0.22, peak: 0.16, atk: 0.01, send: 0.15, filt: { type: "lowpass", f: 700 } });
        this.osc({ type: "sine", f: 156, t: t + 0.02, dur: 0.22, peak: 0.1, atk: 0.01, filt: { type: "lowpass", f: 700 } });
        break;
      case "chat": this.osc({ type: "sine", f: 1500, f2: 1300, t, dur: 0.09, peak: 0.16, atk: 0.002, send: 0.15 }); wood(1320, t, 0.1); break;
      case "target": this.osc({ f: 1760, t, dur: 0.16, peak: 0.16, atk: 0.003, send: 0.25 }); this.osc({ f: 2637, t, dur: 0.08, peak: 0.06, send: 0.2 }); break;
    }
  }

  // ------------------------------------------------------------ skills
  cast(skill: number, cls: AudioClass, t: number) {
    const s = clamp(Math.round(skill), 1, 4);
    if (cls === "sword") {
      if (s === 1) {
        this.noise({ t, dur: 0.22, peak: 0.34, atk: 0.04, filt: { type: "bandpass", f: 1400, f2: 6500, q: 1.6 } });
        this.osc({ f: 2400, t: t + 0.06, dur: 0.45, peak: 0.1, send: 0.3 });
        this.osc({ f: 3610, t: t + 0.06, dur: 0.3, peak: 0.05, send: 0.3 });
      } else if (s === 2) {
        this.noise({ t, dur: 0.35, peak: 0.34, atk: 0.1, filt: { type: "bandpass", f: 800, f2: 5000, q: 1.2 } });
        this.osc({ type: "sawtooth", f: 300, f2: 900, t, dur: 0.3, peak: 0.07, atk: 0.1, filt: { type: "lowpass", f: 2500 } });
        this.osc({ f: 1760, t: t + 0.12, dur: 0.6, peak: 0.1, send: 0.4 });
      } else if (s === 3) {
        this.osc({ f: 120, f2: 38, t: t + 0.12, dur: 0.5, peak: 0.55, atk: 0.003 });
        this.noise({ t, dur: 0.3, peak: 0.36, atk: 0.12, filt: { type: "bandpass", f: 700, f2: 7000, q: 1.4 } });
        this.noise({ t: t + 0.13, dur: 0.18, peak: 0.28, filt: { type: "lowpass", f: 900 } });
        this.bell(1318, t + 0.13, 0.12, 1.1, 0.5);
      } else {
        this.osc({ type: "triangle", f: pent(5), t, dur: 0.9, peak: 0.16, atk: 0.05, send: 0.4 });
        this.osc({ f: pent(8), t: t + 0.05, dur: 0.9, peak: 0.13, atk: 0.05, send: 0.4 });
        this.osc({ f: pent(10), t: t + 0.1, dur: 0.9, peak: 0.1, atk: 0.05, send: 0.4 });
        this.noise({ t, dur: 0.5, peak: 0.07, atk: 0.2, filt: { type: "highpass", f: 5000 } });
      }
    } else if (cls === "talisman") {
      // paper flutter on every talisman cast
      this.noise({ t, dur: 0.16, peak: 0.16, atk: 0.01, am: 38, filt: { type: "highpass", f: 3200 } });
      if (s === 1) {
        this.noise({ t: t + 0.05, dur: 0.5, peak: 0.28, atk: 0.12, filt: { type: "lowpass", f: 500, f2: 3500, q: 0.9 } });
        for (let i = 0; i < 6; i++)
          this.noise({ t: t + 0.12 + i * rnd(0.04, 0.08), dur: 0.015, peak: 0.2, atk: 0.001, filt: { type: "highpass", f: 3000 } });
      } else if (s === 2) {
        this.noise({ t: t + 0.08, dur: 0.12, peak: 0.55, atk: 0.001, filt: { type: "highpass", f: 1500 } });
        this.noise({ t: t + 0.1, dur: 1.0, peak: 0.3, atk: 0.05, filt: { type: "lowpass", f: 280, f2: 80 } });
        this.osc({ f: 70, f2: 35, t: t + 0.1, dur: 0.6, peak: 0.35 });
      } else if (s === 3) {
        [2093, 3136, 4186].forEach((f, i) => this.chime(f, t + 0.06 + i * 0.05, 0.1, 1.0, 0.55));
        this.noise({ t: t + 0.05, dur: 0.2, peak: 0.1, filt: { type: "highpass", f: 6000 } });
      } else {
        this.noise({ t, dur: 0.55, peak: 0.3, atk: 0.2, filt: { type: "bandpass", f: 500, f2: 3000, q: 1.5 } });
        this.osc({ f: pent(7), f2: pent(12), t, dur: 0.5, peak: 0.08, atk: 0.15, send: 0.3 });
      }
    } else {
      if (s === 1) {
        this.chime(2349, t, 0.16, 0.6, 0.3);
        this.noise({ t, dur: 0.05, peak: 0.12, filt: { type: "highpass", f: 5000 } });
      } else if (s === 2) {
        this.chime(1568, t, 0.14, 1.4, 0.55);
        for (let i = 0; i < 9; i++) {
          const f = rnd(500, 1100);
          this.osc({ f, f2: f * 1.8, t: t + 0.05 + i * rnd(0.05, 0.1), dur: 0.09, peak: 0.1, send: 0.35 });
        }
        this.noise({ t, dur: 0.9, peak: 0.07, atk: 0.2, filt: { type: "bandpass", f: 3500, q: 0.7 } });
      } else if (s === 3) {
        [pent(10), pent(12), pent(14)].forEach((f, i) => this.osc({ f, t: t + i * 0.06, dur: 1.2, peak: 0.12, atk: 0.08, send: 0.55 }));
        this.chime(2093, t + 0.1, 0.09, 1.2, 0.5);
      } else {
        this.osc({ type: "triangle", f: pent(5), f2: pent(10), t, dur: 0.7, peak: 0.15, atk: 0.3, send: 0.4 });
        this.chime(1760, t + 0.4, 0.12, 0.9, 0.5);
        this.noise({ t, dur: 0.7, peak: 0.1, atk: 0.3, filt: { type: "bandpass", f: 1200, f2: 2800, q: 1 } });
      }
    }
  }

  hit(crit: boolean, t: number, combo = 0) {
    const f = rnd(135, 175);
    if (combo > 0) {
      // pitch-laddered combo: each consecutive hit within 1.5 s climbs the pentatonic scale
      const n = pent(5 + Math.min(combo - 1, 9));
      this.osc({ f: n, t: t + 0.005, dur: 0.24, peak: 0.1, atk: 0.002, send: 0.22 });
      this.osc({ type: "triangle", f: n * 2, t: t + 0.005, dur: 0.12, peak: 0.035, atk: 0.002 });
    }
    this.osc({ f, f2: 48, t, dur: 0.16, peak: 0.55, atk: 0.001 });
    this.noise({ t, dur: 0.06, peak: 0.3, atk: 0.001, filt: { type: "lowpass", f: 1800, f2: 400 } });
    if (crit) {
      this.bell(1760, t + 0.01, 0.16, 1.0, 0.45);
      this.osc({ type: "triangle", f: 520, f2: 330, t, dur: 0.08, peak: 0.2 }); // seal-stamp knock
      this.noise({ t, dur: 0.03, peak: 0.25, atk: 0.001, filt: { type: "highpass", f: 3000 } });
    }
  }

  death(t: number) {
    [pent(10), pent(8), pent(5), pent(2)].forEach((f, i) => {
      this.osc({ type: "triangle", f, f2: f * 0.97, t: t + i * 0.28, dur: 1.0, peak: 0.2, atk: 0.01, send: 0.5, filt: { type: "lowpass", f: 1800 } });
    });
    this.osc({ f: 73.4, t, dur: 2.2, peak: 0.28, atk: 0.02, send: 0.5 });
    this.osc({ f: 73.4 * 2.7, t, dur: 1.6, peak: 0.1, atk: 0.02, send: 0.5 });
    this.noise({ t, dur: 1.6, peak: 0.12, atk: 0.05, filt: { type: "lowpass", f: 900, f2: 120 } });
  }

  levelUp(t: number) {
    for (let i = 0; i < 8; i++) {
      const f = pent(10 + i);
      const tt = t + i * 0.09;
      this.pluck(f, tt, 0.85, { dur: 1.2, send: 0.5, bright: 0.7 });
      this.osc({ f: f * 2, t: tt, dur: 0.5, peak: 0.07, atk: 0.003, send: 0.5 });
    }
    // shimmer
    const tt = t + 0.6;
    for (const f of [pent(17), pent(17) * 1.004, pent(19), pent(19) * 0.996]) {
      this.osc({ f, t: tt, dur: 1.7, peak: 0.05, atk: 0.2, send: 0.6, vib: { rate: 6.5, depth: f * 0.004 } });
    }
    this.bell(1568, t + 0.72, 0.1, 1.6, 0.6);
    this.noise({ t: tt, dur: 1.4, peak: 0.04, atk: 0.3, filt: { type: "highpass", f: 7000 } });
  }

  loot(t: number, tier = 1) {
    if (tier <= 0) {
      // common: a dry click and a coin tick
      this.osc({ type: "triangle", f: 700, f2: 520, t, dur: 0.06, peak: 0.16, atk: 0.001 });
      this.noise({ t, dur: 0.03, peak: 0.08, filt: { type: "highpass", f: 5500 } });
    } else if (tier === 1) {
      this.chime(1568, t, 0.14, 0.5, 0.35);
      this.chime(2349, t + 0.09, 0.14, 0.7, 0.4);
      this.noise({ t, dur: 0.03, peak: 0.1, filt: { type: "highpass", f: 5000 } });
    } else if (tier === 2) {
      // rare: a short guzheng arpeggio over a chime
      [10, 12, 14, 17].forEach((n, i) => this.pluck(pent(n), t + i * 0.07, 0.8, { dur: 1.1, send: 0.45, bright: 0.65 }));
      this.chime(2349, t + 0.28, 0.1, 0.8, 0.45);
    } else {
      // epic: bronze gong under a falling bell cascade
      this.bell(196, t, 0.2, 1.8, 0.5);
      this.osc({ f: 98, f2: 92, t, dur: 1.5, peak: 0.22, atk: 0.01, send: 0.4 });
      [17, 19, 22].forEach((n, i) => this.bell(pent(n), t + 0.12 + i * 0.11, 0.09, 1.4, 0.5));
      this.pluck(pent(12), t + 0.02, 0.8, { dur: 1.4, send: 0.45 });
    }
  }

  mobDeath(t: number) {
    this.noise({ t, dur: 0.5, peak: 0.3, atk: 0.005, filt: { type: "lowpass", f: 2500, f2: 150 } });
    this.osc({ type: "triangle", f: 420, f2: 90, t, dur: 0.4, peak: 0.28 });
    this.osc({ f: 100, f2: 40, t, dur: 0.35, peak: 0.35 });
  }

  bossRoar(t: number) {
    const dur = 1.9;
    this.osc({ type: "sawtooth", f: 62, f2: 48, t, dur, peak: 0.34, atk: 0.12, filt: { type: "lowpass", f: 700, f2: 250, q: 1.5 }, vib: { rate: 11, depth: 3 } });
    this.osc({ type: "sawtooth", f: 93, f2: 71, t, dur, peak: 0.18, atk: 0.12, filt: { type: "bandpass", f: 500, f2: 320, q: 3 }, vib: { rate: 9, depth: 4 } });
    this.noise({ t, dur, peak: 0.26, atk: 0.1, filt: { type: "bandpass", f: 300, f2: 180, q: 1.5 }, am: 17 });
    this.osc({ f: 73.4, t: t + 0.05, dur: 3, peak: 0.25, atk: 0.04, send: 0.6 });
    this.osc({ f: 73.4 * 2.76, t: t + 0.05, dur: 2.2, peak: 0.08, atk: 0.04, send: 0.6 });
    this.osc({ f: 45, f2: 30, t, dur: 0.7, peak: 0.45, atk: 0.005 });
  }

  /** Boss wind-up warning: a struck bronze gong with a falling beat. */
  warn(t: number) {
    this.bell(196, t, 0.2, 1.6, 0.5);
    this.osc({ f: 98, f2: 92, t, dur: 1.4, peak: 0.26, atk: 0.01, send: 0.4 });
    this.osc({ f: 98 * 2.41, t, dur: 1.0, peak: 0.07, atk: 0.01, send: 0.4 });
    this.noise({ t, dur: 0.08, peak: 0.14, atk: 0.002, filt: { type: "bandpass", f: 1800, q: 1 } });
  }

  /** Slam impact: sub thud plus a rubble burst. */
  impact(t: number) {
    this.osc({ f: 120, f2: 34, t, dur: 0.6, peak: 0.55, atk: 0.003 });
    this.osc({ type: "triangle", f: 220, f2: 60, t, dur: 0.3, peak: 0.25, atk: 0.003 });
    this.noise({ t, dur: 0.55, peak: 0.34, atk: 0.003, filt: { type: "lowpass", f: 1800, f2: 120 } });
  }

  /** Dodge roll whoosh, or the paper-bell tick of a successful dodge. */
  dodge(kind: "roll" | "dodged", t: number) {
    if (kind === "roll") {
      this.noise({ t, dur: 0.28, peak: 0.26, atk: 0.04, filt: { type: "bandpass", f: 500, f2: 3200, q: 1.1 } });
      this.noise({ t: t + 0.18, dur: 0.1, peak: 0.12, atk: 0.005, filt: { type: "lowpass", f: 700, f2: 250 } });
    } else {
      this.bell(pent(12), t, 0.12, 0.5, 0.4);
      this.noise({ t, dur: 0.05, peak: 0.1, atk: 0.002, filt: { type: "highpass", f: 5200 } });
    }
  }

  footstep(t: number) {
    const f = rnd(300, 520);
    this.noise({ t, dur: 0.075, peak: 0.1, atk: 0.003, filt: { type: "lowpass", f, f2: f * 0.5, q: 0.7 } });
    this.osc({ f: rnd(70, 95), f2: 45, t, dur: 0.06, peak: 0.08, atk: 0.002 });
  }
}

// ---------------------------------------------------------------- ambient + music
export class Ambient {
  intensity = 0;
  silent = false;
  private nodes: AudioNode[] = [];
  private srcs: AudioScheduledSourceNode[] = [];
  private bus: GainNode;
  /** Music (melody, flute, gong, combat and boss stems) has its own bus so it can be balanced against the ambience. */
  private mbus: GainNode;
  /** Boss layer requested by the game; `bossOn` is the audible state, which changes on bar lines. */
  boss = false;
  private bossOn = false;
  private barN = 0;
  private next = { melody: 0, flute: 0, gong: 0, bird: 0, cicada: 0, step: 0 };
  private stepN = 0;
  private mi = 7;
  private started = false;
  private readonly stepDur = 0.3125; // 96 bpm eighths

  constructor(private s: Synth) {
    this.bus = s.g.ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(s.g.amb);
    s.g.busOf.set(this.bus, "amb");
    this.mbus = s.g.ctx.createGain();
    this.mbus.gain.value = 0;
    this.mbus.connect(s.g.music);
    s.g.busOf.set(this.mbus, "music");
  }

  private loopNoise(): AudioBufferSourceNode {
    const ctx = this.s.g.ctx;
    const n = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.srcs.push(src);
    this.nodes.push(src);
    return src;
  }

  private lfo(rate: number, depth: number, target: AudioParam, t: number) {
    const ctx = this.s.g.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = rate;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(target);
    o.start(t);
    this.srcs.push(o);
    this.nodes.push(o, g);
  }

  private layer(f: BiquadFilterType, freq: number, q: number, f2: BiquadFilterType | null, freq2: number, base: number): { g: GainNode; fl: BiquadFilterNode } {
    const ctx = this.s.g.ctx;
    const src = this.loopNoise();
    const fl = ctx.createBiquadFilter();
    fl.type = f;
    fl.frequency.value = freq;
    fl.Q.value = q;
    src.connect(fl);
    let last: AudioNode = fl;
    if (f2) {
      const fl2 = ctx.createBiquadFilter();
      fl2.type = f2;
      fl2.frequency.value = freq2;
      last.connect(fl2);
      last = fl2;
      this.nodes.push(fl2);
    }
    const g = ctx.createGain();
    g.gain.value = base;
    last.connect(g);
    g.connect(this.bus);
    src.start(this.s.g.ctx.currentTime, Math.random() * 4);
    this.nodes.push(fl, g);
    return { g, fl };
  }

  begin(): void {
    if (this.started) return;
    this.started = true;
    const ctx = this.s.g.ctx;
    const t = ctx.currentTime;
    // wind
    const w = this.layer("bandpass", 380, 0.6, null, 0, 0.14);
    this.lfo(0.07, 0.09, w.g.gain, t);
    this.lfo(0.05, 160, w.fl.frequency, t);
    // distant water
    const wa = this.layer("highpass", 900, 0.5, "lowpass", 3800, 0.05);
    this.lfo(0.63, 0.018, wa.g.gain, t);
    this.lfo(1.7, 0.012, wa.g.gain, t);
    // bamboo rustle
    const b = this.layer("bandpass", 2800, 2.5, null, 0, 0.035);
    this.lfo(0.11, 0.03, b.g.gain, t);
    this.lfo(0.37, 0.015, b.g.gain, t);
    for (const b of [this.bus, this.mbus]) {
      b.gain.cancelScheduledValues(t);
      b.gain.setValueAtTime(0, t);
      b.gain.linearRampToValueAtTime(1, t + 2.5);
    }
    const n = this.next;
    n.melody = t + 1.5;
    n.flute = t + rnd(8, 16);
    n.gong = t + rnd(5, 10);
    n.bird = t + rnd(2, 6);
    n.cicada = t + rnd(10, 20);
    n.step = t + 0.1;
  }

  /** Schedule events with time < until. Call periodically with currentTime + lookahead. */
  schedule(until: number): void {
    if (!this.started) return;
    const n = this.next;
    const now = this.s.g.ctx.currentTime;
    for (const k of Object.keys(n) as (keyof typeof n)[]) if (n[k] < now - 0.05) n[k] = now + 0.05;
    const c = this.intensity;
    const calm = 1 - 0.55 * c;
    const sy = this.s;
    const dest = this.bus;
    const mus = this.mbus;
    while (n.melody < until) {
      if (!this.silent) {
        const steps = [-2, -1, 1, 2, 3, -3, 1, -1];
        this.mi = clamp(this.mi + pick(steps), 3, 13);
        sy.pluck(pent(this.mi), n.melody, rnd(0.45, 0.8) * calm, { dest: mus, send: 0.5 });
        if (Math.random() < 0.35) {
          this.mi = clamp(this.mi + pick([-1, 1, 2]), 3, 13);
          sy.pluck(pent(this.mi), n.melody + rnd(0.2, 0.38), rnd(0.4, 0.7) * calm, { dest: mus, send: 0.5 });
        }
      }
      n.melody += rnd(1.6, 4.2) * (1 + c * 0.8);
    }
    while (n.flute < until) {
      if (!this.silent && c < 0.6) {
        let idx = pick([5, 6, 7, 8, 9]);
        let tt = n.flute;
        const cnt = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < cnt; i++) {
          const d = rnd(0.6, 1.3);
          sy.flute(pent(idx + 5), tt, d + 0.3, 0.1 * calm, mus);
          tt += d;
          idx = clamp(idx + pick([-2, -1, 1, 2]), 2, 11);
        }
      }
      n.flute += rnd(22, 40);
    }
    while (n.gong < until) {
      if (!this.silent) {
        const t = n.gong;
        const r = [1, 2.0, 2.7, 4.1];
        r.forEach((m, i) => sy.osc({ f: 73.4 * m, t, dur: 6, peak: 0.1 / (1 + i * 0.8), atk: 1.8, dest: mus, send: 0.6 }));
        sy.noise({ t, dur: 4, peak: 0.05, atk: 1.8, dest: mus, filt: { type: "lowpass", f: 500, f2: 200 } });
        sy.osc({ f: 90, f2: 45, t: t + 1.8, dur: 0.6, peak: 0.16, atk: 0.005, dest: mus });
      }
      n.gong += rnd(25, 45);
    }
    while (n.bird < until) {
      if (!this.silent) {
        const base = rnd(2400, 4200);
        const cnt = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < cnt; i++)
          sy.osc({ f: base, f2: base * rnd(1.15, 1.5), t: n.bird + i * 0.11, dur: 0.07, peak: 0.035, atk: 0.005, dest, send: 0.3 });
      }
      n.bird += rnd(4, 14);
    }
    while (n.cicada < until) {
      if (!this.silent)
        sy.noise({ t: n.cicada, dur: rnd(1.2, 2.5), peak: 0.012, atk: 0.4, dest, am: 55, filt: { type: "bandpass", f: 6200, q: 4 } });
      n.cicada += rnd(18, 40);
    }
    // combat layer: taiko-ish drums + tension plucks, level follows intensity; the boss layer rides the same bar grid
    while (n.step < until) {
      const cc = this.intensity;
      const st = this.stepN % 16;
      const t = n.step;
      if (st === 0) this.barN++;
      if (!this.silent && cc > 0.08) {
        const lvl = Math.pow(cc, 0.8);
        if (st === 0 || st === 8) {
          sy.osc({ f: 125, f2: 46, t, dur: 0.4, peak: 0.45 * lvl, atk: 0.003, dest: mus });
          sy.noise({ t, dur: 0.08, peak: 0.12 * lvl, dest: mus, filt: { type: "lowpass", f: 600 } });
          sy.pluck(pent(pick([-3, -1, 0, 2])), t, 0.6 * lvl, { dur: 1.4, dest: mus, send: 0.3 });
        } else if ([3, 4, 10, 12, 14].includes(st)) {
          sy.osc({ f: 160, f2: 62, t, dur: 0.22, peak: (st === 12 ? 0.34 : 0.22) * lvl, atk: 0.003, dest: mus });
        }
        if (cc > 0.55 && st % 2 === 1)
          sy.noise({ t, dur: 0.04, peak: 0.06 * lvl, dest: mus, filt: { type: "bandpass", f: 1800, q: 2 } });
      }
      // boss layer: enters and leaves only on a bar line, closing with a cymbal swell instead of a hard cut
      if (st === 0 && this.boss !== this.bossOn) {
        this.bossOn = this.boss;
        if (!this.silent) {
          if (this.bossOn) sy.bell(98, t, 0.16, 2.4, 0.5, mus);
          sy.noise({ t, dur: 1.6, peak: 0.07, atk: 1.2, dest: mus, filt: { type: "highpass", f: 5200 } });
        }
      }
      if (this.bossOn && !this.silent) this.bossStep(st, t, mus);
      n.step += this.stepDur;
      this.stepN++;
    }
  }

  /** One 16th-step of the boss stem: stacked war drums, a pipa tremolo (lunzhi) every fourth bar and a low drone on the bar line. */
  private bossStep(st: number, t: number, mus: AudioNode) {
    const sy = this.s;
    if (st === 0) {
      sy.osc({ type: "sawtooth", f: 73.4, t, dur: 5.2, peak: 0.05, atk: 1.2, dest: mus, send: 0.3, filt: { type: "lowpass", f: 420 } });
      sy.osc({ type: "sawtooth", f: 110, t, dur: 5.2, peak: 0.03, atk: 1.2, dest: mus, send: 0.3, filt: { type: "lowpass", f: 380 } });
    }
    if ([0, 6, 8, 11, 14].includes(st)) {
      const big = st === 0 || st === 8;
      sy.osc({ f: big ? 98 : 120, f2: big ? 38 : 50, t, dur: big ? 0.55 : 0.32, peak: big ? 0.5 : 0.34, atk: 0.003, dest: mus, send: 0.35 });
      sy.noise({ t, dur: 0.07, peak: big ? 0.16 : 0.1, atk: 0.001, dest: mus, filt: { type: "lowpass", f: 900 } });
    }
    if (st === 4 || st === 12) sy.noise({ t, dur: 0.05, peak: 0.08, atk: 0.001, dest: mus, filt: { type: "bandpass", f: 2400, q: 2 } });
    if (st === 8 && this.barN % 4 === 2) {
      const note = pent(pick([5, 7, 9, 10]));
      for (let i = 0; i < 14; i++) sy.pluck(note, t + i * 0.075, 0.35 + (i / 14) * 0.45, { dur: 0.5, dest: mus, send: 0.3, bright: 0.7 });
    }
  }

  end(): void {
    if (!this.started) return;
    this.started = false;
    const ctx = this.s.g.ctx;
    const t = ctx.currentTime;
    for (const b of [this.bus, this.mbus]) {
      b.gain.cancelScheduledValues(t);
      b.gain.setValueAtTime(b.gain.value, t);
      b.gain.linearRampToValueAtTime(0, t + 1);
    }
    const srcs = this.srcs;
    const nodes = this.nodes;
    this.srcs = [];
    this.nodes = [];
    const stopAt = t + 1.1;
    for (const s of srcs) {
      try {
        s.stop(stopAt);
      } catch {
        /* not started */
      }
    }
    const clean = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
    if (srcs[0]) srcs[0].onended = clean;
    else clean();
  }
}

// ---------------------------------------------------------------- facade
export function createGameAudio(): GameAudio {
  let ctx: AudioContext | null = null;
  let graph: Graph | null = null;
  let synth: Synth | null = null;
  let ambient: Ambient | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let muted = false;
  let blurMuted = false;
  let volume = 0.8;
  const busVol: Record<BusName, number> = { music: 1, amb: 1, sfx: 1, ui: 1 };
  let bossWanted = false;
  let comboN = 0;
  let lastHitAt = -9;
  let wantAmbient = false;
  let intensity = 0;
  const last: Record<string, number> = {};

  const safe = (f: () => void) => {
    try {
      f();
    } catch {
      /* audio must never throw into game code */
    }
  };
  const applyVol = () => {
    if (!graph || !ctx) return;
    graph.master.gain.setTargetAtTime(muted || blurMuted ? 0 : volume, ctx.currentTime, 0.03);
    if (ambient) ambient.silent = muted;
    for (const b of Object.keys(busVol) as BusName[]) { graph.vol[b] = busVol[b]; graph[b].gain.setTargetAtTime(graph.base[b] * busVol[b], ctx.currentTime, 0.05); }
  };
  const running = () => !!(ctx && synth && ctx.state === "running");
  /** Play a one-shot: gated by polyphony and per-key min interval. */
  const play = (key: string, minGap: number, dur: number, fn: (s: Synth, t: number) => void) => {
    safe(() => {
      if (!running() || muted || !ctx || !synth) return;
      const now = ctx.currentTime;
      if (minGap > 0 && now - (last[key] ?? -9) < minGap) return;
      const t = now + 0.005;
      if (!synth.gate(t, dur)) return;
      last[key] = now;
      fn(synth, t);
    });
  };
  const tick = () => safe(() => {
    if (ambient && ctx) ambient.schedule(ctx.currentTime + 2.5);
  });

  const api: GameAudio = {
    resume() {
      safe(() => {
        if (!ctx) {
          const AC: typeof AudioContext | undefined =
            typeof window !== "undefined"
              ? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
              : undefined;
          if (!AC) return;
          ctx = new AC();
          graph = createGraph(ctx);
          synth = new Synth(graph);
          applyVol();
        }
        const c = ctx;
        if (c.state !== "running") {
          const p = c.resume();
          if (p && typeof p.then === "function")
            p.then(() => { if (wantAmbient) api.startAmbient(); }).catch(() => undefined);
        }
      });
    },
    setMasterVolume(v) {
      volume = clamp(Number.isFinite(v) ? v : 0, 0, 1);
      safe(applyVol);
    },
    setMuted(m) {
      muted = !!m;
      safe(applyVol);
    },
    isMuted: () => muted,
    setBusVolume(bus, v) {
      if (!(bus in busVol)) return;
      busVol[bus] = clamp(Number.isFinite(v) ? v : 1, 0, 1);
      if (graph) graph.vol[bus] = busVol[bus];
      safe(applyVol);
    },
    setBlurMuted(m) {
      blurMuted = !!m;
      safe(applyVol);
    },
    levels: () => ({ master: volume, ...busVol, muted, blurMuted, boss: bossWanted }),
    setBoss(on) {
      bossWanted = !!on;
      if (ambient) ambient.boss = bossWanted;
    },
    startAmbient() {
      wantAmbient = true;
      safe(() => {
        if (!running() || !synth) return;
        if (!ambient) {
          ambient = new Ambient(synth);
          ambient.silent = muted;
        }
        ambient.intensity = intensity;
        ambient.boss = bossWanted;
        ambient.begin();
        if (!timer) timer = setInterval(tick, 400);
        tick();
      });
    },
    stopAmbient() {
      wantAmbient = false;
      safe(() => {
        if (timer) { clearInterval(timer); timer = null; }
        if (ambient) { ambient.end(); ambient = null; }
      });
    },
    ui: (kind) => play("ui-" + kind, kind === "hover" ? 0.07 : 0.025, 0.4, (s, t) => s.ui(kind, t)),
    cast: (skill, cls) => play("cast", 0.03, 2.2, (s, t) => s.cast(skill, cls, t)),
    hit: (crit) => {
      const now = ctx ? ctx.currentTime : 0;
      comboN = now - lastHitAt < 1.5 ? comboN + 1 : 0;
      lastHitAt = now;
      const c = comboN;
      play("hit", 0.035, crit ? 1.3 : 0.3, (s, t) => s.hit(crit, t, c));
    },
    death: () => play("death", 0.5, 2.6, (s, t) => s.death(t)),
    levelUp: () => play("lvl", 0.5, 3.2, (s, t) => s.levelUp(t)),
    loot: (tier = 1) => play("loot", 0.06, tier >= 2 ? 2 : 1, (s, t) => s.loot(t, clamp(Math.round(tier), 0, 3))),
    mobDeath: () => play("mob", 0.05, 0.6, (s, t) => s.mobDeath(t)),
    bossRoar: () => play("boss", 1, 3.2, (s, t) => s.bossRoar(t)),
    warn: () => play("warn", 0.4, 2, (s, t) => s.warn(t)),
    impact: () => play("impact", 0.2, 0.8, (s, t) => s.impact(t)),
    footstep: () => play("step", 0.16, 0.15, (s, t) => s.footstep(t)),
    dodge: (kind) => play("dodge-" + kind, 0.12, 0.6, (s, t) => s.dodge(kind, t)),
    setListenerIntensity(c) {
      intensity = clamp(Number.isFinite(c) ? c : 0, 0, 1);
      if (ambient) ambient.intensity = intensity;
    },
  };
  return api;
}
