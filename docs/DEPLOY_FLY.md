# Deploying the public server on Fly.io

Result: the game server runs as **one** Fly machine (app `sword-and-seal-play`, region `iad`) at `https://play.swordandseal.com` (HTTP `/health`, `/api/auth/*`) and `wss://play.swordandseal.com` (game WebSocket). Characters live in SQLite on a 1 GB Fly volume mounted at `/data`; a nightly copy goes to a private Cloudflare R2 bucket.

Files (all new, nothing in `server/`, `client/`, `launcher/`, `website/`, `shared/` was changed):

| File | Purpose |
|---|---|
| `Dockerfile.server`, `.dockerignore` | multi-stage image: builds the esbuild bundle, runs it on `node:22-slim` |
| `deploy/fly/fly.toml` | app config (1 machine, volume, health check, env) |
| `deploy/fly/supervisor.mjs` | PID 1: forwards SIGTERM to the server, chowns the volume then drops to uid 1000, runs nightly backups, applies a staged restore |
| `deploy/fly/first-time-setup.sh` | creates app, volume, secrets, first deploy, certificate; prints DNS records |
| `deploy/fly/deploy.sh` | deploy, status, logs, releases, rollback, smoke test |
| `deploy/fly/smoke.mjs` | `/health` + real WebSocket login |
| `deploy/fly/backup/` | `s3.mjs` (SigV4 client, no deps), `backup.mjs`, `restore.mjs`, `test-backup.mjs` |
| `.github/workflows/deploy-server.yml` | tag `server-v*` or manual deploy, tests first |

## Owner steps, in order

1. **Fly account.** Sign up at fly.io and add a payment method (a card is required before apps can run).
2. **Install flyctl** (macOS/Linux: `curl -L https://fly.io/install.sh | sh`; Windows: `pwsh -Command "iwr https://fly.io/install.ps1 -useb | iex"`), then `flyctl auth login`.
3. **Cloudflare R2 backup bucket** (do this before step 4 so backups are on from the first boot; can be added later):
   - Cloudflare dashboard > R2 > create a bucket named `sword-and-seal-backups`. Leave **public access OFF** and do not attach a custom domain. (The existing `sword-and-seal-downloads` bucket is public through `dl.swordandseal.com`, never put backups there.)
   - R2 > Manage API tokens > create an **Object Read & Write** token scoped to *only* `sword-and-seal-backups`. Note Account ID, Access Key ID, Secret Access Key.
4. **Run setup** from the repo root:
   ```bash
   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... deploy/fly/first-time-setup.sh
   ```
   (omit the three R2 variables to skip backups for now). It is idempotent: creates the app, one 1 GB volume `game_data`, generates `TOKEN_SECRET` with `openssl rand -hex 32` (never printed), stages the R2 secrets, deploys, requests the certificate and prints the DNS records. Remote builder: no local Docker needed.
5. **DNS in Cloudflare** (zone `swordandseal.com`). Create:

   | Type | Name | Target | Proxy |
   |---|---|---|---|
   | CNAME | `play` | `sword-and-seal-play.fly.dev` | **DNS only (grey cloud)** |
   | CNAME | `_acme-challenge.play` | the value `flyctl certs setup play.swordandseal.com -a sword-and-seal-play` prints (looks like `play.swordandseal.com.<id>.flydns.net`) | DNS only |

   The `_acme-challenge` record is optional with a grey `play` record (Fly validates over HTTP), and required for issuing/renewing while `play` is proxied. Creating it up front costs nothing. Then `flyctl certs check play.swordandseal.com -a sword-and-seal-play` until it says issued (usually under a minute after DNS propagates).

   **Grey vs orange cloud for WebSockets.** Cloudflare can proxy WebSockets on every plan, so orange works, but for this game grey is the recommendation: (a) Fly already terminates TLS and speaks WebSocket natively; (b) with the orange cloud the player IP seen by Fly (`Fly-Client-IP`) is a Cloudflare edge address, so the per-IP login limiter would again lump players together unless the server is also taught to trust `CF-Connecting-IP`; (c) one fewer hop for a 20 Hz game. Switch to orange only if you need Cloudflare DDoS/WAF in front: set SSL/TLS mode to *Full (strict)*, keep the `_acme-challenge` record, and adapt the server patch below to `CF-Connecting-IP`. If you want the assistant to create these records through the Cloudflare API, run step 4 first and tell it the app exists.
6. **Verify:**
   ```bash
   curl -s https://play.swordandseal.com/health            # {"ok":true,"players":0,"version":"0.3.0",...}
   node deploy/fly/smoke.mjs https://play.swordandseal.com  # /health + real wss login, "SMOKE PASS"
   ```
   The smoke test registers a throwaway character `smoke-xxxx`.
   Point the launcher at it (`apiBaseUrl` and `gameServerUrl` in `launcher/config.json`, see `docs/LAUNCHER.md`). The launcher sends no `Origin` header, so it needs no CORS entry and **`ALLOW_NULL_ORIGIN` stays unset**.
