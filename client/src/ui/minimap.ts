import { INTEREST_RADIUS } from "@shared/protocol";

const SIZE = 168;
const PLACES = { plaza: { x: 0, z: -80 }, pond: { x: 0, z: -34 }, fox: { x: 55, z: 30 }, shrine: { x: 0, z: 85 } };

/** Round ink-wash minimap. Rotates with the camera so "up" is where you look. */
export class Minimap {
  readonly el: HTMLDivElement;
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private dpr = Math.min(window.devicePixelRatio || 1, 2);

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.id = "minimap";
    this.el.className = "panel";
    const c = document.createElement("canvas");
    c.width = c.height = SIZE * this.dpr;
    this.el.appendChild(c);
    parent.appendChild(this.el);
    this.ctx = c.getContext("2d")!;
    this.bg = this.paintBackground();
  }

  private paintBackground(): HTMLCanvasElement {
    const S = SIZE * this.dpr;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
    grad.addColorStop(0, "#e6e3d2");
    grad.addColorStop(0.7, "#cfd9dc");
    grad.addColorStop(1, "#8fa3ad");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    // ink-wash blotches (seeded)
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S, y = rnd() * S, r = (0.06 + rnd() * 0.16) * S;
      const b = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + rnd() * 0.12;
      b.addColorStop(0, `rgba(58,58,68,${a})`);
      b.addColorStop(1, "rgba(58,58,68,0)");
      g.fillStyle = b;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // faint range rings
    g.strokeStyle = "rgba(58,58,68,.28)";
    g.lineWidth = this.dpr;
    for (const f of [0.33, 0.66]) { g.beginPath(); g.arc(S / 2, S / 2, (S / 2) * f, 0, Math.PI * 2); g.stroke(); }
    return c;
  }

  draw(me: { x: number; z: number }, yaw: number, dots: Array<{ x: number; z: number; k: "player" | "mob" | "npc"; dead: boolean; mob?: string }>, dangers: Array<{ x: number; z: number; radius: number; frac: number }> = []) {
    const g = this.ctx, S = SIZE * this.dpr, R = S / 2;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.clip();
    g.drawImage(this.bg, 0, 0);
    const scale = (R - 6 * this.dpr) / INTEREST_RADIUS;
    // static landmarks of Cloudmist Valley, painted in ink-wash colours under the dots
    const cosF = Math.cos(yaw), sinF = Math.sin(yaw);
    const toScreen = (wx: number, wz: number): [number, number] => {
      const dx = wx - me.x, dz = wz - me.z;
      return [R + (dx * cosF - dz * sinF) * scale, R + -(dx * -sinF + dz * -cosF) * scale];
    };
    const blob = (wx: number, wz: number, wr: number, col: string) => {
      const [x, y] = toScreen(wx, wz);
      g.fillStyle = col; g.beginPath(); g.arc(x, y, wr * scale, 0, Math.PI * 2); g.fill();
    };
    blob(PLACES.plaza.x, PLACES.plaza.z, 13, "rgba(242,234,216,.75)");
    blob(PLACES.pond.x, PLACES.pond.z, 15.5, "rgba(95,140,150,.55)");
    blob(-40, 10, 24, "rgba(79,165,139,.30)");   // bamboo grove
    blob(PLACES.fox.x, PLACES.fox.z, 22, "rgba(201,146,70,.28)"); // fox hills
    blob(PLACES.shrine.x, PLACES.shrine.z, 14, "rgba(90,90,100,.32)");
    // lantern path + bridge
    g.strokeStyle = "rgba(58,58,68,.55)"; g.lineWidth = 2 * this.dpr; g.beginPath();
    let first = true;
    for (let z = -80; z <= 80; z += 8) { const [x, y] = toScreen(0, z); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    g.stroke();
    // shrine seal
    { const [x, y] = toScreen(PLACES.shrine.x, PLACES.shrine.z); g.fillStyle = "#c8372d"; g.fillRect(x - 3 * this.dpr, y - 3 * this.dpr, 6 * this.dpr, 6 * this.dpr); }
    // telegraphed boss attacks: pulsing red disc that fills as the wind-up completes
    for (const d of dangers) {
      const [x, y] = toScreen(d.x, d.z);
      const rr = Math.max(4 * this.dpr, d.radius * scale);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.015);
      g.fillStyle = `rgba(200,55,45,${0.18 + 0.2 * d.frac + 0.1 * pulse})`;
      g.beginPath(); g.arc(x, y, rr * Math.max(0.15, d.frac), 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(200,55,45,${0.7 + 0.3 * pulse})`; g.lineWidth = 2 * this.dpr;
      g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.stroke();
    }
    // rotate so camera forward is up. forward = (-sin yaw, -cos yaw)
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    for (const d of dots) {
      const dx = d.x - me.x, dz = d.z - me.z;
      // right vector r=(cos,-sin); forward f=(-sin,-cos)
      const sx = dx * cosY - dz * sinY;
      const sy = -(dx * -sinY + dz * -cosY);
      const px = R + sx * scale, py = R + sy * scale;
      if ((px - R) ** 2 + (py - R) ** 2 > (R - 4) ** 2) continue;
      const boss = d.mob === "stone_guardian", serpent = d.mob === "jade_serpent";
      const r = (boss ? 5 : d.k === "mob" ? 3 : 3.4) * this.dpr;
      g.beginPath();
      g.fillStyle = d.dead ? "rgba(58,58,68,.6)" : serpent ? "#3f9d86" : d.k === "mob" ? "#c8372d" : d.k === "npc" ? "#c9a227" : "#4fa58b";
      if (serpent) { // jade diamond
        g.moveTo(px, py - r * 1.3); g.lineTo(px + r, py); g.lineTo(px, py + r * 1.3); g.lineTo(px - r, py); g.closePath();
      } else if (boss) { // vermilion square seal
        g.rect(px - r, py - r, r * 2, r * 2);
      } else g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = this.dpr;
      g.strokeStyle = boss && !d.dead ? "#c9a227" : "#1a1a1f";
      if (boss) g.lineWidth = 1.6 * this.dpr;
      g.stroke();
    }
    // me: ink arrow pointing up
    g.fillStyle = "#1a1a1f";
    g.beginPath();
    g.moveTo(R, R - 7 * this.dpr);
    g.lineTo(R + 5 * this.dpr, R + 5 * this.dpr);
    g.lineTo(R, R + 2 * this.dpr);
    g.lineTo(R - 5 * this.dpr, R + 5 * this.dpr);
    g.closePath();
    g.fill();
    g.strokeStyle = "#f2ead8";
    g.lineWidth = this.dpr;
    g.stroke();
    g.restore();
  }
}
