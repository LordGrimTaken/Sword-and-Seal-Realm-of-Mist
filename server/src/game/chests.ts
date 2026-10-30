// 0.5.0 treasure caches — a small exploration loop. Six fixed caches sit in interesting corners of Cloudmist Valley;
// a player who walks up (within CHEST_OPEN_RANGE) can open a ready one for a small coin + material roll (plus a rare
// fine-gear find), and it refills after CHEST_RESPAWN_SECONDS. State is SESSION-ONLY and global to the World (no DB,
// no Player fields); the client hears about it through its own tiny `chests` message, never through the entity /
// snapshot / interest path. World only wires dispatch, the 0.5 s upkeep tick and the login push.
import type { ChestStateView, ServerMsg } from "../../../shared/protocol.ts";
import { GEAR, MATERIALS } from "../data.ts";
import { ecoLoot, economy } from "../economy.ts";
import { addItem } from "./inventory.ts";
import type { Player } from "./types.ts";
import type { World } from "./world.ts";
import { rand } from "./util.ts";

export interface ChestSpot { id: number; name: string; x: number; z: number }

/** Fixed cache spots (one per landmark): bamboo grove, pond shore, fox hills, shrine, misty hollow, south-east reed bank. */
export const CHEST_SPOTS: ChestSpot[] = [
  { id: 1, name: "grove cache", x: -42, z: 14 },
  { id: 2, name: "pond-shore cache", x: 12, z: -54 },
  { id: 3, name: "fox-hill cache", x: 60, z: 34 },
  { id: 4, name: "shrine cache", x: -9, z: 78 },
  { id: 5, name: "misty-hollow cache", x: -48, z: -64 },
  { id: 6, name: "reed-bank cache", x: 54, z: -44 },
];

/** How close the player must stand to a cache to open it (world units). */
export const CHEST_OPEN_RANGE = 3.5;
/** Seconds until an opened cache is ready again. */
export const CHEST_RESPAWN_SECONDS = 120;
/** Near a cache this close, the players hear about it respawning (a quiet nudge, not a broadcast). */
const RESPAWN_NOTICE_RANGE = 22;
/** Coin roll (inclusive whole numbers). */
const COIN_MIN = 15;
const COIN_MAX = 30;
/** Chance that a cache also holds a 1-2 stack material roll, and a fine piece of gear. */
const EXTRA_MATERIAL_CHANCE = 0.5;
const FINE_GEAR_CHANCE = 0.2;

/** TEST_MODE only (like TEST_BOSS_RESPAWN): shorten the refill timer so a probe can observe the respawn. */
const respawnSeconds = () =>
  process.env.TEST_MODE === "1" && Number(process.env.TEST_CHEST_RESPAWN) > 0
    ? Number(process.env.TEST_CHEST_RESPAWN)
    : CHEST_RESPAWN_SECONDS;

interface ChestState { spot: ChestSpot; ready: boolean; readyAt: number; openedBy: number }

export class ChestManager {
  private readonly chests: ChestState[];
  /** Players that already received the login-time snapshot (sent with their first snapshot, after `welcome`). */
  private readonly known = new WeakSet<Player>();
  /** All existing material names (the caches never invent new items). */
  private readonly materialPool: string[];

  constructor(private readonly world: World) {
    this.chests = CHEST_SPOTS.map((spot) => ({ spot, ready: true, readyAt: 0, openedBy: 0 }));
    this.materialPool = MATERIALS.map((m) => m.name);
  }

  /** Wire shape: fixed, small, no interest filtering needed. */
  private view(): ChestStateView[] {
    return this.chests.map((c) => ({ id: c.spot.id, x: c.spot.x, z: c.spot.z, ready: c.ready }));
  }

  private send(json: string, p: Player) { p.send(json); }

  private broadcast() {
    const json = JSON.stringify({ t: "chests", chests: this.view() } satisfies ServerMsg);
    for (const p of this.world.players.values()) this.send(json, p);
  }

  /** Login state: sent once per connection with the first snapshot (same pattern as the other 0.5.0 pushes). */
  onLogin(p: Player) {
    if (this.known.has(p)) return;
    this.known.add(p);
    this.send(JSON.stringify({ t: "chests", chests: this.view() } satisfies ServerMsg), p);
  }

  /** 0.5 s upkeep (called from world.step): refresh opened caches and push the state when one comes back. */
  tick() {
    let changed = false;
    for (const c of this.chests) {
      if (c.ready || this.world.time < c.readyAt) continue;
      c.ready = true;
      c.readyAt = 0;
      c.openedBy = 0;
      changed = true;
      for (const p of this.world.players.values()) {
        if (p.st === "dead") continue;
        if (Math.hypot(p.x - c.spot.x, p.z - c.spot.z) > RESPAWN_NOTICE_RANGE) continue;
        this.world.sysTo(p, `A ${c.spot.name} is ready again nearby.`);
      }
    }
    if (changed) this.broadcast();
  }

  /** Client `{t:"openchest", id}`: range + readiness are validated here; the client only asks. */
  open(p: Player, rawId: unknown) {
    const id = typeof rawId === "number" && Number.isFinite(rawId) ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
    const chest = this.chests.find((c) => c.spot.id === id);
    if (!chest) return; // unknown cache id: ignore
    if (p.st === "dead") return; // a fallen player cannot open anything
    if (!chest.ready) { this.world.sysTo(p, "That cache is already empty."); return; }
    if (Math.hypot(p.x - chest.spot.x, p.z - chest.spot.z) > CHEST_OPEN_RANGE) {
      this.world.sysTo(p, "The cache is too far away.");
      return;
    }
    chest.ready = false;
    chest.readyAt = this.world.time + respawnSeconds();
    chest.openedBy = p.id;
    this.broadcast(); // everyone sees the lid close/empty state; a respawn later broadcasts too
    this.world.sysTo(p, `You open the ${chest.spot.name}.`);
    this.grant(p);
  }

  /** Small reward on the existing loot/coin paths: coin, 1-2 material stacks, and a small chance of fine gear. */
  private grant(p: Player) {
    const coin = Math.floor(rand(COIN_MIN, COIN_MAX + 1));
    economy()?.addCoin(this.world, p, coin);
    this.world.sysTo(p, `You found ${coin} coin.`);
    const stacks = Math.random() < EXTRA_MATERIAL_CHANCE ? 2 : 1;
    for (let i = 0; i < stacks; i++) this.giveItem(p, this.materialPool[Math.floor(Math.random() * this.materialPool.length)], 1 + Math.floor(Math.random() * 2));
    if (Math.random() < FINE_GEAR_CHANCE) {
      const pool = GEAR.filter((g) => g.rarity === "fine" && (!g.cls || g.cls === p.cls)); // class-agnostic or usable by the opener
      if (pool.length) {
        const gear = pool[Math.floor(Math.random() * pool.length)];
        if (this.giveItem(p, gear.name, 1)) this.world.sysTo(p, `Rare find: ${gear.name}!`);
      }
    }
  }

  /** Shared item-grant path: bag add + the normal `loot` event (the client's loot toast/sound) + daily loot progress. */
  private giveItem(p: Player, item: string, qty: number): boolean {
    const stored = addItem(this.world, p, item, "", qty);
    if (stored <= 0) { this.world.sysTo(p, `Your pack is full; ${item} was left behind.`); return false; }
    this.world.emitTo(p, { k: "loot", item, itemZh: "", qty: stored });
    ecoLoot(this.world, p, item, stored);
    return true;
  }
}
