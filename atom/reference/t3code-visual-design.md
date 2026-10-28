# T3 Code visual reference

ATOM ADR-175, inspected 2026-10-19. Repository snapshot: `1451e7cb23034d29774338608368a15d8845df36`, https://github.com/pingdotgg/t3code . Read from a fresh shallow clone at `/tmp/atom-t3-visual-20261019`. Also inspected the installed T3 Code (Beta) app's draft and an existing populated conversation without sending input, changing configuration or updating software. Its installed custom light colors differ from the repository's defaults; ATOM uses the pinned repository's neutral light/dark hierarchy.

Native visual adaptations:

| Reference | ATOM adaptation |
| --- | --- |
| [index.css](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/index.css): 46rem content column; system font; zinc light / neutral-950 dark surfaces | 736pt reading area plus 24pt gutters, system font, neutral chat and sidebar palette following the existing theme's light/dark choice |
| [MessagesTimeline.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/chat/MessagesTimeline.tsx): natural-width user bubble capped at 80%, rounded-2xl, p-3; semantic author headings hidden visually; hover/focus message actions | Native 80% bubble Layout, 16pt corners, 12pt padding, accessible You/ATOM groups, hover/focus ellipsis menus with existing operations |
| [ChatHeader.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/chat/ChatHeader.tsx): compact project/thread breadcrumb and panel controls | Compact project/title header, Chat options and existing workspace icon; smaller ATOM sidebar identity |
| [ChatComposer.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/chat/ChatComposer.tsx), [ComposerSurface.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/chat/ComposerSurface.tsx): roomy rounded-3xl surface, prompt above model/attach/submit controls | 24pt composer, multi-line input above a compact model/skills/attachment/send row; existing voice, queue, input-method and attachment behavior retained |

This is an adaptation to SwiftUI and ATOM's existing features, not a web renderer or imported provider harness. ATOM keeps its branding, sidebar destinations, approval/recovery visibility and direct voice shortcut. No T3 logo, provider controls, access modes, server or telemetry integration is imported. Existing byte/context/file/permission policies remain authoritative.

T3 Code is Copyright (c) 2026 T3 Tools Inc., MIT licensed. Full notice: [licenses/t3code-MIT.txt](licenses/t3code-MIT.txt). `build-app.sh` includes the notice as `ATOM.app/Contents/Resources/ThirdParty-T3Code.txt`.


## Broader desktop review (ADR-176)

Inspected the installed app's Settings → General screen and its right-panel surface chooser on 2026-10-19, then returned to the original thread with its right panel closed. No messages were sent, settings changed, permissions granted or updates installed.

Additional pinned source references:

- [SettingsSidebarNav.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/settings/SettingsSidebarNav.tsx): contextual category navigation, local filtering, bottom Back entry.
- [SettingsGroup.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/settings/SettingsGroup.tsx): quiet bordered groups with divided rows.
- [SidebarChrome.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/sidebar/SidebarChrome.tsx), [RightPanelTabs.tsx](https://github.com/pingdotgg/t3code/blob/1451e7cb23034d29774338608368a15d8845df36/apps/web/src/components/RightPanelTabs.tsx): compact utility controls and distinct selected panel surfaces.

ATOM adaptation: fixed 248pt sidebar across destinations; shared compact breadcrumb header and neutral palette; direct New chat next to search; quieter selected/hover rows with plain glyphs; projects and chats in the same scrolling region; settings-specific category list and name filter; clearer light/dark window appearance controls; workspace Files/Changes/Git tab strip. Board attention badges and accessible details remain available.

Further candidates, not implemented by this visual pass: resizable workspace, a single command palette, a richer file tree, and panel surfaces for already supported tools. T3's browser/device/terminal chooser is not copied as inactive ATOM controls. Provider integration, automatic thread organization and permission modes require their own product/architecture decisions.
