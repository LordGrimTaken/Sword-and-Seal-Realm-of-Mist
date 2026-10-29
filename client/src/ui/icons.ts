import type { ClassId } from "@shared/protocol";
import { extraItemIcon } from "./gearicons";

/**
 * Hand-drawn brush pictograms (viewBox 48x48). Shapes are filled, tapered brush strokes in paper white (`currentColor`),
 * with gold accents (`.ga`) and ink accents (`.ik`). No letters: the seal frame around them is drawn by CSS.
 */
const P = {
  // ---- skills
  slash: `<path d="M6 41C8 18 24 6 43 6C30 11 16 22 6 41Z"/><path class="ga" d="M16 41C20 30 29 21 40 16C33 23 26 31 21 41Z"/><path d="M31 38l9-8-2 9z"/><circle cx="12" cy="12" r="2"/>`,
  qiwave: `<path d="M12 7C26 14 26 34 12 41C19 32 19 16 12 7Z"/><path d="M23 9C37 16 37 32 23 39C30 31 30 17 23 9Z" opacity=".85"/><path class="ga" d="M33 12C44 18 44 30 33 36C39 29 39 19 33 12Z"/><path d="M4 24h6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  split: `<path d="M24 3l4.2 27-4.2 4-4.2-4z"/><path d="M15 31h18v3.4H15z"/><path d="M22.4 34h3.2v9h-3.2z"/><path class="ga" d="M24 9C15 12 9 18 8 26C12 20 17 16 22 14Z"/><path class="ga" d="M24 9C33 12 39 18 40 26C36 20 31 16 26 14Z"/><path d="M24 36v-0.1" stroke="currentColor"/>`,
  shield: `<circle cx="24" cy="24" r="17.5" fill="none" stroke="currentColor" stroke-width="3.2"/><path d="M24 8.5a15.5 15.5 0 0 1 0 31a7.75 7.75 0 0 1 0-15.5a7.75 7.75 0 0 0 0-15.5Z"/><circle class="ik" cx="24" cy="16.25" r="2.4"/><circle cx="24" cy="31.75" r="2.4" fill="#c8372d"/>`,
  fire: `<path d="M24 3C26 13 38 18 36 31C35 40 29 45 24 45C15 45 10 38 12 30C13 25 17 23 18 17C21 20 22 14 24 3Z"/><path class="ga" d="M24 22C26 27 31 29 30 35C29 40 26 42 24 42C20 42 18 38 19 34C20 31 23 29 24 22Z"/>`,
  bolt: `<path d="M29 3L10 26h10l-4 19 22-27H26z"/><path class="ga" d="M27 12L19 24h9l-3 10 9-12h-8z"/>`,
  frost: `<g stroke="currentColor" stroke-width="3.2" stroke-linecap="round" fill="none"><path d="M24 4v40M7 14l34 20M41 14L7 34"/><path d="M19 8l5 5 5-5M19 40l5-5 5 5M8 22l7 1-2-7M40 26l-7-1 2 7M8 26l7-1-2 7M40 22l-7 1 2-7" stroke-width="2.4"/></g><circle class="ga" cx="24" cy="24" r="4"/>`,
  wind: `<g fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"><path d="M5 17h24a6.5 6.5 0 1 0-6.5-6.5"/><path d="M5 26h31a6.5 6.5 0 1 1-6.5 6.5"/><path d="M5 35h14a5 5 0 1 1-5 5" stroke-width="3"/></g><path class="ga" d="M9 17h8" stroke-width="3.6" stroke-linecap="round"/>`,
  needle: `<path d="M42 5L10 39l-1.5-1.2L40 4.5z" stroke="currentColor" stroke-width="2.2"/><path d="M42 5L9 40l-2-2z"/><ellipse class="ga" cx="39" cy="9" rx="3" ry="1.6" transform="rotate(-48 39 9)"/><path d="M8 42c-3-2-5 1-4 4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path class="ga" d="M33 32c3 3 8 3 11 0-1 6-5 8-8 8s-5-4-3-8z" opacity=".95"/>`,
  rain: `<path d="M16 4C21 13 25 17 25 23a9 9 0 0 1-18 0C7 17 11 13 16 4Z"/><path d="M34 14C38 21 41 24 41 29a7 7 0 0 1-14 0C27 24 30 21 34 14Z" class="ga"/><path d="M20 33c3 5 5 7 5 10a5.5 5.5 0 0 1-11 0c0-3 3-5 6-10Z" opacity=".9"/><path d="M5 40h5M38 41h5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
  burst: `<circle cx="24" cy="24" r="8"/><g class="ga"><path d="M24 2l3 11h-6zM24 46l-3-11h6zM2 24l11-3v6zM46 24l-11 3v-6z"/></g><path d="M8.5 8.5l10 6-4 4zM39.5 39.5l-10-6 4-4zM39.5 8.5l-6 10-4-4zM8.5 39.5l6-10 4 4z" opacity=".85"/>`,
  pulse: `<g fill="none" stroke="currentColor" stroke-linecap="round"><circle cx="24" cy="24" r="6" stroke-width="3.4"/><path d="M13 13a15.5 15.5 0 0 0 0 22M35 13a15.5 15.5 0 0 1 0 22" stroke-width="3.4"/><path d="M7 7a24 24 0 0 0 0 34M41 7a24 24 0 0 1 0 34" stroke-width="2.6" opacity=".8"/></g><circle class="ga" cx="24" cy="24" r="2.8"/>`,
  // ---- class crests (login)
  crestSword: `<path d="M38 4l-4 3L16 26l-3-3L11 25l3 3-8 9 3 3 9-8 3 3 2-2-3-3L41 11z"/><path class="ga" d="M14 33l-6 7 3 3 7-6z"/>`,
  crestTalisman: `<path d="M13 3h22v42H13z" opacity=".95"/><path class="ik" d="M18 9h12M24 9v8M18 21c4-3 8-3 12 0M18 27c4 3 8 3 12 0M24 21v12M19 38h10" stroke="#1a1a1f" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M13 3h22" stroke="#c8372d" stroke-width="4"/>`,
  crestPhysician: `<path d="M20 4h8v5c6 3 10 9 10 16 0 10-6 18-14 18S10 35 10 25c0-7 4-13 10-16z"/><circle class="ga" cx="24" cy="26" r="7"/><path class="ik" d="M24 21v10M19 26h10" stroke="#1a1a1f" stroke-width="3" stroke-linecap="round"/><path d="M19 4h10v-1H19z"/>`,
  // ---- items
  fiber: `<g stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"><path d="M13 6c-3 14-3 26 0 38M20 4c-2 14-2 28 0 40M28 4c2 14 2 28 0 40M35 6c3 14 3 26 0 38"/></g><path class="ga" d="M8 20h32v6H8z"/><path class="ik" d="M8 23h32" stroke="#1a1a1f" stroke-width="1.2"/>`,
  tail: `<path d="M8 41C2 28 10 8 28 5c10-1.5 15 6 12 14-2 5-7 7-9 12-3 8-14 15-23 10Z"/><path class="ik" d="M28 5c10-1.5 15 6 12 14-1 3-3 5-5 7 1-8-2-14-10-17Z" fill="#f2ead8" opacity=".95"/><path d="M14 33c6-3 11-9 13-16" stroke="#1a1a1f" stroke-width="1.6" fill="none" opacity=".5" stroke-linecap="round"/>`,
  core: `<path d="M24 3l17 11v20L24 45 7 34V14z"/><path class="ik" d="M24 3l17 11-17 10L7 14z" fill="#f2ead8" opacity=".35"/><path class="ga" d="M24 15l9 6v8l-9 6-9-6v-8z"/><path d="M24 20v10M19 25h10" stroke="#1a1a1f" stroke-width="2" stroke-linecap="round"/>`,
  scale: `<path d="M24 5c12 0 19 9 19 20-3 9-10 17-19 18C14 42 7 34 5 25 5 14 12 5 24 5Z"/><g class="ik" fill="none" stroke="#1a1a1f" stroke-width="1.8" opacity=".6" stroke-linecap="round"><path d="M24 8v34M14 14c3 8 3 18 0 26M34 14c-3 8-3 18 0 26M8 22c6 4 10 4 16 0M24 22c6 4 10 4 16 0"/></g>`,
  vial: `<path d="M19 3h10v3h-2v8c6 3 11 9 11 17 0 8-6 14-14 14S10 39 10 31c0-8 5-14 11-17V6h-2z"/><path class="ga" d="M13 29h22c0 7-5 12-11 12S13 36 13 29z"/><path d="M19 3h10" stroke="#c8372d" stroke-width="3"/>`,
  lantern: `<path d="M20 3h8v4h-8z"/><ellipse cx="24" cy="24" rx="15" ry="16"/><g fill="none" stroke="#1a1a1f" stroke-width="1.8" opacity=".55"><path d="M24 8v32M15 10c-4 9-4 19 0 28M33 10c4 9 4 19 0 28"/></g><path class="ga" d="M17 6h14v3H17zM17 39h14v3H17z"/><path d="M24 42v4M20 46h8" stroke="#c8372d" stroke-width="3" stroke-linecap="round"/>`,
  gourd: `<path d="M21 3h6v5c4 1 7 4 7 8 0 3-2 5-4 7 6 3 10 8 10 14 0 7-6 10-16 10S8 44 8 37c0-6 4-11 10-14-2-2-4-4-4-7 0-4 3-7 7-8z"/><path class="ga" d="M19 3h10v4H19z"/><path class="ik" d="M17 33c2 4 12 4 14 0" stroke="#1a1a1f" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`,
  disc: `<path fill-rule="evenodd" d="M24 4a20 20 0 1 0 0 40 20 20 0 0 0 0-40Zm0 14a6 6 0 1 1 0 12 6 6 0 0 1 0-12Z"/><path class="ga" d="M24 44v3M20 47h8" stroke="#c9a227" stroke-width="3" stroke-linecap="round"/><path class="ik" d="M12 14c3-4 7-6 12-6" stroke="#f2ead8" stroke-width="2" fill="none" opacity=".7" stroke-linecap="round"/>`,
  stamp: `<path d="M17 4h14v14c4 1 7 3 7 6v4H10v-4c0-3 3-5 7-6z"/><path class="ga" d="M8 31h32v12H8z"/><path d="M14 36l5 3 5-5 5 5 5-3" stroke="#1a1a1f" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6"/>`,
  pouch: `<path d="M17 4h14l-2 7c8 4 12 11 12 19 0 9-7 14-17 14S7 39 7 30c0-8 4-15 12-19z"/><path class="ga" d="M16 11h16v4H16z"/><path class="ik" d="M17 27c3 4 11 4 14 0M24 20v5" stroke="#1a1a1f" stroke-width="2.2" fill="none" stroke-linecap="round" opacity=".6"/>`,
  // ---- npc / ui
  scroll: `<path d="M10 7h26a4 4 0 0 1 4 4v26a4 4 0 0 0 4 4H14a4 4 0 0 1-4-4z"/><path class="ik" d="M16 15h18M16 22h18M16 29h12" stroke="#1a1a1f" stroke-width="2.4" stroke-linecap="round" opacity=".6"/><path class="ga" d="M6 7a3 3 0 0 1 4-3v6a3 3 0 0 1-4-3z"/>`,
  gate: `<path d="M3 11c10-1 32-1 42 0l-3 5H6z"/><path d="M8 18h32v4H8z"/><path d="M12 22h5v22h-5zM31 22h5v22h-5z"/><path class="ga" d="M18 28h12v3H18z"/>`,
  lotus: `<path d="M24 6c5 6 6 14 0 24-6-10-5-18 0-24Z"/><path d="M10 14c8 2 13 8 14 16C16 29 10 24 10 14ZM38 14c0 10-6 15-14 16 1-8 6-14 14-16Z" opacity=".9"/><path class="ga" d="M5 33c5-2 12-2 19 2 7-4 14-4 19-2-5 8-12 12-19 12S10 41 5 33Z"/>`,
  elder: `<circle cx="24" cy="15" r="8"/><path d="M13 44c0-10 4-17 11-17s11 7 11 17z"/><path class="ga" d="M17 20c0 10 3 17 7 17s7-7 7-17c-4 3-10 3-14 0z" opacity=".95"/><path class="ik" d="M16 11h16" stroke="#1a1a1f" stroke-width="2.6" stroke-linecap="round"/>`,
  note: `<path d="M18 6l22-3v28a7 7 0 1 1-4-6V12L22 14v22a7 7 0 1 1-4-6z"/>`,
  // ---- currency / board (fixed colours so they read the same on paper and on lacquer)
  coin: `<circle cx="24" cy="24" r="20" fill="#d6a92c" stroke="#1a1a1f" stroke-width="2.4"/><circle cx="24" cy="24" r="15.2" fill="none" stroke="#8a6a12" stroke-width="1.6"/><path d="M9 20C12 11 19 7 27 7" fill="none" stroke="#fbe9a3" stroke-width="2.6" stroke-linecap="round" opacity=".85"/><rect x="18.5" y="18.5" width="11" height="11" rx="1.2" fill="#1a1a1f" stroke="#8a6a12" stroke-width="1.2"/><path d="M12 33c2 3 5 5 8 6" fill="none" stroke="#8a6a12" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>`,
  jadeDisc: `<circle cx="24" cy="24" r="20" fill="#4fa58b" stroke="#1a1a1f" stroke-width="2.4"/><circle cx="24" cy="24" r="14.5" fill="none" stroke="#2f7863" stroke-width="1.8"/><path d="M8.5 19C11 11 17 7 25 7" fill="none" stroke="#c9ecdd" stroke-width="2.8" stroke-linecap="round" opacity=".9"/><path d="M14 15c3-3 7-4 11-3M36 30c-2 4-5 6-9 7" fill="none" stroke="#cfeadf" stroke-width="1.5" stroke-linecap="round" opacity=".55"/><circle cx="24" cy="24" r="6.2" fill="#1a1a1f" stroke="#2f7863" stroke-width="1.4"/>`,
  xpStar: `<path d="M24 3c2 10 5 17 8 19 4 1 8 2 13 2-7 1-11 3-13 6-3 3-5 8-8 15-3-7-5-12-8-15-2-3-6-5-13-6 5 0 9-1 13-2 3-2 6-9 8-19Z" fill="#c9a227" stroke="#1a1a1f" stroke-width="2" stroke-linejoin="round"/><circle cx="24" cy="25" r="3.4" fill="#f5eedd" stroke="#1a1a1f" stroke-width="1.2"/>`,
  board: `<path d="M9 8h4v36H9zM35 8h4v36h-4z"/><path d="M5 9h38v5H5z"/><path class="ga" d="M7 11h34" stroke="#c9a227" stroke-width="2" stroke-linecap="round"/><path d="M13 17h22v22H13z" opacity=".95"/><path class="ik" d="M17 21h14M17 26h14M17 31h9" stroke="#1a1a1f" stroke-width="2.2" stroke-linecap="round" opacity=".65"/><circle cx="30" cy="34" r="3" fill="#c8372d"/>`,
};

