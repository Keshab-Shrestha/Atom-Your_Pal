# T3 Code: right panel, devices, connections and shell

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

Source: https://github.com/pingdotgg/t3code (MIT licence), shallow clone at commit `2fbd4318` (2026-10-17).
All paths below are relative to that clone unless a path starts with `apps/mac` or names an ATOM file.
A claim marked "unverified" was not confirmed in the code. "Not found" means the search gave no result.

## Summary

- The right panel is a tab strip. Surfaces: Browser, Terminal, Files, Diff, Pull request, Linked pull requests, Device.
- The "Devices" tab shows an iOS Simulator or Android Emulator. Paired clients are listed in Settings → Connections.
- "Open in ..." starts an editor from a fixed list of ids. It uses no shell.
- A second device pairs with a one-time link or QR code. Tunnels: Tailscale, SSH, T3 Connect (cloud relay).
- A tray icon was not found. ATOM has no right panel and no device list.

---

## 1. The right panel

### 1.1 What it is

- State file: `apps/web/src/rightPanelStore.ts`. Type names: `RightPanelKind`, `RightPanelSurface`, `ThreadRightPanelState`.
- The store keeps one panel state per thread. It saves the state in local storage (`t3code:right-panel-state:v2`, version 14).
- Each thread has `isOpen`, `activeSurfaceId`, a list of `surfaces` and an optional `maximized` flag.
- Tab strip: `apps/web/src/components/RightPanelTabs.tsx` (1426 lines). Body: `apps/web/src/components/chat/RightPanelSurfaceContent.tsx`.
- Surface kinds in the store: `diff`, `files`, `file`, `preview`, `device`, `terminal`, `pull-request`, `pull-requests`.
- Tabs can be dragged to a new order (dnd-kit). A tab has a context menu: Rename, Copy path, Mute tab, Close, Close others, Close to the right, Close all.
- Closed tabs can come back. `apps/web/src/closedViewStore.ts` keeps them. The command `view.reopenClosed` is `mod+shift+t`.

### 1.2 The "+" menu and the empty state

The empty panel and the "+" menu list the same seven actions. Each has a one-letter shortcut. The letter works only when no text field has focus.

| Action | Letter | When it is on |
| --- | --- | --- |
| Browser | B | Desktop app, or an environment with a server browser |
| Terminal | T | A project is open |
| Files | F | A project is open |
| Diff | D | A Git repository |
| Pull request | P | The branch has a pull request |
| Linked pull requests | L | The thread has linked pull requests |
| Device | M | A thread is open |

A disabled action shows a hint in a tooltip (`SURFACE_UNAVAILABLE_HINTS` in `RightPanelTabs.tsx`).

### 1.3 Open, close, resize

- Toggle: `rightPanel.toggle` is `mod+alt+b`. A button with a "panel right" icon in the thread header does the same (`PanelLayoutControls.tsx`).
- New tab: `rightPanel.new` is `mod+t`, only while the panel is open. Close tab: `rightPanel.close` is `mod+w`. Maximize: `rightPanel.toggleMaximized` (no default key found).
- Diff: `diff.toggle` is `mod+d`. Browser: `preview.toggle` is `mod+shift+j`. Terminal drawer: `terminal.toggle` is `mod+j`.
- Thread details panel (a different panel): `threadPanel.toggle` is `mod+shift+b`. It shows a Workspace section and a Version Control section (`ThreadDetailsPanel.tsx`).
- Key defaults are in `packages/shared/src/keybindings.ts` (`DEFAULT_KEYBINDINGS`). The user can change them in Settings → Keybindings.
- Width: the user drags a handle on the left edge (`preview/RightPanelResizeHandle.tsx`, `hooks/useResizableWidth.ts`). The width is saved per thread (`t3code:preview-panel-width:<thread>`).
- Limits in `hooks/usePreviewPanelInlineSize.ts`: minimum 360 px, default 540 px, maximum 70% of the window. The chat column keeps at least 360 px.
- Narrow window: at 980 px or less (`RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY` in `rightPanelLayout.ts`) the panel becomes a sheet that slides in (`RightPanelSheet.tsx`).
- The panel animates when it opens. A setting turns the animation off (`panelAnimations.ts`).
- Proactive panels: `hooks/useProactivePanels.ts` opens the Diff tab when a turn ends with changes. It also opens a linked pull request. A user choice always wins. The setting `proactivePanelsEnabled` is off by default (`packages/contracts/src/settings.ts`).

### 1.4 Files tab

