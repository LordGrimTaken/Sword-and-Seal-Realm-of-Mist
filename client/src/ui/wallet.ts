import { icon } from "./icons";

interface Cell { el: HTMLElement; num: HTMLElement; shown: number; target: number; raf: number; timer: number }

const fmt = (n: number) => Math.max(0, Math.round(n)).toLocaleString("en-US");

/** Lacquer pill with the two currencies: number tick-up, a gentle pulse and a floating "+N" on every gain. */
export class Wallet {
  readonly el: HTMLElement;
  private coin: Cell;
  private jade: Cell;
  private loaded = false;

  constructor(root: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "wallet";
    this.el.setAttribute("role", "status");
    this.el.innerHTML = `
      <div class="wc coin" title="Coin" aria-label="Coin"><span class="wi">${icon("coin")}</span><span class="wn">0</span></div>
      <div class="wsep" aria-hidden="true"></div>
      <div class="wc jade" title="Jade - rare currency" aria-label="Jade, rare currency"><span class="wi">${icon("jadeDisc")}</span><span class="wn">0</span></div>`;
    root.appendChild(this.el);
    this.coin = this.cell(".wc.coin");
    this.jade = this.cell(".wc.jade");
  }

  private cell(sel: string): Cell {
    const el = this.el.querySelector(sel) as HTMLElement;
    return { el, num: el.querySelector(".wn") as HTMLElement, shown: 0, target: 0, raf: 0, timer: 0 };
  }

  get values() { return { coin: this.coin.target, jade: this.jade.target }; }

  set(coin: number, jade: number) {
    const c = Number.isFinite(coin) ? Math.max(0, Math.floor(coin)) : 0;
    const j = Number.isFinite(jade) ? Math.max(0, Math.floor(jade)) : 0;
    this.apply(this.coin, c, this.loaded);
    this.apply(this.jade, j, this.loaded);
    this.loaded = true;
  }

  reset() {
    for (const c of [this.coin, this.jade]) { window.cancelAnimationFrame(c.raf); c.shown = c.target = 0; c.num.textContent = "0"; }
    this.loaded = false;
  }

  private apply(c: Cell, v: number, animate: boolean) {
    const delta = v - c.target;
    c.target = v;
    if (!animate || delta === 0) { window.cancelAnimationFrame(c.raf); c.shown = v; c.num.textContent = fmt(v); return; }
    c.el.classList.remove("pulse");
    void c.el.offsetWidth;
    c.el.classList.add("pulse");
    window.clearTimeout(c.timer);
    c.timer = window.setTimeout(() => c.el.classList.remove("pulse"), 900);
    if (delta > 0) this.floatText(c, `+${fmt(delta)}`);
    // tick the shown number towards the target
    window.cancelAnimationFrame(c.raf);
    const from = c.shown, t0 = performance.now(), dur = Math.min(900, 350 + Math.abs(delta) * 6);
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / dur);
      const e = 1 - (1 - u) * (1 - u);
      c.shown = from + (c.target - from) * e;
      c.num.textContent = fmt(c.shown);
      if (u < 1 && c.target === v) c.raf = window.requestAnimationFrame(step);
      else if (u >= 1) { c.shown = c.target; c.num.textContent = fmt(c.target); }
    };
    c.raf = window.requestAnimationFrame(step);
  }

  private floatText(c: Cell, text: string) {
    const f = document.createElement("span");
    f.className = "wfloat";
    f.textContent = text;
    c.el.appendChild(f);
    window.setTimeout(() => f.remove(), 1500);
  }
}
