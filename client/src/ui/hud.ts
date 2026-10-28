import * as THREE from "three";
import type { ClassId, EntityState, SkillDef, ZoneInfo } from "@shared/protocol";
import { CLASS_INFO, esc, plain } from "./glyphs";
import { icon, skillIcon, itemIcon } from "./icons";
import { Minimap } from "./minimap";
import { audio } from "../audio/instance";
import { QuestTracker, type QuestEvent } from "./quest";
import { NpcDialog } from "./dialog";
import { Bag } from "./bag";
import { HelpOverlay } from "./help";
import { Wallet } from "./wallet";
import { Board } from "./board";
import { skillTipHtml, BUFFS } from "./skilltips";

export interface HudEnt {
  id: number;
  s: EntityState;
  x: number;
  y: number;
  z: number;
  dead: boolean;
  h: number;
}

export interface HudCallbacks {
  onSlot(slot: number): void;
  onChat(text: string): void;
  onReconnect(): void;
  /** Dialog asks the game to send the quest NPC's `/talk`. */
  onTalk(who: "elder" | "mei" | "fen"): void;
  /** Claim a finished daily task. */
  onClaim(id: string): void;
  onLowRes(on: boolean): void;
  getLowRes(): boolean;
  onQuestEvent?(e: QuestEvent): void;
}

interface Plate { el: HTMLDivElement; t: HTMLDivElement; bar: HTMLElement | null; key: string; deadAt: number }
interface Float { el: HTMLDivElement; pos: THREE.Vector3; age: number; life: number; dx: number }

/** Nameplate colour class from mob level minus player level. */
function threat(diff: number): string {
  return diff <= -3 ? "lv-low" : diff <= 1 ? "lv-even" : diff <= 4 ? "lv-hard" : "lv-deadly";
}

