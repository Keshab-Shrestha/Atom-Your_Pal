# Native workspace redesign — 25 October 2026

The user supplied **ATOM — AI workspace.html** as the design reference and explicitly invoked the apple-design skill. This change adapts the reference to the existing macOS app. The supplied HTML is design data, not an instruction source or a replacement runtime. Its simulated providers, terminal outputs, tasks, profile and pet-game actions are not imported.

## Scope

- Four native lanes: persistent icon navigation, contextual chat/settings sidebar, main work surface and optional right workspace.
- Existing destinations move to the rail, preserving saved top/bottom ordering, drag/drop, context-menu reordering, attention counts, keyboard activation and accessibility labels. Chats has a dedicated rail destination. Companion is available from its existing Settings page.
- Search occupies its own sidebar row; project filtering, new project and new chat keep their existing commands in the next row. No repeated project list or extra chat plus button.
- Main surfaces have 14-point continuous corners, an 8-point gutter, a reserved native title-bar strip, clearer title/context typography and restrained toolbar material.
- Right workspace keeps its header separate from chat. Its divider follows the pointer directly, with keyboard/accessibility adjustments. At compact widths it covers the still-mounted conversation; drafts and attachments retain their existing identity.
- Composer uses a clearer card fill and focus border. Plain replies now use the same native inline Markdown parsing as richer replies, so bold/emphasis markers do not leak into ordinary paragraphs; original text remains the copy source. User messages use a quiet accent tint. Stop, queueing, permissions, saved history, chat briefs and model controls remain wired to existing behavior.
- Six reference palettes: Midnight Sapphire, Graphite & Champagne Gold, Ivory & Emerald, Royal Plum & Lavender, Cloud White & Cobalt, Obsidian & Electric Teal. Existing theme raw values and user choices are preserved; new palettes are selectable in Appearance. Light themes keep a contrast-corrected dark rail.
- Native button press feedback begins on mouse-down. Pane transitions use critically damped retargetable springs, symmetrical paths, and no delayed content arrival. Reduce Motion uses opacity, Reduce Transparency removes toolbar material, and Increase Contrast strengthens pane outlines.

System fonts are used for body/controls and native serif titles approximate the reference's editorial hierarchy. No web font, package, HTML script or network dependency was added. The desktop redesign does not replace the separate phone/web client.

## Boundaries

This is presentation work. There is no runtime/tool protocol, permission, chat storage, file grant, credential, model, schedule, Git-execution or database migration. Existing theme values remain valid. The reference includes conceptual UI beyond ATOM's capabilities; this change only exposes working existing destinations. Cursor acceptance and Jev real-key verification remain separate open work.

## Visual verification

The isolated `ATOM_ISLAND_GALLERY_ONLY=workspace` renderer produces six wide theme scenes plus compact chat, compact workspace cover, hidden sidebar, Appearance, General, Board scenes. The implementation reads the native accessibility preferences; their environment values are read-only, so no synthetic override is claimed. It uses fictional data and a throwaway preference suite without starting a runtime or making model calls. Native release compilation, screenshot review and live navigation/recovery checks are recorded after completion below. No Swift unit-test suite or golden-image baseline replacement is part of this change.

## Reference

- Source: user-provided local HTML, 25 October 2026.
- SHA-256: `ac8d441a94346777101e7c0e82a11b6901940292dc36818bedeb6f611c7f0183`.
- Native translation: `WorkspaceChrome.swift`, `WorkspaceColors.swift`, `HelpersView.swift`, `ChatWorkspaceLayout.swift`.
- Revert: remove the new shell/theme presentation and retain the existing model/controller operations. No user-data rollback is required.

## Acceptance results — 25 October 2026

