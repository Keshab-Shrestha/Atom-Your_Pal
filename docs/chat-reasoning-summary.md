# Reasoning summary in the chat work log — 28 October 2026

This document defines a bounded reasoning summary for a chat turn. It belongs to ADR-212.
No code implements it yet. The Swift view is out of scope until the runtime part works.

## Why

The HTML preview shows "Thought for 12 s · 3 steps" with one line per step. The native chat shows "Worked for 12s · 3 observed calls". It has no reasoning text.
The runtime does not send reasoning text today. It sends only the effort level (ADR-179).

## What the Claude SDK offers

Facts from `@anthropic-ai/claude-agent-sdk` 0.3.296 (`sdk.d.ts`):

- `ThinkingAdaptive` has an optional `display` field: `'summarized'` or `'omitted'`.
- A `thinking` block in an assistant message holds the summary text when the display is `'summarized'`.
- With `includePartialMessages: true`, the SDK also streams `thinking_delta` events. This design does not use them.
- The gateway sets `thinking: { type: "adaptive" }` only when the chat has an effort level other than Off. It sets no `display` today.
- The package range is `^0.3.287`. The lockfile has 0.3.287 and 0.3.296. Phase R1 checks both.

Not verified:

- What a `thinking` block holds for each model when `display` is left out.
- Whether every model that offers an effort level accepts `display: 'summarized'`.
- Codex. No `codex` binary is installed on this Mac. The Codex session code reads only `agentMessage` and tool items. Codex gives no reasoning summary in the first release.

## Decision summary

- Add the summary to the existing `chat.work` event. Do not add a second event.
- Claude only, in the first release.
- Ask for `display: 'summarized'` only when the gateway already asks for adaptive thinking.
- One line per `thinking` block. A block is one step between tool calls.

## Event change

`chat.work` gets one optional field. It is additive. An app that does not know the field ignores it.

```json
{
  "type": "chat.work",
  "thinking": { "lines": ["string"], "omitted": 0 }
}
```

- `lines` has at most 12 items.
- Each line is at most 300 characters. The runtime cuts it at a word boundary and adds "…".
- Each line has no line breaks. The runtime replaces each run of white space with one space.
- `omitted` counts the blocks that did not fit.
- The field is absent when the turn has no summary.
- The field is absent for a chat with the effort level Off or Default.
- The event keeps its existing limits: 60 calls and 4 questions.

## Where it comes from

- `chat-work.ts` receives each SDK message in `sdk(chat, message)`.
- For a top-level `assistant` message, it reads each content block of type `thinking`.
- It ignores a block of type `redacted_thinking`.
- It ignores a message with a `parent_tool_use_id`. Subagent thinking never shows.
- It ignores a block with an empty `thinking` string.
- It adds the line to the active run and sends the event, as it does for a tool call.

## Privacy rules

1. The summary is ephemeral. It stays in memory for the run and goes only to the app that watches.
2. The runtime does not write it to SQLite, a transcript, a brief, a memory file, a log or a receipt.
3. The runtime does not send it to another provider, a worker or a tool.
4. The app does not save it. The native view keeps the existing note: the work log is temporary.
5. The summary can contain what the user typed or a file path. The app shows it as plain text and never as Markdown or HTML.
6. The runtime logs only counts, never the text.

## Native side (later)

- `ChatWorkSnapshot` gets an optional `thinking` value. Its `valid` check allows at most 12 lines of 300 characters.
- `ChatWorkView` shows the lines under the existing toggle, with the note "A short summary of the reasoning, not the model's raw thoughts."
- Older runtimes send no field. The view then shows what it shows now.
- The Run panel payload gets the same lines later, if wanted. That needs a contract change.

## Phases

| Phase | Work | Check |
|---|---|---|
| R1 | Read what the SDK returns with `display: 'summarized'` for each model that offers an effort level. | A small script with a real call, with the owner's approval for each call. |
| R2 | Gateway: add `display: 'summarized'`. `chat-work.ts`: collect the lines and add the field. | TypeScript tests with a fake SDK stream. |
| R3 | Swift: decode, validate, show. | Swift tests and a gallery capture. |
| R4 | Codex: find out what its app server sends. | Needs the `codex` binary. |

## Tests for R2

- A `thinking` block adds one line and sends the event.
- A long block is cut at 300 characters. A block with line breaks becomes one line.
- The 13th block adds to `omitted`, not to `lines`.
- A `redacted_thinking` block, an empty block and a subagent block add nothing.
- A chat with effort Off sends no `thinking` field.
- The text does not reach SQLite, the log or any other provider. A test reads each sink.
