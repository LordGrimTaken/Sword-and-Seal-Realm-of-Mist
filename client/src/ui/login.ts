import type { ClassId } from "@shared/protocol";
import { CLASS_INFO, esc } from "./glyphs";
import { icon, CLASS_CREST } from "./icons";

export interface LoginValues { name: string; cls: ClassId; server: string; pw: string }
export interface LauncherLogin { name: string; server: string; pickClass: boolean }

const MOUNTAINS = `
<svg class="mount" viewBox="0 0 1200 700" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <path d="M0 470 L120 380 L210 440 L330 330 L450 430 L560 360 L700 450 L820 340 L950 430 L1080 370 L1200 440 V700 H0Z" fill="#a9b9bf" opacity=".55"/>
  <path d="M0 520 L90 450 L200 510 L330 420 L470 520 L600 440 L760 540 L900 450 L1050 520 L1200 460 V700 H0Z" fill="#8fa3ad" opacity=".7"/>
  <path d="M0 590 L140 520 L260 580 L420 500 L560 590 L720 520 L880 600 L1040 530 L1200 590 V700 H0Z" fill="#6e8591" opacity=".85"/>
  <path d="M0 650 L180 600 L340 650 L520 590 L700 655 L900 600 L1060 650 L1200 615 V700 H0Z" fill="#3a3a44" opacity=".9"/>
  <ellipse cx="300" cy="470" rx="260" ry="22" fill="#e4e6dc" opacity=".55"/>
  <ellipse cx="900" cy="540" rx="300" ry="26" fill="#e4e6dc" opacity=".5"/>
</svg>`;

export class LoginScreen {
  private root = document.getElementById("login")!;
  private cls: ClassId = "sword";
  private errEl!: HTMLElement;
  private btn!: HTMLButtonElement;
  private nameIn!: HTMLInputElement;
  private serverIn!: HTMLInputElement;
  private pwIn!: HTMLInputElement;
  private launcher: LauncherLogin | null = null;
  private dead = false;

  constructor(private onEnter: (v: LoginValues) => void, init: { name: string; cls: ClassId; server: string; pw?: string }) {
    this.cls = init.cls;
    const classes = (Object.keys(CLASS_INFO) as ClassId[])
      .map((id) => {
        const c = CLASS_INFO[id];
        return `<button type="button" class="cc" data-cls="${id}"><div class="g">${icon(CLASS_CREST[id])}</div><div class="e">${esc(c.en)}</div><div class="d">${esc(c.desc)}</div></button>`;
      })
      .join("");
    this.root.innerHTML = `
      ${MOUNTAINS}
      <div class="scroll">
        <div class="rod"></div>
        <div class="sheet">
          <div class="logo"><div class="seal" aria-hidden="true">${icon("lotus")}</div><div class="en">Sword &amp; Seal</div></div>
          <div class="sub">Realm of Mist</div>
          <div class="rule"></div>
          <label class="f" for="jz-name">Character name</label>
          <input class="tx" id="jz-name" maxlength="16" autocomplete="off" spellcheck="false" />
          <div id="jz-pwgroup">
          <label class="f" for="jz-pw">Password</label>
          <div class="pwrow">
            <input class="tx" id="jz-pw" type="password" minlength="4" maxlength="64" autocomplete="current-password" spellcheck="false" aria-describedby="jz-pwhelp" />
            <button type="button" class="pwtoggle" id="jz-pwtoggle" aria-label="Show password" aria-pressed="false">Show</button>
          </div>
          <div class="pwhelp" id="jz-pwhelp">New name? This password creates your character. Existing name? Enter its password.</div>
          </div>
          <div id="jz-classgroup">
          <label class="f">Path of cultivation</label>
          <div class="classes">${classes}</div>
          </div>
          <div id="jz-servergroup">
          <label class="f" for="jz-server">Server</label>
          <input class="tx" id="jz-server" autocomplete="off" spellcheck="false" />
          </div>
          <div class="go"><button class="btn" id="jz-go" type="button">Enter the World</button></div>
          <div class="err" id="jz-err" role="alert" aria-live="polite"></div>
        </div>
        <div class="rod"></div>
      </div>`;
    this.errEl = this.root.querySelector("#jz-err")!;
    this.btn = this.root.querySelector("#jz-go")!;
    this.nameIn = this.root.querySelector("#jz-name")!;
    this.serverIn = this.root.querySelector("#jz-server")!;
    this.pwIn = this.root.querySelector("#jz-pw")!;
    this.pwIn.value = init.pw ?? "";
    const tog = this.root.querySelector<HTMLButtonElement>("#jz-pwtoggle")!;
    tog.addEventListener("click", () => {
      const show = this.pwIn.type === "password";
      this.pwIn.type = show ? "text" : "password";
      tog.textContent = show ? "Hide" : "Show";
      tog.setAttribute("aria-label", show ? "Hide password" : "Show password");
      tog.setAttribute("aria-pressed", String(show));
    });
    this.pwIn.addEventListener("input", () => this.pwIn.classList.remove("bad"));
    this.nameIn.value = init.name;
    this.serverIn.value = init.server;
    this.root.querySelectorAll<HTMLElement>(".cc").forEach((b) =>
      b.addEventListener("click", () => this.select(b.dataset.cls as ClassId)),
    );
    this.select(this.cls);
    this.btn.addEventListener("click", () => this.submit());
    this.root.addEventListener("keydown", (e) => { if (e.key === "Enter") this.submit(); });
  }