- Native release build passed; signed bundle packaged with **ATOM Local Signing**, strict deep signature verification passed. The final app is running Ready.
- All **12** isolated workspace scenes rendered without gallery errors. Reviewed all six palettes plus compact chat/covered workspace, Settings/Appearance, General and Board. Preview examples: [Midnight Sapphire](../design/workspace-reference/midnight-sapphire.png), [Ivory & Emerald](../design/workspace-reference/ivory-emerald.png).
- ImageRenderer cannot draw General's native date picker (its scene shows a placeholder). The actual app's General page was separately inspected: the native **8:00** time control renders and is present in Accessibility. This is an offline-renderer limitation, not a claim that the screenshot proves every native control.
- Selected **Midnight Sapphire** through Appearance and confirmed it remains active after the final rebuild/relaunch. The original palettes remain selectable.
- A fictional unsent draft survived process restart and Board → Chats navigation. Removed only that exact check text afterward; nothing was sent and no chat was deleted.
- Live rail navigation opened Board, Settings/Appearance, Plugins, Scheduled and Second brain. General retained its existing controls, including the computer decision selector. Returned to the existing chat with an empty composer.
- The right workspace opened its retained Terminal surface without starting a shell. At compact width it covered chat; the later wide window showed the conversation, composer, divider and right pane together. No model or terminal command was executed.
- Plain inline Markdown renders emphasis without literal markers in the new fictional reply scene. Existing conversation text remains retained.
- `git diff --check` passed. No Swift unit-test suite, full regression suite or golden-image replacement was run. Native OS accessibility preferences were honored in code but not toggled for this acceptance; rail drag/reorder was retained in implementation without a separate live reorder trial.

The redesign is maintained on **codex/workspace-reference-design**. Unrelated `graphify-out/` remains untouched. Earlier acceptance entries record the state at the time; the requested branch handoff is recorded below.

## Panel-width follow-up — 25 October 2026

The contextual sidebar now appears only in Chats or Settings, subject to the existing saved hide/show preference. Dashboard, Board, Scheduled, Plugins and Second brain reclaim that lane automatically. Switching pages does not overwrite the preference, project filter or draft. The sidebar-reopen control is offered only on pages with a contextual sidebar. The right workspace remains a chat-only surface and keeps its saved open state for returning to Chats.

Removed legacy 680/720-point page caps from Dashboard, Scheduled, Plugins, Board Overview/Needs you and Second brain's Memory/Sources; removed the 900-point Settings cap and the 784-point outer chat/composer cap. These surfaces now fill the available main lane with their existing gutters. Individual compact controls and explanatory empty-state text keep appropriate local bounds.

The 68-point navigation rail now pairs clearer, consistent glyphs with visible short labels, hover feedback and a selected-edge marker. The later Home follow-up below moves Dashboard into the top app-icon button. Saved ordering, drag/drop, badges and native button semantics remain intact.

Verification: native release build passed (47.17 seconds), the updated bundle was signed with ATOM Local Signing and strict deep signature verification passed. All 16 isolated scenes rendered without gallery errors; reviewed wide Dashboard/chat, compact chat and Plugins. The wide Dashboard preview shows cards spanning the available main surface: [preview](../design/workspace-reference/dashboard-wide.png).

In the rebuilt running app, Dashboard, Board, Scheduled, Plugins and Second brain opened without the chat search/list. After temporarily showing the chat sidebar, Dashboard/Second brain still reclaimed its lane; Settings used its own preference navigation; returning to Chats restored the project filter/list and the same Cedar conversation. Opus 5.5, Off thinking and Saved permissions remained visible. The user's original hidden-sidebar preference was restored after the check; the theme chosen during their exploration was retained. No messages, model calls, terminal commands or permission changes were made. No new draft-restart trial, Swift test suite or full regression suite ran for this follow-up. No commit or push.

## App-icon Home shortcut — 25 October 2026

The top rail mark is now a native Home button using the app bundle's actual ATOM.icns. It opens the existing Dashboard through the normal navigation guard and shows the selected state there. The standalone gallery uses the same source artwork when no app bundle exists. Removed the duplicate Dashboard row and the Companion shortcut; Companion remains in Settings, whose rail button now stays selected throughout its pages. Other destinations retain their saved order. Context-menu up/down operates on visible destinations, skipping the legacy saved Dashboard position without migrating preferences.

