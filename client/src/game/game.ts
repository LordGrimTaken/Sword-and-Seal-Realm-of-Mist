import * as THREE from "three";
import {
  type ClassId,
  type GameEvent,
  type ServerMsg,
  type SkillDef,
  type ZoneInfo,
} from "@shared/protocol";
import { createWorld, createVfx, createComposer } from "../art";
import type { NetClient } from "../net/client";
import { Predictor, STEP } from "../net/predict";
import { EntityManager, type Ent } from "./entities";
import { FollowCamera } from "./camera";
import { Input } from "./input";
import { Hud, type HudEnt } from "../ui/hud";
import { audio } from "../audio/instance";
import { PROMPT_RANGE } from "../ui/dialog";
import { plain } from "../ui/glyphs";
import type { QuestEvent } from "../ui/quest";
import { TargetRing, installTargetStyle, orderTargets, cycleFrom, TAB_RANGE, DROP_RANGE } from "./targeting";
import { Juice, HIT_STOP_MS } from "./juice";

type Welcome = Extract<ServerMsg, { t: "welcome" }>;
/** Lines of the server's `/daily` dump (Fen's talk): suppressed in chat right after the board opens from a conversation. */
const DAILY_DUMP = /^(Daily tasks \(resets in .*\):|- .+: \d+\/\d+ \(\+\d+ coin, \+\d+ jade, \+\d+ XP\) \[(in progress|ready to claim|claimed)\]|Wallet: \d+ coin, \d+ jade)$/;

export interface DebugState {
  readonly connected: boolean;
  readonly ready: boolean;
  readonly myId: number;
  readonly entityCount: number;
  readonly fps: number;
  readonly ping: number;
  readonly zone: string;
  readonly pos: { x: number; z: number };
  readonly hp: number;
  readonly level: number;
  readonly target: number;
  readonly tick: number;
  readonly kills: number;
  readonly lastError: string;
  readonly predErr: number;
  readonly perf: { calls: number; triangles: number; geometries: number; textures: number; programs: number };
  readonly inputsSent: number;
  readonly quest: { status: string; stage: number; total: number; title: string; cur: number; max: number };
  readonly dialog: { open: boolean; npc: number };
  readonly helpOpen: boolean;
  readonly inv: Array<{ item: string; itemZh: string; qty: number }>;
  readonly bagOpen: boolean;
  /** v3: wallet balances, daily board and whether the Notice Board panel is open */
  readonly wallet: { coin: number; jade: number };
  readonly daily: { open: boolean; claimable: number; resetIn: number; tasks: Array<{ id: string; title: string; have: number; need: number; done: boolean; claimed: boolean }> };
  readonly xpBar: { text: string; max: boolean; fill: number };
  readonly bossBar: boolean;
  readonly dangers: number;
  /** the live follow camera (yaw/pitch/dist are writable) so screenshot scripts can frame a shot */
  readonly cam?: { yaw: number; pitch: number; dist: number };
  readonly scene?: unknown;
  readonly ents: Array<{ id: number; k: string; n: string; x: number; z: number; hp: number; mhp: number }>;
  /** impact-juice switch and counters (hit-stop / nudge / flash / vignette), for tests */
  readonly juice?: { on: boolean; frozen: boolean; hits: number; stops: number; lastStopMs: number; nudges: number; flashes: number; vignettes: number };
  /** ids Tab would cycle through right now, in order */
  readonly tabOrder?: number[];
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private world: ReturnType<typeof createWorld>;
  private vfx: ReturnType<typeof createVfx>;
  private composer: ReturnType<typeof createComposer>;
  private fcam: FollowCamera;
  private ents: EntityManager;
  private hud: Hud;
  private input: Input;
  private pred = new Predictor();
  private myId: number;
  private cls: ClassId;
  private skills: SkillDef[];
  private zone: ZoneInfo;
  private targetId = -1;
  private ring: TargetRing;
  private juice = new Juice();
  private running = true;
  private raf = 0;
  private last = performance.now();
  private acc = 0;
  private fpsAvg = 60;
  private lastTick = 0;
  private lastMoving = false;
  private combatUntil = 0;
  private combat = 0;
  private stepTimer = 0;
  private bossRoarAt = -1e9;
  private lastFrameAt = 0;
  private lastPumpAt = 0;
  private wantDx = 0;
  private wantDz = 0;
  private pumpTimer = 0;
  private myFacing = 0;
  private kills = 0;
  private lastError = "";
  private vis = { x: 0, z: 0 };
  private inputsSent = 0;
  private lowRes = false;
  private wasDead = false;
  /** Active telegraphed attacks (boss slams): ground circle, start time and wind-up length. */
  private dangers: Array<{ x: number; z: number; radius: number; start: number; delay: number; src: number; inside: boolean; landed: boolean }> = [];
  /** Last seen level/dead flag per player entity, used to spot level-ups and respawns of nearby players. */
  private playerFx = new Map<number, { lv: number; dead: boolean }>();
  private quietQuest = 0; // pending automatic /quest replies whose chat echo is hidden
  private quietQuestExpire = 0;
  private quietDaily = 0; // pending lines of the /daily dump to hide after talking to Fen
  private quietDailyExpire = 0;
  private chatTokens = 4;
  private chatRefillAt = performance.now();
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();
  private onResize = () => this.resize();
  onExit: () => void = () => {};

