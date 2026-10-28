# T3 Code: settings screens and key bindings

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

Research date: 2026-10-17. Source: shallow clone of `pingdotgg/t3code` (MIT licence), commit `2fbd4318`. The clone is read only.
Paths are relative to the clone root unless they start with `/home/user/Atom-Your_Pal`. "Unverified" or "not checked" marks a claim I did not confirm in code.

Summary:
- T3 Code has 11 settings pages in the nav, plus "Project" and a hidden "Diagnostics". A search box and a scope sentence sit on top.
- Device settings live in a client file. Environment settings live in the server `settings.json`.
- A provider is an "instance" with an enable switch, binary path, sign-in row, env variables and model list.
- Secrets never go back to the client. The server keeps them in files and sends a "redacted" flag.
- Key bindings are one JSON array of `key`, `command`, `when`. The last matching rule wins.
- ATOM must not copy "type an API key for the model". It breaks the money rule. Section 7 gives a safe variant.

## 1. Map of the settings screen

### 1.0 Layout and shared parts

| Part | What it does | Where |
| --- | --- | --- |
| Sidebar nav | Lists sections with icon and label. | `apps/web/src/components/settings/SettingsSidebarNav.tsx` |
| Settings search | Box in the nav. Cmd/Ctrl+F or `/` focuses it. A result jumps to the row and highlights it. | `settingsSearch.ts` (`SETTINGS_SEARCH_ITEMS`, `searchSettings`) |
| Scope sentence | "Applying settings for [project] on/across [machine]". Two menus set the scope. | `SettingsScopeSentence.tsx`, `settingsScope.ts` |
| Device-only pages | Appearance, SnapShots, Connections hide the scope sentence. | `SETTINGS_DEVICE_ONLY_PATHS` |
| Row parts | Title, description, status line, control, reset button. | `settingsLayout.tsx` (`SettingsRow`, `SettingsSection`, `SettingResetButton`) |
| Folded section | Section with a summary and a master switch. | `FoldedSettingsSection.tsx` |
| Restore button | "Restore device defaults" in the header. Disabled when nothing changed. | `apps/web/src/routes/settings.tsx` |
| Per-row reset | A reset button shows only when the value differs from the default. | `SettingResetButton` |
| Desktop menu | "Settings..." with `CmdOrCtrl+,`. Also "Check for Updates...". | `apps/desktop/src/window/DesktopApplicationMenu.ts` |

Nav sections (`SETTINGS_SECTION_LABELS`): General, Appearance, Keybindings, SnapShots, Providers, Integrations, Scheduled Tasks, Source Control, Storage, Connections, Archive.
"Project" shows only with a project scope. "Diagnostics" has a route but the nav filters it out.

Storage words used below:
- **Client** = per device. Desktop file `client-settings.json`. Browser `localStorage` key `t3code:client-settings:v1`.
- **Server** = per environment. File `settings.json` in the server state dir.
- **Server+project** = a server setting a project can override (`PROJECT_SCOPED_SERVER_SETTING_KEYS`, 25 keys).
- **Secret** = file in `<stateDir>/secrets/`. **Local** = other `localStorage` keys (themes).

### 1.1 General (`GeneralSettingsPanel` in `SettingsPanels.tsx`)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Default model | Model picker | Model for new threads. | Server+project (`defaultModelSelection`) |
| Permissions | Select | Runtime mode for new threads: supervised, auto-accept edits, full access. | Server+project (`defaultRuntimeMode`) |
| New threads, Submodules, Start from origin | Select, select, switch | How new worktrees start. | Server+project |
| Add project starts in | Text | Folder where the Add Project browser opens. | Server (`addProjectBaseDirectory`) |
| Project grouping, Project order | Switch, select | Combine repos; order updated, created or manual. | Client |
| Snooze / Auto-resume limited threads | 2 switches | Handle usage-limit stops. | Server |
| Working section (beta) | Switch | Fold working threads into one group. | Client |
| Auto-settle merged / inactive threads, days, keep PR threads | Switches, number (1-90) | Settle threads on merge or after idle days. | Server+project |
| Thread notifications | Select | Off, notification, sound, or both. | Client (`notificationMode`) |
| In-app notifications | Switch | Toast when another thread ends or needs input. | Client |
| Time format | Select | System, 12-hour, 24-hour. | Client |
| Response streaming | Select | Stream by turn or by paragraph. | Server+project |
| Diff: hide whitespace, file state, layout | Switch, select, select | Diff defaults. | Client |
| Proactive panels | Switch | Open the Changes panel on its own. | Client |
| Composer: skills in slash menu, rich text, collapse on scroll | 3 switches | Composer behaviour. | Client |
| Send shortcut | Select | Enter; Mod+Enter for multiline; Mod+Enter always. | Client (`sendShortcut`) |
| Follow-up behavior | Select | Queue or steer while the agent runs. | Client |
| Provider update checks | Switch | Check CLIs and model catalogs for updates. | Server |
| Continue threads after restarts | Switch | Resume after update, crash or reboot. | Server+project |
| Background activity | Select plus "Advanced" dialog | Profile: balanced, performance, battery-saver, custom. Dialog sets intervals and pause rules. | Server (`backgroundActivity`) |
| Unpin / Archive / Delete confirmation | 3 switches | Ask first. Delete is on by default. | Client |
| Quit shortcut (desktop) | Select | Direct, hold (default), double press. | Client (`confirmQuit`) |
| Text generation model | Model picker | Model for titles and other generated text. | Server+project |
| About: Version, Update track | Text, select | Version; stable or nightly on release builds. | Desktop updater (`apps/desktop/src/updates/`) |
| About: t3 command, Mobile app, Privacy, Diagnostics, Licences | Buttons, links | Info and tools. | Not checked |
| Legacy: Plan mode, Context window indicator, Sidebar | 3 switches | Bring back old features. | Client |

