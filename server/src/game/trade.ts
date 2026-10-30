// 0.5.0 player-to-player trading — session-only, server-authoritative, two players at a time. The security model is simple
// and deliberate: an offer is only a REFERENCE (item name + quantity + coin), nothing is removed from a bag when it is
// offered, and the swap re-validates BOTH sides from the live bags/wallets before it moves anything. Every state transition
// (offer/ready/cancel/decline/expiry/death/out-of-range/disconnect) either changes references or ends the session; only the
// final swap touches inventory, so a cancelled trade can never lose or duplicate an item.
//
// Wire contract (additive, protocol stays v3):
//   client -> { t:"trade", a:"request"|"accept"|"decline"|"offer"|"ready"|"cancel", name?, slot?, qty?, coin? }
//   server -> { t:"trade", state: null | { peer, mine:{items,coin,ready}, theirs:{items,coin,ready} }, invitedBy? }
// The state is pushed to both traders on every change and once after login (null when solo). Chat commands mirror the
// important actions: /trade <name>, /trade accept, /trade decline, /trade cancel.
import type { Player } from "./types.ts";
import type { World } from "./world.ts";
import type { InvItem, ServerMsg, TradeItemView, TradeSideView, TradeStateView } from "../../../shared/protocol.ts";
import { INV } from "../data.ts";
import { economy } from "../economy.ts";
import { addItem, invList, invQty, removeItem } from "./inventory.ts";
import { dist } from "./util.ts";

/** A pending invitation is discarded after this many seconds of sim time. */
export const TRADE_REQUEST_TTL = 60;
/** Both players must stay this close for the whole session (matches the "nearby players" rule). */
export const TRADE_RANGE = 6;

interface Side { items: Map<string, number>; coin: number; ready: boolean }
interface Session { id: number; aId: number; bId: number; a: Side; b: Side }
interface Request { fromId: number; toId: number; at: number }

type TradeMsg = Extract<ServerMsg, { t: "trade" }>;

const newSide = (): Side => ({ items: new Map(), coin: 0, ready: false });

export class TradeManager {
  private readonly sessions = new Map<number, Session>();
  /** player id -> the session they are in (both sides are indexed). */
  private readonly byPlayer = new Map<number, number>();
  private requests: Request[] = [];
  private nextId = 1;
  /** Players that already got the login-time state (sent with their first snapshot, i.e. after `welcome`). */
  private readonly known = new WeakSet<Player>();

  constructor(private readonly world: World) {}

  // ---------------------------------------------------------------- dispatch
  /** Handle `{t:"trade"}`. Every field is validated here; malformed input is ignored. */
  handle(p: Player, msg: { a?: unknown; name?: unknown; slot?: unknown; qty?: unknown; coin?: unknown }) {
    switch (msg.a) {
      case "request": return this.request(p, msg.name);
      case "accept": return this.accept(p);
      case "decline": return this.decline(p);
      case "offer": return this.offer(p, msg);
      case "ready": return this.ready(p);
      case "cancel": return this.cancel(p);
      default: return;
    }
  }

  /** Chat-command bridge: `/trade <name>`, `/trade accept`, `/trade decline`, `/trade cancel`. Returns true when handled. */
  chatCommand(p: Player, text: string): boolean {
    const t = text.trim();
    if (/^\/trade\s+accept$/i.test(t)) { this.accept(p); return true; }
    if (/^\/trade\s+decline$/i.test(t)) { this.decline(p); return true; }
    if (/^\/trade\s+cancel$/i.test(t)) { this.cancel(p); return true; }
    const m = /^\/trade\s+(.+)$/i.exec(t);
    if (m) { this.request(p, m[1]); return true; }
    return false;
  }

  /** Login state: sent once per connection with the first snapshot (null unless a session somehow survived a relog — it never does). */
  onLogin(p: Player) {
    if (this.known.has(p)) return;
    this.known.add(p);
    this.sendState(p);
  }

