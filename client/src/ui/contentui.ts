import type { AchView, ClientMsg, GearStats, InvItem, ItemInfo, ServerMsg } from "@shared/protocol";
import "./content.css";
import { GearPanel, type ContentStore } from "./gear";
import { Journal } from "./journal";
import { NpcPanel, contentNpcKey, type NpcStore } from "./npcpanel";
import { esc, plain } from "./glyphs";

export interface ContentHost {
  send(m: ClientMsg): void;
  inv(): readonly InvItem[];
  level(): number;
  cls(): import("@shared/protocol").ClassId;
  wallet(): { coin: number; jade: number };
  /** Chat line for system messages. */
  say(text: string): void;
  playerDist(entityId: number): number;
}

const TOAST_LABEL: Record<string, string> = { poi: "Place discovered", ach: "Merit seal", title: "New title", item: "Item", quest: "Task" };

/** Coordinator for the 0.4.0 content panels: holds server state (catalogue, gear, side quests, merit) and routes messages and keys. */
export class ContentUi implements NpcStore {
  items = new Map<string, ItemInfo>();
  gear: { slots: Record<string, string | null>; stats: GearStats } = { slots: {}, stats: { atk: 0, hp: 0, crit: 0, def: 0 } };
  readonly gearPanel: GearPanel;
  readonly journal: Journal;
  readonly npcPanel: NpcPanel;
  private toasts: HTMLElement;
  private lastInv = "";
  constructor(root: HTMLElement, private host: ContentHost) {
    this.gearPanel = new GearPanel(root, this);
    this.journal = new Journal(root, (m) => host.send(m));
    this.npcPanel = new NpcPanel(root, this, { onClose: () => {} });
    this.toasts = document.createElement("div");
    this.toasts.id = "cxtoasts";
    this.toasts.setAttribute("aria-live", "polite");
    root.appendChild(this.toasts);
  }
  send(m: ClientMsg) { this.host.send(m); }
  inv() { return this.host.inv(); }
  level() { return this.host.level(); }
  cls() { return this.host.cls(); }
  wallet() { return this.host.wallet(); }

  get anyOpen() { return this.gearPanel.isOpen || this.journal.isOpen || this.npcPanel.isOpen; }
  closeTop(): boolean {
    if (this.npcPanel.isOpen) { this.npcPanel.close(); return true; }
    if (this.gearPanel.isOpen) { this.gearPanel.toggle(false); return true; }
    if (this.journal.isOpen) { this.journal.toggle(false); return true; }
    return false;
  }
  /** Is this NPC one of ours? Returns its server key. */
  npcKey(name: string) { return contentNpcKey(name); }
  openNpc(entityId: number, key: string, name: string) { this.npcPanel.begin(entityId, key, plain(name)); }

  /** Per frame: close the dialog when the player walks away; refresh when the bag changed. */
  frame() {
    if (this.npcPanel.isOpen) {
      const d = this.host.playerDist(this.npcPanel.npc);
      if (d > 20) this.npcPanel.close();
    }
    const sig = JSON.stringify(this.host.inv());
    if (sig !== this.lastInv) {
      this.lastInv = sig;
      if (this.gearPanel.isOpen) this.gearPanel.render();
      this.npcPanel.refresh();
    }
  }
  /** Handle one server message. Returns true when it was ours. */
  onMsg(m: ServerMsg): boolean {
    switch (m.t) {
      case "items": this.items = new Map(m.items.map((i) => [i.name, i])); this.gearPanel.render(); return true;
      case "gear": this.gear = { slots: m.slots, stats: m.stats }; this.gearPanel.render(); return true;
      case "npcdlg": this.npcPanel.onDialog(m); return true;
      case "sq": this.journal.sq = m.quests; this.journal.update(); return true;
      case "prog": this.journal.prog = { ach: m.ach as AchView[], pts: m.pts, title: m.title, titles: m.titles, pois: m.pois }; this.journal.update(); return true;
      case "toast": this.toast(m.kind, m.title, m.text); return true;
      default: return false;
    }
  }
  toast(kind: string, title: string, text: string) {
    const el = document.createElement("div");
    el.className = `cxtoast ${kind}`;
    el.innerHTML = `<small>${esc(TOAST_LABEL[kind] ?? "Notice")}</small><b>${esc(plain(title))}</b><span>${esc(plain(text))}</span>`;
    this.toasts.appendChild(el);
    const life = (window as unknown as { __jzToastMs?: number }).__jzToastMs ?? 4200; // test hook: screenshots on slow software GL
    window.setTimeout(() => el.classList.add("out"), life);
    window.setTimeout(() => el.remove(), life + 800);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
  }
  reset() { this.gear = { slots: {}, stats: { atk: 0, hp: 0, crit: 0, def: 0 } }; this.journal.sq = []; this.npcPanel.close(); }
}
export type { ContentStore };
