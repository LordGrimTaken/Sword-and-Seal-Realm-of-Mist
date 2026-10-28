import { esc, plain } from "./glyphs";
import { icon } from "./icons";

/**
 * Quest tracker. The server has no quest message type: everything is `chat` with sys:true, so this module parses the
 * known line formats and degrades gracefully (unrecognised text is simply ignored; kill/loot events act as a fallback).
 *   "[Quest 1/3] Clear Bamboo Spirits: 3/5"          progress
 *   "Quest accepted: [Quest 1/3] ...: 0/5"                    accepted
 *   "[Quest 1/3] ...: 5/5 - objective complete! Return ..."   ready to turn in
 *   "Quest complete: Clear Bamboo Spirits  (+60 XP)"  turned in
 *   "No active quest. ..." / "All of Elder Lin's quests are complete."
 */
export type QStatus = "unknown" | "none" | "active" | "ready" | "alldone";

export interface QuestState {
  status: QStatus;
  stage: number;   // 1-based
  total: number;
  title: string;
  cur: number;
  max: number;
  /** Optional per-objective breakdown the server appends, e.g. "Jade Serpents 2/4, Jade Scales 1/2". */
  detail: string;
}

interface Known { title: string; count: number; kill?: string; loot?: string; where: string }
/** Display fallback only; live numbers always come from the server text. */
const KNOWN: Known[] = [
  { title: "Clear Bamboo Spirits", count: 5, kill: "bamboo_spirit", where: "Bamboo grove, west of the plaza" },
  { title: "Collect Fox Tails", count: 3, loot: "Fox Tail", where: "Fox hills, east of the valley" },
  { title: "Cleanse the Pond", count: 6, kill: "jade_serpent", loot: "Jade Scale", where: "Lotus pond and stone bridge, north of the plaza" },
  { title: "Defeat the Stone Guardian", count: 1, kill: "stone_guardian", where: "Ruined shrine, far to the north" },
];

const RE_PROGRESS = /^(Quest accepted:\s*)?\[Quest\s+(\d+)\s*\/\s*(\d+)\]\s*(.*?):\s*(\d+)\s*\/\s*(\d+)(.*)$/i;
const RE_COMPLETE = /^Quest complete:\s*(.*?)\s*(?:\(\s*\+\s*(\d+)\s*XP\s*\))?\s*$/i;

export type QuestEvent =
  | { kind: "accepted" | "progress" | "ready" | "reset" | "alldone" }
  | { kind: "completed"; title: string; xp: number };

export class QuestTracker {
  state: QuestState = { status: "unknown", stage: 0, total: 4, title: "", cur: 0, max: 0, detail: "" };
  /** Stages already handed in (for the quest log). */
  private doneStages = 0;
  private el: HTMLElement;
  private logEl: HTMLElement;
  private stampEl: HTMLElement;
  private onEvent: (e: QuestEvent) => void;
  private flashTimer = 0;

  constructor(root: HTMLElement, onEvent: (e: QuestEvent) => void = () => {}) {
    this.onEvent = onEvent;
    this.el = document.createElement("div");
    this.el.id = "quest";
    this.el.className = "panel";
    root.appendChild(this.el);
    this.logEl = document.createElement("div");
    this.logEl.id = "qlog";
    this.logEl.className = "panel";
    root.appendChild(this.logEl);
    this.stampEl = document.createElement("div");
    this.stampEl.id = "qstamp";
    root.appendChild(this.stampEl);
    this.render();
  }

  reset() {
    this.state = { status: "unknown", stage: 0, total: 4, title: "", cur: 0, max: 0, detail: "" };
    this.doneStages = 0;
    this.render();
  }

  /** Returns true when the line was a quest message (so callers can treat it as part of a quest exchange). */
  handleSys(text: string): boolean {
    const t = plain(text);
    let m = RE_PROGRESS.exec(t);
    if (m) {
      const accepted = !!m[1];
      const en = m[4].trim();
      const cur = parseInt(m[5], 10), max = parseInt(m[6], 10);
      const tail = m[7] || "";
      const dm = /\(([^()]*\d+\s*\/\s*\d+[^()]*)\)/.exec(tail);
      const s = this.state;
      s.stage = parseInt(m[2], 10); s.total = parseInt(m[3], 10);
      s.title = en; s.cur = Math.min(cur, max); s.max = max; s.detail = dm ? dm[1].trim() : "";
      this.doneStages = Math.max(this.doneStages, s.stage - 1);
      const ready = /complete/i.test(tail.replace(/\([^()]*\)/g, "")) || cur >= max;
      const wasReady = s.status === "ready";
      s.status = ready ? "ready" : "active";
      this.render();
      this.onEvent({ kind: accepted ? "accepted" : ready && !wasReady ? "ready" : "progress" });
      if (!accepted) this.flash();
      return true;
    }
    m = RE_COMPLETE.exec(t);
    if (m) {
      this.doneStages = Math.max(this.doneStages, this.state.stage);
      this.state.status = "none";
      this.render();
      this.onEvent({ kind: "completed", title: m[1].trim(), xp: m[2] ? parseInt(m[2], 10) : 0 });
      return true;
    }
    if (/^No active quest/i.test(t)) {
      this.state.status = "none";
      this.render();
      this.onEvent({ kind: "reset" });
      return true;
    }
    if (/All of Elder Lin.s quests are complete/i.test(t) || /completed all my tasks/i.test(t)) {
      this.state.status = "alldone";
      this.doneStages = this.state.total;
      this.render();
      this.onEvent({ kind: "alldone" });
      return true;
    }
    return false;
  }