### 1.2 Appearance (device only; `AppearanceSettingsPanel`)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Theme library | Cards, import, editor | Pick a theme; separate light and dark halves; System/Light/Dark; create or import a VS Code or T3 theme. | Local (`t3code:theme`, custom-theme keys in `hooks/useTheme.ts`) |
| Environment themes | Cards | Themes the server publishes in `themes/`. `t3 theme set` pushes one. | Server (`defaultTheme`) |
| Contrast | Slider 50-200 | Colour and border contrast. | Client |
| Glass opacity | Slider 40-100 | How solid menus and composer look. | Client |
| Environment identification | Select: artwork, pill, none | Marks Dev and Nightly builds. | Client |
| Diff colors | Select: red-green, blue-orange | Add and delete colours. | Client |
| Composer context | Switch | Keep branch controls after the first message. | Client |
| Chat width | Select: comfortable, wide, full | Message width. | Client |
| Panel animations | Slider 0-400 ms | Panel motion. Default 0. | Client |
| Interface, Prompt, Code, Terminal font | Font picker plus size | Family (max 200 chars); size 12-20, 12-20, 10-18, 8-20. | Client |
| Font smoothing (mac), Word wrap | 2 switches | Text rendering and wrap. | Client |

### 1.3 Connections (`ConnectionsSettings.tsx`, `LoadBalancingSettings.tsx`)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Environment icon | Picker | Icon of this machine. | Server |
| Local environment, Network access, Tailscale HTTPS, WSL backend | Switches, select (desktop) | Backend on or off; listen on the LAN (app restarts); serve over tailnet; WSL. | `DesktopAppSettings.ts`, at `DesktopEnvironment.desktopSettingsPath` (`desktop-settings.json`) |
| Pairing link | Button, QR, endpoint select | One-time link for a new device. Copy works only while the page stays open. | Not checked (server auth code) |
| Authorized clients | List, Revoke, "Revoke others" | End access of a device. | Not checked |
| T3 Connect | Sign-in, switch | Reach this machine without port forwarding. | Not checked |
| Hold webhooks while offline, Publish agent activity | 2 switches | Webhook buffer (24 h); push activity to mobile. | Not checked |
| Environments list | List, "Add environment" (remote link, SSH) | Add, switch, remove; reorder routes. | Client |
| Load balancing | Folded section, switch, select per machine | Auto-pick a machine for new threads. Prefer 100, Normal 50, Less often 25, Manual only 0. | Client (`loadBalancingEnabled`, `loadBalancingWeights`) |
| GitHub sharing | Section | Routing permission. | Not checked |

### 1.4 Source control (`SourceControlSettings.tsx` and nearby files)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Server environment | Status list, "Rescan" | Shows detected git, gh, glab, fj, tea. | Not stored |
| Git fetch interval | Number | How often to fetch. | Server |
| Worktree branch naming, prefix, instructions | Select (static, semantic, custom), text, text area | How new branches are named. | Server+project |
| Automatically pull, Remove agent credits when merging | 2 switches | Pull at thread start; strip credit lines. | Server+project |
| Default merge method | Select | PR merge method (values not checked). | Server+project; per-repo override in Client |
| GitHub accounts and token | Host field, password field | Token per host. | Secret (`sourceControlHosts.github.tokens`) |
| Bitbucket and other hosts | Password fields | Access token, or email plus API token. "Remove" clears. | Secret |
| Writing style | Select (repo conventions, conventional commits, custom), text area | Style of commit and PR text. | Server+project |
| Follow change request templates | Switch | Use the repo PR template. | Server |
| Source control writer model | Model picker | Model for commit and PR text. | Server+project |
| Review guides (beta), model, instructions | Switch, picker, text area | Adds a Guide tab to PRs. | Server+project |

### 1.5 Providers and Keybindings

Providers rows are in section 2. Keybindings rows are in section 3. Extra Providers rows:
Add provider (3-step wizard: Provider, Identity, Config); Refresh provider status; Health check interval (seconds, 0 = off, server);
Usage providers (URL plus management key, key is a secret); Cursor account usage (mac switch, reads Keychain).

### 1.6 Other sections

