import { esc, plain } from "./glyphs";
import { icon, type IconName } from "./icons";

export const TALK_RANGE = 14;     // client-side gate; the server allows 16 for Elder Lin
export const PROMPT_RANGE = 12;   // "F — Speak" prompt radius

export interface NpcRef { id: number; name: string }

/** Flavour dialog for NPCs the server gives no script for. */
const FLAVOR: Array<{ match: RegExp; icon: IconName; role: string; lines: string[] }> = [
  {
    match: /Notice Board Keeper Fen|\bFen\b/i, icon: "board", role: "Keeper of the Notice Board", lines: [
      "Fresh notices go up at midnight, UTC. Finish a task, then claim your reward at the board.",
    ],
  },
  {
    match: /Mei/i, icon: "lantern", role: "Keeper of Lanterns", lines: [
      "The lanterns burn all night, traveller. No one walks lost while a flame is lit.",
      "I trim every wick by hand. When the valley mist rolls in, these little flames are the only road home.",
    ],
  },
  {
    match: /Wu|Gate Warden/i, icon: "gate", role: "Warden of the Gate", lines: [
      "Halt \u2014 ah, a cultivator. Pass freely.",
      "Past the pond the bamboo spirits stir, and farther on lie the fox hills. Keep your guard up.",
    ],
  },
  { match: /Elder Lin/i, icon: "elder", role: "Elder of the Valley", lines: ["Peace be with you, young cultivator."] },
];
const GENERIC = ["Greetings, traveller.", "The Nine Provinces are wide; walk carefully."];

interface View {
  title: string; role: string; seal: IconName;
  pages: string[]; page: number;
  notes: string[];
  mode: "talk" | "far" | "wait";
  primary: string;
  dist: number;
}

/** Paper-scroll NPC dialog. Quest NPCs speak through the server (`/talk` -> sys chat); others use local flavour text. */
export class NpcDialog {
  private el: HTMLElement;
  private npc: NpcRef | null = null;
  private v: View = { title: "", role: "", seal: "lotus", pages: [], page: 0, notes: [], mode: "talk", primary: "", dist: 0 };
  private capturing = false;
  private captureUntil = 0;
  private fallback = false;
  private waitTimer = 0;
  private acceptedSeen = false;
  private lastRenderKey = "";

