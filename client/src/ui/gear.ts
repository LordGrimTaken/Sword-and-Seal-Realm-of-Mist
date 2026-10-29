import type { ClassId, GearStats, InvItem, ItemInfo } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import { RARITY_COLOR, RARITY_LABEL, SLOT_LABEL, extraItemIcon } from "./gearicons";
import { itemIcon } from "./icons";

/** What the content panels need from the game: server state received so far plus a few live readings. */
export interface ContentStore {
  items: Map<string, ItemInfo>;
  gear: { slots: Record<string, string | null>; stats: GearStats };
  inv(): readonly InvItem[];
  level(): number;
  cls(): ClassId;
  send(m: import("@shared/protocol").ClientMsg): void;
}

const CLS_NAME: Record<ClassId, string> = { sword: "Sword Cultivator", talisman: "Talisman Master", physician: "Physician" };
const SLOT_ORDER = ["head", "body", "boots", "weapon", "charm", "pendant"] as const;

export const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
/** "+5 Attack · +22 Health · +1.5% Crit · -3% Damage taken" */
export function statText(s: Partial<GearStats> | undefined): string {
  if (!s) return "";
  const out: string[] = [];
  if (s.atk) out.push(`+${s.atk} Attack`);
  if (s.hp) out.push(`+${s.hp} Health`);
  if (s.crit) out.push(`+${pct(s.crit)} Crit`);
  if (s.def) out.push(`-${pct(s.def)} Damage taken`);
  return out.join(" · ");
}
export function itemSeal(name: string, rarity?: string, big = false): string {
  const col = RARITY_COLOR[rarity ?? "common"] ?? RARITY_COLOR.common;
  return `<span class="cxi${big ? " big" : ""}" style="--rc:${col}">${extraItemIcon(name) ?? itemIcon(name)}</span>`;
}

/** Character / gear panel (key G): six equipment slots, summed bonuses, equippable pieces from the bag and usable consumables. */
export class GearPanel {
  private el: HTMLElement;
  constructor(root: HTMLElement, private st: ContentStore) {
    this.el = document.createElement("div");
    this.el.id = "gearp";
    this.el.className = "panel cxp";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Gear");
    root.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      const a = b.dataset.a;
      if (a === "close") this.toggle(false);
      else if (a === "equip" && b.dataset.i) this.st.send({ t: "equip", item: b.dataset.i });
      else if (a === "unequip" && b.dataset.s) this.st.send({ t: "unequip", slot: b.dataset.s });
      else if (a === "use" && b.dataset.i) this.st.send({ t: "use", item: b.dataset.i });
    });
    this.render();
  }
  get isOpen() { return this.el.classList.contains("show"); }
  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    this.el.classList.toggle("show", on);
    if (on) this.render();
  }

  /** Why an owned piece cannot be worn right now, or "". */
  private blocked(d: ItemInfo): string {
    if ((d.lv ?? 1) > this.st.level()) return `Needs level ${d.lv}`;
    if (d.cls && d.cls !== this.st.cls()) return `${CLS_NAME[d.cls]} only`;
    return "";
  }

  render() {
    if (!this.isOpen && this.el.innerHTML) return;
    const { slots, stats } = this.st.gear;
    const slotHtml = SLOT_ORDER.map((s) => {
      const name = slots[s];
      const d = name ? this.st.items.get(name) : undefined;
      if (!name) return `<div class="cxs empty" data-slot="${s}"><span class="cxsl">${SLOT_LABEL[s]}</span><span class="cxe"></span></div>`;
      return `<button type="button" class="cxs full" data-a="unequip" data-s="${s}" title="${esc(plain(name))}: click to remove" style="--rc:${RARITY_COLOR[d?.rarity ?? "common"]}"><span class="cxsl">${SLOT_LABEL[s]}</span>${itemSeal(name, d?.rarity, true)}<span class="cxn">${esc(plain(name))}</span></button>`;
    }).join("");
    const inv = this.st.inv();
    const gearRows = inv.flatMap((i) => {
      const d = this.st.items.get(i.item);
      if (!d || d.kind !== "gear") return [];
      const why = this.blocked(d);
      return [`<div class="cxr" style="--rc:${RARITY_COLOR[d.rarity ?? "common"]}">${itemSeal(d.name, d.rarity)}<div class="cxm"><b>${esc(plain(d.name))}</b>${i.qty > 1 ? ` <i>x${i.qty}</i>` : ""}<span class="cxk">${RARITY_LABEL[d.rarity ?? "common"]} ${SLOT_LABEL[d.slot ?? "body"].toLowerCase()} · Lv ${d.lv}${d.cls ? " · " + CLS_NAME[d.cls] : ""}</span><span class="cxst">${esc(statText(d.stats))}</span></div><button type="button" class="btn sm" data-a="equip" data-i="${esc(d.name)}"${why ? ` disabled title="${esc(why)}"` : ""}>${why ? esc(why) : "Equip"}</button></div>`];
    });
    const useRows = inv.flatMap((i) => {
      const d = this.st.items.get(i.item);
      if (!d || d.kind !== "consumable") return [];
      return [`<div class="cxr">${itemSeal(d.name, "fine")}<div class="cxm"><b>${esc(plain(d.name))}</b> <i>x${i.qty}</i><span class="cxst">${esc(plain(d.text))}</span></div><button type="button" class="btn sm" data-a="use" data-i="${esc(d.name)}">Use</button></div>`];
    });
    const st = statText(stats) || "No bonuses yet. Equip gear to grow stronger.";
    this.el.innerHTML = `<div class="rodt"></div>
      <div class="cxh"><span class="brush">Gear</span><small>${esc(CLS_NAME[this.st.cls()])} · Lv ${this.st.level()}</small><button type="button" class="bx" data-a="close" aria-label="Close gear">&times;</button></div>
      <div class="cxdoll">${slotHtml}</div>
      <div class="cxsum"><b>Bonuses</b> ${esc(st)}</div>
      <div class="cxcols">
        <section><h4>Gear in your bag</h4>${gearRows.join("") || '<div class="cxnone">Nothing to wear. Craft with Artisan Tao, buy from Peddler Hao or take it from the valley\'s spirits.</div>'}</section>
        <section><h4>Potions</h4>${useRows.join("") || '<div class="cxnone">No potions. Peddler Hao sells Healing Tonic and Lotus Antidote.</div>'}</section>
      </div>
      <div class="cxf">Press G to close · potions share a ${15} second cooldown</div><div class="rodb"></div>`;
  }
}
