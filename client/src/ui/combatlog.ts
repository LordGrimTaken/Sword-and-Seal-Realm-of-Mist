import { plain } from "./glyphs";

/** How a combat log line is inked: blows you land, blows you take, healing, and critical hits. */
export type CombatKind = "deal" | "take" | "heal" | "crit";

export interface CombatLogEntry { text: string; kind: CombatKind }

/** The panel keeps the last few events only ("~8"), oldest at the top and newest at the bottom. */
const MAX_LINES = 8;

/**
 * Combat Log panel (key C): a small paper-scroll window listing the most recent blows struck or taken and heals.
 * Client-only — the lines are built in Game.onEvent from the server `ev` damage/heal messages the client already
 * receives, so nothing here talks to the network. Sessions start closed and empty; lines survive closing the panel.
 */
export class CombatLogPanel {
  private el: HTMLElement;
  private rowsEl: HTMLElement;
  private lines: CombatLogEntry[] = [];

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "combatlog";
    this.el.className = "panel empty";
    this.el.setAttribute("role", "log");
    this.el.setAttribute("aria-live", "polite");
    this.el.setAttribute("aria-label", "Combat Log");
    this.el.innerHTML = `<div class="clh"><span class="brush">Combat Log</span><small>C to close</small></div>
      <div class="clrows"></div>
      <div class="clnone">No blows struck yet. The valley is quiet.</div>`;
    root.appendChild(this.el);
    this.rowsEl = this.el.querySelector(".clrows") as HTMLElement;
  }

  get isOpen() { return this.el.classList.contains("show"); }

  /** Append one readable event line; the oldest line falls off once the panel is full. */
  push(line: string, kind: CombatKind = "deal") {
    const text = plain(line);
    if (!text) return;
    this.lines.push({ text, kind });
    if (this.lines.length > MAX_LINES) this.lines.splice(0, this.lines.length - MAX_LINES);
    const row = document.createElement("div");
    row.className = `clr ${kind}`;
    row.textContent = text; // textContent, not innerHTML: entity names are server data
    this.rowsEl.appendChild(row);
    while (this.rowsEl.children.length > MAX_LINES) this.rowsEl.firstElementChild?.remove();
    this.el.classList.remove("empty");
    this.rowsEl.scrollTop = this.rowsEl.scrollHeight;
  }

  /** Forget every line (a new connection starts a fresh log). */
  clear() {
    this.lines = [];
    this.rowsEl.innerHTML = "";
    this.el.classList.add("empty");
  }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    this.el.classList.toggle("show", on);
    if (on) this.rowsEl.scrollTop = this.rowsEl.scrollHeight;
  }

  /** Read-only snapshot for the debug surface / UI tests. */
  debug(): { open: boolean; lines: string[] } {
    return { open: this.isOpen, lines: this.lines.map((l) => l.text) };
  }
}
