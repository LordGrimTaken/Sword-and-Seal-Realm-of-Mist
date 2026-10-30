// 0.5.0 player trading panel: a paper card with the two sides of the deal (what you give / what you get), coin offers,
// a Ready toggle and Cancel, plus a compact request card with Accept/Decline while a trade request is addressed to you.
// The state is server-authored: `{t:"trade", state}` arrives on every change (and once after login) and this panel merely
// renders it. Items are offered by clicking a bag chip; nothing leaves the bag until both sides confirm, which the server
// enforces — the panel is just a view. Buttons/inputs are the only interactive parts (the HUD root is pointer-events:none).
import type { InvItem, ServerMsg } from "@shared/protocol";
import { esc, plain } from "./glyphs";

type TradeMsg = Extract<ServerMsg, { t: "trade" }>;
type TradeState = NonNullable<TradeMsg["state"]>;

export interface TradePanelCallbacks {
  /** accept / decline / offer / ready / cancel: forwarded to the server `{t:"trade"}` message; the server is authoritative. */
  send(a: "accept" | "decline" | "offer" | "ready" | "cancel", extra?: { name?: string; slot?: number; qty?: number; coin?: number }): void;
  /** short HUD toast for request/start/completion transitions (the chat log also carries the server's system lines). */
  toast(msg: string): void;
  /** the player's current bag (same order as the server's slot references). */
  bag(): readonly InvItem[];
}

export class TradePanel {
  readonly el: HTMLElement;
  readonly inviteEl: HTMLElement;
  private state: TradeState | null = null;
  private invitedBy: string | null = null;
  private lastHtml = "";
  private lastInvite = "";

  constructor(root: HTMLElement, private cb: TradePanelCallbacks) {
    this.el = document.createElement("div");
    this.el.id = "trade";
    this.el.className = "panel";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-label", "Trade");
    this.el.addEventListener("click", (e) => this.onClick(e, this.el));
    this.el.addEventListener("change", (e) => this.onChange(e));

    this.inviteEl = document.createElement("div");
    this.inviteEl.id = "tradeinv";
    this.inviteEl.className = "panel";
    this.inviteEl.setAttribute("role", "alertdialog");
    this.inviteEl.setAttribute("aria-label", "Trade request");
    this.inviteEl.addEventListener("click", (e) => this.onClick(e, this.inviteEl));

    root.appendChild(this.el);
    root.appendChild(this.inviteEl);
    this.render();
  }

  /** True while the full trade card (a live session) is showing. */
  get isOpen(): boolean { return this.state !== null; }

  /** Fresh server state (login sync + every change). Toasts only for live transitions, never for the login sync. */
  set(m: TradeMsg) {
    const next = m.state ?? null;
    const invitedBy = typeof m.invitedBy === "string" && m.invitedBy ? m.invitedBy : null;
    if (invitedBy && invitedBy !== this.invitedBy) this.cb.toast(`${invitedBy} wants to trade — accept or decline.`);
    if (next && !this.state) this.cb.toast(`Trading with ${next.peer}.`);
    if (!next && this.state) this.cb.toast("Trade closed.");
    this.state = next;
    this.invitedBy = invitedBy;
    this.render();
  }

  /** Drop all state silently (reconnect / logout); the next login sync repopulates it. */
  clear() {
    this.state = null; this.invitedBy = null;
    this.render();
  }

  dispose() { this.el.remove(); this.inviteEl.remove(); }

  private onClick(e: Event, holder: HTMLElement) {
    const target = e.target as HTMLElement;
    const action = (target.closest("[data-a]") as HTMLElement | null)?.dataset.a;
    if (action === "accept" || action === "decline" || action === "ready" || action === "cancel") {
      this.cb.send(action);
      (target.closest("button") as HTMLElement | null)?.blur();
      return;
    }
    const rm = (target.closest("[data-rm]") as HTMLElement | null)?.dataset.rm;
    if (rm) { this.cb.send("offer", { name: rm, qty: 0 }); return; }
    const offer = (target.closest("[data-offer]") as HTMLElement | null)?.dataset.offer;
    if (offer !== undefined) {
      const slot = Number(offer);
      if (Number.isInteger(slot) && slot >= 0) this.cb.send("offer", { slot });
      return;
    }
    void holder;
  }

