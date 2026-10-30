// Display = Ma Shan Zheng (brush script, Latin subset only); body = Noto Serif (Latin 400/600/700). Exposed as --font-display / --font-body.
import "@fontsource/ma-shan-zheng/latin-400.css";
import "@fontsource/noto-serif/latin-400.css";
import "@fontsource/noto-serif/latin-600.css";
import "@fontsource/noto-serif/latin-700.css";
import "./ui/style.css";
import type { ClassId, ServerMsg } from "@shared/protocol";
import type { NetClient } from "./net/client";
import { connectAndLogin, reconnectWithBackoff, RECONNECT_DELAYS_MS } from "./net/login";
import { Game, type DebugState } from "./game/game";
import { LoginScreen, type LoginValues } from "./ui/login";
import { CombatLogPanel } from "./ui/combatlog";
import { BestiaryPanel } from "./ui/bestiary";
import { QuestTrackerHud } from "./ui/questtracker";
import { CombatFeedback } from "./ui/feedback";
import { SessionStatsPanel } from "./ui/stats";
import { PartyPanel } from "./ui/party";
import { TradePanel } from "./ui/trade";
import { detectLauncher, isKnownCharacter, rememberCharacter, type LauncherCtx } from "./net/launcher";
import { installAudioGestures, audio } from "./audio/instance";
import "./ui/settings";

installAudioGestures();

const params = new URLSearchParams(location.search);
const CLASSES: ClassId[] = ["sword", "talisman", "physician", "blade"];

function store(key: string, val?: string): string | null {
  try {
    if (val !== undefined) localStorage.setItem(key, val);
    return localStorage.getItem(key);
  } catch { return null; }
}

/** Live server. Packaged/file:// builds default to it; a page served over http(s) (play.mjs, dev server) defaults to the local server. */
const REMOTE_SERVER = "wss://play.swordandseal.com";
const defaultServer = params.get("server") || store("jz.server") || (location.protocol === "file:" ? REMOTE_SERVER : "ws://localhost:8787");
const qCls = params.get("cls") as ClassId | null;
const initCls: ClassId = qCls && CLASSES.includes(qCls) ? qCls : ((store("jz.cls") as ClassId | null) ?? "sword");
const initName = params.get("name") || store("jz.name") || "";
const autoLogin = params.get("auto") === "1";
const qPw = params.get("pw") || (autoLogin ? "testpass1" : "");