/** Vermilion ink-splash behind critical hits. */
const SPLASH = `<svg class="splash" viewBox="-60 -40 120 80" aria-hidden="true"><path d="M-6-34l5 14 13-12-3 16 20-8-12 13 22 2-20 8 16 10-20-1 6 14-14-9-4 14-6-14-14 10 3-15-22 3 17-9-18-9 21-1-9-13 17 6z" fill="#c8372d" opacity=".82"/><circle cx="-42" cy="-12" r="3.2" fill="#c8372d" opacity=".8"/><circle cx="44" cy="14" r="2.6" fill="#c8372d" opacity=".8"/><circle cx="-34" cy="24" r="2" fill="#c8372d" opacity=".7"/><circle cx="38" cy="-24" r="2.2" fill="#c8372d" opacity=".7"/></svg>`;

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export class Hud {
  readonly root: HTMLElement;
  chatFocused = false;
  private cb: HudCallbacks;
  private minimap: Minimap;
  private plates = new Map<number, Plate>();
  private floats: Float[] = [];
  private slots: Array<{ el: HTMLElement; cd: HTMLElement; slot: number; ready: number; dur: number }> = [];
  private cls: ClassId = "sword";
  private v = new THREE.Vector3();
  private lastTargetId = -1;
  private deathAt = -1;
  private hurtTimer = 0;
  private qi = 100;
  readonly quest: QuestTracker;
  readonly dialog: NpcDialog;
  readonly help: HelpOverlay;
  readonly bag: Bag;
  readonly wallet: Wallet;
  readonly board: Board;
  private boardBtn!: HTMLElement;
  private tip!: HTMLElement;
  private buffsEl!: HTMLElement;
  private buffs: Array<{ el: HTMLElement; end: number; dur: number }> = [];
  private prompt!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer = 0;
  private connBtn!: HTMLButtonElement;
  private connTitle!: HTMLElement;
  private bagBtn!: HTMLElement;
  private warnEl!: HTMLElement; private warnTimer = 0;
  private boss!: HTMLElement; private bossName!: HTMLElement; private bossHp!: HTMLElement; private bossT!: HTMLElement; private bossKey = "";

  // cached nodes
  private pName!: HTMLElement; private pCls!: HTMLElement; private pLv!: HTMLElement;
  private pHp!: HTMLElement; private pHpT!: HTMLElement; private pQi!: HTMLElement;
  private tFrame!: HTMLElement; private tName!: HTMLElement; private tLv!: HTMLElement; private tHp!: HTMLElement; private tHpT!: HTMLElement;
  private xpI!: HTMLElement; private xpL!: HTMLElement;
  private chatLog!: HTMLElement; private chatIn!: HTMLInputElement;
  private loot!: HTMLElement; private perf!: HTMLElement;
  private zone!: HTMLElement; private lvl!: HTMLElement; private death!: HTMLElement; private deathCd!: HTMLElement;
  private hurt!: HTMLElement; private conn!: HTMLElement; private connMsg!: HTMLElement;
  private zoneLabel!: HTMLElement;
  private muteBtn!: HTMLElement; private vol!: HTMLInputElement;

  constructor(cb: HudCallbacks) {
    this.cb = cb;
    this.root = document.getElementById("hud")!;
    this.root.innerHTML = `
      <div id="pframe" class="panel uf">
        <div class="row"><span class="nm" data-r="pn"></span><span class="cl" data-r="pc"></span><span class="lv" data-r="pl"></span></div>
        <div class="bar hp"><i data-r="ph"></i><span data-r="pht"></span></div>
        <div class="bar qi"><i data-r="pq"></i></div>
      </div>
      <div id="buffs"></div>
      <div id="tframe" class="panel uf hidden">
        <div class="row"><span class="nm" data-r="tn"></span><span class="lv" data-r="tl"></span></div>
        <div class="bar hp"><i data-r="th"></i><span data-r="tht"></span></div>
      </div>
      <div id="hotbar" class="panel"><div class="slots"></div><div id="xp"><i></i></div><div id="xplabel"></div></div>
      <div id="bossbar" class="panel"><div class="bn"></div><div class="bbar"><i></i><b class="mk"></b></div><div class="bt"></div></div>
      <button id="bagbtn" class="panel" type="button" title="Bag (I)" aria-label="Bag"><span class="g">${icon("pouch")}</span><span class="k">I</span><span class="dot"></span></button>
      <button id="boardbtn" class="panel" type="button" title="Notice Board (B)" aria-label="Notice Board"><span class="g">${icon("board")}</span><span class="k">B</span><span class="dot"></span></button>
      <div id="warn"><div class="big"></div><div class="sub"></div></div>
      <div id="chat" class="panel"><div id="chatlog"></div><input id="chatin" maxlength="120" placeholder="Press Enter to speak…" autocomplete="off" /></div>
      <div id="zonelabel"></div>
      <div id="audioctl" class="panel" title="Sound (M to mute)"><button id="mutebtn" type="button" aria-label="Mute">♪</button><input id="vol" type="range" min="0" max="100" step="5" aria-label="Volume" /><button id="helpbtn" type="button" title="Help and settings (F1)" aria-label="Help">?</button></div>
      <div id="tip"></div>
      <div id="prompt"><kbd>F</kbd> Speak</div>
      <div id="toast"></div>
      <div id="loot"></div>
      <div id="perf"></div>
      <div id="hurt"></div>
      <div id="zone"><div class="big"></div><div class="ln"></div><div class="small">Cloudmist region</div></div>
      <div id="levelup"><div class="g">Level Up</div><div class="s"></div></div>
      <div id="death"><div><div class="big">You Have Fallen</div><div class="rule"></div><div class="cd"></div></div></div>
      <div id="conn"><div class="panel"><h3>Connection Lost</h3><div class="spin"></div><p></p><button class="btn" id="connbtn">Return</button></div></div>
    `;
    this.root.style.display = "block";
    const r = this.root;
    this.pName = $(r, '[data-r="pn"]'); this.pCls = $(r, '[data-r="pc"]'); this.pLv = $(r, '[data-r="pl"]');
    this.pHp = $(r, '[data-r="ph"]'); this.pHpT = $(r, '[data-r="pht"]'); this.pQi = $(r, '[data-r="pq"]');
    this.tFrame = $(r, "#tframe"); this.tName = $(r, '[data-r="tn"]'); this.tLv = $(r, '[data-r="tl"]');
    this.tHp = $(r, '[data-r="th"]'); this.tHpT = $(r, '[data-r="tht"]');
    this.xpI = $(r, "#xp i"); this.xpL = $(r, "#xplabel");
    this.chatLog = $(r, "#chatlog"); this.chatIn = $(r, "#chatin");
    this.loot = $(r, "#loot"); this.perf = $(r, "#perf");
    this.zone = $(r, "#zone"); this.lvl = $(r, "#levelup"); this.death = $(r, "#death"); this.deathCd = $(r, "#death .cd");
    this.hurt = $(r, "#hurt"); this.conn = $(r, "#conn"); this.connMsg = $(r, "#conn p"); this.zoneLabel = $(r, "#zonelabel");
    this.minimap = new Minimap(r);
    this.boss = $(r, "#bossbar"); this.bossName = $(r, "#bossbar .bn"); this.bossHp = $(r, "#bossbar .bbar i"); this.bossT = $(r, "#bossbar .bt");
    this.warnEl = $(r, "#warn"); this.bagBtn = $(r, "#bagbtn");
    this.bag = new Bag(r, (n) => this.bagBtn.classList.toggle("fresh", n > 0));
    this.bagBtn.addEventListener("click", () => { this.bag.toggle(); this.bagBtn.blur(); });
    this.wallet = new Wallet(r);
    this.boardBtn = $(r, "#boardbtn");
    this.board = new Board(r, {
      onClaim: (id) => cb.onClaim(id),
      onToggle: (on) => { this.boardBtn.classList.toggle("open", on); audio.ui(on ? "open" : "close"); },
      onClaimable: (n) => {
        this.boardBtn.classList.toggle("claimable", n > 0);
        this.boardBtn.title = n > 0 ? `Notice Board (B) - ${n} reward${n === 1 ? "" : "s"} ready` : "Notice Board (B)";
      },
    });
    this.boardBtn.addEventListener("click", () => { this.board.toggle(); this.boardBtn.blur(); });
    this.tip = $(r, "#tip"); this.buffsEl = $(r, "#buffs"); this.prompt = $(r, "#prompt"); this.toastEl = $(r, "#toast");
    this.connBtn = $(r, "#connbtn") as HTMLButtonElement; this.connTitle = $(r, "#conn h3");
    this.quest = new QuestTracker(r, (e) => {
      if (e.kind === "ready") this.quest.stamp("Complete", "Objective complete");
      else if (e.kind === "completed") this.quest.stamp("Complete", `Quest complete${e.xp ? ` · +${e.xp} XP` : ""}`);
      cb.onQuestEvent?.(e);
    });
    this.dialog = new NpcDialog(r, { talk: (who) => cb.onTalk(who), onOpenSound: () => audio.ui("target"), openBoard: () => { if (!this.board.isOpen) this.board.toggle(true); }, boardSpeech: (t) => this.board.setSpeech(t) });
    this.help = new HelpOverlay(r, { onLowRes: (on) => cb.onLowRes(on), getLowRes: () => cb.getLowRes() });
    $(r, "#helpbtn").addEventListener("click", (e) => { this.help.toggle(); (e.currentTarget as HTMLElement).blur(); });

    this.chatIn.addEventListener("focus", () => (this.chatFocused = true));
    this.chatIn.addEventListener("blur", () => (this.chatFocused = false));
    this.chatIn.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") {
        const text = this.chatIn.value.trim();
        this.chatIn.value = "";
        this.chatIn.blur();
        if (text) this.cb.onChat(text);
      } else if (e.key === "Escape") { this.chatIn.blur(); }
    });
    this.chatIn.addEventListener("keyup", (e) => e.stopPropagation());
    $(r, "#connbtn").addEventListener("click", () => this.cb.onReconnect());
    this.muteBtn = $(r, "#mutebtn"); this.vol = $(r, "#vol") as HTMLInputElement;
    let v0 = 0.7;
    try { v0 = parseFloat(localStorage.getItem("jz.vol") ?? "0.7"); } catch { /* ignore */ }
    this.vol.value = String(Math.round((isFinite(v0) ? v0 : 0.7) * 100));
    this.vol.addEventListener("input", () => {
      const v = parseInt(this.vol.value, 10) / 100;
      audio.setMasterVolume(v);
      if (v > 0 && audio.isMuted()) this.setMuted(false);
      try { localStorage.setItem("jz.vol", String(v)); } catch { /* ignore */ }
    });
    this.vol.addEventListener("keydown", (e) => e.stopPropagation());
    this.vol.addEventListener("pointerup", () => this.vol.blur());
    this.muteBtn.addEventListener("click", () => { this.setMuted(!audio.isMuted()); this.muteBtn.blur(); });
    this.refreshMute();
  }

  destroy() { window.clearTimeout(this.toastTimer); window.clearTimeout(this.hurtTimer); window.clearTimeout(this.warnTimer); this.root.innerHTML = ""; this.plates.clear(); this.floats = []; this.slots = []; }

  focusChat() { this.chatIn.focus(); }

  setMuted(m: boolean) {
    audio.setMuted(m);
    try { localStorage.setItem("jz.mute", m ? "1" : "0"); } catch { /* ignore */ }
    this.refreshMute();
  }
  toggleMute() { this.setMuted(!audio.isMuted()); }
  private refreshMute() {
    const m = audio.isMuted();
    this.muteBtn.textContent = "♪";
    this.muteBtn.classList.toggle("off", m);
    this.muteBtn.title = m ? "Unmute (M)" : "Mute (M)";
  }

  // ---------- setup ----------
  setZone(z: ZoneInfo) {
    const name = plain(z.name);
    this.zoneLabel.textContent = name;
    $(this.zone, ".big").textContent = name;
    this.zone.classList.remove("show");
    void this.zone.offsetWidth;
    this.zone.classList.add("show");
  }

  setSkills(skills: SkillDef[], cls: ClassId) {
    this.cls = cls;
    const wrap = $(this.root, "#hotbar .slots");
    wrap.innerHTML = "";
    this.slots = [];
    const sorted = [...skills].sort((a, b) => a.id - b.id);
    for (const sk of sorted) {
      const el = document.createElement("div");
      el.className = `slot cls-${cls}`;
      el.setAttribute("aria-label", `${plain(sk.name)}, cooldown ${sk.cooldown}s`);
      el.addEventListener("pointerenter", () => this.showTip(el, cls, sk));
      el.addEventListener("pointerleave", () => this.tip.classList.remove("show"));
      el.innerHTML = `<div class="seal">${skillIcon(cls, sk.id)}</div><div class="cd"></div><div class="key">${sk.id}</div><div class="sn">${esc(plain(sk.name))}</div>`;
      el.addEventListener("pointerdown", (e) => { e.stopPropagation(); this.cb.onSlot(sk.id); });
      wrap.appendChild(el);
      this.slots.push({ el, cd: $(el, ".cd"), slot: sk.id, ready: 0, dur: sk.cooldown * 1000 });
    }
  }

  private showTip(el: HTMLElement, cls: ClassId, sk: SkillDef) {
    this.tip.innerHTML = skillTipHtml(cls, sk);
    this.tip.classList.add("show");
    const r = el.getBoundingClientRect();
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    this.tip.style.left = `${x}px`;
    this.tip.style.top = `${Math.max(8, r.top - h - 14)}px`;
  }

  /** Show a timed self-buff on the player frame (inferred from the cast skill; the protocol has no buff event). */
  addBuff(cls: ClassId, slot: number) {
    const b = slot === 4 ? BUFFS[cls] : undefined;
    if (!b) return;
    this.buffs = this.buffs.filter((x) => { if (x.el.dataset.n === b.name) { x.el.remove(); return false; } return true; });
    const el = document.createElement("div");
    el.className = "buff";
    el.dataset.n = b.name;
    el.title = b.name;
    el.innerHTML = `<div class="g">${icon(b.icon)}</div><div class="t"></div><div class="n">${b.name}</div>`;
    this.buffsEl.appendChild(el);
    this.buffs.push({ el, end: performance.now() + b.ms, dur: b.ms });
  }
  clearBuffs() { for (const b of this.buffs) b.el.remove(); this.buffs = []; }

  toast(msg: string, ms = 5000) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add("show");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("show"), ms);
  }

  startCooldown(slot: number, ms: number) {
    const s = this.slots.find((x) => x.slot === slot);
    if (!s) return;
    s.dur = ms;
    s.ready = performance.now() + ms;
    s.el.classList.remove("flash");
    void s.el.offsetWidth;
    s.el.classList.add("flash");
    this.qi = Math.max(0, this.qi - 10);
  }
  cooldownLeft(slot: number): number {
    const s = this.slots.find((x) => x.slot === slot);
    return s ? Math.max(0, s.ready - performance.now()) : 0;
  }

  // ---------- events ----------
  addChat(from: string, text: string, sys: boolean, mine: boolean) {
    const ln = document.createElement("div");
    ln.className = "ln" + (sys ? " sys" : "") + (mine ? " me" : "");
    // text nodes only: chat is untrusted input and must never be parsed as HTML
    if (sys) ln.textContent = text;
    else {
      const b = document.createElement("b");
      b.textContent = `${from}:`;
      ln.append(b, document.createTextNode(` ${text}`));
    }
    const atBottom = this.chatLog.scrollTop + this.chatLog.clientHeight >= this.chatLog.scrollHeight - 24;
    this.chatLog.appendChild(ln);
    while (this.chatLog.children.length > 120) this.chatLog.firstChild?.remove();
    if (atBottom) this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  addLoot(html: string, cls = "") {
    const ln = document.createElement("div");
    ln.className = "ll " + cls;
    ln.innerHTML = html;
    this.loot.appendChild(ln);
    window.setTimeout(() => ln.remove(), 6000);
    while (this.loot.children.length > 5) this.loot.firstChild?.remove();
  }
  /** Loot toast: item seal glyph + bilingual name; stacks up to 5 entries. */
  lootLine(item: string, qty: number) {
    this.addLoot(`<span class="lseal">${itemIcon(item)}</span><span>Obtained <em>${esc(plain(item))}</em>${qty > 1 ? ` ×${qty}` : ""}</span>`, "item");
  }

  /** Big on-screen warning, e.g. a boss wind-up. */
  warn(big: string, sub: string, ms = 2200) {
    const same = this.warnEl.classList.contains("show") && $(this.warnEl, ".big").textContent === big && $(this.warnEl, ".sub").textContent === sub;
    if (!same) {
      $(this.warnEl, ".big").textContent = big;
      $(this.warnEl, ".sub").textContent = sub;
      this.warnEl.classList.remove("show");
      void this.warnEl.offsetWidth;
      this.warnEl.classList.add("show");
    } // a burst of identical telegraphs (scatter pattern) keeps the one banner instead of restarting it
    window.clearTimeout(this.warnTimer);
    this.warnTimer = window.setTimeout(() => this.warnEl.classList.remove("show"), ms);
  }
  xpLine(amount: number) { this.addLoot(`+${amount} experience`, "xp"); }

  setXp(xp: number, next: number, lv: number) {
    const maxed = !(next > 0); // at the level cap the server sends next:0
    const f = maxed ? 1 : Math.max(0, Math.min(1, xp / next));
    this.xpI.style.transform = `scaleX(${f})`;
    this.xpI.parentElement?.classList.toggle("max", maxed);
    this.xpL.textContent = maxed ? `Lv ${lv} · MAX` : `Lv ${lv} · ${xp} / ${next} XP`;
  }

  xpState() { return { text: this.xpL.textContent ?? "", max: !!this.xpI.parentElement?.classList.contains("max"), fill: parseFloat((this.xpI.style.transform.match(/scaleX\(([^)]*)\)/) ?? [])[1] ?? "0") || 0 }; }

  levelUp(lv: number) {
    $(this.lvl, ".s").textContent = lv >= 20 ? `You have reached level ${lv} - the highest level` : `You have reached level ${lv}`;
    this.lvl.classList.remove("show");
    void this.lvl.offsetWidth;
    this.lvl.classList.add("show");
  }

  float(pos: THREE.Vector3, text: string, kind: "dmg" | "crit" | "heal" | "taken" | "xp") {
    const el = document.createElement("div");
    el.className = "fl " + (kind === "dmg" ? "" : kind);
    el.innerHTML = kind === "crit" ? `${SPLASH}<span class="num">${esc(text)}</span><small>CRIT</small>` : esc(text);
    this.root.appendChild(el);
    this.floats.push({ el, pos: pos.clone(), age: 0, life: kind === "crit" ? 1.5 : 1.1, dx: (Math.random() - 0.5) * 40 });
  }

  flashHurt() {
    this.hurt.classList.add("on");
    window.clearTimeout(this.hurtTimer);
    this.hurtTimer = window.setTimeout(() => this.hurt.classList.remove("on"), 70);
  }

  /** Connection overlay. `busy` shows the spinner; `btn` is the escape-hatch button label (null hides it). */
  showConnection(title: string, msg: string, opts: { busy?: boolean; btn?: string | null } = {}) {
    this.connTitle.textContent = title;
    this.connMsg.textContent = msg;
    this.conn.classList.toggle("busy", !!opts.busy);
    this.connBtn.style.display = opts.btn === null ? "none" : "";
    if (opts.btn) this.connBtn.textContent = opts.btn;
    this.conn.classList.add("show");
  }
  hideConnection() { this.conn.classList.remove("show"); }

  /** Clear per-session widgets after a re-login (the entities themselves are cleared by the game). */
  resetSession() {
    this.clearBuffs();
    this.dialog.close();
    this.quest.reset();
    for (const p of this.plates.values()) p.el.remove();
    this.plates.clear();
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    this.lastTargetId = -1;
    this.deathAt = -1;
    this.qi = 100;
    this.bag.reset();
    this.wallet.reset();
    this.board.reset();
    this.boss.classList.remove("show");
    this.warnEl.classList.remove("show");
  }

  // ---------- per-frame ----------
  frame(a: {
    dt: number;
    camera: THREE.PerspectiveCamera;
    camYaw: number;
    ents: HudEnt[];
    me: HudEnt | null;
    target: HudEnt | null;
    interact?: HudEnt | null;
    boss?: HudEnt | null;
    dangers?: Array<{ x: number; z: number; radius: number; frac: number }>;
    fps: number;
    ping: number;
    nowMs: number;
  }) {
    const { camera, me, target } = a;
    const W = window.innerWidth, H = window.innerHeight;

    // player frame
    if (me) {
      this.pName.textContent = plain(me.s.n);
      this.pCls.textContent = me.s.cls ? CLASS_INFO[me.s.cls].en : "";
      this.pLv.textContent = `Lv ${me.s.lv}`;
      this.pHp.style.transform = `scaleX(${Math.max(0, me.s.hp / Math.max(1, me.s.mhp))})`;
      this.pHpT.textContent = `${Math.max(0, Math.ceil(me.s.hp))} / ${me.s.mhp}`;
    }
    this.qi = Math.min(100, this.qi + a.dt * 6);
    this.pQi.style.transform = `scaleX(${this.qi / 100})`;

    // target frame
    if (target) {
      this.tFrame.classList.remove("hidden");
      if (this.lastTargetId !== target.id) {
        this.tName.textContent = plain(target.s.n);
        this.lastTargetId = target.id;
      }
      this.tLv.textContent = target.s.k === "npc" ? "NPC" : `Lv ${target.s.lv}`;
      this.tHp.style.transform = `scaleX(${Math.max(0, target.s.hp / Math.max(1, target.s.mhp))})`;
      this.tHpT.textContent = target.s.k === "npc" ? "" : `${Math.max(0, Math.ceil(target.s.hp))} / ${target.s.mhp}`;
      this.tFrame.classList.toggle("npc", target.s.k === "npc");
    } else {
      this.tFrame.classList.add("hidden");
      this.lastTargetId = -1;
    }

    // cooldowns
    for (const s of this.slots) {
      const left = s.ready - a.nowMs;
      if (left > 0) {
        s.cd.style.setProperty("--p", String(Math.min(1, left / Math.max(1, s.dur))));
        s.cd.textContent = left > 1000 ? String(Math.ceil(left / 1000)) : (left / 1000).toFixed(1);
      } else if (s.cd.textContent) { s.cd.textContent = ""; s.cd.style.setProperty("--p", "0"); }
    }

    // nameplates
    const seen = new Set<number>();
    for (const e of a.ents) {
      seen.add(e.id);
      let p = this.plates.get(e.id);
      const key = `${e.s.n}|${e.s.lv}|${e.s.k}|${me?.s.lv ?? 0}`;
      if (!p) {
        const el = document.createElement("div");
        el.innerHTML = `<div class="t"></div><div class="b"><i></i></div>`;
        p = { el, t: $(el, ".t"), bar: $(el, ".b i"), key: "", deadAt: -1 };
        this.root.appendChild(el);
        this.plates.set(e.id, p);
      }
      if (p.key !== key) {
        p.key = key;
        p.t.textContent = e.s.k === "mob" ? `${me && e.s.lv - me.s.lv >= 5 ? "☠ " : ""}Lv${e.s.lv} ${plain(e.s.n)}` : plain(e.s.n);
        p.el.className = `np ${e.s.k}${e.s.k === "mob" && me ? " " + threat(e.s.lv - me.s.lv) : ""}`;
        const barBox = p.el.querySelector(".b") as HTMLElement;
        barBox.style.display = e.s.k === "npc" || e.id === me?.id ? "none" : "";
      }
      const isT = !!target && target.id === e.id;
      p.el.classList.toggle("target", isT);
      p.el.classList.toggle("dead", e.dead);
      if (e.dead) { if (p.deadAt < 0) p.deadAt = a.nowMs; } else p.deadAt = -1;
      if (p.deadAt >= 0 && a.nowMs - p.deadAt > 1200) { p.el.style.display = "none"; continue; }
      p.el.classList.toggle("me", e.id === me?.id);
      this.v.set(e.x, e.y + this.headHeight(e), e.z).project(camera);
      const dist = camera.position.distanceTo(new THREE.Vector3(e.x, e.y, e.z));
      if (this.v.z > 1 || this.v.z < -1 || dist > 55 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) {
        p.el.style.display = "none";
        continue;
      }
      p.el.style.display = "";
      if (p.bar) p.bar.style.transform = `scaleX(${Math.max(0, e.s.hp / Math.max(1, e.s.mhp))})`;
      p.el.style.transform = `translate(${((this.v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-this.v.y * 0.5 + 0.5) * H - 4).toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, p] of this.plates) if (!seen.has(id)) { p.el.remove(); this.plates.delete(id); }

    // floating numbers
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.age += a.dt;
      if (f.age >= f.life) { f.el.remove(); this.floats.splice(i, 1); continue; }
      const u = f.age / f.life;
      this.v.copy(f.pos);
      this.v.y += u * 1.6;
      this.v.project(camera);
      if (this.v.z > 1) { f.el.style.display = "none"; continue; }
      f.el.style.display = "";
      const sc = u < 0.12 ? 0.6 + (u / 0.12) * 0.7 : 1.3 - Math.min(0.3, (u - 0.12) * 0.4);
      f.el.style.opacity = String(u > 0.65 ? 1 - (u - 0.65) / 0.35 : 1);
      f.el.style.transform = `translate(${((this.v.x * 0.5 + 0.5) * W + f.dx * u).toFixed(1)}px, ${((-this.v.y * 0.5 + 0.5) * H).toFixed(1)}px) translate(-50%, -50%) scale(${sc.toFixed(2)})`;
    }

    // death overlay
    const dead = !!me && me.dead;
    if (dead) {
      if (this.deathAt < 0) this.deathAt = a.nowMs;
      const left = Math.max(0, 5 - (a.nowMs - this.deathAt) / 1000);
      this.deathCd.textContent = left > 0 ? `Returning to the spawn plaza in ${Math.ceil(left)}…` : "Awaiting the spirits…";
      this.death.classList.add("show");
    } else {
      this.deathAt = -1;
      this.death.classList.remove("show");
    }

    // buffs
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      const b = this.buffs[i];
      const left = b.end - a.nowMs;
      if (left <= 0) { b.el.remove(); this.buffs.splice(i, 1); continue; }
      (b.el.querySelector(".t") as HTMLElement).textContent = `${Math.ceil(left / 1000)}s`;
      b.el.style.setProperty("--p", String(left / b.dur));
    }

    // interact prompt
    const it = a.interact;
    if (it && !this.dialog.isOpen && !dead) {
      this.v.set(it.x, it.y + this.headHeight(it), it.z).project(camera);
      if (this.v.z < 1 && Math.abs(this.v.x) < 1.05 && Math.abs(this.v.y) < 1.05) {
        this.prompt.style.display = "block";
        // sit clearly above the NPC's own nameplate (plate text is ~18 px tall)
        this.prompt.style.transform = `translate(${((this.v.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-this.v.y * 0.5 + 0.5) * H - 30).toFixed(1)}px) translate(-50%, -100%)`;
      } else {
        // NPC head is off-screen (camera close or turned away): keep the prompt reachable above the hotbar
        this.prompt.style.display = "block";
        this.prompt.style.transform = `translate(${(W / 2).toFixed(1)}px, ${(H - 150).toFixed(1)}px) translate(-50%, -100%)`;
      }
    } else this.prompt.style.display = "none";

    // minimap
    if (me) {
      this.minimap.draw(me, a.camYaw, a.ents.filter((e) => e.id !== me.id).map((e) => ({ x: e.x, z: e.z, k: e.s.k, dead: e.dead, mob: e.s.mob })), a.dangers ?? []);
    }

    // boss bar
    const bs = a.boss;
    if (bs && !bs.dead && bs.s.hp > 0) {
      const f = Math.max(0, Math.min(1, bs.s.hp / Math.max(1, bs.s.mhp)));
      const k = `${bs.s.n}|${bs.s.lv}`;
      if (k !== this.bossKey) { this.bossKey = k; this.bossName.innerHTML = `<span class="brush">${esc(plain(bs.s.n))}</span> <small>Lv ${bs.s.lv}</small>`; }
      this.bossHp.style.transform = `scaleX(${f})`;
      this.bossT.textContent = `${Math.ceil(bs.s.hp)} / ${bs.s.mhp}${f <= 0.5 ? "  ·  Enraged" : ""}`;
      this.boss.classList.toggle("phase2", f <= 0.5);
      this.boss.classList.add("show");
    } else this.boss.classList.remove("show");

    this.perf.textContent = `Ping ${Math.round(a.ping)} ms · ${Math.round(a.fps)} FPS`;
  }

  private headHeight(e: HudEnt): number {
    return e.h + 0.35;
  }
}
