# Project filter and settings

ADR-183, 2026-10-21. Adds the requested searchable All projects / one-project picker next to sidebar search and a settings entry for each real project.

## Lists and selection

The filter button opens a keyboard-operated picker: search names, folder labels and missing/archived status; Up/Down selects a row, Return applies it and Escape closes. Each project has a separate gear button. All projects and the sidebar’s clear button restore the normal list.

Selection changes only sidebar visibility. It never opens, moves, deletes, archives or changes the project of a chat, sends its draft, changes its model or grants permission. The selected project scopes the unified Chats list. Plain chats disappear from the filtered list; archived chats respect the selected project. An explicit archived-project selection remains visible with its Archived label. The current chat remains usable even when outside the filter, with a short explanation beneath search. Global search continues across all content and says so while a filter is active. ADR-184 replaces the project tree and repeated plus buttons with one top New chat: it creates a chat in the selected project, or a plain chat under All projects.

UserDefaults stores the project ID, not its display name. Renaming and refresh retain the scope; removal/authoritative empty catalog returns to All projects. An unloaded/older runtime catalog preserves the stored preference but does not activate it or hide plain chats. No project catalog or folder path is persisted for this filter.

## Settings

Open the gear in the Projects picker or its named accessibility action. Opening settings does not change the filter or current chat. The sheet reads the latest project by ID; removal shows an unavailable message and disables mutations.

- Name uses an explicit Save name action and the existing validated `project.rename` command.
- Folder shows the actual registered label and missing-folder state. Show in Finder uses the existing checked project-root resolver. Folder registration/permission is not editable here.
- Default model offers Use app default and real provider catalog entries. Unavailable providers are disabled; a saved custom choice is still displayed. Each selection uses the existing validated `project.model` command. It affects inheritance, while per-chat overrides and in-flight replies retain their existing semantics.
- Allow web search reflects and writes the existing `project.web` setting. It does not override access modes, tool policy or approvals.

Each setting waits for the runtime’s existing project-list/error response and shows saving/refusal feedback. Settings changes are disabled while pending, while ATOM is busy/unavailable, or for an archived project. ADR-184 moves existing archive/unarchive and confirmed remove/keep-or-delete-chat controls into this sheet after removing permanent project rows. The host operations retain their existing checks. Folder access remains display/reveal only. No provider call is needed to change a setting.

## Verification

Full Swift suite passes 767 tests / 143 suites (`/tmp/atom-project-filter-swift-final.log`), including search, project-ID persistence, rename/removal/archive behavior and scoped chat visibility. Existing project command/protocol tests remain in the suite. All 134 targeted project/host tests pass (`/tmp/atom-project-filter-host-tests.log`). Final signed build and strict signature verification pass (`/tmp/atom-project-filter-build-final.log`). A separate render passes all 97 scenes / 29 visual comparisons (`/tmp/atom-project-filter-gallery-verified.log`); four new references were reviewed, with existing references unchanged. Live final-build checks passed after the user opened the main window: Cedar selection scopes the list while the original movie chat stays current, outside-filter feedback appears, picker search/no-match/All projects work, gear and named accessibility actions open settings, empty names refuse, and name/model changes return through the runtime. Renaming Cedar twice retains the same selected project ID. Global search for the original movie still finds its chat while Cedar is selected. An unsent fictional draft remains in the original chat throughout. Restored Cedar’s exact original name, Use app default model, web off, All projects, collapsed project rows, empty search/draft and the original movie chat with Haiku 5.5 / Off / Saved permissions / closed workspace / Ready. Folder grants and the separate notebook chat’s confirmed Full access choice were untouched. No message or provider completion was sent.

Live limits: activating/clicking into the native popover through automation dismissed it and routed two search suffixes into the fictional composer draft; nothing was sent. AX value-setting then verified the actual search/no-match state and ordinary row/gear actions worked. The test suffixes/draft were fully cleared. Physical keyboard-only acceptance and live restart persistence were not checked; the settings round-trip covers stored selection. Archived/missing/deleted-project behavior has core/rendered coverage; live tests did not archive/delete projects or broaden web access. The preceding Full access/workspace batch was published as `43ad83d` before implementation began; this capability remains local until separately published.
