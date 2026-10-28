import type { CodexTransport } from "../services/llm-gateway/src/providers/codex-session.ts";

type Message = Parameters<CodexTransport["send"]>[0];
export interface FakeCodexTurn {
  text: string;
  start: any;
  turn: number;
  call(tool: string, input: Record<string, unknown>, method?: string): Promise<any>;
}

/** A real JSON-RPC exchange shape, without a signed-in model or user files. */
export function fakeCodex(script: (turn: FakeCodexTurn) => Promise<string> | string, options: { profile?: string; servers?: string[]; config?: unknown; skills?: unknown } = {}) {
  const wires: { sent: Message[]; closed: boolean; emit(message: Message): void }[] = [];
  const factory = (): CodexTransport => {
    let emit: (message: Message) => void = () => {};
    let start: any; let turn = 0; let call = 0;
    const responses = new Map<string, (result: any) => void>();
    const wire = { sent: [] as Message[], closed: false, emit: (message: Message) => emit(message) };
    const threadId = `thread-${wires.length}`;
    wires.push(wire);
    const reply = (id: string | number | undefined, result: any) => queueMicrotask(() => emit({ id, result }));
    return {
      listen(onMessage) { emit = onMessage; },
      close() { wire.closed = true; },
      send(message) {
        wire.sent.push(message);
        if (!message.method) { responses.get(String(message.id))?.(message.result ?? message.error); responses.delete(String(message.id)); return; }
        if (message.method === "initialize") reply(message.id, {});
        if (message.method === "config/read") reply(message.id, { config: options.config === undefined ? { mcp_servers: {}, plugins: {} } : options.config });
        if (message.method === "skills/list") reply(message.id, options.skills === undefined ? { data: [{ cwd: message.params.cwds[0], skills: [], errors: [] }] } : options.skills);
        if (message.method === "mcpServerStatus/list") reply(message.id, { data: (options.servers ?? []).map((name) => ({ name })), nextCursor: null });
        if (message.method === "thread/start") {
          start = message.params;
          reply(message.id, { thread: { id: threadId }, model: "gpt-test", activePermissionProfile: { id: options.profile ?? "atom_host_tools" } });
        }
        if (message.method === "turn/start") {
          const turnId = `turn-${++turn}`;
          reply(message.id, { turn: { id: turnId } });
          queueMicrotask(() => {
            void Promise.resolve().then(() => script({
              text: message.params.input[0].text, start, turn,
              call(tool, input, method = "item/tool/call") {
                const id = `server-${++call}`;
                return new Promise((resolve) => { responses.set(id, resolve); emit({ id, method, params: { threadId, turnId, callId: id, tool, arguments: input } }); });
              },
            })).then((text) => {
              if (wire.closed) return;
              emit({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", phase: "final_answer", text } } });
              emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [] } } });
            }, (error) => { if (!wire.closed) emit({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", error: { message: String(error) } } } }); });
          });
        }
      },
    };
  };
  return { factory, wires };
}