// ---- debug surface for automated tests (read-only getters); only installed with ?debug=1 or localStorage jz_debug=1
let game: Game | null = null;
/** Current connection (set by wire()); the debug `mount()` hook below sends the toggle through the live socket. */
let liveNet: NetClient | null = null;
const empty = { connected: false, ready: false, myId: -1, entityCount: 0, fps: 0, ping: 0, zone: "", pos: { x: 0, z: 0 }, hp: 0, level: 0, target: -1, tick: 0, kills: 0, lastError: "", predErr: 0, inputsSent: 0, quest: { status: "unknown", stage: 0, total: 0, title: "", cur: 0, max: 0 }, dialog: { open: false, npc: -1 }, helpOpen: false, inv: [], bagOpen: false, wallet: { coin: 0, jade: 0 }, daily: { open: false, claimable: 0, resetIn: 0, tasks: [] }, xpBar: { text: "", max: false, fill: 0 }, bossBar: false, dangers: 0, perf: { calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0 }, ents: [] } as DebugState;
const jz = {
  get state(): DebugState { return game ? game.debug() : { ...empty, lastError: lastLoginError }; },
  get renderer() { return game ? game.renderer : null; },
  get scene() { return game ? game.scene : null; },
  get launcher(): boolean { return launcher !== null; },
  /** Mixer state (master/music/amb/sfx/ui levels, mute, boss layer) for UI tests. */
  get audio() { return audio.levels(); },
  get screen(): string { return game ? "game" : "login"; },
  /** Feed a fabricated server message through the normal handler (UI tests for events the server rarely emits). */
  inject(m: ServerMsg): void { game?.handle(m); },
  /** Send chat text (or a slash command) as the local player, bypassing the input box. */
  say(text: string): void { game?.say(text); },
  /** 0.5.0 spirit-sword mount: send the mount toggle exactly like pressing R (debug/test hook; server-authoritative). */
  mount(): void { liveNet?.send({ t: "mount" }); },
  /** Client-only Combat Log state (key C) for UI tests: open flag plus the stored lines, oldest first. */
  get combatLog() { return game?.combatLog?.debug() ?? { open: false, lines: [] }; },
  /** Client-only Quest Tracker state for UI tests: visible flag plus the active side-quest rows it lists. */
  get questTracker() { return game?.questTracker?.debug() ?? { visible: false, titles: [], quests: [] }; },
  /** Client-only combat feedback state for UI tests: flash count, low-HP flag and the painted edge opacities. */
  get combatFeedback() { return game?.combatFeedback?.debug() ?? { flashes: 0, lowHp: false, flash: 0, edge: 0, still: false }; },
  /** Client-only Session Statistics state for UI tests: the counters, session clock and open flag (key V). */
  get stats() {
    return game?.stats?.debug() ?? { open: false, mobsSlain: 0, damageDealt: 0, damageTaken: 0, healingReceived: 0, xpGained: 0, sessionMs: 0 };
  },
  /** Client-only Bestiary / Codex state for UI tests: open flag plus every mob row (persisted kills; 0 = never slain). */
  get bestiary() {
    return game?.bestiary?.debug() ?? { open: false, discovered: 0, total: 0, kills: 0, mobs: [] };
  },
  /** Client-only spirit companion state for UI tests: enabled/visible flags plus its world position (key P). */
  get pet() {
    return game?.petDebug() ?? { enabled: false, visible: false, x: 0, y: 0, z: 0, bob: 0, glow: 0 };
  },
};
let lastLoginError = "";
/** Set in launcher mode (Electron bridge, play.mjs session or ?tok= test path). The token itself only ever lives inside this object's closure until used. */
let launcher: LauncherCtx | null = null;
if (params.get("debug") === "1" || store("jz_debug") === "1") Object.defineProperty(window, "__jz", { value: jz, enumerable: true });

const login = new LoginScreen((v) => void enter(v), { name: initName, cls: initCls, server: defaultServer, pw: qPw });

/** Removes the current session's combat log key handler; the panel element itself goes away with the HUD. */
let combatLogCleanup: (() => void) | null = null;

/** Client-only Combat Log (key C): created once the HUD exists, fed by the game's damage/heal events. */
function attachCombatLog(g: Game): void {
  combatLogCleanup?.();
  const panel = new CombatLogPanel(g.hudRoot);
  g.combatLog = panel;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyC" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || game !== g) return;
    const a = document.activeElement as HTMLElement | null;
    const textBox = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "range" && (a as HTMLInputElement).type !== "checkbox";
    if (textBox || a?.isContentEditable) return; // chat and the bag search keep their C
    e.preventDefault();
    panel.toggle();
  };
  window.addEventListener("keydown", onKey);
  combatLogCleanup = () => { window.removeEventListener("keydown", onKey); combatLogCleanup = null; };
}

/** Client-only Quest Tracker HUD: created once the HUD exists; the game feeds it from the existing `sq` messages. */
function attachQuestTracker(g: Game): void {
  g.questTracker = new QuestTrackerHud(g.hudRoot);
}

/** Client-only combat feedback overlay: the vermilion screen edge that flashes on damage and breathes at low HP. */
function attachCombatFeedback(g: Game): void {
  g.combatFeedback = new CombatFeedback(g.hudRoot);
}

/** Removes the current session's Session Statistics key handler and stops its session clock. */
let statsCleanup: (() => void) | null = null;

