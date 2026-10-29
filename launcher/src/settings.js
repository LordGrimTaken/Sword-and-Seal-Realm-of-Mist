// Per-user launcher settings (never contains passwords or tokens).
import fs from "node:fs";
import path from "node:path";

export class Settings {
  constructor(file, defaults) {
    this.file = file; this.defaults = defaults;
    this.data = { ...defaults };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8"))); } catch { /* defaults */ }
  }
  get() { return { ...this.data }; }
  set(patch) {
    const allowed = ["installDir", "serverUrl", "closeOnPlay", "remember", "lastName", "defenderAsked"];
    for (const k of allowed) if (k in patch) this.data[k] = patch[k];
    if (typeof this.data.installDir !== "string" || !this.data.installDir) this.data.installDir = this.defaults.installDir;
    this.data.serverUrl = String(this.data.serverUrl || "").trim();
    this.data.closeOnPlay = !!this.data.closeOnPlay; this.data.remember = !!this.data.remember;
    if (!this.data.remember) this.data.lastName = "";
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
}
