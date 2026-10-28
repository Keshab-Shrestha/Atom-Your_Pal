import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { homedir } from "node:os";
import { isChatAccessMode, type ChatAccessMode } from "@atom/contracts";
import { redactSecrets } from "@atom/llm-gateway";
import type { Runtime } from "../mac/src/runtime.ts";
import type * as Acp from "../../../packages/effect-acp/src/_generated/schema-v1.gen.ts";
import type * as AcpCompat from "../../../packages/effect-acp/src/compat.ts";

type JsonObject = Record<string, unknown>;
type RpcId = string | number;
export interface Peer {
  send(value: object): void;
}
interface Session {
  id: string;
  cwd: string;
  reasoning: Record<string, string>;
}
interface Run {
  session: Session;
  peer: Peer;
  controller: AbortController;
  tools: Map<string, string>;
}
class Cancelled extends Error {}
const SESSION_ID = /^t3-[a-f0-9-]{36}$/;
const MODES = [
  {
    id: "checked",
    name: "Checked access",
    description: "ATOM checks permissions for each action.",
  },
  { id: "chat-only", name: "Chat only", description: "No tools or computer actions." },
  { id: "ask-changes", name: "Ask before changes", description: "Ask before changing files." },
  { id: "full", name: "Full access", description: "Requires a separate ATOM confirmation." },
];
const object = (value: unknown): JsonObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object.");
  return value as JsonObject;
};
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("Expected text.");
  return value;
};

