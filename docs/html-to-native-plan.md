# Plan: bring the preview UI into the native app — 28 October 2026

## Goal

Move the design in `design/current-ui.html` (the preview) into the macOS app.
Use Swift for the app shell and for anything that acts.
Use HTML in a web view for read-only visuals that change often.

## Facts

- The app is SwiftUI, macOS 14, built with SwiftPM (`apps/mac/island/Package.swift`).
- `AtomIsland` has 139 Swift files (25,495 lines). `AtomIslandCore` has 109 files (14,734 lines) and is testable without a screen.
- The app talks to a Node runtime. The runtime is a child process. Messages are JSON over stdin and stdout (`RuntimeSupervisor.swift`, `Protocol.swift`).
- One web view exists: `WorkspaceBrowserSession.swift`. It uses a non-persistent store and a navigation delegate.
- The preview is one file of 3.5 MB. It holds fictional data and a simulated chat engine.
- `docs/current-ui-preview.md` says the preview is not a second application frontend. This plan changes that rule for read-only panels only.
- The native app already has Dashboard, Board, Needs you, Scheduled, Brain, Plugins and Settings.
- The preview adds items that the native app does not have. A search found no native "Pipeline" view, no "Rewind" and no split-view panel resizing.
- `apps/ios` is empty. No phone app exists. The preview phone layout has no native target yet.

## Decision needed

| Option | What it means | Effort | Risk |
|---|---|---|---|
| A. Hybrid (recommended) | Native shell. Web panels for read-only visuals. | Medium | Low |
| B. Full native port | The preview is a spec. All screens become SwiftUI. | High | Low |
| C. Full web UI | The app window is one web view. Swift is a bridge. | Medium | High |

Option C reverses the current design (native shell, ADR-089). It also risks keyboard, VoiceOver, text scaling and startup speed. Do not choose C without a new ADR.

## Rules for a web panel

These rules follow `CLAUDE.md` sections 8, 12 and 14.

1. Load only files from the app bundle. Allow no network.
2. Set a CSP of `default-src 'none'` plus the bundle files the panel needs.
3. Block every navigation after the first load.
4. Use `WKWebsiteDataStore.nonPersistent()`.
5. Never put the local API token or any secret in the page.
6. Swift sends data to the page with `callAsyncJavaScript` and typed arguments. Never build JavaScript from text.
7. The page sends back only named intents through one `WKScriptMessageHandler`. Swift checks each intent against a list and a Codable schema. Swift then uses the normal command path and the policy engine.
8. The page never decides permission. Swift decides.
9. The page escapes all untrusted text.

## Phases

Each phase is one capability. Each phase ends with tests, a `git diff` check and a doc update.

### Phase 0 — Decide and record

Status: done on 28 October 2026. Option A is chosen. See ADR-211 and [the panel contract](web-panel-contract.md).

- Choose option A, B or C.
- Write one ADR in `DECISIONS.md`.
- Write the panel contract: the data shape in, the intents out.

### Phase 1 — Web panel host

- Add `WebPanelView` in `AtomIsland`.
- Add `WebPanelPolicy` in `AtomIslandCore`. It holds the navigation rules and the intent parser.
- Put the page files in a SwiftPM resource folder. Update `build-app.sh` to copy them.
- Send the theme from `Theme.swift` to the page as CSS variables. Send the text scale too.
- Add a fixture to the native gallery.
- Test the policy and the parser with `pnpm island:test`.
- Check light, dark and larger text. Check VoiceOver.

### Phase 2 — First panel: Run panel

- Show the Run panel in the chat details view. It is read-only.
- Map real events to the panel data. Use tasks, evidence and usage events that exist now.
- Show "not available" for lanes and pipeline steps. The runtime sends no such events yet. Add them in a later phase.
- Remove the simulated engine from the panel code.

### Phase 3 — Native ports

These ports touch other files than Phase 1 and 2. They can run in parallel.

- Token mix redesign in `DashboardUsageCharts.swift`.
- Needs you inbox: filters and selection in `NeedsYouView.swift`.
- Chat list: project filter, pinned items and hover actions.
- Settings: compare the preview groups with the 13 native pages. Change only the differences.
- Resizable panels in the chat workspace (`ChatWorkspaceLayout.swift`).

### Phase 4 — Close out

- Update `docs/current-ui-preview.md`. Keep the preview as the design reference.
- Write a parity list: each preview screen, its native file and its status.
- Update `TASK.md` and `STATUS.md`.

### Later — Phone

- Decide if an iOS app is in scope. `apps/ios` is empty.
- If yes, the preview phone layout is the design reference. Web panels can be reused.

## Risks

- The preview file is large because of embedded images. Panel files must not include them.
- Two sources of design tokens can drift. Generate the CSS variables from `Theme.swift`.
- A web view can steal keyboard shortcuts. Test ⌘ keys and focus in the panel.
- Each web view costs memory and start time. Load a panel only when it shows.
- The preview uses `localStorage`. A non-persistent store does not keep it. Keep state in Swift.
- The package uses Swift 6. Put the message handler on the main actor.

## Questions for Keshab

1. Option A, B or C?
2. Is the Run panel the right first web panel?
3. Is a phone app in scope now or later?
