# T3 Code: settings screens and key bindings

Research date: 2026-10-17. Source: shallow clone of `pingdotgg/t3code` (MIT licence), commit `2fbd4318`.
The clone is read only. All paths below are relative to the clone root unless they start with `/home/user/Atom-Your_Pal`.
"Unverified" marks a claim that I did not confirm in code.

## Short summary

- T3 Code has 11 settings pages in the nav on web and desktop, plus "Project" and a hidden "Diagnostics". A search box and a "scope sentence" sit on top.
- Settings live in two places. Device settings are in a client file. Environment settings are in the server `settings.json`.
- Providers are "instances". Each instance has an enable switch, a binary path, a sign-in row, env variables and a model list.
- Secrets never go back to the client. The server stores them in files and sends a "redacted" flag.
- Key bindings are one JSON file with `key`, `command`, `when`. The last matching rule wins.
- ATOM must not copy "type an API key for the model". That breaks the money rule. Section 7 gives a safe variant.

---

## 1. Map of the settings screen

### 1.0 Layout and shared parts

| Part | What it does | Where |
| --- | --- | --- |
| Sidebar nav | Lists the sections. Icon plus label. | `apps/web/src/components/settings/SettingsSidebarNav.tsx` |
| Settings search | Box in the nav. Press Cmd/Ctrl+F or `/` to focus. Result jumps to the row and highlights it. | `settingsSearch.ts` (`SETTINGS_SEARCH_ITEMS`, `searchSettings`) |
| Scope sentence | "Applying settings for [project] on/across [machine]". Two menus pick the scope. | `SettingsScopeSentence.tsx`, `settingsScope.ts` |
| Device-only pages | Appearance, SnapShots, Connections hide the scope sentence. | `SETTINGS_DEVICE_ONLY_PATHS` |
| Row parts | Title, description, status line, control, reset button. | `settingsLayout.tsx` (`SettingsRow`, `SettingsSection`, `SettingResetButton`) |
| Folded section | A section with a summary and a master switch. | `FoldedSettingsSection.tsx` |
| Restore button | "Restore device defaults" in the page header. Disabled when nothing changed. | `apps/web/src/routes/settings.tsx` (`useSettingsRestore`) |
| Per-row reset | A small reset button appears only when the value differs from the default. | `SettingResetButton` |
| Desktop menu | "Settings..." with `CmdOrCtrl+,`. Also "Check for Updates...". | `apps/desktop/src/window/DesktopApplicationMenu.ts` |

Section list (from `SETTINGS_SECTION_LABELS`): General, Appearance, Keybindings, SnapShots, Providers, Integrations,
Scheduled Tasks, Source Control, Storage, Connections, Archive. "Project" shows only when a project scope is chosen.
"Diagnostics" has a route but no nav item (the nav filters it out).

Storage words used in the tables:

- **Client** = per device. Desktop file `client-settings.json` in the state dir. Browser `localStorage` key `t3code:client-settings:v1`.
- **Server** = per environment. File `settings.json` in the server state dir (`serverConfig.settingsPath`).
- **Server+project** = server setting that a project can override (`PROJECT_SCOPED_SERVER_SETTING_KEYS`, 25 keys).
- **Secret** = file in `<stateDir>/secrets/`.
- **Local** = other `localStorage` keys (themes).

### 1.1 General (`GeneralSettingsPanel` in `SettingsPanels.tsx`)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Default model | Model picker | Model for new threads. | Server+project (`defaultModelSelection`) |
| Permissions | Select | Runtime mode of new threads: supervised, auto-accept edits, full access. | Server+project (`defaultRuntimeMode`) |
| New threads | Select | New thread uses local checkout or worktree. | Server+project (`defaultThreadEnvMode`) |
| Submodules | Select | Worktree submodule mode. | Server+project (`worktreeSubmodules`) |
| Start from origin | Switch | New worktree starts from the origin branch. | Server+project (`newWorktreesStartFromOrigin`) |
| Add project starts in | Text | Folder where the Add Project browser opens. | Server (`addProjectBaseDirectory`) |
| Project grouping | Switch | Combine matching repos across environments. | Client (`sidebarProjectGroupingMode`) |
| Project order | Select | Sidebar order: updated, created, manual. | Client (`sidebarProjectSortOrder`) |
| Snooze limited threads | Switch | Snooze usage-limit stops until reset time. | Server (`snoozeLimitedThreads`) |
| Auto-resume limited threads | Switch | Resume at the reset time. | Server (`autoResumeLimitedThreads`) |
| Working section (beta) | Switch | Fold working threads into one group. | Client (`sidebarWorkingShelfEnabled`) |
| Auto-settle merged threads | Switch | Settle a thread when its PR merges. | Server+project |
| Auto-settle inactive threads | Select | Off or after N days (1 to 90). | Server+project (`sidebarAutoSettleAfterDays`) |
| Keep threads with a PR | Switch | Inactivity does not settle threads with a PR. | Server+project |
| Thread notifications | Select | Off, notification, sound, or both. | Client (`notificationMode`) |
| In-app notifications | Switch | Toast when another thread ends or needs input. | Client (`inAppNotificationsEnabled`) |
| Time format | Select | System, 12-hour, 24-hour. | Client (`timestampFormat`) |
| Response streaming | Select | Stream by turn or by paragraph. | Server+project (`responseStreamingMode`) |
| Hide whitespace changes | Switch | Diff default. | Client (`diffIgnoreWhitespace`) |
| Default diff file state | Select | Files expanded or collapsed. | Client (`diffFilesCollapsed`) |
| Diff layout | Select | Stacked or split. | Client (`diffLayout`) |
| Proactive panels | Switch | Open the Changes panel on its own. | Client (`proactivePanelsEnabled`) |
| Show skills in slash menu | Switch | Skills also appear after `/`. | Client (`showSkillsInSlashMenu`) |
| Rich text composer | Switch | Show Markdown while typing. | Client (`composerRichTextEnabled`) |
| Collapse composer on scroll | Switch | Composer shrinks to one line. | Client (`composerCollapseOnScroll`) |
| Send shortcut | Select | Enter; Mod+Enter for multiline; Mod+Enter always. | Client (`sendShortcut`) |
| Follow-up behavior | Select | Queue or steer while the agent runs. | Client (`followUpBehavior`) |
| Provider update checks | Switch | Check CLIs for new versions and model catalogs. | Server (`enableProviderUpdateChecks`) |
| Continue threads after restarts | Switch | Resume threads after update, crash or reboot. | Server+project |
| Background activity | Select plus "Advanced" dialog | Profile: balanced, performance, battery-saver, custom. Dialog sets intervals and pause rules. | Server (`backgroundActivity`) |
| Unpin / Archive / Delete confirmation | 3 switches | Ask before the action. Delete is on by default. | Client (`confirmThreadUnpin`, `confirmThreadArchive`, `confirmThreadDelete`) |
| Quit shortcut (desktop) | Select | Direct, hold (default), double press. | Client (`confirmQuit`) |
| Text generation model | Model picker | Model for titles and other generated text. | Server+project |
| About: Version | Text and button | Shows version. Update track (stable or nightly) shows on release builds. | Desktop updater (`apps/desktop/src/updates/DesktopUpdates.ts`) |
| About: t3 command | Button (desktop) | Installs the CLI command. | Not found where stored |
| About: Mobile app, Privacy policy | Links | Info only. | None |
| Diagnostics, Open source licenses | Buttons | Open the Diagnostics page and licence list. | None |
| Legacy: Plan mode, Context window indicator, Sidebar | 3 switches | Bring back old features. | Client (`planModeEnabled`, `contextWindowMeterEnabled`, `legacySidebarEnabled`) |

