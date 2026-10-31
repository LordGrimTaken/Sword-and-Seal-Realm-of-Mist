import * as THREE from "three";
import { realmForLevel } from "@shared/protocol";
import type { ClassId, EntityState, SkillDef, ZoneInfo } from "@shared/protocol";
import { CLASS_INFO, esc, plain } from "./glyphs";
import { icon, skillIcon, itemIcon } from "./icons";
import { Minimap, type DangerMark } from "./minimap";
import { audio } from "../audio/instance";
import { QuestTracker, type QuestEvent } from "./quest";
import { NpcDialog } from "./dialog";
import { Bag } from "./bag";
import { HelpOverlay } from "./help";
import { Wallet } from "./wallet";
import { Board } from "./board";
import { skillTipHtml, BUFFS } from "./skilltips";
import { settings } from "./settings";
import { WorldMap } from "./worldmap";

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
  /** Version chip / help "What's new": open the client-side patch-notes window (wired by main.ts). */
  onPatchNotes?(): void;
}

interface Plate { el: HTMLDivElement; t: HTMLDivElement; bar: HTMLElement | null; key: string; deadAt: number }
interface Float { el: HTMLDivElement; pos: THREE.Vector3; age: number; life: number; dx: number }

/** Nameplate colour class from mob level minus player level. */
function threat(diff: number): string {
  return diff <= -3 ? "lv-low" : diff <= 1 ? "lv-even" : diff <= 4 ? "lv-hard" : "lv-deadly";
}

/** Vermilion ink-splash behind critical hits. */
const SPLASH = `<svg class="splash" viewBox="-60 -40 120 80" aria-hidden="true"><path d="M-6-34l5 14 13-12-3 16 20-8-12 13 22 2-20 8 16 10-20-1 6 14-14-9-4 14-6-14-14 10 3-15-22 3 17-9-18-9 21-1-9-13 17 6z" fill="#c8372d" opacity=".82"/><circle cx="-42" cy="-12" r="3.2" fill="#c8372d" opacity=".8"/><circle cx="44" cy="14" r="2.6" fill="#c8372d" opacity=".8"/><circle cx="-34" cy="24" r="2" fill="#c8372d" opacity=".7"/><circle cx="38" cy="-24" r="2.2" fill="#c8372d" opacity=".7"/></svg>`;

// mirrors QI in server/src/data.ts
const DODGE_COST = 15, DODGE_CD = 1.5, DODGE_DIST = 6, DODGE_IFRAMES = 0.25;

// mirrors the Mist Surge announcements in server/src/game/world.ts (the banner keys off the system chat lines)
const SURGE_START = /^The mist surges! Mobs deal \+(\d+)% damage for (?:another )?(\d+) s\.$/;
const SURGE_END = /^The mist recedes\./;

// mirrors the Lantern Tide announcements in server/src/game/world.ts (the gold banner keys off these system chat lines)
const TIDE_START = /^The lantern tide rises! Slain mobs give \+(\d+)% coin and \+(\d+)% XP for (?:another )?(\d+) s\.$/;
const TIDE_END = /^The lantern tide ebbs\./;

