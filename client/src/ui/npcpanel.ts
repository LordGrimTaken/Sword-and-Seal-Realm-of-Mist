import type { ClientMsg, InvItem, ServerMsg, SideQuestView } from "@shared/protocol";
import type { ContentStore } from "./gear";
import { itemSeal, statText } from "./gear";
import { esc, plain } from "./glyphs";
import { icon, type IconName } from "./icons";

type Dlg = Extract<ServerMsg, { t: "npcdlg" }>;
export interface NpcStore extends ContentStore {
  wallet(): { coin: number; jade: number };
}

export const CONTENT_NPCS: Array<{ re: RegExp; key: string; seal: IconName }> = [
  { re: /Gate Warden Wu|\bWu\b/, key: "wu", seal: "gate" },
  { re: /Artisan Tao|\bTao\b/, key: "tao", seal: "stamp" },
  { re: /Peddler Hao|\bHao\b/, key: "hao", seal: "pouch" },
];
export const contentNpcKey = (name: string): string | null => CONTENT_NPCS.find((n) => n.re.test(plain(name)))?.key ?? null;

const BADGE: Record<SideQuestView["st"], string> = { offer: "New task", active: "In progress", ready: "Ready to hand in", done: "Done" };

/** Paper-scroll dialog for the 0.4.0 NPCs: story and side-quest chain (Accept / Hand in), plus Tao's crafting and Hao's shop. The server drives every line. */
export class NpcPanel {
  private el: HTMLElement;
  private dlg: Dlg | null = null;
  private tab: "tasks" | "craft" | "buy" | "sell" = "tasks";
  private npcId = -1;
  private pending = 0;
  constructor(root: HTMLElement, private st: NpcStore, private cb: { onClose(): void }) {
    this.el = document.createElement("div");
    this.el.id = "npcp";
    this.el.className = "panel cxp";
    this.el.setAttribute("role", "dialog");
    root.appendChild(this.el);
    this.el.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
      if (!b || (b as HTMLButtonElement).disabled) return;
      const a = b.dataset.a!;
      if (a === "close") return this.close();
      if (a === "tab") { this.tab = b.dataset.t as typeof this.tab; return this.render(); }
      const npc = this.dlg?.npc;
      if (!npc) return;
      if (a === "accept" || a === "turnin") this.st.send({ t: "npc", npc, a, q: b.dataset.q } as ClientMsg);
      else if (a === "craft") this.st.send({ t: "craft", id: b.dataset.id! });
      else if (a === "buy") this.st.send({ t: "buy", item: b.dataset.i!, qty: 1 });
      else if (a === "sell") this.st.send({ t: "sell", item: b.dataset.i!, qty: Number(b.dataset.n) || 1 });
    });
  }
  get isOpen() { return this.el.classList.contains("show"); }
  get npc() { return this.isOpen ? this.npcId : -1; }
  get current() { return this.dlg; }
  /** Called by the game when the player talks: entity id + NPC key. The server's `npcdlg` reply fills the panel. */
  begin(entityId: number, key: string, name: string) {
    this.npcId = entityId;
    this.dlg = null;
    this.tab = "tasks";
    this.el.classList.add("show");
    this.el.innerHTML = `<div class="rodt"></div><div class="cxh"><span class="brush">${esc(name)}</span></div><div class="cxbody"><p class="cxsay">...</p></div><div class="rodb"></div>`;
    window.clearTimeout(this.pending);
    this.pending = window.setTimeout(() => { if (this.isOpen && !this.dlg) this.el.querySelector(".cxsay")!.textContent = "(No answer. Walk closer and try again.)"; }, 4000);
    this.st.send({ t: "npc", npc: key, a: "talk" });
  }
  close() {
    if (!this.isOpen) return;
    this.el.classList.remove("show");
    this.npcId = -1;
    window.clearTimeout(this.pending);
    this.cb.onClose();
  }
  /** `npcdlg` from the server (fresh talk or a refresh after accept / turn-in / trade). */
  onDialog(m: Dlg) {
    window.clearTimeout(this.pending);
    const first = !this.dlg || this.dlg.npc !== m.npc;
    this.dlg = { ...m, lines: m.lines.length ? m.lines : this.dlg?.lines ?? [] };
    if (first) this.tab = m.quests.some((q) => q.st === "offer" || q.st === "ready") || (!m.craft && !m.buy) ? "tasks" : m.craft ? "craft" : "buy";
    if (this.isOpen) this.render();
  }
  refresh() { if (this.isOpen && this.dlg) this.render(); }

  private have(item: string): number { return (this.st.inv() as readonly InvItem[]).find((i) => i.item === item)?.qty ?? 0; }

  private quest(q: SideQuestView): string {
    if (q.st === "done") return `<div class="cxq done"><div class="cxqh"><b>${esc(plain(q.title))}</b><span class="cxbadge">Done</span></div></div>`;
    const obj = q.obj.map((o) => {
      const ok = o.have >= o.need;
      return `<li class="${ok ? "ok" : ""}"><span class="cxcheck">${ok ? "&#10003;" : ""}</span><span>${esc(plain(o.text))}</span><i>${o.have} / ${o.need}</i></li>`;
    }).join("");
    const btn = q.st === "offer" ? `<button type="button" class="btn sm" data-a="accept" data-q="${esc(q.id)}">Accept task</button>`
      : q.st === "ready" ? `<button type="button" class="btn sm gold" data-a="turnin" data-q="${esc(q.id)}">Hand in</button>` : "";
    return `<div class="cxq ${q.st}"><div class="cxqh"><b>${esc(plain(q.title))}</b><span class="cxbadge">${BADGE[q.st]}</span></div>
      <p class="cxqt">${esc(plain(q.text))}</p><ul class="cxo">${obj}</ul>
      <div class="cxrwd"><span>Reward</span>${q.rewards.map((r) => `<em>${esc(plain(r))}</em>`).join("")}${btn}</div></div>`;
  }

  private craftTab(d: Dlg): string {
    const w = this.st.wallet();
    return `<div class="cxlist">${(d.craft ?? []).map((r) => {
      const info = this.st.items.get(r.out);
      const lvOk = this.st.level() >= r.lv;
      const mats = r.mats.map((m) => { const h = this.have(m.item); return `<span class="cxmat${h >= m.qty ? " ok" : ""}">${esc(plain(m.item))} <b>${Math.min(h, 99)}/${m.qty}</b></span>`; }).join("");
      const can = lvOk && r.mats.every((m) => this.have(m.item) >= m.qty) && w.coin >= r.coin && w.jade >= r.jade;
      const cost = `${r.coin ? `<span class="cxcost${w.coin >= r.coin ? " ok" : ""}">${icon("coin")}${r.coin}</span>` : ""}${r.jade ? `<span class="cxcost${w.jade >= r.jade ? " ok" : ""}">${icon("jadeDisc")}${r.jade}</span>` : ""}`;
      return `<div class="cxr" style="--rc:${({ common: "#8a8577", fine: "#4fa58b", rare: "#3f7fa6", epic: "#c8372d" } as Record<string, string>)[info?.rarity ?? "fine"]}">${itemSeal(r.out, info?.rarity ?? "fine")}
        <div class="cxm"><b>${esc(plain(r.out))}${r.qty > 1 ? ` x${r.qty}` : ""}</b>${info?.kind === "gear" ? `<span class="cxk">${esc(info.rarity ?? "")} · Lv ${info.lv}</span><span class="cxst">${esc(statText(info.stats))}</span>` : `<span class="cxst">${esc(plain(info?.text ?? ""))}</span>`}
        <div class="cxmats">${mats}${cost}</div></div>
        <button type="button" class="btn sm" data-a="craft" data-id="${esc(r.id)}"${can ? "" : " disabled"}>${lvOk ? "Craft" : `Lv ${r.lv}`}</button></div>`;
    }).join("")}</div>`;
  }

  private buyTab(d: Dlg): string {
    const w = this.st.wallet();
    return `<div class="cxlist">${(d.buy ?? []).map((b) => {
      const info = this.st.items.get(b.item);
      return `<div class="cxr">${itemSeal(b.item, info?.rarity ?? "fine")}<div class="cxm"><b>${esc(plain(b.item))}</b><span class="cxst">${esc(info?.kind === "gear" ? statText(info.stats) + (info.cls ? ` · ${info.cls === "sword" ? "Sword" : info.cls === "talisman" ? "Talisman" : "Physician"} only` : "") : plain(info?.text ?? ""))}</span></div>
        <span class="cxcost${w.coin >= b.price ? " ok" : ""}">${icon("coin")}${b.price}</span><button type="button" class="btn sm" data-a="buy" data-i="${esc(b.item)}"${w.coin >= b.price ? "" : " disabled"}>Buy</button></div>`;
    }).join("")}</div>`;
  }

  private sellTab(d: Dlg): string {
    const inv = (this.st.inv() as readonly InvItem[]);
    const rows = (d.sell ?? []).map((s) => ({ s, q: inv.find((i) => i.item === s.item)?.qty ?? 0 })).filter((r) => r.q > 0);
    if (!rows.length) return `<div class="cxnone">Nothing in your pack that Hao wants. He buys materials, potions and spare gear.</div>`;
    return `<div class="cxlist">${rows.map(({ s, q }) => `<div class="cxr">${itemSeal(s.item, this.st.items.get(s.item)?.rarity ?? "common")}<div class="cxm"><b>${esc(plain(s.item))}</b> <i>x${q}</i></div>
      <span class="cxcost ok">${icon("coin")}${s.price}</span><button type="button" class="btn sm" data-a="sell" data-i="${esc(s.item)}" data-n="1">Sell</button>${q > 1 ? `<button type="button" class="btn sm ghost" data-a="sell" data-i="${esc(s.item)}" data-n="${q}">All</button>` : ""}</div>`).join("")}</div>`;
  }

  private render() {
    const d = this.dlg;
    if (!d) return;
    const meta = CONTENT_NPCS.find((n) => n.key === d.npc);
    const body = this.tab === "craft" ? this.craftTab(d) : this.tab === "buy" ? this.buyTab(d) : this.tab === "sell" ? this.sellTab(d) : (d.quests.length ? d.quests.map((q) => this.quest(q)).join("") : `<div class="cxnone">Nothing to ask of you right now. Come back when you have grown stronger.</div>`);
    const tabs: Array<[string, string]> = [["tasks", `Tasks${d.quests.some((q) => q.st === "offer" || q.st === "ready") ? " !" : ""}`]];
    if (d.craft) tabs.push(["craft", "Craft"]);
    if (d.buy) { tabs.push(["buy", "Buy"]); tabs.push(["sell", "Sell"]); }
    const w = this.st.wallet();
    const prev = this.el.querySelector(".cxbody")?.scrollTop ?? 0;
    this.el.innerHTML = `<div class="rodt"></div>
      <div class="cxdh"><div class="dseal">${icon(meta?.seal ?? "lotus")}</div><div class="dtt"><div class="dzh">${esc(plain(d.name))}</div><div class="den">${esc(plain(d.role))}</div></div><div class="cxw"><span>${icon("coin")}${w.coin}</span><span>${icon("jadeDisc")}${w.jade}</span></div></div>
      <p class="cxsay">${esc(plain(d.lines[0] ?? ""))}</p>
      <div class="cxtabs">${tabs.map(([t, l]) => `<button type="button" class="cxtab${this.tab === t ? " on" : ""}" data-a="tab" data-t="${t}">${l}</button>`).join("")}<span class="cxsp"></span><button type="button" class="btn sm ghost" data-a="close">Close</button></div>
      <div class="cxbody">${body}</div><div class="rodb"></div>`;
    (this.el.querySelector(".cxbody") as HTMLElement).scrollTop = prev;
  }
}