7. **Backups on** (if you skipped them in step 4): `flyctl secrets set R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... -a sword-and-seal-play` (restarts the machine). The supervisor checks hourly; the first backup is taken about 90 s after boot, then one per UTC day after 03:30. Confirm: `flyctl ssh console -a sword-and-seal-play -C "node /app/backup/backup.mjs list"`.
8. **CI deploy token** (optional): `flyctl tokens create deploy -a sword-and-seal-play`, then GitHub repo > Settings > Secrets and variables > Actions > new secret `FLY_API_TOKEN`. Release with `git tag server-v0.3.1 && git push origin server-v0.3.1`, or Actions > deploy-server > Run workflow. The token is scoped to this one app. The workflow runs the server test suite and the backup test first.

## Accounts and secrets needed

| What | Where it lives |
|---|---|
| Fly.io account + card | you |
| `TOKEN_SECRET` | Fly secret, generated by the script. Do not rotate casually: it only invalidates 5-minute launcher tokens, but it does log launcher sessions out. (If unset the server falls back to a file `/data/token.secret`; production should use the secret.) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Fly secrets; token scoped to the private bucket only |
| `FLY_API_TOKEN` | GitHub Actions secret (deploy token) |
| Cloudflare DNS edit access | for the two CNAMEs |

## Before opening to the public (checklist)

- [ ] `TEST_MODE` is not set anywhere. `deploy.sh` refuses to deploy if it is in `fly.toml` or in `flyctl secrets list`. (With it set, chat accepts `/testgive`, `/testlevel` etc. for everyone.)
- [ ] `flyctl secrets list -a sword-and-seal-play` shows `TOKEN_SECRET` (and the three `R2_*`).
- [ ] **Client-IP patch applied** (next section). Without it, every player shares one rate-limit bucket.
- [ ] **Restore drill done** (section below) at least once, from a backup made by the production machine.
- [ ] `flyctl status` shows 1 machine, health check passing; `flyctl volumes list` shows exactly one volume.
- [ ] `https://play.swordandseal.com/health` over HTTPS, smoke test passes from a machine outside your network.
- [ ] `CORS_ORIGINS` lists exactly the web origins that call `/api/auth` from a browser (set in `fly.toml`).
- [ ] Billing alert set in the Fly dashboard.

## Rate limiting behind Fly's proxy (server change needed, not applied)

`server/src/server.ts` keys the failed-login limiter (5 per 60 s per IP), the registration limiter (10 per 60 s per IP) and `Session.ip` on `req.socket.remoteAddress` (lines ~95 and ~152). Behind Fly's edge proxy that is the proxy's address, so **all players share one bucket**: five typos by anyone lock logins for everybody for a minute, and 10 registrations per minute total are allowed. It also makes server logs useless for abuse. Fly's proxy sets `Fly-Client-IP` to the real client address (and overwrites a client-supplied value); machines are not reachable except through the proxy or Fly's private network, so trusting it there is safe. It must stay opt-in, because on a bare server (local play, the Electron-embedded server) a client could forge the header.

