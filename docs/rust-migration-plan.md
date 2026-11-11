# Rust migration plan

Status: Proposed (ADR-278). This file is a plan. It contains no migration code.

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

Read at commit `b556a38a1ff88aa8690d21b45ebf9b9167038674` on branch `dev` (2026-11-11). Sources: README.md, crates/rune/README.md, crates/rune-kit/README.md, crates/rune-mac, crates/rune-notify, src/tray.rs, src/platform, src/spell.rs, src/system_material, examples/hello, Cargo.toml.

| Item | Finding |
| --- | --- |
| Licence | MIT, © 2026 Anomaly. Keep the copyright and permission notice in every copy. Rune bundles Inter (OFL). |
| Maturity | Pre-release, version 0.0.1, no releases. "Pin a rev of `dev`; `dev` is never rewritten." The project takes issues, not pull requests. |
| Size | About 309 000 lines of Rust in `crates/`. The crates ARK needs are about 281 000 lines (rune 208 k, rune-kit 42 k, rune-mermaid 14 k, rune-motion 10 k, others small). Repo 168 MB, of which `demo/` is 64 MB. `Cargo.lock` has 611 packages. |
| Toolchain | `rust-toolchain.toml` pins 1.99.1, edition 2024. No `rust-version` field, so the MSRV is the pinned toolchain. |
| Stack | winit 0.30, wgpu 30 (own Metal backend by default on macOS), Taffy 0.15, Parley 0.12, swash, AccessKit 0.25. |
| Speed (Rune's own numbers) | Settings example: 10.9 MB binary (9.3 MB stripped), mean frame CPU 0.13 ms, first window with content about 300 ms after launch. Build time: not stated. |
| Headless | Every app runs headless: `--snap out.png`, `--tree tree.json` (elements and the accessibility tree), `--script` input, `--trace`, `--video`, fixed virtual clock. |
| Text | Own text stack with CoreText-matched rasterising. IME (preedit and commit, dictation and emoji picker arrive as IME commit), spell check (`NSSpellChecker`), rich text editing (marks, blocks), selectable text, undo, secure fields, rich clipboard (plain, HTML, RTF), secret clipboard with expiry. |
| Windows | Multiple windows, `App::window`, borderless, transparent, always-on-top, rounded corners, custom title bar and traffic lights, window drag regions, resize on a spring, accessory app (no Dock icon). |
| Overlays | `App::overlay`: non-activating `NSPanel` at status level on every Space, click-through unless interactive. Top or bottom edge of the primary display only. `WindowOptions::overlay(display)` covers one display. |
| Materials | `SystemMaterial::Glass` (`NSGlassEffectView` on macOS 26) and `Popover` (`NSVisualEffectView`). At most 4 per window. `backdrop_blur` for the app's own content. Headless renders draw a fallback fill. |
| Shell | Global shortcuts (with conflict owner lookup), native menu bar, Dock menu, `NSMenu` pop-up and context menus, standard Edit and Window menus, URL scheme handler, reopen, single instance. |
| Other | File dialogs (feature `native-file-dialog`), drop files in, drag out, notifications (`rune-notify`, bundled app only), audio recorder and player, video, Markdown (tables, code colour, diff fences, mermaid), diff view (unified and split, virtual list), tree and table, embed host for a Rune layer inside an AppKit or SwiftUI view (`platform/embed.rs`). |

### What Rune cannot do yet that ARK needs

| Gap | ARK feature that needs it | Evidence |
| --- | --- | --- |
| No macOS status item | Menu-bar icon (ADR-056, `WorkStrip.swift`) | `src/tray.rs`: "macOS isn't supported yet" |
| No web view | Web panels, workspace browser, Apps pane (`WKWebView` in 4 files) | No web view in any crate |
| No terminal emulator | Workspace terminal (SwiftTerm, ADR-186) | No VT or PTY code |
| Only Glass and Popover materials | Translucent window uses `.hudWindow` and `.sidebar` (ADR-277) | `SystemMaterial` has two cases |
| No hover in a non-key panel | Island hover reveal, Pal hover | README "Edge overlays": "Unsupported: … hover in a non-key macOS panel" |
| Overlay placement is top or bottom edge of the primary display | Pal walks across displays, agent cursor, draw overlay | README "Edge overlays": "Unsupported: … per-monitor placement" |
| No charts | `ark-visual` line and bar charts, dashboard charts | No chart component in rune-kit |
| No Writing Tools, Services menu, text replacement or autocorrect | Composer | Text input goes through winit's text input client only |
| No login item | Launch at login (`LoginItem.swift`) | Not in Rune |

The README contradicts itself in two places. "Differences from PLAN.md" says "No AccessKit" and "Scrolling is vertical only", but the Accessibility and Horizontal scrolling sections describe both as present. "Multiple windows" says non-activating panels and all-Spaces policy "are not implemented here", but "Edge overlays" describes them. Phase 0 checks these claims by build.

## 4. ARK inventory

Line counts come from `wc -l` on branch `translucent-window` (2b431171).

### Swift (apps/mac/island/Sources): 53 177 lines, tests 11 664 lines

| Area | App (ArkIsland) | Core (ArkIslandCore) |
| --- | ---: | ---: |
| Shell, windows, island strip, work strip, menu-bar item, panels, protocol, runtime supervisor, computer-control cursor, draw overlay, permissions, notifications, updater | 6 564 | 4 938 |
| Board, team, helpers, jobs, workflows, infinite canvas, office, needs-you | 6 123 | 3 412 |
| Chat, transcript, Markdown, ark-visual cards, diff cards, questions card, composer, model picker, plans | 5 852 | 3 644 |
| Projects, workspace (terminal, browser, git, run surface), dashboard, apps, plugins, skills, MCP | 5 085 | 1 431 |
| Settings and theme (looks, translucency, design catalog) | 2 944 | 1 478 |
| Gallery (renders the goldens) | 2 344 | 0 |
| Brain, briefs, search, backup | 1 781 | 1 295 |
| Pal | 1 655 | 873 |
| Dictation and speech (capture, Parakeet, text insertion, audio ducking) | 1 310 | 583 |
| Shortcuts, quick actions, command palette, wake word | 968 | 690 |
| Helper binaries: ArkCalendar (EventKit) 127, ArkDocuments (PDF and Word text) 80, ArkPTY (C) 82 | | |

### Node/TypeScript: 40 294 lines, tests 25 371 lines

| Area | Source | Tests |
| --- | ---: | ---: |
| apps/mac/src: runtime, island protocol and commands | 6 283 | |
| apps/mac/src: chats, brain wiring, skills, org, workflows, panels, backup | 4 913 | |
| apps/mac/src: native agent loop, safety policy, plans, team | 2 843 | |
| apps/mac/src: projects, git, worktrees, folder runs | 2 178 | |
| apps/mac/src: local API, MCP server, Telegram | 2 057 | |
| apps/mac/src: computer bridge, browser, host tools | 1 940 | |
| apps/mac/src: Codex worker, AI programs, model settings | 1 674 | |
| apps/mac/src: speech (whisper.cpp, Kokoro) and embeddings | 1 362 | |
| apps/mac/src total | 23 214 | 15 915 |
| services/helpers (jobs, grants, plans, routines, skills, SQLite store) | 7 105 | 2 735 |
| services/memory (chats, brain, briefs, projects, SQLite) | 3 559 | 1 244 |
| services/tool-engine (computer tool, Cua client, Mac tools) | 3 002 | 3 176 |
| services/llm-gateway (Claude plan, Codex app-server, CLI providers) | 2 477 | 1 436 |
| services/decision-engine (Laya) 305, services/core 33, packages 599, tests 267 | 1 204 | 865 |

Data: `data/memory.db` and `data/helpers.db` (SQLite through `node:sqlite`), JSON files (`island.json`, `org.json`, `workflows.json`, `panels.json` and more). Settings: `UserDefaults` (49 uses in Swift), domain of bundle `dev.ark.island`. UI goldens: 73 PNG files in `tests/ui-golden`.

### macOS-only by nature, and the Rust path

| Capability | Today | Rust path |
| --- | --- | --- |
| Accessibility (`AXUIElement`), text insertion | `TextInserter.swift` | `objc2-application-services` in a new `ark-mac` crate |
| Global hotkey | `RegisterEventHotKey` in `ShortcutEngine.swift` | Rune `App::global_shortcut` |
| Menu-bar item | `NSStatusItem` in `WorkStrip.swift` | `objc2-app-kit` `NSStatusItem`, added to the Rune fork |
| Notifications | `UNUserNotificationCenter` in `Notifier.swift` | `rune-notify` |
| Keychain | `SecItem` in `ComputerDecisionModel.swift` | `security-framework` crate or `objc2-security` |
| Window list | `CGWindowList` in `PetController.swift`, `WindowPick.swift` | `objc2-core-graphics` |
| AppleScript | `NSAppleScript` (audio ducking), `osascript` (Node tools) | Spawn `osascript`, as Node does today |
| Microphone | `AVAudioEngine` in `DictationCapture.swift` | Rune `Recorder`, or the dictation helper (section 5) |
| Speech to text | FluidAudio Parakeet on the Neural Engine (Swift) | Swift helper binary (section 5) |
| Calendar, PDF text | ArkCalendar, ArkDocuments (already helper binaries) | Keep as they are |
| Computer control | Cua driver (`cua-driver mcp`, external) | Spawn the same driver; MCP client with the `rmcp` crate |
| Web views | `WKWebView` | `objc2-web-kit` child view over the Rune layer (verify in Phase 0) |

## 5. Hard risks, with evidence

### (a) Claude on the plan, and other providers

- ADR-055: "Claude (my plan)" runs `@anthropic-ai/claude-agent-sdk`, which starts the user's own signed-in `claude`. ARK never reads or stores a login. ADR-064 pre-starts the next process. The shared SDK spike notes: pass `strictMcpConfig: true`, `tools: []`, `settingSources: []`.
- `claude-session.ts` uses SDK features beyond plain text: `createSdkMcpServer` (ARK tools in process), `canUseTool` and `PreToolUse` hooks (the safety gate), `resume`, `includePartialMessages`, `thinking`, `effort`, `sandbox`, `plugins`, `agents`.
- There is no Anthropic Rust Agent SDK. Rust can spawn `claude` with stream-json input and output and give it an MCP config and a permission-prompt tool. But the SDK's in-process tools and `canUseTool` use the SDK's control messages, which are not a documented public contract.
- Verdict: manageable. Keep a thin Node sidecar, `claude-bridge` (the about 1 400 lines of `claude-session.ts`, `claude-plan-job.ts`, `plan-support.ts`, `tool-summary.ts`). It speaks line-delimited JSON to the Rust runtime. Every `canUseTool`, hook and ARK tool call goes back to Rust, so the policy stays in Rust (CLAUDE.md §12). Spike the direct CLI path in Phase 2. Replace the sidecar only when the ADR-055 guard tests (`apiKeySource`, extra usage, scrubbed environment) pass against a fake `claude`.
- Codex: `codex app-server --stdio` (JSON-RPC over stdio). Port directly to Rust.
- Gemini, Copilot, OpenCode: one CLI run per turn (ADR-093, ADR-270). Port directly to Rust with `std::process::Command`. Keep the same flags and environment scrubbing.
- API-key providers: plain HTTPS. Use `reqwest`.

### (b) Speech

- Dictation uses FluidAudio Parakeet on the Neural Engine (Swift only). The owner chose Parakeet only. Verdict: manageable. Move the Parakeet code into a Swift helper binary `ark-dictation` (the ArkCalendar pattern), with line-delimited JSON on stdio. A Rust ONNX path (sherpa-onnx) runs on the CPU only; do not use it unless it matches quality and latency.
- whisper.cpp: Node spawns `whisper-cli` today. Rust spawns the same binary.
- Kokoro TTS: Node uses `kokoro-js` in a worker. Keep that worker as a Node sidecar until a Rust `ort` port passes the TTS tests. Check the licence of the phonemizer before the port.
- Embeddings: `@huggingface/transformers` today. Use `ort` with the same model files. Parity test: same vectors within 1e-4.

### (c) Text input fidelity: the biggest UI risk

- Rune draws its own text fields. It has IME, dictation commit, spell check, rich text, rich paste and undo.
- AppKit text views also give Writing Tools, the Services menu, text replacement, autocorrect, Look Up and grammar check. Rune has none of these.
- ARK's composer is an `NSTextView` today (`ComposerPaste.swift`, `ConversationView.swift`).
- Verdict: manageable, high risk. Port the composer last among chat parts. Phase 0 tests Japanese IME, macOS dictation, emoji picker and paste in a Rune field. Fallback: a native `NSTextView` as a child view over the Rune layer for the composer only.
- Dictation into other apps (`TextInserter`) does not depend on the UI toolkit. It moves to `ark-mac` unchanged.

### (d) Accessibility and VoiceOver

- Rune exposes elements through AccessKit (NSAccessibility on macOS). `--tree` dumps the accessibility tree, so tests can check labels.
- Verdict: manageable. For each screen, list the SwiftUI accessibility labels and check that the Rune tree has the same labels. Check VoiceOver by hand on each screen before its exit.
- `scripts/ui-check.sh` live step reads the window text through Accessibility. Keep that check for the Rune window.

### (e) Snapshot and golden tests

- Today: the Swift gallery renders 73 goldens with `ImageRenderer`. `png-diff.swift` fails at more than 1 % changed pixels.
- Rune: headless `--snap` on a fixed virtual clock, plus `--tree` JSON. Two toolkits never draw the same pixels, so a pixel compare between Swift and Rune is not a test.
- Verdict: manageable. For each ported screen: (1) the owner signs off a side-by-side PNG once; (2) a Rune golden in `tests/ui-golden-rune/` (same 1 % rule); (3) a tree assertion file (texts, roles, keys) that must match. Keep the Swift goldens until Phase 4.
- System materials draw a fallback fill headless. Check the real blur by an on-screen capture, as ADR-277 does.

### (f) Data migration

- SQLite: use `rusqlite` with bundled SQLite on the same files. Keep the schema. Port the schema setup in `services/helpers/src/store-schema.ts` and `services/memory/src/store.ts` as is.
- One owner per database file at a time. During Phase 2, a database belongs to Node or to Rust, never both. SQLite WAL and a busy timeout protect against overlap; the ownership rule prevents it.
- Parity test: copy a fixture database, run the same queries in TypeScript and in Rust, compare the rows.
- JSON files in `data/`: same files, same format (`serde_json`).
- Settings: keep `UserDefaults` in domain `dev.ark.island` through `objc2-foundation`. No import step. Same keys.
- Verdict: manageable.

### (g) Distribution, signing and updates

- `build-app.sh` signs with the "ARK Local Signing" identity and identifier `dev.ark.island`. macOS keeps Accessibility, Input Monitoring, microphone and calendar grants per bundle identifier and signature.
- Keep the bundle identifier and the signing identity at cutover, so the grants stay. Verify on a test bundle before Phase 4.
- `AppUpdater` runs `git pull` and rebuilds. After cutover it runs `cargo build --release`. `scripts/setup.sh` and `install-ark.command` must install `rustup` with the pinned toolchain. Node stays required while `claude-bridge` exists.
- Add `reference/licenses/Rune-MIT.txt` and copy it into the bundle as `ThirdParty-Rune.txt`. List all crate licences in Phase 0.
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
sidecars/claude-bridge/   Node: the Agent SDK only (section 5a)
helpers/                  Swift: ArkCalendar, ArkDocuments, ark-dictation
```

### Process model

| Phase | UI | Runtime | Link |
| --- | --- | --- | --- |
| Today | Swift app (parent) | Node runtime (child) | stdin and stdout, JSON lines |
| 1 | Swift app | Node runtime; `ark-core` in shadow mode | Node calls Rust in process (napi-rs) |
| 2 | Swift app (parent) | `ark-runtime` (child); it starts the Node runtime as its child and forwards each command it does not own yet | Same JSON lines on both links |
| 3 | Swift app (parent) and Rune app (second client) | `ark-runtime` | Swift: stdio. Rune app: a Unix socket in the data folder (mode 0600), same JSON lines |
| 4 | Rune app, one process with `ark-runtime` linked as a library | Same process | Sidecars and helpers on stdio, JSON lines |

The target is one Rust process. Sidecars and helpers stay separate processes, because they wrap code that Rust cannot reach well (Agent SDK, FluidAudio, EventKit, PDFKit) or programs that ARK does not own (Cua driver, `claude`, `codex`).

## 7. Phases

Every PR follows CLAUDE.md §3 and §21: one capability, tests, verify, docs, stop. Verify on fixtures, never on live data (CLAUDE.md §17).

### Phase 0: toolchain, Rune copy, hello window (3 to 4 PRs)

- Scope: `rust/` workspace, pinned toolchain, Rune copy at `b556a38`, CI job `rust` on `macos-latest` (`cargo test`, `cargo clippy`), `ark-app` hello window.
- Deliverables: a headless PNG and `--tree` JSON of the hello window as CI artifacts; `UPSTREAM.md`; `Rune-MIT.txt`; a crate licence list.
- Spike checks (record numbers in STATUS.md): clean and incremental build time; binary size; Japanese IME, macOS dictation and emoji picker in a Rune field; VoiceOver on hello; `NSStatusItem` through objc2 next to a Rune window; hover in a non-key panel; overlay on a second display; `NSVisualEffectView` `.hudWindow` behind a transparent Rune window; `WKWebView` child view over the Rune layer; Rune embed host inside a SwiftUI view.
- Exit: CI green; every spike check has a recorded result (works, works with a patch, or does not work).
- Risks: build time on CI; Rune claims that are stale. Rollback: delete `rust/` and the CI job. Nothing else changes.

### Phase 1: Rust core library for pure logic (8 to 10 PRs)

- Scope: `ark-protocol` and `ark-core`. One PR per area: protocol codec (`island-protocol.ts`, `Protocol.swift`); safety policy (pure parts of `native-safety.ts`, `write-scopes.ts`, `grants.ts`); org and chain of command (`org.ts`, `OrgChart.swift`); job tree (`jobs.ts`, `JobTree.swift`); `ark-visual` parser (`ArkVisual.swift`); questions card parser (`ChatQuestions.swift`); unified and text diff (`UnifiedDiff.swift`, `TextDiff.swift`, `InlineDiff.swift`); shortcut matcher (`ShortcutMatcher.swift`).
- Parity tests: write each existing test case once as a JSON vector in `tests/parity/<area>.json` (input, expected output). The TypeScript or Swift test and the Rust test both read the same file. The vector file must pass in both before the PR merges.
- Wiring: only the policy check runs in the live app, in shadow mode (`ARK_RUST_SHADOW=1`, off by default). Node calls Rust through napi-rs, keeps its own decision, and logs each mismatch. Rust never decides in Phase 1.
- Exit: all vectors pass in CI; shadow mode shows zero mismatches over one week of the owner's normal use.
- Risks: TypeScript and Swift give different answers for the same input today (a vector shows it; record it as a decision, do not fix it silently). Rollback: turn off the flag; the Node path is unchanged.

### Phase 2: Rust runtime replaces Node, one area at a time (20 to 30 PRs)

- Scope: `ark-store`, `ark-gateway`, `ark-runtime`, `sidecars/claude-bridge`.
- First PR: `ark-runtime` as a pure forwarder. The Swift app starts it when `ARK_RUNTIME=rust`. It starts the Node runtime and forwards every line both ways. Exit: the smoke test (`tests/smoke.test.ts`) passes through it.
- Then move areas, least risky first. Each move makes Rust answer that area's commands instead of forwarding them:
  1. Read-only commands: status, chat list, search, usage, stats, brain read.
  2. SQLite ownership of `memory.db`, then `helpers.db`.
  3. Scheduler, watches, routines.
  4. Simple tools: time, weather, timers, notes, apps, media, front window, calendar (ArkCalendar).
  5. Local API (HTTP on 127.0.0.1 with token) and the MCP server (`rmcp`).
  6. Telegram.
  7. CLI providers (Gemini, Copilot, OpenCode), then Codex app-server, then API providers.
  8. `claude-bridge` sidecar for the Claude plan; ARK tools and the safety gate answered by Rust.
  9. Native agent loop, plans, team, jobs, workflows (uses Phase 1 policy, org and job tree).
  10. Computer control (Cua driver client, point marker, learned shortcuts).
  11. Speech: whisper.cpp spawn, Kokoro worker, embeddings.
  12. Projects, git, worktrees, folder runs, skills, backup.
- Parity tests per area: port the area's TypeScript tests to Rust. Record golden transcripts: send a fixed command list to the Node runtime on a fixture data folder, save the event lines, and require the same lines (ignoring times and ids) from Rust.
- Exit: Node answers no command except through `claude-bridge` (and the Kokoro worker, if not yet ported); `ARK_RUNTIME=rust` becomes the default; the area's TypeScript moves to `legacy/node` when nothing calls it.
- Risks: two runtimes on one data folder (prevented by the ownership rule); subtle event-order changes the Swift UI depends on (the transcripts catch them). Rollback: `ARK_RUNTIME=node` starts the old runtime directly; per area, take the area off the Rust owner list.

### Phase 3: Rust UI replaces Swift screens, one screen at a time (25 to 35 PRs)

- Scope: `ark-ui`, `ark-app`, `ark-mac`, Rune patches.
- The Rune app connects as a second client (Unix socket) to the runtime that the Swift app started. The owner opens a ported screen in the Rune app with `ARK_UI_PREVIEW=<screen>`. The Swift app stays the daily app.
- Order, least risky first:
  1. Settings window (forms and switches).
  2. Dashboard, usage and stats (needs an ARK chart component).
  3. Brain, briefs and search views.
  4. Board, team and workflows (infinite canvas, drag).
  5. Projects and workspace views (git view; diff card from rune-kit Diff). Web panels and terminal come later.
  6. Chat transcript, read only (Markdown, `ark-visual` cards, diff cards, questions card, plan notes).
  7. Composer, model picker, slash and mention menus (text input risk, section 5c).
  8. Main window shell: sidebar, top bar, translucent window (Rune patch for `.hudWindow` and `.sidebar`).
  9. Workspace terminal (`alacritty_terminal` drawn on a Rune canvas) and web panels (`WKWebView` child view).
  10. Floating surfaces: island panel, work strip, quick action panel, voice pill, agent cursor, draw overlay (Rune patches for per-display overlays and hover in a non-key panel).
  11. Pal and its bubble.
  12. Menu-bar item (`NSStatusItem` patch), dictation UI and text insertion (`ark-mac`, `ark-dictation` helper).
- Parity tests per screen: Rune golden PNG, tree assertion file, accessibility label list, the owner's one-time side-by-side sign-off, and the screen's Swift core tests ported to Rust.
- Exit: every screen is ported and signed off; the Rune app passes the live UI check (Accessibility text read) on a fixture data folder.
- Risks: text input (5c); floating panels need Rune patches; a 1 % pixel rule can be flaky with motion (use the fixed virtual clock). Rollback: the Swift app is unchanged and stays the default until Phase 4.

### Phase 4: cutover (4 to 6 PRs)

- Scope: the Rune app becomes `ARK.app` with `ark-runtime` linked in; installer and updater changes; legacy move.
- Deliverables: a new build script that builds `ark-app`, `ark-dictation` and the existing helpers, copies `claude-bridge`, signs with "ARK Local Signing", identifier `dev.ark.island`, the same `Info.plist` usage strings and URL scheme; `setup.sh` and `install-ark.command` install the pinned Rust toolchain; `AppUpdater` rebuilds with cargo; `apps/mac/island` moves to `legacy/swift`, the remaining Node code moves to `legacy/node`; CI drops the Swift and visual jobs for legacy code and runs the Rune visual job.
- Parity tests: all Rust tests, all Rune goldens, the smoke test, the live UI check, and a fresh-install test on a clean macOS user account (grants asked once, then kept after a rebuild).
- Exit: one week of the owner's daily use with no return to the Swift app.
- Risks: lost macOS grants if the identifier or signature changes; longer update builds. Rollback: the previous `ARK.app` bundle stays in the build folder as `ARK-swift.app` for one release; `legacy/` code builds by hand.

Total: about 60 to 85 PRs.

## 8. What stays Swift or Node as a sidecar

| Capability | Stays as | Why | Replace when |
| --- | --- | --- | --- |
| Claude on the plan (Agent SDK) | Node sidecar `claude-bridge` | No Rust Agent SDK; in-process tools and `canUseTool` use SDK control messages | A direct `claude` CLI path passes the ADR-055 guard tests |
| Parakeet dictation | Swift helper `ark-dictation` | FluidAudio is Swift and Core ML (Neural Engine) | A Rust path matches quality and latency |
| Calendar and Reminders | Swift helper ArkCalendar | EventKit | Not needed |
| PDF and Word text | Swift helper ArkDocuments | PDFKit | Not needed |
| Kokoro TTS | Node worker (`kokoro-js`) | Phonemizer and model port not done | A Rust `ort` port passes the TTS tests |
| Computer control | Cua driver (external program) | Already a separate MCP program | Not needed |
| Browser automation | `agent-browser` program | External program | Not needed |
| Web views | `WKWebView` child view in a Rune window | Rune has no web view | Not needed |
| Menu-bar item, AX, Keychain, login item | objc2 code in `ark-mac` and the Rune copy | Rune lacks them | Rune adds them upstream |

## 9. Decisions the owner must make

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| 1 | How to hold Rune | (A) copy a subset into `rust/vendor/rune` with `UPSTREAM.md`; (B) a GitHub fork pinned by rev; (C) the upstream repo pinned by rev with `[patch]` entries | A. The owner asked to copy and change it. It skips `demo/`, `site/`, `www/` and most examples (about 22 MB, 281 000 lines). Rune takes no pull requests, so ARK patches stay local anyway. |
| 2 | Claude on the plan | (A) Node sidecar `claude-bridge`; (B) direct `claude` CLI from Rust; (C) API keys only | A now; spike B in Phase 2. C drops the plan. |
| 3 | Phase 1 wiring | (A) napi-rs, policy in shadow mode only; (B) a sidecar process; (C) no wiring until Phase 2 | A. It tests Rust on real inputs and decides nothing. |
| 4 | Rune app during Phase 3 | (A) second client over a Unix socket; (B) separate parent on a fixture data folder only | A. The owner can try each screen on real chats. |
| 5 | Settings store | (A) keep `UserDefaults` (`dev.ark.island`); (B) a new `data/settings.json` with a one-time import | A. No migration step. |
| 6 | Dictation engine | (A) Swift helper with FluidAudio; (B) sherpa-onnx in Rust (CPU) | A. It keeps today's quality. |
| 7 | Workspace terminal | (A) `alacritty_terminal` (Apache-2.0) on a Rune canvas; (B) SwiftTerm in a helper window | A. B keeps a Swift UI forever. |
| 8 | Web panels | (A) `WKWebView` child view; (B) open in the default browser; (C) drop them | A if the Phase 0 spike works, else B. |
| 9 | Composer fallback | (A) Rune text field; (B) native `NSTextView` child view | A, with B ready if Phase 0 IME and dictation checks fail. |
| 10 | Legacy code after the move | (A) kept, not built in CI; (B) kept and built in CI | A. Legacy is reference code. |
| 11 | Rune gaps | (A) patch the copy and open an upstream issue for each gap; (B) patch only | A. Upstream fixes reduce the patch list. |

## 10. To verify in Phase 0 (claims not checked by build in this plan)

- Rune builds with toolchain 1.99.1 on the CI macOS image, and the build time.
- Rune's AccessKit adapter works with VoiceOver (README sections disagree).
- Non-activating panels on all Spaces, including full-screen Spaces (README sections disagree).
- macOS dictation and Japanese IME in a Rune text field.
- `NSStatusItem`, `.hudWindow` material and `WKWebView` work next to Rune's Metal layer.
- The embed host can run inside a SwiftUI view with keyboard and IME input.
- Stream-json init messages from `claude` carry `apiKeySource` and rate-limit events (needed for option 2B).
- The licences of every crate in the Rune subset.

## 11. Credit

Rune by Anomaly (github.com/anomalyco/rune), MIT licence, is the UI base. ARK keeps its licence file in `rust/vendor/rune/LICENSE` and ships it in the app bundle.
