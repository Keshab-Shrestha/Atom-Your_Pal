# Contextual unsent reply drafts

Implemented in source on 22 October 2026, ADR-189, as the next scoped [Sentient adoption capability](sentient-adoption-plan.md). The intermediate test deferral ended after the seven initial coding groups. Combined automated and isolated-provider checks pass; the bounded native Claude generation/edit/Copy/Cancel workflow also passes, as recorded in the [results](sentient-adoption-results.md).

## Flow

Select conversation text in an app, press the existing Quick actions shortcut, then choose Draft a reply. Claude/Codex open a dedicated review panel. The original secure-field refusal and selection/clipboard labels remain; truncated captures are labeled so the user can paste the missing conversation before generating. The panel does not capture a screenshot or read an entire app/thread in the background.

The user can edit the captured conversation, say what the reply should convey and add optional facts/context. Find saved facts or notes searches existing local memory and Second brain on an explicit click. Opening the panel loads the drafting model only, without listing personal memories. No result is included automatically. Check at most twelve items, review their exact excerpts/provenance and remove any before generation. Each note excerpt is explicitly labeled if shortened; source-backed notes retain current/corrected/conflict/missing state and scan time.

Writing examples are manually provided, editable and optional for each draft. Explicit Save stores them in ATOM's local UserDefaults; inclusion defaults off every time, including when saved examples exist. Forget removes that preference and clears this panel's examples. No automatic collection of sent messages or writing-history harvesting. Preferences are ordinary local personal data, not a secret vault; forgetting does not erase backups or content already sent to a model.

Generate sends only the reviewed conversation, intent, optional background, explicitly checked excerpts and opted-in examples. It uses the active chat's model in a separate isolated request; it does not add the full chat history, task tools, permissions, browser state or standing memory. The panel shows provider/model and its separate drafting effort before generation. Claude's tool-free job uses low effort; Codex uses low when supported, otherwise its advertised default. Main-chat thinking settings remain unchanged. Profile changes before admission require reloading/reviewing instead of silently switching providers.

The result remains in an editable unsent draft field. Copy draft is explicit and never types, pastes, presses Return, chooses a recipient or sends. Regeneration preserves the previous draft until a new result succeeds; cancelled/failed regeneration retains the previous input attribution. Input edits during generation are reflected by an older-input notice on the result. Closing discards the panel's ephemeral form/result and cancels its pending work. Reviewed insertion was added on 23 October; its destination checks and remaining native acceptance are described below.

## Provider compatibility

Claude uses the existing Gateway `runEdit` no-tool structured job, with the selected model rather than an unannounced smaller tier. Codex uses the existing checked session adapter with an empty host-tool runner, native-tool lockdown, ephemeral session and no inherited active MCP/plugin/skill context. There is no automatic retry or provider fallback.

Gemini CLI's current adapter uses plan/read-only mode, which is not a guarantee of zero native reads. Keshab explicitly approved Claude/Codex first on 22 October 2026, preserving Gemini's existing selected-text reply action until its adapter can be restricted. Gemini retains exactly that earlier action; no new saved-note context or writing examples are routed through it. The contextual backend refuses unsupported providers before any model call. If the active provider changes after opening the panel, the profile guard refuses generation until reviewed. Do not claim Gemini has the new tool-free contextual feature.

## Boundaries

Private native commands are `reply.context`, `reply.draft` and `reply.cancel`, with request IDs and matching response dictionaries. They are not model tools, worker APIs, schedules or permission grants. Lookup is local and does not invoke a model. Checked excerpts are hashed with their preview/provenance and re-resolved immediately before generation; changed, removed, excluded or credential-like items require a new review rather than being silently substituted. Missing/conflicting source copies are labeled reference data, not authoritative current facts.

Model input is structured JSON. System instructions distinguish the user's intent from reference conversations, source material and writing examples; examples guide tone, never borrowed facts/commitments. The model has no action capabilities. These safeguards do not guarantee a factually correct draft; the result remains editable and unsent.

The 64 KiB aggregate request budget and 32 KiB output budget are technical resource bounds, not editor character caps. Oversize requests are refused before dispatch, without silently dropping selected sources. Saved context previews use at most 3,500 JSON-encoded bytes per item; full notes are not uploaded by checking a shortened excerpt. Credential filtering is heuristic, not complete de-identification.

Only one contextual draft runs at a time in the host. Cancellation/close/runtime stop abort owned work, late results are ignored, and the native 90-second timeout cancels rather than retrying. A cancelled call may already have consumed provider usage. No draft is appended to chats, memory, suggestions, source files or task history. Local logs contain input/output sizes, source count and whether style was included, never conversation/examples/context text. Existing Claude/Codex usage recorders receive provider-reported tokens. Local inference remains a future backup only.

