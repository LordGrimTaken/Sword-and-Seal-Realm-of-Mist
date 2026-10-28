import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { QuestState } from "./game/types.ts";
import type { ClassId, InvItem } from "../../shared/protocol.ts";
import type { PwHash } from "./auth.ts";

/** Legacy hanzi item names -> English (written as \u escapes so the source stays free of CJK). */
export const LEGACY_ITEM_NAMES: Record<string, string> = {
  "\u7af9\u7ea4\u7ef4": "Bamboo Fiber",
  "\u72d0\u5c3e": "Fox Tail",
  "\u7389\u9cde": "Jade Scale",
  "\u86c7\u80c6": "Serpent Gall",
  "\u77f3\u5b88\u4e4b\u6838": "Guardian Core",
  "\u56de\u6625\u4e39": "Healing Tonic",
  "\u7389\u7b26": "Jade Charm",
  "\u83b2\u9732\u89e3\u6bd2\u4e39": "Lotus Antidote",
  "\u83b2\u7b26": "Lotus Charm",
  "\u77f3\u5b88\u5370": "Guardian's Seal",
  "\u4e91\u96fe\u7389\u4f69": "Cloudmist Pendant",
  "\u7eb8\u706f\u7b3c": "Paper Lantern",
};
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/;

/** English name for a stored item name: known hanzi names are translated, hanzi suffixes/parts are stripped; "" if nothing remains. */
export function cleanItemName(raw: string): string {
  const known = LEGACY_ITEM_NAMES[raw.trim()];
  if (known) return known;
  return raw.replace(new RegExp(CJK.source, "g"), "").replace(/\s+/g, " ").trim();
}

export interface CharRow { name: string; cls: ClassId; level: number; xp: number; x: number; z: number }