// mirrors the Market Day announcements in server/src/game/world.ts (the paper-red banner keys off these system chat lines)
const MARKET_START = /^The market day opens! Peddler Hao pays \+(\d+)% for goods and sells at -(\d+)% for (?:another )?(\d+) s\.$/;
const MARKET_END = /^The market day closes\./;

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export class Hud {
  readonly root: HTMLElement;
  chatFocused = false;
  private cb: HudCallbacks;
  private minimap: Minimap;
  private plates = new Map<number, Plate>();
  private floats: Float[] = [];
  private slots: Array<{ el: HTMLElement; cd: HTMLElement; slot: number; ready: number; dur: number; cost: number; wasCd?: boolean }> = [];
  private cls: ClassId = "sword";
  private v = new THREE.Vector3();
  private lastTargetId = -1;
  private deathAt = -1;
  private hurtTimer = 0;
  private qi = 100;
  private mqi = 100;
  private qiShown = -1;
  readonly quest: QuestTracker;
  readonly dialog: NpcDialog;
  readonly help: HelpOverlay;
  readonly bag: Bag;
  readonly wallet: Wallet;
  readonly board: Board;
  readonly map: WorldMap;
  private boardBtn!: HTMLElement;
  private chatTab: "all" | "chat" | "sys" = "all";
  private unread = { chat: 0, sys: 0 };
  private tipSlot: { el: HTMLElement; slot: number } | null = null;
  private bossAudio = false;
  private tip!: HTMLElement;
  private buffsEl!: HTMLElement;
  private buffs: Array<{ el: HTMLElement; end: number; dur: number }> = [];
  private prompt!: HTMLElement;
  private toastEl!: HTMLElement;
  private toastTimer = 0;
  /** 0.5.0 Mist Surge banner + when the current surge ends (performance.now() ms; 0 = no surge). */
  private surgeEl!: HTMLElement;
  private surgePct!: HTMLElement;
  private surgeCd!: HTMLElement;
  private surgeEndAt = 0;
  private surgeTxt = "";
  /** 0.5.0 Lantern Tide gold banner + when the current tide ends (performance.now() ms; 0 = no tide). */
  private tideEl!: HTMLElement;
  private tideBonus!: HTMLElement;
  private tideCd!: HTMLElement;
  private tideEndAt = 0;
  private tideTxt = "";
  /** 0.5.0 Market Day paper-red banner + when the current market closes (performance.now() ms; 0 = no market). */
  private marketEl!: HTMLElement;
  private marketBonus!: HTMLElement;
  private marketCd!: HTMLElement;
  private marketEndAt = 0;
  private marketTxt = "";
  private connBtn!: HTMLButtonElement;
  private connTitle!: HTMLElement;
  private bagBtn!: HTMLElement;
  private warnEl!: HTMLElement; private warnTimer = 0;
  private boss!: HTMLElement; private bossName!: HTMLElement; private bossHp!: HTMLElement; private bossT!: HTMLElement; private bossKey = "";

  // cached nodes
  private pName!: HTMLElement; private pCls!: HTMLElement; private pLv!: HTMLElement;
  private pHp!: HTMLElement; private pHpT!: HTMLElement; private pQi!: HTMLElement; private pQiT!: HTMLElement; private pQiBar!: HTMLElement;
  private tFrame!: HTMLElement; private tName!: HTMLElement; private tLv!: HTMLElement; private tHp!: HTMLElement; private tHpT!: HTMLElement; private tBurn!: HTMLElement;
  private xpI!: HTMLElement; private xpL!: HTMLElement; private realmEl!: HTMLElement;
  private chatLog!: HTMLElement; private chatIn!: HTMLInputElement;
  private loot!: HTMLElement; private perf!: HTMLElement;
  private verChip!: HTMLButtonElement;
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
        <div class="bar qi" title="Qi - spent on skills and dodge rolls, regenerates over time"><i data-r="pq"></i><span data-r="pqt"></span></div>
      </div>
      <div id="buffs"></div>
      <div id="tframe" class="panel uf hidden">
        <div class="row"><span class="nm" data-r="tn"></span><span class="lv" data-r="tl"></span></div>
        <div class="bar hp"><i data-r="th"></i><span data-r="tht"></span></div>
        <div data-r="tb" class="burn" hidden style="margin-top:4px;font-size:10.5px;font-weight:700;letter-spacing:1.3px;text-transform:uppercase;color:#c8552f;text-shadow:0 0 6px rgba(255,120,40,.45)"><span style="display:inline-block;width:11px;height:12px;margin-right:5px;vertical-align:-2px">${icon("fire")}</span>Burning</div>
      </div>
      <div id="hotbar" class="panel"><div class="slots"></div><div id="xp"><i></i></div><div id="xplabel"></div><div id="realm" title="Cultivation realm" style="position:absolute;left:14px;bottom:-1px;transform:translateY(100%);font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase;color:var(--gold);background:rgba(26,26,31,.65);padding:0 6px;border-radius:0 0 2px 2px;white-space:nowrap"></div></div>
      <div id="bossbar" class="panel"><div class="bn"></div><div class="bbar"><i></i><b class="mk"></b><b class="mk mk3"></b></div><div class="bt"></div></div>
      <button id="bagbtn" class="panel" type="button" title="Bag (I)" aria-label="Bag"><span class="g">${icon("pouch")}</span><span class="k">I</span><span class="dot"></span></button>
      <button id="boardbtn" class="panel" type="button" title="Notice Board (B)" aria-label="Notice Board"><span class="g">${icon("board")}</span><span class="k">B</span><span class="dot"></span></button>
      <div id="warn" role="alert"><div class="big"></div><div class="sub"></div></div>
      <div id="chat" class="panel" data-tab="all"><div id="chattabs" role="tablist" aria-label="Chat channels"><button type="button" role="tab" data-quiet data-ct="all" aria-selected="true">All</button><button type="button" role="tab" data-quiet data-ct="chat" aria-selected="false">Chat<i class="ud" hidden></i></button><button type="button" role="tab" data-quiet data-ct="sys" aria-selected="false">System<i class="ud" hidden></i></button></div><div id="chatlog" role="log" aria-live="polite" aria-label="Chat and system messages"></div><input id="chatin" maxlength="120" placeholder="Press Enter to speak…" autocomplete="off" aria-label="Chat message" /></div>
      <div id="zonelabel"></div>
      <div id="audioctl" class="panel" title="Sound (M to mute)"><button id="mutebtn" type="button" aria-label="Mute">♪</button><input id="vol" type="range" min="0" max="100" step="5" aria-label="Volume" /><button id="helpbtn" type="button" title="Help and settings (F1)" aria-label="Help">?</button></div>
      <div id="tip"></div>
      <div id="prompt"><kbd>F</kbd> Speak</div>
      <div id="toast" role="status" aria-live="polite"></div>
      <div id="loot" role="status" aria-live="polite"></div>
      <div id="perf"></div>
      <button id="verchip" type="button" title="What's new · patch notes" aria-label="What's new and patch notes"></button>
      <div id="hurt"></div>
      <div id="zone"><div class="big"></div><div class="ln"></div><div class="small">Cloudmist region</div></div>
      <div id="levelup"><div class="g">Level Up</div><div class="s"></div></div>
      <div id="death"><div><div class="big">You Have Fallen</div><div class="rule"></div><div class="cd"></div></div></div>
      <div id="conn"><div class="panel"><h3>Connection Lost</h3><div class="spin"></div><p></p><button class="btn" id="connbtn">Return</button></div></div>
    `;
    this.root.style.display = "block";
    const r = this.root;
    this.pName = $(r, '[data-r="pn"]'); this.pCls = $(r, '[data-r="pc"]'); this.pLv = $(r, '[data-r="pl"]');
    this.pHp = $(r, '[data-r="ph"]'); this.pHpT = $(r, '[data-r="pht"]'); this.pQi = $(r, '[data-r="pq"]'); this.pQiT = $(r, '[data-r="pqt"]'); this.pQiBar = this.pQi.parentElement as HTMLElement;
    this.tFrame = $(r, "#tframe"); this.tName = $(r, '[data-r="tn"]'); this.tLv = $(r, '[data-r="tl"]');
    this.tHp = $(r, '[data-r="th"]'); this.tHpT = $(r, '[data-r="tht"]'); this.tBurn = $(r, '[data-r="tb"]');
    this.xpI = $(r, "#xp i"); this.xpL = $(r, "#xplabel"); this.realmEl = $(r, "#realm");
    this.chatLog = $(r, "#chatlog"); this.chatIn = $(r, "#chatin");
    this.loot = $(r, "#loot"); this.perf = $(r, "#perf");
    // version chip: the label is filled from the bundled release notes by main.ts; clicking opens "What's new"
    this.verChip = $(r, "#verchip") as HTMLButtonElement;
    this.verChip.addEventListener("click", () => { this.verChip.blur(); this.cb.onPatchNotes?.(); });
    this.zone = $(r, "#zone"); this.lvl = $(r, "#levelup"); this.death = $(r, "#death"); this.deathCd = $(r, "#death .cd");
    this.hurt = $(r, "#hurt"); this.conn = $(r, "#conn"); this.connMsg = $(r, "#conn p"); this.zoneLabel = $(r, "#zonelabel");
    this.minimap = new Minimap(r);
    this.boss = $(r, "#bossbar"); this.bossName = $(r, "#bossbar .bn"); this.bossHp = $(r, "#bossbar .bbar i"); this.bossT = $(r, "#bossbar .bt");
    this.warnEl = $(r, "#warn"); this.bagBtn = $(r, "#bagbtn");
    this.bag = new Bag(r, (n) => this.bagBtn.classList.toggle("fresh", n > 0));
    this.bagBtn.addEventListener("click", () => { this.bag.toggle(); this.bagBtn.blur(); });
    this.wallet = new Wallet(r);
    this.map = new WorldMap(r);
    this.minimap.el.title = "World map (N)";
    this.minimap.el.setAttribute("role", "button");
    this.minimap.el.addEventListener("click", () => this.map.toggle());
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
    this.surgeEl = this.buildSurgeBanner();
    this.root.appendChild(this.surgeEl);
    this.tideEl = this.buildTideBanner();
    this.root.appendChild(this.tideEl);
    this.marketEl = this.buildMarketBanner();
    this.root.appendChild(this.marketEl);
    this.connBtn = $(r, "#connbtn") as HTMLButtonElement; this.connTitle = $(r, "#conn h3");
    this.quest = new QuestTracker(r, (e) => {
      if (e.kind === "ready") this.quest.stamp("Complete", "Objective complete");
      else if (e.kind === "completed") this.quest.stamp("Complete", `Quest complete${e.xp ? ` · +${e.xp} XP` : ""}`);
      cb.onQuestEvent?.(e);
    });
    this.dialog = new NpcDialog(r, { talk: (who) => cb.onTalk(who), onOpenSound: () => audio.ui("target"), openBoard: () => { if (!this.board.isOpen) this.board.toggle(true); }, boardSpeech: (t) => this.board.setSpeech(t) });
    this.help = new HelpOverlay(r, { onLowRes: (on) => cb.onLowRes(on), getLowRes: () => cb.getLowRes(), onPatchNotes: () => cb.onPatchNotes?.() });
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
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-ct]")) b.addEventListener("click", () => { this.setChatTab(b.dataset.ct as "all" | "chat" | "sys"); audio.ui("tab"); b.blur(); });
    $(r, "#connbtn").addEventListener("click", () => this.cb.onReconnect());
    this.muteBtn = $(r, "#mutebtn"); this.vol = $(r, "#vol") as HTMLInputElement;
    let v0 = 0.7;
    try { v0 = parseFloat(localStorage.getItem("jz.vol") ?? "0.7"); } catch { /* ignore */ }
    this.vol.value = String(Math.round((isFinite(v0) ? v0 : 0.7) * 100));
    this.vol.value = String(Math.round(settings.get().vol.master * 100));
    this.vol.addEventListener("input", () => {
      const v = parseInt(this.vol.value, 10) / 100;
      settings.set({ vol: { master: v }, ...(v > 0 && audio.isMuted() ? { muted: false } : {}) });
      this.refreshMute();
    });
    this.unsub = settings.onChange((st) => { this.vol.value = String(Math.round(st.vol.master * 100)); this.refreshMute(); });
    // press feedback on the action bar for the keyboard shortcuts as well as the mouse
    const keySlot = (e: KeyboardEvent): number => (e.code === "Space" ? 0 : /^(?:Digit|Numpad)([1-4])$/.test(e.code) ? parseInt(e.code.slice(-1), 10) : -1);
    this.onKeyDn = (e) => { const k = keySlot(e); if (k >= 0 && !e.repeat) this.slots.find((x) => x.slot === k)?.el.classList.add("press"); };
    this.onKeyUp = (e) => { const k = keySlot(e); if (k >= 0) this.slots.find((x) => x.slot === k)?.el.classList.remove("press"); };
    window.addEventListener("keydown", this.onKeyDn); window.addEventListener("keyup", this.onKeyUp);
    this.vol.addEventListener("keydown", (e) => e.stopPropagation());
    this.vol.addEventListener("pointerup", () => this.vol.blur());
    this.muteBtn.addEventListener("click", () => { this.setMuted(!audio.isMuted()); this.muteBtn.blur(); });
    this.refreshMute();
  }

  private unsub: () => void = () => undefined;
  private onKeyDn: (e: KeyboardEvent) => void = () => undefined;
  private onKeyUp: (e: KeyboardEvent) => void = () => undefined;
  destroy() { window.removeEventListener("keydown", this.onKeyDn); window.removeEventListener("keyup", this.onKeyUp); audio.setBoss(false); this.map.dispose(); this.unsub(); window.clearTimeout(this.toastTimer); window.clearTimeout(this.hurtTimer); window.clearTimeout(this.warnTimer); this.root.innerHTML = ""; this.plates.clear(); this.floats = []; this.slots = []; }

  focusChat() { this.chatIn.focus(); }

  /** Fill the version chip from the bundled release notes (main.ts owns the version; clicking the chip opens "What's new"). */
  setVersion(version: string) {
    this.verChip.textContent = `v${version}`;
    this.verChip.title = `What's new in v${version} · patch notes`;
  }

  setMuted(m: boolean) {
    settings.set({ muted: m });
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

  /** Region readout under the banner (e.g. "The Sunken Hall" inside its walls): text only, and only on change. */
  setRegion(name: string) {
    if (this.zoneLabel.textContent !== name) this.zoneLabel.textContent = name;
  }

  /** One-time region announcement: reuse the zone-entrance banner with a subtitle. */
  announceRegion(name: string, sub: string) {
    $(this.zone, ".big").textContent = name;
    $(this.zone, ".small").textContent = sub;
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
      el.setAttribute("aria-label", `${plain(sk.name)}, key ${sk.id}, cooldown ${sk.cooldown}s${sk.qi ? `, costs ${sk.qi} Qi` : ""}`);
      el.setAttribute("role", "button"); el.tabIndex = 0;
      el.addEventListener("pointerenter", () => this.showTip(el, cls, sk));
      el.addEventListener("pointerleave", () => this.hideTip());
      el.addEventListener("focus", () => this.showTip(el, cls, sk));
      el.addEventListener("blur", () => this.hideTip());
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.stopPropagation(); this.cb.onSlot(sk.id); } });
      el.addEventListener("pointerup", () => el.classList.remove("press"));
      el.addEventListener("pointerleave", () => el.classList.remove("press"));
      el.innerHTML = `<div class="seal">${skillIcon(cls, sk.id)}</div><div class="cd"></div><div class="key">${sk.id}</div>${sk.qi ? `<div class="qc" title="Qi cost">${sk.qi}</div>` : ""}<div class="sn">${esc(plain(sk.name))}</div>`;
      el.addEventListener("pointerdown", (e) => { e.stopPropagation(); el.classList.add("press"); this.cb.onSlot(sk.id); });
      wrap.appendChild(el);
      this.slots.push({ el, cd: $(el, ".cd"), slot: sk.id, ready: 0, dur: sk.cooldown * 1000, cost: sk.qi ?? 0 });
    }
    // slot 0 = the universal dodge roll (Space), shown after a thin ink divider
    const dv = document.createElement("div");
    dv.className = "sep";
    wrap.appendChild(dv);
    const dl = document.createElement("div");
    dl.className = `slot dodge cls-${cls}`;
    dl.setAttribute("aria-label", `Dodge roll, cooldown ${DODGE_CD}s, costs ${DODGE_COST} Qi`);
    dl.addEventListener("pointerenter", () => this.showText(dl, "Dodge Roll", "Space", `Roll ${DODGE_DIST} m in the direction you move. Invulnerable for ${DODGE_IFRAMES}s. Cooldown ${DODGE_CD}s · ${DODGE_COST} Qi`, "Slip out of telegraphed attacks: the roll is a dash with invulnerability frames; a hit that lands during it is negated."));
    dl.addEventListener("pointerleave", () => this.hideTip());
    dl.setAttribute("role", "button"); dl.tabIndex = 0;
    dl.addEventListener("pointerup", () => dl.classList.remove("press"));
    dl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.stopPropagation(); this.cb.onSlot(0); } });
    dl.innerHTML = `<div class="seal">${icon("wind")}</div><div class="cd"></div><div class="key">Space</div><div class="qc" title="Qi cost">${DODGE_COST}</div><div class="sn">Dodge</div>`;
    dl.addEventListener("pointerdown", (e) => { e.stopPropagation(); dl.classList.add("press"); this.cb.onSlot(0); });
    wrap.appendChild(dl);
    this.slots.push({ el: dl, cd: $(dl, ".cd"), slot: 0, ready: 0, dur: DODGE_CD * 1000, cost: DODGE_COST });
  }

  private hideTip() { this.tip.classList.remove("show"); this.tipSlot = null; }

  private showText(el: HTMLElement, name: string, key: string, meta: string, desc: string) {
    this.tipSlot = { el, slot: 0 };
    this.tip.innerHTML = `<div class="tn"><b>${esc(name)}</b><i>${esc(key)}</i></div><div class="tm">${esc(meta)}</div><div class="td">${esc(desc)}</div><div class="tcd"></div>`;
    this.tip.classList.add("show");
    const r = el.getBoundingClientRect();
    const w = this.tip.offsetWidth, h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    this.tip.style.top = `${Math.max(8, r.top - h - 14)}px`;
  }

  private showTip(el: HTMLElement, cls: ClassId, sk: SkillDef) {
    this.tipSlot = { el, slot: sk.id };
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

  // ---------- 0.5.0 Mist Surge ----------
  /** Compact ink-wash strip, top centre: shown only while the repeating Mist Surge event is running. */
  private buildSurgeBanner(): HTMLElement {
    const el = document.createElement("div");
    el.id = "surge";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText = [
      "position:absolute", "left:50%", "top:12px", "transform:translateX(-50%)",
      "display:none", "align-items:center", "gap:10px",
      "padding:5px 14px 6px 11px",
      "background:linear-gradient(180deg, rgba(26,26,31,.92), rgba(26,26,31,.78))",
      "border-left:3px solid var(--vermilion)", "border-radius:2px",
      "outline:1px solid rgba(217,205,176,.32)", "outline-offset:-4px",
      "box-shadow:0 3px 12px rgba(26,26,31,.45)",
      "pointer-events:none", "z-index:11", "white-space:nowrap",
    ].join(";");
    el.innerHTML = `
      <span style="display:block;width:20px;height:20px;flex:none;color:var(--paper);opacity:.95">${icon("wind")}</span>
      <span style="font-family:var(--font-display);font-size:16px;line-height:1;letter-spacing:2px;color:var(--paper);text-shadow:0 1px 2px var(--ink)">Mist Surge</span>
      <span data-r="pct" style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#e8604f">+20% mob damage</span>
      <span data-r="cd" style="min-width:42px;text-align:right;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--paper-dark)"></span>`;
    this.surgePct = el.querySelector('[data-r="pct"]') as HTMLElement;
    this.surgeCd = el.querySelector('[data-r="cd"]') as HTMLElement;
    return el;
  }

  /** Show/hide the banner and (re)start its countdown from the server's remaining seconds. */
  onSurge(active: boolean, endsIn: number, pct = 20) {
    if (!active || !(endsIn > 0)) { this.surgeEndAt = 0; this.surgeEl.style.display = "none"; return; }
    this.surgeEndAt = performance.now() + endsIn * 1000;
    this.surgePct.textContent = `+${pct}% mob damage`;
    this.surgeTxt = "";
    this.surgeEl.style.display = "flex";
  }

  /** Feed a system chat line to the banner (the world announces start/end there; the protocol has no client handler of its own yet). */
  private onSurgeLine(text: string) {
    const start = SURGE_START.exec(text);
    if (start) { this.onSurge(true, Number(start[2]), Number(start[1])); return; }
    if (SURGE_END.test(text)) this.onSurge(false, 0);
  }

  // ---------- 0.5.0 Lantern Tide ----------
  /** Gold lantern strip, top centre below the mist banner: shown only while the repeating Lantern Tide is running. */
  private buildTideBanner(): HTMLElement {
    const el = document.createElement("div");
    el.id = "tide";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText = [
      "position:absolute", "left:50%", "top:50px", "transform:translateX(-50%)",
      "display:none", "align-items:center", "gap:10px",
      "padding:5px 14px 6px 11px",
      "background:linear-gradient(180deg, rgba(38,32,20,.94), rgba(26,22,14,.84))",
      "border-left:3px solid var(--gold)", "border-radius:2px",
      "outline:1px solid rgba(201,162,39,.5)", "outline-offset:-4px",
      "box-shadow:0 0 16px rgba(201,162,39,.32), 0 3px 12px rgba(26,26,31,.45)",
      "pointer-events:none", "z-index:11", "white-space:nowrap",
    ].join(";");
    el.innerHTML = `
      <span style="display:block;width:20px;height:20px;flex:none;color:#f0cf5a;opacity:.97">${icon("lantern")}</span>
      <span style="font-family:var(--font-display);font-size:16px;line-height:1;letter-spacing:2px;color:#f0cf5a;text-shadow:0 0 8px rgba(201,162,39,.55), 0 1px 2px var(--ink)">Lantern Tide</span>
      <span data-r="bonus" style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#ffd98a">+50% coin &middot; +25% XP</span>
      <span data-r="cd" style="min-width:42px;text-align:right;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--paper-dark)"></span>`;
    this.tideBonus = el.querySelector('[data-r="bonus"]') as HTMLElement;
    this.tideCd = el.querySelector('[data-r="cd"]') as HTMLElement;
    return el;
  }

  /** Show/hide the gold tide banner and (re)start its countdown from the server's remaining seconds. */
  onTide(active: boolean, endsIn: number, coinPct = 50, xpPct = 25) {
    if (!active || !(endsIn > 0)) { this.tideEndAt = 0; this.tideEl.style.display = "none"; return; }
    this.tideEndAt = performance.now() + endsIn * 1000;
    this.tideBonus.textContent = `+${coinPct}% coin \u00b7 +${xpPct}% XP`;
    this.tideTxt = "";
    this.tideEl.style.display = "flex";
  }

  /** Feed a system chat line to the gold banner (same announcement fallback as the mist banner). */
  private onTideLine(text: string) {
    const start = TIDE_START.exec(text);
    if (start) { this.onTide(true, Number(start[3]), Number(start[1]), Number(start[2])); return; }
    if (TIDE_END.test(text)) this.onTide(false, 0);
  }

  // ---------- 0.5.0 Market Day ----------
  /** Paper-red merchant strip, top centre below the two event banners: shown only while the market is open. */
  private buildMarketBanner(): HTMLElement {
    const el = document.createElement("div");
    el.id = "market";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.style.cssText = [
      "position:absolute", "left:50%", "top:88px", "transform:translateX(-50%)",
      "display:none", "align-items:center", "gap:10px",
      "padding:5px 14px 6px 11px",
      "background:linear-gradient(180deg, rgba(242,234,216,.97), rgba(226,206,180,.94))",
      "border-left:3px solid var(--vermilion)", "border-radius:2px",
      "outline:1px solid rgba(200,55,45,.45)", "outline-offset:-4px",
      "box-shadow:0 3px 12px rgba(26,26,31,.4), 0 0 14px rgba(200,55,45,.16)",
      "pointer-events:none", "z-index:11", "white-space:nowrap",
    ].join(";");
    el.innerHTML = `
      <span style="display:block;width:20px;height:20px;flex:none;opacity:.95">${icon("coin")}</span>
      <span style="font-family:var(--font-display);font-size:16px;line-height:1;letter-spacing:2px;color:#8e2620;text-shadow:0 1px 0 rgba(255,255,255,.5)">Market Day</span>
      <span data-r="bonus" style="font-size:10.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--vermilion)">+50% sell &middot; -25% buy</span>
      <span data-r="cd" style="min-width:42px;text-align:right;font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;color:#5c4a38"></span>`;
    this.marketBonus = el.querySelector('[data-r="bonus"]') as HTMLElement;
    this.marketCd = el.querySelector('[data-r="cd"]') as HTMLElement;
    return el;
  }

  /** Show/hide the paper-red market banner and (re)start its countdown from the server's remaining seconds. */
  onMarket(active: boolean, endsIn: number, sellPct = 50, buyPct = 25) {
    if (!active || !(endsIn > 0)) { this.marketEndAt = 0; this.marketEl.style.display = "none"; return; }
    this.marketEndAt = performance.now() + endsIn * 1000;
    this.marketBonus.textContent = `+${sellPct}% sell \u00b7 -${buyPct}% buy`;
    this.marketTxt = "";
    this.marketEl.style.display = "flex";
  }

  /** Feed a system chat line to the paper-red banner (same announcement fallback as the other two events). */
  private onMarketLine(text: string) {
    const start = MARKET_START.exec(text);
    if (start) { this.onMarket(true, Number(start[3]), Number(start[1]), Number(start[2])); return; }
    if (MARKET_END.test(text)) this.onMarket(false, 0);
  }

  startCooldown(slot: number, ms: number) {
    const s = this.slots.find((x) => x.slot === slot);
    if (!s) return;
    s.dur = ms;
    s.ready = performance.now() + ms;
    s.el.classList.remove("flash");
    void s.el.offsetWidth;
    s.el.classList.add("flash");
  }
  /** Sync a cooldown with the server (seconds left; used for the dodge roll). Only ever extends the local timer. */
  syncCooldown(slot: number, leftSec: number) {
    const s = this.slots.find((x) => x.slot === slot);
    if (!s || !(leftSec > 0)) return;
    const end = performance.now() + leftSec * 1000;
    if (end > s.ready + 120) { s.ready = end; s.dur = Math.max(s.dur, leftSec * 1000); }
  }
  /** Own Qi as reported by the server (already corrected for casts still in flight). */
  setQi(qi: number, mqi: number) { this.qi = qi; this.mqi = Math.max(1, mqi); }
  get qiNow() { return this.qi; }
  /** Red flash on the Qi bar and the slot when a skill is refused for lack of Qi. */
  qiShort(slot?: number) {
    this.pQiBar.classList.remove("short"); void this.pQiBar.offsetWidth; this.pQiBar.classList.add("short");
    const s = slot != null ? this.slots.find((x) => x.slot === slot) : undefined;
    if (s) { s.el.classList.remove("shake"); void s.el.offsetWidth; s.el.classList.add("shake"); }
  }
  qiState() { return { qi: Math.round(this.qi * 10) / 10, max: this.mqi, text: this.pQiT.textContent ?? "", fill: parseFloat((this.pQi.style.transform.match(/scaleX\(([^)]*)\)/) ?? [])[1] ?? "0") || 0, low: this.pQiBar.classList.contains("low"), slots: this.slots.map((s) => ({ slot: s.slot, cost: s.cost, short: s.el.classList.contains("noqi") })) }; }
  cooldownLeft(slot: number): number {
    const s = this.slots.find((x) => x.slot === slot);
    return s ? Math.max(0, s.ready - performance.now()) : 0;
  }

  // ---------- events ----------
  setChatTab(t: "all" | "chat" | "sys") {
    this.chatTab = t;
    const chat = $(this.root, "#chat");
    chat.dataset.tab = t;
    if (t !== "all") this.unread[t] = 0;
    else { this.unread.chat = 0; this.unread.sys = 0; }
    this.paintTabs();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }
  private paintTabs() {
    for (const b of this.root.querySelectorAll<HTMLElement>("[data-ct]")) {
      const id = b.dataset.ct as "all" | "chat" | "sys";
      b.setAttribute("aria-selected", String(id === this.chatTab));
      const dot = b.querySelector(".ud") as HTMLElement | null;
      if (dot && id !== "all") dot.hidden = this.unread[id] === 0 || this.chatTab === id;
    }
  }
  chatState() { return { tab: this.chatTab, unread: { ...this.unread }, lines: this.chatLog.children.length, visible: [...this.chatLog.children].filter((c) => (c as HTMLElement).offsetParent !== null).length }; }

  addChat(from: string, text: string, sys: boolean, mine: boolean) {
    if (sys) { this.onSurgeLine(text); this.onTideLine(text); this.onMarketLine(text); } // 0.5.0: the world-event banners listen for the start/end announcements
    const ln = document.createElement("div");
    ln.className = "ln" + (sys ? " sys" : "") + (mine ? " me" : "");
    const d = new Date();
    ln.dataset.ts = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; // shown by CSS only (keeps textContent clean)
    if (this.chatTab !== "all" && this.chatTab !== (sys ? "sys" : "chat")) { this.unread[sys ? "sys" : "chat"]++; this.paintTabs(); }
    // text nodes only: chat is untrusted input and must never be parsed as HTML
    if (sys) ln.append(document.createTextNode(text));
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
    // 0.5.0: the cultivation realm sits next to the level/XP readout; it changes on a breakthrough (levels 5/10/15/20).
    const realm = realmForLevel(lv);
    this.realmEl.textContent = realm.name;
    this.realmEl.title = `Cultivation realm: ${realm.name} (+${realm.hpBonus} max HP)`;
  }

  xpState() { return { text: this.xpL.textContent ?? "", max: !!this.xpI.parentElement?.classList.contains("max"), fill: parseFloat((this.xpI.style.transform.match(/scaleX\(([^)]*)\)/) ?? [])[1] ?? "0") || 0 }; }

  levelUp(lv: number) {
    $(this.lvl, ".s").textContent = lv >= 20 ? `You have reached level ${lv} - the highest level` : `You have reached level ${lv}`;
    this.lvl.classList.remove("show");
    void this.lvl.offsetWidth;
    this.lvl.classList.add("show");
  }

  float(pos: THREE.Vector3, text: string, kind: "dmg" | "crit" | "heal" | "taken" | "xp") {
    const o = settings.get().dmg;
    // per-category toggles: dealt = dmg/crit, taken, heal, status = everything else ("Dodged!", XP)
    if (kind === "dmg" || kind === "crit" ? !o.dealt : kind === "taken" ? !o.taken : kind === "heal" ? !o.heal : !o.status) return;
    const el = document.createElement("div");
    el.className = "fl " + (kind === "dmg" ? "" : kind);
    // never colour alone: damage taken carries a minus sign when pattern cues are on
    if (kind === "taken" && document.documentElement.dataset.cues === "1" && /^\d/.test(text)) text = `\u2212${text}`;
    el.innerHTML = kind === "crit" && !o.simpleCrit ? `${SPLASH}<span class="num">${esc(text)}</span><small>CRIT</small>` : kind === "crit" ? `<span class="num">${esc(text)}</span> <small>CRIT</small>` : esc(text);
    this.root.appendChild(el);
    this.floats.push({ el, pos: pos.clone(), age: 0, life: kind === "crit" ? 1.5 : 1.1, dx: (Math.random() - 0.5) * 40 });
  }

  flashHurt() {
    if (settings.get().safeFlash) return;
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
    this.tBurn.hidden = true;
    this.deathAt = -1;
    this.qi = this.mqi = 100; this.qiShown = -1;
    this.bag.reset();
    this.map.reset();
    this.wallet.reset();
    this.board.reset();
    this.boss.classList.remove("show");
    this.warnEl.classList.remove("show");
    this.onSurge(false, 0); // 0.5.0: no stale surge banner from the previous connection
    this.onTide(false, 0);  // 0.5.0: ...and no stale lantern-tide banner either
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
    dangers?: DangerMark[];
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
    this.pQi.style.transform = `scaleX(${Math.max(0, Math.min(1, this.qi / this.mqi))})`;
    const qShown = Math.floor(this.qi);
    if (qShown !== this.qiShown) { this.qiShown = qShown; this.pQiT.textContent = `Qi ${qShown} / ${this.mqi}`; }
    this.pQiBar.classList.toggle("low", this.qi < this.mqi * 0.2);
    for (const s of this.slots) s.el.classList.toggle("noqi", s.cost > 0 && this.qi + 1e-6 < s.cost);

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
      // burn status comes straight off the snapshot flag, so it clears on the next snapshot after the DoT ends
      this.tBurn.hidden = !(target.s.k === "mob" && target.s.burning === true);
    } else {
      this.tFrame.classList.add("hidden");
      this.tBurn.hidden = true;
      this.lastTargetId = -1;
    }

    // cooldowns
    for (const s of this.slots) {
      const left = s.ready - a.nowMs;
      if (left <= 0 && s.wasCd) { // came off cooldown: soft ping and a ring pulse (only for skills with a noticeable cooldown)
        s.wasCd = false;
        if (s.dur >= 2500 && this.deathAt < 0) { audio.ui("ready"); s.el.classList.remove("rdy"); void s.el.offsetWidth; s.el.classList.add("rdy"); }
      }
      if (left > 0) {
        s.wasCd = true;
        s.cd.style.setProperty("--p", String(Math.min(1, left / Math.max(1, s.dur))));
        s.cd.textContent = left > 1000 ? String(Math.ceil(left / 1000)) : (left / 1000).toFixed(1);
      } else if (s.cd.textContent) { s.cd.textContent = ""; s.cd.style.setProperty("--p", "0"); }
    }

    if (this.tipSlot && this.tip.classList.contains("show")) {
      const s = this.slots.find((x) => x.slot === this.tipSlot!.slot);
      const left = s ? Math.max(0, s.ready - a.nowMs) : 0;
      const line = this.tip.querySelector(".tcd") as HTMLElement | null;
      if (line) { const t = left > 0 ? `On cooldown: ${(left / 1000).toFixed(1)} s left` : "Ready"; if (line.textContent !== t) line.textContent = t; line.classList.toggle("ready", left <= 0); }
    }

    // nameplates
    const seen = new Set<number>();
    for (const e of a.ents) {
      seen.add(e.id);
      let p = this.plates.get(e.id);
      const key = `${e.s.n}|${e.s.lv}|${e.s.k}|${me?.s.lv ?? 0}|${e.s.ttl ?? ""}`;
      if (!p) {
        const el = document.createElement("div");
        el.innerHTML = `<div class="t"></div><div class="b"><i></i></div>`;
        p = { el, t: $(el, ".t"), bar: $(el, ".b i"), key: "", deadAt: -1 };
        this.root.appendChild(el);
        this.plates.set(e.id, p);
      }
      if (p.key !== key) {
        p.key = key;
        p.t.textContent = e.s.k === "mob" ? `${me && e.s.lv - me.s.lv >= 5 ? "☠ " : ""}Lv${e.s.lv} ${plain(e.s.n)}` : (e.s.k === "player" && e.s.ttl ? `${plain(e.s.ttl)} ` : "") + plain(e.s.n);
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

    // world map (reveals fog as you walk; draws only while open)
    if (me) this.map.frame(me, a.camYaw, !this.map.isOpen ? [] : a.ents.filter((e) => e.id !== me.id).map((e) => ({ x: e.x, z: e.z, k: e.s.k, dead: e.dead, mob: e.s.mob })));

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
      this.bossT.textContent = `${Math.ceil(bs.s.hp)} / ${bs.s.mhp}${f <= 0.25 ? "  ·  Cracked open" : f <= 0.5 ? "  ·  Enraged" : ""}`;
      this.boss.classList.toggle("phase2", f <= 0.5);
      this.boss.classList.toggle("phase3", f <= 0.25);
      this.boss.classList.add("show");
    } else this.boss.classList.remove("show");
    const bossNow = !!bs && !bs.dead && bs.s.hp > 0;
    if (bossNow !== this.bossAudio) { this.bossAudio = bossNow; audio.setBoss(bossNow); }

    // 0.5.0 Mist Surge / Lantern Tide / Market Day banners: tick the countdowns and self-hide if an end announcement never arrived
    if (this.surgeEndAt > 0) {
      const left = this.surgeEndAt - a.nowMs;
      if (left <= 0) this.onSurge(false, 0);
      else {
        const txt = `${Math.ceil(left / 1000)} s`;
        if (txt !== this.surgeTxt) { this.surgeTxt = txt; this.surgeCd.textContent = txt; }
      }
    }
    if (this.tideEndAt > 0) {
      const left = this.tideEndAt - a.nowMs;
      if (left <= 0) this.onTide(false, 0);
      else {
        const txt = `${Math.ceil(left / 1000)} s`;
        if (txt !== this.tideTxt) { this.tideTxt = txt; this.tideCd.textContent = txt; }
      }
    }
    if (this.marketEndAt > 0) {
      const left = this.marketEndAt - a.nowMs;
      if (left <= 0) this.onMarket(false, 0);
      else {
        const txt = `${Math.ceil(left / 1000)} s`;
        if (txt !== this.marketTxt) { this.marketTxt = txt; this.marketCd.textContent = txt; }
      }
    }

    this.perf.textContent = `Ping ${Math.round(a.ping)} ms · ${Math.round(a.fps)} FPS`;
  }

  private headHeight(e: HudEnt): number {
    return e.h + 0.35;
  }
}