/** Client-only Session Statistics panel (key V): created once the HUD exists, fed by the game's combat and XP events. */
function attachStats(g: Game): void {
  statsCleanup?.();
  const panel = new SessionStatsPanel(g.hudRoot);
  g.stats = panel;
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyV" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || game !== g) return;
    const a = document.activeElement as HTMLElement | null;
    const textBox = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "range" && (a as HTMLInputElement).type !== "checkbox";
    if (textBox || a?.isContentEditable) return; // chat and the bag search keep their V
    e.preventDefault();
    panel.toggle();
  };
  window.addEventListener("keydown", onKey);
  statsCleanup = () => { window.removeEventListener("keydown", onKey); panel.dispose(); statsCleanup = null; };
}

/** Removes the current session's Bestiary key handler; the panel element itself goes away with the HUD. */
let bestiaryCleanup: (() => void) | null = null;

/**
 * Client-only Bestiary / Codex (Shift+B). Every mob type with the player's persisted kill count comes from the
 * server `best` message; this wiring only creates the panel, owns its key and passes the display-name resolver.
 * Plain B stays the Notice Board (bound in game.ts), so the codex uses Shift+B.
 */
function attachBestiary(g: Game): void {
  bestiaryCleanup?.();
  const panel = new BestiaryPanel(g.hudRoot, (type) => g.mobName(type));
  g.bestiary = panel;
  const onKey = (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Escape") { // Esc closes the open codex; other panels keep their own Escape handling
      if (panel.isOpen) { e.preventDefault(); panel.toggle(false); audio.ui("close"); }
      return;
    }
    if (e.code !== "KeyB" || !e.shiftKey || game !== g) return;
    const a = document.activeElement as HTMLElement | null;
    const textBox = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "range" && (a as HTMLInputElement).type !== "checkbox";
    if (textBox || a?.isContentEditable) return; // chat and the bag search keep their typing
    e.preventDefault();
    if (!panel.isOpen) g.closeCentrePanels(); // the codex shares the centre with the Journal/Bag/Board, so it opens alone
    panel.toggle();
    audio.ui(panel.isOpen ? "open" : "close");
  };
  window.addEventListener("keydown", onKey);
  bestiaryCleanup = () => { window.removeEventListener("keydown", onKey); bestiaryCleanup = null; };
}

/** Removes the current session's spirit-companion key handler; the pet model itself goes away with the Game. */
let petCleanup: (() => void) | null = null;
/** localStorage key for the cosmetic spirit companion (absent = on, "0" = the player turned it off). */
const PET_KEY = "jz.pet";

/** Client-only spirit companion (key P): apply the stored preference on session start, then toggle + persist it on P. */
function attachPet(g: Game): void {
  petCleanup?.();
  g.setPetEnabled(store(PET_KEY) !== "0");
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyP" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || game !== g) return;
    const a = document.activeElement as HTMLElement | null;
    const textBox = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "range" && (a as HTMLInputElement).type !== "checkbox";
    if (textBox || a?.isContentEditable) return; // chat and the bag search keep their P
    e.preventDefault();
    const on = g.togglePet();
    store(PET_KEY, on ? "1" : "0");
    g.toast(on ? "Your spirit companion answers the call." : "Your spirit companion fades into the mist.");
    audio.ui(on ? "open" : "close");
  };
  window.addEventListener("keydown", onKey);
  petCleanup = () => { window.removeEventListener("keydown", onKey); petCleanup = null; };
}

/** Removes the current session's spirit-sword mount key handler. */
let mountCleanup: (() => void) | null = null;

/**
 * Spirit-sword mount toggle (0.5.0, key R): the client only asks the server to flip the mount. The server owns the
 * state and the speed boost and echoes it in `EntityState.mounted`; the client draws the jian/trail from that flag.
 * Never fires while typing in chat or the bag search (same guard as the other panels).
 */
