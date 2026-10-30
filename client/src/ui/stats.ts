/** Compact count formatting for the stat values: whole numbers with thousands separators. */
function num(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("en-US");
}

/** Session clock: "m:ss" under an hour, "h:mm:ss" beyond it. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Read-only snapshot for the debug surface (`window.__jz.stats`) and UI tests. */
export interface SessionStatsDebug {
  open: boolean;
  mobsSlain: number;
  damageDealt: number;
  damageTaken: number;
  healingReceived: number;
  xpGained: number;
  sessionMs: number;
}

/**
 * Session Statistics panel (key V): a compact paper card that totals what this connection has done - mobs slain,
 * damage dealt and taken, healing received, XP gained - plus the session clock. Client-only: every counter is
 * pushed from Game.onEvent using the server `ev` messages the client already receives (damage / heal / death / xp),
 * so nothing here talks to the network and the protocol is untouched.
 *
 * The counters keep counting while the panel is closed; it is display-only chrome. `reset()` starts a fresh
 * session (main.ts calls it when a reconnect swaps in a new connection) and the clock runs on performance.now().
 */
export class SessionStatsPanel {
  private el: HTMLElement;
  private vals = new Map<string, HTMLElement>();
  private startedAt = performance.now();
  private timer = 0;
  private mobsSlain = 0;
  private dealt = 0;
  private taken = 0;
  private healed = 0;
  private xp = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "sessionstats";
    this.el.className = "panel";
    this.el.setAttribute("role", "complementary");
    this.el.setAttribute("aria-label", "Session statistics");
    this.el.innerHTML = `<div class="sth"><span class="brush">Session Stats</span><small>V to close</small></div>
      <div class="stgrid">
        <div class="st mobs" title="Mobs slain this session"><span class="stl">Mobs slain</span><b class="stv" data-k="mobs">0</b></div>
        <div class="st dealt" title="Damage you dealt this session"><span class="stl">Dmg dealt</span><b class="stv" data-k="dealt">0</b></div>
        <div class="st taken" title="Damage you took this session"><span class="stl">Dmg taken</span><b class="stv" data-k="taken">0</b></div>
        <div class="st healed" title="Healing you received this session"><span class="stl">Healing</span><b class="stv" data-k="healed">0</b></div>
        <div class="st xp" title="Experience gained this session"><span class="stl">XP</span><b class="stv" data-k="xp">0</b></div>
        <div class="st time" title="Time in this session"><span class="stl">Time</span><b class="stv" data-k="time">0:00</b></div>
      </div>`;
    root.appendChild(this.el);
    for (const v of this.el.querySelectorAll<HTMLElement>(".stv")) if (v.dataset.k) this.vals.set(v.dataset.k, v);
    this.render();
  }

  get isOpen() { return this.el.classList.contains("show"); }

  /** The local player killed a mob. */
  mobSlain() { this.mobsSlain++; this.tick(); }

  /** Damage the local player dealt to another entity. */
  damageDealt(amount: number) { this.dealt += Math.max(0, Math.round(amount)); this.tick(); }

  /** Damage the local player took. */
  damageTaken(amount: number) { this.taken += Math.max(0, Math.round(amount)); this.tick(); }

  /** Healing the local player received (self-heals included). */
  healingReceived(amount: number) { this.healed += Math.max(0, Math.round(amount)); this.tick(); }

  /** Experience the local player gained. */
  xpGained(amount: number) { this.xp += Math.max(0, Math.round(amount)); this.tick(); }

  /** Forget the whole session: every counter back to zero and the clock restarted (a reconnect is a new session). */
  reset() {
    this.mobsSlain = this.dealt = this.taken = this.healed = this.xp = 0;
    this.startedAt = performance.now();
    this.render();
  }

  toggle(force?: boolean) {
    const on = force ?? !this.isOpen;
    if (on === this.isOpen) return;
    this.el.classList.toggle("show", on);
    if (on) { this.render(); this.startClock(); } else this.stopClock();
  }

  /** Stop the session clock and detach (the HUD root is cleared on logout, but the interval must not outlive it). */
  dispose() {
    this.stopClock();
  }

  /** Read-only snapshot for the debug surface / UI tests. */
  debug(): SessionStatsDebug {
    return {
      open: this.isOpen,
      mobsSlain: this.mobsSlain,
      damageDealt: this.dealt,
      damageTaken: this.taken,
      healingReceived: this.healed,
      xpGained: this.xp,
      sessionMs: Math.max(0, Math.round(performance.now() - this.startedAt)),
    };
  }

  private tick() { if (this.isOpen) this.render(); }

  private startClock() {
    this.stopClock();
    this.timer = window.setInterval(() => this.renderClock(), 1000);
  }

  private stopClock() {
    if (this.timer) { window.clearInterval(this.timer); this.timer = 0; }
  }

  private render() {
    this.set("mobs", num(this.mobsSlain));
    this.set("dealt", num(this.dealt));
    this.set("taken", num(this.taken));
    this.set("healed", num(this.healed));
    this.set("xp", num(this.xp));
    this.renderClock();
  }

  private renderClock() { this.set("time", clock(performance.now() - this.startedAt)); }

  private set(key: string, text: string) {
    const el = this.vals.get(key);
    if (el) el.textContent = text;
  }
}
