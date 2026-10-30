import type { GearStats, ItemInfo as CatalogueItem, Rarity } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import { RARITY_LABEL, SLOT_LABEL } from "./gearicons";

/** Client-side item notes for tooltips and bag sorting. The server only sends names and counts; unknown items fall back to a rule by name. */
export type ItemType = "Material" | "Consumable" | "Keepsake" | "Charm";
export interface ItemInfo { type: ItemType; rarity: number; desc: string; use?: string }

export const RARITY_NAMES = ["Common", "Uncommon", "Rare", "Epic"] as const;

const KNOWN: Record<string, ItemInfo> = {
  "Bamboo Fiber": { type: "Material", rarity: 0, desc: "Tough green strands stripped from bamboo spirits. Lantern keepers use it as wicks." },
  "Fox Tail": { type: "Material", rarity: 0, desc: "A russet tail still warm with faint spirit fire. The tinker brews wards from them." },
  "Jade Scale": { type: "Material", rarity: 1, desc: "A cool, glassy scale shed by the serpents of the Lotus Pond." },
  "Serpent Gall": { type: "Consumable", rarity: 2, desc: "A bitter gland prized by physicians. Rare drop from Jade Serpents.", use: "Used in antidotes." },
  "Guardian Core": { type: "Material", rarity: 2, desc: "The humming rune core of the Stone Guardian." },
  "Healing Tonic": { type: "Consumable", rarity: 1, desc: "A sweet herbal tonic brewed in a gourd.", use: "Restores health." },
  "Lotus Antidote": { type: "Consumable", rarity: 1, desc: "Pond-lotus extract that neutralises serpent venom.", use: "Cures poison." },
  "Paper Lantern": { type: "Keepsake", rarity: 1, desc: "A hand-painted lantern from the plaza. It glows softly in your pack." },
  "Jade Charm": { type: "Charm", rarity: 2, desc: "A small carved disc that hums when spirits are near." },
  "Lotus Charm": { type: "Charm", rarity: 2, desc: "A pond-green charm threaded with lotus silk." },
  "Cloudmist Pendant": { type: "Charm", rarity: 3, desc: "The Stone Guardian master's own pendant, cold as mountain mist." },
  "Guardian's Seal": { type: "Keepsake", rarity: 3, desc: "A vermilion chop stamped by the shrine keeper. Proof that the shrine is at peace." },
};

export function itemInfo(item: string): ItemInfo {
  const n = plain(item);
  const k = KNOWN[n];
  if (k) return k;
  if (/tonic|antidote|elixir|potion|pill|vial|gall/i.test(n)) return { type: "Consumable", rarity: 1, desc: "A prepared remedy." };
  if (/charm|pendant|amulet|talisman/i.test(n)) return { type: "Charm", rarity: 2, desc: "A trinket carried for luck." };
  if (/seal|stamp|chop|lantern/i.test(n)) return { type: "Keepsake", rarity: 1, desc: "A keepsake from your travels." };
  return { type: "Material", rarity: 0, desc: "A crafting material gathered from the valley." };
}

export const rarityOf = (item: string): number => itemInfo(item).rarity;

// ---------------------------------------------------------------------------------------------------------------
// Server catalogue bridge. The Bag is built before the content panels, so GearPanel hands this module a live view
// of the server's item catalogue and equipped slots. With it, bag sorting and tooltips can use the authoritative
// gear data (slot / rarity / stats) instead of the local fallback notes above. Nothing here talks to the network.

/** Live view of the game's server item catalogue plus the equipped slots (registered by GearPanel). */
export interface GearContext {
  items: ReadonlyMap<string, CatalogueItem>;
  gear: { slots: Record<string, string | null> };
}

let gearCtx: GearContext | null = null;

/** Called by GearPanel. The stored reference is live, so later `items` / `gear` messages are seen automatically. */
export function setGearContext(ctx: GearContext | null) { gearCtx = ctx; }

const RARITY_INDEX: Record<Rarity, number> = { common: 0, fine: 1, rare: 2, epic: 3 };
/** "gear" first, then remedies, trinkets, keepsakes, materials and quest items. */
const KIND_CATEGORY: Record<string, number> = { gear: 0, consumable: 1, charm: 2, keepsake: 3, material: 4, quest: 5 };
const TYPE_CATEGORY: Record<ItemType, number> = { Consumable: 1, Charm: 2, Keepsake: 3, Material: 4 };

/** What the bag row and tooltip show for one item. */
export interface DisplayInfo { rarity: number; rarityLabel: string; type: string; desc: string; use?: string }

/**
 * Presentation for an item. The server catalogue wins for gear pieces the old local notes do not cover, so a
 * Houndfang Jian reads "Fine · Gear · Weapon" with the server's flavour text instead of the generic material
 * fallback; entries in the hand-written KNOWN table keep their established wording (and therefore the bag and
 * tooltip labels players already know).
 */