function attachMountKey(g: Game, net: NetClient): void {
  mountCleanup?.();
  const onKey = (e: KeyboardEvent) => {
    if (e.code !== "KeyR" || e.repeat || e.ctrlKey || e.metaKey || e.altKey || game !== g) return;
    const a = document.activeElement as HTMLElement | null;
    const textBox = !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA") && (a as HTMLInputElement).type !== "range" && (a as HTMLInputElement).type !== "checkbox";
    if (textBox || a?.isContentEditable) return; // chat and the bag search keep their R
    e.preventDefault();
    net.send({ t: "mount" });
    audio.ui("open");
  };
  window.addEventListener("keydown", onKey);
  mountCleanup = () => { window.removeEventListener("keydown", onKey); mountCleanup = null; };
}

/** Removes the current session's party panel; the element lives inside the HUD root, which the Game clears on dispose. */
let partyCleanup: (() => void) | null = null;

/**
 * Client-only party panel (0.5.0, key O handled in game.ts): renders the server's session-only `party` state —
 * member list with class/level/live HP bars and the leader marker, plus the pending-invite accept/decline prompt.
 * The panel hides itself while solo; its buttons are the only interactive parts.
 */
function attachParty(g: Game): void {
  partyCleanup?.();
  const panel = new PartyPanel(g.hudRoot, {
    send: (a) => g.sendParty(a),
    toast: (msg) => g.toast(msg),
  });
  g.party = panel;
  partyCleanup = () => { panel.dispose(); partyCleanup = null; };
}

/** Removes the current session's trade window; the elements live inside the HUD root, which the Game clears on dispose. */
let tradeCleanup: (() => void) | null = null;

/**
 * Client-only trade window (0.5.0): renders the server's session-only two-sided trade state (`{t:"trade"}`) as a paper
 * card — your offer / their offer with coin, a Ready toggle and Cancel — plus the request card with Accept/Decline while
 * a trade request is addressed to you. All movement of items/coin is server-authoritative; the panel only asks.
 */
function attachTrade(g: Game): void {
  tradeCleanup?.();
  const panel = new TradePanel(g.hudRoot, {
    send: (a, extra) => g.sendTrade(a, extra),
    toast: (msg) => g.toast(msg),
    bag: () => g.tradeBag(),
  });
  g.trade = panel;
  tradeCleanup = () => { panel.dispose(); tradeCleanup = null; };
}

let entering = false;
async function enter(v: LoginValues, auto = false): Promise<void> {
  if (entering) return;
  entering = true;
  login.busy(true, `Connecting to ${v.server}…`);
  try {
    let tok: string | undefined;
    if (launcher) { // the token is taken exactly once; it is not kept in `v`, storage or the reconnect arguments
      tok = (await launcher.takeToken()) ?? undefined;
      if (!tok) throw new Error("This launcher session was already used.");
    }
    const { net, welcome } = await connectAndLogin(tok ? { ...v, tok } : v, (msg) => login.busy(true, msg));
    tok = undefined;
    store("jz.name", v.name); store("jz.cls", v.cls);
    if (launcher) rememberCharacter(v.name); else store("jz.server", v.server);
    login.hide();
    const g = new Game(net, welcome, v.name, v.cls);
    game = g;
    attachCombatLog(g);
    attachQuestTracker(g);
    attachCombatFeedback(g);
    attachStats(g);
    attachBestiary(g);
    attachPet(g);
    attachParty(g);
    attachTrade(g);
    wire(g, net, v);
  } catch (e) {
    lastLoginError = e instanceof Error ? e.message : String(e);
    login.busy(false);
    if (launcher) login.launcherDead(lastLoginError); else login.error(lastLoginError);
    login.show();
    if (auto) console.warn("auto-login failed:", lastLoginError);
  } finally {
    entering = false;
  }
}

