// "What's new" / patch notes window: a paper-scroll modal over the shipped release notes.
// The data is bundled at build time from client/src/data/releases.json (generated from CHANGELOG.md by
// scripts/make-releases.mjs), so this window never touches the network and works offline. main.ts decides when to
// auto-open it (once per bundled version) and wires the HUD version chip + the F1 help screen to open().
import { esc } from "./glyphs";

/** One bullet group inside a release (matches the generated releases.json shape). */
export interface ReleaseGroup {
  heading: string;
  bullets: string[];
}

/** One shipped release; releases.json is newest first. */
export interface Release {
  version: string;
  title: string;
  date?: string | null;
  intro?: string;
  anchor?: string;
  groups: ReleaseGroup[];
}

/** "current" = this build's notes; "all" = the full history with older versions collapsed. */
export type WhatsNewView = "current" | "all";

export interface WhatsNewDebug {
  open: boolean;
  view: WhatsNewView;
  version: string;
  releases: number;
}

const KNOWN_ISSUES = "Known issues: none reported for this build. Anything you hit can be reported on the support page.";

function groupsHtml(release: Release): string {
  return release.groups
    .map((g) => `<h4 class="wngh">${esc(g.heading)}</h4><ul>${g.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>`)
    .join("");
}

/**
 * Paper-scroll "What's new" window.
 * - open() shows the newest version's notes (title, grouped bullets, a muted known-issues line);
 * - "Read the full notes" switches to the whole history (older versions collapsed inside <details>);
 * - Escape, the Close button or a click on the dimmed backdrop closes it.
 * While closed the element is display:none / pointer-events:none and no key listener is installed, so it can never
 * block the game. It never fetches anything.
 */
export class WhatsNewPanel {
  readonly el: HTMLElement;
  private readonly current: Release;
  private readonly titleEl: HTMLElement;
  private readonly metaEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly fullBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private view: WhatsNewView = "current";
  private opened = false;

  constructor(root: HTMLElement, private readonly releases: readonly Release[]) {
    this.current = releases[0] ?? { version: "0.0.0", title: "", groups: [] };
    this.el = document.createElement("div");
    this.el.id = "whatsnew";
    this.el.setAttribute("role", "dialog");
    this.el.setAttribute("aria-modal", "true");
    this.el.setAttribute("aria-hidden", "true");
    this.el.setAttribute("aria-labelledby", "wn-title");
    this.el.innerHTML = `
      <div class="wnpanel panel">
        <div class="wnh"><span class="brush" id="wn-title">What's new in v${esc(this.current.version)}</span><small class="wnmeta"></small></div>
        <div class="wnbody" tabindex="0"></div>
        <div class="wnfoot">
          <button class="btn sm wnfull" type="button">Read the full notes</button>
          <button class="btn sm ghost wnclose" type="button">Close</button>
          <span class="wnhint">Esc closes &middot; reopen from the version chip or F1</span>
        </div>
      </div>`;
    root.appendChild(this.el);
    this.titleEl = this.el.querySelector("#wn-title") as HTMLElement;
    this.metaEl = this.el.querySelector(".wnmeta") as HTMLElement;
    this.bodyEl = this.el.querySelector(".wnbody") as HTMLElement;
    this.fullBtn = this.el.querySelector(".wnfull") as HTMLButtonElement;
    this.closeBtn = this.el.querySelector(".wnclose") as HTMLButtonElement;
    const c = this.current;
    this.metaEl.textContent = c.title + (c.date ? ` \u00b7 ${c.date}` : "");
    this.fullBtn.addEventListener("click", () => this.setView(this.view === "current" ? "all" : "current"));
    this.closeBtn.addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); }); // dimmed backdrop
  }

  get isOpen(): boolean { return this.opened; }

  /** Show the window. `view` defaults to this build's notes. */
  open(view: WhatsNewView = "current"): void {
    if (!this.opened) {
      this.opened = true;
      this.el.classList.add("show");
      this.el.setAttribute("aria-hidden", "false");
      window.addEventListener("keydown", this.onKey, true);
    }
    this.setView(view);
    this.closeBtn.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.el.classList.remove("show");
    this.el.setAttribute("aria-hidden", "true");
    window.removeEventListener("keydown", this.onKey, true);
    this.closeBtn.blur();
  }

  toggle(view: WhatsNewView = "current"): void {
    if (this.opened) this.close();
    else this.open(view);
  }

  destroy(): void {
    this.close();
    this.el.remove();
  }

  /** Read-only snapshot for the debug surface (window.__jz.whatsNew) and UI tests. */
  debug(): WhatsNewDebug {
    return { open: this.opened, view: this.view, version: this.current.version, releases: this.releases.length };
  }

  /** Escape is consumed while open, so the game's own Escape handling is never affected. */
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.code !== "Escape" || !this.opened) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  private setView(view: WhatsNewView): void {
    this.view = view;
    const c = this.current;
    this.bodyEl.dataset.view = view;
    this.bodyEl.scrollTop = 0;
    this.titleEl.textContent = `What's new in v${c.version}`;
    if (view === "current") {
      this.fullBtn.textContent = "Read the full notes";
      this.bodyEl.innerHTML = (c.intro ? `<p class="wnintro">${esc(c.intro)}</p>` : "") + groupsHtml(c) + `<p class="wnknown">${esc(KNOWN_ISSUES)}</p>`;
    } else {
      this.fullBtn.textContent = `Back to v${c.version}`;
      this.bodyEl.innerHTML = this.releases
        .map((r, i) => `<details class="wnrel"${i === 0 ? " open" : ""}><summary><b>v${esc(r.version)}</b> <span>${esc(r.title)}</span>${r.date ? `<small>${esc(r.date)}</small>` : ""}</summary>${groupsHtml(r)}</details>`)
        .join("") + `<p class="wnknown">${esc(KNOWN_ISSUES)}</p>`;
    }
  }
}
