# Desktop design adapted from T3 Code

ADR-176, 2026-10-19. Keshab authorized a broader T3-inspired design and replacement of the current appearance. This extends ADR-175's chat design across the main desktop window.

The app uses one neutral light/dark palette, a 248pt sidebar and compact title bar on every destination. Search and New chat share the top utility row. Projects and chats scroll together; the bottom app destinations stay fixed. Navigation uses plain glyphs, quiet selected/hover fills and one-line rows. Board attention counts remain visible, with detailed counts in help and accessibility text. Chat deletion is available through hover, the context menu and a named accessibility action, and still requires confirmation.

Settings replaces the app sidebar with Preferences, Companion and Explore categories, an Overview entry, a local category-name filter and Back to chats. Command-F focuses that filter, including when the sidebar was hidden. Settings controls retain their bindings and reset behavior. The main header shows Settings / page, so the old repeated page title is removed. Rows use more breathing room. Appearance offers direct Light/Dark controls using existing Daylight/Void preferences, and explains how companion themes determine the shared window's light/dark appearance. No new setting or storage migration is introduced.

The workspace keeps the same Files, Changes and Git state/actions behind a quiet tab strip. Existing project admission, file bounds, explicit refresh, read-only Git inspection and confirmed Undo remain authoritative.

Source/attribution: [pinned T3 review](../reference/t3code-visual-design.md). The existing MIT notice remains bundled in the signed app. No new dependency, provider call, file grant or telemetry is added. Floating companion/quick-action surfaces retain their theme system; the desktop's neutral palette follows the current theme's light/dark choice.

## Verification

- 745 Swift tests / 137 suites pass (`/tmp/atom-t3-shell-tests-final.log`).
- Signed release build passes with ATOM Local Signing (`/tmp/atom-t3-shell-build-final.log`). Bundled MIT notice matches the pinned upstream notice byte for byte. Existing IslandSettings/main.swift warnings remain; this pass introduced no new compiler warning.
- 87 gallery scenes render. Reviewed light/dark chat, empty chat, settings, Board attention and workspace/Git images. Updated only nine intentionally changed references and added two settings references. A separate render passes all 19 comparisons, maximum delta 0.238% in the existing animated states sheet (`/tmp/atom-t3-shell-gallery-verified.log`). Native AppKit controls such as the General date picker have an existing ImageRenderer limitation; those General scenes are not golden references.
- Live final app: navigation and settings category names are accessible; Command-F focuses category filtering; matching and empty-result states, category selection and Escape clearing work. Light appearance selects Daylight and redraws the window; the exact original Lantern choice was restored.
- Hidden-sidebar header leaves macOS window-button room; Command-F reveals the sidebar and focuses its settings field. Back to chats restores the current saved chat.
- Existing fictional Cedar project expands and opens; workspace opens and Files/Changes/Git each select and show their existing data. Returned to Files, closed the panel, restored the original Juniper chat and collapsed Cedar. Final app Ready, empty composer, no work/approval dispatched, original theme retained.

Scope limits: this does not certify every settings value or native shortcut/VoiceOver input combination. Existing backend tests were not rerun because no backend/protocol/policy source changed. No provider request or project-file mutation was used for these checks. `git diff --check` passes. Work is local on main alongside ADR-174/175, uncommitted/unpushed; unrelated `graphify-out/` is untouched.
