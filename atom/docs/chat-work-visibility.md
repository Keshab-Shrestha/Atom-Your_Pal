# Chat work visibility

Implemented 2026-10-18, ADR-156, as the next reading/work-visibility batch requested by Keshab. TypeScript checking and Swift release compilation pass; tests, gallery, app launch, provider calls and live acceptance were skipped by request. The installed app is unchanged. Changes remain local/uncommitted on `main`.

## Elapsed work and folded log

Foreground window turns now show Working for, Worked for, Failed after or Stopped after with a collapsible log. Duration covers the foreground Core request, including setup, tools and waiting for clarification; speech playback is separate. Host timing uses a monotonic clock, with native monotonic interpolation once per second while working. Restart/disconnect freezes active observations as interrupted. No missing tool result is presented as proof of success or no effects.

Claude observations come from main-session assistant `tool_use` and user `tool_result` SDK messages while a foreground send waits. Worker messages carrying `parent_tool_use_id` are excluded. Codex observations wrap its checked foreground ATOM host-tool runner, including direct reads and delegation. A delegation call is one foreground call, not the worker's internal history. Gemini/text-only providers still show elapsed foreground time, with no tool calls observed. Provider reasoning/internal work and unreported SDK events are not included.

At most 60 calls are kept per turn, with an omitted-observation count. Rows contain generated ids, sanitized tool names, state and optional duration only. They never copy tool arguments, payloads, file contents or results. A reported tool error is labeled as such; a call without an observed terminal result ends as Outcome unknown. These are observations, not an audit/effect-reconciliation guarantee.

The log starts folded, is selectable when expanded and uses native buttons/accessibility state. It is attached to the matching visible foreground turn, never restored by counting saved messages. Logs are transient: switching/replaying chats or restarting loses their detail, and the native 50-turn display limit still applies. Background/routine/API/Telegram work keeps its existing Board/surface behavior. No new durable work journal, database table or tool-log retention is added.

## Clarification cards

The foreground Claude/Codex main chat receives `ask_user`, a host tool asking one question up to 600 UTF-16 code units, with up to four distinct suggestions of 100 units each. The optional tool `choices` argument is a newline-separated string, not a new SDK question contract. A card above the composer offers each suggestion, an independent free-text answer (2,000-unit maximum) and Skip. No option is preselected/sent automatically. The composer still queues ordinary new messages; it does not silently answer the card.

Only one card can wait and at most four can be asked per foreground turn. Cards expire after 90 seconds or earlier when the enclosing turn times out, stops, switches chat or disconnects. The existing model turn deadline is not extended. Empty/oversized answers, old chat/turn/card identities and duplicate answers cannot settle a later question. The native card disables submission while awaiting confirmation; it closes when the host snapshot settles it or the turn ends. No-answer/Skip/timeout supplies no consent/default choice.

Worker calls to the Claude ATOM question tool are explicitly denied; Codex workers do not receive it. Composed API/Telegram/routine cores do not receive the tool. The native UI opts into cards with chat.work.watch after ready. An older installed UI, terminal or no-native-bridge route refuses cards immediately and tells the model to ask in its reply, instead of waiting on an invisible card. Claude's unsupported built-in AskUserQuestion receives guidance to use the host card instead.

Answers return as clarification data. They do not resolve `approval.answer`, write an edit grant, change kits, approve a plan, toggle a setting or bypass file/macOS checks. Models still propose actions through existing deterministic gates. Question text/suggestions render as plain text, with no executable links or uploads. Cards advise against entering passwords/secrets.

Answered questions appear in the expanded transient work row. On a successful saved turn, the original user text is followed by labeled JSON question/answer pairs in the saved user message. That preserves the clarification for own-chat retrieval, restart replay, provider changes and later fork/retry review without adding a second writer or tool transcript. The live original bubble stays unchanged until replay; its work row shows answers meanwhile. These additions inherit existing saved-chat retention/policy, provider session storage and context budgets. There is no separate private answer store.

ADR-157 now retains accepted failed/cancelled-turn answers in the foreground recovery journal and holds unconfirmed local answer intents. They do not become a completed chat exchange and never replay automatically. The work log itself remains transient. See [foreground recovery](foreground-recovery.md) for current durability and acceptance limits.

## Read-only Access summary

Access opens a read-only popover and refreshes the saved chat's inspect response. It shows the selected provider, whether that provider has an ATOM host-tool route, project association, the count of continuing exact-file edit grants, and configured computer/web settings. It sends no model prompt and reads no project file contents. Exact paths are not included in this summary; the existing deterministic Show/Forget file permissions for this chat commands remain available.

This is last-inspected configuration, not live permission certification, an account-health probe or a full-access switch. Attached-file copies, project availability, kit/provider differences, protected files, approvals, attachment restrictions, per-call checks and macOS permissions still decide actual access. Web/computer configuration does not promise that every provider/kit can use those tools. Unsaved/unavailable chats show an unavailable explanation instead of invented grants.

## Protocol and boundaries

`chat.work` snapshots carry chat/turn ids, start timestamp, bounded elapsed time, work state, bounded calls, omitted count and bounded question records. The private `chat.work.watch` command opts a capable UI into cards (no extra fields); `chat.question.answer` carries chat/turn/card UUID identities, with optional text (omit to skip); strict parsing rejects extra keys and invalid fields. Swift also validates snapshot bounds. Unknown client events remain forward compatible. Native state clears/interruption handling prevents a stopped runtime from leaving a clickable old question.

A host-only ModelRequest.interactionTools runner keeps clarification separate from the read-only historyTools runner; Codex combines their exposed specs without handing either to workers. One runtime bridge observes only the foreground primary Core; composed cores do not inject question tools or observations. Codex runner wrappers capture the active run when the request is built, rejecting late updates to a newer run. Claude SDK listeners attach around send and detach in finally. The bridge drops late completions after settlement and resolves pending questions on abort/detach. Observation delivery cannot fail underlying model/tool execution. Tool policy decisions remain in the existing host gate, outside the views and model.

## Verification limits and next area

`pnpm typecheck` and `swift build --package-path apps/mac/island -c release` pass; static review covers scopes, parser bounds, observer teardown, question cancellation/identity checks, successful-turn archive capture and absence of permission writes. Two existing Swift warnings remain in IslandSettings/main. No tests were added/run, no app installed/launched, no real SDK/provider/UI/VoiceOver/disconnect acceptance performed. Compilation is not behavioral acceptance.

Arbitrary-selection quoting, the shared editor spike and `atom://` prompt links remain separate/deferred. Next proposed area: reliability, starting with durable foreground turn/answer delivery; project workspace, Git and provider parity remain later roadmap work.