- Files: `apps/web/src/components/files/`. Main parts: `FileBrowserPanel.tsx` (the tree), `FilePreviewPanel.tsx` (the preview), `FileBreadcrumbs.tsx`.
- The tree uses the package `@pierre/trees`. A search field filters it. The field label is "Search files". Esc closes the search.
- A refresh button reloads the list. A toggle expands or collapses all folders (`fileTreeExpansion.ts`).
- The tree can browse a host folder outside the project. Then it does not index the whole folder. Search only filters the folders that are loaded.
- Breadcrumbs move a folder tab up in place. They do not leave one tab per folder (`navigateFolder` in the store).
- Preview kinds: source code, Markdown (rendered or raw), images, audio, video, PDF, HTML (in a frame), and CSV/TSV tables (`filePreviewMode.ts`, `DelimitedTablePreview.tsx`, `BrowserDocumentFrame.tsx`).
- The preview is also an editor (`@pierre/diffs/edit`). It saves with a coordinator (`useFileSaveCoordinator.ts`). Saving needs the scope `filesystem:write`.
- A user can add a comment on a line. The comment goes to the composer as a review comment (`fileCommentAnnotations.ts`, `reviewCommentContext.ts`).
- Mentions: a tree row can be dragged into the composer. The drop makes a file mention (`fileTreeDragMention.ts`, `composerMentionDrag`). The link format is in `packages/shared/src/composerTrigger.ts` (`serializeComposerFileLink`).
- A context menu on a file has: Open, Reveal in Finder/Explorer, and Open with (editors) (`fileContextMenu.ts`).
- File picker: `filePicker.toggle` is `mod+p` (`ProjectFilePicker.tsx`, label "Search files…"). Project search: `projectSearch.toggle` is `mod+shift+f` (`search/ProjectContentSearchDialog.tsx`).
- A file link in a chat message opens the file in the panel at a line (`revealLine`, `fileLineReveal.ts`).

### 1.5 Changes (Diff) tab

- File: `apps/web/src/components/DiffPanel.tsx` (1169 lines). Selection state: `apps/web/src/diffPanelStore.ts`.
- Three sources: one agent turn (a checkpoint diff), the working tree ("unstaged"), and the branch against a base ref (`DiffPanelSelection`).
- A drop-down picks the turn. Turns are newest first. The label is "Latest turn" or "Turn N".
- A file tree on the side lists changed files (`diffs/DiffFileTree.tsx`). The viewer is `@pierre/diffs`.
- There is an "ignore whitespace" option. The view refreshes when the window gets focus.
- `mod+f` inside a diff searches all files, also folded files. This key cannot be changed (`docs/user/keybindings.md`).
- A user can comment on a diff line. The comment goes to the composer.
- A very large diff loads files while the user scrolls. A diff can be marked "truncated".
- Not found in this tab: stage, revert or commit buttons. Git actions are in the thread header (`GitActionsControl.tsx`) and the pull request tab.

### 1.6 Device tab

- Files: `apps/web/src/components/device/DevicePanel.tsx` and the files next to it. Docs: `docs/user/devices.md`, `docs/internals/devices.md`.
- It shows a live iOS Simulator or Android Emulator. The user can tap and type in the stream.
- First use runs a three-step setup: start the device hub, check iOS and Android support, choose whether agents may control devices.
- Controls: Home, Back and Recents (Android), rotate (iOS), power off, a Tools drawer (dark mode, text size, fake location, app permissions), a 3D view, and a floating window.
- Each device has its own tab. A tab can be renamed. Only the visible tab streams video.
- The server runs the devices. The video goes through the environment connection, so it works over LAN, Tailscale and T3 Connect.
- Security notes from `docs/internals/devices.md`:
  - The hub listens on loopback only. A proxy (`apps/server/src/device/DeviceHubProxy.ts`) allows a short list of routes.
  - The proxy checks every request as an environment session. Streams use a short-lived `wsTicket`.
  - Device settings do not go through the hub's shell channel. A typed RPC `device.action` runs `simctl` and `adb` itself.
  - Agents get four tools only: list, open, screenshot, close. A setting "Agent device access" turns them off.
- SSH device hosts let a remote Mac run the simulators (`SshDeviceHost.ts`).
- ATOM fit: low. ATOM has no mobile work to test. Do not copy this tab.

### 1.7 Browser, Terminal and Pull request tabs

- Browser: `apps/web/src/components/preview/PreviewPanel.tsx`. In the desktop app it is an Electron web view (`apps/desktop/src/preview/`). On a remote server it is a headless Chrome that streams (`apps/server/src/preview/ServerBrowser.ts`, `docs/user/remote-access.md`).
- The browser has tabs, zoom (`preview.zoomIn`), a URL field (`mod+l`), element picking, annotations that go to the composer, and a floating mini player or picture-in-picture window.
- The agent can open and drive browser tabs. The user takes control before typing in an agent tab.
- Terminal: `PersistentThreadTerminals.tsx`, server `apps/server/src/terminal/Manager.ts`. History is up to 5,000 lines and 8 MiB per terminal (`docs/user/terminal.md`). Terminals can split.
- Pull request tabs: `components/pullRequest/` (`PullRequestDetailPanel.tsx`). They show one pull request. The exact views on web are unverified (mobile has files, discussion and review screens).

### 1.8 "Open in ..." menu