  /** Fallback progress from combat events; the server's own progress line overwrites it milliseconds later. */
  onKill(mobType: string | undefined) {
    if (!mobType) return;
    this.bump((k) => k.kill === mobType, 1);
  }
  onLoot(item: string, qty: number) {
    this.bump((k) => k.loot !== undefined && item.includes(k.loot), qty);
  }
  private bump(match: (k: Known) => boolean, n: number) {
    const s = this.state;
    if (s.status !== "active") return;
    const k = KNOWN.find((x) => x.title === s.title) ?? KNOWN[s.stage - 1];
    if (!k || !match(k)) return;
    s.cur = Math.min(s.max || k.count, s.cur + n);
    if (!s.max) s.max = k.count;
    this.render();
  }

  toggleLog(force?: boolean) {
    const on = force ?? !this.logEl.classList.contains("show");
    this.logEl.classList.toggle("show", on);
    if (on) this.renderLog();
  }
  get logOpen() { return this.logEl.classList.contains("show"); }

  /** Vermilion COMPLETE seal stamped over the screen. */
  stamp(big: string, sub: string) {
    this.stampEl.innerHTML = `<div class="st"><b>${esc(big)}</b><span>${esc(sub)}</span></div>`;
    this.stampEl.classList.remove("show");
    void this.stampEl.offsetWidth;
    this.stampEl.classList.add("show");
  }

  private flash() {
    this.el.classList.add("pulse");
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.el.classList.remove("pulse"), 700);
  }

  private known(): Known | undefined {
    return KNOWN.find((x) => x.title === this.state.title) ?? KNOWN[this.state.stage - 1];
  }

  private render() {
    const s = this.state;
    const head = `<div class="qh"><span class="qseal">${icon("scroll")}</span><span class="qt">Quest</span>${s.total && s.stage ? `<span class="qn">${Math.min(s.stage, s.total)}/${s.total}</span>` : ""}</div>`;
    let body = "";
    this.el.classList.toggle("ready", s.status === "ready");
    if (s.status === "active" || s.status === "ready") {
      const k = this.known();
      const pct = s.max ? Math.min(100, (s.cur / s.max) * 100) : 0;
      body = `<div class="qo">${esc(s.title)}</div>
        <div class="qbar"><i style="width:${pct.toFixed(0)}%"></i><span>${s.cur} / ${s.max}</span></div>${s.detail && s.status === "active" ? `<div class="qh2 qd">${esc(s.detail)}</div>` : ""}
        <div class="qh2">${s.status === "ready" ? "Return to Elder Lin \u2014 press F" : esc(k ? k.where : "Objective in progress")}</div>`;
    } else if (s.status === "alldone") {
      body = `<div class="qo">All tasks complete</div><div class="qh2">Elder Lin thanks you.</div>`;
    } else {
      body = `<div class="qo">Speak to Elder Lin</div><div class="qh2">At the plaza, near the spawn — press F</div>`;
    }
    this.el.innerHTML = head + body;
    if (this.logOpen) this.renderLog();
  }

  private renderLog() {
    const s = this.state;
    const rows = KNOWN.map((k, i) => {
      const n = i + 1;
      let st = "locked", note = "Locked";
      if (s.status === "alldone" || n <= this.doneStages) { st = "done"; note = "Complete"; }
      else if (n === s.stage && (s.status === "active" || s.status === "ready")) {
        st = s.status === "ready" ? "ready" : "active";
        note = s.status === "ready" ? "Ready to hand in" : `${s.cur} / ${s.max}`;
      } else if (n === this.doneStages + 1) { st = "next"; note = "Speak to Elder Lin"; }
      return `<div class="qr ${st}"><b>${n}</b><div><div class="qn1">${esc(k.title)}</div><div class="qn2">${esc(k.where)}</div></div><span>${esc(note)}</span></div>`;
    }).join("");
    this.logEl.innerHTML = `<div class="qlh"><span class="brush">Quest Log</span> <small>L to close</small></div>${rows}`;
  }
}