export class CharacterDb {
  private db: DatabaseSync;
  private qLoad; private qInsert; private qSave; private qQLoad; private qQSave; private qILoad; private qISave; private qIDel;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS characters (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        cls TEXT NOT NULL, level INTEGER NOT NULL, xp INTEGER NOT NULL,
        x REAL NOT NULL, z REAL NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quests (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        stage INTEGER NOT NULL, status INTEGER NOT NULL, progress INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS items (
        name TEXT NOT NULL COLLATE NOCASE, item TEXT NOT NULL, item_zh TEXT NOT NULL, qty INTEGER NOT NULL,
        PRIMARY KEY (name, item)
      );
      CREATE TABLE IF NOT EXISTS accounts (
        name TEXT PRIMARY KEY COLLATE NOCASE,
        salt BLOB NOT NULL, hash BLOB NOT NULL, created INTEGER NOT NULL
      );`);
    // v2 migration (adds the Cleanse the Pond quest as stage 3, so old "Stone Guardian" stage 2 becomes 3).
    const cols = (this.db.prepare("PRAGMA table_info(quests)").all() as unknown as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes("progress2")) {
      this.db.exec("BEGIN");
      try {
        this.db.exec("ALTER TABLE quests ADD COLUMN progress2 INTEGER NOT NULL DEFAULT 0");
        this.db.exec("UPDATE quests SET stage = stage + 1 WHERE stage >= 2");
        this.db.exec("COMMIT");
      } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    }
    // v3 migration: Lantern Keeper Mei's errand state (0 none, 1 accepted, 2 done).
    if (!cols.includes("mei")) this.db.exec("ALTER TABLE quests ADD COLUMN mei INTEGER NOT NULL DEFAULT 0");
    this.migrateItemNames();
    this.qLoad = this.db.prepare("SELECT name, cls, level, xp, x, z FROM characters WHERE name = ?");
    this.qInsert = this.db.prepare("INSERT INTO characters (name, cls, level, xp, x, z, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)");
    this.qSave = this.db.prepare("UPDATE characters SET level = ?, xp = ?, x = ?, z = ?, updated_at = ? WHERE name = ?");
    this.qQLoad = this.db.prepare("SELECT stage, status, progress, progress2, mei FROM quests WHERE name = ?");
    this.qQSave = this.db.prepare(
      "INSERT INTO quests (name, stage, status, progress, progress2, mei, updated_at) VALUES (?,?,?,?,?,?,?) " +
      "ON CONFLICT(name) DO UPDATE SET stage=excluded.stage, status=excluded.status, progress=excluded.progress, progress2=excluded.progress2, mei=excluded.mei, updated_at=excluded.updated_at");
    this.qILoad = this.db.prepare("SELECT item, item_zh AS itemZh, qty FROM items WHERE name = ? ORDER BY rowid");
    this.qISave = this.db.prepare("INSERT INTO items (name, item, item_zh, qty) VALUES (?,?,?,?) ON CONFLICT(name, item) DO UPDATE SET qty=excluded.qty, item_zh=excluded.item_zh");
    this.qIDel = this.db.prepare("DELETE FROM items WHERE name = ? AND item = ?");
  }

  /** v4 migration: rewrite hanzi item names to English (merging into an existing English stack), blank item_zh,
   *  and drop rows whose name still contains CJK and is unknown. Idempotent. */
  private migrateItemNames() {
    const rows = this.db.prepare("SELECT name, item, item_zh AS zh, qty FROM items").all() as unknown as Array<{ name: string; item: string; zh: string; qty: number }>;
    const dirty = rows.filter((r) => CJK.test(r.item) || r.zh !== "");
    if (!dirty.length) return;
    this.db.exec("BEGIN");
    try {
      const del = this.db.prepare("DELETE FROM items WHERE name = ? AND item = ?");
      const up = this.db.prepare("INSERT INTO items (name, item, item_zh, qty) VALUES (?,?,'',?) ON CONFLICT(name, item) DO UPDATE SET qty = MIN(99, qty + excluded.qty), item_zh = ''");
      for (const r of dirty) {
        if (!CJK.test(r.item)) continue;
        del.run(r.name, r.item);
        const english = cleanItemName(r.item);
        if (english) up.run(r.name, english, r.qty);
      }
      this.db.exec("UPDATE items SET item_zh = '' WHERE item_zh <> ''");
      this.db.exec("COMMIT");
    } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }

  loadQuest(name: string): QuestState {
    const r = this.qQLoad.get(name) as unknown as QuestState | undefined;
    return r ? { stage: r.stage, status: r.status, progress: r.progress, progress2: r.progress2 ?? 0, mei: ((r.mei ?? 0) as 0 | 1 | 2) } : { stage: 0, status: 0, progress: 0, progress2: 0, mei: 0 };
  }
  saveQuest(name: string, q: QuestState) { this.qQSave.run(name, q.stage, q.status, q.progress, q.progress2, q.mei, Date.now()); }

  /** Tolerant: legacy hanzi names are mapped to English, unknown CJK-only names are skipped, itemZh is always "". */
  loadInv(name: string): InvItem[] {
    const out: InvItem[] = [];
    for (const r of this.qILoad.all(name) as unknown as InvItem[]) {
      const item = cleanItemName(r.item);
      if (!item) continue;
      const have = out.find((o) => o.item === item);
      if (have) have.qty = Math.min(99, have.qty + r.qty); else out.push({ item, itemZh: "", qty: r.qty });
    }
    return out;
  }
  /** Upsert one stack (qty <= 0 deletes it). */
  saveItem(name: string, it: InvItem) {
    if (it.qty <= 0) this.qIDel.run(name, it.item);
    else this.qISave.run(name, it.item, "", it.qty);
  }

  getAccount(name: string): PwHash | undefined {
    const r = this.db.prepare("SELECT salt, hash FROM accounts WHERE name = ?").get(name) as unknown as { salt: Uint8Array; hash: Uint8Array } | undefined;
    return r ? { salt: Buffer.from(r.salt), hash: Buffer.from(r.hash) } : undefined;
  }
  createAccount(name: string, h: PwHash) {
    this.db.prepare("INSERT INTO accounts (name, salt, hash, created) VALUES (?,?,?,?)").run(name, h.salt, h.hash, Date.now());
  }

  load(name: string): CharRow | undefined {
    return this.qLoad.get(name) as unknown as CharRow | undefined;
  }
  create(r: CharRow) {
    const now = Date.now();
    this.qInsert.run(r.name, r.cls, r.level, r.xp, r.x, r.z, now, now);
  }
  save(r: CharRow) { this.qSave.run(r.level, r.xp, r.x, r.z, Date.now(), r.name); }
  saveMany(rows: CharRow[]) {
    this.db.exec("BEGIN");
    try { for (const r of rows) this.save(r); this.db.exec("COMMIT"); }
    catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  close() { this.db.close(); }
}