- UI: `apps/web/src/components/chat/OpenInPicker.tsx`. Inside the Files tab it shows as "Open in <editor>" (`displayMode="panel"`). In the thread header it is a split button.
- The first part opens the preferred editor. The arrow part lists the editors. The preferred editor is saved (`editorPreferences.ts`).
- Shortcut: `editor.openFavorite` is `mod+o` (`OpenInPickerShortcut.ts`).
- Editor list: `EDITORS` in `packages/contracts/src/editor.ts`. It has Cursor, Trae, Kiro, VS Code, VS Code Insiders, VSCodium, Zed, Antigravity, 12 JetBrains products and a file manager (Finder, Explorer or Files).
- Each entry has an `id`, a `label`, a list of command names (for example `code`, `cursor`, `zed`), optional base args and a `launchStyle`: `direct-path`, `goto` or `line-column`.
- Detection: the server checks if the command exists on the PATH (`isCommandAvailable` in `packages/shared/src/shell.ts`, used by `buildAvailableEditors` in `apps/server/src/process/externalLauncher.ts`). The result is cached for 60 seconds.
- A macOS app-bundle fallback (for example `/Applications/Zed.app`) was not found in the code. Editors need a command on the PATH.
- Launch: the RPC `shell.openInEditor` (`WS_METHODS.shellOpenInEditor`). The service is `ExternalLauncher.launchEditor`. It spawns a detached process with `shell: false`.
- Safety:
  - The client sends an editor id, not a command. The server maps the id to a fixed command. An unknown id is an error (`ExternalLauncherUnknownEditorError`).
  - The RPC needs the scope `orchestration:operate` (`apps/server/src/auth/RpcAuthorization.ts`).
  - A missing command gives `ExternalLauncherCommandNotFoundError`. No silent fallback.
  - On Windows, an argument with a control character or a quote is refused when a shell shim is needed (`WINDOWS_SHIM_UNSAFE_ARG_PATTERN`).
- Remote case (`apps/web/src/remoteOpen.ts`): when the environment is not on this machine, the client does not run the editor on the host. It builds an editor URL such as `vscode://vscode-remote/ssh-remote+<host>/<path>` (`buildRemoteOpenUrl`). It opens the URL on the local machine. The menu hints "Opens over SSH. Needs your key on <host>".
- The picker is hidden when no project is open, or when a remote environment has no SSH route (`OpenInPicker.logic.ts`).

---

## 2. Devices and connections

### 2.1 Words

Environment: one T3 server. Route: one way to reach it. Client session: one paired client.

### 2.2 How a second device connects

| Way | How it works | Where to look |
| --- | --- | --- |
| Pairing link | The host makes a one-time link. The other device opens it or scans its QR code. | `ConnectionsSettings.tsx`, `routes/pair.tsx`, `apps/mobile/src/features/connection/pairing.ts` |
| CLI pairing | `t3 serve --host <ip>` binds to a LAN or tailnet address. `t3 pair` makes a link. | `docs/user/remote-access.md`, `apps/server/src/cli/` |
| Tailscale HTTPS | `t3 pair --tailscale` or a setting runs `tailscale serve`. The link uses `https://<name>.<tailnet>.ts.net/`. | `packages/tailscale/src/tailscale.ts` |
| Desktop-managed SSH | The desktop app runs a server on a remote host and forwards a port. | `packages/ssh/src/tunnel.ts`, `apps/desktop/src/ssh/` |
| T3 Connect | The user signs in to a cloud account. A relay and a Cloudflare tunnel give a stable address. No router change. | `docs/internals/t3-connect.md`, `apps/server/src/cloud/`, `infra/relay` |

### 2.3 Pairing link and QR code

- The host binds to loopback by default. "Network access" in Settings → Connections changes the bind to `0.0.0.0` and restarts the app (`apps/desktop/src/backend/DesktopServerExposure.ts`).
- A pairing link is one-time. The default life is 5 minutes (`DEFAULT_ONE_TIME_TOKEN_TTL_MINUTES` in `apps/server/src/auth/PairingGrantStore.ts`).
- The link shows a countdown, a copy button, a QR code (`QRCodeSvg`) and a Revoke button. An endpoint picker chooses which address the link uses.
- No QR code is shown for a loopback address. A phone that scans it would dial itself (`isQrShareableEndpoint` in `ConnectionsSettings.logic.ts`).
- A hosted pairing link keeps the secret in the URL fragment, not in the query. The fragment does not go to the server (`apps/web/src/hostedPairing.ts`, `docs/internals/remote.md`).
- The mobile app has a QR scanner (`ConnectionsNewRouteScreen.tsx`). It builds `https://host#token=...` (`buildPairingUrl`). It also takes a host and a code by hand.
- The server only returns a pairing secret once, when it creates the link. The list of links never shows secrets (`docs/internals/environment-auth.md`).

### 2.4 What the host shows for each device

Settings → Connections → "Authorized clients" (`ConnectedClientListRow` in `ConnectionsSettings.tsx`). Type `AuthClientSession` in `packages/contracts/src/auth.ts`.

- A status dot: green when connected, grey when not. The tooltip says "Connected for 3m" or "Last connected at <time>" or "Not connected yet."
- A name: the client label, else "<OS> · <browser>", else the subject.
- A "This device" tag for the current session.
- A line with device type, OS, browser, IP address and a scope summary.
- A Revoke button per session, and "Revoke others" in the header.
- Revoke needs the scope `access:write`. A host without a UI uses `t3 auth session list` and `t3 auth session revoke <id>`.
- A session with an open connection stays listed after its credential expires.
- Saved environments on the client side show: Connected, Connecting, Reconnecting, Offline, Connection failed, Off (`savedBackendStatus`).
- Last-seen text for saved environments was not found. Only client sessions show a last-connected time.

### 2.5 Auth model

