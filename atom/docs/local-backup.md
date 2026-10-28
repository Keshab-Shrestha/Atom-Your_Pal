# Optional local text backup

Validation update: the combined gate now includes actual owned-loopback transport/lifecycle tests and light/short-dark composer snapshots. The configured-server panel keeps Message/Send/Stop visible while other content scrolls; saved configuration is collapsible. No real local model was installed or called. [Results and remaining native/server acceptance](sentient-adoption-results.md) supersede this capability's original compiler-only delivery state below.

Sentient adaptation sequence 7, ADR-193 (22 October 2026). This is a compiled implementation scope; functional acceptance is deferred to the [combined gate](sentient-adoption-validation.md) at Keshab's request. No model/runtime installation, endpoint contact or running-app replacement was used to implement it.

## Explicit use

Settings → Model → Local backup → Open presents a separate temporary text conversation. Enter the address and exact model ID of a compatible server you already run on this Mac. Save stores only those two fields in `local-backup.json` beside the runtime's configured `island.json`; it does not contact the server. There is no configured endpoint by default.

Check server explicitly requests `/v1/models`, without messages, and requires the configured ID to be listed. It reports elapsed time and check time. A model-list entry proves neither loaded weights nor successful text generation, vision, tools, computer control or adjustable thinking. Checks expire after five minutes. A successful explicit text request marks text generation verified for that panel's session; a later model-list check starts that verification over.

Send to local backup explicitly requests `/v1/chat/completions` through the LLM Gateway, with a short host instruction and this panel's own successful user/reply pairs plus the new message. The server must echo the exact configured model ID; aliases with different response IDs must be configured to agree. The adapter sends no tools, credentials, files, web, vision, thinking option, cloud-chat history, memory, project or native MCP context. It refuses requests carrying host tools/files/access capabilities and rejects tool/function responses. A response cannot grant access or execute an action.

Follow-ups retain the panel's conversation until Clear, configuration save/forget, Close, another backup window or runtime restart. No backup turns are written to cloud chats, Second brain, standing facts, source data or disk transcript. Copy is manual; no automatic insert, send or action retry. Existing cloud history, Chat brief, drafts, model/thinking/access choices and deterministic exact-file grants are untouched. Backing up an existing cloud conversation currently means deliberately copying the relevant text into this panel; automatic context transfer and ordinary saved local-model chats are outside this first scope.

## Transport and limits

The Gateway adapter uses direct `node:http` to literal `127.0.0.1` or `[::1]`, with an explicitly entered port and fixed `/v1` base. No DNS names, arbitrary paths, credentials, queries, fragments, ambient proxy configuration, authentication headers or redirects. Only 200 JSON responses with identity encoding are accepted. No new dependency, Ollama runtime, model manager, download or server startup is added. An endpoint on loopback can itself forward requests or retain data; the server's configuration is the user's responsibility. A loopback address is not proof that its inference runs locally.

The panel never participates in cloud error recovery, normal provider registration/defaults, foreground tools, scheduled briefs, continuity summaries or source analysis. Nothing changes providers silently. A failed or interrupted cloud action is never replayed. The local adapter always uses `maxRetries: 0`.

Request content is admitted against a 47,000-byte conversation/instruction budget (the adapter independently checks its serialized 48,000-byte message budget), at most forty outgoing messages and 256 admitted sends per open session. Exceeding a budget leaves the unsent input intact with an explicit error; no silent truncation/compaction or editor character limit. The response transport is bounded at 1 MiB and accepted answer text at 24,000 bytes. Requests ask for at most 2,048 output tokens; a server `length` finish is visibly marked incomplete. The context window/tokenizer of a particular model is not inferred from these byte budgets; smaller models may refuse and require an explicitly shorter conversation.

Inference is non-streaming. The panel shows last successful total completion time and optional server-reported input/output token counts, with unknown values shown as unknown. These are not measured first-token latency, independently verified usage, cache counts, pricing or a speed/efficiency benchmark. The result is not added to cloud subscription usage totals. The compatibility shapes follow the [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat) and [model-list reference](https://developers.openai.com/api/reference/resources/models/methods/list); individual local servers still require acceptance checks.

## Recovery and persistence

One request runs at a time. Explicit Stop/Close/Clear/configuration change/runtime stop aborts the owned HTTP request. Probe has a ten-second deadline, inference sixty seconds, and the native client has a longer bounded confirmation timeout. Closing the connection cannot guarantee that an independently managed server stops its computation; this is disclosed on interruption. No server process is killed or restarted.

Native UUID/session matching ignores late answers. Timeout requires explicit state Reload before another mutation/send; Reload does not submit inference. A panel's admitted send IDs remain protected against duplicate dispatch until it closes, including failed/cancelled admissions. Successful text and its prompt enter the volatile transcript together. Failed/cancelled requests do not publish either, and prior successful turns plus the unsent editor input remain. If a success was committed before a lost acknowledgement, Reload reveals it rather than resending it. Reopening after runtime restart starts a new temporary conversation and never replays interrupted input.

Configuration is validated on load/save, loaded only from a bounded ordinary non-symlink file, and written through an exclusively created mode-0600 temporary file then atomic rename. No startup network probe. Corrupt configuration produces fixed guidance and can be explicitly replaced/forgotten. Revision checks prevent stale save/send/clear operations after a configuration change. No model endpoint is exposed through public HTTP, Telegram or tools. Provider bodies, prompts, replies, local IDs and configuration values are not logged by this capability. Errors use fixed host guidance.

## Delivery state

TypeScript checking and Swift release compilation pass (65.85 seconds, existing warnings). No tests were added or run, no endpoint/fixture/model call was made, and the app was not installed or restarted. Security, compatible-server behavior, recovery races, native layouts and all earlier adaptation features remain unverified until the combined acceptance pass. This is the last initial coding capability in the seven-part plan, not full parity with every Sentient feature.