| Section | Controls | Stored |
| --- | --- | --- |
| SnapShots | Enable; include app text; capture shortcut (chord or modifier pair such as Shift+Shift); sound (soft-pop, camera-shutter) and play sound; flash; animations | Client (`snapShot*`). Platform limits not checked |
| Integrations | Agent browser access; Device hosts (SSH); Agent device access; Device hub; Simulator support | Server (+project for the two access switches) |
| Integrations (browser) | Browser profiles and default; viewport, zoom, appearance; recording frame rate 30/60; show key and mouse presses; "Open links in" system or app; "Open pull requests in T3 Code"; auto-show floating preview | Client |
| Scheduled Tasks | Task list; editor: name, project, checkout path, prompt, schedule, "Skip requests older than" | Server (`apps/server/src/scheduledTasks`; format not checked) |
| Storage | Worktree cleanup rules (keep when: any local files, uncommitted changes, tracked changes; delete with deleted threads, inactive N days, settled N days, merged, unchanged); worktree location; browser artifact days; rotated log days; "Delete now" with a removed/kept/failed report; database size notice | Server (`storageCleanup`, `worktreeCleanup`) |
| Archive | Archived threads: restore or delete | Server (thread state, not checked) |
| Diagnostics (hidden) | Live processes, resource history, trace diagnostics, OpenTelemetry export (3 URLs) | Server (`observability`) |
| Project (scope only) | Name, icon, Actions (project scripts with optional shortcut) | Server |

### 1.7 Mobile and desktop extras

Mobile (`apps/mobile/src/features/settings/`, `SettingsRouteScreen.tsx`) is a stack of screens:
- Connections: T3 Account, Environments, Notifications (device alerts, Live Activity).
- Interface: Appearance, Keyboard (Return key behaviour), Microphone (access; preferred order wired, Bluetooth, built-in, CarPlay).
- Automations: Scheduled tasks. Projects and threads: Overview, Organization, Thread behavior, Follow-ups, Archived threads.
- Server settings: Provider accounts, New threads, Source control, Agent behavior, Maintenance. App: Usage, About. Also Client Storage (clear caches).

Desktop: update channel in `apps/desktop/src/updates/updateChannels.ts`; Linux password store (`auto`, `gnome-libsecret`, `kwallet*`) in `apps/desktop/src/linuxSecretStorage.ts`.

## 2. The Providers section in detail

### 2.1 Model of a provider

- A provider is an **instance**: `ProviderInstanceConfig` in `packages/contracts/src/providerInstance.ts`.
- Fields: `driver`, `displayName`, `accentColor`, `enabled`, `environment` (env variables), `config` (driver blob).
- The map `providerInstances` is in server settings. A patch replaces the whole map.
- Unknown drivers stay in the file. The card says "This instance uses X, which is not available in this build".
- Default on: Codex, Claude. Default off: Cursor, Grok, Muse, Pi, OpenCode, Antigravity (`DEFAULT_DISABLED_PROVIDER_DRIVERS`).
- A project can switch an instance off for itself (`resolveProjectProviderInstanceEnabled`).

### 2.2 One instance card (`ProviderInstanceCard.tsx`)

| Row | Control | Notes |
| --- | --- | --- |
| Header | Enable switch, delete, update badge | Badge opens a popover: version, "Update now", copy command. |
| Display name | Text, accent colour picker | Status text sits under the title. |
| Status line | Dot (ready, warning, error, disabled), headline, detail | `providerStatus.ts` `getProviderSummary`. |
| Account | Sign-in row; method select if more than one | `ProviderAuthenticationSection.tsx`. Email stays hidden until clicked. |
| Setup | Driver section | Codex managed or existing; Antigravity install and sign-in. |
| Runtime | Form built from the driver schema | Binary path, home path, launch args. |
| Environment variables | Name, value, "Sensitive" toggle, remove | For API keys and base URLs. |
| Models | Favourite, hide, move, custom model editor, filter | `ProviderModelsSection.tsx`, `CustomModelEditor.tsx`. |

Status words: Disabled, Not found (CLI not on PATH), "Not authenticated · label", Needs attention, Unavailable, "Authenticated · label", Available.
Advisories: Limited support, Unsupported version, Known broken version, Update available.
The server re-checks health every 5 minutes by default (`DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL`). The refresh button calls `refreshProviders` with `refreshModels: true` and has a re-entry guard.
The model catalog is a bundled JSON file that a fetch from `main` can replace (`docs/internals/model-manifest.md`).

### 2.3 Options per driver (`makeProviderSettingsSchema` calls)

| Driver | Fields |
| --- | --- |
| Codex, Claude (`packages/contracts/src/settings.ts`) | Codex: binary path (`codex`), CODEX_HOME, shadow home, launch args. Claude: binary path (`claude`), CLAUDE_CONFIG_DIR, auto-compact after (100000-1000000 tokens), launch args. |
| Antigravity | Sign-in method (Google account, Gemini Enterprise, Gemini API key, Agent Platform), API key (password), GCP project, GCP location, binary path (empty = automatic). |
| OpenCode (`packages/provider-opencode/src/settings.ts`) | Binary path, server URL (blank = T3 starts the server), server password (password). |
| Pi, Grok, Muse | Binary path. Pi also has launch args. |
| Cursor | No visible field. Uses `CURSOR_API_KEY` in env variables, or browser sign-in. |
| ACP registry | ACP source, registry agent ID, executable override, authentication method (default `auto`). |