- Doc: `docs/internals/environment-auth.md`. Code: `apps/server/src/auth/`.
- Pairing hands out a set of scopes. Examples: `orchestration:read`, `orchestration:operate`, `terminal:operate`, `filesystem:read`, `filesystem:write`, `access:write`, `relay:write`. A client can ask for fewer scopes. It cannot ask for more.
- `t3 pair --scope <name>` limits the scopes of a link. The default link has all scopes.
- Every RPC names its required scope. A middleware checks it before the handler runs (`RpcAuthorization.ts`, `RpcScopeAuthorization`).
- Session types: browser cookie, bearer token, and DPoP token. DPoP binds a token to a key on the client. A bad proof fails. It does not fall back to bearer.
- WebSocket: a long-lived token never goes in a socket URL. Bearer and DPoP clients get a short-lived ticket over HTTP first.
- The auth policy has four modes: `desktop-managed-local`, `loopback-browser`, `remote-reachable`, `unsafe-no-auth` (`ServerAuthPolicy`).
- Outside agents (Claude Code, ChatGPT) sign in to `/mcp` with OAuth and PKCE. The user grants read-only or a runtime ceiling. These sessions work only on `/mcp` (`McpOAuth.ts`, `docs/user/outside-agents.md`).
- Signed asset URLs are bearer credentials for one file (`AssetAccess.ts`).
- T3 Connect: the relay is a trusted broker. It never sees the environment session token. A one-time credential is bound to the client's DPoP key (`docs/internals/t3-connect.md`).
- The docs say: treat pairing URLs as passwords. Do not put them in screenshots or logs.
- The Tailscale code maps CLI errors to fixed labels. It never logs raw stderr, because stderr can hold auth keys (`TailscaleStderrDiagnostic`).

### 2.6 Remote environments and switching hosts

- Package: `packages/client-runtime/src/connection/` (`driver.ts`, `supervisor.ts`, `registry.ts`). Web, desktop and mobile share it.
- The driver tries the routes in order. It uses the first that works. A direct route is first checked against the public descriptor. A different machine on the same address gets no credential.
- While the client uses a later route, the supervisor checks earlier routes. It moves back when one works. A failed route gets a cooldown.
- The server reports its LAN and tailnet addresses. The client saves them as "learned routes". It reuses the credential of the route it learned them over.
- Retry uses jittered exponential backoff with a five-minute cap. Auth errors wait for a wake-up and do not retry.
- Cached data stays readable offline. It does not look live.
- Switching: the sidebar groups projects by environment (`environmentGrouping`, `ProjectEnvironmentBadge.tsx`). The composer has a host picker (`composer.host`, `mod+shift+h`). Auto balance can pick a machine for a new thread (`LoadBalancingSettings.tsx`).
- The desktop app can run with no local environment ("remote only", `localEnvironmentEnabled`).
- Routes are listed in `EnvironmentRoutesList.tsx`. Drag changes the order.

---

## 3. The desktop shell

Package: `apps/desktop` (Electron). Main process code is in `apps/desktop/src`.

| Area | What T3 Code does | Where |
| --- | --- | --- |
| Menu | Application menu with About, Check for Updates, Settings, File, Edit (Paste as Text), View (reload, zoom, dev tools). A Window menu: unverified. Menu items send an action to the web page. | `window/DesktopApplicationMenu.ts` |
| Tray | Not found. | grep "tray" in `apps/desktop/src` gave no result |
| Updates | A state machine with the states disabled, checking, available, downloading, downloaded, up-to-date, error. Two channels: latest and nightly. Release notes show in the app. | `updates/updateMachine.ts`, `updates/DesktopUpdates.ts`, `updateChannels.ts` |
| Update everything | One button in the sidebar updates providers, then servers, then the desktop app. | `docs/user/updating.md`, `components/ServerUpdateAction.tsx` |
| Resource monitor | A Rust program (`native/resource-monitor/src/main.rs`) samples processes. It samples only while a diagnostics page has a subscriber. History is bounded in age, count and bytes. Electron adds power and app metrics. | `docs/internals/resource-telemetry.md`, `components/settings/ResourceTelemetryDiagnostics.tsx` |
| Deep links | The app handles `open-url`, `open-file` and `second-instance`. It uses them for provider sign-in hand-off, web links and app links. A second launch focuses the first window. | `app/DesktopClerk.ts`, `app/DesktopWebLinks.ts` |
| Control socket | A local socket takes requests for the running app. Requests are limited to 64 KiB and 15 s. Who sends them is unverified. | `app/DesktopAppActivation.ts` |
| Notifications | The page uses web notifications per thread, with sound and in-app toasts. The badge count is set through IPC. The badge clears when the window has focus. | `components/ThreadNotificationCoordinator.tsx`, `ipc/methods/notificationBadge.ts` |
| Window state | Bounds and the maximized flag are saved. A saved position is checked against the current displays. A bad position falls back to defaults. | `window/DesktopWindow.ts`, `settings/DesktopAppSettings.ts` |
| Windows | One main window. Other windows found: a macOS permission helper (`MacPermissionHelper.ts`), a SnapShot transition (`SnapShotTransition.ts`) and one created in `preview/Manager.ts` (purpose unverified; a `preview-pip-preload.ts` exists). A second main window was not found. | `window/DesktopWindow.ts`, `preview/Manager.ts` |
| Quit guard | Hold Cmd+Q for 1.2 s, or press twice within 0.5 s. A setting picks the mode. | `window/QuitHold.ts` |
| SnapShot | A global shortcut captures the active window and its accessibility data. It attaches both to the draft. Off by default. | `snapShot/`, `docs/user/snap-shot.md` |
| SSH, WSL | SSH password prompts show in a dialog. WSL backends run on Windows. | `ssh/DesktopSshPasswordPrompts.ts`, `wsl/` |
| Background service | `t3 service install` runs the server for the user on Linux and macOS. | `docs/user/background-service.md` |

