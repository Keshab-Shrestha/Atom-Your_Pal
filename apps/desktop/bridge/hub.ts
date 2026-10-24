// Fans the runtime's events out to the connected windows as Server-Sent Events. The page gets two kinds of frame:
//   data: {"type":"…",…}        a runtime event, verbatim
//   event: status / data: {…}   the supervisor's state (running, restarting, configError, failed, stopped)
// A window that connects late (or reloads) is given the current status, the runtime's last `ready` (sent only once per run), its last
// `state`, and a still-open `approval.request`, so it knows a turn is running and a question is waiting. The request is the original live
// one: the runtime still enforces its own timeout and the id check.

import type { ServerResponse } from "node:http";
import type { RuntimeEvent, SupervisorStatus } from "./supervisor.ts";

/** A window that falls this far behind is dropped; it reconnects and asks again. */
const MAX_BACKLOG_BYTES = 8 * 1024 * 1024;

export interface Hub {
  event(event: RuntimeEvent): void;
  status(status: SupervisorStatus): void;
  /** Starts an SSE response. Resolves nothing: the response stays open until the window leaves. */
  attach(res: ServerResponse): void;
  clients(): number;
  closeAll(): void;
}

export function createHub(options: { keepAliveMs?: number } = {}): Hub {
  const clients = new Set<ServerResponse>();
  let lastReady: RuntimeEvent | undefined;
  let lastState: RuntimeEvent | undefined;
  let openApproval: RuntimeEvent | undefined;
  let lastStatus: SupervisorStatus = { state: "stopped" };

  const frame = (event: RuntimeEvent) => `data: ${JSON.stringify(event)}\n\n`;
  const statusFrame = (status: SupervisorStatus) => `event: status\ndata: ${JSON.stringify(status)}\n\n`;

  function write(res: ServerResponse, text: string) {
    if (res.writableLength > MAX_BACKLOG_BYTES) {
      res.destroy();
      clients.delete(res);
      return;
    }
    res.write(text);
  }

  const keepAlive = setInterval(() => {
    for (const res of clients) write(res, ": keep-alive\n\n");
  }, options.keepAliveMs ?? 15_000);
  keepAlive.unref();

  return {
    event(event) {
      if (event.type === "ready") lastReady = event;
      else if (event.type === "state") {
        lastState = event;
        if (event.state === "idle") openApproval = undefined; // the turn is over
      } else if (event.type === "approval.request") openApproval = event;
      else if (event.type === "approval.closed" && openApproval?.id === event.id) openApproval = undefined;
      else if (event.type === "conversation.reset") openApproval = undefined;
      const text = frame(event);
      for (const res of clients) write(res, text);
    },
    status(status) {
      lastStatus = status;
      // A new run sends its own `ready`; the old one no longer describes anything.
      if (status.state !== "running") {
        lastReady = undefined;
        lastState = undefined;
        openApproval = undefined;
      }
      const text = statusFrame(status);
      for (const res of clients) write(res, text);
    },
    attach(res) {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      clients.add(res);
      res.on("close", () => clients.delete(res));
      write(res, statusFrame(lastStatus));
      if (lastReady) write(res, frame(lastReady));
      if (lastState) write(res, frame(lastState));
      if (openApproval) write(res, frame(openApproval));
    },
    clients: () => clients.size,
    closeAll() {
      clearInterval(keepAlive);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