  /** Disconnect: end the session (references only — nothing was ever removed from a bag) and drop pending requests. */
  onPlayerLeft(p: Player) {
    const s = this.sessionOf(p);
    if (s) this.endSession(s, `${p.n} left — trade cancelled. Nothing was moved.`);
    this.requests = this.requests.filter((r) => r.fromId !== p.id && r.toId !== p.id);
  }

  /** 0.5 s upkeep: expire requests, then re-validate sessions (alive, in range, offered items still held, coin still held). */
  tick() {
    const now = this.world.time;
    for (const r of [...this.requests]) {
      if (now - r.at <= TRADE_REQUEST_TTL) continue;
      this.requests = this.requests.filter((x) => x !== r);
      const from = this.world.players.get(r.fromId), to = this.world.players.get(r.toId);
      if (from) { this.world.sysTo(from, `${to?.n ?? "That player"} did not answer your trade request.`); this.sendState(from); }
      if (to) { this.world.sysTo(to, `The trade request from ${from?.n ?? "a player"} expired.`); this.sendState(to); }
    }
    for (const s of [...this.sessions.values()]) {
      const a = this.world.players.get(s.aId), b = this.world.players.get(s.bId);
      if (!a || !b) { this.endSession(s, "Trade cancelled: a trader left."); continue; }
      if (a.st === "dead" || b.st === "dead") { this.endSession(s, "Trade cancelled: a trader fell."); continue; }
      if (dist(a.x, a.z, b.x, b.z) > TRADE_RANGE) { this.endSession(s, "Trade cancelled: you moved too far apart."); continue; }
      const ap = this.problem(a, s.a), bp = this.problem(b, s.b);
      if (ap || bp) { this.endSession(s, `Trade cancelled: ${ap ?? bp}. Nothing was moved.`); continue; }
    }
  }

