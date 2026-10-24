// The window's one connection to ATOM: a stream of events in, commands out, through the bridge (apps/desktop/bridge/server.ts).
// A native shell can later offer the same `Transport` over its own channel without the screens changing.

import { parseFrames } from "./sse.ts";
import type { IslandCommand, IslandEvent, RuntimeStatus } from "./protocol.ts";
import type { Link } from "./store.ts";
import type { SavedInput } from "./input.ts";

export type SendResult = { ok: true } | { ok: false; message: string };

export interface TransportHandlers {
  onEvent(event: IslandEvent): void;
  onStatus(status: RuntimeStatus): void;
  onLink(link: Link): void;
}

export type UploadResult = { ok: true; path: string } | { ok: false; message: string };

export interface Transport {
  start(handlers: TransportHandlers): void;
  stop(): void;
  send(command: IslandCommand): Promise<SendResult>;
  /** Hands a file to the bridge, which stages it and returns the full path that `text.send` needs. */
  upload(file: File): Promise<UploadResult>;
  /** The unsent drafts and held messages saved by the bridge. Never rejects: a failure reads as nothing saved, with a note. */
  loadInput(): Promise<{ saved: SavedInput | undefined; note?: string }>;
  /** Saves them. `keepalive` lets the request finish while the page is closing. */
  saveInput(saved: SavedInput, options?: { keepalive?: boolean }): Promise<boolean>;
}

const RETRY_MS = [1000, 2000, 4000, 5000];

export function createBridgeTransport(token: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Transport {
  const headers = { authorization: `Bearer ${token}` };
  let abort: AbortController | undefined;
  let stopped = false;

  async function run(handlers: TransportHandlers) {
    for (let attempt = 0; !stopped; attempt++) {
      abort = new AbortController();
      handlers.onLink("connecting");
      try {
        const res = await fetchImpl("/events", { headers, signal: abort.signal, cache: "no-store" });
        if (res.status === 401) return handlers.onLink("unauthorized");
        if (!res.ok || !res.body) throw new Error(`events: ${res.status}`);
        handlers.onLink("live");
        attempt = 0;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            try {
              const parsed = JSON.parse(frame.data);
              if (frame.event === "status") handlers.onStatus(parsed as RuntimeStatus);
              else handlers.onEvent(parsed as IslandEvent);
            } catch {
              // One bad frame must not end the stream.
            }
          }
        }
      } catch {
        if (stopped) return;
      }
      if (stopped) return;
      handlers.onLink("down");
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]));
    }
  }

  return {
    start(handlers) {
      stopped = false;
      void run(handlers);
    },
    stop() {
      stopped = true;
      abort?.abort();
    },
    async upload(file) {
      try {
        const res = await fetchImpl(`/upload?name=${encodeURIComponent(file.name)}`, { method: "POST", headers, body: file });
        const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
        if (res.status === 201 && typeof body.path === "string") return { ok: true, path: body.path };
        return { ok: false, message: body.error ?? `${file.name} could not be handed to ATOM (${res.status}).` };
      } catch {
        return { ok: false, message: `${file.name} could not be handed to ATOM. It keeps trying to reconnect; try again in a moment.` };
      }
    },
    async loadInput() {
      try {
        const res = await fetchImpl("/input", { headers, cache: "no-store" });
        if (!res.ok) return { saved: undefined, note: "Saved drafts could not be read." };
        const body = (await res.json()) as { saved?: SavedInput; note?: string };
        return { saved: body.saved, ...(body.note ? { note: body.note } : {}) };
      } catch {
        return { saved: undefined, note: "Saved drafts could not be read." };
      }
    },
    async saveInput(saved, options) {
      try {
        const res = await fetchImpl("/input", { method: "PUT", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(saved), ...(options?.keepalive ? { keepalive: true } : {}) });
        return res.status === 204;
      } catch {
        return false;
      }
    },
    async send(command) {
      try {
        const res = await fetchImpl("/command", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(command) });
        if (res.status === 202) return { ok: true };
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false, message: body.error ?? `ATOM did not take that (${res.status}).` };
      } catch {
        return { ok: false, message: "The window cannot reach ATOM. It keeps trying to reconnect." };
      }
    },
  };
}

/** The token comes in the address's #fragment (never sent to a server), is kept for this tab only, and is removed from the address bar. */
export function readToken(win: Pick<Window, "location" | "history" | "sessionStorage">): string | undefined {
  const fromHash = /(?:^#|&)token=([0-9a-f]{64})(?:&|$)/.exec(win.location.hash)?.[1];
  if (fromHash) {
    try {
      win.sessionStorage.setItem("atom-token", fromHash);
    } catch {
      // storage blocked: the token still works until the page is reloaded
    }
    win.history.replaceState(null, "", win.location.pathname + win.location.search);
    return fromHash;
  }
  try {
    return win.sessionStorage.getItem("atom-token") ?? undefined;
  } catch {
    return undefined;
  }
}
