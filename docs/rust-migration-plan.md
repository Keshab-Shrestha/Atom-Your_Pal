# Rust migration plan

Status: Accepted (ADR-278). The owner accepted all recommendations in section 9. This migration plan contains no migration code.

## 1. Goal

- Move ARK from Swift (app) and Node/TypeScript (runtime) to Rust, for the back end and the front end.
- Use Rune (github.com/anomalyco/rune, MIT, © 2026 Anomaly) as the UI base. Copy it into ARK and change it where ARK needs it.
- Move in many small PRs. Each PR moves one capability and proves parity with tests.
- Keep the old Swift and Node code in place until the Rust version of an area reaches parity. Then move the old area to `legacy/swift` or `legacy/node`. Do not delete it.

## 2. Non-goals

- No new features during the move. A Rust area does what the old area does, and nothing more.
- No Windows, Linux, web or iOS build. Rune supports them, but ARK stays a Mac app.
- No change to the data format in `data/` unless a phase says so.
- No change to the island protocol (`docs/island-protocol.md`) during the transition. Rust speaks it as it is.
- No local general-purpose LLM (CLAUDE.md §11 stays).

## 3. Rune: what we read

We read commit `b556a38a1ff88aa8690d21b45ebf9b9167038674` on branch `dev` (2026-11-11). The migration plan pins this commit. On 2026-11-11 `dev` moved on to `40504db3`, two commits later. Phase 0 compares the two before the copy.

Sources: README.md, crates/rune/README.md, crates/rune-kit/README.md, crates/rune-mac, crates/rune-notify, src/tray.rs, src/platform, src/spell.rs, src/system_material, examples/hello, Cargo.toml.