export function displayInfo(item: string): DisplayInfo {
  const local = itemInfo(item);
  const c = catalogueInfo(item);
  if (c?.kind === "gear" && !KNOWN[plain(item)]) {
    const rarity = RARITY_INDEX[c.rarity ?? "common"];
    return { rarity, rarityLabel: RARITY_LABEL[c.rarity ?? "common"] ?? "Common", type: c.slot ? `Gear · ${SLOT_LABEL[c.slot] ?? c.slot}` : "Gear", desc: c.text };
  }
  return { rarity: local.rarity, rarityLabel: RARITY_NAMES[local.rarity], type: local.type, desc: local.desc, use: local.use };
}

/** Server catalogue entry for an inventory name, when the catalogue has arrived. */
export function catalogueInfo(item: string): CatalogueItem | undefined {
  return gearCtx?.items.get(item);
}

/** Rarity rank for the bag's Sort modes: the server's equipment rarity wins (authoritative "rare first"), local notes otherwise. */
export function sortRarity(item: string): number {
  const c = catalogueInfo(item);
  if (c?.kind === "gear" && c.rarity) return RARITY_INDEX[c.rarity];
  return itemInfo(item).rarity;
}

/** Category rank for the bag's Sort mode: gear, then remedies, trinkets, keepsakes, materials and quest items. */
export function sortCategory(item: string): number {
  const c = catalogueInfo(item);
  if (c) return KIND_CATEGORY[c.kind] ?? 6;
  return TYPE_CATEGORY[itemInfo(item).type];
}

const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;

/** "+5 Attack · +22 Health · +1.5% Crit · -3% Damage taken" (same wording as the gear panel). */
function statLine(s: Partial<GearStats> | undefined): string {
  if (!s) return "";
  const out: string[] = [];
  if (s.atk) out.push(`+${s.atk} Attack`);
  if (s.hp) out.push(`+${s.hp} Health`);
  if (s.crit) out.push(`+${pct(s.crit)} Crit`);
  if (s.def) out.push(`-${pct(s.def)} Damage taken`);
  return out.join(" · ");
}

/** "+2" / "-3" for the flat stats, "+1.5%" / "-2%" for the fractional crit/def stats. */
const signedFlat = (v: number) => { const n = Math.round(v); return `${n > 0 ? "+" : ""}${n}`; };
const signedPct = (v: number) => { const n = Math.round(v * 1000) / 10; return `${n > 0 ? "+" : ""}${n}%`; };

/**
 * "vs equipped" block for a gear item, or "" for anything else (materials, charms that are not equipment, ...).
 * Baseline is the piece currently in that slot (or an empty slot), and the deltas cover the same four stats the
 * gear panel shows: attack, health, crit and damage taken. Purely presentational - the server owns the real stats.
 */
export function gearCompareHtml(item: string): string {
  const c = catalogueInfo(item);
  if (!c || c.kind !== "gear") return "";
  const slot = c.slot ?? "";
  const equippedName = slot && gearCtx ? gearCtx.gear.slots[slot] ?? null : null;
  const equipped = equippedName && gearCtx ? gearCtx.items.get(equippedName) : undefined;
  const mine = c.stats ?? {};
  const base = equipped?.stats ?? {};
  const slotName = SLOT_LABEL[slot] ?? slot;
  const stats = statLine(mine);
  const head = `<div class="tgh"><b>Gear</b> · ${esc(slotName)} · Lv ${c.lv ?? 1}</div>${stats ? `<div class="tgs">${esc(stats)}</div>` : ""}`;
  if (equippedName === c.name) return `<div class="tgear">${head}<div class="tgc"><span class="tgcl">Equipped now</span></div></div>`;
  // the worn piece is not in the catalogue yet (e.g. the `gear` message beat the `items` one): show no deltas rather than fake ones
  if (equippedName && !equipped) return `<div class="tgear">${head}<div class="tgc"><span class="tgcl">Equipped: ${esc(plain(equippedName))}</span></div></div>`;
  const parts: string[] = [];
  const add = (delta: number, label: string, fmt: (v: number) => string) => {
    if (Math.abs(delta) < 1e-9) return;
    parts.push(`<span class="${delta > 0 ? "tup" : "tdown"}">${fmt(delta)} ${label}</span>`);
  };
  add((mine.atk ?? 0) - (base.atk ?? 0), "Atk", signedFlat);
  add((mine.hp ?? 0) - (base.hp ?? 0), "HP", signedFlat);
  add((mine.crit ?? 0) - (base.crit ?? 0), "Crit", signedPct);
  add((mine.def ?? 0) - (base.def ?? 0), "Def", signedPct);
  const vs = equippedName ? `vs ${esc(plain(equippedName))}` : `vs empty ${esc(slotName.toLowerCase())} slot`;
  return `<div class="tgear">${head}<div class="tgc"><span class="tgcl">${vs}</span>${parts.join("") || '<span class="tsame">no stat change</span>'}</div></div>`;
}

export function itemTipHtml(item: string, qty: number): string {
  const i = displayInfo(item);
  return `<div class="tn"><b>${esc(plain(item))}</b><i>×${qty}</i></div>
    <div class="tm"><span class="rar r${i.rarity}">${esc(i.rarityLabel)}</span> · ${esc(i.type)}</div>
    <div class="td">${esc(i.desc)}${i.use ? `<br><em>${esc(i.use)}</em>` : ""}</div>${gearCompareHtml(item)}`;
}
