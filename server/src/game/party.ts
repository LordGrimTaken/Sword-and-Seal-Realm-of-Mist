// 0.5.0 party (group) system — session-only, up to PARTY_MAX players. Invite -> accept/decline -> join, leave,
// leader migration and disconnect cleanup live here; world.ts only wires the dispatch, tick and login sync.
//
// Parties are keyed by the LIVE Player ids (`Player.partyId`), and membership is dropped the moment a player is
// removed (disconnect), so nothing survives a relog — exactly the "session-only" contract. The server is
// authoritative: the client only asks for an action and receives the resulting state in a `party` ServerMsg.
import type { PartyMemberView, ServerMsg } from "../../../shared/protocol.ts";
import type { Player } from "./types.ts";
import type { World } from "./world.ts";

/** Group size cap (leader + 4). */
export const PARTY_MAX = 5;
/** 0.5.0 shared kill XP: every OTHER living party member of the killer within this range of the corpse gets a share. */
export const KILL_XP_SHARE_RANGE = 45;
/** 0.5.0 shared kill XP: the helper's share of their own kill-XP value for that mob (50%). */
export const KILL_XP_SHARE = 0.5;
/** "Shared hunt: +N XP" is only a quiet nudge for helpers: at most one line per helper every this many seconds. */
const SHARE_MSG_INTERVAL = 12;
/** A pending invitation is withdrawn after this many seconds of sim time. */
const INVITE_TTL = 60;
/** The periodic hp/level resync runs from world.step() on the same 0.5 s cadence as the content tick. */
const SYNC_TICKS = 10;

interface Party { id: number; leaderId: number; memberIds: number[] }
interface Invite { fromId: number; toId: number; at: number }

type PartyMsg = Extract<ServerMsg, { t: "party" }>;

export class PartyManager {
  private parties = new Map<number, Party>();
  private invites: Invite[] = [];
  private nextId = 1;
  /** Last hp/level signature broadcast per party, so the periodic sync only sends when a bar actually moved. */
  private readonly sig = new Map<number, string>();
  /** Players that already received the login-time state (sent with their first snapshot, i.e. after `welcome`). */
  private readonly known = new WeakSet<Player>();
  /** Last "Shared hunt" line per helper, so shared-kill XP never spams the chat (see SHARE_MSG_INTERVAL). */
  private readonly shareMsgAt = new WeakMap<Player, number>();

  constructor(private readonly world: World) {}

  // ---------------------------------------------------------------- dispatch
  /** Handle a client `{t:"party"; a; name?}` message. Every field is validated here; malformed input is ignored. */
  handle(p: Player, msg: { a?: unknown; name?: unknown }) {
    switch (msg.a) {
      case "invite": return this.invite(p, msg.name);
      case "accept": return this.accept(p);
      case "decline": return this.decline(p);
      case "leave": return this.leave(p);
      default: return; // unknown action: ignore
    }
  }

  /** Chat-command bridge for clients: `/invite <name>`, `/accept`, `/decline`, `/leave` (+ `/party` = resync). Returns true when handled. */
  chatCommand(p: Player, text: string): boolean {
    const t = text.trim();
    if (t === "/accept") { this.accept(p); return true; }
    if (t === "/decline") { this.decline(p); return true; }
    if (t === "/leave" || t === "/leaveparty") { this.leave(p); return true; }
    if (t === "/party") { this.sync(p); return true; }
    const m = /^\/invite\s+(.+)$/i.exec(t);
    if (m) { this.invite(p, m[1]); return true; }
    return false;
  }

  /** Login state: sent once per connection with the first snapshot (after `welcome`), then on every change. */
  onLogin(p: Player) {
    if (this.known.has(p)) return;
    this.known.add(p);
    this.sync(p);
  }

  /** Disconnect cleanup: drop the player's membership (leader migration/disband) and every invite they sent or held. */
  onPlayerLeft(p: Player) {
    // Collect the players whose pending invite disappears first: removeMember() also prunes invites involving the leaver.
    const affected = this.invites.filter((i) => i.fromId === p.id || i.toId === p.id)
      .map((i) => (i.fromId === p.id ? i.toId : i.fromId));
    const party = this.partyOf(p);
    if (party) {
      this.removeMember(party, p, { silent: true });
      const left = this.parties.get(party.id);
      if (left) for (const id of left.memberIds) {
        const q = this.world.players.get(id);
        if (q) this.world.sysTo(q, `${p.n} has left the party.`);
      }
    }
    this.invites = this.invites.filter((i) => i.fromId !== p.id && i.toId !== p.id);
    for (const id of affected) { const q = this.world.players.get(id); if (q) this.sync(q); }
  }