### 1.2 Providers (details in section 2)

| Control | Type | Stored |
| --- | --- | --- |
| Environment picker | Tabs or select | UI state |
| Add provider | Button, 3-step wizard (Provider, Identity, Config) | Server (`providerInstances`) |
| Refresh provider status | Icon button | None (RPC call) |
| Instance cards | List with enable switch, delete, update badge | Server |
| Health check interval | Number field in seconds, 0 turns it off | Server (`providerHealthRefreshInterval`) |
| Usage providers | Add source dialog (URL plus management key) | Server (`usageLimitSources`), key is a secret |
| Cursor account usage (mac) | Switch | Server (`cursorKeychainUsageEnabled`) |

### 1.3 Keybindings (details in section 3)

Search box, "Add keybinding" button, "Open keybindings.json" button, groups of rows. Stored in `keybindings.json` on each environment.

### 1.4 Connections (`ConnectionsSettings.tsx`, `LoadBalancingSettings.tsx`)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Environment icon | Picker | Icon of this machine. | Server (`environmentIcon`) |
| Local environment (desktop) | Switch | Turn the built-in backend on or off. | Desktop settings (unverified file) |
| Network access (desktop) | Switch | Listen on the LAN. The app restarts. | Desktop settings (unverified file) |
| Pairing link | Button, QR, endpoint select | Make a one-time link for a new device. Copy works only while the page stays open. | Not checked (server auth code) |
| Authorized clients | List with Revoke, "Revoke others" | End access of a device. | Not checked (server auth code) |
| Tailscale HTTPS (desktop) | Switch | Serve over the tailnet. | Desktop |
| WSL backend, "WSL only" (Windows) | Select and switch | Run a WSL backend. | Desktop |
| T3 Connect | Sign-in and switch | Reach this machine without port forwarding. | Cloud account plus server |
| Hold webhooks while offline | Switch | Keep webhook calls up to 24 hours. | Not checked |
| Publish agent activity | Switch | Send activity to mobile notifications. | Not checked |
| Environments list | List, "Add environment" (remote link, SSH) | Add, switch on or off, remove, reorder routes. | Client |
| Load balancing | Folded section, master switch, 4-step select per machine | Auto-pick a machine for new threads. Prefer 100, Normal 50, Less often 25, Manual only 0. | Client (`loadBalancingEnabled`, `loadBalancingWeights`) |
| GitHub sharing | Section | Routing permission. | Not found where stored |

### 1.5 Source control (`SourceControlSettings.tsx` and files next to it)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Server environment | Status list, "Rescan" | Shows detected git, gh, glab, fj, tea and so on. | Not stored |
| Git fetch interval | Number | How often to fetch. | Server (`automaticGitFetchInterval`) |
| Worktree branch naming | Select: static, semantic, custom | How new branches are named. | Server+project (`branchNamingMode`) |
| Branch prefix, Branch naming instructions | Text, text area | Prefix and extra prompt. | Server+project |
| Automatically pull | Switch | Pull on thread start. | Server+project (`defaultAutoPull`) |
| Remove agent credits when merging | Switch | Strip credit lines at merge. | Server+project |
| Default merge method | Select | Merge method for PRs (values not checked). | Server+project; per-repo override in Client (`pullRequestMergeMethodOverrides`) |
| GitHub accounts and token | Host field plus password field | Token for a host. | Secret (`sourceControlHosts.github.tokens`) |
| Bitbucket, other hosts | Password fields | Access token, or email plus API token. "Remove" clears. | Secret |
| Source control writing style | Select: repo conventions, conventional commits, custom, plus text area | Style of commit and PR text. | Server+project |
| Follow change request templates | Switch | Use the repo PR template. | Server |
| Source control writer model | Model picker | Model for commit and PR text. | Server+project |
| Review guides (beta), model, instructions | Switch, picker, text area | Adds a Guide tab to PRs. | Server+project |

### 1.6 Appearance (device only; `AppearanceSettingsPanel`)

