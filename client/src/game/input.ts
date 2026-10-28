/** Keyboard / mouse input. Game keys are ignored while a text field has focus. */
export interface InputHandlers {
  onCast(slot: number): void;
  /** Tab (back = false) or Shift+Tab (back = true) */
  onTab(back: boolean): void;
  onEnter(): void;
  onEscape(): void;
  onClick(x: number, y: number): void;
  onOrbit(dx: number, dy: number): void;
  onZoom(delta: number): void;
  onMute?(): void;
}

function typing(): boolean {
  const a = document.activeElement;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}

export class Input {
  private keys = new Set<string>();
  private dispose: Array<() => void> = [];
  private rmb = false;
  private downX = 0;
  private downY = 0;
  private moved = 0;

  constructor(private canvas: HTMLElement, private h: InputHandlers) {
    const on = <K extends keyof WindowEventMap>(t: K, fn: (e: WindowEventMap[K]) => void, target: Window | HTMLElement = window, opts?: AddEventListenerOptions) => {
      (target as Window).addEventListener(t, fn as EventListener, opts);
      this.dispose.push(() => (target as Window).removeEventListener(t, fn as EventListener, opts));
    };

    on("keydown", (e) => {
      if (e.code === "Enter") {
        if (!typing()) { e.preventDefault(); h.onEnter(); }
        return;
      }
      if (e.code === "Escape") { if (typing()) (document.activeElement as HTMLElement).blur(); else h.onEscape(); return; }
      if (typing()) return;
      if (e.code === "KeyM") { if (!e.repeat) h.onMute?.(); return; }
      if (e.code === "Tab") { e.preventDefault(); h.onTab(e.shiftKey); return; }
      const m = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
      if (m) { if (!e.repeat) h.onCast(parseInt(m[1], 10)); return; }
      this.keys.add(e.code);
    });
    on("keyup", (e) => { this.keys.delete(e.code); });
    on("blur", () => { this.keys.clear(); this.rmb = false; });

    on("contextmenu", (e) => e.preventDefault());
    on("pointerdown", (e) => {
      if (e.target !== canvas) return;
      if (e.button === 2) { this.rmb = true; try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
      if (e.button === 0) { this.downX = e.clientX; this.downY = e.clientY; this.moved = 0; this.lmb = true; }
    });
    on("pointermove", (e) => {
      if (this.rmb) h.onOrbit(e.movementX * 0.006, e.movementY * 0.006);
      if (this.lmb) this.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    });
    on("pointerup", (e) => {
      if (e.button === 2) this.rmb = false;
      if (e.button === 0 && this.lmb) {
        this.lmb = false;
        if (e.target === canvas && this.moved < 6) h.onClick(e.clientX, e.clientY);
      }
    });
    on("wheel", (e) => { if (e.target === canvas) { e.preventDefault(); h.onZoom(e.deltaY); } }, window, { passive: false });
  }
  private lmb = false;

  /** Movement intent in screen space: x = right, y = forward, each in [-1,1]. */
  axes(): { right: number; fwd: number } {
    if (typing()) return { right: 0, fwd: 0 };
    const k = this.keys;
    const fwd = (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    const right = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0);
    return { right, fwd };
  }

  destroy() { this.dispose.forEach((d) => d()); this.dispose = []; }
}