Notes:

- The desktop app bundles the server and can be the host for other devices (`AGENTS.md`).
- The renderer is served by a custom scheme `t3code://` from disk (`electron/ElectronProtocol.ts`). API calls go to the environment URL.

---

## 4. The mobile app

Package: `apps/mobile` (React Native with Expo, native modules, Expo Dev Client). Stack file: `apps/mobile/src/Stack.tsx`.

### 4.1 Screens (route names in `Stack.tsx`)

- Home: the thread list, with filters, a toolbar and swipe rows (`features/home/`).
- Thread: the chat, with a composer, an approval card, a queue (`ThreadQueue`) and an agents view (`ThreadAgents`).
- Thread tools: `ThreadTerminal`, `ThreadFiles`, `ThreadFile`, `ThreadAttachment`, `ThreadReview` and `ThreadReviewComment`, `ThreadDevicePreview`, `ThreadBrowserPreview`, `ThreadMcpApp`.
- Also: Git screens (`GitOverview`, `GitCommit`), pull request screens (`PullRequest*`) and new-task screens (`NewTask*`).
- Settings: `SettingsEnvironments`, `SettingsEnvironmentDetail`, `SettingsEnvironmentNew`, `SettingsNotifications`, `SettingsAppearance`, `SettingsScheduledTasks`, `SettingsDiagnostics`, `SettingsUsage`, `SettingsAuth` and more.

### 4.2 What it can do remotely

- Pair with any T3 server: by QR scan, by link, or by host and code (`features/connection/`).
- Use T3 Connect with a cloud sign-in (`features/cloud/`).
- Start and steer threads. Approve requests. Answer questions.
- Browse files, view diffs, comment on review lines, use the terminal.
- Watch and control a simulator, and watch the agent's browser (`features/devices/`, `features/browser/`).
- Dictate with voice input (`features/voice-input/`).
- Receive shared content from other apps (`features/sharing/`).
- Show widgets, a Live Activity (iOS) and an ongoing notification (Android) (`widgets/`, `features/agent-awareness/`).

### 4.3 Notifications

- Source: `docs/user/mobile-notifications.md`, `docs/operations/android-notifications.md`.
- Alerts say an agent finished, failed, needs approval or asks for input. A tap opens the thread.
- Push needs T3 Connect. A direct or Tailscale connection alone does not give push. The relay sends through APNs/FCM (FCM for Android is documented; the iOS path is unverified).
- The app stays quiet in the foreground. Live activity cards stay up to 15 minutes after the work ends.
- The server side is `apps/server/src/relay/AgentAwarenessRelay.ts`.

---

## 5. Other screen features

- Command palette: `mod+k` (`CommandPalette.tsx`). Groups: actions, projects, recent threads (12), linked threads. A `>` prefix shows actions only. It also opens as a file search and a content search.
- Sidebar: `components/Sidebar.tsx`. Projects with threads. Sections: Pinned, Active, Working (beta), Snoozed, Settled. Drag moves a thread between sections. Undo toast for 5 s. `docs/user/thread-sidebar.md`.
- Thread actions: pin, settle, snooze, archive, regenerate title, link pull request, auto-settle rules.
- Themes: Settings → Appearance, light and dark, imported VS Code themes (`vscodeThemeImport.ts`), a theme editor (`themeEditor.toggle`).
- Onboarding: `components/onboarding/WelcomeWizard.tsx`. Steps: connect computers, check agents, import projects. `docs/user/welcome-wizard.md`.
- Diagnostics: `components/settings/DiagnosticsSettings.tsx` and the resource monitor card. Observability docs in `docs/operations/observability.md`.
- Visual replies: HTML pages from the agent show in the thread in a sandbox (`htmlRender/`, `docs/user/html-renders.md`). MCP apps show in the thread too (`mcpApps/`).
- Keybindings: JSON file with a `when` language (`terminalFocus`, `previewFocus`, `isDesktop`, and others). `docs/user/keybindings.md`.
- In-app browser: see 1.7. It has element picking and annotation that attach to the composer.

---

## 6. Where to look