| Item | Finding |
| --- | --- |
| Licence | MIT, © 2026 Anomaly. Keep the copyright and permission notice in every copy. Rune has no NOTICE file. Bundled third-party files: Inter (OFL), IBM Plex Mono (OFL, `rune/assets/IBMPlexMono-LICENSE.txt`), `rune-highlights/vendor/highlights.wasm` (Apache-2.0). The ARK bundle needs its own third-party licence list. |
| Maturity | Pre-release, version 0.0.1, no releases. "Pin a rev of `dev`; `dev` is never rewritten." The project takes issues, not pull requests. |
| Size | About 309 000 lines of Rust in `crates/`. The crates ARK needs are about 281 000 lines (rune 208 k, rune-kit 42 k, rune-mermaid 14 k, rune-motion 10 k, others small). Repo 168 MB, of which `demo/` is 64 MB. `Cargo.lock` has 611 packages. |
| Toolchain | `rust-toolchain.toml` pins 1.99.1, edition 2024. No `rust-version` field, so the MSRV is the pinned toolchain. |
| Stack | winit 0.30, wgpu 30 (own Metal backend by default on macOS), Taffy 0.15, Parley 0.12, swash, AccessKit 0.25. |
| Speed (Rune's own numbers) | Settings example: 10.9 MB binary (9.3 MB stripped), mean frame CPU 0.13 ms. The first window shows content about 300 ms after launch. Rune states no build time. |
| Headless | Every app runs headless: `--snap out.png`, `--tree tree.json` (elements and the accessibility tree), `--script` input, `--trace`, `--video`, fixed virtual clock. |
| Text | Own text stack with CoreText-matched rasterising. IME with preedit and commit; dictation and the emoji picker arrive as an IME commit. Spell check (`NSSpellChecker`), rich text editing, selectable text, undo, secure fields. Rich clipboard (plain, HTML, RTF) and a secret clipboard with expiry. |
| Windows | Multiple windows, `App::window`, borderless, transparent, always-on-top, rounded corners. Custom title bar and traffic lights, window drag regions, resize on a spring, accessory app (no Dock icon). |
| Overlays | `App::overlay`: a non-activating `NSPanel` at status level on every Space, click-through unless interactive. It sits on the top or bottom edge of the primary display only. `WindowOptions::overlay(display)` (`rune/src/window/spec.rs`) gives a click-through, always-on-top window on any display. |
| Materials | `SystemMaterial::Glass` (`NSGlassEffectView` on macOS 26) and `Popover` (`NSVisualEffectView`). At most 4 per window. `backdrop_blur` blurs the app's own content. Headless renders draw a fallback fill. |
| Shell | Global shortcuts (with conflict owner lookup), native menu bar, Dock menu, `NSMenu` pop-up and context menus, standard Edit and Window menus, URL scheme handler, reopen, single instance. |
| Files and media | File dialogs (feature `native-file-dialog`), drop files in, drag out, notifications (`rune-notify`, bundled app only), audio recorder and player, video. |
| Content | Markdown (tables, code colour, diff fences, Mermaid), diff view (unified and split, virtual list), tree and table. `rune-mermaid` draws `xychart-beta` (bar, line) and `pie`. |
| Embedding | An embed host draws a Rune layer inside an AppKit or SwiftUI view (`platform/embed.rs`). |

### What Rune cannot do yet that ARK needs

| Gap | ARK feature that needs it | Evidence |
| --- | --- | --- |
| No macOS status item | Menu-bar icon (ADR-056, `WorkStrip.swift`) | `src/tray.rs`: "macOS isn't supported yet" |
| No web view | Web panels (`apps/mac/island/Web`), workspace browser, Apps pane (`WKWebView` in 4 files) | No web view in any crate |
| No terminal emulator | Workspace terminal (SwiftTerm, ADR-186) | No VT or PTY code |
| Only Glass and Popover materials | Translucent window uses `.hudWindow` and `.sidebar` (ADR-277) | `SystemMaterial` has two cases |
| No hover in a non-key panel | Island hover reveal, Pal hover | README "Edge overlays": "Unsupported: … hover in a non-key macOS panel" |
| `App::overlay` panels only on the primary display | Interactive panels on other displays (Pal, work strip) | README "Edge overlays": "Unsupported: … per-monitor placement". Full-display windows (`WindowOptions::overlay`) work on any display. |
| No chart widget API | `ark-visual` line and bar charts and dashboard charts, built from JSON data | Only Mermaid `xychart-beta` and `pie` exist |
| No Writing Tools, Services menu, text replacement or autocorrect | Composer | Text input goes through winit's text input client only |
| No login item | Launch at login (`LoginItem.swift`) | Not in Rune |

The Rune README contradicts itself in two places. "Differences from PLAN.md" says "No AccessKit" and "Scrolling is vertical only". The Accessibility and Horizontal scrolling sections describe both as present. Also, "Multiple windows" says that non-activating panels and the all-Spaces policy "are not implemented here". "Edge overlays" describes both. Phase 0 checks these claims by build.

## 4. ARK inventory

Line counts come from `wc -l` on branch `translucent-window` (2b431171).

### Swift (apps/mac/island/Sources): 53 177 lines, tests 11 664 lines

| Area | App (ArkIsland) | Core (ArkIslandCore) |
| --- | ---: | ---: |
| Shell, windows, island strip, work strip, menu-bar item, panels, protocol, runtime supervisor, computer-control cursor, draw overlay, permissions, notifications, updater | 6 564 | 4 938 |
| Board, team, helper agents, jobs, workflows, infinite canvas, office, needs-you | 6 123 | 3 412 |
| Chat, transcript, Markdown, ark-visual cards, diff cards, questions card, composer, model picker, work plans | 5 852 | 3 644 |
| Projects, workspace (terminal, browser, git, run surface), dashboard, apps, plugins, skills, MCP | 5 085 | 1 431 |
| Settings and theme (looks, translucency, design catalog) | 2 944 | 1 478 |
| Gallery (renders the goldens) | 2 344 | 0 |
| Brain, briefs, search, backup | 1 781 | 1 295 |
| Pal | 1 655 | 873 |
| Dictation and speech (capture, Parakeet, text insertion, audio ducking) | 1 310 | 583 |
| Shortcuts, quick actions, command palette, wake word | 968 | 690 |
| Helper binaries: ArkCalendar (EventKit) 127, ArkDocuments (PDF and Word text) 80, ArkPTY (C) 82 | | |

Web panels: `apps/mac/island/Web/probe` and `apps/mac/island/Web/run` hold 262 lines of HTML, CSS and JavaScript (ADR-211, `docs/web-panel-contract.md`). They run in a `WKWebView` and talk to Swift through the `arkPanel` message handler. The Run panel only shows data.

### Node/TypeScript: 40 597 source lines

The source count includes 267 lines of test harness files in `tests/` and one `.cjs` file (36 lines). It does not include the 25 371 lines of `*.test.ts` files.

| Area | Source | Tests |
| --- | ---: | ---: |
| apps/mac/src: runtime, island protocol and commands | 6 283 | |
| apps/mac/src: chats, brain wiring, skills, org, workflows, panels, backup | 4 913 | |
| apps/mac/src: native agent loop, safety policy, work plans, team | 2 843 | |
| apps/mac/src: projects, git, worktrees, folder runs | 2 178 | |
| apps/mac/src: local API, MCP server, Telegram | 2 057 | |
| apps/mac/src: computer bridge, browser, host tools | 1 940 | |
| apps/mac/src: Codex agent, AI programs, model settings | 1 674 | |
| apps/mac/src: speech (whisper.cpp, Kokoro) and embeddings | 1 362 | |
| apps/mac/src total | 23 250 | 15 915 |
| services/helpers (jobs, grants, work plans, routines, skills, SQLite store) | 7 105 | 2 735 |
| services/memory (chats, brain, briefs, projects, SQLite) | 3 559 | 1 244 |
| services/tool-engine (computer tool, Cua client, Mac tools) | 3 002 | 3 176 |
| services/llm-gateway (Claude subscription, Codex app-server, CLI providers) | 2 477 | 1 436 |
| services/decision-engine (Laya) 305, services/core 33, packages 599, tests harness 267 | 1 204 | 865 |
| Total | 40 597 | 25 371 |

Data: `data/memory.db` and `data/helpers.db` (SQLite through `node:sqlite`, WAL mode), plus JSON files (`island.json`, `org.json`, `workflows.json`, `panels.json` and more). More than 20 Node source files import `@ark/memory`, and more than 40 import `@ark/helpers`. Settings: `UserDefaults` (49 uses in Swift), domain of bundle `dev.ark.island`. UI goldens: 73 PNG files in `tests/ui-golden`.

### macOS-only by nature, and the Rust path

| Capability | Today | Rust path |
| --- | --- | --- |
| Accessibility (`AXUIElement`), text insertion | `TextInserter.swift` | `objc2-application-services` in a new `ark-mac` crate |
| Global hotkey | `RegisterEventHotKey` in `ShortcutEngine.swift` | Rune `App::global_shortcut` |
| Menu-bar item | `NSStatusItem` in `WorkStrip.swift` | `objc2-app-kit` `NSStatusItem`, added to the Rune copy |
| Notifications | `UNUserNotificationCenter` in `Notifier.swift` | `rune-notify` |
| Keychain | `SecItem` in `ComputerDecisionModel.swift` | `security-framework` crate or `objc2-security` |
| Window list | `CGWindowList` in `PetController.swift`, `WindowPick.swift` | `objc2-core-graphics` |
| AppleScript | `NSAppleScript` (audio ducking), `osascript` (Node tools) | Spawn `osascript`, as Node does today |
| Microphone | `AVAudioEngine` in `DictationCapture.swift` | Rune `Recorder`, or the dictation helper (section 5) |
| Speech to text | FluidAudio Parakeet on the Neural Engine (Swift) | Swift helper (section 5) |
| Calendar, PDF text | ArkCalendar, ArkDocuments (already helpers) | Keep as they are |
| Computer control | Cua driver (`cua-driver mcp`, external) | Spawn the same driver; MCP client with the `rmcp` crate |
| Web views | `WKWebView` | `objc2-web-kit` child view over the Rune layer (verify in Phase 0) |

In this migration plan, a "helper" is a separate program that ARK starts and talks to with line-delimited JSON on stdio. It is not an ARK helper agent.

## 5. Hard risks, with evidence

### (a) Claude subscription, and other providers

- ADR-055: the provider `claude-plan` runs `@anthropic-ai/claude-agent-sdk`. The SDK starts the user's own signed-in `claude` program (`pathToClaudeCodeExecutable`, `claude-session.ts:215`). ARK never reads or stores a login. ADR-064 pre-starts the next process.
- `claude-session.ts` uses SDK features beyond plain text: `createSdkMcpServer` (ARK tools in process), `canUseTool`, `PreToolUse` hooks, `resume`, `includePartialMessages`, `thinking`, `effort`, `sandbox`, `plugins`, `agents`.
- SECURITY.md (Phase N2): Claude Code may not call `canUseTool` for a background sub-agent. So every sub-agent decision happens in the `PreToolUse` hook. Any other path must give the same hook.
- There is no Anthropic Rust Agent SDK. Rust can start the same `claude` program directly. This is the same own-sign-in pattern as the SDK.
- Default: keep a thin Node helper, `claude-bridge`. It holds about 1 400 lines (`claude-session.ts`, `claude-plan-job.ts`, `plan-support.ts`, `tool-summary.ts`). It talks to the Rust runtime with line-delimited JSON. Each `canUseTool` call, hook and ARK tool call goes back to Rust. So the policy stays in Rust (CLAUDE.md §12).
- Phase 2 spike "direct CLI and hooks": Rust starts `claude` with stream-json input and output. It gives an MCP config for a Rust MCP server with the ARK tools and a permission-prompt tool. It gives command hooks through `--settings`; the `PreToolUse` hook asks the Rust runtime.
- Spike exit: the ADR-055 guard tests pass against a fake `claude` (`apiKeySource`, extra usage, scrubbed environment). The `native-safety` tests pass for the main thread and for sub-agents, with one decision for each call id. Streaming, `resume`, thinking and effort work. A live check on a fixture chat passes, with the owner's consent first. If all pass, the direct path replaces `claude-bridge`.
- Verdict: manageable.
- Codex: `codex app-server --stdio` (JSON-RPC over stdio). Port directly to Rust.
- Gemini, Copilot, OpenCode: one CLI run per turn (ADR-093, ADR-270). Port directly to Rust with `std::process::Command`. Keep the same flags and environment scrubbing.
- API-key providers: plain HTTPS. Use `reqwest`.

### (b) Speech

- Dictation uses FluidAudio Parakeet on the Neural Engine (Swift only). The owner chose Parakeet only. Verdict: manageable.
- Move the Parakeet code into a Swift helper `ark-dictation` (the ArkCalendar pattern).
- A Rust ONNX path (sherpa-onnx) runs on the CPU only. Do not use it unless it matches quality and latency.
- whisper.cpp: Node spawns `whisper-cli` today. Rust spawns the same binary.
- Kokoro TTS: Node runs `kokoro-js` in a child process. Keep it as a Node helper until a Rust `ort` port passes the TTS tests. Check the licence of the phonemizer before the port.
- Embeddings: `@huggingface/transformers` today. Use `ort` with the same model files. Parity test: same vectors within 1e-4.

### (c) Text input fidelity: the biggest UI risk

- Rune draws its own text fields. It has IME, dictation commit, spell check, rich text, rich paste and undo.
- AppKit text views also give Writing Tools, the Services menu, text replacement, autocorrect, Look Up and grammar check. Rune has none of these.
- ARK's composer is an `NSTextView` today (`ComposerPaste.swift`, `ConversationView.swift`).
- Verdict: manageable, high risk. Port the composer last among the chat parts.
- Phase 0 tests Japanese IME, macOS dictation, the emoji picker and paste in a Rune field.
- Fallback: a native `NSTextView` as a child view over the Rune layer, for the composer only.
- Dictation into other apps (`TextInserter`) does not depend on the UI toolkit. It moves to `ark-mac` unchanged.

### (d) Accessibility and VoiceOver

- Rune exposes elements through AccessKit (NSAccessibility on macOS). `--tree` dumps the accessibility tree, so tests can check labels.
- Verdict: manageable. For each screen, list the SwiftUI accessibility labels. Check that the Rune tree has the same labels. Check VoiceOver by hand on each screen before its exit.
- The live step of `scripts/ui-check.sh` reads the window text through Accessibility. Keep that check for the Rune window.

### (e) Snapshot and golden tests

- Today: the Swift gallery renders 73 goldens with `ImageRenderer`. `png-diff.swift` fails at more than 1 % changed pixels.
- Rune: headless `--snap` on a fixed virtual clock, plus `--tree` JSON. Two toolkits never draw the same pixels. So a pixel compare between Swift and Rune is not a test.
- Verdict: manageable. Each ported screen gets three checks. First, the owner signs off a side-by-side PNG once. Second, a Rune golden goes in `tests/ui-golden-rune/` (same 1 % rule). Third, a tree assertion file (texts, roles, keys) must match. Keep the Swift goldens until Phase 4.
- System materials draw a fallback fill headless. Check the real blur by an on-screen capture, as ADR-277 does.

### (f) Data migration

- SQLite: use `rusqlite` with bundled SQLite on the same files. Keep the schema.
- Shared writes, not a store RPC. A store RPC turns synchronous `node:sqlite` calls in more than 60 files into calls across processes. Shared writes need two small changes only.
- Rule 1: Node and Rust both open each database in WAL mode with a busy timeout. SQLite's lock lets one writer at a time. Node gets the busy timeout in Phase 2 step 2.
- Rule 2: Node owns the schema until the last Node area that writes a database moves. Rust checks the expected tables and columns when it opens a database. It refuses to start on a mismatch.
- Rule 3: Rust keeps no cached rows between commands while Node can write.
- Parity test: copy a fixture database, run the same queries in TypeScript and in Rust, compare the rows.
- JSON files in `data/`: same files, same format (`serde_json`). One area owns each JSON file. That file moves with its area.
- Settings: keep `UserDefaults` in domain `dev.ark.island` through `objc2-foundation`. No import step. Same keys.
- Verdict: manageable.

### (g) Distribution, signing and updates

- `build-app.sh` signs with the "ARK Local Signing" identity and identifier `dev.ark.island`. macOS keeps Accessibility, Input Monitoring, microphone and calendar grants per bundle identifier and signature.
- Keep the bundle identifier and the signing identity at cutover, so the grants stay. Verify on a test bundle before Phase 4.
- `AppUpdater` runs `git pull` and rebuilds. After cutover it runs `cargo build --release`.
- `scripts/setup.sh` and `install-ark.command` must install `rustup` with the pinned toolchain. Node stays required while `claude-bridge` exists.
- Licences: add `reference/licenses/Rune-MIT.txt`, IBM Plex Mono (OFL) and the Apache-2.0 text for `highlights.wasm`. Make one `THIRD_PARTY.txt` licence list for the bundle. Phase 0 lists every crate licence for it.
- Verdict: manageable.

## 6. Target architecture

### Cargo workspace (create each crate only in the phase that needs it)

```text
rust/
  Cargo.toml              workspace
  rust-toolchain.toml     1.99.1 (same as Rune)
  vendor/rune/            Rune copy: rune, rune-kit, rune-motion, rune-staging, rune-taffy,
                          rune-mac, rune-notify, rune-highlights, rune-mermaid, LICENSE,
                          UPSTREAM.md (source SHA, list of ARK patches)
  crates/
    ark-protocol/         island protocol types and line-delimited JSON codec (serde)
    ark-core/             pure logic: policy, org, job tree, parsers. No I/O.
    ark-store/            SQLite (rusqlite) and data/ JSON files
    ark-gateway/          provider adapters: Codex, CLI providers, API providers, claude-bridge client
    ark-runtime/          chats, jobs, tools, memory, scheduler, local API, MCP server, Telegram; binary `ark-runtime`
    ark-mac/              macOS glue through objc2: AX, status item, Keychain, UserDefaults, login item, window list
    ark-ui/               Rune screens and ARK components (charts, ark-visual cards)
    ark-app/              binary: the Rune app; ARK.app main executable after Phase 4
helpers/
  claude-bridge/          Node: the Agent SDK only (section 5a)
  kokoro/                 Node: Kokoro TTS until ported
  ArkCalendar, ArkDocuments, ark-dictation   Swift
```

### Process model

| Phase | UI | Runtime | Link |
| --- | --- | --- | --- |
| Today | Swift app (parent) | Node runtime (child) | stdin and stdout, JSON lines |
| 1 | Swift app | Node runtime | No change. `ark-core` runs in tests only. |
| 2 | Swift app (parent) | `ark-runtime` (child). It starts the Node runtime as its child. It forwards each command that it does not own yet. | Same JSON lines on both links |
| 3 | Swift app (parent) and Rune app (second client) | `ark-runtime` | Swift: stdio. Rune app: a Unix socket in the data folder (mode 0600), same JSON lines. |
| 4 | Rune app, one process with `ark-runtime` linked as a library | Same process | Helpers on stdio, JSON lines |

The target is one Rust process. Helpers stay separate processes. They wrap code that Rust cannot reach well (Agent SDK, FluidAudio, EventKit, PDFKit). Or they are programs that ARK does not own (Cua driver, `claude`, `codex`).

## 7. Phases

Every PR follows CLAUDE.md §3 and §21: one capability, tests, verify, docs, stop. Verify on fixtures, never on live data (CLAUDE.md §17).

### Phase 0: toolchain, Rune copy, hello window (3 to 4 PRs)

- Status: PR 1 (Phase 0.1) is done. It adds the `rust/` workspace, toolchain 1.99.1, the Rune copy at `b556a38`, the `ark-hello` window (headless PNG and `--tree`) and the CI job `rust`. The text, window and native-view spike checks are still open.
- Scope: `rust/` workspace, pinned toolchain, Rune copy at `b556a38`, CI job `rust` on `macos-latest` (`cargo test`, `cargo clippy`), `ark-app` hello window.
- Deliverables: a headless PNG and `--tree` JSON of the hello window as CI artifacts; `UPSTREAM.md`; `THIRD_PARTY.txt`.
- Spike checks, build: clean and incremental build time; binary size. Record the numbers in STATUS.md.
- Spike checks, text: Japanese IME, macOS dictation, the emoji picker and paste in a Rune field. VoiceOver on hello.
- Spike checks, windows: `NSStatusItem` through objc2 next to a Rune window. Hover in a non-key panel. A `WindowOptions::overlay` window on a second display, and whether a click on it activates ARK.
- Spike checks, native views: `NSVisualEffectView` `.hudWindow` behind a transparent Rune window. A `WKWebView` child view over the Rune layer. The Rune embed host inside a SwiftUI view.
- Exit: CI green. Every spike check has a recorded result: works, works with a patch, or does not work.
- Risks: build time on CI; Rune claims that are stale. Rollback: delete `rust/` and the CI job. Nothing else changes.

### Phase 1: Rust core library for pure logic (8 to 10 PRs)

- Status: `rust/crates/ark-core` has the safety policy (pure parts), org, job tree (with the quiet mark), `ark-visual`, questions, diffs and the shortcut matcher. The protocol codec (`ark-protocol`) is open. The parity fixtures come from the TypeScript code (`rust/scripts/gen-fixtures.ts`). The Swift-only areas have their Swift tests ported to Rust, but no shared vector file yet.
- Scope: `ark-protocol` and `ark-core`. One PR per area:
  - protocol codec (`island-protocol.ts`, `Protocol.swift`);
  - safety policy (pure parts of `native-safety.ts`, `write-scopes.ts`, `grants.ts`);
  - org and chain of command (`org.ts`, `OrgChart.swift`);
  - job tree (`jobs.ts`, `JobTree.swift`);
  - `ark-visual` parser (`ArkVisual.swift`) and questions card parser (`ChatQuestions.swift`);
  - unified and text diff (`UnifiedDiff.swift`, `TextDiff.swift`, `InlineDiff.swift`);
  - shortcut matcher (`ShortcutMatcher.swift`).
- Parity tests: write each existing test case once as a JSON vector in `tests/parity/<area>.json` (input, expected output). The TypeScript or Swift test and the Rust test both read the same file. The vector file must pass in both before the PR merges.
- Wiring: none. The running app does not call Rust in Phase 1. A later PR can add a napi-rs shadow check, if the owner wants one (decision 3).
- Exit: all vectors pass in CI for both languages.
- Risks: TypeScript and Swift give different answers for the same input today. A vector shows it. Record it as a decision; do not fix it silently. Rollback: delete the crate; the app does not change.

### Phase 2: Rust runtime replaces Node, one area at a time (20 to 30 PRs)

- Scope: `ark-store`, `ark-gateway`, `ark-runtime`, `helpers/claude-bridge`.
- First PR: `ark-runtime` as a pure forwarder. The Swift app starts it when `ARK_RUNTIME=rust`. It starts the Node runtime and forwards every line both ways. Exit: the smoke test (`tests/smoke.test.ts`) passes through it.
- Then move areas, least risky first. Each move makes Rust answer the commands of that area. Rust stops forwarding them.
  1. Read-only commands: status, chat list, search, usage, stats, brain read. Rust reads the databases; Node writes them.
  2. Shared database access (section 5f): busy timeout in Node, schema check in `ark-store`.
  3. Scheduler, watches, routines.
  4. Simple tools: time, weather, timers, notes, apps, media, front window, calendar (ArkCalendar).
  5. Local API (HTTP on 127.0.0.1 with token) and the MCP server (`rmcp`).
  6. Telegram.
  7. CLI providers (Gemini, Copilot, OpenCode), then Codex app-server, then API providers.
  8. `claude-bridge` helper for the Claude subscription. Rust answers the ARK tools and the safety gate. Run the "direct CLI and hooks" spike (section 5a).
  9. Native agent loop, work plans, team, jobs, workflows (uses the Phase 1 policy, org and job tree).
  10. Computer control (Cua driver client, point marker, learned shortcuts).
  11. Speech: whisper.cpp spawn, Kokoro helper, embeddings.
  12. Projects, git, worktrees, folder runs, skills, backup.
  13. Schema ownership of `memory.db` and `helpers.db` moves to Rust.
- Parity tests per area: port the TypeScript tests of the area to Rust. Record golden transcripts on a fixture data folder. Send a fixed command list to the Node runtime and save the event lines. Rust must send the same lines, ignoring times and ids.
- Exit per area: the ported tests and the transcripts pass. The TypeScript of the area moves to `legacy/node` when nothing calls it.
- Exit for step 13: no active Node source file writes `memory.db` or `helpers.db`. Every schema test passes in Rust.
- Exit for Phase 2: Node answers no command except through `claude-bridge` and the Kokoro helper (if not yet ported). `ARK_RUNTIME=rust` becomes the default.
- Risks: two writers on one database (section 5f rules). Subtle event-order changes that the Swift UI depends on (the transcripts catch them).
- Rollback: `ARK_RUNTIME=node` starts the old runtime directly. For one area, take the area off the Rust owner list.

### Phase 3: Rust UI replaces Swift screens, one screen at a time (45 to 70 PRs)

- Scope: `ark-ui`, `ark-app`, `ark-mac`, Rune patches.
- The Rune app connects as a second client (Unix socket) to the runtime that the Swift app started. The owner opens a ported screen in the Rune app with `ARK_UI_PREVIEW=<screen>`. The Swift app stays the daily app.
- Order, least risky first:
  1. Settings window (forms and switches).
  2. Dashboard, usage and stats. Build an ARK chart component on Rune shapes; Mermaid `xychart-beta` is a first-version option.
  3. Brain, briefs and search views.
  4. Board, team and workflows (infinite canvas, drag).
  5. Projects and workspace views (git view; diff card from rune-kit Diff). Web panels and terminal come later.
  6. Chat transcript, read only: Markdown, `ark-visual` cards (with the chart component from step 2), diff cards, questions card, plan notes.
  7. Composer, model picker, slash and mention menus (text input risk, section 5c).
  8. Main window shell: sidebar, top bar, translucent window (Rune patch for `.hudWindow` and `.sidebar`).
  9. Workspace terminal (`alacritty_terminal` on a Rune canvas). Run panel as a Rune screen (it only shows data). `WKWebView` child view for the workspace browser and the Apps pane.
  10. Floating surfaces: island panel, work strip, quick action panel, voice pill, agent cursor, draw overlay. They need Rune patches for panels on any display and for hover in a non-key panel.
  11. Pal and its bubble.
  12. Menu-bar item (`NSStatusItem` patch), dictation UI and text insertion (`ark-mac`, `ark-dictation` helper).
- Parity tests per screen: Rune golden PNG, tree assertion file and accessibility label list. The owner signs off the side-by-side PNG once. Port the Swift core tests of the screen to Rust.
- Exit: the owner signs off every screen. The Rune app passes the live UI check (Accessibility text read) on a fixture data folder.
- Risks: text input (5c); floating panels need Rune patches; motion can make a 1 % pixel rule flaky (use the fixed virtual clock).
- Rollback: the Swift app does not change. It stays the default until Phase 4.

### Phase 4: cutover (4 to 6 PRs)

- Scope: the Rune app becomes `ARK.app` with `ark-runtime` linked in. Installer and updater changes. Legacy move.
- Build: a new build script builds `ark-app`, `ark-dictation` and the existing helpers, and copies the Node helpers. It signs with "ARK Local Signing" and identifier `dev.ark.island`. It keeps the `Info.plist` usage strings and URL scheme.
- Install and update: `setup.sh` and `install-ark.command` install the pinned Rust toolchain. `AppUpdater` rebuilds with cargo.
- Legacy: `apps/mac/island` moves to `legacy/swift`. The remaining Node code moves to `legacy/node`. CI stops the Swift and visual jobs for legacy code and runs the Rune visual job.
- Parity tests: all Rust tests, all Rune goldens, the smoke test and the live UI check. A fresh-install test on a clean macOS user account: macOS asks for each grant once and keeps it after a rebuild.
- Exit: one week of the owner's daily use with no return to the Swift app.
- Risks: lost macOS grants if the identifier or signature changes; longer update builds.
- Rollback: the previous Swift bundle stays in the build folder as `ARK-swift.app` for one release. `legacy/` code builds by hand.

### Size estimate

- Phases 0, 1, 2 and 4: about 35 to 50 PRs.
- Phase 3: 45 to 70 PRs. The first estimate (25 to 35) was optimistic. It gave each PR 1 500 to 2 100 lines of Swift to replace, which is not one small capability. Also, at least 6 Rune patches need their own PRs.
- Total: about 80 to 120 PRs.

## 8. What stays outside Rust as a helper

| Capability | Stays as | Why | Replace when |
| --- | --- | --- | --- |
| Claude subscription (Agent SDK) | Node helper `claude-bridge` | No Rust Agent SDK. In-process tools, `canUseTool` and hooks use the SDK. | The "direct CLI and hooks" spike passes its exit (section 5a) |
| Parakeet dictation | Swift helper `ark-dictation` | FluidAudio is Swift and Core ML (Neural Engine) | A Rust path matches quality and latency |
| Calendar and Reminders | Swift helper ArkCalendar | EventKit | Not needed |
| PDF and Word text | Swift helper ArkDocuments | PDFKit | Not needed |
| Kokoro TTS | Node helper (`kokoro-js`) | Phonemizer and model port not done | A Rust `ort` port passes the TTS tests |
| Computer control | Cua driver (external program) | Already a separate MCP program | Not needed |
| Browser automation | `agent-browser` program | External program | Not needed |
| Workspace browser, Apps pane | `WKWebView` child view in a Rune window | Rune has no web view | Not needed |
| Menu-bar item, AX, Keychain, login item | objc2 code in `ark-mac` and the Rune copy | Rune does not have them | Rune adds them upstream |

## 9. Decisions (all accepted as recommended)

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| 1 | How to hold Rune | (A) a Rune copy (subset) in `rust/vendor/rune` with `UPSTREAM.md`; (B) a GitHub fork pinned by rev; (C) the upstream repo pinned by rev with `[patch]` entries | A. The owner asked to copy and change it. The copy skips `demo/`, `site/`, `www/` and most examples (about 22 MB, 281 000 lines). Rune takes no pull requests, so ARK patches stay local. |
| 2 | Claude subscription | (A) Node helper `claude-bridge`; (B) direct `claude` CLI with hooks from Rust; (C) API keys only | A as the default; spike B in Phase 2 step 8. C drops the Claude subscription. |
| 3 | Phase 1 wiring | (A) napi-rs shadow check of the policy; (B) a helper process; (C) no wiring until Phase 2 | C. A adds a cargo build to the Node runtime for a check only. Add A later if the owner wants it. |
| 4 | Rune app during Phase 3 | (A) second client over a Unix socket; (B) separate parent on a fixture data folder only | A. The owner can try each screen on real chats. |
| 5 | Settings store | (A) keep `UserDefaults` (`dev.ark.island`); (B) a new `data/settings.json` with a one-time import | A. No migration step. |
| 6 | Dictation engine | (A) Swift helper with FluidAudio; (B) sherpa-onnx in Rust (CPU) | A. It keeps the quality of today. |
| 7 | Workspace terminal | (A) `alacritty_terminal` (Apache-2.0) on a Rune canvas; (B) SwiftTerm in a helper window | A. B keeps a Swift UI forever. |
| 8 | Web panels and web views | (A) the Run panel becomes a Rune screen. A `WKWebView` child view shows the workspace browser and Apps pane. (B) keep the `Web/` HTML panels in a `WKWebView` child view with the `arkPanel` message handler. (C) open pages in the default browser. | A if the Phase 0 spike works. The Run panel only shows data, so it needs no web view. Else C. |
| 9 | Composer fallback | (A) Rune text field; (B) native `NSTextView` child view | A. Keep B ready if the Phase 0 IME and dictation checks fail. |
| 10 | Legacy code after the move | (A) kept, not built in CI; (B) kept and built in CI | A. Legacy is reference code. |
| 11 | Rune gaps | (A) patch the Rune copy and open an upstream issue for each gap; (B) patch only | A. Upstream fixes make the patch list shorter. |

## 10. To verify in Phase 0 (this migration plan did not check these claims by build)

- Rune builds with toolchain 1.99.1 on the CI macOS image. Record the build time.
- The changes between `b556a38` and `40504db3` on `dev`.
- Rune's AccessKit adapter works with VoiceOver (README sections disagree).
- Non-activating panels on all Spaces, including full-screen Spaces (README sections disagree).
- macOS dictation and Japanese IME in a Rune text field.
- `NSStatusItem`, `.hudWindow` material and `WKWebView` work next to the Metal layer of Rune.
- The embed host runs inside a SwiftUI view with keyboard and IME input.
- The installed `claude` has the flags for option 2B: stream-json input and output, `--mcp-config`, `--strict-mcp-config`, `--permission-prompt-tool`, `--settings` hooks, `--resume`. Hooks from `--settings` run with no other setting sources.
- The licences of every crate in the Rune subset.

## 11. Credit

Rune by Anomaly (github.com/anomalyco/rune), MIT licence, is the UI base. ARK keeps its licence file in `rust/vendor/rune/LICENSE` and ships it in the app bundle, in `THIRD_PARTY.txt`.
