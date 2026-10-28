import { PROTOCOL_VERSION, type ClassId, type ServerMsg } from "@shared/protocol";
import { NetClient } from "./client";

export type Welcome = Extract<ServerMsg, { t: "welcome" }>;
export interface LoginArgs { server: string; name: string; cls: ClassId; pw?: string; tok?: string }

/** Open a socket and complete the login handshake. Rejects with a readable Error; the socket is closed on failure. */
export async function connectAndLogin(v: LoginArgs, onStage?: (msg: string) => void): Promise<{ net: NetClient; welcome: Welcome }> {
  const net = new NetClient();
  try {
    onStage?.(`Connecting to ${v.server}…`);
    await net.connect(v.server);
    onStage?.("Entering the Nine Provinces…");
    const welcome = await new Promise<Welcome>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("The server did not answer the login request.")), 8000);
      net.onClose = (i) => { window.clearTimeout(timer); reject(new Error(i.reason)); };
      net.onMsg = (m) => {
        if (m.t === "welcome") { window.clearTimeout(timer); resolve(m); }
        else if (m.t === "error") { window.clearTimeout(timer); reject(new Error(m.msg)); }
      };
      net.send({ t: "login", name: v.name, cls: v.cls, v: PROTOCOL_VERSION, ...(v.tok ? { tok: v.tok } : { pw: v.pw }) });
    });
    return { net, welcome };
  } catch (e) {
    net.close();
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export const RECONNECT_DELAYS_MS = [1000, 2000, 3000, 5000, 8000, 10000];

/**
 * Re-login with backoff after a drop. Calls onAttempt before every try (1-based) and resolves with a fresh
 * connection, or null when all attempts failed or `cancelled()` turned true.
 */
export async function reconnectWithBackoff(
  v: LoginArgs,
  hooks: { onAttempt(n: number, total: number, lastError: string): void; cancelled(): boolean },
): Promise<{ net: NetClient; welcome: Welcome } | null> {
  const total = RECONNECT_DELAYS_MS.length;
  let lastError = "";
  for (let i = 0; i < total; i++) {
    await new Promise((r) => window.setTimeout(r, RECONNECT_DELAYS_MS[i]));
    if (hooks.cancelled()) return null;
    hooks.onAttempt(i + 1, total, lastError);
    try {
      return await connectAndLogin(v);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.info(`[net] reconnect attempt ${i + 1}/${total} failed: ${lastError}`);
      if (hooks.cancelled()) return null;
    }
  }
  return null;
}
