import type { ClassId } from "@shared/protocol";

export const CLASS_INFO: Record<ClassId, { en: string; desc: string }> = {
  sword: { en: "Sword Cultivator", desc: "Melee. Cuts through foes with flowing steel and sword qi." },
  talisman: { en: "Talisman Master", desc: "Ranged. Hurls fire, frost and thunder from inked paper." },
  physician: { en: "Physician", desc: "Support. Mends allies with jade needles and spring rain." },
};

const cp = (n: number) => String.fromCharCode(n);
const CJK_RE = new RegExp(`[${cp(0x3000)}-${cp(0x303f)}${cp(0x3400)}-${cp(0x4dbf)}${cp(0x4e00)}-${cp(0x9fff)}${cp(0xff00)}-${cp(0xffef)}]`, "g");
/** Defensive: server text is English-only, but never let a stray hanzi reach the screen. */
export function plain(s: string): string {
  return s.replace(CJK_RE, "").replace(/\s{2,}/g, " ").replace(/\(\s*\)/g, "").trim();
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