/** Attach network callbacks for the current connection: drop -> auto-reconnect (same name/class) -> login screen on failure. */
function wire(g: Game, net: NetClient, v: LoginValues) {
  let cancelled = false;
  liveNet = net;
  net.onMsg = (m) => g.handle(m);
  attachMountKey(g, net); // 0.5.0: the mount toggle follows the active socket (re-attached on every reconnect)
  net.onClose = (info) => {
    if (game !== g) return;
    console.info(`[net] connection lost (code ${info.code}): ${info.reason}`);
    if (launcher) { // the one-use token is spent, so a silent re-login is impossible: ask for a fresh session instead
      cancelled = true;
      g.showConnectionLost("Connection lost. Please restart from the launcher.");
      return;
    }
    g.showReconnecting(0, RECONNECT_DELAYS_MS.length, "");
    void (async () => {
      const res = await reconnectWithBackoff(v, {
        onAttempt: (n, total, err) => g.showReconnecting(n, total, err),
        cancelled: () => cancelled || game !== g,
      });
      if (cancelled || game !== g) { res?.net.close(); return; }
      if (!res) {
        console.info("[net] giving up after all reconnect attempts");
        g.onExit();
        login.error(`Could not reconnect to ${v.server}. The connection was lost (${info.reason}).`);
        return;
      }
      g.rebind(res.net, res.welcome);
      g.combatLog?.clear(); // a fresh connection starts with a clean combat log
      g.questTracker?.clear(); // ...and no stale side-quest rows until the new `sq` arrives
      g.combatFeedback?.reset(); // ...and no stale red edge from the lost session's last hit or low health
      g.stats?.reset(); // ...and the session statistics start over on the new connection
      g.bestiary?.clear(); // ...and the codex waits for the new login's `best` (the persisted counts come back with it)
      g.party?.clear(); // ...and no stale party rows/invite until the new login's party state arrives
      g.trade?.clear(); // ...and no stale trade window until the new login's trade state arrives
      wire(g, res.net, v);
    })();
  };
  g.onExit = () => { cancelled = true; g.dispose(); game = null; liveNet = null; net.close(); login.show(); login.error("Returned to the login screen."); };
  const exit = g.onExit;
  g.onExit = () => { combatLogCleanup?.(); statsCleanup?.(); bestiaryCleanup?.(); petCleanup?.(); mountCleanup?.(); partyCleanup?.(); tradeCleanup?.(); exit(); };
}

/** Make sure the brush and body faces are loaded before the login screen, banners and in-world signage canvases need them. */
async function fontsReady(): Promise<void> {
  try {
    const loads = Promise.all([
      document.fonts.load('48px "Ma Shan Zheng"', "Sword & Seal"),
      document.fonts.load('400 14px "Noto Serif"', "Abc"),
      document.fonts.load('600 14px "Noto Serif"', "Abc"),
      document.fonts.load('700 14px "Noto Serif"', "Abc"),
    ]);
    await Promise.race([loads, new Promise((r) => window.setTimeout(r, 3000))]);
  } catch { /* fall back to system serif */ }
}

void fontsReady().then(async () => {
  const det = await detectLauncher(params);
  if (det.ctx) {
    launcher = det.ctx;
    const known = isKnownCharacter(det.ctx.name) || (qCls !== null && CLASSES.includes(qCls));
    login.setLauncher({ name: det.ctx.name, server: det.ctx.serverUrl, pickClass: !known });
    login.show();
    if (known) void enter({ name: det.ctx.name, cls: initCls, server: det.ctx.serverUrl, pw: "" }, true);
    else login.info("Choose your path of cultivation to create your character.");
    return;
  }
  login.show();
  if (det.rejected) login.error(det.rejected);
  if (autoLogin) {
    const name = params.get("name") || `Wanderer${Math.floor(Math.random() * 900 + 100)}`;
    void enter({ name, cls: initCls, server: params.get("server") || defaultServer, pw: qPw }, true);
  }
});
