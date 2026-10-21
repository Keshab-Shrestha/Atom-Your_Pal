# Requested T3 interaction upgrades

Saved 2026-10-19 from Keshab’s four screenshots and explicit request. These are functional upgrades, in addition to the desktop styling in ADR-175/176. Keshab chose **Full access as a separate upgrade**. Adding that mode to the plan does not change any current chat’s permissions.

## Delivery order

| Step | Requested behavior | State |
| --- | --- | --- |
| 1 | Searchable provider/model picker, provider rail and starred models | Built and live checked locally (ADR-178) |
| 2 | Thinking/reasoning selector alongside the model | Built and live checked (ADR-179; [evidence](chat-thinking.md)) |
| 3 | Access selector with effective checked modes | Built and live checked locally (ADR-180; [evidence](chat-access.md)) |
| 4 | Full access mode | Requested as a separate upgrade |
| 5 | Multi-surface right pane and resizing | Requested |
| 6 | Searchable project filter and project settings entry | Requested |
| 7 | New project / folder / repository source palette | Requested |

Each step needs real model/runtime/project behavior behind its controls. Existing desktop features, chat memory, stored grants and unsent drafts must survive the changes.

## 1. Provider/model picker (ADR-178)

Replace the native menu with a searchable popover: all providers, provider filters, favorites, current selection, unavailable providers, custom model IDs and app/project inheritance. Use the host’s actual catalog and existing validated `chat.model` operation. Favorites are provider-scoped local bookmarks (128 maximum), not a model selection or an access grant. Selection applies to the next turn in the current chat, without sending the draft. A stale open picker cannot target another chat. Failed settings changes remain visible above the composer.

Acceptance: search by provider/name/ID, favorite isolation and persistence, empty results, unavailable-provider refusal, custom IDs, keyboard navigation/Return/Escape, model selection round-trip and draft retention. Restore the original model and test bookmarks after the live check.

## 2. Thinking / reasoning

Delivered in ADR-179: [behavior, metadata and verification](chat-thinking.md). The following records the acceptance scope. The original baseline had Claude thinking disabled and Codex Low, without a per-chat setting. Add persisted per-chat preference and supported-level metadata through the protocol and gateway, then expose the selector. Model/provider-specific capabilities must drive the offered levels. Changing effort must retain conversation/replay and grants, affect the next turn, and never change an in-flight request. Unsupported models/providers must explain the limitation instead of showing a working-looking control. Validate the actual SDK/protocol arguments and session-reuse behavior.

## 3–4. Access modes and Full access

Delivered checked modes in ADR-180: Saved permissions, Chat only and Ask before changes, persisted by chat and enforced for Claude/Codex at deterministic host admission. Restricted Gemini CLI turns refuse before launch. Existing exact-file grants survive changes but cannot bypass a fresh approval. Current project association, stored file-grant count and effective host/computer/web availability remain available in Chat access. [Behavior and verification](chat-access.md).

Full access is a separate requested capability: define exactly which approvals it skips and which scope it grants before implementing it. Its label must match effective host/provider behavior. Do not silently activate it in existing chats or reinterpret remembered exact-file grants as unrestricted access. Keep the model separate from the authoritative permission state.

## 5. Right pane

Adopt the screenshot’s surface chooser and pane controls: Browser, Terminal, Files, Diff, pull requests, linked pull requests and Device. Begin with existing Files/Changes/Git review and a resizable pane that stays beside chat at practical desktop widths. Preserve close/reopen/tab state and keyboard access. Browser, terminal, device and PR surfaces need their own real integrations; a surface is advertised as usable only when implemented. Keep file previews literal and existing read/Undo/Git policy checks intact. Do not turn a terminal panel into an implicit bypass of ATOM’s tool policy.

## 6. Project filter and settings

Searchable All projects / one-project picker next to sidebar search, with a settings action per project. Filtering should alter the visible chat list without moving, deleting, archiving or switching the current chat. Preserve selection across refresh/restart where appropriate; show empty results clearly. Project settings should expose actual existing name/folder/default-model/web behavior and its scope.

## 7. Project source palette

A searchable keyboard-operated source chooser with New project, Local folder, Git URL and GitHub repository. Local folder wraps the current checked folder-registration flow. New project creates a reviewed destination and initializes the repository; Git URL/GitHub import needs bounded host-controlled cloning, destination/conflict/error handling and proper credential handling. Azure DevOps and Bitbucket repository browsing are later integration options; setup status must reflect real support. No fake successful import, automatic file grant or unchecked shell interpolation.

## Evidence and boundaries

Reference: the four user-supplied T3 screenshots (model rail/composer controls, right-pane chooser, project filter and project sources), plus the pinned T3 source documented in [visual reference](../reference/t3code-visual-design.md). Model picker delivery evidence is recorded below. Thinking is implemented separately in ADR-179; step 3 is delivered separately in ADR-180; steps 4–7 remain requested.


## Model picker verification

- 751 Swift tests / 138 suites pass, including six new catalog/favorites tests for provider-scoped identity, duplicate catalogs, search intersections, unavailable rows, active custom-model inclusion, persistence/removal and bounds (`/tmp/atom-model-picker-tests-verified.log`).
- Live picker shows the real Claude/Codex/Gemini catalogs and exact current Haiku 5.5 choice. Provider filtering, AX search/no-match/clear, favoriting, favorites filtering and invalid custom-ID refusal passed. The test favorite survived quitting/rebuilding/reopening and was then removed; the favorites view returned to its empty state.
- Live selection changed the existing fictional Juniper chat to GPT-6 Luna while retaining exactly `Cedar picker check — unsent.`. Restored Haiku 5.5 and cleared only that test draft. Default inheritance changed to the app’s GPT-6 Luna and the original Haiku override was restored again. No prompt was sent or provider completion requested. Original chat, theme, grants and sidebar arrangement are retained; app Ready.
- A live first-selection failure exposed separate popover state arriving out of step with the captured chat. Replaced separate state fields with one item-bound presentation; the corrected model round-trip passed. The capture still guards against stale cross-chat actions.
- Automated key injection activated the main window and dismissed the native popover; physical arrow/Return text-input acceptance is not certified. AX search/click selection was verified, and Escape closed the popover. Custom model availability beyond syntactic validation is still checked by the provider when sent, as before.
- Final signed release build passes (`/tmp/atom-model-picker-build-final.log`). All 89 gallery scenes and 21 visual comparisons pass on a separate render (`/tmp/atom-model-picker-gallery-verified.log`). Reviewed and added only the two new model-picker references; existing references remain unchanged by this picker. The renderer uses the app’s existing static Scrollable path for snapshots; live rows remain lazy. Reopened the final app and confirmed original Juniper chat / Haiku 5.5 / empty composer / Ready.

No backend/schema/protocol, reasoning/permission setting or source-import behavior changed in this batch. The earlier ADR-177 preview clarification is included in the same publication on main; unrelated `graphify-out/` remains untouched. The prior published baseline is 9d99578. Steps 4–7 above remain requested and unimplemented; ADR-179 delivers thinking and ADR-180 delivers checked access modes.
