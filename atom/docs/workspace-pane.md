# Resizable chat workspace

ADR-182, 2026-10-21. The next T3 interaction upgrade adds a native surface chooser and an adjustable right pane over the existing checked project workspace.

## Behavior

- The chat header’s right-pane button opens/closes Workspace, including in a plain chat. The initial view offers **Files**, **Changes** and **Git**. A plain, shared, archived or unavailable project chat explains that an active local project is required; its surfaces are disabled.
- The grid button returns to the chooser. Surface tabs keep their last preview, directory/filter, checkpoint selection, source-view choice and Git whitespace choice while the same chat/project remains active. Closing/reopening retains that place. These are snapshots; Refresh rereads the current state.
- Drag the divider to resize. Focus it and use Left/Right (40 pixels), use VoiceOver adjustment, or use its context menu. Width is bounded to 300–720 pixels. The layout reserves at least 340 pixels for chat and a nine-pixel divider. A 920-pixel window with the sidebar shown can keep both panes visible. Temporary clamping when resizing the window or opening the sidebar does not overwrite the saved preferred width.
- Below 649 pixels of main content, the workspace covers chat until closed. The conversation stays mounted, with its editor hidden from input and accessibility while covered. Composer controls use two rows when the narrower chat cannot hold one row.
- **View → Open/Close Workspace** uses Option–Command–R. **View → Workspace: Files / Changes / Git** uses Option–Command–1 / 2 / 3. These commands apply only to the key chat window, outside sheets and shortcut recording; surface commands require an available project. Closing does not send a draft.
- Only preferred width and the chosen surface name persist across app restarts. Previews, file paths, filters, review tokens and checkpoint selections remain memory-only, clear when chat/project/root/read-only identity changes or the runtime stops, and must be fetched again after restart. Pane visibility starts closed.

## Boundaries

Existing folder/path/link/resource checks, literal UTF-8 previews, exact request matching, read-only Git argv, checkpoint review and explicit Undo confirmation remain authoritative. Switching surfaces invalidates pending read tracking so a late reply cannot populate another surface. Switching is disabled during an in-flight Undo. Starting Undo invalidates other cached previews; timeout still reports uncertainty and requires Refresh. Closing during Undo preserves its request tracking; reopening handles the receipt before loading changes.

No new protocol operation, file permission, terminal or agent action is introduced. ADR-185 adds a separate user-operated Browser surface, available beside plain chats too; it has no worker-browser/model bridge. Terminal, PR, linked PR and Device surfaces remain separate integrations. [Browser scope](workspace-browser.md). See [Files/Changes](project-workspace.md) and [Git](git-workspace.md) for their existing limits.

## Verification

- Full Swift suite: **763 tests / 142 suites pass** (`/tmp/atom-pane-swift-final.log`), including layout bounds, corrupt settings, preference round-trip, retained places, scope clearing, late reads and in-flight/uncertain Undo behavior.
- Final signed release build and `codesign --verify --deep --strict` pass (`/tmp/atom-pane-build-final.log`). A separate gallery render passes **93 scenes / all 25 comparisons** (`/tmp/atom-pane-gallery-verified.log`). Reviewed only the changed Files/Changes and Git references; added chooser, split and compact references. The header uses the existing snapshot-safe button style.
- Live final build: plain-chat chooser refuses unavailable surfaces; fictional Cedar project Files listing/literal preview, Changes and Git diff/source tabs work. Dragging changed pane width from 378 to 318 pixels; focused Left changed it to 358. Native View → Workspace: Changes works. Context-menu Reset stores the default preference: hiding the sidebar shows 420 pixels and restoring it clamps to 378 without losing that preference.
- Files preview, Git Before source choice, folder filter and exact fictional unsent draft survive surface changes and close/reopen. Switching to the original plain chat clears project previews; reopening the project fetches its state again. No message, file change, Git mutation or Undo was dispatched by these checks.
- Cleared only the test draft/filter; reset pane preference to 420 and chooser to its initial state. Restored collapsed projects/sidebar, original movie chat and its latest user-authored messages, Haiku 5.5 / Off / Saved permissions, empty composer, closed workspace and Ready state. The earlier confirmed Full access choice on the separate notebook chat remains untouched.

Limits: compact layout is verified by deterministic geometry and rendered scenes; native window-edge drags did not resize the live window. Preference restart persistence is covered by the settings round-trip, not another live restart. The key-window View menu and focused divider key were checked live; global shortcut injection was not used. The app still launches in the background; the user opened the main window using the menu-bar icon’s second **Open ATOM…** item. TypeScript runtime code is unchanged by this capability; its full suite was already verified for ADR-181 and was not rerun for this native-only batch.