| Control | Type | What it does | Stored |
| --- | --- | --- | --- |
| Theme library | Cards, import, editor | Pick theme; light and dark halves; System/Light/Dark; create or import a VS Code or T3 theme. | Local (`t3code:theme`, custom themes, halves keys in `hooks/useTheme.ts`) |
| Environment themes | Cards | Themes published by the server in `themes/`. `t3 theme set` pushes one. | Server (`defaultTheme`) |
| Contrast | Slider 50 to 200 | Colour and border contrast. | Client (`appearanceContrast`) |
| Glass opacity | Slider 40 to 100 | Solid level of menus and composer. | Client (`glassOpacity`) |
| Environment identification | Select: artwork, pill, none | Marks Dev and Nightly builds. | Client |
| Diff colors | Select: red-green, blue-orange | Add and delete colours. | Client |
| Composer context | Switch | Keep branch controls after the first message. | Client (`persistComposerContextStrip`) |
| Chat width | Select: comfortable, wide, full | Message width. | Client (`chatWidth`) |
| Panel animations | Slider 0 to 400 ms | Panel motion. Default 0. | Client (`panelAnimationDurationMs`) |
| Interface, Prompt, Code, Terminal font | Font picker plus size | Family (max 200 chars) and size (12-20, 12-20, 10-18, 8-20). | Client (`fontFamily*`, `fontSize*`) |
| Font smoothing (mac) | Switch | Thin text smoothing. | Client |
| Word wrap | Switch | Wrap code, tables, diffs. | Client |

### 1.7 Other sections

| Section | Controls | Stored |
| --- | --- | --- |
| SnapShots | Enable; Include app text; Capture shortcut (a chord or a modifier pair such as Shift+Shift); Capture sound (soft-pop, camera-shutter) and play sound; Capture flash; Capture animations | Client (`snapShot*`) |
| Integrations | Agent browser access; Device hosts (SSH); Agent device access; Device hub; Simulator support; Browser profiles and default profile; default viewport, zoom, appearance; recording frame rate (30 or 60); show key presses; show mouse presses; "Open links in" (system or app); "Open pull requests in T3 Code"; auto-show floating preview | First four: Server (+project for browser and device access). Rest: Client |
| Scheduled Tasks | Task list; editor with name, project, checkout path, prompt, schedule, "Skip requests older than" | Server (`apps/server/src/scheduledTasks`; storage format not checked) |
| Storage | Worktree cleanup rules (keep when: any local files, uncommitted changes, tracked changes; delete with deleted threads; inactive N days; settled N days; merged; unchanged); Worktree location; browser artifact days; rotated log days; "Delete now" with a report of removed, kept, failed; database size notice | Server (`storageCleanup`, `worktreeCleanup`, `worktreesDirectory`) |
| Archive | List of archived threads, restore or delete | Server (thread state, not checked) |
| Diagnostics (hidden from nav) | Live processes, resource history, trace diagnostics, OpenTelemetry export (3 URLs) | Server (`observability`) |
| Project (scope only) | Name, icon, Actions (project scripts with optional shortcut) | Server |

### 1.8 Mobile and desktop extras

Mobile settings (`apps/mobile/src/features/settings/components/SettingsScreen.tsx`, `SettingsRouteScreen.tsx`) use a stack of screens:

- Connections: T3 Account, Environments, Notifications (device notifications, Live Activity).
- Interface: Appearance, Keyboard (Return key behavior), Microphone (access, preferred order: wired, Bluetooth, built-in, CarPlay).
- Automations: Scheduled tasks.
- Projects and threads: Overview, Organization, Thread behavior, Follow-ups, Archived threads.
- Server settings: Provider accounts, New threads, Source control, Agent behavior, Maintenance.
- App: Usage, About. Also "Client Storage" (clear caches).

Desktop extras: application menu with `CmdOrCtrl+,`; update channel in `apps/desktop/src/updates/updateChannels.ts`;
Linux password store choice in `apps/desktop/src/linuxSecretStorage.ts` (`auto`, `gnome-libsecret`, `kwallet*`).

---

## 2. The Providers section in detail

### 2.1 Model of a provider

- A provider is an **instance**. Type `ProviderInstanceConfig` in `packages/contracts/src/providerInstance.ts`.
- Fields: `driver`, `displayName`, `accentColor`, `enabled`, `environment` (list of env variables), `config` (driver blob).
- The map `providerInstances` is in server settings. Patches replace the whole map, never one entry.
- Unknown drivers stay in the file and round trip. The UI shows "This instance uses X, which is not available in this build".
- Default enabled: Codex and Claude. Default disabled: Cursor, Grok, Muse, Pi, OpenCode, Antigravity (`DEFAULT_DISABLED_PROVIDER_DRIVERS`).
- A project can switch an instance off for itself (`ProjectProviderInstanceOverride`, `resolveProjectProviderInstanceEnabled`).
- Drivers: Codex, Claude, Cursor, Grok, Muse, Pi, OpenCode, Antigravity, ACP registry agents.

### 2.2 What one instance card shows (`ProviderInstanceCard.tsx`)

| Row | Control | Notes |
| --- | --- | --- |
| Header | Enable switch, delete button, update badge | Update badge opens a popover with version, "Update now", copy command. |
| Display name | Text, plus accent colour picker | Status text under the title. |
| Status line | Dot (ready, warning, error, disabled) plus headline and detail | From `providerStatus.ts` `getProviderSummary`. |
| Account | Sign-in row, method select when more than one | `ProviderAuthenticationSection.tsx`. Email is hidden until clicked (`RedactedSensitiveText`). |
| Setup | Driver-specific section | Codex: managed or existing setup. Antigravity: install, sign in. |
| Runtime | Form made from the driver schema | Binary path, home path, launch args and so on. |
| Environment variables | Name and value rows, "Sensitive" toggle, remove | For API keys and base URLs. |
| Models | List with favourite, hide, move up or down, custom model editor, filter box | `ProviderModelsSection.tsx`, `CustomModelEditor.tsx`. |

### 2.3 Status words

`getProviderSummary` returns one headline:

- "Disabled", "Not found" (CLI not on PATH), "Not authenticated · label", "Needs attention", "Unavailable", "Authenticated · label", "Available".
- Version labels use `v1.2.3`. Advisories say "Limited support", "Unsupported version", "Known broken version", "Update available".
- The server polls health. Default interval 5 minutes (`DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL`). Set 0 to stop.
- The refresh button sends `refreshProviders` with `refreshModels: true`. It has a re-entry guard.