  /** Periodic upkeep: expire stale invitations and push a fresh member list when a member's hp/level changed. */
  tick() {
    const now = this.world.time;
    for (const inv of [...this.invites]) {
      if (now - inv.at <= INVITE_TTL) continue;
      this.removeInvite(inv);
      const to = this.world.players.get(inv.toId);
      const from = this.world.players.get(inv.fromId);
      if (to) this.sync(to);
      if (from) this.world.sysTo(from, `Your invitation to ${to?.n ?? "that adventurer"} expired.`);
    }
    for (const party of [...this.parties.values()]) {
      // players that vanished without a cleanup call are removed first (defensive; removePlayer normally handles it)
      for (const id of [...party.memberIds]) {
        const m = this.world.players.get(id);
        if (!m) { const idx = party.memberIds.indexOf(id); if (idx >= 0) party.memberIds.splice(idx, 1); }
        else if (m.partyId !== party.id) m.partyId = party.id; // self-heal a stale pointer
      }
      if (party.memberIds.length === 0) { this.parties.delete(party.id); this.sig.delete(party.id); continue; }
      if (party.leaderId !== undefined && !party.memberIds.includes(party.leaderId)) party.leaderId = party.memberIds[0];
      const signature = party.memberIds.map((id) => {
        const m = this.world.players.get(id);
        return m ? `${id}:${Math.round(m.hp)}:${m.mhp}:${m.lv}` : `${id}:gone`;
      }).join("|");
      if (this.sig.get(party.id) === signature) continue;
      this.sig.set(party.id, signature);
      this.syncAll(party);
    }
  }

  // ---------------------------------------------------------------- state + rendering
  /** Send the current party state (or solo state with the pending invite, if any) to one player. */
  sync(p: Player) {
    const party = this.partyOf(p);
    if (party) {
      this.send(p, { t: "party", members: this.membersOf(party), leader: this.leaderName(party) });
      return;
    }
    const invite = this.invites.find((i) => i.toId === p.id);
    const from = invite ? this.world.players.get(invite.fromId) : undefined;
    this.send(p, { t: "party", members: null, ...(from ? { inviteFrom: from.n } : {}) });
  }

  private syncAll(party: Party) {
    for (const id of party.memberIds) {
      const q = this.world.players.get(id);
      if (q) this.sync(q);
    }
  }

  private send(p: Player, msg: PartyMsg) { p.send(JSON.stringify(msg)); }

  private membersOf(party: Party): PartyMemberView[] {
    const out: PartyMemberView[] = [];
    for (const id of party.memberIds) {
      const m = this.world.players.get(id);
      if (!m) continue;
      out.push({ name: m.n, cls: m.cls, lv: m.lv, hp: Math.round(m.hp), mhp: m.mhp });
    }
    return out;
  }

  private leaderName(party: Party): string {
    return this.world.players.get(party.leaderId)?.n ?? "";
  }

  private partyOf(p: Player): Party | undefined {
    if (p.partyId === undefined) return undefined;
    const party = this.parties.get(p.partyId);
    if (!party) { p.partyId = undefined; return undefined; } // self-heal a stale pointer
    return party;
  }

  private removeInvite(inv: Invite) {
    const i = this.invites.indexOf(inv);
    if (i >= 0) this.invites.splice(i, 1);
  }