export function createAcpService(runtime: Runtime, sessionFile: string) {
  const sessions = new Map<string, Session>();
  if (existsSync(sessionFile)) {
    const saved: unknown = JSON.parse(readFileSync(sessionFile, "utf8"));
    if (!Array.isArray(saved))
      throw new Error("ATOM session metadata is invalid. Restore it before starting the backend.");
    for (const value of saved) {
      const s = object(value);
      const id = string(s.id),
        cwd = string(s.cwd),
        reasoning = object(s.reasoning);
      if (
        !SESSION_ID.test(id) ||
        !isAbsolute(cwd) ||
        Object.values(reasoning).some((v) => typeof v !== "string")
      )
        throw new Error("ATOM session metadata is invalid.");
      sessions.set(id, { id, cwd, reasoning: reasoning as Record<string, string> });
    }
  }
  let queue: Promise<unknown> = Promise.resolve();
  let active: Run | undefined;
  const runs = new Map<string, Run>();
  const initialized = new WeakSet<Peer>();
  const permissionReplies = new Map<
    string,
    { peer: Peer; finish(allow: boolean, remember: boolean): void }
  >();
  const save = () => {
    mkdirSync(dirname(sessionFile), { recursive: true, mode: 0o700 });
    const temp = `${sessionFile}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify([...sessions.values()]), { mode: 0o600, flag: "wx" });
    renameSync(temp, sessionFile);
  };
  const update = (peer: Peer, session: Session, value: Acp.SessionUpdate) =>
    peer.send({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: session.id, update: value },
    });
  const chunk = (
    peer: Peer,
    session: Session,
    kind: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk",
    text: string,
    messageId?: string,
  ) => {
    if (text)
      update(peer, session, {
        sessionUpdate: kind,
        content: { type: "text", text },
        ...(messageId ? { messageId } : {}),
      });
  };
  const chats = () => {
    if (!runtime.islandChats)
      throw new Error("ATOM memory must be enabled for durable T3 conversations.");
    return runtime.islandChats;
  };
  const getSession = (params: JsonObject) => {
    const session = sessions.get(string(params.sessionId));
    if (!session)
      throw new Error(
        "This ATOM session is unavailable. Restore its backend data before resuming.",
      );
    return session;
  };
  const model = (s: Session) => chats().modelOf?.(s.id) ?? runtime.settings.current();
  const catalog = (s: Session) => {
    const current = model(s);
    const currentModelId = `${current.provider}:${current.model}`;
    const availableModels = runtime.settings
      .info()
      .providers.filter((p) => p.available)
      .flatMap((p) =>
        p.models.map((m) => ({ modelId: `${p.id}:${m.id}`, name: `${p.name} · ${m.name}` })),
      );
    if (!availableModels.some((m) => m.modelId === currentModelId))
      availableModels.push({ modelId: currentModelId, name: current.model });
    return { currentModelId, availableModels };
  };
  const configOptions = (s: Session) => {
    const { provider, model: id } = model(s);
    const capability = runtime.settings.reasoning?.(provider, id);
    const selected = chats().reasoningOf?.(s.id);
    const models = catalog(s);
    return [
      {
        id: "model",
        name: "Model",
        type: "select" as const,
        category: "model",
        currentValue: models.currentModelId,
        options: models.availableModels.map((m) => ({ value: m.modelId, name: m.name })),
      },
      ...(capability?.levels.length
        ? [
            {
              id: "reasoning",
              name: "Thinking",
              type: "select" as const,
              category: "thought_level",
              currentValue: selected?.effective ?? capability.default,
              options: capability.levels.map((value) => ({ value, name: value })),
            },
          ]
        : []),
    ];
  };
  const state = (
    s: Session,
  ): Pick<AcpCompat.NewSessionResponse, "modes" | "models" | "configOptions"> => {
    return {
      modes: { currentModeId: chats().accessOf?.(s.id) ?? "checked", availableModes: MODES },
      models: catalog(s),
      configOptions: configOptions(s),
    };
  };
  const selectModel = (session: Session, selected: string) => {
    const colon = selected.indexOf(":");
    if (colon < 1) throw new Error("Choose an ATOM provider and model.");
    const result = chats().setModel?.(
      session.id,
      selected.slice(0, colon),
      selected.slice(colon + 1),
    );
    if (!result || "error" in result)
      throw new Error(
        result && "error" in result ? result.error : "Model changes are unavailable.",
      );
  };
  const enqueue = async <T>(
    peer: Peer,
    session: Session,
    operation: (run: Run) => Promise<T>,
  ): Promise<T> => {
    if (runs.has(session.id))
      throw new Error("This chat already has an active request. Stop or finish it first.");
    const run: Run = { session, peer, controller: new AbortController(), tools: new Map() };
    runs.set(session.id, run);
    const next = queue.then(async () => {
      if (run.controller.signal.aborted)
        throw new Cancelled("Request cancelled before it started.");
      active = run;
      try {
        return await operation(run);
      } finally {
        runtime.computer.cancelAll();
        active = undefined;
      }
    });
    queue = next.catch(() => {});
    try {
      return await next;
    } finally {
      runs.delete(session.id);
    }
  };
  runtime.computer.attach((event) => {
    const run = active;
    if (event.type === "approval.closed") {
      permissionReplies.delete(event.id);
      if (run)
        update(run.peer, run.session, {
          sessionUpdate: "tool_call_update",
          toolCallId: event.id,
          title: "Permission request resolved",
          status: "completed",
          content: [
            {
              type: "content",
              content: {
                type: "text",
                text: "The permission decision was recorded. This does not confirm the action's result.",
              },
            },
          ],
        });
      return;
    }
    if (!run) {
      if (event.type === "approval.request") runtime.computer.answer(event.id, false);
      return;
    }
    if (event.type === "approval.request") {
      const toolCall: Acp.ToolCall = {
        toolCallId: event.id,
        title: event.summary,
        kind: event.fileReview ? "edit" : "other",
        status: "pending",
        content: [
          { type: "content", content: { type: "text", text: event.reason } },
          ...(event.fileReview
            ? [
                {
                  type: "diff" as const,
                  path: event.fileReview.path,
                  oldText: event.fileReview.before,
                  newText: event.fileReview.after,
                },
              ]
            : []),
        ],
      };
      update(run.peer, run.session, { sessionUpdate: "tool_call", ...toolCall });
      permissionReplies.set(event.id, {
        peer: run.peer,
        finish: (allow, remember) =>
          runtime.computer.answer(
            event.id,
            allow && !run.controller.signal.aborted,
            remember,
            event.fileReview?.token,
          ),
      });
      run.peer.send({
        jsonrpc: "2.0",
        id: event.id,
        method: "session/request_permission",
        params: {
          sessionId: run.session.id,
          toolCall,
          _meta: { "atom.requireExplicitApproval": true },
          options: [
            { optionId: "allow", name: "Allow once", kind: "allow_once" },
            ...(event.rememberFile
              ? [{ optionId: "remember", name: "Allow for this chat", kind: "allow_always" }]
              : []),
            { optionId: "deny", name: "Decline", kind: "reject_once" },
          ],
        },
      });
    }
  });
  runtime.chatWork.attach((event) => {
    const run = active;
    if (!run || event.chat !== run.session.id) return;
    for (const call of event.calls) {
      if (run.tools.get(call.id) === call.state) continue;
      const first = !run.tools.has(call.id);
      run.tools.set(call.id, call.state);
      update(run.peer, run.session, {
        sessionUpdate: first ? "tool_call" : "tool_call_update",
        toolCallId: call.id,
        title: call.tool,
        kind: "other",
        status:
          call.state === "started" ? "in_progress" : call.state === "ok" ? "completed" : "failed",
        ...(call.state === "unknown"
          ? {
              content: [
                {
                  type: "content",
                  content: { type: "text", text: "The action's result was not confirmed." },
                },
              ],
            }
          : {}),
      });
    }
  });

  const dispatch = async (peer: Peer, method: string, params: JsonObject): Promise<object> => {
    if (method === "initialize") {
      initialized.add(peer);
      return {
        protocolVersion: 1,
        agentInfo: { name: "atom", title: "ATOM", version: "0.1.0" },
        authMethods: [],
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: false, audio: false, embeddedContext: false },
          mcpCapabilities: { http: false, sse: false },
        },
      };
    }
    if (!initialized.has(peer)) throw new Error("Initialize the ATOM connection first.");
    if (method === "session/new") {
      if (Array.isArray(params.mcpServers) && params.mcpServers.length)
        throw new Error(
          "Configure MCP tools in ATOM; this bridge does not grant client-supplied tools.",
        );
      if (!isAbsolute(string(params.cwd))) throw new Error("Select an absolute workspace folder.");
      const cwd = realpathSync(string(params.cwd));
      const session: Session = { id: `t3-${randomUUID()}`, cwd, reasoning: {} };
      sessions.set(session.id, session);
      save();
      return { sessionId: session.id, ...state(session) };
    }
    const session = getSession(params);
    if (method === "session/cancel") {
      const run = runs.get(session.id);
      if (run?.peer === peer) {
        run.controller.abort();
        if (run === active) runtime.computer.cancelAll();
      }
      return {};
    }
    if (method === "session/load") {
      if (realpathSync(string(params.cwd)) !== session.cwd)
        throw new Error(
          "The saved chat belongs to a different workspace. Its permissions were not changed.",
        );
      if (runs.has(session.id))
        throw new Error("Stop the current request before loading this chat.");
      for (const [index, message] of chats().messages(session.id).entries()) {
        const id = `${session.id}-${index}`;
        if (message.role === "assistant" && session.reasoning[index])
          chunk(peer, session, "agent_thought_chunk", session.reasoning[index]!, `${id}-reasoning`);
        chunk(
          peer,
          session,
          message.role === "user" ? "user_message_chunk" : "agent_message_chunk",
          message.content,
          id,
        );
      }
      return state(session);
    }
    if (method === "session/set_model")
      return enqueue(peer, session, async () => {
        selectModel(session, string(params.modelId));
        update(peer, session, {
          sessionUpdate: "config_option_update",
          configOptions: configOptions(session),
        });
        return {};
      });
    if (method === "session/set_config_option")
      return enqueue(peer, session, async () => {
        if (params.configId === "model") {
          selectModel(session, string(params.value));
          return { configOptions: configOptions(session) };
        }
        if (params.configId !== "reasoning") throw new Error("That ATOM setting is unavailable.");
        const choice = model(session);
        const result = chats().setReasoning?.(
          session.id,
          choice.provider,
          choice.model,
          string(params.value),
        );
        if (!result || "error" in result)
          throw new Error(
            result && "error" in result ? result.error : "Thinking changes are unavailable.",
          );
        return { configOptions: configOptions(session) };
      });
    if (method === "session/set_mode")
      return enqueue(peer, session, async ({ controller }) => {
        if (!isChatAccessMode(params.modeId))
          throw new Error("That ATOM access mode is unavailable.");
        const previous: ChatAccessMode = chats().accessOf?.(session.id) ?? "checked";
        if (
          params.modeId === "full" &&
          previous !== "full" &&
          !(await chats().confirmFullAccess?.(session.id, previous, controller.signal))
        )
          throw new Error("Full access was declined. Your existing permissions remain in effect.");
        const result = chats().setAccess?.(session.id, params.modeId, previous);
        if (!result || "error" in result)
          throw new Error(
            result && "error" in result ? result.error : "Access changes are unavailable.",
          );
        return {};
      });
    if (method === "session/prompt")
      return enqueue(peer, session, async ({ controller }) => {
        if (!Array.isArray(params.prompt) || params.prompt.length === 0)
          throw new Error("Enter a message.");
        const text = params.prompt
          .map((part: unknown) => {
            const block = object(part);
            if (block.type !== "text")
              throw new Error(
                "This first ATOM bridge supports text prompts. Attachments have not been connected yet.",
              );
            return string(block.text);
          })
          .join("\n");
        if (!text.trim()) throw new Error("Enter a message.");
        const busy = runtime.chatTurns.begin(session.id, "window");
        if (busy) throw new Error(busy);
        const finish = runtime.chatWork.begin(session.id, controller.signal);
        let outcome: "completed" | "failed" | "stopped" = "failed";
        let thought = "",
          streamed = "";
        try {
          if (!chats().projectOf?.(session.id)) {
            const projects = runtime.islandProjects;
            if (!projects) throw new Error("ATOM project access is unavailable.");
            const folderLabel =
              session.cwd === homedir()
                ? "~"
                : session.cwd.startsWith(`${homedir()}/`)
                  ? `~${session.cwd.slice(homedir().length)}`
                  : session.cwd;
            let project = projects.list().find((p) => p.folderLabel === folderLabel && !p.archived);
            if (!project) {
              const name = `${
                basename(session.cwd)
                  .replace(/[^\p{L}\p{N} '-]/gu, " ")
                  .trim()
                  .slice(0, 40) || "Workspace"
              } ${randomUUID().slice(0, 6)}`;
              const result = projects.add(name, session.cwd);
              if ("error" in result) throw new Error(result.error);
              project = projects.list().find((p) => p.folderLabel === folderLabel && !p.archived);
            }
            if (!project) throw new Error("ATOM could not register the selected workspace.");
            const allowed = projects.startChat(project.id);
            if ("error" in allowed) throw new Error(allowed.error);
            projects.assign(session.id, project.id);
          }
          const archive = chats().messages(session.id);
          runtime.core.resume(session.id, chats().replay?.(session.id, archive).turns ?? archive);
          const id = `${session.id}-${archive.length + 1}`;
          const response = await runtime.core.handle({ text, source: "text" }, controller.signal, {
            onText: (delta) => {
              streamed += delta;
              chunk(peer, session, "agent_message_chunk", delta, id);
            },
            onReasoning: (delta) => {
              thought += delta;
              chunk(peer, session, "agent_thought_chunk", delta, `${id}-reasoning`);
            },
          });
          if (controller.signal.aborted) {
            outcome = "stopped";
            return { stopReason: "cancelled" };
          }
          if (!streamed) chunk(peer, session, "agent_message_chunk", response.text, id);
          const saved = chats().messages(session.id);
          if (saved.at(-1)?.content !== response.text)
            throw new Error(
              "ATOM answered but could not confirm that its history was saved. Check storage before continuing.",
            );
          if (thought) {
            session.reasoning[saved.length - 1] = thought;
            save();
          }
          outcome = "completed";
          return { stopReason: "end_turn" };
        } catch (error) {
          if (controller.signal.aborted) {
            outcome = "stopped";
            return { stopReason: "cancelled" };
          }
          throw error;
        } finally {
          finish(outcome);
          runtime.chatTurns.end(session.id, "window");
        }
      });
    throw new Error(`Unsupported ATOM agent method: ${method}.`);
  };
  return {
    async receive(peer: Peer, value: unknown) {
      let id: RpcId | undefined;
      let method: string | undefined;
      try {
        const message = object(value);
        if (typeof message.id === "string" || typeof message.id === "number") id = message.id;
        if (typeof message.method !== "string") {
          const pending = id === undefined ? undefined : permissionReplies.get(String(id));
          if (pending?.peer === peer) {
            permissionReplies.delete(String(id));
            const result = message.result ? object(message.result) : undefined;
            const outcome = result?.outcome ? object(result.outcome) : undefined;
            const option = outcome?.outcome === "selected" ? outcome.optionId : undefined;
            pending.finish(option === "allow" || option === "remember", option === "remember");
          }
          return;
        }
        method = message.method;
        const result = await dispatch(peer, method, object(message.params ?? {}));
        if (id !== undefined) peer.send({ jsonrpc: "2.0", id, result });
      } catch (error) {
        if (id !== undefined)
          peer.send(
            error instanceof Cancelled && method === "session/prompt"
              ? { jsonrpc: "2.0", id, result: { stopReason: "cancelled" } }
              : {
                  jsonrpc: "2.0",
                  id,
                  error: {
                    code: -32000,
                    message: redactSecrets(
                      error instanceof Error
                        ? error.message
                        : "ATOM could not complete this request.",
                    ),
                  },
                },
          );
      }
    },
    disconnected(peer: Peer) {
      initialized.delete(peer);
      for (const run of runs.values()) if (run.peer === peer) run.controller.abort();
      for (const [id, pending] of permissionReplies)
        if (pending.peer === peer) {
          permissionReplies.delete(id);
          pending.finish(false, false);
        }
    },
    stop() {
      for (const run of runs.values()) run.controller.abort();
      runtime.computer.cancelAll();
    },
  };
}