  private onChange(e: Event) {
    const input = (e.target as HTMLElement | null) as HTMLInputElement | null;
    if (!input || !input.dataset.coin) return;
    const coin = Math.max(0, Math.floor(Number(input.value) || 0));
    input.value = String(coin);
    this.cb.send("offer", { coin });
  }

  private rows(items: ReadonlyArray<{ name: string; qty: number }>, removable: boolean): string {
    if (!items.length) return `<div class="tdempty">nothing yet</div>`;
    return items.map((it) => `<div class="tdrow"><b title="${esc(plain(it.name))}">${esc(plain(it.name))}</b><i>&times;${it.qty}</i>${removable ? `<button type="button" class="tdx" data-rm="${esc(plain(it.name))}" title="Remove this offer">&times;</button>` : ""}</div>`).join("");
  }

  private render() {
    const s = this.state;
    this.el.classList.toggle("show", !!s);
    this.inviteEl.classList.toggle("show", !s && !!this.invitedBy);
    if (s) {
      const bag = this.cb.bag();
      const offered = new Set(s.mine.items.map((i) => i.name));
      const chips = bag.filter((i) => i.qty > 0 && !offered.has(i.item)).map((i) => {
        const slot = bag.indexOf(i);
        return `<button type="button" class="tdchip" data-offer="${slot}" title="Offer ${esc(plain(i.item))} &times;${i.qty}">${esc(plain(i.item))} <i>&times;${i.qty}</i></button>`;
      }).join("");
      const html = `<div class="tdh"><span class="brush">Trade</span><small>with ${esc(plain(s.peer))}</small><button type="button" class="tdcancel" data-a="cancel">Cancel</button></div>
        <div class="tdcols">
          <div class="tdcol"><div class="tdch">You give</div>${this.rows(s.mine.items, true)}
            <label class="tdcoin">Coin <input type="number" min="0" step="1" value="${s.mine.coin}" data-coin="1" aria-label="Coin to offer"></label>
          </div>
          <div class="tdcol"><div class="tdch">You get${s.theirs.ready ? " &middot; ready" : ""}</div>${this.rows(s.theirs.items, false)}
            <div class="tdline">Coin <b>${s.theirs.coin}</b></div>
          </div>
        </div>
        <div class="tdbag"><div class="tdch">Your bag &middot; click a stack to offer it</div><div class="tdchips">${chips || `<span class="tdempty">nothing left to offer</span>`}</div></div>
        <div class="tdfoot"><button type="button" class="tdready${s.mine.ready ? " on" : ""}" data-a="ready">${s.mine.ready ? "Ready &#10003;" : "Ready"}</button><span class="tdhint">${s.theirs.ready ? `${esc(plain(s.peer))} is ready` : "Both ready = swap"} &middot; changing an offer clears ready</span></div>`;
      if (html !== this.lastHtml) { this.el.innerHTML = html; this.lastHtml = html; }
    } else if (this.lastHtml !== "") { this.el.innerHTML = ""; this.lastHtml = ""; }
    if (!s && this.invitedBy) {
      const inv = `<div class="tdh"><span class="brush">Trade</span><small>${esc(plain(this.invitedBy))} asks</small></div>
        <div class="tdinvbtn"><button type="button" data-a="accept">Accept</button><button type="button" data-a="decline">Decline</button></div>
        <div class="tdhint">/trade accept &middot; /trade decline</div>`;
      if (inv !== this.lastInvite) { this.inviteEl.innerHTML = inv; this.lastInvite = inv; }
    } else if (this.lastInvite !== "") { this.inviteEl.innerHTML = ""; this.lastInvite = ""; }
  }
}