### 2.4 Options per driver (from `makeProviderSettingsSchema` calls)

| Driver | Fields (form order) |
| --- | --- |
| Codex (`settings.ts`) | Binary path (`codex`), CODEX_HOME path, Shadow home path, Launch arguments. Hidden: `enabled`, `setupMode` (managed or existing), `customModels`. |
| Claude (`settings.ts`) | Binary path (`claude`), CLAUDE_CONFIG_DIR path, Auto-compact after (100000 to 1000000 tokens), Launch arguments. |
| Antigravity | Sign-in method (Google account, Gemini Enterprise, Gemini API key, Agent Platform), API key (password), GCP project, GCP location, Binary path ("Leave empty to select automatically"). |
| OpenCode (`packages/provider-opencode/src/settings.ts`) | Binary path, Server URL ("Leave blank to let T3 Code spawn the server"), Server password (password). |
| Pi | Binary path, Launch arguments. |
| Grok, Muse | Binary path. |
| Cursor | No visible field. Uses `CURSOR_API_KEY` from env variables or browser sign-in. |
| ACP registry | ACP source (select), Registry agent ID, Executable override, Authentication method (default `auto`). |

### 2.5 "Auto select" in T3 Code

I did not find one global "auto select provider" control. I found four places where "auto" appears:

- Antigravity binary path empty = pick the runtime automatically.
- ACP registry "Authentication method" defaults to `auto`.
- Connections > Load balancing picks a machine, not a provider.
- Linux password store `auto` in the desktop app.

The new-thread model picker chooses the model. The provider setting only decides which instances exist and are enabled.

### 2.6 Typing an API key: how secrets work

- Three ways to enter a secret:
  1. A driver field with `control: "password"` (Antigravity `apiKey`, OpenCode `serverPassword`).
  2. An env variable with "Sensitive" on (for `ANTHROPIC_AUTH_TOKEN`, base URLs, `CURSOR_API_KEY`).
  3. A source control token (GitHub, Bitbucket) or a usage source `managementKey`.
- Rule: any field with `settingsSecret` or `control: "password"` counts as a secret (`isSecretSetting`).
- Input: `SecretInput.tsx` uses `type="password"`, `autoComplete="off"`, `spellCheck=false`.
- Placeholder when saved: "Stored secret, enter a new value to replace". Placeholder when empty: "Not set".
- Empty input on a saved secret does nothing. It does not clear the secret.
- Server to client: `redactServerSettingsForClient` sends `value: ""` and `redacted: true`. The client never gets the value back.
- Client to server: the marker `SECRET_REDACTED` (six bullet characters, `settingsSecrets.ts`) means "keep the saved value". An empty value removes the secret.
- Disk: `ServerSecretStore.ts` writes `<stateDir>/secrets/<name>.bin`. Directory mode 0700, file mode 0600, write to temp file then rename.
- Name pattern: `provider-config-<b64 instance>-<b64 driver>-<b64 field>` and `provider-env-<b64 instance>-<b64 name>`.
- A plain value found in `settings.json` moves into the store on load (`moveInlineSettingsSecrets`). The file keeps only the redaction mark.
- I found no encryption in `ServerSecretStore.ts`. Protection is file mode only. On the Mac this is weaker than Keychain.
- Docs say: "after saving, T3 Code does not display their original values" (`docs/user/install.md`).
- Scope check: provider changes need `AuthProvidersManageScope`; other settings need `AuthSettingsWriteScope`.

Worked example from `docs/user/providers-claude.md` (router such as OpenRouter): new Claude instance, own config dir, env variables
`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` (Sensitive), `ANTHROPIC_API_KEY` (empty).
This is exactly what ATOM must never allow (ADR-092).

---

## 3. The key binding system

### 3.1 File and format

- File: `keybindings.json` in the server state dir (`config.ts` `keybindingsConfigPath`). Docs: `~/.t3/userdata/keybindings.json`.
- Shape: JSON array of `{ "key": "mod+shift+d", "command": "terminal.new", "when": "terminalFocus" }`. `when` is optional.
- Schema: `KeybindingRule` in `packages/contracts/src/keybindings.ts`. Limits: key 64 chars, when 256 chars, 256 rules, `when` depth 64.
- Key syntax: modifiers joined with `+`. `mod` = Cmd on Mac, Ctrl elsewhere. Also `cmd/meta`, `ctrl/control`, `alt/option`, `shift`. Parser: `parseKeybindingShortcut` in `packages/shared/src/keybindings.ts`.
- Commands: about 84 fixed ids (my hand count) plus `script.<id>.run` for project scripts.
  Families: `sidebar`, `navigation`, `terminal`, `rightPanel`, `diff`, `preview`, `commandPalette`, `filePicker`, `projectSearch`, `composer`, `chat`, `thread`, `modelPicker`, `usage`, `theme`.
- Parsed form (`ResolvedKeybindingRule`): command, shortcut object, `whenAst`. The server sends the parsed form to clients.

### 3.2 Defaults

- `DEFAULT_KEYBINDINGS` in `packages/shared/src/keybindings.ts`: 64 literal rules plus 18 generated (thread jump `mod+1..9`, model picker jump `mod+1..9`).
- Examples: `mod+b` sidebar, `mod+j` terminal, `mod+k` command palette (when `!terminalFocus`), `mod+p` file picker, `mod+shift+f` project search, `mod+n` new chat, `mod+shift+m` model picker, `mod+z` undo (when `!terminalFocus && !editableFocus`).
- Many defaults add `!terminalFocus` so the shell keeps its keys.
- Thread jumps use `isDesktop` so they do not steal browser tab keys.

### 3.3 `when` contexts

