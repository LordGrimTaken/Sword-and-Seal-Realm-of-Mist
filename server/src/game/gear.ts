// Pure gear helpers (no imports from combat/world, so combat.ts can rely on `p.gear` without import cycles).
import type { GearSlot, GearStats } from "../../../shared/protocol.ts";
import { GEAR_BY_NAME, GEAR_SETS, GEAR_SLOTS, gearSetOf } from "../data.ts";

export const emptyGear = (): GearStats => ({ atk: 0, hp: 0, crit: 0, def: 0 });

/** Sum the bonuses of the equipped items plus any gear-set bonuses. Unknown item names are ignored, and the total damage reduction is capped at 40 %. */
export function sumGear(equipped: ReadonlyMap<GearSlot, string>): GearStats {
  const t = emptyGear();
  const setCounts = new Map<string, number>();
  for (const slot of GEAR_SLOTS) {
    const d = GEAR_BY_NAME.get(equipped.get(slot) ?? "");
    if (!d || d.slot !== slot) continue;
    t.atk += d.stats.atk ?? 0; t.hp += d.stats.hp ?? 0; t.crit += d.stats.crit ?? 0; t.def += d.stats.def ?? 0;
    const sid = gearSetOf(d.name);
    if (sid) setCounts.set(sid, (setCounts.get(sid) ?? 0) + 1);
  }
  for (const s of GEAR_SETS) {
    const n = setCounts.get(s.id) ?? 0;
    for (const tier of s.tiers) if (n >= tier.count) {
      t.atk += tier.stats.atk ?? 0; t.hp += tier.stats.hp ?? 0; t.crit += tier.stats.crit ?? 0; t.def += tier.stats.def ?? 0;
    }
  }
  t.def = Math.min(0.4, Math.round(t.def * 1000) / 1000);
  t.crit = Math.round(t.crit * 1000) / 1000;
  return t;
}
