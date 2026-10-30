// 0.5.0 party panel (key O): a compact paper card listing the party's members with class, level, live HP bars and
// the leader marker, plus the pending-invite prompt (accept/decline) and a leave button. The state is session-only
// and server-authored: it arrives as `{t:"party", ...}` on every change and once after login, and the panel hides
// itself while solo. Buttons are the only interactive parts (the HUD root is pointer-events:none).
import type { PartyMemberView, ServerMsg } from "@shared/protocol";
import { CLASS_INFO, esc, plain } from "./glyphs";

type PartyMsg = Extract<ServerMsg, { t: "party" }>;

export interface PartyPanelCallbacks {
  /** accept / decline / leave: the game forwards these to the server `{t:"party"}` message. */
  send(a: "accept" | "decline" | "leave"): void;
  /** short HUD toast for invite/join/leave transitions (the chat log also carries the server's system lines). */
  toast(msg: string): void;
}

const MAX_MEMBERS = 5;
/** Short class tag for the 240 px row (the full CLASS_INFO names are too wide next to the level). */
const CLASS_SHORT: Record<string, string> = { sword: "Sword", talisman: "Talisman", physician: "Physician", blade: "Blade" };

export class PartyPanel {
  readonly el: HTMLElement;
  private members: PartyMemberView[] | null = null;
  private leader = "";
  private inviteFrom: string | null = null;
  private hidden = false; // key O manual hide while a party / invite exists
  private wasInParty = false;
  private lastHtml = "";

  constructor(root: HTMLElement, private cb: PartyPanelCallbacks) {
    this.el = document.createElement("div");
    this.el.id = "party";
    this.el.className = "panel";
    this.el.setAttribute("role", "region");
    this.el.setAttribute("aria-label", "Party");
    this.el.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-a]") as HTMLElement | null;
      const a = btn?.dataset.a;
      if (a === "accept" || a === "decline" || a === "leave") { this.cb.send(a); btn?.blur(); }
    });
    root.appendChild(this.el);
    this.render();
  }

  /** True while the panel has something to show (a party or a pending invitation). */
  get hasContent(): boolean { return !!this.members?.length || !!this.inviteFrom; }

  /** O key: hide/show the panel. Returns true when it is visible afterwards; false when solo (nothing to show). */
  toggle(): boolean {
    if (!this.hasContent) return false;
    this.hidden = !this.hidden;
    this.render();
    return !this.hidden;
  }

  /** Fresh server state (login sync + every change). Toasts only for live transitions, never for the login sync. */
  set(m: PartyMsg) {
    const members = m.members && m.members.length ? m.members : null;
    this.leader = typeof m.leader === "string" ? m.leader : "";
    const inviteFrom = typeof m.inviteFrom === "string" && m.inviteFrom ? m.inviteFrom : null;
    if (inviteFrom && inviteFrom !== this.inviteFrom) { this.cb.toast(`${inviteFrom} invites you to a party (O to open).`); this.hidden = false; }
    if (members && !this.wasInParty) { this.cb.toast(`You joined a party (${members.length}/${MAX_MEMBERS}).`); this.hidden = false; }
    else if (!members && this.wasInParty) { this.cb.toast("Your party has disbanded."); this.hidden = false; }
    this.members = members;
    this.inviteFrom = inviteFrom;
    this.wasInParty = !!members;
    this.render();
  }

  /** Drop all state silently (reconnect / logout); the next login sync repopulates it. */
  clear() {
    this.members = null; this.inviteFrom = null; this.leader = ""; this.wasInParty = false; this.hidden = false;
    this.render();
  }

  /** Remove the element (the HUD teardown also clears its root; this keeps the click handler from outliving the Game). */
  dispose() { this.el.remove(); }

  private render() {
    const show = this.hasContent && !this.hidden;
    this.el.classList.toggle("show", show);
    if (!show) { if (this.lastHtml !== "") { this.el.innerHTML = ""; this.lastHtml = ""; } return; }
    const rows: string[] = [];
    for (const m of this.members ?? []) {
      const lead = m.name === this.leader;
      const frac = Math.max(0, Math.min(1, m.mhp > 0 ? m.hp / m.mhp : 0));
      const cls = CLASS_SHORT[m.cls] ?? CLASS_INFO[m.cls]?.en ?? m.cls;
      rows.push(`<div class="pym${lead ? " lead" : ""}" title="${esc(plain(CLASS_INFO[m.cls]?.en ?? m.cls))}">
        <div class="pyr"><span class="pylead">${lead ? "\u25c6" : ""}</span><b class="pyname">${esc(plain(m.name))}</b><i class="pycls">${esc(cls)}</i><span class="pylv">Lv ${m.lv}</span></div>
        <div class="pybar"><i style="transform:scaleX(${frac.toFixed(3)})"></i></div>
      </div>`);
    }
    const invite = this.inviteFrom
      ? `<div class="pyinv"><b>${esc(plain(this.inviteFrom))}</b> invites you to a party.
          <div class="pybtns"><button type="button" data-a="accept">Accept</button><button type="button" data-a="decline">Decline</button></div></div>`
      : "";
    const head = this.members
      ? `<div class="pyh"><span class="brush">Party</span><small>${this.members.length}/${MAX_MEMBERS}</small><button type="button" class="pyleave" data-a="leave" title="Leave the party">Leave</button></div>`
      : `<div class="pyh"><span class="brush">Party</span><small>invite</small></div>`;
    const foot = this.members ? `<div class="pyfoot">/invite Name &middot; O hide</div>` : `<div class="pyfoot">/accept or /decline</div>`;
    const html = head + rows.join("") + invite + foot;
    if (html !== this.lastHtml) { this.el.innerHTML = html; this.lastHtml = html; }
  }
}
