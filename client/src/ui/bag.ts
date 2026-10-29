import type { InvItem } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import { itemIcon } from "./icons";
import { audio } from "../audio/instance";
import { itemInfo, itemTipHtml, RARITY_NAMES, type ItemType } from "./itemtips";

type SortMode = "recent" | "name" | "qty" | "rarity";
type Filter = "all" | ItemType;
const SORTS: Array<[SortMode, string]> = [["recent", "Recent"], ["name", "Name"], ["qty", "Amount"], ["rarity", "Rarity"]];
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["Material", "Materials"], ["Consumable", "Remedies"], ["Charm", "Charms"], ["Keepsake", "Keepsakes"]];

/** Paper-scroll inventory window (key I). The server owns the inventory; every `inv` message replaces the full list.
 *  The window adds client-side search, sorting, type filters and item tooltips (hover or keyboard focus). */
export class Bag {
  private el: HTMLElement;
  private listEl!: HTMLElement;
  private headEl!: HTMLElement;
  private tipEl: HTMLElement;
  private items: InvItem[] = [];
  private order = new Map<string, number>();
  private seq = 0;
  private fresh = new Set<string>();
  private known = new Map<string, number>();
  private loaded = false;
  private onBadge: (n: number) => void;
  private sort: SortMode = "recent";
  private filter: Filter = "all";
  private query = "";

