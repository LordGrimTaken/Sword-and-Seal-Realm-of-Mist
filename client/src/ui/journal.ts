import { WORLD_SIZE, type AchView, type PoiView, type SideQuestView } from "@shared/protocol";
import { esc, plain } from "./glyphs";

export interface Progress { ach: AchView[]; pts: number; title: string | null; titles: string[]; pois: PoiView[] }

const LAND: Array<{ n: string; x: number; z: number; r: number; c: string }> = [
  { n: "Spawn Plaza", x: 0, z: -80, r: 13, c: "#f2ead8" },
  { n: "Lotus Pond", x: 0, z: -34, r: 15.5, c: "#5f8c96" },
  { n: "Bamboo Grove", x: -40, z: 10, r: 24, c: "#4fa58b" },
  { n: "Fox Hills", x: 55, z: 30, r: 22, c: "#c99246" },
  { n: "Ruined Shrine", x: 0, z: 85, r: 14, c: "#5a5a64" },
];
const TAB_NAMES: Array<[string, string]> = [["quests", "Side Quests"], ["merit", "Merit Seals"], ["titles", "Titles"], ["atlas", "Atlas"]];

/** Journal (key J): side-quest log, merit seals, titles and a small atlas of discovered places. All data comes from the server. */
export class Journal {
  private el: HTMLElement;
  private tab = "quests";
  sq: SideQuestView[] = [];
  prog: Progress = { ach: [], pts: 0, title: null, titles: [], pois: [] };
  constructor(root: HTMLElement, private send: (m: import("@shared/protocol").ClientMsg) => void) {
    this.el = document.createElement("div");
    this.el.id = "journal";
    this.el.className = "panel cxp";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Journal");
    root.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
      if (!b) return;
      const a = b.dataset.a;
      if (a === "close") this.toggle(false);
      else if (a === "tab") { this.tab = b.dataset.t!; this.render(); }
      else if (a === "title") this.send({ t: "title", id: b.dataset.id ?? "" });
    });
  }
  get isOpen() { return this.el.classList.contains("show"); }
  get activeTab() { return this.tab; }
  toggle(force?: boolean, tab?: string) {
    const on = force ?? !this.isOpen;
    if (tab) this.tab = tab;
    this.el.classList.toggle("show", on);
    if (on) this.render();
  }
  update() { if (this.isOpen) this.render(); }

  private quests(): string {
    const list = this.sq.filter((q) => q.st !== "offer");
    if (!list.length) return `<div class="cxnone">No side tasks yet. Gate Warden Wu, Artisan Tao and Peddler Hao in the plaza have work for you.</div>`;
    const order = { ready: 0, active: 1, offer: 2, done: 3 };
    return list.slice().sort((a, b) => order[a.st] - order[b.st]).map((q) => {
      if (q.st === "done") return `<div class="cxq done"><div class="cxqh"><b>${esc(plain(q.title))}</b><span class="cxbadge">Done</span></div></div>`;
      const obj = q.obj.map((o) => `<li class="${o.have >= o.need ? "ok" : ""}"><span class="cxcheck">${o.have >= o.need ? "&#10003;" : ""}</span><span>${esc(plain(o.text))}</span><i>${o.have} / ${o.need}</i></li>`).join("");
      return `<div class="cxq ${q.st}"><div class="cxqh"><b>${esc(plain(q.title))}</b><span class="cxbadge">${q.st === "ready" ? "Hand in to " + esc(q.npc) : "In progress"}</span></div><ul class="cxo">${obj}</ul></div>`;
    }).join("");
  }
  private merit(): string {
    const cats = [...new Set(this.prog.ach.map((a) => a.cat))];
    return `<div class="cxsum"><b>Merit points</b> ${this.prog.pts} · ${this.prog.ach.filter((a) => a.done).length} / ${this.prog.ach.length} seals earned</div>` + cats.map((c) =>
      `<h4>${esc(c)}</h4><div class="cxgrid">${this.prog.ach.filter((a) => a.cat === c).map((a) =>
        `<div class="cxa${a.done ? " done" : ""}"><span class="cxas">${a.done ? "&#10003;" : ""}</span><div><b>${esc(plain(a.name))}</b><span>${esc(plain(a.desc))}</span>${a.done ? "" : `<em>${Math.min(a.have, a.need)} / ${a.need}</em>`}${a.title ? `<small>Title: ${esc(plain(a.title))}</small>` : ""}</div><i>${a.pts}</i></div>`).join("")}</div>`).join("");
  }
  private titles(): string {
    const t = this.prog.titles;
    if (!t.length) return `<div class="cxnone">No titles yet. Finish quest chains and earn merit seals to be known by a name.</div>`;
    return `<div class="cxsum"><b>Worn</b> ${esc(plain(this.prog.title ?? "none"))}</div><div class="cxlist">${t.map((n) => `<div class="cxr"><div class="cxm"><b>${esc(plain(n))}</b></div><button type="button" class="btn sm${n === this.prog.title ? " gold" : ""}" data-a="title" data-id="${esc(n)}">${n === this.prog.title ? "Worn" : "Wear"}</button></div>`).join("")}</div>` +
      (this.prog.title ? `<div class="cxf"><button type="button" class="btn sm ghost" data-a="title" data-id="">Remove title</button></div>` : "");
  }
  private atlas(): string {
    const S = 300, k = S / WORLD_SIZE, h = WORLD_SIZE / 2;
    const px = (x: number) => ((x + h) * k).toFixed(1), pz = (z: number) => ((z + h) * k).toFixed(1);
    const land = LAND.map((l) => `<circle cx="${px(l.x)}" cy="${pz(l.z)}" r="${(l.r * k).toFixed(1)}" fill="${l.c}" opacity=".5"/><text x="${px(l.x)}" y="${(Number(pz(l.z)) - l.r * k - 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="#3a3326">${esc(l.n)}</text>`).join("");
    const pts = this.prog.pois.filter((p) => p.found && p.x !== undefined && p.z !== undefined).map((p) => `<g><path d="M${px(p.x!)} ${(Number(pz(p.z!)) - 6).toFixed(1)}l4 6-4 6-4-6z" fill="#c8372d" stroke="#1a1a1f" stroke-width=".8"/></g>`).join("");
    const found = this.prog.pois.filter((p) => p.found).length;
    return `<div class="cxatlas"><svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Atlas of discovered places"><rect width="${S}" height="${S}" fill="#e6dcc3" stroke="#1a1a1f" stroke-width="2"/>${land}${pts}</svg>
      <ul class="cxpoi"><li class="cxsum"><b>Places found</b> ${found} / ${this.prog.pois.length}</li>${this.prog.pois.map((p) => `<li class="${p.found ? "ok" : ""}"><span class="cxcheck">${p.found ? "&#10003;" : ""}</span>${p.found ? esc(plain(p.name)) : "Undiscovered place"}</li>`).join("")}</ul></div>`;
  }
  private render() {
    const body = this.tab === "merit" ? this.merit() : this.tab === "titles" ? this.titles() : this.tab === "atlas" ? this.atlas() : this.quests();
    this.el.innerHTML = `<div class="rodt"></div>
      <div class="cxh"><span class="brush">Journal</span><small>${esc(plain(this.prog.title ?? ""))}</small><button type="button" class="bx" data-a="close" aria-label="Close journal">&times;</button></div>
      <div class="cxtabs">${TAB_NAMES.map(([t, l]) => `<button type="button" class="cxtab${this.tab === t ? " on" : ""}" data-a="tab" data-t="${t}">${l}</button>`).join("")}</div>
      <div class="cxbody">${body}</div><div class="cxf">Press J to close</div><div class="rodb"></div>`;
  }
}
