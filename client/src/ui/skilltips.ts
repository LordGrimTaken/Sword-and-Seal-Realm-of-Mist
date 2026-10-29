import type { ClassId, SkillDef } from "@shared/protocol";
import { esc, plain } from "./glyphs";
import type { IconName } from "./icons";

/** Descriptions mirror server/src/data.ts; the client falls back to a generic line per kind if a skill is unknown. */
const DESC: Record<ClassId, string[]> = {
  sword: [
    "A swift, flowing melee cut. Your reliable basic attack.",
    "Looses a crescent of sword qi at a foe in range (130% damage).",
    "A heavy overhead strike that cleaves the target (320% damage).",
    "Wraps you in qi: take 50% less damage for 5 s and recover 10% HP.",
  ],
  talisman: [
    "Hurls a fire talisman at the target from range.",
    "A thunder talisman that strikes every foe in an area.",
    "Seals the target in frost: light damage and slows it.",
    "Light as wind: take 40% less damage for 4 s.",
  ],
  physician: [
    "Flicks a jade needle at the target; weak but cheap.",
    "Gentle rain heals you and allies nearby.",
    "A burst of purifying light that harms foes in an area.",
    "Surges qi through the meridians: restore 40% of max HP.",
  ],
};
const KIND: Record<SkillDef["kind"], string> = { melee: "Melee", bolt: "Ranged", aoe: "Area", heal: "Heal / Buff" };

export function skillDesc(cls: ClassId, sk: SkillDef): string {
  return DESC[cls]?.[sk.id - 1] ?? `${KIND[sk.kind]} skill.`;
}

/** Short glossary shown under a skill tooltip for the terms its text uses. */
const GLOSSARY: Array<[RegExp, string, string]> = [
  [/\bqi\b/i, "Qi", "Jade energy spent by skills and dodge rolls; it regenerates after a short pause."],
  [/slows?\b/i, "Slow", "Reduces the target's movement speed for a few seconds."],
  [/take \d+% less damage/i, "Guard", "Reduces all damage you take while it lasts."],
  [/\ballies\b/i, "Allies", "Players within range of you, including yourself."],
];

export function skillTipHtml(cls: ClassId, sk: SkillDef): string {
  const range = sk.range <= 0 ? "Self" : `${sk.range} m`;
  const desc = skillDesc(cls, sk);
  const terms = GLOSSARY.filter(([re, k]) => re.test(desc) || (!!sk.qi && k === "Qi")).slice(0, 2);
  return `<div class="tn"><b>${esc(plain(sk.name))}</b><i>${sk.id}</i></div>
    <div class="tm">${KIND[sk.kind]} · Cooldown ${sk.cooldown}s · Range ${range}${sk.qi ? ` · ${sk.qi} Qi` : ""}</div>
    <div class="td">${esc(desc)}</div>
    ${terms.map(([, k, d]) => `<div class="tk"><b>${esc(k)}</b> ${esc(d)}</div>`).join("")}
    <div class="tcd"></div>`;
}

/** Buff shown on the player frame when a self-buff skill (slot 4 of sword / talisman) is cast. */
export const BUFFS: Partial<Record<ClassId, { name: string; icon: IconName; ms: number }>> = {
  sword: { name: "Qi Guard", icon: "shield", ms: 5000 },
  talisman: { name: "Wind Step", icon: "wind", ms: 4000 },
};
