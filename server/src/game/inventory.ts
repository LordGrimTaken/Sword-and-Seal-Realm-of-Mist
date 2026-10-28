// Per-character inventory. Stacks keyed by English item name; capped (INV.maxStack per stack, INV.maxSlots stacks).
// Every change is persisted (World.onInvChange) and the full list is pushed to the client as `{t:"inv"}`.
import type { InvItem, ServerMsg } from "../../../shared/protocol.ts";
import { INV } from "../data.ts";
import type { Player } from "./types.ts";
import type { World } from "./world.ts";

export const invList = (p: Player): InvItem[] => [...p.inv.values()].map((i) => ({ item: i.item, itemZh: "", qty: i.qty }));
export const invQty = (p: Player, item: string) => p.inv.get(item)?.qty ?? 0;

export function sendInv(p: Player) {
  p.send(JSON.stringify({ t: "inv", items: invList(p) } satisfies ServerMsg));
}

/** Adds up to qty; returns how many were actually stored (0 when the pack/stack is full). */
export function addItem(w: World, p: Player, item: string, _itemZh: string, qty: number): number {
  let st = p.inv.get(item);
  if (!st && p.inv.size >= INV.maxSlots) return 0;
  if (!st) { st = { item, itemZh: "", qty: 0 }  /* deprecated Zh field is always empty */; p.inv.set(item, st); }
  const add = Math.max(0, Math.min(qty, INV.maxStack - st.qty));
  if (add <= 0) { if (st.qty === 0) p.inv.delete(item); return 0; }
  st.qty += add;
  w.onInvChange?.(p, st);
  sendInv(p);
  return add;
}

/** Removes up to qty; returns how many were removed. */
export function removeItem(w: World, p: Player, item: string, qty: number): number {
  const st = p.inv.get(item);
  if (!st) return 0;
  const n = Math.min(qty, st.qty);
  if (n <= 0) return 0;
  st.qty -= n;
  if (st.qty <= 0) p.inv.delete(item);
  w.onInvChange?.(p, { item, itemZh: "", qty: st.qty });
  sendInv(p);
  return n;
}
