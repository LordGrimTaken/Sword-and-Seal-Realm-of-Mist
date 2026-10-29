// Persistence for the 0.4.0 content systems: equipment, side quests, counters, merit seals, discovered places, titles.
// Own tables in the shared sqlite file (own connection, like the economy). All tables are created with IF NOT EXISTS, so an existing
// database simply gains them: no existing table or column is touched.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface SqRow { qid: string; state: number; p0: number; p1: number; p2: number }

export class ContentDb {
  private db: DatabaseSync;
  private q;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS equipment (name TEXT NOT NULL COLLATE NOCASE, slot TEXT NOT NULL, item TEXT NOT NULL, PRIMARY KEY (name, slot));
      CREATE TABLE IF NOT EXISTS sidequests (name TEXT NOT NULL COLLATE NOCASE, qid TEXT NOT NULL, state INTEGER NOT NULL, p0 INTEGER NOT NULL DEFAULT 0, p1 INTEGER NOT NULL DEFAULT 0, p2 INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (name, qid));
      CREATE TABLE IF NOT EXISTS counters (name TEXT NOT NULL COLLATE NOCASE, key TEXT NOT NULL, val INTEGER NOT NULL, PRIMARY KEY (name, key));
      CREATE TABLE IF NOT EXISTS merits (name TEXT NOT NULL COLLATE NOCASE, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (name, id));
      CREATE TABLE IF NOT EXISTS places (name TEXT NOT NULL COLLATE NOCASE, id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (name, id));
      CREATE TABLE IF NOT EXISTS titles (name TEXT NOT NULL COLLATE NOCASE, title TEXT NOT NULL, PRIMARY KEY (name, title));
      CREATE TABLE IF NOT EXISTS profile (name TEXT PRIMARY KEY COLLATE NOCASE, title TEXT NOT NULL DEFAULT '');`);
    const p = (s: string) => this.db.prepare(s);
    this.q = {
      eqLoad: p("SELECT slot, item FROM equipment WHERE name = ?"), eqSet: p("INSERT INTO equipment (name, slot, item) VALUES (?,?,?) ON CONFLICT(name, slot) DO UPDATE SET item = excluded.item"), eqDel: p("DELETE FROM equipment WHERE name = ? AND slot = ?"),
      sqLoad: p("SELECT qid, state, p0, p1, p2 FROM sidequests WHERE name = ?"), sqSet: p("INSERT INTO sidequests (name, qid, state, p0, p1, p2) VALUES (?,?,?,?,?,?) ON CONFLICT(name, qid) DO UPDATE SET state=excluded.state, p0=excluded.p0, p1=excluded.p1, p2=excluded.p2"),
      cLoad: p("SELECT key, val FROM counters WHERE name = ?"), cSet: p("INSERT INTO counters (name, key, val) VALUES (?,?,?) ON CONFLICT(name, key) DO UPDATE SET val = excluded.val"),
      mLoad: p("SELECT id, at FROM merits WHERE name = ?"), mAdd: p("INSERT OR IGNORE INTO merits (name, id, at) VALUES (?,?,?)"),
      pLoad: p("SELECT id FROM places WHERE name = ?"), pAdd: p("INSERT OR IGNORE INTO places (name, id, at) VALUES (?,?,?)"),
      tLoad: p("SELECT title FROM titles WHERE name = ?"), tAdd: p("INSERT OR IGNORE INTO titles (name, title) VALUES (?,?)"),
      prLoad: p("SELECT title FROM profile WHERE name = ?"), prSet: p("INSERT INTO profile (name, title) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET title = excluded.title"),
    };
  }
  loadEquipment(n: string) { return this.q.eqLoad.all(n) as unknown as Array<{ slot: string; item: string }>; }
  setEquipment(n: string, slot: string, item: string | null) { if (item) this.q.eqSet.run(n, slot, item); else this.q.eqDel.run(n, slot); }
  loadQuests(n: string) { return this.q.sqLoad.all(n) as unknown as SqRow[]; }
  saveQuest(n: string, r: SqRow) { this.q.sqSet.run(n, r.qid, r.state, r.p0, r.p1, r.p2); }
  loadCounters(n: string) { return this.q.cLoad.all(n) as unknown as Array<{ key: string; val: number }>; }
  setCounter(n: string, key: string, val: number) { this.q.cSet.run(n, key, val); }
  loadMerits(n: string) { return this.q.mLoad.all(n) as unknown as Array<{ id: string; at: number }>; }
  addMerit(n: string, id: string) { this.q.mAdd.run(n, id, Date.now()); }
  loadPlaces(n: string) { return (this.q.pLoad.all(n) as unknown as Array<{ id: string }>).map((r) => r.id); }
  addPlace(n: string, id: string) { this.q.pAdd.run(n, id, Date.now()); }
  loadTitles(n: string) { return (this.q.tLoad.all(n) as unknown as Array<{ title: string }>).map((r) => r.title); }
  addTitle(n: string, t: string) { this.q.tAdd.run(n, t); }
  loadActiveTitle(n: string): string { return (this.q.prLoad.get(n) as unknown as { title: string } | undefined)?.title ?? ""; }
  setActiveTitle(n: string, t: string) { this.q.prSet.run(n, t); }
  close() { this.db.close(); }
}