| Feature | Path |
| --- | --- |
| Right panel state | `apps/web/src/rightPanelStore.ts` |
| Right panel tab strip, "+" menu, shortcuts | `apps/web/src/components/RightPanelTabs.tsx` |
| Right panel body switch | `apps/web/src/components/chat/RightPanelSurfaceContent.tsx` |
| Panel width and limits | `apps/web/src/hooks/usePreviewPanelInlineSize.ts`, `useResizableWidth.ts` |
| Auto-open panels | `apps/web/src/hooks/useProactivePanels.ts` |
| File tree | `apps/web/src/components/files/FileBrowserPanel.tsx` |
| File preview and edit | `apps/web/src/components/files/FilePreviewPanel.tsx` |
| Drag file into composer | `apps/web/src/components/files/fileTreeDragMention.ts` |
| Diff panel | `apps/web/src/components/DiffPanel.tsx`, `diffPanelStore.ts`, `diffs/` |
| Open in menu | `apps/web/src/components/chat/OpenInPicker.tsx`, `OpenInPicker.logic.ts` |
| Editor launch (server) | `apps/server/src/process/externalLauncher.ts` |
| Remote editor links | `apps/web/src/remoteOpen.ts` |
| Device panel | `apps/web/src/components/device/`, `apps/server/src/device/` |
| Connections settings, QR, clients | `apps/web/src/components/settings/ConnectionsSettings.tsx` |
| Auth: pairing, sessions, scopes | `apps/server/src/auth/`, `packages/contracts/src/auth.ts` |
| Connection runtime | `packages/client-runtime/src/connection/` |
| Tailscale | `packages/tailscale/src/tailscale.ts`, `apps/server/src/environment/DirectEndpoints.ts` |
| SSH tunnel | `packages/ssh/src/tunnel.ts`, `apps/desktop/src/ssh/` |
| T3 Connect | `apps/server/src/cloud/`, `infra/relay/`, `docs/internals/t3-connect.md` |
| Desktop menu | `apps/desktop/src/window/DesktopApplicationMenu.ts` |
| Desktop updates | `apps/desktop/src/updates/` |
| Resource monitor | `native/resource-monitor/src/main.rs`, `apps/server/src/resourceTelemetry/` |
| Mobile stack and screens | `apps/mobile/src/Stack.tsx`, `apps/mobile/src/features/` |
| Mobile push | `apps/mobile/src/features/agent-awareness/`, `apps/server/src/relay/AgentAwarenessRelay.ts` |

---

## 7. What ATOM has today, and the gap

### 7.1 What ATOM has

