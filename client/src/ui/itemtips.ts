import { esc, plain } from "./glyphs";

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

export function itemTipHtml(item: string, qty: number): string {
  const i = itemInfo(item);
  return `<div class="tn"><b>${esc(plain(item))}</b><i>×${qty}</i></div>
    <div class="tm"><span class="rar r${i.rarity}">${RARITY_NAMES[i.rarity]}</span> · ${i.type}</div>
    <div class="td">${esc(i.desc)}${i.use ? `<br><em>${esc(i.use)}</em>` : ""}</div>`;
}