### 2.4 "Auto select" in T3 Code

I found no global "auto select provider" control. "Auto" appears in four places only:
- Antigravity binary path empty = pick the runtime automatically.
- ACP registry authentication method defaults to `auto`.
- Connections > Load balancing picks a machine, not a provider.
- Linux password store `auto` in the desktop app.

### 2.5 Typing an API key: how secrets work

- Three ways to enter a secret:
  1. A driver field with `control: "password"` (Antigravity `apiKey`, OpenCode `serverPassword`).
  2. An env variable with "Sensitive" on (`ANTHROPIC_AUTH_TOKEN`, base URLs, `CURSOR_API_KEY`).
  3. A source control token, or a usage source `managementKey`.
- A field counts as secret when it has `settingsSecret` or `control: "password"` (`isSecretSetting`).
- Input: `SecretInput.tsx` uses `type="password"`, `autoComplete="off"`, `spellCheck=false`.
- Placeholder when saved: "Stored secret, enter a new value to replace". When empty: "Not set". Empty input on a saved secret changes nothing.
- Server to client: `redactServerSettingsForClient` sends `value: ""` and `redacted: true`. The client never gets the value back.
- Client to server: the marker `SECRET_REDACTED` (six bullets, `apps/server/src/settingsSecrets.ts`) means "keep the saved value". An empty value removes it.
- Disk: `apps/server/src/auth/ServerSecretStore.ts` writes `<stateDir>/secrets/<name>.bin`. Folder mode 0700, file mode 0600, temp file then rename.
- Names: `provider-config-<b64 instance>-<b64 driver>-<b64 field>` and `provider-env-<b64 instance>-<b64 name>`.
- A plain value found in `settings.json` moves to the store on load (`moveInlineSettingsSecrets`). The file keeps a redaction mark.
- I found no encryption in `ServerSecretStore.ts`. Protection is file mode. On a Mac, Keychain is stronger.
- Scopes: provider changes need `AuthProvidersManageScope`. Other settings need `AuthSettingsWriteScope`.
- Example (`docs/user/providers-claude.md`): a router such as OpenRouter uses a new Claude instance with `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (Sensitive) and an empty `ANTHROPIC_API_KEY`. ATOM must never allow this (ADR-092).

## 3. The key binding system

### 3.1 File and format

- File: `keybindings.json` in the server state dir (`apps/server/src/config.ts`). Docs say `~/.t3/userdata/keybindings.json`.
- Shape: `[{ "key": "mod+shift+d", "command": "terminal.new", "when": "terminalFocus" }]`. `when` is optional.
- Schema `KeybindingRule`: `packages/contracts/src/keybindings.ts`. Limits: key 64 chars, `when` 256 chars, 256 rules, `when` depth 64.
- Key syntax: modifiers joined by `+`. `mod` = Cmd on Mac, Ctrl elsewhere. Also `cmd/meta`, `ctrl/control`, `alt/option`, `shift`. Parser: `parseKeybindingShortcut` in `packages/shared/src/keybindings.ts`.
- Commands: about 84 fixed ids (my hand count) plus `script.<id>.run` for project scripts.
  Families: sidebar, navigation, terminal, rightPanel, diff, preview, commandPalette, filePicker, projectSearch, composer, chat, thread, modelPicker, usage, theme.
- The server sends clients a parsed form (`ResolvedKeybindingRule`: command, shortcut object, `whenAst`).

### 3.2 Defaults and `when` contexts

- `DEFAULT_KEYBINDINGS` (`packages/shared/src/keybindings.ts`): 64 literal rules plus 18 generated (thread jump and model jump, `mod+1` to `mod+9`).
- Examples: `mod+b` sidebar, `mod+j` terminal, `mod+k` palette, `mod+p` file picker, `mod+shift+f` project search, `mod+n` new chat, `mod+shift+m` model picker, `mod+z` undo.
- Many defaults add `!terminalFocus` so the shell keeps its keys. Thread jumps add `isDesktop` so they do not steal browser tab keys.
- Grammar: identifiers, `!`, `&&`, `||`, parentheses. An unknown identifier is false.
- Context keys in the docs: `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`, `composerDraft`, `turnRunning`, `editableFocus`, `isWeb`, `isDesktop`.
- The defaults also use `rightPanelOpen` and `draftThreadRoute`. The docs omit them.
- Match: `resolveShortcutCommand` (`apps/web/src/keybindings.ts`) walks the list from the end. The last rule that matches key and `when` wins.

### 3.3 How users edit

By UI (`KeybindingsSettings.tsx`, `KeybindingsSettings.logic.ts`):
- Rows are grouped: Navigation, Threads, Composer, Terminal, Preview & diff, Appearance, Project scripts, Other.
- Search matches id, label, key, `when` and source. A badge shows Default, Custom or Project.
- Click the key box to record. Press the keys. Esc cancels. The box has `data-keybinding-capture`.
- The "When" editor has a text box and a visual builder (condition select, NOT, AND/OR groups).
- Row menu: "Reset to default", "Remove". Buttons: "Add keybinding", "Open keybindings.json".
- Save goes to every connected environment in scope (upsert with a `replace` target). Errors show as toasts.

By file:
- Edit the JSON. The server watches the folder, waits 100 ms, re-reads, and pushes `keybindingsUpdated` to clients.
- An invalid rule gets an issue (`keybindings.invalid-entry`) and is ignored. Unreadable JSON gives `keybindings.malformed-config` and defaults.
- `KeybindingsConfigWarning.tsx` shows a toast with an "Open keybindings.json" button.

### 3.4 Merge, migration, conflicts

- Runtime merge (`mergeWithDefaultKeybindings`): drop a default when the user file has the same command, then append user rules.
- Startup sync (`syncDefaultKeybindingsOnStartup`, `apps/server/src/keybindings.ts`):
  - No file: write all defaults.
  - File with issues: skip the sync and log.
  - Otherwise add defaults for commands the user file lacks. Skip a default whose key and `when` equal a user rule, and log it. Cap at 256.
- "Late defaults" (`LATE_DEFAULT_KEYBINDINGS`) add one new default next to a rule the user kept. Applied-migration ids stop a repeat.
- Writes are atomic and use a semaphore.
- UI conflict check (`keybindingConflictLabels`): same key and either `when` empty or both equal. It warns "Conflicts with X. The most recent matching binding wins". It does not block.
- `effectiveShortcutsForCommand` skips a key that a later rule claims. So a hint never shows a dead key.

### 3.5 Shortcut hints and the command palette

- `shortcutLabelForCommand(keybindings, command)` returns a label: Mac `⌃⌥⇧⌘K`, others `Ctrl+Alt+Shift+K`. About 18 `.tsx` files call it.
- Widgets: `components/ui/kbd.tsx` (`Kbd`, `KbdGroup`), `CommandShortcut` in `components/ui/command.tsx`.
- Thread jump hints show while the user holds the modifier (`shouldShowThreadJumpHintsForModifiers`).
- Palette files: `components/CommandPalette.tsx`, `CommandPalette.logic.ts`, `apps/web/src/commandPaletteBus.ts`.
  - `commandPalette.toggle` (`mod+k`) opens it. Other code calls `openCommandPalette({ open, query, linkedThreads })`, a window `CustomEvent`.
  - Modes: command, files (`filePicker.toggle`), content search (`projectSearch.toggle`). Prefix `>` shows actions only.
  - An item is an `action` or a `submenu`. It has `searchTerms`, an optional `shortcutCommand` and a `run`.
  - The shortcut is looked up live, so a rebind shows at once.
- Settings search has one item per command (`keybinding-<command>`) with default keys as terms.
- Not configurable: `mod+f` inside a diff. Desktop menu accelerators are fixed (`DesktopApplicationMenu.ts`). In a browser, `mod+w` clashes, and the docs tell users to rebind it.

## 4. Settings storage and sync design

- **Two schemas.** `ClientSettingsSchema` and `ServerSettings` in `packages/contracts/src/settings.ts`. `UnifiedSettings` joins them. Server wins (`mergeEnvironmentSettings`, `apps/web/src/hooks/useSettings.ts`).
- **Defaults in the schema.** Each field uses `Schema.withDecodingDefault(Effect.succeed(x))`. `DEFAULT_CLIENT_SETTINGS = decodeSync(Schema)({})`. A missing key gives the default. A new field needs no migration.
- **Validation.** Numbers use `Schema.Int.check` with `MIN_*` and `MAX_*` constants. Strings have max lengths. An empty binary path falls back to the command name (`makeBinaryPathSetting`).
- **Forward compatibility.** `ForwardCompatibleNullable`, `ForwardCompatibleOptional`, `ForwardCompatibleArray`. A value from a newer server decodes to null or is dropped. Provider config stays `Schema.Unknown` so unknown drivers survive.
- **Migrations seen.**
  - `confirmQuit`: an old boolean decodes to a mode (`LegacyConfirmQuit`).
  - Old provider blocks decode to instances (`decodeLegacyProviderSettingsJsonExit`).
  - Model favourites move from client to server. `null` on the server means "not migrated" (`useMigrateModelPreferences`).
  - `projectSettingsFolded`: a one-time fold of old per-project maps.
  - Keybinding late defaults use applied-migration ids.
- **Bad file.** If `settings.json` fails to decode, the server uses defaults, keeps the file for repair, and sets `continueThreadsAfterServerUpdate: false`. It logs a warning.
- **Client writes.** Apply at once, then persist. If a second write lands in flight, the updater runs again on the newest snapshot (`persistClientSettingsUpdate`). The store has states loading, ready, failed. Controls wait for hydration.
- **Server writes.** `ServerSettingsPatch` is a partial object. Scopes are checked per key. The file write is atomic (`writeFileStringAtomically`).
- **Sync.** The server watches `settings.json` (`fs.watch`, symlink targets too), waits 100 ms, clears its cache, and emits `streamChanges`. Clients get config stream events: `snapshot`, `keybindingsUpdated`, `providerStatuses`, `settingsUpdated`, `environmentThemesUpdated`, `usageLimitSourcesUpdated`, `welcome` (`packages/contracts/src/server.ts`). A hand edit shows in every open client.
- **No device sync.** Client settings do not sync between devices (docs say so for appearance and load balancing).
- **Project overrides.** 25 keys can be overridden per project. An absent key inherits. `null` is a real value for 5 nullable keys only. The UI shows the source of each value (`SettingInheritance.tsx`).
- **Scope in the URL.** Search params `project`, `machine`, `checkout`. An unavailable target never widens a write.
- **Tests.** Each area has `*.test.ts` beside it (`scopedSettings.test.ts`, `settingsSearch.test.ts`, `keybindings.test.ts`).

## 5. Where to look

| Feature | File in T3 Code |
| --- | --- |
| Settings routes | `apps/web/src/routes/settings.tsx`, `settings.general.tsx`, `settings.providers.tsx`, `settings.keybindings.tsx`, `settings.connections.tsx` and others |
| Nav, rows, reset parts | `apps/web/src/components/settings/SettingsSidebarNav.tsx`, `settingsLayout.tsx` |
| General, Appearance, Archive panels | `apps/web/src/components/settings/SettingsPanels.tsx` |
| Settings search catalog | `apps/web/src/components/settings/settingsSearch.ts` |
| Scope (project, machine) | `settingsScope.ts`, `scopedSettings.ts`, `SettingsScopeSentence.tsx` |
| Schemas (client, server, patch) | `packages/contracts/src/settings.ts` |
| Client settings store | `apps/web/src/hooks/useSettings.ts`, `clientPersistenceStorage.ts`, `apps/desktop/src/settings/DesktopClientSettings.ts` |
| Server settings, watch, secrets | `apps/server/src/serverSettings.ts`, `settingsSecrets.ts`, `auth/ServerSecretStore.ts` |
| Secret input control | `SecretInput.tsx`, `RedactedSensitiveText.tsx` (in `components/settings/`) |
| Provider panel, card, form | `ProviderSettingsPanel.tsx`, `ProviderInstanceCard.tsx`, `ProviderSettingsForm.tsx` |
| Provider status, sign-in, wizard | `providerStatus.ts`, `ProviderAuthenticationSection.tsx`, `AddProviderInstanceDialog.tsx` |
| Models and custom models | `ProviderModelsSection.tsx`, `CustomModelEditor.tsx`, `docs/internals/model-manifest.md` |
| Driver option schemas | `packages/provider-*/src/settings.ts`, `packages/contracts/src/providerInstance.ts` |
| Keybinding schema | `packages/contracts/src/keybindings.ts` |
| Defaults, key parser, `when` parser | `packages/shared/src/keybindings.ts` |
| Keybinding file, watch, merge | `apps/server/src/keybindings.ts` |
| Match and hint labels | `apps/web/src/keybindings.ts` |
| Keybinding settings UI | `KeybindingsSettings.tsx`, `KeybindingsSettings.logic.ts` |
| Command palette, hint widgets | `components/CommandPalette*.ts(x)`, `commandPaletteBus.ts`, `components/ui/kbd.tsx` |
| Load balancing | `LoadBalancingSettings.tsx` |
| Desktop menu, updates | `apps/desktop/src/window/DesktopApplicationMenu.ts`, `apps/desktop/src/updates/` |
| Mobile settings | `apps/mobile/src/features/settings/` |
| User docs | `docs/user/keybindings.md`, `install.md`, `providers-claude.md`, `providers-codex.md`, `appearance.md`, `remote-access.md`, `source-control.md` |

## 6. What ATOM has today, and the gap

Files read in `/home/user/Atom-Your_Pal/apps/mac/island/Sources/`: `AtomIsland/Settings/*.swift`, `AtomIslandCore/IslandSettings.swift`, `Shortcuts.swift`, `ShortcutMatcher.swift`, `PanelPages.swift`, `AtomIsland/PluginsView.swift`, `SearchViews.swift`. Also `apps/mac/src/model-settings.ts` and `ai-tools.ts`.

### 6.1 ATOM settings today

Pages (`SettingsPage` in `PanelPages.swift`): What can I ask?, Appearance, Design system, AI model, Shortcuts, Dictation, ATOM (pal), Sounds, General.
Home shows a "now" card and two groups. AI model opens from the now card.

| Area | ATOM page and rows |
| --- | --- |
| General (`GeneralPage.swift`) | Open at login; Answer without keys; daily brief; Suggest things to remember; Notifications (one switch per `AppNotice.Kind`); Telegram status and push; Local API (switch, Copy token, Regenerate, Phone command); Computer control; Permissions; Replay the tour. |
| AI model (`ModelPage.swift`) | Provider menu; Model menu; Custom model field (`isValidModelId`); Model list Refresh; error line; Allow the large model for helpers; plan meters; "Found on this Mac" list with status dots and Scan. |
| Shortcuts (`ShortcutsPage.swift`) | 5 global actions (`ShortcutAction`: talk, dictate, toggleIsland, cancel, quickAction). Recorder button, per-row reset, reset page, Input Monitoring card. |
| Dictation, Sounds, ATOM, Appearance | Mode, live preview, filler words; spoken and tone switches; pal size, movement, naps, bubble; theme cards. |
| Plugins (`PluginsView.swift`) | MCP servers (paste config or by hand; command or URL; Streamable HTTP or SSE; test; per-helper on), Skills (drafts, edits, editor), Find skills. |
| Search (`SearchViews.swift`) | Window search, Cmd+F, over chats, tasks, reports, notes, projects, agents, skills. I found no code that searches Settings pages. |
| Slash picker (`SlashMenu.swift`) | `/` in chat lists ATOM commands (new chat, model, skills, memory, help), skills and Claude commands. |

Storage: island settings in `UserDefaults` (keys such as `atom.petEnabled`, `atom.look.theme`). Each shortcut is `KeyCombo` JSON under its own key, with a "cleared" marker.
The model choice is in `config/island.json` (`model-settings.ts`). Telegram values are in `.env`. The API token is in `data/api-token`.
Shortcut rules (`validateShortcut`): a strong modifier or an F key; modifier-only only for holds; reserved Cmd keys; a clash between actions is refused (`.inUse`).

### 6.2 Gap table

| Topic | T3 Code | ATOM | Gap |
| --- | --- | --- | --- |
| Settings search | Box; about 110 rows plus one item per key command | Not found for Settings pages | Add |
| Per-row reset | Reset button when value differs | Per-page reset card; per-shortcut reset | Small |
| Settings scope | Project and machine sentence | One scope. Projects exist (ADR-107) | Later |
| Provider health | Dot, headline, version, update, refresh, interval | Dot and note per tool; Scan button | Add version, sign-in label, timer |
| Enable and path | Switch, binary path, home dir, launch args | Not found | Path override at most |
| API key field | Masked field, secret store | None, by rule (ADR-092) | Do not copy for models |
| Other secrets | Masked field, files 0600 | Telegram token typed into `.env` by hand | Masked field plus Keychain |
| Model list | Favourite, hide, order, custom, refresh | Custom, refresh | Favourite, hide |
| Auto choice | Load balancing of machines | Manual provider menu | Idea 4 |
| Key bindings | File, `when`, UI editor, 84 commands | 5 global shortcuts; in-window keys hard-coded (Cmd+F, Cmd+S, Cmd+Return) | Command table first |
| Shortcut hints | From one live table | Only the Cmd+F tooltip found | Add |
| Command palette | Cmd+K, `>` actions, submenus | Not found. `/` picker and Cmd+F exist | Add |
| Confirmations, storage cleanup | Switches; rules plus "Delete now" | Not found | Optional |
| Theme editor, diagnostics | Full editor; process and trace pages | 3 looks (ADR-057); Dashboard | Skip |
| Notifications | One mode select | Per-kind switches (better) | None |

## 7. Ideas for ATOM, ranked

Rules used: one capability at a time; no heavy dependency; secrets never in code or logs; money rule (ADR-092, ADR-093).

**1. Settings search (S to M).**
- What: a box on Settings home. It filters rows of all pages and opens the page.
- Why: ATOM has 9 pages and many cards. T3 uses a flat catalog and `searchSettings`.
- Fit: pure Swift in `AtomIslandCore`. No model call. No dependency.
- First step: a `SettingsCatalog` array (id, title, page, terms) and a tested `search(query)`.

**2. Masked secret fields in Keychain, with a money-rule guard (M).**
- What: a `SecretField` row. It shows "Stored secret, enter a new value to replace" and never the value. Empty input keeps the old value.
- Why: Telegram needs a hand edit of `.env` today (footer in `GeneralPage.swift`).
- Fit: Keychain is stronger than T3's 0600 files. Never log the value.
- Money rule: NOT for model API keys. Safe variant: Telegram, GitHub token and MCP env values only. Add a warning row on AI model: "ANTHROPIC_API_KEY found in your environment. ATOM removes it before it runs Claude." Show the name, never the value.
- First step: a `SecretStore` protocol with a Keychain and a fake class. Move only the Telegram bot token. Test that no log holds the value.

**3. Tool health card (S).**
- What: per tool, show version, a sign-in label, last check time, a Check button, and a background re-check (5 minutes, 0 = off).
- Why: `getProviderSummary` gives one clear headline per tool.
- Fit: ATOM already asks `claude auth status` and `codex login status`. It never reads a login file. Keep that.
- First step: add `version` and `checkedAt` to `AiToolItem` in `apps/mac/src/ai-tools.ts`. Show them in `ModelPage.swift`.

**4. "Auto" chat tool when the plan runs out (M).**
- What: a new Provider entry "Auto". It uses Claude Code. If the plan is used up, it answers a chat as plain text on Codex or the Gemini CLI. It says which tool answered.
- Why: the user asked for "auto select". T3's nearest feature is load balancing with weights.
- Money rule: safe. All three are subscription tools with API keys removed (ADR-093). It must never fall back to a key or to extra usage.
- Needs an ADR: ADR-093 says Codex and Gemini run no ATOM tools. Auto covers plain chat only.
- First step: a pure `AutoChoice` function (tools found, signed in, plan state in; tool out) with unit tests. No UI.

**5. In-window command table with shortcut hints (S, then M).**
- What: one table of in-window commands (new chat, search, open settings, send). Each has an id, a title and a default key. Menus and tooltips show the key.
- Why: T3 uses one source for dispatch, hints and the editor. ATOM hard-codes `keyboardShortcut` calls.
- First step: a `WindowCommand` enum in `AtomIslandCore` with `defaultCombo` and `display`. Use it for the Cmd+F tooltip.
- Later: user overrides in `UserDefaults`, a "Window keys" card on Shortcuts, a conflict note.

**6. Command palette on Cmd+K (M).**
- What: a list of actions, chats and settings pages. Prefix `>` shows actions only. Each action shows its key.
- Fit: deterministic first (CLAUDE.md section 9). No model call. Build after ideas 1 and 5.
- First step: a `PaletteItem` type and `filter(query, items)` with tests.

**7. Shortcut file with `when` contexts (L).**
- What: `config/keybindings.json` with `{ key, command, when }`, last match wins, defaults merged at start, file watched.
- ATOM contexts: `islandOpen`, `chatFocus`, `composerFocus`, `dictating`, `listening`, `speaking`, `mainWindowKey`.
- Fit: an invalid rule is ignored with a visible note. A bad file keeps defaults and stays on disk, as in T3.
- First step: only the `when` parser (T3 grammar) with tests. Do not wire it.

**8. Model list: favourite and hide (S).** Star and eye buttons per model. Favourites first. First step: a set of ids in `UserDefaults`, used in `ModelSection`.

**9. Tool path override (S).** Optional "Program path" per tool. Empty = automatic. Reuse `RuntimeLocator`. Keep `scrubbedEnv` and add no env editor. First step: a read-only row with the path ATOM found.

**10. Per-row reset (S).** A reset button on rows that differ from the default. First step: a `SettingDefault` helper in `IslandSettings.swift`, used on three rows.

**11. Settings schema discipline (S).** From T3: defaults in one place; clamp ranges; ignore unknown values; one-time migration flags; keep a bad file. First step: tests that load an empty and a corrupt `UserDefaults`.

**12. Confirmations and storage cleanup (S each, optional).** Confirm before deleting a chat. Clean old logs and reports with a "Delete now" report. Do only on request (CLAUDE.md section 22).

Not recommended: theme editor and VS Code import, SnapShots, machine load balancing, T3 Connect, pairing links (ATOM uses Tailscale, ADR-121), project scope sentence (wait for per-project settings).

### 7.1 Proposed ATOM settings layout (one option)

General now holds 8 unrelated cards. Re-group after search exists. Do it as its own small task.

| Group | Page | Rows |
| --- | --- | --- |
| Top | Search box, Now card | Search settings; current model; plan meters |
| AI | AI tools (was AI model) | Chat tool: Claude plan, Codex, Gemini, Auto; Model; Custom model; Model list Refresh; Allow large model for helpers; Found on this Mac (version, sign-in, Check, path) |
| AI | Plugins | MCP servers; Skills; Find skills (as now) |
| Input | Shortcuts | Global (5 actions); Window keys (idea 5); Reset all |
| Input | Dictation, Sounds | As now |
| Look | Appearance, ATOM (pal), Design system | As now |
| Connections | Connections | Telegram (masked token); Local API (switch, copy token, regenerate); Phone (Tailscale command); Computer control with Permissions |
| System | General | Open at login; Answer without keys; Notifications; Daily brief; Suggest things to remember; Confirmations (optional); Replay the tour |

Layout rules: one idea per page; row names stay the same; search covers every row; no page without rows.

### 7.2 Suggested order

1 (search), 3 (health), 5 (command table), 2 (secrets, Telegram only), 4 (Auto, after an ADR), 6, then 8 to 11, then 7. Each is its own task. Stop after each (CLAUDE.md section 3).

## 8. Not found or not checked

- No "auto select provider" control in T3 Code (section 2.4).
- Resolved by the second review: `apps/desktop/src/settings/DesktopAppSettings.ts` stores these in `DesktopEnvironment.desktopSettingsPath`, built as `stateDir/desktop-settings.json`.
- Format of Scheduled Tasks on the server: not checked.
- SnapShots platform limits: not checked.
- Encryption of secrets at rest: none found in `ServerSecretStore.ts`. Not traced further.
- The count of about 110 search rows is from my own parse of `SETTINGS_SEARCH_ITEMS`. Treat it as approximate.
- ATOM: how MCP env values are stored on disk is not checked. `McpConfigImport.swift` says "private values kept on this Mac".
- ATOM: the main menu in `MainWindow.swift` was not read in full.