## Evidence

TypeScript checking, the ordinary TypeScript/Swift suites, focused protocol/source/profile/cancellation fixtures, isolated actual Claude/Codex output contracts, release compilation and the new local gallery scenes pass in the combined gate. The signed app is running. The physical shortcut/panel handoff succeeds after correcting a reopen handler that forced the main window forward. In the real Claude/Opus 5.5 panel, reviewed intent/background and opt-in unsaved fictional examples produce an editable reply; Copy matches a separate manual paste, and explicit Cancel preserves the earlier draft and attribution. Close returns to the preserved main chat. No existing chat/note/grant or saved-example preference changes. Native explicit authored-note selection/exact excerpt/removal and stale-revision refusal now pass using one owned fictional note. Explicit Save persists fictional examples without opting them in. Full restart preserves their exact text in the panel with inclusion Off, while transient inputs, selections and draft reset. With explicit approval, Forget removes the sample preference and the owned fictional note is permanently deleted; all 31 original application tables match the pre-fixture hashes. Cleanup exposed a separate stale note-search row after deletion, cleared by re-entering the query; this UI refresh issue remains open. Imported-source provenance UI, Codex panel interaction and broader keyboard/IME/accessibility remain to verify. No real writing examples, private conversation/source or saved permission is changed for these fixtures. The [case checklist](sentient-adoption-validation.md) remains broader than the [recorded evidence](sentient-adoption-results.md); this is not full release acceptance.


## Reviewed Insert (23 October 2026)

Keshab chose a reviewed Insert as the first drafting improvement. This changes the earlier Copy-only contract.

- The panel keeps the app that was in front when the Quick actions shortcut was pressed. A new **Insert into ‹App›** button sits next to Copy draft.
- The button works only for a finished, non-empty draft that is not being regenerated, and only while that app still runs. If the app has quit, nothing is inserted and the panel says to use Copy draft.
- Insert uses a dedicated reviewed path in the existing text inserter. After modifier-release and activation waits, it checks that the captured app is still running and frontmost, the focused element belongs to it and is an ordinary editable field, and its selection range is readable and empty. Secure fields and unknown selection/focus are refused with explicit Copy guidance, without an automatic clipboard write. Dictation and Quick actions Replace retain their existing behavior.
- Insert never presses Return, chooses a recipient or sends. An Accessibility write is confirmed against the expected field value; an uncertain write is reported without retrying via paste. Apps without a selected-text setter can receive a paste only after the same destination checks, reported as a paste request rather than confirmed insertion. The panel stays open.

Limit: the destination is the focused field in that app at the moment of Insert, not a stored element binding. If the user moves focus in that app, the draft goes to the new focus. The button names the app, not the field.

Selection guard: Insert writes the field's selected-text value, which replaces a selection. Unknown selection is refused, and validation occurs after activation rather than before it. If text is selected in the destination app, Insert refuses ("Text is selected in ‹App›; Insert would replace it. Click where the reply should go, then Insert again. Nothing was inserted.").

Checks: two new core tests (`ReplyInsertRule`); all Swift tests pass; the release app builds; no gallery golden changed.

Live check, 23 October, with Keshab pressing the Quick actions shortcut in a new TextEdit document and fictional text ("Mira: Can you bring the blue kettle to the Cedar studio on Friday?"):
- With the Mira line still selected, Insert refused with the selection message, and nothing was inserted.
- With the cursor on an empty line below, Insert placed the draft at the cursor. The Mira line stayed intact, and nothing was sent.
- Observation, separate from Insert: the draft said "Let me check my Friday plans… I'll confirm soon" rather than a clear yes. Whether this matched the typed intent was not confirmed.

### PR review corrections (23 October)

Insert is single-flight: repeated clicks cannot create parallel insertion tasks. Generate, Copy and draft editing are disabled during insertion. Closing the panel cancels its pending insertion; cancellation is checked after each wait before the write. The original nil-selection policy regression fails before correction. Expanded core cases cover unknown/negative/nonempty selection, failed focus, a quit app, secure and noneditable destinations; all 793 Swift tests pass. The earlier TextEdit live check predates these review corrections; it is not evidence for the new failure/cancellation paths. No real app insertion, provider request or running-app replacement was performed during autofix.

Autofix verification: final release compilation passes, an isolated ad-hoc gallery bundle passes strict signature verification, and all 114 gallery scenes/43 visual comparisons pass at the unchanged 1% threshold. The running app was neither quit nor replaced. An initial default-build-system attempt ran out of disk; only this task’s failed/completed intermediate builds were removed before a successful native-build-system retry. Existing compiler/build-system warnings remain.