  constructor(private net: NetClient, welcome: Welcome, private myName: string, cls: ClassId) {
    this.myId = welcome.id;
    this.cls = cls;
    this.skills = welcome.skills;
    this.zone = welcome.zone;

    const stage = document.getElementById("stage")!;
    // MSAA happens in the composer render target, so the canvas itself needs no antialiasing.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // the composer's final pass owns tone mapping / colour space
    this.renderer.info.autoReset = false;            // we reset once per frame so info covers scene + post pass
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    stage.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.15, 520);
    this.world = createWorld(this.scene, this.renderer);
    this.vfx = createVfx(this.scene);
    this.composer = createComposer(this.renderer, this.scene, this.camera);
    this.fcam = new FollowCamera(this.camera);
    this.fcam.bakeWorld(this.scene);
    this.ents = new EntityManager(this.scene, (x, z) => this.world.heightAt(x, z), () => this.myId);

    // ink-brush target ring on the ground + nameplate highlight style
    installTargetStyle();
    this.ring = new TargetRing(this.scene);

    this.hud = new Hud({
      onSlot: (s) => this.castSlot(s),
      onChat: (t) => this.sendChat(t, false),
      onReconnect: () => this.onExit(),
      onTalk: (who) => { if (who === "fen") this.armDailyQuiet(); this.sendChat(`/talk ${who}`, true); },
      onClaim: (id) => { this.net.send({ t: "claim", id }); },
      onLowRes: (on) => this.setLowRes(on),
      getLowRes: () => this.lowRes,
      onQuestEvent: (e) => this.onQuestEvent(e),
    });
    this.hud.setZone(this.zone);
    this.hud.setSkills(this.skills, this.cls);
    this.hud.addChat("", "WASD move · RMB drag orbit · wheel zoom · Tab target · 1-4 skills · F speak · I bag · B notice board · L quests · F1 help · Enter chat", true, false);

    this.input = new Input(this.renderer.domElement, {
      onCast: (s) => this.castSlot(s),
      onTab: (back) => this.cycleTarget(back),
      onEnter: () => this.hud.focusChat(),
      onEscape: () => {
        // Esc closes an open panel first (handled in handleKey); only with nothing open does it clear the target
        if (this.hud.help.isOpen || this.hud.dialog.isOpen || this.hud.bag.isOpen || this.hud.board.isOpen || this.hud.quest.logOpen) return;
        this.targetId = -1;
      },
      onClick: (x, y) => this.pick(x, y),
      onOrbit: (dx, dy) => this.fcam.orbit(dx, dy),
      onZoom: (d) => this.fcam.zoom(d),
      onMute: () => this.hud.toggleMute(),
    });

