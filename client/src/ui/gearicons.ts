// 0.4.0 pictograms for gear and the new materials (same brush style as icons.ts: filled tapered strokes, gold accents `.ga`, ink accents `.ik`).
// icons.ts asks `extraItemIcon(name)` first; names it does not know fall through to its own rules.
const P: Record<string, string> = {
  hat: `<path d="M24 5C33 5 40 13 44 29c-7 5-13 6-20 6S11 34 4 29C8 13 15 5 24 5Z"/><path class="ga" d="M7 30c7 4 12 5 17 5s10-1 17-5l1.5 3c-7 5-12 7-18.500 7S12 38 5.500 33Z"/><path class="ik" d="M24 8c-5 1-9 8-10 20M24 8c5 1 9 8 10 20M24 8v24" stroke="#1a1a1f" stroke-width="1.6" fill="none" opacity=".5" stroke-linecap="round"/>`,
  robe: `<path d="M16 5l8 5 8-5 11 9-5 8-4-3v24H14V19l-4 3-5-8Z"/><path class="ga" d="M20 10l4 5 4-5v32h-8Z" opacity=".95"/><path class="ik" d="M14 32h20" stroke="#1a1a1f" stroke-width="3" opacity=".55"/><path d="M14 31h20v3H14z" fill="#c8372d"/>`,
  boots: `<path d="M14 5h13v22l12 6c3 2 4 4 4 8H8c-1-4-2-8 0-12 3-2 6-3 6-6Z"/><path class="ga" d="M14 9h13v4H14z"/><path class="ik" d="M8 41h35" stroke="#1a1a1f" stroke-width="3.5" stroke-linecap="round" opacity=".6"/>`,
  brush: `<path d="M41 4L18 30l-3-2L38 3Z"/><path class="ga" d="M16 29l4 4c-1 5-5 9-12 11 1-4-1-9 3-12Z"/><path class="ik" d="M8 43c4-1 8-3 10-7" stroke="#1a1a1f" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".6"/><circle cx="38" cy="6" r="2.6" fill="#c8372d"/>`,
  needles: `<path d="M6 17h36a2 2 0 0 1 2 2v20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V19a2 2 0 0 1 2-2Z"/><path class="ga" d="M4 24h40v4H4z"/><path class="ik" d="M12 6l3 11M20 4l2 13M28 6l-1 11M36 8l-4 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/><circle cx="24" cy="33" r="3.2" fill="#c8372d"/>`,
  jian: `<path d="M40 4l4 4-23 24-5-5Z"/><path class="ga" d="M12 28l8 8-3 3-8-8Z"/><path d="M9 34l5 5-5 6-4-4Z"/><path class="ik" d="M40 6l-22 23" stroke="#1a1a1f" stroke-width="1.4" opacity=".45"/><circle cx="7.500" cy="42.500" r="1.800" fill="#c8372d"/>`,
  pendant: `<path d="M10 4h4c3 14 7 17 10 17s7-3 10-17h4c-3 18-8 24-14 24S13 22 10 4Z" opacity=".85"/><path class="ga" d="M24 25l8 6-3 10H19l-3-10Z"/><path class="ik" d="M24 30v7M20.500 33.500h7" stroke="#1a1a1f" stroke-width="2" stroke-linecap="round"/><circle cx="24" cy="45" r="0.01"/>`,
  jelly: `<path d="M24 7c7 8 14 14 14 24 0 7-6 12-14 12S10 38 10 31C10 21 17 15 24 7Z" opacity=".92"/><path class="ga" d="M17 28c0 5 3 8 7 9" stroke="#f2ead8" stroke-width="3" fill="none" stroke-linecap="round" opacity=".9"/><circle class="ik" cx="29" cy="24" r="2.200" opacity=".5"/><circle class="ik" cx="22" cy="19" r="1.500" opacity=".4"/>`,
  fang: `<path d="M12 6c12 0 22 12 22 30 0 3-1 5-3 7-1-10-6-14-12-15-7-1-10-5-10-12 0-5 1-8 3-10Z"/><path class="ga" d="M16 11c9 1 15 9 16 22" stroke="#f0cf5a" stroke-width="2.200" fill="none" stroke-linecap="round" opacity=".85"/><path class="ik" d="M12 6l-3 2 2 2" fill="#1a1a1f" opacity=".5"/>`,
  shard: `<path d="M10 8l18 6 12 14-8 14-18-4-6-16Z" opacity=".95"/><path class="ik" d="M10 8l16 14 14 6M26 22l-4 16" stroke="#1a1a1f" stroke-width="2" fill="none" opacity=".55"/><path class="ga" d="M18 18l7 4-3 7-6-3Z"/><circle cx="34" cy="14" r="2.600" fill="#c8372d"/>`,
};

/** Inline SVG for items added in 0.4.0, or null when icons.ts should decide. */
export function extraItemIcon(item: string): string | null {
  const n = item.toLowerCase();
  let k: string | null = null;
  if (/charm/.test(n)) k = null;
  else if (/hat|hood/.test(n)) k = "hat";
  else if (/robe|vest|cloak/.test(n)) k = "robe";
  else if (/boots|sandals|greaves/.test(n)) k = "boots";
  else if (/brush/.test(n)) k = "brush";
  else if (/needle/.test(n)) k = "needles";
  else if (/jian|sword/.test(n)) k = "jian";
  else if (/pendant|heart/.test(n)) k = "pendant";
  else if (/jelly/.test(n)) k = "jelly";
  else if (/fang/.test(n)) k = "fang";
  else if (/fragment|shard/.test(n)) k = "shard";
  return k ? `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${P[k]}</svg>` : null;
}

export const RARITY_COLOR: Record<string, string> = { common: "#8a8577", fine: "#4fa58b", rare: "#3f7fa6", epic: "#c8372d" };
export const RARITY_LABEL: Record<string, string> = { common: "Common", fine: "Fine", rare: "Rare", epic: "Epic" };
export const SLOT_LABEL: Record<string, string> = { weapon: "Weapon", head: "Head", body: "Body", boots: "Boots", charm: "Charm", pendant: "Pendant" };
