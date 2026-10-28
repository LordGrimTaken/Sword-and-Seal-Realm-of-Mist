import type { InvItem } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import { itemIcon } from "./icons";

/** Paper-scroll inventory window (key I). The server owns the inventory; every `inv` message replaces the full list. */
export class Bag {
  private el: HTMLElement;
  private items: InvItem[] = [];
  private fresh = new Set<string>();
  private known = new Map<string, number>();
  private loaded = false;
  private onBadge: (n: number) => void;

  constructor(root: HTMLElement, onBadge: (n: number) => void = () => {}) {
    this.onBadge = onBadge;
    this.el = document.createElement("div");
    this.el.id = "bag";
    this.el.className = "panel";
    this.el.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-a=close]")) this.toggle(false); });
    root.appendChild(this.el);
    this.render();
  }

  get isOpen() { return this.el.classList.contains("show"); }
  get list(): readonly InvItem[] { return this.items; }

  /** Replace the inventory; entries that are new or grew since the previous message are highlighted until the bag is opened and closed. */
  set(items: InvItem[]) {
    const clean = items.filter((i) => i && typeof i.item === "string" && i.qty > 0);
    if (this.loaded) {
      for (const it of clean) if (it.qty > (this.known.get(it.item) ?? 0)) this.fresh.add(it.item);
    }
    this.known = new Map(clean.map((i) => [i.item, i.qty]));
    this.items = clean;
    this.loaded = true;
    this.render();
    this.onBadge(this.isOpen ? 0 : this.fresh.size);
  }

  reset() {
    this.items = []; this.fresh.clear(); this.known.clear(); this.loaded = false;
    this.render();
    this.onBadge(0);
  }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on === this.isOpen) return;
    this.el.classList.toggle("show", on);
    if (on) this.onBadge(0);
    else if (this.fresh.size) { this.fresh.clear(); this.render(); }
  }

  private render() {
    const total = this.items.reduce((n, i) => n + i.qty, 0);
    const rows = this.items.length
      ? this.items.map((i) => `<div class="bi${this.fresh.has(i.item) ? " new" : ""}"><div class="bseal">${itemIcon(i.item)}</div><div class="bn"><b>${esc(plain(i.item))}</b></div>${this.fresh.has(i.item) ? '<span class="bnew">NEW</span>' : ""}<div class="bq">×${i.qty}</div></div>`).join("")
      : `<div class="bempty">Your bag is empty.<br><small>Defeat spirits to gather materials.</small></div>`;
    this.el.innerHTML = `<div class="bh"><span class="brush">Bag</span> <small>${total} item${total === 1 ? "" : "s"}</small><button class="bx" data-a="close" aria-label="Close bag">×</button></div><div class="bl">${rows}</div><div class="bf">Press I to close</div>`;
  }
}