  // ---------------------------------------------------------------- request / accept / decline
  request(p: Player, rawName: unknown) {
    if (p.st === "dead") return this.world.sysTo(p, "You cannot trade while fallen.");
    if (this.sessionOf(p)) return this.world.sysTo(p, "You are already trading.");
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name) return this.world.sysTo(p, "Use /trade <name> to ask someone to trade.");
    const target = this.world.byName.get(name.toLowerCase());
    if (!target) return this.world.sysTo(p, `No one online is named ${name}.`);
    if (target.id === p.id) return this.world.sysTo(p, "You cannot trade with yourself.");
    if (target.st === "dead") return this.world.sysTo(p, `${target.n} is not available.`);
    if (this.sessionOf(target)) return this.world.sysTo(p, `${target.n} is already trading.`);
    if (dist(p.x, p.z, target.x, target.z) > TRADE_RANGE) return this.world.sysTo(p, `${target.n} is too far away to trade.`);
    this.requests = this.requests.filter((r) => r.fromId !== p.id); // one outgoing request per player: newest replaces
    this.requests.push({ fromId: p.id, toId: target.id, at: this.world.time });
    this.world.sysTo(p, `Trade request sent to ${target.n}.`);
    this.world.sysTo(target, `${p.n} wants to trade with you — /trade accept or /trade decline.`);
    this.sendState(p);
    this.sendState(target, p.n);
  }

  accept(p: Player) {
    const req = [...this.requests].reverse().find((r) => r.toId === p.id);
    if (!req) return this.world.sysTo(p, "You have no pending trade request.");
    this.requests = this.requests.filter((r) => r !== req);
    const from = this.world.players.get(req.fromId);
    if (!from) return this.world.sysTo(p, "That player is no longer here."), this.sendState(p);
    const err = this.sessionBlock(from, p);
    if (err) { this.world.sysTo(p, err); this.world.sysTo(from, err); this.sendState(p); this.sendState(from); return; }
    // Create the session: both sides start with empty offers and no ready flag.
    const s: Session = { id: this.nextId++, aId: from.id, bId: p.id, a: newSide(), b: newSide() };
    this.sessions.set(s.id, s);
    this.byPlayer.set(from.id, s.id);
    this.byPlayer.set(p.id, s.id);
    this.requests = this.requests.filter((r) => r.fromId === from.id || r.toId === from.id || r.fromId === p.id || r.toId === p.id);
    this.world.sysTo(from, `Trading with ${p.n}. Click items in your bag to offer them.`);
    this.world.sysTo(p, `Trading with ${from.n}.`);
    this.sendBoth(s);
  }

  decline(p: Player) {
    const req = [...this.requests].reverse().find((r) => r.toId === p.id);
    if (!req) return this.world.sysTo(p, "You have no pending trade request.");
    this.requests = this.requests.filter((r) => r !== req);
    const from = this.world.players.get(req.fromId);
    if (from) { this.world.sysTo(from, `${p.n} declined your trade request.`); this.sendState(from); }
    this.world.sysTo(p, "Trade request declined.");
    this.sendState(p);
  }

  /** Shared refusal for opening a session (also re-checked at accept time, so a request cannot go stale into a trade). */
  private sessionBlock(a: Player, b: Player): string | null {
    if (a.st === "dead" || b.st === "dead") return "Trade cancelled: a trader fell.";
    if (this.sessionOf(a) || this.sessionOf(b)) return "Trade cancelled: someone is already trading.";
    if (dist(a.x, a.z, b.x, b.z) > TRADE_RANGE) return "Trade cancelled: you are too far apart.";
    return null;
  }

  // ---------------------------------------------------------------- offers / ready
  offer(p: Player, msg: { slot?: unknown; qty?: unknown; coin?: unknown; name?: unknown }) {
    const s = this.sessionOf(p);
    if (!s) return this.world.sysTo(p, "You are not trading.");
    const side = this.sideOf(s, p);
    const other = this.otherSide(s, p);
    if (side.ready || other.ready) { this.unready(s); } // changing an offer always drops both ready flags: no surprise swaps

    let touched = false;
    if (typeof msg.coin === "number") {
      const coin = msg.coin;
      if (!Number.isFinite(coin) || coin < 0 || Math.floor(coin) !== coin) return this.world.sysTo(p, "That coin offer is not valid.");
      if (coin > economy()!.wallet(this.world, p).coin) return this.world.sysTo(p, "You do not have that many coins.");
      side.coin = coin; touched = true;
    }
    // qty 0 + name removes the named offer (used by the client's × button, which cannot rely on a bag index after a change).
    if (msg.qty === 0 && typeof msg.name === "string") {
      if (side.items.delete(msg.name)) touched = true;
    } else if (msg.slot !== undefined || msg.qty !== undefined) {
      const list = invList(p);
      const slot = typeof msg.slot === "number" && Number.isInteger(msg.slot) ? msg.slot : -1;
      if (slot < 0 || slot >= list.length) return this.world.sysTo(p, "That item is not in your bag.");
      const item = list[slot].item;
      const have = invQty(p, item);
      const qty = typeof msg.qty === "number" && Number.isFinite(msg.qty) ? Math.floor(msg.qty) : have;
      if (qty === 0) {
        if (side.items.delete(item)) touched = true;
      } else if (qty < 0) {
        return this.world.sysTo(p, "That quantity is not valid.");
      } else if (side.items.has(item)) {
        return this.world.sysTo(p, `${item} is already offered.`);
      } else if (qty > have) {
        return this.world.sysTo(p, `You do not have ${qty} ${item}.`);
      } else if (this.isEquipped(p, item)) {
        return this.world.sysTo(p, `${item} is equipped and cannot be traded.`);
      } else {
        side.items.set(item, qty); touched = true;
      }
    }
    if (!touched) return;
    // Re-validate both sides after the change: an existing offer may have become stale (e.g. the other side sold something).
    const ap = this.problem(p, side), bp = this.problem(this.peerOf(s, p), other);
    if (ap || bp) {
      this.sessions.delete(s.id); this.byPlayer.delete(s.aId); this.byPlayer.delete(s.bId);
      const msgText = `Trade cancelled: ${ap ?? bp}. Nothing was moved.`;
      for (const id of [s.aId, s.bId]) { const q = this.world.players.get(id); if (q) { this.world.sysTo(q, msgText); this.sendState(q); } }
      return;
    }
    this.sendBoth(s);
  }

  ready(p: Player) {
    const s = this.sessionOf(p);
    if (!s) return this.world.sysTo(p, "You are not trading.");
    const side = this.sideOf(s, p), other = this.otherSide(s, p), peer = this.peerOf(s, p);
    const ap = this.problem(p, side), bp = this.problem(peer, other);
    if (ap || bp) { this.unready(s); this.sendBoth(s); return this.world.sysTo(p, `Cannot confirm: ${ap ?? bp}.`); }
    side.ready = true;
    if (side.ready && other.ready) { this.trySwap(s); return; }
    this.sendBoth(s);
  }

  cancel(p: Player) {
    const s = this.sessionOf(p);
    if (!s) return this.world.sysTo(p, "You are not trading.");
    this.endSession(s, "Trade cancelled. Nothing was moved.");
  }

  // ---------------------------------------------------------------- the swap (the only code that moves items)
  /**
   * Both sides confirmed: re-validate everything from the live bags/wallets, check the receiving packs have room, then move
   * the items and coin. Any failure aborts and restores whatever was already moved, so a trade can never duplicate or lose an
   * item. Item adds/removes go through inventory.ts (persisted + `inv` resent); coin through economy spendCoin/addCoin.
   */
  private trySwap(s: Session) {
    const a = this.world.players.get(s.aId), b = this.world.players.get(s.bId);
    if (!a || !b) return this.endSession(s, "Trade cancelled: a trader left.");
    // NOTE: do NOT use sessionBlock() here: both players ARE in this session by definition. Only the session-independent
    // checks are re-run (both alive and still within range); the offers themselves are validated below from the live bags.
    if (a.st === "dead" || b.st === "dead") return this.endSession(s, "Trade cancelled: a trader fell.");
    if (dist(a.x, a.z, b.x, b.z) > TRADE_RANGE) return this.endSession(s, "Trade cancelled: you are too far apart.");
    const ap = this.problem(a, s.a), bp = this.problem(b, s.b);
    if (ap || bp) { this.unready(s); this.sendBoth(s); return this.world.sysTo(a, `Trade blocked: ${ap ?? bp}. Nothing was moved.`), this.world.sysTo(b, `Trade blocked: ${ap ?? bp}. Nothing was moved.`); }
    const aOut = [...s.a.items], bOut = [...s.b.items];
    // Capacity check BEFORE touching anything: receiving side must fit (its own outgoing items are removed first).
    if (!this.canReceive(a, aOut, bOut) || !this.canReceive(b, bOut, aOut)) {
      this.unready(s);
      const msgText = "Trade blocked: a pack is full. Nothing was moved.";
      this.world.sysTo(a, msgText); this.world.sysTo(b, msgText);
      this.sendBoth(s);
      return;
    }
    const coinA = s.a.coin, coinB = s.b.coin;
    // --- move A -> B, then B -> A. Each move is reversible; any failure reverses both and aborts.
    const movedAB = this.moveItems(a, b, aOut);
    if (!movedAB) { this.unready(s); this.world.sysTo(a, "Trade failed: a bag changed. Nothing was moved."); this.world.sysTo(b, "Trade failed: a bag changed. Nothing was moved."); this.sendBoth(s); return; }
    const movedBA = this.moveItems(b, a, bOut);
    if (!movedBA) {
      this.reverseItems(b, a, movedAB);
      this.unready(s);
      this.world.sysTo(a, "Trade failed: a bag changed. Nothing was moved."); this.world.sysTo(b, "Trade failed: a bag changed. Nothing was moved.");
      this.sendBoth(s);
      return;
    }
    // --- coin: validated above; spend then credit each direction, restoring the first if the second ever fails.
    if (coinA > 0 && !economy()!.spendCoin(this.world, a, coinA)) { this.reverseItems(b, a, movedAB); this.reverseItems(a, b, movedBA); this.unready(s); this.world.sysTo(a, "Trade failed: not enough coin. Nothing was moved."); this.world.sysTo(b, "Trade failed: not enough coin. Nothing was moved."); this.sendBoth(s); return; }
    if (coinB > 0 && !economy()!.spendCoin(this.world, b, coinB)) { if (coinA > 0) economy()!.addCoin(this.world, a, coinA); this.reverseItems(b, a, movedAB); this.reverseItems(a, b, movedBA); this.unready(s); this.world.sysTo(a, "Trade failed: not enough coin. Nothing was moved."); this.world.sysTo(b, "Trade failed: not enough coin. Nothing was moved."); this.sendBoth(s); return; }
    if (coinB > 0) economy()!.addCoin(this.world, a, coinB);
    if (coinA > 0) economy()!.addCoin(this.world, b, coinA);
    // --- done: tell both sides exactly what moved, then clear the state (sendBoth already ends with null).
    const summary = (gave: Array<[string, number]>, gaveCoin: number, got: Array<[string, number]>, gotCoin: number) => {
      const part = (items: Array<[string, number]>, coin: number) => `${items.length ? items.map(([n, q]) => `${q} ${n}`).join(", ") : "nothing"}${coin > 0 ? `${items.length ? " and" : ""} ${coin} coin` : ""}`;
      return `Trade complete: gave ${part(gave, gaveCoin)}, received ${part(got, gotCoin)}.`;
    };
    this.world.sysTo(a, summary(aOut, coinA, bOut, coinB));
    this.world.sysTo(b, summary(bOut, coinB, aOut, coinA));
    this.endSession(s, undefined);
  }

  /** Move `pairs` from `from` to `to`; returns the amounts actually moved, or null (after restoring what it had done) on a shortfall. */
  private moveItems(from: Player, to: Player, pairs: Array<[string, number]>): Array<[string, number]> | null {
    const moved: Array<[string, number]> = [];
    for (const [name, qty] of pairs) {
      const removed = removeItem(this.world, from, name, qty);
      if (removed !== qty) { this.reverseItems(to, from, moved); return null; }
      moved.push([name, removed]);
      const stored = addItem(this.world, to, name, "", removed);
      if (stored !== removed) {
        // A store shortfall should be impossible after canReceive(); undo this item and everything before it.
        removeItem(this.world, to, name, stored);
        addItem(this.world, from, name, "", removed);
        this.reverseItems(to, from, moved.slice(0, -1));
        return null;
      }
    }
    return moved;
  }

  /** Put `moved` back: take the items off `to` and return them to `from`. */
  private reverseItems(to: Player, from: Player, moved: Array<[string, number]>) {
    for (const [name, qty] of moved) {
      removeItem(this.world, to, name, qty);
      addItem(this.world, from, name, "", qty);
    }
  }

  /** Simulate the receiver's bag after its own outgoing items leave: can every incoming stack fit within INV limits? */
  private canReceive(p: Player, outgoing: Array<[string, number]>, incoming: Array<[string, number]>): boolean {
    const qty = new Map<string, number>();
    for (const [name, n] of p.inv) qty.set(name, n.qty);
    for (const [name, n] of outgoing) {
      const left = (qty.get(name) ?? 0) - n;
      if (left > 0) qty.set(name, left); else qty.delete(name);
    }
    for (const [name, n] of incoming) {
      let rem = n;
      const have = qty.get(name) ?? 0;
      if (have > 0) { const add = Math.min(rem, INV.maxStack - have); qty.set(name, have + add); rem -= add; }
      if (rem > 0) {
        if (qty.size >= INV.maxSlots) return false;
        if (rem > INV.maxStack) return false;
        qty.set(name, rem);
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- validation helpers
  /** Why this side's offer is no longer valid (or null). Re-run on every change, on ready and again inside the swap. */
  private problem(p: Player, side: Side): string | null {
    for (const [name, qty] of side.items) {
      if (qty <= 0) return "an invalid offer";
      if (invQty(p, name) < qty) return `${p.n} no longer has ${qty} ${name}`;
      if (this.isEquipped(p, name)) return `${name} is equipped`;
    }
    if (!Number.isInteger(side.coin) || side.coin < 0) return "an invalid coin offer";
    if (economy()!.wallet(this.world, p).coin < side.coin) return `${p.n} no longer has ${side.coin} coin`;
    return null;
  }

  /** Equipped gear is never in the bag (equipping removes it), so this is a belt-and-braces guard against stale references. */
  private isEquipped(p: Player, item: string): boolean {
    if (!p.cx) return false;
    for (const worn of p.cx.equipped.values()) if (worn === item) return true;
    return false;
  }

  private sessionOf(p: Player): Session | null {
    const id = this.byPlayer.get(p.id);
    return id === undefined ? null : this.sessions.get(id) ?? null;
  }
  private sideOf(s: Session, p: Player): Side { return s.aId === p.id ? s.a : s.b; }
  private otherSide(s: Session, p: Player): Side { return s.aId === p.id ? s.b : s.a; }
  private peerOf(s: Session, p: Player): Player {
    const id = s.aId === p.id ? s.bId : s.aId;
    return this.world.players.get(id) ?? p; // a departed peer is handled by the tick/end paths before this matters
  }
  private unready(s: Session) { s.a.ready = false; s.b.ready = false; }

  // ---------------------------------------------------------------- state push / teardown
  private sendState(p: Player, invitedBy?: string) {
    const s = this.sessionOf(p);
    let state: TradeStateView | null = null;
    if (s) {
      const peer = this.world.players.get(s.aId === p.id ? s.bId : s.aId);
      const mine = this.sideView(p, this.sideOf(s, p));
      const theirs = peer ? this.sideView(peer, this.otherSide(s, p)) : { items: [], coin: 0, ready: false };
      state = { peer: peer?.n ?? "a player", mine, theirs };
    }
    const msg: TradeMsg = { t: "trade", state };
    if (invitedBy) msg.invitedBy = invitedBy;
    p.send(JSON.stringify(msg));
  }

  /** Echo one side: the authoritative reference is name+qty; slot is only the item's current bag index for the UI. */
  private sideView(owner: Player, side: Side): TradeSideView {
    const slots = new Map<string, number>();
    invList(owner).forEach((it: InvItem, i: number) => slots.set(it.item, i));
    const items: TradeItemView[] = [...side.items].map(([name, qty]) => ({ slot: slots.get(name) ?? -1, name, qty, zh: "" }));
    return { items, coin: side.coin, ready: side.ready };
  }

  private sendBoth(s: Session) {
    for (const id of [s.aId, s.bId]) { const p = this.world.players.get(id); if (p) this.sendState(p); }
  }

  /** Close a session: drop the references, tell both players (when there is a reason) and push state null. */
  private endSession(s: Session, message?: string) {
    if (!this.sessions.delete(s.id)) return;
    this.byPlayer.delete(s.aId); this.byPlayer.delete(s.bId);
    for (const id of [s.aId, s.bId]) {
      const p = this.world.players.get(id);
      if (!p) continue;
      if (message) this.world.sysTo(p, message);
      this.sendState(p);
    }
  }
}
