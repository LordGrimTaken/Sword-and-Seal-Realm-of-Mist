import type { ClientMsg, ServerMsg } from "@shared/protocol";

export type CloseInfo = { reason: string; wasOpen: boolean; code: number };

/** Thin WebSocket wrapper: JSON frames, ping/pong latency, safe error reporting. */
export class NetClient {
  private ws: WebSocket | null = null;
  private pingTimer: number | null = null;
  open = false;
  /** Smoothed round-trip time in ms. */
  latency = 0;
  onMsg: (m: ServerMsg) => void = () => {};
  onClose: (info: CloseInfo) => void = () => {};

  connect(url: string, timeoutMs = 7000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch {
        reject(new Error(`Invalid server address "${url}".`));
        return;
      }
      this.ws = ws;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        try { ws.close(); } catch { /* ignore */ }
        reject(new Error(`Connection to ${url} timed out.`));
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.open = true;
        this.startPing();
        resolve();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== "string") return;
        let m: ServerMsg;
        try { m = JSON.parse(ev.data) as ServerMsg; } catch { return; }
        if (m.t === "pong") {
          const rtt = performance.now() - m.c;
          this.latency = this.latency === 0 ? rtt : this.latency * 0.7 + rtt * 0.3;
          return;
        }
        try { this.onMsg(m); } catch (e) { console.error("message handler failed", e); }
      };
      ws.onerror = () => { /* followed by onclose; reported there */ };
      ws.onclose = (ev) => {
        const wasOpen = this.open;
        console.info(`[net] socket closed: code=${ev.code} reason=${JSON.stringify(ev.reason || "")} clean=${ev.wasClean} wasOpen=${wasOpen} url=${url}`);
        this.open = false;
        this.stopPing();
        window.clearTimeout(timer);
        const reason = ev.reason || (wasOpen ? "The connection to the server was lost." : `Could not reach the server at ${url}. Is it running?`);
        if (!settled) { settled = true; reject(new Error(reason)); }
        else if (this.ws === ws) this.onClose({ reason, wasOpen, code: ev.code });
      };
    });
  }

  send(m: ClientMsg): void {
    if (this.ws && this.open && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(m)); } catch { /* socket closing */ }
    }
  }

  close(): void {
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    this.open = false;
    if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close(); } catch { /* ignore */ } }
  }

  private startPing() {
    const ping = () => this.send({ t: "ping", c: performance.now() });
    ping();
    this.pingTimer = window.setInterval(ping, 2000);
  }
  private stopPing() {
    if (this.pingTimer !== null) { window.clearInterval(this.pingTimer); this.pingTimer = null; }
  }
}
