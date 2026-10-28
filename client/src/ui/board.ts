import type { DailyTask } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import { icon } from "./icons";

export interface BoardOptions {
  onClaim(id: string): void;
  onToggle(open: boolean): void;
  onClaimable(n: number): void;
}

/** "7h 12m" / "12m" / "under a minute". */
export function fmtReset(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return "under a minute";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Paper-scroll Notice Board (key B): three daily tasks with progress, rewards and a claim seal. */
export class Board {
  private el: HTMLElement;
  private tasks: DailyTask[] = [];
  private resetAt = 0;       // performance.now() timestamp of the next reset
  private timer = 0;
  private pending = new Set<string>();
  private pendingTimer = 0;
  private justClaimed = new Set<string>();
  private speech = "";
  private loaded = false;

  constructor(root: HTMLElement, private opt: BoardOptions) {
    this.el = document.createElement("div");
    this.el.id = "board";
    this.el.className = "panel";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Notice Board");
    root.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("button");
      if (!b || (b as HTMLButtonElement).disabled) return;
      if (b.dataset.a === "close") this.toggle(false);
      else if (b.dataset.a === "claim" && b.dataset.id) this.claim(b.dataset.id);
    });
    this.render();
  }

  get isOpen() { return this.el.classList.contains("show"); }
  get list(): readonly DailyTask[] { return this.tasks; }
  get claimable(): number { return this.tasks.filter((t) => t.done && !t.claimed).length; }
  get resetIn(): number { return Math.max(0, Math.round((this.resetAt - performance.now()) / 1000)); }

  /** Replace the board with the server's latest `daily` message. */
  set(tasks: DailyTask[], resetIn: number) {
    const clean = (Array.isArray(tasks) ? tasks : []).filter((t) => t && typeof t.id === "string").slice(0, 6);
    if (this.loaded) {
      for (const t of clean) {
        const old = this.tasks.find((o) => o.id === t.id);
        if (t.claimed && old && !old.claimed) this.justClaimed.add(t.id);
      }
    }
    this.tasks = clean;
    this.loaded = true;
    this.resetAt = performance.now() + Math.max(0, Number(resetIn) || 0) * 1000;
    this.pending.clear();
    window.clearTimeout(this.pendingTimer);
    this.opt.onClaimable(this.claimable);
    this.render();
    this.justClaimed.clear();
  }

  setSpeech(text: string) { this.speech = plain(text); if (this.isOpen) this.render(); }

  reset() {
    this.tasks = []; this.loaded = false; this.pending.clear(); this.speech = "";
    this.toggle(false);
    this.opt.onClaimable(0);
    this.render();
  }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on === this.isOpen) return;
    this.el.classList.toggle("show", on);
    window.clearInterval(this.timer);
    if (on) {
      this.render();
      this.timer = window.setInterval(() => this.tickClock(), 1000);
    } else this.speech = "";
    this.opt.onToggle(on);
  }

  private claim(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || !t.done || t.claimed || this.pending.has(id)) return;
    this.pending.add(id);
    window.clearTimeout(this.pendingTimer);
    this.pendingTimer = window.setTimeout(() => { this.pending.clear(); this.render(); }, 3000); // the server always re-sends the board; this only covers a lost reply
    this.render();
    this.opt.onClaim(id);
  }

  private tickClock() {
    const el = this.el.querySelector(".bdreset");
    if (el) el.textContent = `Resets in ${fmtReset(this.resetIn)}`;
  }

  private row(t: DailyTask): string {
    const need = Math.max(1, t.need), have = Math.max(0, Math.min(t.have, need));
    const pct = Math.round((have / need) * 100);
    const state = t.claimed ? "claimed" : t.done ? "ready" : "active";
    let side: string;
    if (t.claimed) side = `<div class="bdstamp${this.justClaimed.has(t.id) ? " fresh" : ""}"><b>Complete</b><span>Claimed</span></div>`;
    else if (t.done) side = `<button type="button" class="bdclaim" data-a="claim" data-id="${esc(t.id)}"${this.pending.has(t.id) ? " disabled" : ""}><span>${this.pending.has(t.id) ? "..." : "Claim"}</span></button>`;
    else side = `<div class="bdprog">In progress</div>`;
    const rw = (ic: string, n: number, cls: string, label: string, suffix = "") => n > 0 ? `<span class="bdrw ${cls}" title="${label}">${icon(ic as "coin")}<b>${n}</b>${suffix}</span>` : "";
    return `<div class="bdt ${state}" data-id="${esc(t.id)}">
      <div class="bdmain">
        <div class="bdtt">${esc(plain(t.title))}</div>
        <div class="bddesc">${esc(plain(t.desc))}</div>
        <div class="bdbar" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${have}"><i style="width:${pct}%"></i><span>${have} / ${need}</span></div>
        <div class="bdrws">${rw("coin", t.coin, "c", "Coin")}${rw("jadeDisc", t.jade, "j", "Jade")}${rw("xpStar", t.xp, "x", "Experience", " XP")}</div>
      </div>
      <div class="bdside">${side}</div>
    </div>`;
  }

  private render() {
    const body = this.tasks.length ? this.tasks.map((t) => this.row(t)).join("") : `<div class="bdempty">The board is bare for now.<br><small>New notices go up at midnight, UTC.</small></div>`;
    const sp = this.speech ? `<div class="bdspeech"><b>Fen:</b> ${esc(this.speech.replace(/^Notice Board Keeper Fen[^:]{0,12}:\s*/i, ""))}</div>` : "";
    this.el.innerHTML = `<div class="rodt"></div>
      <div class="bdh"><span class="bdseal">${icon("board")}</span><div class="bdtitle"><span class="brush">Notice Board</span><span class="bdreset">Resets in ${fmtReset(this.resetIn)}</span></div><button type="button" class="bx" data-a="close" aria-label="Close notice board">&times;</button></div>
      ${sp}<div class="bdl">${body}</div>
      <div class="bdf">Press B to close</div><div class="rodb"></div>`;
  }
}