| ATOM part | Facts (verified in the code) |
| --- | --- |
| ATOM window | `apps/mac/island/Sources/AtomIsland/MainWindow.swift`. One `NSWindow`, 920 x 640, minimum 760 x 500. Frame saved as "AtomMain". The window gives ATOM a Dock icon and a small menu while open. |
| Layout | `HelpersView.swift`. Left `HelperSidebar` (224 pt, can hide, ADR-128). Top bar `WindowTopBar`. One main pane chosen by `WindowPage`: dashboard, chat, scheduled, agents, plugins, brain, settings. |
| Sidebar order | `AtomIslandCore/SidebarLayout.swift`. The user can drag pages between a top and a bottom group. |
| Settings pages | `AtomIslandCore/PanelPages.swift` (`SettingsPage`): What can I ask, Appearance, Design system, AI model, Shortcuts, Dictation, ATOM, Sounds, General. |
| Dashboard | `DashboardView.swift`. Token use by day, worker and model. Plan use. Daily brief. Git branches of the team's work (`GitBranchCard`). |
| Git view | `AtomIslandCore/HelpersGit.swift`: `GitBranch`, `GitCommit`, `GitFile`. The Dashboard lets the user push a task branch. |
| Edit review | `EditReviewView.swift` and `TextDiff` (ADR-129, ADR-133). Accept or deny each change. |
| Projects | `ProjectsSection.swift`, `AtomIslandCore/Projects.swift` (ADR-107). A project is a named folder and its chats. A chat shows a `ProjectChip`. |
| "Opens in" | `HelpersView.swift`, `AppPicker`. Each helper has an app that opens its reports. `apps/mac/src/open-in-app.ts` does it: a browser opens web sources as tabs, Notes gets a note, any other app gets a text file. It uses `open -a` with `execFile`, no shell. |
| "@" mentions | ADR-126. A helper, a Second brain page, or a file. |
| Search | ADR-130. One search over chats, tasks, reports, brain pages, facts, projects, agents, skills. Key ⌘F in the window. |
| Local API | `apps/mac/src/api-server.ts` (ADR-098, 120, 121). Node `http`. Listens on `127.0.0.1` only (port 4790). One token in `data/api-token` (32 random bytes, hex, mode 0600). It is off until the user turns on Settings → General → Local API. |
| API safety | Timing-safe token compare. Host check (`127.0.0.1`, `localhost`, one `ATOM_API_HOST` name). Ten wrong tokens lock the API for a minute. "Regenerate" makes a new token and kills all old ones. Body limit 64 KiB. Logs hold no bodies and no token. Plan and retry cards only (`API_ANSWERABLE_KINDS`). |
| Phone page | `apps/mac/src/api-app-page.ts`, route `/app`. Served over `tailscale serve --bg 4790`. The page keeps the token in `localStorage`. How-to: `docs/mobile.md`. |
| MCP server | `apps/mac/src/mcp-serve.ts`. Stdio server, thin client of the Local API. Tools: `atom_give_goal`, `atom_goal_status`, `atom_chat`, `atom_list_tasks`, `atom_task_report`, `atom_needs_you`, `atom_answer_need`. |
| Telegram | `apps/mac/src/telegram-bot.ts`, `docs/telegram.md`. One configured chat. Needs you buttons, tasks, reports. |
| Notifications | `Notifier.swift`. macOS notifications for team notices, approvals (only when ATOM is not in front) and the daily brief. Each kind can be turned off. A click opens the task. |
| Menu | `MainWindow.mainMenu()`: ATOM (Quit), Edit (with Find), View (Hide/Show Sidebar ⌥⌘H), Go (Back ⌘[), Window. The mouse back button goes back (ADR-096). |

### 7.2 The gap

| T3 Code feature | ATOM today |
| --- | --- |
| Right panel with tabs | Not found. The window has no right pane. |
| Files tab (tree, search, preview) | Not found. A file can be added with "@" in the chat box. |
| Changes tab (diff of the work) | Partly. The Dashboard shows team branches. `EditReviewView` shows one proposed edit. No per-chat diff. |
| "Open in editor" for a project folder | Not found. "Opens in" opens reports in an app. A project folder has no "Open in". |
| Devices list (paired clients, last seen, revoke) | Not found. One shared token. Only "Regenerate" revokes, and it revokes every phone. |
| QR pairing, one-time codes | Not found. The user copies the token by hand. |
| Tailscale help | The user runs `tailscale serve` and edits `.env` by hand. |
| Push alerts to the phone | Not found. Telegram covers alerts. |
| Tray icon | The menu-bar item exists. A tray menu with state: unverified. |
| Dock badge for waiting items | Not found (no `dockTile` or `badgeLabel` in `island/Sources`). |
| Resource monitor | Not found. The Dashboard shows tokens, not CPU or memory. |

---

## 8. Ideas for ATOM, ranked

Rules used: minimal change, one capability at a time, no new heavy dependency, least privilege, no secrets in code or logs, local API stays on `127.0.0.1`.
Every idea needs an ADR before code, as the repository rules say.

### Rank 1: A right panel in the ATOM window, with a Changes tab first (size M)

- What: A pane on the right of the main pane. It has a tab strip. The first tab is "Changes" for the open chat's project. It shows the files the agent changed and a diff.
- Why: T3 Code users like to see the work next to the chat. ATOM already has `TextDiff`, `EditReviewView` and `GitFile`. A pane makes them visible at the right time.
- Fit: Good. Pure state goes in `AtomIslandCore` (a `RightPanelState` struct with open, width and tab). Views go in `AtomIsland`. No new dependency. It reads files only inside granted folders (ADR-122).
- First small step: Add `RightPanelState` with open, width (min 320 pt) and the active tab, plus unit tests. Add a toggle button in `WindowTopBar` and a menu item "Show Inspector" with ⌥⌘I (check for clashes first). Show an empty pane. Save open state and width in `IslandSettings`, as ADR-128 does for the sidebar.
- Keep from T3: toggle key, saved width, a minimum width, the main pane keeps a minimum width, a sheet or hide at small window widths (ATOM minimum 760 pt).
- Leave out: tab drag, split terminals, maximize, floating windows.

### Rank 2: "Open in ..." for the project folder (size S)

- What: A split button in the top bar of a project chat. The main part opens the project folder in the preferred app. The arrow lists installed apps. A "Reveal in Finder" item sits in the list.
- Why: This is the most liked small control. ATOM has projects as folders (ADR-107) and already launches apps with `open -a` in `open-in-app.ts`.
- Fit: Good. Use `execFile("/usr/bin/open", ["-a", app, folder])`. No shell. The app name comes from a fixed list in code, like `BROWSERS`. The folder must be a registered project folder and not "missing". Failure shows words, as now.
- First small step: In `open-in-app.ts`, add `EDITORS` (Cursor, Visual Studio Code, Zed, Xcode, Terminal, Finder) and a pure function `openFolderIn(app, folder, deps)` with tests. Detect an installed app by checking `/Applications/<name>.app` and `~/Applications/<name>.app` (T3 checks PATH commands; ATOM is a Mac app, so bundle checks fit better. Unverified on this Mac). Add the menu to `ProjectChip` or the top bar. Remember the last choice in `IslandSettings`.
- Safety from T3 to copy: the client sends an id, the runtime maps it to a command, an unknown id is an error, no silent fallback.

### Rank 3: A paired device list with one token per device (size M, needs a new ADR)

- What: In Settings → General → Local API, show each paired phone: a name, status, last seen and a Revoke button. Each phone gets its own token.
- Why: Today one token serves all phones. A lost phone forces "Regenerate", which cuts every device. ADR-121 listed per-device tokens as "left out on purpose until a second user". A second phone is enough reason to revisit it.
- Fit: Good if scoped. Store only a hash of each token (ATOM already stores a digest in memory). Keep the 10-wrong-tokens lock. Keep ADR-120: plans and retries only. Log the device id, never the token.
- First small step: Change `data/api-token` to a small JSON file of `{id, label, hash, createdAt, lastSeenAt}` with the old single token as the first device. Add `POST /v1/devices/revoke` only in the window (not through the API). Show a read-only list in Settings first. Add revoke second.
- Open risk: Migration of the old file. Test that an old token still works once, then writes the new format.

### Rank 4: Pairing code and QR code for the phone page (size M)

- What: Settings shows a QR code. The phone scans it, opens the phone page, and gets its own device token. The link holds a one-time code in the URL fragment. The code expires in 5 minutes.
- Why: Copying a 64-character token to a phone by hand is slow and error-prone. T3 Code's pairing link is the model: one-time, short life, secret in the fragment, a QR only for an address another device can reach.
- Fit: Good with rank 3. The code is exchanged for a device token over the Tailscale HTTPS address. The fragment never goes to a server log. Never show the QR for `127.0.0.1`. The Settings text must still say "never Funnel" (ADR-121).
- First small step: Pure function `makePairingCode()` and `redeem(code)` with a 5-minute life and one use, plus tests. No UI yet. Then add the QR (CoreImage `CIQRCodeGenerator` is in macOS, so no new dependency; unverified that it builds in this project).

### Rank 5: Tailscale helper in Settings (size S)

- What: A "Phone" row that runs `tailscale status --json` and shows the Mac's `.ts.net` name, the exact command, and whether `ATOM_API_HOST` matches.
- Why: ADR-121 asks the user to find the name and edit `.env` by hand. T3 Code reads the same CLI output (`packages/tailscale/src/tailscale.ts`: `readTailscaleStatus`, `parseTailscaleStatus`).
- Fit: Good. It is read-only. Use `execFile` with a timeout (T3 uses 1.5 s). Parse only the name field. Map errors to fixed labels (not logged and not shown raw, since stderr can hold keys). ATOM still never runs `tailscale serve` on its own, as ADR-121 says.
- First small step: A pure parser for the status JSON with tests on sample output. Then the row.

### Rank 6: Files tab, read-only (size M)

- What: A tab with a tree of the project folder, a search field, and a preview of text, Markdown and images. A row has "Add to chat", which inserts the "@" file mention (ADR-126).
- Why: The user sees what the agent can see, and mentions a file with one click. T3 Code does this with drag. ATOM's "@" file mention already exists.
- Fit: Fair. It reads files, so it must obey ADR-122 and ADR-123. Hide secret-like files (`isSecretLike` in `@atom/helpers`). Preview only. No edit. Limit the preview size. Do not follow symlinks out of the folder.
- First small step: A runtime command `files.list` for one folder (names, sizes, kinds), with path checks and tests. Then a flat list view in the right panel. Add search and preview after.

### Rank 7: Open the Changes tab by itself after a turn (size S, needs rank 1)

- What: When a turn ends with changed files, the panel opens on Changes. The setting is off by default. A choice the user made after the turn wins.
- Why: T3 Code does this (`useProactivePanels.ts`, default off). It saves a click.
- Fit: Good. One pure rule with tests: `shouldOpenChanges(userActedSince, hasChanges, setting)`.
- First small step: The rule and its tests.

### Rank 8: Dock badge for items that wait (size S)

- What: The Dock icon shows the number of Needs you cards while the ATOM window is open. The badge clears when the window is in front.
- Why: T3 Code sets a badge count and clears it on focus (`notificationBadge.ts`). Notifier.swift has the data (`approval`, notices).
- Fit: Good. `NSApp.dockTile.badgeLabel`. No new permission. The ATOM Dock icon exists only while the window is open (`MainWindowController.show`), so the badge works only then. Unverified: whether the menu-bar item could show the count instead.
- First small step: A pure function `badgeText(count)` and one call from the place that updates Needs you.

### Ranks 9 and 10: lower value (size S each)

- Reopen a closed view: a key (T3 uses `mod+shift+t`) brings back the last closed tab. ATOM has Back history (ADR-096). Low value before rank 1.
- Resource line in Settings: CPU and memory of the runtime from `process.cpuUsage()` and `process.memoryUsage()`, no new dependency. Do it only if users report slowness.

### Not recommended now

- Device (simulator) tab. ATOM has no mobile app work.
- T3 Connect style cloud relay and push alerts. They need accounts and a hosted service. ADR-121 defers them. Telegram already gives alerts.
- Scopes per token. Revisit after rank 3.
- Several routes with failover. One Mac and one Tailscale name are enough.
- Browser, terminal and pull request tabs. They are large and ATOM has a computer tool and a task view already.
- A tray menu. ATOM has the menu-bar item. Unverified what it shows.

### Sketch: the ATOM window with a right panel

```text
+--------------------------------------------------------------------------------+
| o o o  [<]  Chat: Fix login bug             [Open in v]  [Inspector]           |
+-------------+------------------------------------------+-----------------------+
| ATOM        |                                          | Changes | Files  [x]  |
| Dashboard   |  You: why does login fail?               +-----------------------+
| Board       |                                          | 3 files changed       |
| Scheduled   |  ATOM: I found two causes...             |  M  src/login.ts  +8 -2|
| Second brain|                                          |  M  src/auth.ts   +3 -1|
|             |                                          |  A  test/login.ts +40  |
| Projects    |                                          |-----------------------|
|  > my-app   |                                          | src/login.ts          |
|    Fix login|                                          |  - if (user == null)  |
|    New chat |                                          |  + if (!user)         |
| Chats       |                                          |  ...                  |
|  ...        |  [ Type a message...            ] [send] |  [Accept] [Deny]      |
| Plugins     |                                          |                       |
| Settings    |                                          |  <-- drag to resize   |
+-------------+------------------------------------------+-----------------------+
 sidebar 224   main pane (reading width 680, min 360)       panel (min 320)
```

- The Inspector button and ⌥⌘I toggle the panel. The Open in button sits in the top bar.
- At a window width under about 900 pt, the panel covers the main pane as a sheet, or the sidebar hides first.
- Tabs after Changes and Files: none until needed. A Phones tab (rank 3) can live in Settings instead.

### Suggested order

1. ADR for ranks 1 and 2. Build rank 2 first.
2. Rank 5. Then an ADR for ranks 3 and 4 together.
3. Rank 1 with Changes only. Then ranks 6 and 7.

One capability per task. Stop after each task.

---

Not covered: sessions, providers and Git (other files here), `apps/marketing`, relay internals. No T3 Code feature was run. All facts come from reading files.
