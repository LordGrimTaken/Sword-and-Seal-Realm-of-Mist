import type { ServerMsg } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import { icon } from "./icons";

type BestMob = Extract<ServerMsg, { t: "best" }>["mobs"][number];

/** Read-only snapshot for the debug surface (`window.__jz.bestiary`) and UI tests. */
export interface BestiaryDebug {
  open: boolean;
  discovered: number;
  total: number;
  kills: number;
  mobs: Array<{ type: string; name: string; kills: number; known: boolean }>;
}

/**
 * Bestiary / Codex (Shift+B): every mob type the server knows, with how many of each the local player has slain.
 * The server sends the persisted counts in one `best` message (all mob types; 0 = never slain), so undiscovered
 * entries read "???" and 0 and the panel lights up as records are earned. Client-only display: nothing here talks
 * to the network, the protocol is untouched beyond the additive message.
 *
 * Display names are learned from the entity snapshots (the `nameOf` resolver Game supplies) and title-cased from
 * the mob type when a type has not been seen in this session. The list keeps the server's fixed data order so
 * entries never shuffle around as they are discovered — a codex page stays where the reader expects it.
 */
export class BestiaryPanel {
  private el: HTMLElement;
  private gridEl: HTMLElement;
  private sumEl: HTMLElement;
  private countEl: HTMLElement;
  private mobs: BestMob[] = [];

  constructor(root: HTMLElement, private nameOf: (type: string) => string | null = () => null) {
    this.el = document.createElement("div");
    this.el.id = "bestiary";
    this.el.className = "panel";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Bestiary");
    this.el.innerHTML = `<div class="bth"><span class="brush">Bestiary</span><small class="btcount"></small><button type="button" class="bx" data-a="close" aria-label="Close bestiary">&times;</button></div>
      <div class="btsum"></div>
      <div class="btgrid"></div>
      <div class="btf">Shift+B to close</div>`;
    root.appendChild(this.el);
    this.gridEl = this.el.querySelector(".btgrid") as HTMLElement;
    this.sumEl = this.el.querySelector(".btsum") as HTMLElement;
    this.countEl = this.el.querySelector(".btcount") as HTMLElement;
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
      if (b?.dataset.a === "close") this.toggle(false);
    });
    this.render();
  }

  get isOpen() { return this.el.classList.contains("show"); }

  /** Mirror one server `best` message. Replaces the whole codex; a malformed frame is ignored instead of breaking the HUD. */
  set(mobs: readonly BestMob[]) {
    if (!Array.isArray(mobs)) return;
    this.mobs = mobs
      .filter((m) => !!m && typeof m.type === "string" && Number.isFinite(m.kills))
      .map((m) => ({ type: m.type, kills: Math.max(0, Math.floor(m.kills)) }));
    if (this.isOpen) this.render();
  }

  /** Forget the counts (a fresh connection waits for its own `best` message) and close. */
  clear() {
    this.mobs = [];
    this.toggle(false);
  }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on === this.isOpen) return;
    this.el.classList.toggle("show", on);
    if (on) this.render();
  }

  /** Read-only snapshot for the debug surface / UI tests. */
  debug(): BestiaryDebug {
    const known = this.mobs.filter((m) => m.kills > 0);
    return {
      open: this.isOpen,
      discovered: known.length,
      total: this.mobs.length,
      kills: this.mobs.reduce((n, m) => n + m.kills, 0),
      mobs: this.mobs.map((m) => ({ type: m.type, name: m.kills > 0 ? this.name(m.type) : "???", kills: m.kills, known: m.kills > 0 })),
    };
  }

  /** Seen display name for the type, else a title-cased fallback ("thorn_sprite" -> "Thorn Sprite"). */
  private name(type: string): string {
    const seen = plain(this.nameOf(type) ?? "");
    if (seen) return seen;
    return plain(type).split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  }

  private render() {
    const total = this.mobs.length;
    const known = this.mobs.filter((m) => m.kills > 0).length;
    const kills = this.mobs.reduce((n, m) => n + m.kills, 0);
    this.countEl.textContent = total ? `${known} / ${total} discovered` : "empty";
    this.sumEl.innerHTML = total
      ? `<b>Discovered</b> ${known} / ${total} &middot; <b>Slain</b> ${kills}`
      : "No lore gathered yet. Slay valley spirits and their entries will be inked into this codex.";
    this.gridEl.innerHTML = this.mobs.map((m) => {
      const isKnown = m.kills > 0;
      return `<div class="btm${isKnown ? "" : " unknown"}">
        <span class="btseal" aria-hidden="true">${isKnown ? icon("slash") : "?"}</span>
        <div class="bti"><b>${isKnown ? esc(this.name(m.type)) : "???"}</b><span>${isKnown ? `${m.kills} slain` : "Not yet slain"}</span></div>
        <i class="btk">${m.kills}</i>
      </div>`;
    }).join("");
  }
}
