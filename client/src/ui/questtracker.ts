import type { SideQuestView } from "@shared/protocol";
import { esc, plain } from "./glyphs";

/** How many active side quests the strip lists before it points at the full Journal instead. */
const MAX_QUESTS = 3;

/** Display-only fallback for the server's NPC keys, so a raw key like "wu" never reaches the screen. */
const NPC_NAME: Record<string, string> = {
  wu: "Gate Warden Wu",
  tao: "Artisan Tao",
  hao: "Peddler Hao",
  mei: "Lantern Keeper Mei",
  elder: "Elder Lin",
  fen: "Notice Board Keeper Fen",
};

/**
 * Quest Tracker: a compact paper strip under the minimap column that lists the player's accepted side quests and
 * their objective counters, e.g.
 *   Side Quests                                     2 active
 *   Thorns in the Reeds            return to Lantern Keeper Mei
 *   [v] Bamboo Fiber 4 / 4   [ ] Serpent Gall 1 / 3
 *
 * It is client-only: the data is the server's existing `sq` message (the same list the Journal (J) renders in full),
 * so this module never talks to the network and the protocol is untouched. The strip is deliberately silent and
 * self-hiding - with no active side quest it takes no space at all, and it never repeats the Journal's detail view.
 */
export class QuestTrackerHud {
  private el: HTMLElement;
  private rowsEl: HTMLElement;
  private countEl: HTMLElement;
  private moreEl: HTMLElement;
  private quests: SideQuestView[] = [];

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "questtracker";
    this.el.className = "panel";
    this.el.setAttribute("role", "complementary");
    this.el.setAttribute("aria-label", "Active side quests");
    this.el.innerHTML = `<div class="qth"><span class="brush">Side Quests</span><small class="qtcount"></small></div>
      <div class="qtrows"></div>
      <div class="qtmore"></div>`;
    root.appendChild(this.el);
    this.rowsEl = this.el.querySelector(".qtrows") as HTMLElement;
    this.countEl = this.el.querySelector(".qtcount") as HTMLElement;
    this.moreEl = this.el.querySelector(".qtmore") as HTMLElement;
  }

  /** Mirror one server `sq` list. Replaces (never appends), so progress and turn-ins stay exact. */
  set(quests: readonly SideQuestView[]) {
    this.quests = Array.isArray(quests) ? quests.slice() : []; // a malformed frame must never break the HUD
    this.render();
  }

  /** Forget every quest (a fresh connection starts clean) and hide the strip. */
  clear() {
    this.quests = [];
    this.render();
  }

  /** Hidden means "no accepted side quest is in progress" - a fresh character sees nothing here. */
  get isVisible() { return this.el.classList.contains("show"); }

  /** Read-only snapshot for the debug surface / UI tests. */
  debug() {
    const list = this.active();
    return {
      visible: this.isVisible,
      titles: list.map((q) => plain(q.title)),
      quests: list.map((q) => ({
        id: q.id,
        title: plain(q.title),
        npc: q.npc,
        st: q.st,
        obj: q.obj.map((o) => ({ text: plain(o.text), have: o.have, need: o.need })),
      })),
    };
  }

  /** Accepted side quests only: `offer` is still on the NPC, `done` already belongs to the Journal's history. */
  private active(): SideQuestView[] {
    return this.quests
      .filter((q) => q.st === "active" || q.st === "ready")
      .sort((a, b) => (a.st === "ready" ? 0 : 1) - (b.st === "ready" ? 0 : 1));
  }

  private render() {
    const list = this.active();
    const shown = list.slice(0, MAX_QUESTS);
    const ready = list.filter((q) => q.st === "ready").length;
    this.el.classList.toggle("show", list.length > 0);
    this.countEl.textContent = list.length ? (ready > 0 ? `${ready} ready` : `${list.length} active`) : "";
    this.moreEl.textContent = list.length > shown.length
      ? `+${list.length - shown.length} more in the Journal (J)`
      : "";
    this.rowsEl.innerHTML = shown.map((q) => this.row(q)).join("");
  }

  private row(q: SideQuestView): string {
    const objs = q.obj.map((o) => {
      const done = o.have >= o.need;
      const have = Math.min(o.have, o.need);
      return `<span class="qobj${done ? " ok" : ""}"><b aria-hidden="true">${done ? "&#10003;" : ""}</b><span class="qot">${esc(plain(o.text))}</span><i>${have} / ${o.need}</i></span>`;
    }).join("");
    const ready = q.st === "ready";
    const npc = NPC_NAME[q.npc] ?? q.npc;
    const tag = ready ? `<em class="qtag">return to ${esc(plain(npc))}</em>` : "";
    return `<div class="qtq${ready ? " ready" : ""}"><div class="qtt">${esc(plain(q.title))}${tag}</div><div class="qobs">${objs}</div></div>`;
  }
}