- Grammar: identifiers, `!`, `&&`, `||`, parentheses. Unknown identifier = false.
- Context keys in docs: `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, `modelPickerOpen`, `usagePageOpen`, `composerFocus`, `composerDraft`, `turnRunning`, `editableFocus`, `isWeb`, `isDesktop`.
- The defaults also use `rightPanelOpen` and `draftThreadRoute`. The docs do not list them. The UI warns about unknown variables.
- Match code: `resolveShortcutCommand` in `apps/web/src/keybindings.ts` walks the list from the end. The last rule that matches key and `when` wins.

### 3.4 How users edit

By UI (`KeybindingsSettings.tsx`, `KeybindingsSettings.logic.ts`):

- Rows are grouped: Navigation, Threads, Composer, Terminal, Preview & diff, Appearance, Project scripts, Other.
- Search matches command id, label, key, `when`, source.
- Each row has a source badge: Default, Custom, Project.
- Click the key box to record. Press the keys. Esc cancels. The box has `data-keybinding-capture`.
- A "When" editor offers a text box and a visual builder (condition select, NOT, AND/OR groups).
- Row menu: "Reset to default" and "Remove".
- "Add keybinding" opens a new-row form. "Open keybindings.json" opens the file in the preferred editor.
- Save goes to every connected environment in scope (upsert with a `replace` target).
- Toasts: "Unable to save keybinding", "Unable to remove keybinding", "Unable to open keybindings file".

By file:

- Edit the JSON. The server watches the directory, waits 100 ms, re-reads, and pushes `keybindingsUpdated` to clients.
- `KeybindingsConfigWarning` shows a toast with an "Open keybindings.json" button when the file has issues.
- Invalid rules are ignored with an issue (`keybindings.invalid-entry`). Unreadable JSON gives `keybindings.malformed-config` and uses defaults.

### 3.5 Merge, migration, conflicts

- Runtime merge: `mergeWithDefaultKeybindings` drops a default when the user file has the same command, then appends user rules.
- Startup sync (`syncDefaultKeybindingsOnStartup` in `apps/server/src/keybindings.ts`):
  - No file: write all defaults.
  - File with issues: skip the sync and log.
  - Otherwise add defaults for commands the user file does not have.
  - Skip a default whose key and `when` equal a user rule. Log "skipping default keybinding due to shortcut conflict".
  - Cap at 256 rules.
- "Late defaults" (`LATE_DEFAULT_KEYBINDINGS`) add one new default next to a rule the user kept. A list of applied migration ids stops a repeat.
- Writes use `writeFileStringAtomically` and a semaphore.
- UI conflict check (`keybindingConflictLabels`): same key and either `when` is empty or both `when` strings are equal. It shows
  "Conflicts with X. The most recent matching binding wins". It warns. It does not block.
- `effectiveShortcutsForCommand` skips a shortcut that a later rule already claims. So hints never show a dead key.

### 3.6 Shortcut hints and the command palette

- `shortcutLabelForCommand(keybindings, command)` returns a label: Mac `⌃⌥⇧⌘K`, others `Ctrl+Alt+Shift+K`. File `apps/web/src/keybindings.ts`.
- Used in tooltips, sidebar buttons, the palette, project script buttons, PR panel menus (about 18 `.tsx` files call it).
- UI parts: `components/ui/kbd.tsx` (`Kbd`, `KbdGroup`) and `CommandShortcut` in `components/ui/command.tsx`.
- Thread jump hints show while the user holds the modifier (`shouldShowThreadJumpHintsForModifiers`).
- Command palette (`components/CommandPalette.tsx`, `.logic.ts`, `commandPaletteBus.ts`):
  - Opens with `commandPalette.toggle` (`mod+k`). Other code opens it by `openCommandPalette({ open, query, linkedThreads })`, a window `CustomEvent`.
  - Modes: command, files (`filePicker.toggle`), content search (`projectSearch.toggle`).
  - Prefix `>` shows actions only.
  - Items are `action` or `submenu`. Each item has `searchTerms`, an optional `shortcutCommand`, and a `run`.
  - Groups: projects, threads, actions, theme and appearance submenus, browse-for-folder mode.
  - The shortcut is looked up live, so a user rebind shows at once.
- Settings search uses one item per command (`keybinding-<command>`) with default keys as search terms. A user can find "terminal" and land on the row.
- Reserved keys: desktop `mod+w` closes a tab. The docs tell browser users to rebind it.
- Some keys are not configurable (`mod+f` inside a diff).
- Desktop menu accelerators are separate and fixed (`DesktopApplicationMenu.ts`).

---

## 4. Settings storage and sync design

- **Two schemas.** `ClientSettingsSchema` (device) and `ServerSettings` (environment) in `packages/contracts/src/settings.ts`.
  `UnifiedSettings` merges them. Server values win in `mergeEnvironmentSettings` (`hooks/useSettings.ts`).
- **Defaults live in the schema.** Each field uses `Schema.withDecodingDefault(Effect.succeed(x))`.
  `DEFAULT_CLIENT_SETTINGS = decodeSync(Schema)({})`. A missing file or key gives defaults. A new field needs no migration.
- **Validation.** Numbers use `Schema.Int.check` with `MIN_*` and `MAX_*` constants. Strings have max length. Binary path empty falls back to the command name (`makeBinaryPathSetting`).
- **Forward compatibility.** `ForwardCompatibleNullable`, `ForwardCompatibleOptional`, `ForwardCompatibleArray`. A value from a newer server decodes to null or is dropped, so an old client does not fail.
  Provider config is `Schema.Unknown` at the outer layer so unknown drivers survive.
- **Migrations seen.**
  - `confirmQuit`: old boolean decodes to a mode (`LegacyConfirmQuit`).
  - Old provider settings blocks decode to instances (`decodeLegacyProviderSettingsJsonExit`).
  - Model favourites move from client to server. `null` on the server means "not migrated yet" (`useMigrateModelPreferences`).
  - `projectSettingsFolded` flag: a one-time fold of old per-project maps into `projectSettingsOverrides`.
  - Keybinding "late defaults" use applied-migration ids.
- **Bad file.** If `settings.json` fails to decode, the server uses defaults, keeps the file on disk for repair, and sets
  `continueThreadsAfterServerUpdate: false` so it never resumes on a guess. It logs a warning.
- **Writes.**
  - Client: optimistic apply, then persist. If a second write lands in flight, the updater runs again on the newest snapshot (`persistClientSettingsUpdate`).
  - Server: `ServerSettingsPatch` is a partial object (`optionalKey`). Scopes are checked per key. Writes are atomic.
  - Hydration states for the client store: loading, ready, failed. Controls stay disabled until hydrated.
- **Sync.**
  - Server watches `settings.json` with `fs.watch` (and symlink targets), debounce 100 ms, then invalidates the cache and emits on `streamChanges`.
  - Clients receive config stream events: `snapshot`, `keybindingsUpdated`, `providerStatuses`, `settingsUpdated`, `environmentThemesUpdated`, `usageLimitSourcesUpdated`, `welcome` (`packages/contracts/src/server.ts`).
  - So a hand edit of the file shows in every open client.
  - Client settings do not sync between devices. The docs say so for appearance and load balancing.
- **Project overrides.** 25 keys can be overridden per project. An absent key inherits. `null` is a real value only for 5 nullable keys. The UI shows where each value comes from (`ProjectSettingSource`, `SettingInheritance.tsx`).
- **Scope in the URL.** Search params `project`, `machine`, `checkout` hold the scope. An unavailable target never widens a write.
- **Secrets split out.** Secret values are removed from the settings object before write and read back in `materializeSettingsSecrets`.
- **Tests.** Every area has `*.test.ts` next to it (for example `scopedSettings.test.ts`, `settingsSearch.test.ts`, `keybindings.test.ts`).

---

## 5. Where to look

| Feature | File in T3 Code |
| --- | --- |
| Settings routes | `apps/web/src/routes/settings.tsx`, `settings.general.tsx`, `settings.providers.tsx`, `settings.keybindings.tsx`, `settings.connections.tsx` and the rest in `apps/web/src/routes/` |
| Nav and icons | `apps/web/src/components/settings/SettingsSidebarNav.tsx` |
| Row, section, reset parts | `apps/web/src/components/settings/settingsLayout.tsx` |
| General, Appearance, Archive panels | `apps/web/src/components/settings/SettingsPanels.tsx` |
| Settings search catalog | `apps/web/src/components/settings/settingsSearch.ts` |
| Scope (project, machine) | `settingsScope.ts`, `scopedSettings.ts`, `useScopedSettings.ts`, `SettingsScopeSentence.tsx` |
| Client and server schemas | `packages/contracts/src/settings.ts` |
| Client settings hook | `apps/web/src/hooks/useSettings.ts` |
| Client persistence | `apps/web/src/clientPersistenceStorage.ts`, `apps/desktop/src/settings/DesktopClientSettings.ts` |
| Server settings service | `apps/server/src/serverSettings.ts` |
| Secret redaction | `apps/server/src/settingsSecrets.ts` |
| Secret files | `apps/server/src/auth/ServerSecretStore.ts` |
| Secret input control | `apps/web/src/components/settings/SecretInput.tsx`, `RedactedSensitiveText.tsx` |
| Provider panel and card | `ProviderSettingsPanel.tsx`, `ProviderInstanceCard.tsx`, `ProviderSettingsForm.tsx` |
| Provider status text | `apps/web/src/components/settings/providerStatus.ts` |
| Provider sign-in | `ProviderAuthenticationSection.tsx`, `ProviderAuthTerminal.tsx`, `ProviderSetupSection.tsx` |
| Add provider wizard | `AddProviderInstanceDialog.tsx`, `AddProviderInstanceDialog.logic.ts` |
| Model list and custom models | `ProviderModelsSection.tsx`, `CustomModelEditor.tsx`, `docs/internals/model-manifest.md` |
| Driver option schemas | `packages/provider-*/src/settings.ts`, `packages/contracts/src/providerInstance.ts` |
| Keybinding schema | `packages/contracts/src/keybindings.ts` |
| Defaults, parser, `when` parser | `packages/shared/src/keybindings.ts` |
| Server file, watch, merge | `apps/server/src/keybindings.ts` |
| Match and hint labels | `apps/web/src/keybindings.ts` |
| Keybinding settings UI | `KeybindingsSettings.tsx`, `KeybindingsSettings.logic.ts` |
| Keybinding warnings | `apps/web/src/components/KeybindingsConfigWarning.tsx`, `KeybindingsUpdateToast.logic.ts` |
| Command palette | `apps/web/src/components/CommandPalette.tsx`, `CommandPalette.logic.ts`, `apps/web/src/commandPaletteBus.ts` |
| Key hint widgets | `apps/web/src/components/ui/kbd.tsx`, `ui/command.tsx` |
| Load balancing | `LoadBalancingSettings.tsx` |
| Desktop menu, updates | `apps/desktop/src/window/DesktopApplicationMenu.ts`, `apps/desktop/src/updates/` |
| Mobile settings | `apps/mobile/src/features/settings/` |
| User docs | `docs/user/keybindings.md`, `install.md` (Providers), `providers-claude.md`, `providers-codex.md`, `appearance.md`, `remote-access.md`, `source-control.md` |

---

## 6. What ATOM has today, and the gap

Files read: `apps/mac/island/Sources/AtomIsland/Settings/*.swift`, `AtomIslandCore/IslandSettings.swift`, `Shortcuts.swift`,
`ShortcutMatcher.swift`, `PanelPages.swift`, `AtomIsland/PluginsView.swift`, `SearchViews.swift`, `apps/mac/src/model-settings.ts`, `ai-tools.ts`.

### 6.1 ATOM settings today

Pages (`SettingsPage` in `PanelPages.swift`): What can I ask?, Appearance, Design system, AI model, Shortcuts, Dictation, ATOM (pal), Sounds, General.
Home shows a "now" card and two groups. AI model opens from the now card.

| Area | ATOM page and rows |
| --- | --- |
| General (`GeneralPage.swift`) | Open at login; Answer without keys; daily brief card; Suggest things to remember; Notifications (one switch per `AppNotice.Kind`); Telegram status and push; Local API switch, Copy token, Regenerate token, Phone command; Computer control; Permissions card; Replay the tour. |
| AI model (`ModelPage.swift`) | Provider menu; Model menu; Custom model field (id check `isValidModelId`); Model list Refresh; error line; Allow the large model for helpers; plan meters; "Found on this Mac" list with status dots and Scan. |
| Shortcuts (`ShortcutsPage.swift`) | 5 global actions (`ShortcutAction`: talk, dictate, toggleIsland, cancel, quickAction). Recorder button, per-row reset, reset page, Input Monitoring card. |
| Dictation, Sounds, ATOM, Appearance | Mode, live preview, filler words; spoken and tone switches; pal size, movement, naps, bubble; theme cards. |
| Plugins (`PluginsView.swift`) | MCP servers (paste config or by hand, command or URL, Streamable HTTP or SSE, test, per-helper on), Skills (drafts, edits, editor), Find skills. |
| Search (`SearchViews.swift`) | Window search, Cmd+F. It searches chats, tasks, reports, notes, projects, agents, skills. I found no code that searches Settings pages. |
| Slash picker (`SlashMenu.swift`) | `/` in chat lists ATOM commands (new chat, model, skills, memory, help), skills, Claude commands. |

Storage in ATOM: island settings in `UserDefaults` (keys such as `atom.petEnabled`, `atom.look.theme`; `IslandSettings.swift`);
each shortcut is JSON of `KeyCombo` under its own key, with a "cleared" marker; model choice in `config/island.json` (`model-settings.ts`);
Telegram values in `.env` (names only shown); API token in `data/api-token`.

Shortcut rules in ATOM (`validateShortcut`): needs a strong modifier or an F key; modifier-only only for holds; reserved Cmd keys;
conflict between actions is refused (`.inUse`). Hold shortcuts work by `ShortcutMatcher` (arm delay, clean press).

### 6.2 Gap table

| Topic | T3 Code | ATOM | Gap |
| --- | --- | --- | --- |
| Settings search | Search box, about 110 rows plus one item per key command | Not found for Settings pages | Add |
| Per-row reset | Reset button shows when value differs | Per-page reset card; per-shortcut reset | Small |
| Settings scope | Project and machine scope sentence | One scope. Projects exist (ADR-107) | Later |
| Provider health | Dot, headline, version, update, refresh, interval | Dot and note per tool, Scan button | Add version, sign-in label, recheck timer |
| Provider enable and path | Switch, binary path, home dir, launch args | Not found | Add path override at most |
| API key field | Masked field, secret store | None, by rule (ADR-092) | Do not copy for models |
| Secrets for other uses | Masked field, files 0600 | Telegram token in `.env` by hand | Add masked field plus Keychain |
| Model list | Favourite, hide, order, custom, refresh | Custom, refresh | Favourite and hide |
| Auto choice | Load balancing of machines | Manual provider menu | Idea 4 below |
| Key bindings | File, `when`, UI editor, 84 commands | 5 global shortcuts; in-window keys hard-coded (Cmd+F, Cmd+S, Cmd+Return) | Command table first |
| Shortcut hints | Everywhere from live table | Only the Cmd+F tooltip found | Add |
| Command palette | Cmd+K, `>` actions, submenus | Not found. `/` picker and Cmd+F search exist | Add |
| Confirmations | 3 switches plus quit mode | Not found as settings | Optional |
| Storage cleanup | Rules and Delete now | Not found | Optional |
| Diagnostics | Processes, traces | Dashboard and Status exist (not compared) | Skip |
| Theme editor | Full editor, VS Code import | 3 looks (ADR-057) | Skip |
| Notifications | One mode select | Per-kind switches (better) | None |

---

## 7. Ideas for ATOM, ranked

Rules used: one capability at a time; no heavy dependency; secrets never in code or logs; money rule (ADR-092, ADR-093).

### 7.1 Ranked list

**1. Settings search (size S to M).**
- What: a box on Settings home. It filters rows over all pages and opens the page.
- Why: ATOM has 9 pages and many cards. T3 does this with `searchSettings` and a flat catalog.
- Rules: pure Swift logic in `AtomIslandCore`. No model call. No dependency.
- First step: a `SettingsCatalog` array of (id, title, page, terms) plus a tested `search(query)`. Show results in a list on home.

**2. Masked secret fields in Keychain, with a money-rule guard (size M).**
- What: a `SecretField` row. It shows "Stored secret, enter a new value to replace". It never shows the value. Empty input keeps the old value.
- Why: Telegram needs hand edits of `.env` today (`GeneralPage.swift` footer). T3 shows the pattern: masked input, redacted flag, no read back.
- Rules: Keychain is stronger than T3's 0600 files. Never log the value.
- Money rule: NOT for model API keys. Safe variant: use it for Telegram, GitHub token and MCP env values only.
  Add a warning row on AI model: "ANTHROPIC_API_KEY found in your environment. ATOM removes it before it runs Claude." It shows the name, never the value.
- First step: `SecretStore` protocol with a Keychain and a fake implementation. Move only the Telegram bot token. Test that the value never reaches a log.

**3. Tool health card (size S).**
- What: per tool in "Found on this Mac": version, sign-in label ("Signed in" or "Not signed in"), last check time, a per-row Check button, a background re-check (default 5 minutes, 0 = off).
- Why: T3's `getProviderSummary` gives one clear headline per tool.
- Rules: ATOM already asks `claude auth status` and `codex login status`. It never reads a login file. Keep that.
- First step: add `version` and `checkedAt` to `AiToolItem` in `apps/mac/src/ai-tools.ts`. Show them in `ModelPage.swift`.

**4. "Auto" chat tool when the plan runs out (size M).**
- What: a fourth entry in the Provider menu, "Auto". It uses Claude Code. If the plan is used up (the plan meters exist), it answers chats on Codex or the Gemini CLI as plain text. It tells the user which tool answered.
- Why: the user asked for "auto select". T3's closest feature is load balancing with weights (Prefer, Normal, Less often, Manual only).
- Money rule: safe. All three are subscription tools with API keys removed (ADR-093). It must never fall back to a key or to extra usage.
- Needs: an ADR, because ADR-093 says Codex and Gemini do not run ATOM's tools. Auto applies to plain chat only.
- First step: a pure `AutoChoice` function: inputs = tools found, signed in, plan state; output = tool. Unit tests first. No UI change.

**5. In-window command table with shortcut hints (size S, then M).**
- What: one table of in-window commands (new chat, search, next tab, open settings, send). Each has an id, a title and a default key. Show the key in menus and tooltips.
- Why: T3's strength is one source for dispatch, hints and the editor. ATOM hard-codes `keyboardShortcut` calls in views.
- First step: `WindowCommand` enum in `AtomIslandCore` with `defaultCombo` and `display`. Replace the Cmd+F hint text with it. No user editing yet.
- Later step: user overrides in `UserDefaults`, a "Window keys" card on the Shortcuts page, conflict note instead of refusal.

**6. Command palette on Cmd+K (size M).**
- What: a pure-logic list of actions, chats, settings pages, with `>` for actions only. Shows each action's key on the right.
- Why: ATOM has search and a `/` picker. The palette joins them. Items come from the catalog of idea 1 and the table of idea 5.
- Rules: deterministic first (CLAUDE.md section 9). No model call. Must be done after ideas 1 and 5.
- First step: `PaletteItem` type and a `filter(query, items)` function with tests.

**7. Shortcut file with `when` contexts (size L).**
- What: `config/keybindings.json`, rules `{ key, command, when }`, last match wins, defaults merged at start, file watched.
- Why: gives power users control. Good only after ideas 5 and 6.
- Contexts for ATOM: `islandOpen`, `chatFocus`, `composerFocus`, `dictating`, `listening`, `speaking`, `mainWindowKey`.
- Rules: an invalid rule is ignored with a visible note; a bad file uses defaults and stays on disk (T3 does this).
- First step: only the parser for `when` (T3 grammar: identifiers, `!`, `&&`, `||`, parentheses) with tests. Do not wire it.

**8. Model list: favourite and hide (size S).**
- What: star and eye buttons on each model row. The menu shows favourites first.
- First step: store a set of ids in `UserDefaults`. Apply it in `ModelSection`.

**9. Tool path override (size S).**
- What: optional "Program path" row per tool. Empty = automatic (T3's "Leave empty to select automatically").
- Rules: path only, no arguments. Reuse `RuntimeLocator`. Show the found path.
- Money rule: keep `scrubbedEnv`. Do not add an env-variable editor for these tools.
- First step: a read-only row that shows the path ATOM found.

**10. Per-row reset dot and "Reset to default" (size S).**
- What: a small reset button on each row that differs from its default. ATOM has it only for shortcuts and per page.
- First step: a `SettingDefault` helper in `IslandSettings.swift`; use it on three rows.

**11. Settings schema discipline (size S).**
- What: from T3: defaults in one place; clamp ranges; ignore unknown values; one-time migration flags; bad file kept on disk.
- First step: tests that decode an empty `UserDefaults` and a store with a bad value.

**12. Confirmations and storage cleanup (size S each, optional).**
- Confirm before deleting a chat; cleanup of old logs and reports with a "Delete now" report. Only if the user asks (CLAUDE.md section 22).

Not recommended: theme editor and VS Code import (ATOM has 3 looks), SnapShots, load balancing across machines, T3 Connect, pairing links (ATOM uses Tailscale, ADR-121), project-scope sentence (wait for per-project settings to exist).

### 7.2 Proposed ATOM settings layout (one option)

Today the General page holds 8 unrelated cards. A re-organisation helps once search exists. Do it after idea 1, as a separate small task.

| Group | Page | Rows |
| --- | --- | --- |
| (top) | Search box and Now card | Search settings; current model; plan meters |
| AI | AI tools (was AI model) | Chat tool: Claude plan, Codex, Gemini, Auto; Model; Custom model; Model list Refresh; Allow large model for helpers; Found on this Mac (version, sign-in, Check, path) |
| AI | Plugins | MCP servers; Skills; Find skills (as now) |
| Input | Shortcuts | Global (5 actions as now); Window keys (idea 5); Reset all |
| Input | Dictation | Start and stop; live preview; filler words |
| Input | Sounds | Spoken; tones; notification sounds |
| Look | Appearance | Theme |
| Look | ATOM (pal) | Show; size; movement; naps; reacts; bubble; home display |
| Connections | Connections | Telegram (masked token); Local API (switch, copy token, regenerate); Phone (Tailscale command); Computer control with Permissions |
| System | General | Open at login; Answer without keys; Notifications; Daily brief; Suggest things to remember; Confirmations (optional); Replay the tour |
| System | Design system | As now |

Rules for the layout: one idea per page; the row names stay the same so users find them; search covers every row; no new page without rows.

### 7.3 Suggested order

1 (search), 3 (health), 5 (command table), 2 (secrets, Telegram only), 4 (Auto, after an ADR), 6, 8 to 11, then 7.
Each is its own task. Stop after each (CLAUDE.md section 3).

---

## 8. What I did not find or did not check

- No "auto select provider" control in T3 Code (see 2.5).
- Where the desktop stores "Local environment" and "Network access": not found.
- Format and storage of Scheduled Tasks on the server: not checked.
- SnapShots platform limits: not checked.
- Whether T3 Code encrypts secrets at rest: no encryption found in `ServerSecretStore.ts`. Desktop Linux uses a password store for Electron (`linuxSecretStorage.ts`). Not traced further.
- The count of about 110 search rows is from my parse of `SETTINGS_SEARCH_ITEMS`. Treat it as approximate.
- ATOM: how MCP env values are stored on disk is not checked. `McpConfigImport.swift` says "private values kept on this Mac".
- ATOM: the main window menu in `MainWindow.swift` was not read in full.
