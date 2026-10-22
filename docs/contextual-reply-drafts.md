# Contextual unsent reply drafts

Implemented in source on 22 October 2026, ADR-189, as the next scoped [Sentient adoption capability](sentient-adoption-plan.md). Compiler checks only; tests remain deferred until the end of the adaptation plan.

## Flow

Select conversation text in an app, press the existing Quick actions shortcut, then choose Draft a reply. Claude/Codex open a dedicated review panel. The original secure-field refusal and selection/clipboard labels remain; truncated captures are labeled so the user can paste the missing conversation before generating. The panel does not capture a screenshot or read an entire app/thread in the background.

The user can edit the captured conversation, say what the reply should convey and add optional facts/context. Find saved facts or notes searches existing local memory and Second brain on an explicit click. Opening the panel loads the drafting model only, without listing personal memories. No result is included automatically. Check at most twelve items, review their exact excerpts/provenance and remove any before generation. Each note excerpt is explicitly labeled if shortened; source-backed notes retain current/corrected/conflict/missing state and scan time.

Writing examples are manually provided, editable and optional for each draft. Explicit Save stores them in ATOM's local UserDefaults; inclusion defaults off every time, including when saved examples exist. Forget removes that preference and clears this panel's examples. No automatic collection of sent messages or writing-history harvesting. Preferences are ordinary local personal data, not a secret vault; forgetting does not erase backups or content already sent to a model.

Generate sends only the reviewed conversation, intent, optional background, explicitly checked excerpts and opted-in examples. It uses the active chat's model in a separate isolated request; it does not add the full chat history, task tools, permissions, browser state or standing memory. The panel shows provider/model and its separate drafting effort before generation. Claude's tool-free job uses low effort; Codex uses low when supported, otherwise its advertised default. Main-chat thinking settings remain unchanged. Profile changes before admission require reloading/reviewing instead of silently switching providers.

The result remains in an editable unsent draft field. Copy draft is explicit and never types, pastes, presses Return, chooses a recipient or sends. Regeneration preserves the previous draft until a new result succeeds; cancelled/failed regeneration retains the previous input attribution. Input edits during generation are reflected by an older-input notice on the result. Closing discards the panel's ephemeral form/result and cancels its pending work. Direct insertion into an app is not added: it would need a separate fresh, reviewed destination binding.

## Provider compatibility

Claude uses the existing Gateway `runEdit` no-tool structured job, with the selected model rather than an unannounced smaller tier. Codex uses the existing checked session adapter with an empty host-tool runner, native-tool lockdown, ephemeral session and no inherited active MCP/plugin/skill context. There is no automatic retry or provider fallback.

Gemini CLI's current adapter uses plan/read-only mode, which is not a guarantee of zero native reads. Keshab explicitly approved Claude/Codex first on 22 October 2026, preserving Gemini's existing selected-text reply action until its adapter can be restricted. Gemini retains exactly that earlier action; no new saved-note context or writing examples are routed through it. The contextual backend refuses unsupported providers before any model call. If the active provider changes after opening the panel, the profile guard refuses generation until reviewed. Do not claim Gemini has the new tool-free contextual feature.

## Boundaries

Private native commands are `reply.context`, `reply.draft` and `reply.cancel`, with request IDs and matching response dictionaries. They are not model tools, worker APIs, schedules or permission grants. Lookup is local and does not invoke a model. Checked excerpts are hashed with their preview/provenance and re-resolved immediately before generation; changed, removed, excluded or credential-like items require a new review rather than being silently substituted. Missing/conflicting source copies are labeled reference data, not authoritative current facts.

Model input is structured JSON. System instructions distinguish the user's intent from reference conversations, source material and writing examples; examples guide tone, never borrowed facts/commitments. The model has no action capabilities. These safeguards do not guarantee a factually correct draft; the result remains editable and unsent.

The 64 KiB aggregate request budget and 32 KiB output budget are technical resource bounds, not editor character caps. Oversize requests are refused before dispatch, without silently dropping selected sources. Saved context previews use at most 3,500 JSON-encoded bytes per item; full notes are not uploaded by checking a shortened excerpt. Credential filtering is heuristic, not complete de-identification.

Only one contextual draft runs at a time in the host. Cancellation/close/runtime stop abort owned work, late results are ignored, and the native 90-second timeout cancels rather than retrying. A cancelled call may already have consumed provider usage. No draft is appended to chats, memory, suggestions, source files or task history. Local logs contain input/output sizes, source count and whether style was included, never conversation/examples/context text. Existing Claude/Codex usage recorders receive provider-reported tokens. Local inference remains a future backup only.

## Evidence

TypeScript typecheck and Swift release compilation pass. No tests, live model requests, clipboard/shortcut interaction checks, gallery scenes or real writing-example saves were run. No running app was replaced/restarted, real account/source accessed or existing user draft/grant changed. [Deferred end-of-plan validation](sentient-adoption-validation.md) records the required protocol, lifecycle, privacy, model and UI checks. This is compiled implementation, not acceptance-certified delivery.