  constructor(root: HTMLElement, onBadge: (n: number) => void = () => {}) {
    this.onBadge = onBadge;
    this.el = document.createElement("div");
    this.el.id = "bag";
    this.el.className = "panel";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Bag");
    this.el.innerHTML = `<div class="bh"></div>
      <div class="btool">
        <input class="bsearch" type="search" placeholder="Search items…" maxlength="30" aria-label="Search items" autocomplete="off" />
        <div class="bsort" role="group" aria-label="Sort items">${SORTS.map(([k, n]) => `<button type="button" data-quiet data-sort="${k}" aria-pressed="false">${n}</button>`).join("")}</div>
      </div>
      <div class="bchips" role="group" aria-label="Filter items">${FILTERS.map(([k, n]) => `<button type="button" data-quiet data-filter="${k}" aria-pressed="false">${n}</button>`).join("")}</div>
      <div class="bl" role="list"></div>
      <div class="bf">Press I to close · Hover an item for details</div>`;
    this.headEl = this.el.querySelector(".bh") as HTMLElement;
    this.listEl = this.el.querySelector(".bl") as HTMLElement;
    this.tipEl = document.createElement("div");
    this.tipEl.id = "itip";
    this.tipEl.setAttribute("role", "tooltip");
    root.appendChild(this.tipEl);
    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-a=close]")) { this.toggle(false); return; }
      const s = t.closest("[data-sort]") as HTMLElement | null;
      if (s) { this.sort = s.dataset.sort as SortMode; audio.ui("tab"); this.render(); return; }
      const f = t.closest("[data-filter]") as HTMLElement | null;
      if (f) { this.filter = f.dataset.filter as Filter; audio.ui("tab"); this.render(); }
    });
    const search = this.el.querySelector(".bsearch") as HTMLInputElement;
    search.addEventListener("input", () => { this.query = search.value.trim().toLowerCase(); this.render(); });
    search.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); else { search.blur(); } });
    search.addEventListener("keyup", (e) => e.stopPropagation());
    // tooltips: pointer hover and keyboard focus share one element
    this.listEl.addEventListener("pointerover", (e) => { const r = (e.target as HTMLElement).closest(".bi") as HTMLElement | null; if (r) this.showTip(r); });
    this.listEl.addEventListener("pointerout", (e) => { if ((e.target as HTMLElement).closest(".bi")) this.hideTip(); });
    this.listEl.addEventListener("focusin", (e) => { const r = (e.target as HTMLElement).closest(".bi") as HTMLElement | null; if (r) this.showTip(r); });
    this.listEl.addEventListener("focusout", () => this.hideTip());
    root.appendChild(this.el);
    this.render();
  }

  get isOpen() { return this.el.classList.contains("show"); }
  get list(): readonly InvItem[] { return this.items; }

  /** Replace the inventory; entries that are new or grew since the previous message are highlighted until the bag is opened and closed. */
  set(items: InvItem[]) {
    const clean = items.filter((i) => i && typeof i.item === "string" && i.qty > 0);
    if (this.loaded) {
      for (const it of clean) if (it.qty > (this.known.get(it.item) ?? 0)) { this.fresh.add(it.item); this.order.set(it.item, ++this.seq); }
    } else for (const it of clean) this.order.set(it.item, ++this.seq);
    this.known = new Map(clean.map((i) => [i.item, i.qty]));
    this.items = clean;
    this.loaded = true;
    this.render();
    this.onBadge(this.isOpen ? 0 : this.fresh.size);
  }

  reset() {
    this.items = []; this.fresh.clear(); this.known.clear(); this.order.clear(); this.seq = 0; this.loaded = false;
    this.hideTip();
    this.render();
    this.onBadge(0);
  }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on === this.isOpen) return;
    this.el.classList.toggle("show", on);
    if (on) this.onBadge(0);
    else { this.hideTip(); if (this.fresh.size) { this.fresh.clear(); this.render(); } }
  }

  /** What the window currently shows (for tests): visible rows in order. */
  view(): { names: string[]; sort: SortMode; filter: Filter; query: string } {
    return { names: this.visible().map((i) => i.item), sort: this.sort, filter: this.filter, query: this.query };
  }

  private visible(): InvItem[] {
    let l = this.items.filter((i) => (this.filter === "all" || itemInfo(i.item).type === this.filter) && (!this.query || plain(i.item).toLowerCase().includes(this.query)));
    const by: Record<SortMode, (a: InvItem, b: InvItem) => number> = {
      recent: (a, b) => (this.order.get(b.item) ?? 0) - (this.order.get(a.item) ?? 0),
      name: (a, b) => plain(a.item).localeCompare(plain(b.item)),
      qty: (a, b) => b.qty - a.qty || plain(a.item).localeCompare(plain(b.item)),
      rarity: (a, b) => itemInfo(b.item).rarity - itemInfo(a.item).rarity || plain(a.item).localeCompare(plain(b.item)),
    };
    l = [...l].sort(by[this.sort]);
    return l;
  }

  private showTip(row: HTMLElement) {
    const it = this.items.find((i) => i.item === row.dataset.item);
    if (!it) return;
    this.tipEl.innerHTML = itemTipHtml(it.item, it.qty);
    this.tipEl.classList.add("show");
    const r = row.getBoundingClientRect();
    const w = this.tipEl.offsetWidth, h = this.tipEl.offsetHeight;
    // beside the bag when there is room on the right, else on the left; always inside the viewport
    let x = r.right + 12;
    if (x + w > window.innerWidth - 8) x = Math.max(8, r.left - w - 12);
    this.tipEl.style.left = `${x}px`;
    this.tipEl.style.top = `${Math.max(8, Math.min(window.innerHeight - h - 8, r.top + r.height / 2 - h / 2))}px`;
  }
  private hideTip() { this.tipEl.classList.remove("show"); }

  private render() {
    this.hideTip(); // rows are rebuilt, so a tooltip for a replaced row would be stale
    const total = this.items.reduce((n, i) => n + i.qty, 0);
    this.headEl.innerHTML = `<span class="brush">Bag</span> <small>${total} item${total === 1 ? "" : "s"}</small><button class="bx" data-a="close" aria-label="Close bag">×</button>`;
    for (const b of this.el.querySelectorAll<HTMLElement>("[data-sort]")) b.setAttribute("aria-pressed", String(b.dataset.sort === this.sort));
    for (const b of this.el.querySelectorAll<HTMLElement>("[data-filter]")) b.setAttribute("aria-pressed", String(b.dataset.filter === this.filter));
    const vis = this.visible();
    this.listEl.innerHTML = vis.length
      ? vis.map((i) => {
        const info = itemInfo(i.item);
        return `<div class="bi${this.fresh.has(i.item) ? " new" : ""}" role="listitem" tabindex="0" data-item="${esc(i.item)}" aria-label="${esc(plain(i.item))}, quantity ${i.qty}, ${RARITY_NAMES[info.rarity]} ${info.type}"><div class="bseal r${info.rarity}">${itemIcon(i.item)}</div><div class="bn"><b>${esc(plain(i.item))}</b><small class="brar r${info.rarity}">${"◆".repeat(info.rarity + 1)} ${RARITY_NAMES[info.rarity]}</small></div>${this.fresh.has(i.item) ? '<span class="bnew">NEW</span>' : ""}<div class="bq">×${i.qty}</div></div>`;
      }).join("")
      : this.items.length
        ? `<div class="bempty">Nothing matches.<br><small>Clear the search or pick another filter.</small></div>`
        : `<div class="bempty">Your bag is empty.<br><small>Defeat spirits to gather materials.</small></div>`;
  }
}
