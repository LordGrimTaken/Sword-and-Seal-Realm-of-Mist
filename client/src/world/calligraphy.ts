// Brush calligraphy on canvas textures, using the bundled Ma Shan Zheng face (loaded before drawing, redrawn when ready).
import * as THREE from "three";

export const BRUSH = "'Ma Shan Zheng', 'Noto Serif', Georgia, serif";

const fontPromises = new Map<string, Promise<void>>();
/** resolves once the brush face is loaded (never rejects; resolves after a timeout if fonts are unavailable). `text` is only a cache key. */
export function ensureBrushFont(text: string): Promise<void> {
  let p = fontPromises.get(text);
  if (p) return p;
  if (typeof document === "undefined" || !document.fonts || !document.fonts.load) p = Promise.resolve();
  else {
    const load = Promise.all([
      document.fonts.load('64px "Ma Shan Zheng"'),
      document.fonts.load('700 32px "Noto Serif"').catch(() => []),
    ]).then(() => undefined, () => undefined);
    p = Promise.race([load, new Promise<void>((r) => setTimeout(r, 6000))]);
  }
  fontPromises.set(text, p);
  return p;
}

export interface BrushOpts {
  size: number;               // px font size (upper bound when maxW is set)
  fill?: string | CanvasGradient;
  edge?: string;              // dark outline / ink bleed
  edgeW?: number;
  dry?: number;               // 0..1 dry-brush speckle removal (applied to the text only, never to the background)
  vertical?: boolean;         // stack letters top-to-bottom
  spacing?: number;           // letter spacing (horizontal) or line spacing (vertical) multiplier
  rot?: number;               // rotate the whole text block around (cx, cy), radians
  shadow?: string;
  bold?: number;              // extra stroke weight (px, in the fill colour) to thicken thin brush glyphs
  maxW?: number;              // shrink the font so the widest line fits this width
  lineH?: number;             // line height multiplier for multi-line ("\n") text
}

/** draw (possibly multi-line, "\n") text centred at cx,cy as brushwork: ink bleed, an offset under-stroke, dry-brush breakup */
export function brushText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, o: BrushOpts): void {
  const lines = text.split("\n");
  const measure = document.createElement("canvas").getContext("2d")!;
  let size = o.size;
  const ls = (sz: number) => (o.vertical ? 0 : ((o.spacing ?? 1.0) - 1) * sz * 0.5);
  const widthOf = (sz: number) => {
    measure.font = `${sz}px ${BRUSH}`;
    let w = 0; for (const ln of lines) w = Math.max(w, measure.measureText(ln).width + ls(sz) * Math.max(0, ln.length - 1));
    return w;
  };
  if (o.maxW && !o.vertical) { const w = widthOf(size); if (w > o.maxW) size *= o.maxW / w; }
  const lh = size * (o.lineH ?? 1.05);
  const w = o.vertical ? size : widthOf(size);
  const h = o.vertical ? Array.from(text).length * size * (o.spacing ?? 1.0) : lh * lines.length;
  // text goes onto its own layer so dry-brush gaps never punch through the board behind it
  const pad = Math.ceil(size * 0.35 + (o.edgeW ?? 0) + 8), R = Math.ceil(Math.hypot(w, h) / 2 + pad);
  const layer = document.createElement("canvas"); layer.width = layer.height = R * 2;
  const lg = layer.getContext("2d")!;
  lg.translate(R, R); if (o.rot) lg.rotate(o.rot);
  lg.font = `${size}px ${BRUSH}`;
  lg.textAlign = "center"; lg.textBaseline = "middle"; lg.lineJoin = "round"; lg.lineCap = "round";
  try { (lg as unknown as { letterSpacing: string }).letterSpacing = `${ls(size)}px`; } catch { /* older engines: default spacing */ }
  const draw = (ch: string, x: number, y: number) => {
    if (o.shadow) { lg.fillStyle = o.shadow; lg.fillText(ch, x + 2.5, y + 3.5); }
    if (o.edge) { lg.strokeStyle = o.edge; lg.lineWidth = o.edgeW ?? Math.max(2, size * 0.06); lg.strokeText(ch, x, y); }
    lg.fillStyle = o.fill ?? "#e8c24a";
    if (o.bold) { lg.strokeStyle = o.fill ?? "#e8c24a"; lg.lineWidth = o.bold; lg.strokeText(ch, x, y); }
    lg.fillText(ch, x, y);
    lg.globalAlpha = 0.5; lg.fillText(ch, x - size * 0.012, y - size * 0.012); lg.globalAlpha = 1;
  };
  if (o.vertical) {
    const chars = Array.from(text), step = size * (o.spacing ?? 1.0);
    chars.forEach((ch, i) => draw(ch, 0, -h / 2 + step * (i + 0.5)));
  } else {
    lines.forEach((ln, i) => draw(ln, ls(size) / 2, -h / 2 + lh * (i + 0.5)));
  }
  if (o.dry) dryBrush(lg, -R, -R, R * 2, R * 2, o.dry);
  g.drawImage(layer, cx - R, cy - R);
}

/** punch small streaks out of the existing pixels (white dry-brush gaps) */
export function dryBrush(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amount: number): void {
  g.save();
  g.globalCompositeOperation = "destination-out";
  let s = 12345;
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = Math.floor(w * h * 0.0016 * amount);
  for (let i = 0; i < n; i++) {
    const px = x + r() * w, py = y + r() * h, len = 4 + r() * 22;
    g.fillStyle = `rgba(0,0,0,${0.35 + r() * 0.5})`;
    g.fillRect(px, py, len, 0.6 + r() * 1.3);
  }
  g.restore();
}

export interface CanvasTex { tex: THREE.CanvasTexture; canvas: HTMLCanvasElement; redraw(): void }

/**
 * Create a CanvasTexture drawn by `draw`; draws once immediately (fallback font) and again after the brush font
 * has loaded, so lettering always ends up as real brushwork.
 */
export function canvasTex(w: number, h: number, glyphs: string, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): CanvasTex {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const redraw = () => { g.clearRect(0, 0, w, h); draw(g, w, h); tex.needsUpdate = true; };
  redraw();
  void ensureBrushFont(glyphs).then(redraw);
  return { tex, canvas: cv, redraw };
}

/** convenience: a rectangular paper/seal-style single glyph texture (used for vfx, runes) */
export function glyphTexture(ch: string, size: number, fill: string, edge?: string, bg?: string): CanvasTex {
  return canvasTex(size, size, ch, (g, w, h) => {
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    brushText(g, ch, w / 2, h / 2 + h * 0.03, { size: w * 0.86, fill, edge, edgeW: w * 0.04, dry: 0.4 });
  });
}
