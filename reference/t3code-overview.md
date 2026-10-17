# T3 Code: overview

> Review update (2026-10-17): [second source review](t3code-second-review-2026-10-17.md) records corrections and pinned evidence. Use the [combined roadmap](../docs/upgrade-roadmap.md) for current ATOM status. Detailed observations below retain the earlier snapshot unless updated explicitly.

Source: github.com/pingdotgg/t3code (MIT licence). Read on 2026-10-17 from a shallow clone at commit `2fbd4318` (2026-10-17).
This file is a map. The detail is in the topic files listed in `README.md`; later corrections are in the second review.

## What T3 Code is

T3 Code calls itself an "agent harness control surface". It lets one person control coding agents that run on their own machine.
It controls provider tools on the host. It supports subscription sign-ins and API-key/custom-endpoint configurations. ATOM currently keeps a narrower plan-only policy; the two products do not have the same billing rules.

- Providers named in the README: Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity.
  The repository also has packages for Pi, Muse and a generic ACP provider.
- Three surfaces: web app, Electron desktop app, and a React Native mobile app (iOS and Android).
- One Node WebSocket server (`apps/server`, the package called `t3`) wraps the provider programs. All three apps are clients of it.
- The desktop app bundles the server. A phone or another computer can connect to that server over the local network, Tailscale, SSH or the "T3 Connect" tunnel.

## Rules the T3 team sets for itself (from `AGENTS.md`)

1. Open at the core: all code is public and forks are welcome.
2. Performance without compromise: they audit for slow lists, big WebSocket messages and costly animations.
3. Remote ready: every new feature must work through the WebSocket layer.
4. Multi-surface: web, desktop and mobile all get the feature where it makes sense.
5. Small models: "fight for the smallest model that makes the correct behavior unsurprising".

ATOM can use rules 2 and 5 as they are. Rule 3 matters for ATOM only if it adds a second device (see the devices file).

## Technology (verified in `package.json` and `pnpm-workspace.yaml`)

| Part | Choice |
| --- | --- |
| Language and build | TypeScript, pnpm workspaces, Vite+ (`vp` command) |
| Server | Node, Effect (`effect`, `@effect/platform-node`), SQLite, `node-pty` for terminals |
| Web | React, Vite, Clerk for sign-in (cloud features only) |
| Desktop | Electron, a Rust helper in `native/resource-monitor` |
| Mobile | React Native with Expo (`@clerk/expo`) |
| Quality | knip (unused code), oxlint with a custom plugin, many `*.test.ts` files next to the code |

ATOM is Swift plus Node. T3 Code is almost all TypeScript. The ideas move across; the code does not.

## Repository map

| Path | Role |
| --- | --- |
| `apps/server` | The WebSocket server: orchestration, providers, git, terminals, auth, keybindings file, MCP |
| `apps/web` | The React client: thread view, composer, sidebar, settings, panels |
| `apps/desktop` | Electron shell: menus, tray, updates, resource monitor, deep links |
| `apps/mobile` | React Native client |
| `apps/marketing` | The public site |
| `packages/contracts` | Shared schemas for RPC, events, settings, keybindings |
| `packages/client-runtime` | State shared by web and mobile: connections, thread history, voice input controller |
| `packages/provider-core`, `provider-acp`, `provider-*` | The provider contract and one package per provider |
| `packages/effect-acp`, `effect-codex-app-server` | Protocol clients for ACP and the Codex app server |
| `packages/source-control-core`, `source-control-*` | The host contract (GitHub, GitLab, Bitbucket, Azure DevOps, Forgejo, GitCafe) |
| `packages/ssh`, `packages/tailscale` | Remote connection helpers |
| `docs/user`, `docs/internals`, `docs/orchestration-v2` | Written documentation (see below) |

## Documents worth reading first

`docs/user` has 38 pages. These match the features the user asked about:

- Sessions and models: `permission-modes.md`, `composer.md`, `portable-handoffs.md`, `thread-migration.md`, `thread-sidebar.md`, `usage.md`
- Providers: `providers-claude.md`, `providers-codex.md`, `providers-acp.md`, `providers-opencode.md`, `providers-pi.md`, `providers-muse.md`, `providers-antigravity.md`, `cursor.md`
- Settings: `keybindings.md`, `project-settings.md`, `appearance.md`, `welcome-wizard.md`, `keyboard-focus.md`
- Git: `source-control.md`, `prompt-links.md`
- Devices and remote: `devices.md`, `remote-access.md`, `mobile-notifications.md`, `background-service.md`, `updating.md`
- Other: `terminal.md`, `html-renders.md`, `browser-import.md`, `default-browser.md`, `activity-log.md`, `outside-agents.md`, `telemetry.md`

`docs/internals` has 35 pages. The most useful for design ideas:
`overview.md` (architecture), `providers.md`, `adding-a-provider.md`, `model-manifest.md`, `context-handoffs.md`, `devices.md`, `environment-auth.md`, `remote.md`, `t3-connect.md`, `terminal-runtime.md`, `voice-input.md`, `composer-editors.md`, `composer-context-references.md`, `performance-regressions.md`.

## Design ideas visible in the architecture file

- Execution stays in the environment that owns the workspace. A remote client never uses its own files or credentials.
- The event log is the source of truth. A command is accepted, events are written in one database transaction, and side effects run after that.
- A provider turn ending and its follow-up work (checkpoint, diff, pull request discovery) are two separate milestones.
- Clients and servers upgrade on their own. The client reads the server's capability flags and never assumes a version.
- Settings have an owner: client preferences stay in the client, environment defaults and project overrides stay on the server.

## Compare with ATOM in one table

| Topic | T3 Code | ATOM |
| --- | --- | --- |
| Main use | Coding agents in projects | Voice and chat assistant with a team of agents, notch UI |
| Platform | Web, desktop, mobile | macOS only |
| Providers | 6 or more, equal in rank | Claude and Codex with checked tools/file agents; Gemini CLI text-only (ADR-137) |
| Session store | Event log in SQLite on the server | Claude/Codex live sessions, full chat archives and separate memory stores |
| Remote use | Core feature | Local API/phone page and Telegram; no T3-style environment manager |
| Voice | Dictation into the composer (iOS) | Voice is the main way to talk |

## What this research does not cover

Marketing pages, billing, Clerk sign-in, analytics and the Linux/Windows packaging are out of scope.