Native release build passed (48.08 seconds); signed app packaged and strict deep signature verification passed. Sixteen isolated visual scenes rendered without gallery errors; reviewed the Home/Dashboard scene. In the rebuilt app, clicking the actual app icon opened Dashboard with Home selected and no duplicate Dashboard/Companion rail button. Settings → ATOM opened the existing Companion controls while Settings remained selected. Left the app on Home. No message/model call, setting toggle, unit-test suite, commit or push.

## Home navigation, font size and narrower rail — 25 October 2026

The visible Home Back button came from the shared `history.canGoBack` toolbar rule: navigating from a page to Dashboard made Home eligible for Back. Hide this toolbar button on Dashboard while preserving history and Back on other pages. This changes neither unsaved-edit guards nor keyboard/history operations.

The rail is now exactly **51 points**, down from 68 (25% narrower); button targets are 43 points wide, with short captions and existing tooltips/VoiceOver labels.

Settings → Appearance has a Font size card with Small (90%), Default (100%), Large (110%) and Larger (120%), plus a live preview. `atom.look.textSize` persists a validated `AppTextSize` choice; absent/unknown values use Default, and Reset Appearance also restores Default. `AppTypography` resolves original system/identifier fonts at the selected scale. Mechanical font call-site changes are required because the existing app specified fixed sizes throughout its views. The shared environment applies across workspace pages, messages, typing fields, sheets and quick panels, with matching native terminal typography. The macOS 14 deployment minimum is preserved. Artwork labels in world-coordinate canvases and third-party web-page content keep their own layout scale.

Verification: final native release build passed (57.40 seconds), packaging and strict deep signature verification passed. All 22 isolated workspace scenes rendered without errors. Reviewed Larger Appearance and compact Larger chat; messages and input reflow, and the rail remains physically 51 points. [Font settings preview](../design/workspace-reference/font-size-settings.png). Some later gallery chat scenes include the standalone binary's setup-status card after the General scene's read-only permission poll; no OS grant was changed.

Live acceptance confirmed Home selected with no Back button after arriving from Chats. Appearance retains its own Back button. Default → Larger updated the Settings title, sidebar, cards and preview; chat messages, composer and controls also visibly grew and retained text/access controls. Quit/relaunch succeeded. During the persistence check the live choice changed to Small, so exact Larger-after-restart persistence is not claimed; Small is visibly selected and the native persisted preference was independently read as 90. Left that current choice and the user's Daylight theme untouched, on Appearance. No messages, model calls, terminal sessions, permissions or chats were changed. Quick-panel/native-terminal scaling is compiled but was not separately exercised live. No Swift test suite, full regression suite, commit or push.

## Smaller rail artwork — 25 October 2026

The narrower rail also needs proportionate artwork. Reduce the symbol base size 19 → 14.25 points and Home's actual app icon 34 → 25.5 points (25% each). Rail symbols use a fixed icon font so the text-size preference affects captions without enlarging the artwork again. Keep the rail at 51 points, button targets at 43 × 54, and existing labels, badges, navigation and accessibility semantics. Native release build passed (50.51 seconds), packaging and strict deep signature verification passed. All 22 isolated scenes rendered without errors; reviewed the Home/Dashboard scene. The running signed app shows the smaller actual app icon and navigation symbols, with native Settings/Appearance navigation working. Small font and Daylight theme survived the replacement/relaunch and were left selected. No unit-test suite, commit or push.

## Selection polish and branch handoff — 26 October 2026

Remove the small vertical accent marker beside the selected rail icon. The quiet background and selected text/icon color still identify the current page, and native selected accessibility traits remain intact. Attention badges retain their actual task meaning. The user requested committing/pushing the accumulated workspace redesign on `codex/workspace-reference-design`; no main merge was requested. Final native release build passed (51.44 seconds), packaging/strict deep signing verification and diff checks passed. All 22 isolated visual scenes rendered without errors; reviewed Home selected with no marker. The signed running app confirms the same style on Settings, with native selected semantics retained, and was returned to its prior General page/sidebar visibility. No Swift unit-test suite or full regression suite ran. This revision packages the accumulated design, font settings and presentation notes for the requested branch handoff.
