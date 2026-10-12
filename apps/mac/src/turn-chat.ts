import { AsyncLocalStorage } from "node:async_hooks";
import type { Core } from "@zeno/core";

// ADR-098: which chat a turn belongs to. ATOM's tools run through one shared runner (the Claude plan holds it), so a
// tool cannot be given a Core. It reads the chat of the turn it runs in. Two turns at once keep two values.

/** The chat id of the turn that runs now (the Core's session id). Undefined outside a turn. */
export const turnChat = new AsyncLocalStorage<string>();

/** The same Core, but each `handle` runs inside its own chat id. */
export function withTurnChat(core: Core, store: AsyncLocalStorage<string> = turnChat): Core {
  return {
    get sessionId() {
      return core.sessionId;
    },
    handle: (input, signal, hooks) => store.run(core.sessionId, () => core.handle(input, signal, hooks)),
    history: () => core.history(),
    reset: () => core.reset(),
    resume: (id, turns) => core.resume(id, turns),
    prepare: () => core.prepare(),
  };
}
