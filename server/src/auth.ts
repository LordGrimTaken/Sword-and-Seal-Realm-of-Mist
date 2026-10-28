// Password hashing and failed-login throttling. Passwords are never logged or stored in plain text.
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PW_MIN = 4;
export const PW_MAX = 64;
const KEYLEN = 64;

export const validPw = (pw: unknown): pw is string => typeof pw === "string" && pw.length >= PW_MIN && pw.length <= PW_MAX;

export interface PwHash { salt: Buffer; hash: Buffer }

export function hashPw(pw: string): PwHash {
  const salt = randomBytes(16);
  return { salt, hash: scryptSync(pw.normalize("NFKC"), salt, KEYLEN) };
}

export function verifyPw(pw: string, stored: PwHash): boolean {
  const h = scryptSync(pw.normalize("NFKC"), stored.salt, KEYLEN);
  return h.length === stored.hash.length && timingSafeEqual(h, stored.hash);
}

/** Sliding-window failure counter keyed by string (IP or lower-cased name). */
export class FailLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max = 5, private windowMs = 60_000) {}
  private prune(key: string, now: number) {
    const a = this.hits.get(key);
    if (!a) return undefined;
    while (a.length && now - a[0] > this.windowMs) a.shift();
    if (!a.length) { this.hits.delete(key); return undefined; }
    return a;
  }
  blocked(key: string, now = Date.now()) { return (this.prune(key, now)?.length ?? 0) >= this.max; }
  fail(key: string, now = Date.now()) {
    const a = this.prune(key, now) ?? [];
    a.push(now); this.hits.set(key, a);
    if (this.hits.size > 5000) for (const k of this.hits.keys()) this.prune(k, now); // bound memory
  }
  clear(key: string) { this.hits.delete(key); }
}

// ---------------- Launcher session tokens ----------------
export const TOKEN_TTL_S = 300;

/** Secret for token signing: env TOKEN_SECRET, else a random one persisted next to the DB (so restarts keep tokens valid). */
export function loadTokenSecret(dbPath: string, warn: (m: string) => void = console.warn): Buffer {
  const env = process.env.TOKEN_SECRET;
  if (env && env.length >= 8) return Buffer.from(env, "utf8");
  if (env) warn("TOKEN_SECRET is shorter than 8 characters; ignoring it.");
  if (dbPath === ":memory:") { warn("TOKEN_SECRET not set: using a random per-process secret."); return randomBytes(32); }
  const file = join(dirname(dbPath), "token.secret");
  try {
    if (existsSync(file)) { const b = Buffer.from(readFileSync(file, "utf8").trim(), "hex"); if (b.length >= 32) { warn(`TOKEN_SECRET not set: using the generated secret in ${file}. Set TOKEN_SECRET in production.`); return b; } }
    const b = randomBytes(32);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, b.toString("hex") + "\n", { mode: 0o600 });
    warn(`TOKEN_SECRET not set: generated a secret in ${file}. Set TOKEN_SECRET in production.`);
    return b;
  } catch {
    warn("TOKEN_SECRET not set and the secret file is not writable: using a random per-process secret (tokens die on restart).");
    return randomBytes(32);
  }
}

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** HMAC-SHA256 signed, single-use tokens: `base64url(JSON{name,exp,jti}).base64url(hmac)`. exp is in unix seconds. */
export class TokenService {
  private used = new Map<string, number>(); // jti -> exp (s); kept until it can no longer be valid anyway
  constructor(private secret: Buffer, private now: () => number = Date.now, private ttlS = TOKEN_TTL_S) {}
  get ttl() { return this.ttlS; }
  private sig(body: string) { return createHmac("sha256", this.secret).update(body).digest(); }
  issue(name: string): string {
    const body = b64u(JSON.stringify({ name, exp: Math.floor(this.now() / 1000) + this.ttlS, jti: randomUUID() }));
    return `${body}.${b64u(this.sig(body))}`;
  }
  /** Checks signature, expiry and name (case-insensitive) WITHOUT consuming. Returns the payload or undefined. */
  check(tok: unknown, name: string): { name: string; exp: number; jti: string } | undefined {
    if (typeof tok !== "string" || tok.length > 512) return undefined;
    const parts = tok.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return undefined;
    const given = Buffer.from(parts[1], "base64url"), want = this.sig(parts[0]);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return undefined;
    let p: { name?: unknown; exp?: unknown; jti?: unknown };
    try { p = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); } catch { return undefined; }
    if (typeof p.name !== "string" || typeof p.exp !== "number" || typeof p.jti !== "string") return undefined;
    const nowS = this.now() / 1000;
    if (p.exp <= nowS) return undefined;
    if (p.name.toLowerCase() !== name.toLowerCase()) return undefined;
    if (this.used.has(p.jti)) return undefined;
    return { name: p.name, exp: p.exp, jti: p.jti };
  }
  /** Marks a checked token as spent. Returns false if it was already spent. */
  consume(t: { exp: number; jti: string }): boolean {
    const nowS = this.now() / 1000;
    for (const [j, e] of this.used) if (e <= nowS) this.used.delete(j);
    if (this.used.has(t.jti)) return false;
    this.used.set(t.jti, t.exp);
    return true;
  }
  /** check + consume. */
  redeem(tok: unknown, name: string): boolean {
    const t = this.check(tok, name);
    return !!t && this.consume(t);
  }
}
