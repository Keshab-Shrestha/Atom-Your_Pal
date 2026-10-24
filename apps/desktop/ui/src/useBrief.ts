// The chat brief editor's conversation with the runtime: load the saved brief, save a new one, ask again about a save that was not
// confirmed. A save carries the version it was made from, so it cannot overwrite a newer brief (the runtime checks again).

import { useCallback } from "preact/hooks";
import type { Dispatch } from "preact/hooks";
import { newUuid } from "./ids.ts";
import type { IslandCommand } from "./protocol.ts";
import { validBrief } from "./brief.ts";
import type { Action, AppState } from "./store.ts";

const PATIENCE_MS = 10_000;

export interface BriefApi {
  open: (chatId: string) => void;
  /** Replaces the editor's draft with the saved brief (asks the runtime again, so a brief saved elsewhere shows). */
  reload: () => void;
  save: (text: string) => void;
  /** Sends an unconfirmed save again, under its original request id. */
  check: () => void;
  close: () => void;
}

export function useBrief(options: { state: AppState; dispatch: Dispatch<Action>; send: (command: IslandCommand) => Promise<boolean> }): BriefApi {
  const { state, dispatch, send } = options;
  const brief = state.brief;

  const go = useCallback(
    (request: string, command: IslandCommand) => {
      void send(command).then((ok) => ok || dispatch({ kind: "briefTimeout", request }));
      setTimeout(() => dispatch({ kind: "briefTimeout", request }), PATIENCE_MS);
    },
    [send, dispatch],
  );

  const open = useCallback(
    (chatId: string) => {
      const request = newUuid();
      dispatch({ kind: "briefOpen", chatId, request });
      go(request, { type: "chat.control", action: "inspect", id: chatId, request });
    },
    [dispatch, go],
  );
  const reload = useCallback(() => {
    if (!brief || brief.doing) return;
    const request = newUuid();
    dispatch({ kind: "briefReload", request });
    go(request, { type: "chat.control", action: "inspect", id: brief.chatId, request });
  }, [brief, dispatch, go]);
  const save = useCallback(
    (text: string) => {
      if (!brief?.saved || brief.doing || !validBrief(text)) return;
      const request = newUuid();
      dispatch({ kind: "briefSave", request, text, version: brief.saved.version });
      go(request, { type: "chat.control", action: "brief", id: brief.chatId, request, version: brief.saved.version, text });
    },
    [brief, dispatch, go],
  );
  const check = useCallback(() => {
    const again = brief?.unconfirmed;
    if (!brief || !again || brief.doing) return;
    dispatch({ kind: "briefSave", request: again.request, text: again.text, version: again.version });
    go(again.request, { type: "chat.control", action: "brief", id: brief.chatId, request: again.request, version: again.version, text: again.text });
  }, [brief, dispatch, go]);
  const close = useCallback(() => dispatch({ kind: "briefClose" }), [dispatch]);
  return { open, reload, save, check, close };
}
