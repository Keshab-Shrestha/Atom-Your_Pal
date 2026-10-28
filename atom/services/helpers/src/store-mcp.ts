// The MCP servers part of the helper store: add, remove, change, and the result of a test (split out of store.ts, 2026-10-16).

import { HelperError } from "./jobs.ts";
import type { StoreContext } from "./store-context.ts";
import type { HelperStore } from "./store-types.ts";

export function mcpMethods(ctx: StoreContext): Pick<HelperStore, "mcpServers" | "addMcpServer" | "removeMcpServer" | "setMcpServer" | "recordMcpTest"> {
  const { now, emit, mcp, roster } = ctx;
  return {
    mcpServers: () => mcp.list(),

    addMcpServer(input) {
      const id = mcp.add(input);
      emit({ action: "mcp", server: id, change: "added" });
      return mcp.get(id)!;
    },

    removeMcpServer(id) {
      if (!mcp.remove(id)) return false;
      emit({ action: "mcp", server: id, change: "removed" });
      return true;
    },

    setMcpServer(id, change) {
      const server = mcp.get(id);
      if (!server) throw new HelperError("There is no such server.");
      const team = roster().map((m) => m.id);
      const workers = change.workers ? [...new Set(change.workers)] : server.workers;
      const unknown = workers.find((w) => !team.includes(w));
      if (unknown !== undefined) throw new HelperError(`There is no worker called "${unknown.slice(0, 40)}".`);
      const enabled = change.enabled ?? server.enabled;
      if (enabled && !server.enabled && (!server.testedAt || server.problem)) throw new HelperError("Test the server first: it turns on once a test lists its tools.");
      mcp.flags(id, enabled, change.trusted ?? server.trusted, workers);
      emit({ action: "mcp", server: id, change: "set" });
    },

    recordMcpTest(id, outcome) {
      if (!mcp.get(id)) return;
      if ("tools" in outcome) mcp.tested(id, outcome.tools.slice(0, 200), now(), null);
      else mcp.tested(id, [], now(), outcome.problem.slice(0, 300));
      emit({ action: "mcp", server: id, change: "tested" });
    },
  };
}