Proposed minimal patch (verified to apply cleanly with `patch -p1` to the current `server.ts`; `fly.toml` already sets `TRUST_FLY_CLIENT_IP=1`, which today's server simply ignores):

```diff
--- a/server/src/server.ts
+++ b/server/src/server.ts
@@ -41,6 +41,12 @@
 const regIp = new FailLimiter(10, 60_000); // account creations per IP (scrypt is CPU heavy)
 const CORS_ORIGINS = new Set((process.env.CORS_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean));
 const ALLOW_NULL_ORIGIN = process.env.ALLOW_NULL_ORIGIN === "1";
+// Behind Fly's proxy the socket peer is the proxy. Fly sets Fly-Client-IP (overwriting any client-supplied value); only trust it when explicitly enabled.
+const TRUST_FLY_CLIENT_IP = process.env.TRUST_FLY_CLIENT_IP === "1";
+const clientIp = (req: IncomingMessage): string => {
+  const h = TRUST_FLY_CLIENT_IP ? req.headers["fly-client-ip"] : undefined;
+  return (typeof h === "string" && h.length <= 64 ? h : req.socket.remoteAddress) ?? "?";
+};
 const VERSION = (() => {
   for (const f of ["../../VERSION", "../VERSION", "../package.json"]) {
     try { const t = readFileSync(resolve(import.meta.dirname, f), "utf8").trim(); if (f.endsWith("json")) return String(JSON.parse(t).version); if (t) return t; } catch { /* next */ }
@@ -92,7 +98,7 @@
 }
 
 async function handleAuth(req: IncomingMessage, res: ServerResponse, kind: "register" | "login") {
-  const ip = req.socket.remoteAddress ?? "?";
+  const ip = clientIp(req);
   const ct = String(req.headers["content-type"] ?? "").toLowerCase();
   if (!ct.startsWith("application/json")) { req.resume(); return apiErr(req, res, 415, "Content-Type must be application/json."); }
   const raw = await readBody(req);
@@ -149,7 +155,7 @@
 
 wss.on("connection", (ws, req) => {
   if (sessions.size >= TUNING.maxPlayers * 2) { sendMsg(ws, { t: "error", msg: "Server is full" }); ws.close(1013); return; }
-  const s: Session = { ip: req.socket.remoteAddress ?? "?", ws, alive: true, missed: 0, bucket: new TokenBucket(100, 60), strikes: 0, loginBusy: false };
+  const s: Session = { ip: clientIp(req), ws, alive: true, missed: 0, bucket: new TokenBucket(100, 60), strikes: 0, loginBusy: false };
   sessions.add(s);
   s.loginTimer = setTimeout(() => { if (!s.player) ws.close(1008, "login timeout"); }, 10_000);
   ws.on("pong", () => { s.alive = true; s.missed = 0; });
```

No other server change is required. (The graceful shutdown already exists: SIGTERM/SIGINT run `shutdown()`, which broadcasts "The server is shutting down.", saves every player, closes sockets with code 1001 and closes the DB; verified below.)

## Backups and restore

- **What:** `VACUUM INTO` a temp file (a transactionally consistent, defragmented copy that is safe while the server has the WAL database open), `PRAGMA integrity_check` on the copy, gzip, upload with an `x-amz-meta-sha256`. Keys: `backups/daily/YYYY-MM-DD.db.gz`; every Sunday the same file is also stored as `backups/weekly/YYYY-Www.db.gz`. Retention: newest **14 daily + 8 weekly**.
- **How:** `supervisor.mjs` (in the same machine) checks hourly and runs `backup.mjs run --due` (spawned per run, nothing resident). No extra Fly machine, so no extra cost. Logs show lines tagged `[backup]`. A failure exits non-zero and is logged; watch for `[backup] FAILED` in `flyctl logs`.
- Fly also snapshots the volume daily (5 day retention by default) as a second layer.
- **Manual backup / list:** `flyctl ssh console -a sword-and-seal-play -C "node /app/backup/backup.mjs run"` and `... backup.mjs list`.

### Restore drill (do before launch, repeat quarterly)

```bash
# 1. verify the newest backup downloads, matches its sha256 and passes PRAGMA integrity_check (touches nothing live)
flyctl ssh console -a sword-and-seal-play -C "node /app/backup/restore.mjs --out /tmp/drill.db"
# prints: restored backups/daily/... / integrity_check: ok / row counts: {"characters": N, ...}

# 2. real restore (disaster only): stage the file next to the DB, then restart. On boot the supervisor keeps the old DB as
#    game.db.pre-restore-<time> and moves restore.db into place.
flyctl ssh console -a sword-and-seal-play -C "node /app/backup/restore.mjs --out /data/restore.db --key backups/daily/2026-11-01.db.gz"
flyctl machine restart $(flyctl machines list -a sword-and-seal-play --json | python3 -c "import sys,json;print(json.load(sys.stdin)[0]['id'])") -a sword-and-seal-play
flyctl logs -a sword-and-seal-play    # look for "[supervisor] RESTORED"
```
To restore on a fresh machine/volume (volume lost): `first-time-setup.sh`, then do step 2.

## Operations

- **Logs:** `deploy/fly/deploy.sh logs` (= `flyctl logs -a sword-and-seal-play`). Lines: `join`/`leave ... players=N`, `heartbeat timeout`, `movement kick`, `[backup]`, `[supervisor]`.
- **Status:** `deploy/fly/deploy.sh status`; `flyctl checks list`; `curl -s https://play.swordandseal.com/health` gives players, tick, entities, `droppedSnaps`, `rss`.
- **Metrics:** Fly dashboard > app > Metrics (Grafana: CPU, memory, connections, bandwidth). Watch memory against 512 MB and `droppedSnaps` in `/health` (a rising value means clients on slow links, or CPU starvation).
- **Alerting:** the `GET /health` check runs every 15 s. A failing check takes the machine out of Fly's routing and shows red in `flyctl status` / the dashboard; it does not by itself restart the machine. A crash or exit of the game server makes the supervisor exit, and Fly restarts the machine. Fly does not email you about failing checks on its own: point an external monitor (Better Stack, UptimeRobot, Cloudflare Health Checks) at `https://play.swordandseal.com/health` for paging, and optionally enable Fly's dashboard notifications for deploy/machine events.
- **Deploying a new version safely:** (1) pick a quiet hour (`/health` `players`), (2) say it in your channel ("restart in 5 min"), (3) `deploy/fly/deploy.sh`. Fly sends SIGTERM; the server announces "The server is shutting down.", saves all players, closes sockets with 1001 and exits; Fly kills it only after 15 s. Expect 20-40 s of downtime (single machine, volume attached, so no blue/green). Clients must reconnect. Progress lost: nothing since the last save, the final save happens on SIGTERM (autosave every 30 s is the fallback for a hard crash, losing up to 30 s). Then `deploy/fly/deploy.sh smoke`.
- **Rollback:** `deploy/fly/deploy.sh releases` lists images; `deploy/fly/deploy.sh rollback registry.fly.io/sword-and-seal-play:deployment-XXXX`. Database schema changes are additive in this server (new columns via `ALTER TABLE`); a rollback after a schema change keeps the new columns, which older code ignores. Take a manual backup before any release that touches `db.ts`.
- **Secrets:** `flyctl secrets set NAME=value -a sword-and-seal-play` (restarts). Values are never printed by these scripts.

## Sizing and cost

- **Why one machine:** SQLite is a single file on a volume, and a volume attaches to one machine. The world is one in-memory simulation. A second machine would be a second world with its own empty database, so `--ha=false` is passed everywhere and there is one `[[mounts]]`. Scale **up** (`[[vm]]` memory/CPU), not out.
- **Why shared-cpu-1x / 512 MB:** measured here with the production bundle: ~67 MB RSS idle, 112 MB after the 60-check bot suite, 120 MB after 60 s of the 3-bot soak (`npm run soak`, RSS growth is checked by that test). Per-player state is small and entities are a fixed set, so 100 players (the server's cap) is expected to fit comfortably, but **100 concurrent clients were not load tested**; 256 MB would probably also run, 512 MB leaves headroom for the OS, V8 and the backup child. The 20 Hz tick is single threaded; shared-cpu is burstable, so if `/health` `tick` falls behind wall clock under load, move to `performance-1x`.
- **Bandwidth measured:** one idle player at spawn receives ~11 KB/s (10.4 messages/s). 20 players online all day is ~20 GB/day, 100 players ~4 GB/hour (estimate: it scales with players in interest range).
- **Prices** (Fly pricing page, https://docs.fly.io/about/pricing, retrieved 2026-10-28): shared-cpu-1x 512 MB **$3.69/month**; volume **$0.15/GB/month** (1 GB = $0.15); volume snapshots $0.08/GB/month (first 10 GB free); shared IPv4 free, dedicated IPv4 $2/month (not needed); outbound data (North America/Europe) **$0.02/GB**, inbound free. Estimated total: about **$3.85/month** fixed, plus bandwidth, e.g. 20 players average around the clock ~600 GB/month ~ $12 (an estimate from the measured 11 KB/s, not a quote). Cloudflare R2 storage for the backups is a few cents (free tier 10 GB, no egress fees). The page also lists reservation discounts which are not worth it at this size.
- **Scaling path:** (1) bigger VM in place (`fly scale vm performance-1x --memory 2048`), (2) beyond ~100 players per world you need sharding by zone/instance: separate Fly apps each with its own volume, a lobby/auth service in front, and the characters table moved to a shared database (Postgres via Fly, or LiteFS with a single writer). Multiple regions or zones with one SQLite file is not possible without that change. Do not run `fly scale count 2`.

## What was tested (and what not)

Real: `node:sqlite` needs no flag on Node 22.23 (unflagged since 22.13; the image uses `node:22-slim`, and only the ExperimentalWarning is silenced). The exact image layout was reproduced by hand and the exact runtime command (`supervisor.mjs`, which starts the bundle) run as root with uid drop to 1000 on port 8809: `/health`, the smoke WebSocket login, the full bot suite via `BOT_URL` (60/60), SIGTERM (client closed with 1001, "bye", exit code 0), the restore-on-boot swap, `VACUUM INTO` from the live WAL database, and `deploy/fly/backup/test-backup.mjs` (SigV4 against AWS's published example signature, a signature-verifying fake S3 server with pagination, a real WAL database, 80 days of backups with retention, `--due` logic, restore, corrupted-object rejection). Bundle: 213 KB; runtime image has no `node_modules`.

Not done: `docker build`/`docker run` (no Docker daemon in the build sandbox), any call to Fly or Cloudflare, real R2, the GitHub workflow (YAML parsed only), TLS/DNS, 100-client load.