export type IconName = keyof typeof P;

/** Inline SVG markup for a pictogram. Colours come from CSS (`.ico { color: paper }`, `.ga` gold, `.ik` ink). */
export function icon(name: IconName): string {
  return `<svg class="ico" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${P[name]}</svg>`;
}

const SKILL_ICON: Record<ClassId, IconName[]> = {
  sword: ["slash", "qiwave", "split", "shield"],
  talisman: ["fire", "bolt", "frost", "wind"],
  physician: ["needle", "rain", "burst", "pulse"],
};

export function skillIcon(cls: ClassId, slot: number): string {
  return icon(SKILL_ICON[cls]?.[slot - 1] ?? "slash");
}

export const CLASS_CREST: Record<ClassId, IconName> = { sword: "crestSword", talisman: "crestTalisman", physician: "crestPhysician" };

const ITEM_RULES: Array<[RegExp, IconName]> = [
  [/fiber|bamboo/i, "fiber"],
  [/tail|fur/i, "tail"],
  [/core|rune/i, "core"],
  [/scale|shell/i, "scale"],
  [/gall|antidote|elixir|potion|vial/i, "vial"],
  [/lantern/i, "lantern"],
  [/tonic|gourd|pill/i, "gourd"],
  [/charm|pendant|jade|talisman|amulet/i, "disc"],
  [/seal|stamp|chop/i, "stamp"],
];

export function itemIconName(item: string): IconName {
  for (const [re, n] of ITEM_RULES) if (re.test(item)) return n;
  return "pouch";
}
export function itemIcon(item: string): string { return extraItemIcon(item) ?? icon(itemIconName(item)); }