  constructor(root: HTMLElement, private cb: { talk(who: "elder" | "mei" | "fen"): void; onOpenSound(): void; openBoard(): void; boardSpeech(text: string): void }) {
    this.el = document.createElement("div");
    this.el.id = "dialog";
    this.el.className = "panel";
    root.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b || b.disabled) return;
      const a = b.dataset.a;
      if (a === "close") this.close();
      else if (a === "next") { this.v.page = Math.min(this.v.pages.length - 1, this.v.page + 1); this.render(true); }
      else if (a === "speak") this.begin();
    });
  }

  get isOpen() { return this.el.classList.contains("show"); }
  get npcId() { return this.npc?.id ?? -1; }
  /** True while the NPC is a server-driven quest giver (Elder Lin's chain, Lantern Keeper Mei's errand). */
  private get isQuestNpc() { return !!this.npc && /Elder Lin|Lantern Keeper Mei/i.test(this.npc.name); }
  /** Notice Board Keeper Fen: talking opens the daily board instead of a dialog scroll. */
  private get isBoardNpc() { return !!this.npc && /Notice Board Keeper Fen|\bFen\b/i.test(plain(this.npc.name)); }

  open(npc: NpcRef, dist: number) {
    const en = plain(npc.name);
    this.npc = npc;
    const fl = FLAVOR.find((f) => f.match.test(en));
    this.v = {
      title: en, role: fl?.role ?? "Traveller", seal: fl?.icon ?? "lotus",
      pages: [], page: 0, notes: [], mode: "far", primary: "", dist,
    };
    this.acceptedSeen = false;
    if (!(this.isBoardNpc && dist <= TALK_RANGE)) this.el.classList.add("show"); // Fen in reach goes straight to the board
    this.cb.onOpenSound();
    if (dist <= TALK_RANGE) this.begin(); else { this.v.mode = "far"; this.render(true); }
  }

  /** Called every frame while open. */
  update(dist: number) {
    if (!this.isOpen || !this.npc) return;
    this.v.dist = dist;
    if (dist > TALK_RANGE + 8) { this.close(); return; }
    if (this.v.mode === "far" && dist <= TALK_RANGE) this.begin();
    else if (this.v.mode === "far") this.render(false);
  }

  private begin() {
    const npc = this.npc;
    if (!npc) return;
    const v = this.v;
    v.mode = "talk"; v.pages = []; v.page = 0; v.notes = [];
    this.acceptedSeen = false;
    if (this.isBoardNpc) {
      // Fen has no scroll of his own: ask the server (the reply lands on the board) and open the Notice Board.
      this.capturing = true;
      this.fallback = false;
      this.captureUntil = performance.now() + 20000; // a slow link may answer late
      this.el.classList.remove("show");
      this.lastRenderKey = "";
      this.cb.talk("fen");
      this.cb.openBoard();
      return;
    }
    if (this.isQuestNpc) {
      v.mode = "wait"; v.primary = "";
      this.capturing = true;
      this.fallback = false;
      this.captureUntil = performance.now() + 20000; // a slow link may answer late; late replies replace the placeholder
      this.cb.talk(/Mei/i.test(npc.name) ? "mei" : "elder");
      window.clearTimeout(this.waitTimer);
      this.waitTimer = window.setTimeout(() => this.settle(), 4000);
    } else {
      const fl = FLAVOR.find((f) => f.match.test(plain(npc.name)));
      v.pages = fl ? fl.lines : GENERIC;
      v.primary = "Farewell";
    }
    this.render(true);
  }

  /** The reply window closed: pick the primary button, or fall back if the server said nothing. */
  private settle() {
    const v = this.v;
    if (!this.isOpen || v.mode !== "wait") return;
    v.mode = "talk";
    if (!v.pages.length) {
      this.fallback = true;
      v.pages = [/Mei/i.test(this.npc?.name ?? "") ? "(Mei trims a wick and says nothing.)" : "(Elder Lin regards you in silence.)"];
      v.notes.push("The elder gave no reply — try again in a moment.");
    }
    v.primary = this.acceptedSeen ? "Accept" : "Understood";
    this.render(true);
  }

  /** Feed every sys chat line here. `isQuestLine` = the quest tracker recognised it. Returns true if the dialog consumed it as speech. */
  onSys(raw: string, isQuestLine: boolean): boolean {
    const text = plain(raw);
    if (!this.capturing || !this.npc) return false;
    if (performance.now() > this.captureUntil) { this.capturing = false; return false; }
    const en = plain(this.npc.name);
    if (this.isBoardNpc) {
      const fm = new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^:]{0,12}:\\s*(.+)$`, "i").exec(text);
      if (fm && !/too far away/i.test(fm[1])) { this.cb.boardSpeech(fm[1]); this.capturing = false; return true; }
      return false;
    }
    const sp = new RegExp(`^${en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^:]{0,12}:\\s*(.+)$`, "i").exec(plain(text));
    if (sp && /type \/talk/i.test(sp[1])) return false; // proximity hint, not a reply to our /talk
    if (sp || isQuestLine) this.dropFallback();
    if (sp) {
      this.v.pages.push(sp[1]);
      this.finishSoon();
      this.render(true);
      return true;
    }
    if (/^Task (accepted|progress|complete):/i.test(text)) { // Lantern Keeper Mei's errand (not part of the tracked chain)
      if (/^Task accepted/i.test(text)) this.acceptedSeen = true;
      this.v.notes.push(text.replace(/^Task accepted:\s*/i, "Accepted: ").replace(/^Task (progress|complete):\s*/i, ""));
      this.finishSoon();
      this.render(true);
      return false;
    }
    if (isQuestLine) {
      if (/^Quest accepted/i.test(text)) this.acceptedSeen = true;
      this.v.notes.push(text.replace(/^Quest accepted:\s*/i, "Accepted: "));
      this.finishSoon();
      this.render(true);
    } else if (/No one is close enough/i.test(text)) {
      this.v.notes.push("Too far away to speak.");
      this.finishSoon();
      this.render(true);
    }
    return false;
  }

  /** A late server reply replaces the "no reply" placeholder. */
  private dropFallback() {
    if (!this.fallback) return;
    this.fallback = false;
    this.v.pages = []; this.v.notes = []; this.v.page = 0; this.v.mode = "wait"; this.acceptedSeen = false;
  }

  private finishSoon() {
    window.clearTimeout(this.waitTimer);
    this.waitTimer = window.setTimeout(() => this.settle(), 450);
  }

  close() {
    window.clearTimeout(this.waitTimer);
    this.capturing = false;
    this.el.classList.remove("show");
    this.npc = null;
    this.lastRenderKey = "";
  }

  private render(force: boolean) {
    const v = this.v;
    const key = `${v.mode}|${v.page}|${v.pages.length}|${v.notes.length}|${v.primary}|${v.mode === "far" ? v.dist.toFixed(1) : ""}`;
    if (!force && key === this.lastRenderKey) return;
    this.lastRenderKey = key;
    const head = `<div class="dh"><div class="dseal">${icon(v.seal)}</div><div class="dtt"><div class="dzh">${esc(v.title)}</div><div class="den">${esc(v.role)}</div></div></div>`;
    let body = "", btns = "";
    if (v.mode === "far") {
      body = `<div class="dsp far"><b>Walk closer</b><br><small>${v.dist.toFixed(1)} units away — come within ${TALK_RANGE} to speak.</small></div>`;
      btns = `<button class="btn sm" data-a="speak" disabled>Speak</button><button class="btn sm ghost" data-a="close">Close</button>`;
    } else if (v.mode === "wait") {
      body = `<div class="dsp wait">…</div>`;
      btns = `<button class="btn sm ghost" data-a="close">Close</button>`;
    } else {
      const last = v.page >= v.pages.length - 1;
      body = `<div class="dsp">${esc(v.pages[v.page] ?? "")}</div>`;
      if (v.pages.length > 1) body += `<div class="dpg">${v.page + 1} / ${v.pages.length}</div>`;
      if (last && v.notes.length) body += `<div class="dnotes">${v.notes.map((n) => `<div>${esc(n)}</div>`).join("")}</div>`;
      btns = last
        ? `<button class="btn sm" data-a="close">${esc(v.primary || "Understood")}</button><button class="btn sm ghost" data-a="close">Close</button>`
        : `<button class="btn sm" data-a="next">Continue</button><button class="btn sm ghost" data-a="close">Close</button>`;
    }
    this.el.innerHTML = `<div class="rodt"></div>${head}${body}<div class="dbt">${btns}</div><div class="rodb"></div>`;
  }
}