  private select(c: ClassId) {
    this.cls = c;
    this.root.querySelectorAll<HTMLElement>(".cc").forEach((b) => b.classList.toggle("sel", b.dataset.cls === c));
  }

  /** Launcher mode: the name is fixed, there is no password or server field and the login uses the launcher's one-use token. */
  setLauncher(l: LauncherLogin) {
    this.launcher = l;
    this.root.classList.add("launcher");
    this.nameIn.value = l.name;
    this.nameIn.readOnly = true;
    this.root.querySelector<HTMLElement>("#jz-pwgroup")!.style.display = "none";
    this.root.querySelector<HTMLElement>("#jz-servergroup")!.style.display = "none";
    this.root.querySelector<HTMLElement>("#jz-classgroup")!.style.display = l.pickClass ? "" : "none";
    this.btn.textContent = l.pickClass ? "Begin the Journey" : "Enter the World";
    this.btn.style.display = l.pickClass ? "" : "none";
    const lab = this.root.querySelector<HTMLElement>('label[for="jz-name"]')!;
    lab.textContent = "Signed in as";
  }

  /** Launcher mode, token rejected / used: there is nothing to retry from here (never a password prompt). */
  launcherDead(serverError: string) {
    this.dead = true;
    this.root.querySelector<HTMLElement>("#jz-classgroup")!.style.display = "none";
    this.btn.style.display = "none";
    this.errEl.className = "err";
    this.errEl.innerHTML = "";
    const a = document.createElement("div"); a.textContent = serverError;
    const b = document.createElement("div"); b.className = "fatal"; b.textContent = "Close and sign in again from the launcher.";
    this.errEl.append(a, b);
  }

  private submit() {
    if (this.btn.disabled || this.dead) return;
    if (this.launcher) { this.onEnter({ name: this.launcher.name, cls: this.cls, server: this.launcher.server, pw: "" }); return; }
    const name = this.nameIn.value.trim();
    if (name.length < 2) { this.error("Please choose a name of at least 2 characters."); this.nameIn.focus(); return; }
    const pw = this.pwIn.value;
    if (pw.length < 4 || pw.length > 64) { this.error("Password must be 4 to 64 characters."); this.pwIn.classList.add("bad"); this.pwIn.focus(); return; }
    let server = this.serverIn.value.trim();
    if (!server) { this.error("Enter a server address, e.g. ws://localhost:8787"); return; }
    if (!/^wss?:\/\//i.test(server)) server = "ws://" + server;
    this.serverIn.value = server;
    this.onEnter({ name, cls: this.cls, server, pw });
  }

  show() { this.root.classList.add("show"); if (!this.launcher) (this.nameIn.value ? this.pwIn : this.nameIn).focus(); }
  hide() { this.root.classList.remove("show"); }
  busy(on: boolean, msg = "") {
    this.btn.disabled = on;
    this.btn.innerHTML = on ? "Entering…" : this.launcher?.pickClass ? "Begin the Journey" : "Enter the World";
    if (on) this.info(msg || "Connecting to the server…");
  }
  error(msg: string) {
    this.errEl.className = "err"; this.errEl.textContent = msg;
    this.pwIn.classList.toggle("bad", /password|protected|attempts/i.test(msg));
  }
  info(msg: string) { this.errEl.className = "err info"; this.errEl.textContent = msg; }
}