    // start the player at the spawn so the camera has somewhere to be before the first snapshot
    this.pred.reset(this.zone.spawn.x, this.zone.spawn.z);
    this.pred.ready = false;
    window.addEventListener("resize", this.onResize);
    window.addEventListener("keydown", this.onKey);
    this.resize();
    this.refreshQuest();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    // keep inputs flowing even when rAF is throttled (hidden tab / very slow frames)
    this.pumpTimer = window.setInterval(() => {
      const t = performance.now();
      if (this.running && t - this.lastPumpAt > 60 && (this.wantDx !== 0 || this.wantDz !== 0 || this.lastMoving)) {
        this.pump(Math.min(0.25, (t - this.lastPumpAt) / 1000));
      }
    }, 50);
  }

  /** Overlay shown while the app retries the connection. */
  showReconnecting(attempt: number, total: number, lastError: string) {
    const detail = lastError ? ` Last error: ${lastError}` : "";
    this.hud.showConnection("Connection Lost", attempt > 0 ? `Reconnecting… attempt ${attempt} of ${total}.${detail}` : "Reconnecting…", { busy: true, btn: "Back to login" });
  }

  /** Launcher mode: the connection dropped and cannot be re-established silently (the login token is single use). */
  showConnectionLost(msg: string) {
    this.hud.showConnection("Connection Lost", msg, { busy: false, btn: null });
  }

  /** Swap in a freshly logged-in connection after a drop: all per-session state is reset, no entities survive. */
  rebind(net: NetClient, welcome: Welcome) {
    this.net = net;
    this.myId = welcome.id;
    this.skills = welcome.skills;
    this.zone = welcome.zone;
    this.ents.clear();
    this.targetId = -1;
    this.dangers = [];
    this.acc = 0; this.lastMoving = false; this.wantDx = 0; this.wantDz = 0;
    this.combat = 0; this.combatUntil = 0; this.kills = 0; this.wasDead = false; this.playerFx.clear();
    this.pred.reset(this.zone.spawn.x, this.zone.spawn.z);
    this.pred.ready = false;
    this.hud.resetSession();
    this.hud.setSkills(this.skills, this.cls);
    this.hud.hideConnection();
    this.hud.addChat("", "Reconnected to the valley.", true, false);
    this.refreshQuest();
  }

  // ---------------------------------------------------------------- debug
  debug(): DebugState {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- getters below need the Game instance, not the returned object
    const self = this;
    const dbg = {
      get connected() { return self.net.open; },
      get ready() { return !!self.ents.map.get(self.myId) && self.pred.ready; },
      get myId() { return self.myId; },
      get entityCount() { return self.ents.map.size; },
      get fps() { return Math.round(self.fpsAvg); },
      get ping() { return Math.round(self.net.latency); },
      get zone() { return self.zone.id; },
      get pos() { return { x: +self.vis.x.toFixed(2), z: +self.vis.z.toFixed(2) }; },
      get hp() { return self.ents.map.get(self.myId)?.s.hp ?? 0; },
      get level() { return self.ents.map.get(self.myId)?.s.lv ?? 0; },
      get target() { return self.targetId; },
      get tick() { return self.lastTick; },
      get kills() { return self.kills; },
      get lastError() { return self.lastError; },
      get predErr() { return +self.pred.lastErr.toFixed(3); },
      get perf() { const i = self.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0 }; },
      get inputsSent() { return self.inputsSent; },
      get quest() { const q = self.hud.quest.state; return { status: q.status, stage: q.stage, total: q.total, title: q.title, cur: q.cur, max: q.max }; },
      get dialog() { return { open: self.hud.dialog.isOpen, npc: self.hud.dialog.npcId }; },
      get helpOpen() { return self.hud.help.isOpen; },
      get inv() { return self.hud.bag.list.map((i) => ({ ...i })); },
      get bagOpen() { return self.hud.bag.isOpen; },
      get wallet() { return self.hud.wallet.values; },
      get daily() { const b = self.hud.board; return { open: b.isOpen, claimable: b.claimable, resetIn: b.resetIn, tasks: b.list.map((t) => ({ id: t.id, title: t.title, have: t.have, need: t.need, done: t.done, claimed: t.claimed })) }; },
      get xpBar() { return self.hud.xpState(); },
      get bossBar() { return !!self.bossEnt(); },
      get dangers() { return self.dangers.length; },
      get juice() { const j = self.juice; return { on: j.enabled, frozen: j.frozen, ...j.stats }; },
      get tabOrder() { return self.tabOrder(); },
      get ents() { return [...self.ents.map.values()].map((e) => ({ id: e.id, k: e.s.k, n: e.s.n, x: +e.x.toFixed(2), z: +e.z.toFixed(2), hp: e.s.hp, mhp: e.s.mhp })); },
    } as DebugState;
    Object.defineProperty(dbg, "scene", { get: () => self.scene, enumerable: false }); // for inspection scripts
    Object.defineProperty(dbg, "cam", { get: () => self.fcam, enumerable: false }); // non-enumerable so spreading the state (tests) never serialises the camera
    return dbg;
  }

  // ---------------------------------------------------------------- messages
  handle(m: ServerMsg) {
    switch (m.t) {
      case "snap": {
        const now = performance.now();
        this.lastTick = m.tick;
        this.ents.applySnapshot(m.ents, m.gone, now);
        for (const id of m.gone) if (id === this.targetId) this.targetId = -1;
        const me = this.ents.map.get(this.myId);
        if (me) this.pred.reconcile(m.ack, me.s.x, me.s.z);
        break;
      }
      case "ev":
        this.onEvent(m.e);
        break;
      case "inv":
        if (Array.isArray(m.items)) this.hud.bag.set(m.items);
        break;
      case "wallet":
        this.hud.wallet.set(m.coin, m.jade);
        break;
      case "daily":
        this.hud.board.set(m.tasks, m.resetIn);
        break;
      case "error":
        this.lastError = m.msg;
        this.hud.addChat("", `Server: ${plain(m.msg)}`, true, false);
        this.hud.toast(plain(m.msg));
        audio.ui("error");
        break;
      default:
        break;
    }
  }

  private entPos(id: number, out: THREE.Vector3, yFrac = 0.6): THREE.Vector3 | null {
    const e = this.ents.map.get(id);
    if (!e) return null;
    return out.set(e.x, e.y + e.avatar.height * yFrac, e.z);
  }

  private nearMe(id: number, maxDist: number): boolean {
    const me = this.ents.map.get(this.myId), o = this.ents.map.get(id);
    return !!me && !!o && Math.hypot(me.x - o.x, me.z - o.z) <= maxDist;
  }

  private onEvent(e: GameEvent) {
    const now = performance.now();
    switch (e.k) {
      case "damage": {
        const dst = this.ents.map.get(e.dst);
        if (dst && (e.src === this.myId || e.dst === this.myId || this.nearMe(e.dst, 40))) {
          const p = this.entPos(e.dst, this.tmpV, 0.95)!;
          const toMe = e.dst === this.myId;
          this.hud.float(p, String(Math.round(e.amount)), e.crit ? "crit" : toMe ? "taken" : "dmg");
          this.vfx.hit(this.tmpV2.set(p.x, dst.y + dst.avatar.height * 0.6, p.z), e.crit);
        }
        if (e.dst === this.myId) this.hud.flashHurt();
        if (e.src === this.myId || e.dst === this.myId) {
          audio.hit(e.crit);
          this.combatUntil = now + 6000;
        }
        this.ents.markAttack(e.src, now);
        if (e.src === this.myId && e.dst !== this.myId && dst) this.onMyHit(e, dst);
        break;
      }
      case "heal": {
        // Buffs (Qi Guard / Wind Step) are range-0 "heal" skills; only a real, positive heal is shown.
        if (!(e.amount > 0)) break;
        const p = this.entPos(e.dst, this.tmpV, 0.95);
        if (p) this.hud.float(p, `+${Math.round(e.amount)}`, "heal");
        break;
      }
      case "death": {
        const dead = this.ents.map.get(e.id);
        if (e.killer === this.myId && e.id !== this.myId) { this.kills++; if (dead?.s.k === "mob") this.hud.quest.onKill(dead.s.mob); }
        if (e.id === this.myId) audio.death();
        else if (dead && dead.s.k === "mob" && this.nearMe(e.id, 40)) audio.mobDeath();
        break;
      }
      case "cast": {
        const src = this.ents.map.get(e.src);
        if (src) {
          this.ents.markAttack(e.src, now);
          if (src.s.k === "player") {
            const cls = src.s.cls ?? "sword";
            const from = new THREE.Vector3(src.x, src.y + src.avatar.height * 0.6, src.z);
            const to = new THREE.Vector3(e.tx, this.world.heightAt(e.tx, e.tz) + 1, e.tz);
            if (e.src === this.myId || this.nearMe(e.src, 38)) this.vfx.cast(e.skill, cls, from, to, e.src === this.myId);
            // local casts already played their sound on key press
            if (e.src !== this.myId && this.nearMe(e.src, 35)) audio.cast(e.skill, cls);
            if (e.src === this.myId) this.hud.addBuff(cls, e.skill);
            if (e.src === this.myId) this.combatUntil = Math.max(this.combatUntil, now + (this.targetIsHostile() ? 6000 : 0));
          }
        }
        break;
      }
      case "chat": {
        if (e.sys) {
          if (this.quietDaily > 0 && performance.now() < this.quietDailyExpire && DAILY_DUMP.test(plain(e.text))) { this.quietDaily = /^Wallet:/.test(plain(e.text)) ? 0 : this.quietDaily - 1; break; } // the board already shows what Fen's /daily dump says
          const isQuest = this.hud.quest.handleSys(e.text);
          this.hud.dialog.onSys(e.text, isQuest);
          if (isQuest && this.quietQuest > 0 && now < this.quietQuestExpire) { this.quietQuest--; break; } // automatic /quest refresh: update the tracker, keep the log clean
        }
        // the server's hints still say "type /talk"; the client key is F
        this.hud.addChat(e.from, e.sys ? plain(e.text).replace(/type \/talk/gi, (m) => (m[0] === "T" ? "Press F" : "press F")) : e.text, !!e.sys, !e.sys && e.from === this.myName);
        if (!e.sys) audio.ui("chat");
        break;
      }
      case "xp": {
        this.hud.setXp(e.xp, e.next, e.lv);
        if (e.amount > 0) this.hud.xpLine(e.amount);
        break;
      }
      case "levelup": {
        this.hud.levelUp(e.lv);
        this.hud.addChat("", `You have reached level ${e.lv}!`, true, false);
        audio.levelUp();
        { const me = this.ents.map.get(this.myId); if (me) this.vfx.levelUp(this.tmpV.set(me.x, me.y, me.z)); }
        break;
      }
      case "telegraph":
        this.onTelegraph(e, now);
        break;
      case "loot":
        this.hud.lootLine(e.item, e.qty);
        this.hud.quest.onLoot(e.item, e.qty);
        audio.loot();
        break;
    }
  }

  /** Local player landed a hit: hit-stop, camera nudge, white-ink flash on the target, crit vignette. */
  private onMyHit(e: Extract<GameEvent, { k: "damage" }>, dst: Ent) {
    const j = this.juice;
    if (!j.enabled) return;
    const t = performance.now();
    const boss = dst.s.mob === "stone_guardian";
    const sk = e.skill != null ? this.skills.find((s) => s.id === e.skill) : undefined;
    const heavy = !!sk && sk.kind !== "heal" && sk.cooldown >= 6;
    j.stats.hits++;
    j.stop(boss && heavy ? HIT_STOP_MS.boss : e.crit ? HIT_STOP_MS.crit : HIT_STOP_MS.normal);
    const me = this.ents.map.get(this.myId);
    if (me) {
      const wx = dst.x - me.x, wz = dst.z - me.z, l = Math.hypot(wx, wz) || 1;
      const [rx, rz] = this.fcam.right(), [fx, fz] = this.fcam.forward();
      j.nudge((wx * rx + wz * rz) / l, ((wx * fx + wz * fz) / l) * 0.6, t);
    }
    j.flashOn(dst.body, t);
    if (e.crit) j.vignette(t);
  }

  /** Boss ground attack: red ring on the terrain, on-screen warning, minimap danger disc, gong. Damage lands `delay` s later. */
  private onTelegraph(e: Extract<GameEvent, { k: "telegraph" }>, now: number) {
    const x = Number(e.x), z = Number(e.z), radius = Math.max(0.5, Number(e.radius) || 4), delay = Math.max(0.2, Number(e.delay) || 1.5);
    if (!isFinite(x) || !isFinite(z)) return;
    this.vfx.telegraph(new THREE.Vector3(x, this.world.heightAt(x, z), z), radius, delay);
    if (this.dangers.length >= 10) this.dangers.shift();
    const inside = Math.hypot(this.vis.x - x, this.vis.z - z) <= radius;
    this.dangers.push({ x, z, radius, start: now, delay: delay * 1000, src: e.src, inside, landed: false });
    const src = this.ents.map.get(e.src);
    const me = this.ents.map.get(this.myId);
    if (me && Math.hypot(me.x - x, me.z - z) < 70) {
      const guardian = !src || src.s.mob === "stone_guardian";
      const who = guardian ? "Stone Guardian" : plain(src.s.n);
      this.hud.warn(`${who} winds up!`, "Step out of the red ring", Math.max(1400, delay * 1000 + 500));
      audio.warn();
      if (inside) this.hud.toast("Move out of the red ring!", Math.max(1200, delay * 1000));
    }
  }

  /** Resolve telegraphs whose wind-up has elapsed: thud, camera shake, and a dodge cue if the player escaped the circle. */
  private updateDangers(now: number) {
    for (let i = this.dangers.length - 1; i >= 0; i--) {
      const d = this.dangers[i];
      if (!d.landed && now >= d.start + d.delay) {
        d.landed = true;
        const dist = Math.hypot(this.vis.x - d.x, this.vis.z - d.z);
        if (dist < d.radius + 45) {
          audio.impact();
          this.fcam.shake(Math.max(0.08, 0.5 * (1 - dist / (d.radius + 45))), 0.45);
          if (d.inside && dist > d.radius + 0.3) {
            const p = this.tmpV.set(this.vis.x, this.world.heightAt(this.vis.x, this.vis.z) + 2.2, this.vis.z);
            this.hud.float(p, "Dodged!", "xp");
            audio.ui("open");
          }
        }
      }
      if (now > d.start + d.delay + 600) this.dangers.splice(i, 1);
    }
  }

  /** The boss entity worth a health bar: targeted, or alive within 40 units. */
  private bossEnt(): Ent | null {
    const t = this.ents.map.get(this.targetId);
    if (t && t.s.mob === "stone_guardian" && !t.dead) return t;
    const me = this.ents.map.get(this.myId);
    if (!me) return null;
    for (const e of this.ents.map.values()) {
      if (e.s.mob === "stone_guardian" && !e.dead && Math.hypot(e.x - me.x, e.z - me.z) <= 40) return e;
    }
    return null;
  }

  private onQuestEvent(e: QuestEvent) {
    if (e.kind === "ready" || e.kind === "completed") audio.levelUp();
  }

  /** Ask the server for quest progress without echoing the reply into chat. */
  private refreshQuest() {
    this.quietQuest = 1;
    this.quietQuestExpire = performance.now() + 20000;
    this.sendChat("/quest", true);
  }

  // ---------------------------------------------------------------- chat / keys / NPCs
  private takeChatToken(): boolean {
    const now = performance.now();
    this.chatTokens = Math.min(4, this.chatTokens + (now - this.chatRefillAt) / 1600);
    this.chatRefillAt = now;
    if (this.chatTokens < 1) return false;
    this.chatTokens -= 1;
    return true;
  }

  /** Strip control characters, cap at 120 code points and rate-limit like the server (4 burst, one per ~1.6 s). Internal commands queue instead of failing. */
  private sendChat(raw: string, internal: boolean) {
    const text = Array.from(raw.replace(/[\p{Cc}\u2028\u2029]/gu, " ").replace(/\s+/g, " ").trim()).slice(0, 120).join("");
    if (!text) return;
    if (!this.takeChatToken()) {
      if (internal) window.setTimeout(() => { if (this.running) this.sendChat(text, true); }, 1000);
      else this.sys("You are speaking too quickly.");
      return;
    }
    this.net.send({ t: "chat", text });
  }

  /** Debug/test hook: send chat text as the local player. */
  say(text: string) { this.sendChat(text, true); }

  private handleKey(e: KeyboardEvent) {
    const a = document.activeElement;
    const typing = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "range" && (a as HTMLInputElement).type !== "checkbox";
    if (e.code === "F1") { e.preventDefault(); this.hud.help.toggle(); return; }
    if (e.code === "Escape") {
      if (this.hud.help.isOpen) this.hud.help.toggle(false);
      else if (this.hud.dialog.isOpen) this.hud.dialog.close();
      else if (this.hud.bag.isOpen) this.hud.bag.toggle(false);
      else if (this.hud.board.isOpen) this.hud.board.toggle(false);
      else if (this.hud.quest.logOpen) this.hud.quest.toggleLog(false);
      return;
    }
    if (typing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "?") { this.hud.help.toggle(); return; }
    if (e.code === "KeyL") { this.hud.quest.toggleLog(); return; }
    if (e.code === "KeyB") { this.hud.board.toggle(); return; }
    if (e.code === "KeyI") { this.hud.bag.toggle(); audio.ui(this.hud.bag.isOpen ? "open" : "close"); return; }
    if (e.code === "KeyF") this.speakToNearest();
  }

  private npcs(): Ent[] {
    return [...this.ents.map.values()].filter((e) => e.s.k === "npc" && !e.dead);
  }
  private nearestNpc(maxDist: number): { e: Ent; d: number } | null {
    let best: { e: Ent; d: number } | null = null;
    for (const e of this.npcs()) {
      const d = Math.hypot(e.x - this.vis.x, e.z - this.vis.z);
      if (d <= maxDist && (!best || d < best.d)) best = { e, d };
    }
    return best;
  }
  private speakToNearest() {
    const me = this.ents.map.get(this.myId);
    if (!me || me.dead) return;
    if (this.hud.dialog.isOpen) { this.hud.dialog.close(); return; }
    const n = this.nearestNpc(40);
    if (!n) { this.sys("No one is near enough to speak to."); return; }
    this.openNpc(n.e, n.d);
  }
  /** Hide the server's `/daily` dump for a while. The window grows with the measured latency (slow links / stalled frames delay it). */
  private armDailyQuiet() { this.quietDaily = 12; this.quietDailyExpire = performance.now() + 6000 + 3 * this.net.latency; }
  private openNpc(e: Ent, d?: number) {
    const dist = d ?? Math.hypot(e.x - this.vis.x, e.z - this.vis.z);
    this.setTarget(e.id);
    if (/Fen/i.test(e.s.n)) this.armDailyQuiet();
    this.hud.dialog.open({ id: e.id, name: e.s.n }, dist);
  }

  private setLowRes(on: boolean) {
    this.lowRes = on;
    this.renderer.setPixelRatio(on ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.resize();
  }

  private targetIsHostile(): boolean {
    const t = this.ents.map.get(this.targetId);
    return !!t && t.s.k === "mob" && !t.dead;
  }

  // ---------------------------------------------------------------- targeting / casting
  /** Living hostiles within Tab range, nearest first (used for auto-targeting on cast). */
  private hostiles(): Ent[] {
    const me = this.ents.map.get(this.myId);
    if (!me) return [];
    return [...this.ents.map.values()]
      .filter((e) => e.s.k === "mob" && !e.dead && Math.hypot(e.x - me.x, e.z - me.z) <= TAB_RANGE)
      .sort((a, b) => Math.hypot(a.x - me.x, a.z - me.z) - Math.hypot(b.x - me.x, b.z - me.z));
  }

  /** Tab order: in-range living mobs, camera cone first, then nearest; mobs behind the camera only when nothing else exists. */
  private tabOrder(): number[] {
    const me = this.ents.map.get(this.myId);
    if (!me) return [];
    const [fx, fz] = this.fcam.forward();
    const mobs: Array<{ id: number; x: number; z: number; dead: boolean }> = [];
    for (const e of this.ents.map.values()) if (e.s.k === "mob") mobs.push(e);
    return orderTargets(me, { x: this.camera.position.x, z: this.camera.position.z, fx, fz }, mobs, TAB_RANGE);
  }

  private cycleTarget(back: boolean) {
    if (this.hud.chatFocused) return;
    const id = cycleFrom(this.tabOrder(), this.targetId, back ? -1 : 1);
    if (id >= 0) this.setTarget(id);
  }

  private setTarget(id: number) {
    if (id !== this.targetId && id >= 0) audio.ui("target");
    this.targetId = id;
  }

  private pick(cx: number, cy: number) {
    const W = window.innerWidth, H = window.innerHeight;
    const fovTan = Math.tan((this.camera.fov * Math.PI) / 360);
    let best: Ent | null = null;
    let bestScore = Infinity;
    for (const e of this.ents.map.values()) {
      const h = e.avatar.height;
      this.tmpV.set(e.x, e.y + h * 0.5, e.z);
      const dist = this.tmpV.distanceTo(this.camera.position);
      this.tmpV.project(this.camera);
      if (this.tmpV.z > 1) continue;
      const sx = (this.tmpV.x * 0.5 + 0.5) * W, sy = (-this.tmpV.y * 0.5 + 0.5) * H;
      const pxPerUnit = H / 2 / (fovTan * dist);
      const rad = Math.max(22, Math.max(h * 0.55, 0.6) * pxPerUnit);
      const d = Math.hypot(sx - cx, sy - cy);
      if (d <= rad && d / rad < bestScore) { bestScore = d / rad; best = e; }
    }
    this.setTarget(best ? best.id : -1);
    if (best && best.s.k === "npc") this.openNpc(best);
  }

  private lastSys = new Map<string, number>();
  private sys(text: string) {
    const now = performance.now();
    if (now - (this.lastSys.get(text) ?? -1e9) < 1500) return;
    this.lastSys.set(text, now);
    this.hud.addChat("", text, true, false);
    audio.ui("error");
  }

  private castSlot(slot: number) {
    if (this.hud.chatFocused) return;
    const sk = this.skills.find((s) => s.id === slot);
    const me = this.ents.map.get(this.myId);
    if (!sk || !me || me.dead) return;
    if (this.hud.cooldownLeft(slot) > 0) return;

    let target = this.ents.map.get(this.targetId);
    const dist = (e: Ent) => Math.hypot(e.x - me.x, e.z - me.z);
    // range-0 "heal" skills are self buffs / self-centred heals (Qi Guard, Wind Step, Spring Rain, Meridian Surge)
    const selfCast = sk.kind === "heal" && sk.range <= 0;
    if (selfCast) target = me;
    else if (sk.kind === "heal") {
      if (!target || target.s.k !== "player") target = me;
    } else if (!target || target.s.k !== "mob" || target.dead) {
      target = this.hostiles()[0];
      if (target) this.setTarget(target.id);
    }

    const msg: { t: "cast"; skill: number; target?: number; tx?: number; tz?: number } = { t: "cast", skill: sk.id };
    if (selfCast) {
      // nothing to aim
    } else if (sk.kind === "melee" || sk.kind === "bolt") {
      if (!target) { this.sys("You have no target."); return; }
      if (dist(target) > sk.range + 1.5) { this.sys("Target is out of range."); return; }
      msg.target = target.id;
    } else if (sk.kind === "aoe") {
      if (target) {
        if (dist(target) > sk.range + 1.5) { this.sys("Target is out of range."); return; }
        msg.target = target.id; msg.tx = target.x; msg.tz = target.z;
      } else {
        const d = Math.min(sk.range, 8);
        msg.tx = me.x + Math.sin(me.r) * d; msg.tz = me.z + Math.cos(me.r) * d;
      }
    } else if (target) {
      msg.target = target.id;
      msg.tx = target.x; msg.tz = target.z;
    }
    this.net.send(msg);
    this.hud.startCooldown(slot, Math.max(250, sk.cooldown * 1000));
    if (sk.kind === "heal" && sk.range <= 0) this.hud.addBuff(this.cls, sk.id); // self-buff icon (no buff event in the protocol)
    audio.cast(sk.id, this.cls); // instant feedback; the server's own cast event is skipped for the local player
    if (sk.kind !== "heal") this.combatUntil = performance.now() + 6000;
  }

  // ---------------------------------------------------------------- loop
  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.resize(w, h);
    this.juice.resetView(this.camera);
  }

  private loop = (t: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.1, Math.max(0.0001, (t - this.last) / 1000));
    this.last = t;
    this.fpsAvg += (1 / dt - this.fpsAvg) * Math.min(1, dt * 2);
    try { this.frame(dt, t); } catch (e) { console.error(e); this.lastError = String(e); }
  };

  /** Advance the fixed-step predictor and send one `input` per step while moving (>= 20 Hz; server drops held input after 0.5 s). */
  private pump(dt: number): boolean {
    const nowP = performance.now();
    // use real elapsed time (not the render-clamped dt) so slow frames still emit a full 20 Hz of inputs
    dt = Math.min(0.5, Math.max(dt, (nowP - this.lastPumpAt) / 1000));
    this.lastPumpAt = nowP;
    if (!this.pred.ready) {
      this.vis.x = this.zone.spawn.x; this.vis.z = this.zone.spawn.z;
      return false;
    }
    const dx = this.wantDx, dz = this.wantDz;
    const wantMove = dx !== 0 || dz !== 0;
    this.acc = Math.min(this.acc + dt, STEP * 10);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      if (wantMove || this.lastMoving) {
        const seq = this.pred.step(dx, dz);
        this.net.send({ t: "input", seq, dx: +dx.toFixed(4), dz: +dz.toFixed(4) });
        this.inputsSent++;
        this.lastMoving = wantMove;
      } else {
        // keep fixed-step interpolation anchored when idle
        this.pred.prevX = this.pred.x; this.pred.prevZ = this.pred.z;
      }
    }
    if (wantMove) this.myFacing = Math.atan2(dx, dz);
    this.pred.visual(wantMove || this.lastMoving ? this.acc / STEP : 1, dt, this.vis);
    return wantMove;
  }

  private frame(dt: number, now: number) {
    const me = this.ents.map.get(this.myId);
    const dead = !!me && me.dead;
    this.renderer.info.reset();

    // ---- input -> fixed-step prediction (also pumped by a timer so inputs keep flowing if frames stall)
    this.lastFrameAt = performance.now();
    const ax = this.input.axes();
    let dx = 0, dz = 0;
    if (!dead && (ax.fwd !== 0 || ax.right !== 0)) {
      const [fx, fz] = this.fcam.forward();
      const [rx, rz] = this.fcam.right();
      dx = fx * ax.fwd + rx * ax.right;
      dz = fz * ax.fwd + rz * ax.right;
      const len = Math.hypot(dx, dz);
      if (len > 1) { dx /= len; dz /= len; }
    }
    this.wantDx = dx; this.wantDz = dz;
    const moving = this.pump(0);

    // ---- entities
    let local: { x: number; z: number; r: number; moving: boolean } | null = null;
    if (me && this.pred.ready) {
      local = { x: this.vis.x, z: this.vis.z, r: moving ? this.myFacing : me.s.r, moving };
    }
    const pnow = performance.now();
    const adt = this.juice.animDt(dt); // hit-stop shortens the animation / VFX clock only; net, input and prediction above use real dt
    this.ents.update(dt, now, local, this.camera.position, adt);
    this.dropStaleTarget(me);
    this.audioFrame(dt, now, moving, dead);

    // ---- camera
    const focus = this.tmpV.set(this.vis.x, this.world.heightAt(this.vis.x, this.vis.z) + 1.75, this.vis.z);
    this.fcam.update(dt, focus, (x, z) => this.world.heightAt(x, z));
    this.camera.updateMatrixWorld();
    this.juice.tick(pnow);
    this.juice.applyNudge(this.camera, pnow, window.innerWidth, window.innerHeight);

    // ---- world / vfx
    this.world.update(dt, this.camera.position);
    this.vfx.update(adt);

    // ---- target ring
    const tgt = this.ents.map.get(this.targetId);
    this.ring.update(now, tgt ? { id: tgt.id, k: tgt.s.k as "mob" | "npc" | "player", x: tgt.x, y: tgt.y, z: tgt.z, h: tgt.avatar.height, boss: tgt.s.mob === "stone_guardian" } : null);

    // ---- NPC interaction
    if (me && !dead) {
      const dlgNpc = this.hud.dialog.isOpen ? this.ents.map.get(this.hud.dialog.npcId) : null;
      if (this.hud.dialog.isOpen) {
        if (!dlgNpc) this.hud.dialog.close();
        else this.hud.dialog.update(Math.hypot(dlgNpc.x - this.vis.x, dlgNpc.z - this.vis.z));
      }
    } else if (this.hud.dialog.isOpen) this.hud.dialog.close();
    if (this.wasDead && !dead && me) this.refreshQuest();
    this.wasDead = dead;
    this.trackPlayerFx();
    this.updateDangers(now);
    const boss = this.bossEnt();
    const near = me && !dead ? this.nearestNpc(PROMPT_RANGE) : null;

    // ---- HUD
    const toHud = (e: Ent): HudEnt => ({ id: e.id, s: e.s, x: e.x, y: e.y, z: e.z, dead: e.dead, h: e.avatar.height });
    const list: HudEnt[] = [];
    for (const e of this.ents.map.values()) list.push(toHud(e));
    this.hud.frame({
      dt,
      camera: this.camera,
      camYaw: this.fcam.yaw,
      ents: list,
      me: me ? toHud(me) : null,
      target: tgt ? toHud(tgt) : null,
      interact: near ? toHud(near.e) : null,
      boss: boss ? toHud(boss) : null,
      dangers: this.dangers.map((d) => ({ x: d.x, z: d.z, radius: d.radius, frac: Math.max(0, Math.min(1, (now - d.start) / d.delay)) })),
      fps: this.fpsAvg,
      ping: this.net.latency,
      nowMs: now,
    });

    this.composer.render(dt);
  }

  /** Respawn ripple for the local player and nearby players; level-up pillar for nearby players (local one comes from the levelup event). */
  /** A target that died, vanished or drifted beyond DROP_RANGE is deselected. */
  private dropStaleTarget(me: Ent | undefined) {
    if (this.targetId < 0) return;
    const t = this.ents.map.get(this.targetId);
    if (!t || t.dead || (me && Math.hypot(t.x - me.x, t.z - me.z) > DROP_RANGE)) this.targetId = -1;
  }

  private trackPlayerFx() {
    const seen = new Set<number>();
    for (const e of this.ents.map.values()) {
      if (e.s.k !== "player") continue;
      seen.add(e.id);
      const prev = this.playerFx.get(e.id);
      if (prev && (e.id === this.myId || this.nearMe(e.id, 40))) {
        if (prev.dead && !e.dead) this.vfx.respawn(this.tmpV.set(e.x, e.y, e.z));
        else if (e.id !== this.myId && e.s.lv > prev.lv) this.vfx.levelUp(this.tmpV.set(e.x, e.y, e.z));
      }
      if (prev) { prev.lv = e.s.lv; prev.dead = e.dead; } else this.playerFx.set(e.id, { lv: e.s.lv, dead: e.dead });
    }
    if (this.playerFx.size > seen.size) for (const id of this.playerFx.keys()) if (!seen.has(id)) this.playerFx.delete(id);
  }

  private audioFrame(dt: number, now: number, moving: boolean, dead: boolean) {
    if (moving && !dead) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) { audio.footstep(); this.stepTimer = 0.35; }
    } else this.stepTimer = 0;
    // combat music: a living hostile is targeted, or we were recently in a fight
    const inCombat = !dead && (this.targetIsHostile() || now < this.combatUntil);
    this.combat += ((inCombat ? 1 : 0) - this.combat) * Math.min(1, dt * 1.5);
    audio.setListenerIntensity(this.combat);
    // boss roar when the Stone Guardian starts fighting
    for (const e of this.ents.map.values()) {
      if (e.s.k === "mob" && e.s.mob === "stone_guardian" && e.s.st === "attack" && now - this.bossRoarAt > 25000 && this.nearMe(e.id, 45)) {
        this.bossRoarAt = now;
        audio.bossRoar();
      }
    }
  }

  dispose() {
    window.clearInterval(this.pumpTimer);
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("keydown", this.onKey);
    this.input.destroy();
    this.hud.destroy();
    this.ents.clear();
    this.renderer.domElement.remove();
    this.juice.dispose(this.camera);
    this.ring.dispose();
    this.renderer.dispose();
  }
}