  // ---------------------------------------------------------------- invite
  invite(actor: Player, rawName: unknown) {
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!name || name.length > 24) { this.world.sysTo(actor, "Usage: /invite <player name>."); return; }
    const target = this.world.byName.get(name.toLowerCase());
    if (!target) { this.world.sysTo(actor, `No adventurer named "${name}" is online.`); return; }
    if (target.id === actor.id) { this.world.sysTo(actor, "You cannot invite yourself."); return; }
    if (this.partyOf(target)) { this.world.sysTo(actor, `${target.n} is already in a party.`); return; }
    const party = this.partyOf(actor);
    if (party) {
      if (party.leaderId !== actor.id) { this.world.sysTo(actor, "Only the party leader can invite."); return; }
      if (party.memberIds.length >= PARTY_MAX) { this.world.sysTo(actor, `Your party is full (${PARTY_MAX} members max).`); return; }
    }
    if (this.invites.some((i) => i.fromId === actor.id && i.toId === target.id)) {
      this.world.sysTo(actor, `${target.n} already has a pending invitation from you.`);
      return;
    }
    // One incoming invitation per player: the newest replaces any older one.
    this.invites = this.invites.filter((i) => i.toId !== target.id);
    this.invites.push({ fromId: actor.id, toId: target.id, at: this.world.time });
    this.world.sysTo(actor, `You invite ${target.n} to your party.`);
    this.world.sysTo(target, `${actor.n} invites you to a party. Type /accept or /decline.`);
    this.sync(target); // the panel shows the pending invite with accept/decline
  }

  accept(actor: Player) {
    const invite = [...this.invites].reverse().find((i) => i.toId === actor.id);
    if (!invite) { this.world.sysTo(actor, "You have no pending party invitation."); return; }
    this.removeInvite(invite);
    if (this.partyOf(actor)) { this.world.sysTo(actor, "You are already in a party. Leave it first."); this.sync(actor); return; }
    const inviter = this.world.players.get(invite.fromId);
    if (!inviter) { this.world.sysTo(actor, "That invitation is no longer valid."); this.sync(actor); return; }
    let party = this.partyOf(inviter);
    if (!party) {
      // the inviter is solo: accepting forms a new party with the inviter as leader
      party = { id: this.nextId++, leaderId: inviter.id, memberIds: [inviter.id] };
      this.parties.set(party.id, party);
      inviter.partyId = party.id;
    } else if (party.leaderId !== inviter.id) {
      this.world.sysTo(actor, "That invitation is no longer valid."); this.sync(actor); return;
    } else if (party.memberIds.length >= PARTY_MAX) {
      this.world.sysTo(actor, `${inviter.n}'s party is full.`); this.sync(actor); return;
    }
    party.memberIds.push(actor.id);
    actor.partyId = party.id;
    for (const inv of [...this.invites]) if (inv.toId === actor.id) this.removeInvite(inv); // joining cancels other pending invites
    this.world.sysTo(actor, `You join ${inviter.n}'s party.`);
    for (const id of party.memberIds) {
      if (id === actor.id) continue;
      const q = this.world.players.get(id);
      if (q) this.world.sysTo(q, `${actor.n} joins the party.`);
    }
    this.sig.delete(party.id); // force a fresh broadcast
    this.syncAll(party);
  }

  decline(actor: Player) {
    const invites = this.invites.filter((i) => i.toId === actor.id);
    if (!invites.length) { this.world.sysTo(actor, "You have no pending party invitation."); return; }
    for (const inv of invites) {
      this.removeInvite(inv);
      const from = this.world.players.get(inv.fromId);
      if (from) this.world.sysTo(from, `${actor.n} declined your party invitation.`);
    }
    this.sync(actor);
  }

  // ---------------------------------------------------------------- shared kill XP (0.5.0)
  /**
   * Party mates of `killer` that should receive shared kill XP for a mob that died at (x, z): living (not dead),
   * within KILL_XP_SHARE_RANGE of the corpse, and NOT among the players already credited with full kill XP for this
   * kill (`credited`) — which also de-dupes the killer itself. Returns [] for a solo killer, so the whole feature is
   * an early-out on solo kills. Called once per kill from combat.killMob: no per-tick work.
   */
  sharedXpHelpers(killer: Player, x: number, z: number, credited: ReadonlySet<number>): Player[] {
    const party = this.partyOf(killer);
    if (!party) return [];
    const out: Player[] = [];
    for (const id of party.memberIds) {
      if (id === killer.id || credited.has(id)) continue; // never double-grant the killer or an already-credited member
      const q = this.world.players.get(id);
      if (!q || q.st === "dead" || q.hp <= 0) continue; // only living members share the hunt
      if (Math.hypot(q.x - x, q.z - z) > KILL_XP_SHARE_RANGE) continue;
      out.push(q);
    }
    return out;
  }

  /** Quiet, rate-limited "Shared hunt: +N XP" note for a helper (independent of the xp event itself). */
  noteSharedXp(helper: Player, amount: number) {
    const now = this.world.time;
    if (now - (this.shareMsgAt.get(helper) ?? -1e9) < SHARE_MSG_INTERVAL) return;
    this.shareMsgAt.set(helper, now);
    this.world.sysTo(helper, `Shared hunt: +${amount} XP.`);
  }

  // ---------------------------------------------------------------- leave / cleanup
  leave(actor: Player) {
    const party = this.partyOf(actor);
    if (!party) { this.world.sysTo(actor, "You are not in a party."); return; }
    this.removeMember(party, actor, { silent: false });
    this.sync(actor);
  }

  /** Remove one member: announce, migrate the leader, disband when only one would remain. */
  private removeMember(party: Party, member: Player, opts: { silent: boolean }) {
    const idx = party.memberIds.indexOf(member.id);
    if (idx < 0) { member.partyId = undefined; return; }
    party.memberIds.splice(idx, 1);
    member.partyId = undefined;
    // invites involving the leaver are no longer actionable
    const affected = this.invites.filter((i) => i.fromId === member.id || i.toId === member.id)
      .map((i) => (i.fromId === member.id ? i.toId : i.fromId));
    this.invites = this.invites.filter((i) => i.fromId !== member.id && i.toId !== member.id);
    if (!opts.silent) for (const id of affected) { const q = this.world.players.get(id); if (q) this.sync(q); }
    if (party.memberIds.length <= 1) {
      // too small to be a party: the last member is back to solo
      for (const id of party.memberIds) {
        const q = this.world.players.get(id);
        if (!q) continue;
        q.partyId = undefined;
        this.world.sysTo(q, "Your party has disbanded.");
        this.sync(q);
      }
      this.parties.delete(party.id);
      this.sig.delete(party.id);
      if (!opts.silent) this.world.sysTo(member, "Your party has disbanded.");
      return;
    }
    if (party.leaderId === member.id) {
      party.leaderId = party.memberIds[0];
      const leader = this.world.players.get(party.leaderId);
      if (leader) for (const id of party.memberIds) {
        const q = this.world.players.get(id);
        if (q) this.world.sysTo(q, `${leader.n} is now the party leader.`);
      }
    }
    if (!opts.silent) for (const id of party.memberIds) {
      const q = this.world.players.get(id);
      if (q) this.world.sysTo(q, `${member.n} has left the party.`);
    }
    this.sig.delete(party.id);
    this.syncAll(party);
  }
}
