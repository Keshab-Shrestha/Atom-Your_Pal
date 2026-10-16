# ATOM upgrades: sidebar, Cursor-style editing everywhere, and six new features

> **Status (2026-10-17): plan only, nothing built yet.** Each item gets its own ADR (numbered when built; ADR-128 onwards), a TASK.md entry and a commit. Keep this file current as items land. v3 (2026-10-17) adds the six new features (Part C) and one roadmap for everything. Part A and Part B are the v2 plan with Keshab's answers.

**Repo:** `~/Developer/atom` (ATOM). Check `git status` for other agents' uncommitted work before editing.

## Decisions (Keshab, 2026-10-17)
| Question | Answer | What it means here |
|---|---|---|
| Which text section | **All over** | Every text area in the ATOM window gets it: Second brain notes, a helper's Soul fields, Skills, Plugins config, and the chat box. One shared editor, not five copies. |
| "Cursor-like text texture" | **Edit review + caret + typing animation** | (1) shaded changes with Accept / Deny; (2) a designed caret (colour, width, soft blink, a glow while ATOM writes); (3) when ATOM edits, the change **types in live** at ATOM's caret. |
| Accept | **"No notes for accept"** (read as: Accept applies and saves at once, no separate Save step, no confirmation, with Undo) | **Please confirm this reading.** |
| Shortcut | **⌥⌘H** | The window's own menu has no "Hide Others", so there is no clash inside ATOM; the standard Hide/Show Sidebar key (⌥⌘S) is not used. |
| Selection | **Yes** | Edits can target the selected text. SwiftUI's `TextEditor` cannot report a selection, so this needs a real `NSTextView` wrapper, and that wrapper is now the core of part B (it was an optional last step in v1). |

## What the code looks like today (facts)
- Window: `HelpersView.swift` ~line 20: `HStack { HelperSidebar.frame(width: 224); separator; main pane }`. `fullSizeContentView`, clear title bar: the traffic lights sit on the sidebar (`MainWindow.swift` `makeWindow`). Top bar: `WindowTopBar.swift`; `titleBarRoom = 40`, `topBarGap = 36`; sidebar header `WindowHeader` at `HelpersView.swift:289`.
- Settings: `AtomIslandCore/IslandSettings.swift` (UserDefaults keys such as `atom.window.sidebar`). `⌘F` = `MainWindowController.find` (bumps `searchFocusTick` only).
- Text inputs: **5 `TextEditor`s** (`BrainView.swift:595`, `HelpersSoulView.swift:91`, `SkillsSection.swift:115`, `PluginsView.swift:136`, one more) and **17 `TextField`s** in 12 files (single line: titles, search, names; the chat box is a `TextField` with a vertical axis, ADR-125). The chat box already reaches the AppKit field editor through `FieldEditor.current` (`ComposerPaste.swift:94`) and handles Japanese composition with `FieldEditor.composing`.
- Reusable: Tinker's Accept / Reject / Undo (`HelpersPageRows.swift` `ProposalsSection`, shows only the new text, no diff); `DiffText` (private, `DashboardView.swift:437`, green/red git patch lines); `QuietButton`; theme colours `success`, `problem`, `live`; the "glowing caret while Pal speaks" in `ConversationView.swift:701` (`ReplyText`), which is the house style for the caret.
- Reference (open-design `docs/screenshots/`, fetched through the GitHub API): the sidebar toggle is the "sidebar" glyph at the top left beside the traffic lights, and the main area re-centres. **No screenshot there shows a diff, Accept/Deny or a caret**, so part B follows Cursor, not open-design.

---

# Part A — Hide / show the left panel (ADR-128)

**Behaviour**
1. A **sidebar button** (`sidebar.left`) at the sidebar's top right, level with the traffic lights; while the panel is hidden it **moves to the top bar's left end** (always reachable).
2. **⌥⌘H** and a **View** menu item "Hide Sidebar" / "Show Sidebar".
3. Hidden: the panel slides out (0.2 s `Motion.settle`, none with Reduce Motion); the main pane fills the window; the top bar gets a left inset so the back arrow and title clear the traffic lights (measure from `standardWindowButton(.zoomButton)`, not a fixed 78). Chat and Settings keep their reading width and centre.
4. Remembered across launches (`atom.window.sidebarHidden`).
5. `⌘F` shows the panel first, then focuses search.
6. The menu-bar panel (the small island) is unchanged. Left out: drag-resize, icon rail, hover-peek.

**Tasks**
1. *Test first.* `IslandSettings.sidebarHidden` (default false, persisted). Test: default; survives re-creation on the same defaults suite.
2. *Test first.* `AtomIslandCore/WindowChrome.swift`: pure `topBarLeadingInset(sidebarHidden:trafficLightsMaxX:)`, `sidebarToggleTitle(hidden:)`. `WindowChromeTests`.
3. `HelpersView.swift`: show `HelperSidebar` + separator only when not hidden, with `.transition(.move(edge: .leading))` and `withAnimation`; `IslandModel.toggleSidebar()`.
4. `WindowHeader` trailing `SidebarToggleButton` (24×24 target, `.help("Hide sidebar (⌥⌘H)")`, accessibility label); `WindowTopBar` gets `showsSidebarToggle` and the inset.
5. `MainWindow.swift`: View menu item (⌥⌘H); `find()` unhides first.
6. Gallery: a "window, sidebar hidden" frame; `pnpm island:ui-check` goldens still pass.
7. Live check: button, ⌥⌘H, menu; relaunch keeps it; ⌘F while hidden; hide while a chat answers (answer keeps streaming); narrow window; all three themes (ADR-057).
8. ADR-128, TASK.md, STATUS.md; commit; push.

**Risks:** the dark theme's translucent sidebar must not leave a stripe; a hidden sidebar must never trap you (the toggle and the menu item are the two ways back).

---

# Part B — One shared editor, with edit review, caret and typing (ADR-129 to ADR-131)

Built in this order, each its own commit:

## B1 — Diff engine and edit review model (pure, no UI) — ADR-129
`AtomIslandCore`, tests first:
1. `TextDiff.hunks(old:new:)`: lines first (Myers/LCS), then **word-boundary tokens** inside a changed block (`enumerateSubstrings(.byWords)`, whitespace and punctuation kept as tokens; Japanese splits through ICU). `DiffHunk { id, range in old, range in new, oldText, newText }`. Cap: above ~5 000 lines fall back to lines only.
2. `EditReview { original, proposed, hunks, decisions }`: `accept(id)`, `deny(id)`, `acceptAll()`, `denyAll()`, `result`, `isSettled`. **Accepting applies and saves at once** (decision above): the review hands `result` to the owner each time a decision is made; `undo()` restores the previous text.
3. Tests: identical text; insert / delete / replace; reordered lines; trailing newline; emoji and Japanese; accept all == proposed; deny all == original; random mixes (200 cases) only use pieces of original and proposed; time bound at 100 000 chars.
4. **Selection scope:** `EditRequest { text, selection: Range<Int>?, instruction }` and `EditReview.merging(selectionResult:into:)`, so a rewrite of the selection becomes hunks inside the whole text (tests: selection at start, middle, end, empty selection = whole text, selection spanning a line break, selection with emoji).

## B2 — `AtomTextView`: the shared editor (NSTextView wrapper) — ADR-130
This is the big piece (the biggest risk). One `NSViewRepresentable` over `NSTextView` that replaces the five `TextEditor`s (and later the chat box):
5. Binding for the text, **selection binding** (`NSRange` ⇄ `Range<Int>`), `isEditable`, placeholder, theme font/colour, fixed or growing height, scrolling, `⌘Z` undo through the text view's `undoManager`, spell check, Find, and **Japanese / other input-method composition** (`hasMarkedText`: never apply a diff or an animation while composing; an edit that arrives mid-composition waits).
6. **Caret:** theme accent colour (`insertionPointColor`), width 2 pt, soft blink; while ATOM writes, the caret glows in the same style as Pal's speaking caret (`ReplyText`). Selection colour from the theme; Reduce Motion = a steady caret.
7. **Review rendering inside the text view** (true inline, so caret and selection keep working around it): removed text = red tint + strikethrough, added text = green tint (theme `problem` / `success` at ~0.14), drawn with temporary text attributes / a custom `NSLayoutManager` fill so the stored text is never changed until a decision. The text is read-only while hunks are pending. Per-change **✓ ✗** chips at the hunk (hover or focus, tab-reachable), a header row "N changes · Accept all ⌘↩ · Deny all ⎋ · ↑↓ next/previous". VoiceOver: each change reads "Removed …, added …".
8. **Typing animation:** when ATOM's result arrives, the added text **types in at ATOM's caret** (about 60 characters a second, capped at 1.5 s total; a long result lands in chunks), the removed text shades red as the caret passes it; with Reduce Motion the change appears at once. Any key press or click skips to the end of the animation.
9. Swap the five `TextEditor`s one at a time, each with its screen's existing behaviour unchanged (unsaved-edit marking, save buttons, limits). Run `pnpm island:test` after each swap. The 17 single-line `TextField`s keep SwiftUI's (names and search; a single-line field has little to review) except the **chat box**, which moves in B5.
10. Gallery frames for all three themes: caret, selection, a review with three changes (one accepted, one pending, one denied), the typing mid-animation (a frozen frame).

**Risks:** NSTextView in SwiftUI (focus, first responder, height from content, the `FieldEditor` helpers assume the key window's first responder is the text view, which stays true); input-method safety; undo stack after an accepted edit (an accepted edit is one undo step).

## B3 — "Ask ATOM" edits, with the selection (runtime) — ADR-131
11. **Find the existing one-shot model call** in the runtime (episode summariser / chat title) and reuse it; no new path.
12. `island-commands.ts`: `text.edit { text, selection?: [start, end], instruction }` (instruction ≤ 500, text ≤ 100 000; selection inside the text); event `text.edit.result { proposed } | { error }`. Tests in `island.test.ts`: bad input refused with words; result; a model error; **cancel** (a new request or closing the editor aborts); an unchanged reply says "ATOM changed nothing".
13. `island.ts`: fixed system line ("Return only the rewritten text"); with a selection, only the selected text is the target (plus a little text around it for context), no tools, no memory, no chat history; usage counted on the dashboard. Text goes to the model **only because Keshab asked**, and remembered facts are never included (ADR-058). A markdown fence around the reply is stripped.
14. App: **⌘K inside any editor** opens a small "Ask ATOM…" field at the selection (or under the editor with no selection): placeholder "Make it shorter, fix the spelling…"; Return sends; "ATOM is editing…" with Cancel (⎋) shows meanwhile; the result becomes the typing animation + edit review of B2. Accept = applied and saved at once, Undo for it.
15. Live check with the real Claude plan: a note, select a paragraph, "make it shorter" → types in, shaded → accept one change, deny one → the note shows only what you accepted; Undo; cancel; a refused request; with Japanese text.

## B4 — Tinker's suggestions get the same view
16. `ProposalsSection`: show a proposal as a `TextDiff` against the field's **current** text, in the shared review rendering; its Accept / Reject / Undo stay (a proposal replaces a whole field, so one decision, with the shading for reading). Test: the diff is built from the current field text.

## B5 — The chat box
17. Move the composer onto `AtomTextView` so it has the same caret, selection and **⌘K on a selection** ("make this politer"). Keep everything from ADR-125 to ADR-127: Shift+Return new line, Return sends or queues, ⌘Return, `@` and `/` menus (the `@` menu can now read the real caret, which removes the ADR-126 limit that it only works on the word at the end), paste images, drafts per chat, message recall, Japanese composition. This is the riskiest swap, so it is last and has its own check list in the commit.

## Files likely to change
- New: `AtomIslandCore/WindowChrome.swift`, `TextDiff.swift`, `EditReview.swift`; `AtomIsland/AtomTextView.swift` (+ `+Review`, `+Caret`, `+Typing`); tests `WindowChromeTests`, `TextDiffTests`, `EditReviewTests`, `EditRequestTests`.
- Edit: `IslandSettings.swift`, `HelpersView.swift`, `WindowTopBar.swift`, `MainWindow.swift`, `IslandModel.swift`, `BrainView.swift`, `HelpersSoulView.swift`, `SkillsSection.swift`, `PluginsView.swift`, `HelpersPageRows.swift`, `ConversationView.swift`, `ComposerPaste.swift`, `IslandGallery*.swift`; runtime `island-commands.ts`, `island.ts`, `island-types.ts`, `island.test.ts`; `DECISIONS.md`, `TASK.md`, `STATUS.md`.

## Master roadmap (all 12 items, in the order I recommend)

| # | Item | Part | Size | Needs first | Why here |
|---|---|---|---|---|---|
| 1 | **Sidebar hide / show (⌥⌘H)** | A | S | – | Quick win; also unblocks ⌘F search when the panel is hidden. |
| 2 | **Diff engine, pure logic, no UI** | B1 | S–M | – | Everything below that shows a change reuses it. Fully testable, no UI risk. |
| 3 | **Shared editor: caret, shaded changes (Accept / Deny), typing** | B2 | **L** | 2 | The big piece; five editors swap one by one. |
| 4 | **"Ask ATOM" edits on a selection (⌘K)** | B3 | M | 2, 3 | Gives the runtime `text.edit` command the next items reuse. |
| 5 | **Tinker's suggestions shown as a diff** | B4 | S | 2, 3 | Small; already has Accept / Reject. |
| 6 | **Clipboard and selection actions** | C4 | M | 2, 4 | Uses the diff view and `text.edit`; the feature you would use all day. |
| 7 | **Search across everything** | C1 | S–M | – | Independent; after 1, so the hidden sidebar is not in its way. |
| 8 | **Remembering by itself** | C2 | S–M | – | Independent; reuses the Accept / Deny look. |
| 9 | **Daily brief** | C3 | M | – | Independent; best once search and memory are in, since it can link to them. |
| 10 | **Chat box on the shared editor** | B5 | M–L | 3, 4 | Riskiest swap (Return, `@`, `/`, queue, Japanese); last of the editor work. |
| 11 | **Image generation** | C5 | M | decision: provider and key | Cannot start before you choose a provider. |
| 12 | **Cloud sandboxes** | C6 | **XL** | a spike and your decisions | Biggest and riskiest; starts with a spike, not a build. |

S = about a day, M = a few days, L = about a week, XL = more than a week. These are rough; the first task of each item re-checks the size.

**Dependencies in one line:** 1 → (2 → 3 → 4 → 5, 6, 10); 7, 8, 9 stand alone; 11 needs a provider choice; 12 needs a spike.

**My recommendation:** 1 → 2 → 3 → 4 first (it is the work you asked for, in the order that keeps each step shippable), then 6 and 7 as the first wins from the new editor and search, then 8 and 9, and leave 11 and 12 until you have made their decisions.

**Every item ends the same way:** `pnpm typecheck`, `pnpm test`, `pnpm island:test`, `pnpm island:ui-check`, a live check in the running app, an ADR (numbered when built; ADR-128 is the sidebar, 129 to 131 the editor), TASK.md and STATUS.md, a commit, and a push when you say so. Nothing is called live-working unless it was tried.

---

# Part C — The six new features

Each is its own ADR and commit(s). What exists today is from the code and DECISIONS.md; anything I could not check is marked **unverified**.

## C1 — Search across everything
**Today:** the sidebar search (`SearchViews.swift`, ADR-098 item 6) covers chats, tasks and reports through the runtime command `search` (`island-commands.ts`); the Second brain has its own `brain.search`.

**Plan**
1. *Test first, Core.* `SearchRanker` (pure): title starts with the query > a title word starts with it > the body contains it; newer wins a tie; 8 per group; matches Japanese (no word boundaries, so substring) and ignores case and width.
2. Runtime: `search` also returns **Second brain pages, remembered facts, conversation notes, projects, helpers, skills, routines** (kept chats' exact lines, ADR-097). Every source is local; nothing goes to a model. Remembered facts show in the window only.
3. App: results grouped with counts and a highlighted match; ↑ ↓ Return opens the item (a note opens in the Brain, a chat opens at the chat, a setting opens its Settings page: a static list searched on the Mac); Esc clears. 150 ms debounce, a newer query cancels the older one.
4. The field stays in the sidebar; ⌘F shows the sidebar first when hidden (Part A). Placeholder becomes "Search everything".
5. Tests: ranker table; runtime composition with fake sources; stale results dropped; a deleted item does not open. Gallery frame with all groups. Live: search a name that exists as a chat, a note and a fact.
6. Later, not now: meaning-based search (embeddings), calendar events.

**Open:** does "everything" include **calendar events and reminders**? (They are on the Mac, not in ATOM; the helper can read them, so it is possible.) My default: not in v1.

## C2 — Remembering by itself
**Today:** facts are kept only when you ask (ADR-058). ADR-059 tells the model to *offer* to remember a lasting fact in its reply, which is easy to miss, costs a spoken sentence, and does nothing on a quiet chat. Conversation notes are written after each reply with no tools (`episodes`).

**Plan**
1. *Test first.* `FactSuggestions` (memory service): parse **strict JSON** `{"facts": [...]}` (malformed = ignored); each fact is short, personal and lasting, not a secret (the existing secret filter), not already known (case/space-folded dedupe against facts) and not previously denied.
2. Fold the extraction into the **existing background note call** (no extra request, no tools): the note prompt also returns up to 3 candidate facts. A chat with only a greeting gives none.
3. Store them as **suggestions, not facts**: pending, expire after 14 days, at most 3 pending, a denied one is remembered by a hash so it is never suggested again.
4. App: a quiet **"Remember?" row** under the chat (and in Needs you): "You prefer window seats" with **Accept** (becomes a fact through the existing remember path with all its rules), **Deny** (never again), **Edit** (fix the words, then accept). Same Accept / Deny look as the edit review. Pal shows a small badge; nothing is ever spoken or interrupts.
5. Settings → Memory: "Suggest things to remember" switch (on; nothing is kept without Accept). `ATOM_EPISODES=0` turns it off too.
6. Tests: parsing, dedupe, denied hash, 14-day expiry, the limit of 3, **never auto-saves**, accept goes through the secret filter and size limit, off switch. Runtime events and a gallery frame. Live: a chat that mentions a lasting fact and one that mentions a password.

**Open:** show suggestions **right after the reply** or only when you open the chat next (less distracting)? My default: a quiet row in the chat, not a notification.

## C3 — Daily brief
**Today (verified):** the scheduler ticks every 30 s and starts due routines as main-agent turns (`scheduler.ts`); calendar and reminders through EventKit (ADR-060); weather from Open-Meteo (ADR-062); Needs-you items, finished tasks, notifications (`Notifier.swift`) and Telegram push (ADR-100).

**Plan**
1. *Test first.* `brief-due.ts` (pure): due at the set time in JST, **once a day**, with a catch-up rule (the Mac was asleep: show it when ATOM next opens, if the last brief is more than 12 hours old).
2. `brief-gather.ts` (deterministic, no model): today's events, reminders due, weather, tasks finished since the last brief, Needs-you count, running timers. Remembered facts are not included (ADR-058).
3. **One** model call, no tools, writes 4 to 6 short lines in Pal's voice from that data. If the model is unavailable, a plain template of the same data is shown instead, so the brief never fails.
4. Delivery: a **Brief card** at the top of a new chat and on the Dashboard (a short history list), a notification, and optionally Telegram. **Spoken is off by default.** "Brief me" (voice or button) runs it now.
5. Settings → Brief: on/off, time (default 08:00), what to include, where to send it.
6. Tests: due logic (just before, at, after, twice in a day, asleep), gather with fake calendar / weather / store, template fallback, the model prompt carries only the gathered data. Gallery frame in three themes. Live: "Brief me" with real calendar and weather, then the scheduled run next morning.

**Open:** time and content sections (my default 08:00, events + reminders + weather + overnight tasks + what needs you); spoken or not.

## C4 — Clipboard and selection actions
**Today (verified):** global shortcuts exist (`ShortcutAction`: talk, dictate, toggleIsland, cancel); `TextInserter` writes into the app you were in, falls back to the clipboard, and already **refuses password fields**; Accessibility permission is already asked for dictation.

**Plan**
1. New shortcut action `quickAction` (default chosen from keys that are free: **open question**, configurable in Settings → Shortcuts).
2. *Test first.* `SelectionCapture` (state machine with fakes): 1) the focused element's selected text (Accessibility); 2) else simulate ⌘C, read the pasteboard, **restore what was there** (all types) afterwards; 3) else the clipboard text, labelled "From clipboard"; a secure / password field is **refused**; text over 20 000 characters is cut with a notice. Nothing is read until you press the shortcut.
3. A small picker near the island (like Spotlight): **Summarize, Translate (English ⇄ 日本語, auto-detect), Fix spelling and grammar, Make shorter, Make friendlier / more formal, Explain, Draft a reply, Ask…** (free text). Each is a fixed prompt, in code, tested.
4. Result: for edits of text you can change, the shaded **edit review** (Part B) with Accept / Deny; **Accept replaces the selection in the original app** through `TextInserter` (if that app is no longer in front, it copies instead and says so). For read-only actions (summarize, explain) a result card with Copy and "Open in chat". The same runtime command as Ask ATOM (`text.edit`, B3).
5. Safety: the selected text goes to the model only for the action you chose; no tools, no memory, no history; logs never carry the text; the original app's own ⌘Z undoes a replace.
6. Tests: capture state machine, pasteboard restore, secure-field refusal, size cap, prompt builders, target-app-gone fallback. Live: TextEdit, Notes, Safari (a read-only page), and a password field (refused).

**Open:** the shortcut; which actions to ship first (default: Summarize, Translate, Fix writing, Make shorter, Reply, Ask).

## C5 — Image generation
**Today:** **no image generation exists** (the backlog lists it as a gap). The gateway's providers are language models and Claude Code (`llm-gateway/src/providers`); **unverified** which image APIs your keys can use (the Gemini key is the free tier; image models may not be on it).

**Decision needed first:** the provider. Candidates (to compare in the first task, with current prices and terms checked at that time, not assumed): Google's Gemini image model, OpenAI's image model, a hosted open model. This is the item's blocker.

**Plan**
1. ADR: provider, price, size limits, content rules, and where the key lives (the existing keychain store `keys`, Settings → Models style page "Images", **off until a key is added**).
2. *Test first.* An `ImageProvider` interface with a fake; tool `image_generate { prompt, size?, count? }` registered for the main agent and the designer role; validation (prompt length, count ≤ 4, size from a list); provider refusals reported in plain words.
3. **Consent:** the first request in a chat shows an approval card ("This prompt goes to <provider> and may cost about X"), then "always for this chat". Monthly cap in Settings; counted on the Dashboard (images and cost).
4. Storage: `data/images/<chat>/<id>.png` (path built in code, no traversal), metadata with prompt, model and time, EXIF stripped, size limit.
5. App: an **image block in the chat** (ConversationView renders it; click opens Quick Look), buttons Save as…, Copy, Make another; shown in the Telegram and mobile replies too.
6. Phase 2 (separate): edit an attached image ("make the sky darker").
7. Tests: fake provider, schema, cap, approval gating, storage path, refusal wording. Live: one real image with your key.

**Open:** which provider and key you have or want to buy; monthly cap; is the first use **only through chat**, or also a "Make an image" button?

## C6 — Cloud sandboxes (Task 3.19)
**Today (verified):** helpers' folder tasks run **on this Mac** in Claude Code's own sandbox (no network, writes only in granted folders), on a git worktree branch `zeno/task-<id>`, never pushed (ADR-081 and ADR-122). Task 3.19 in TASK.md is one line: "Runs on a remote sandbox instead of this Mac."

**A blocker to settle first:** Claude is used **on the plan only** (ADR-092). A cloud machine cannot safely use your Claude plan login, so cloud workers would need an **API key (new, per-token billing)** or another model such as Codex. That changes cost and is your call.

**Plan: a spike first, then phases**
- **S0 — Decision ADR (no code):** provider (candidates to compare: E2B, Modal, Daytona, Vercel Sandbox, Fly Machines, Cloudflare Sandbox; check price per hour, start-up time, snapshots, egress control, file and exec API, whether Claude Code or Codex can be installed), billing, a budget cap, which tasks may go (folder-kit tasks only to start).
- **S1 — `RunHost` seam:** `local | cloud` behind one interface in the run code (`run-job.ts`); local behaviour unchanged and tested; a fake cloud host for tests.
- **S2 — Up and down:** upload only the granted folders (grants and the secret-shape check of ADR-123 apply; `.env`, keys and `.git` credentials excluded) as a bundle; download the result as a **patch / branch applied to `zeno/task-<id>` locally**; never pushed.
- **S3 — Policy:** network allowed only to the model API, no secrets except a per-run scoped model key, a hard time and cost limit, **auto-destroy** at the end or on failure, an approval card listing what goes up (files, size).
- **S4 — UI:** "Run on: This Mac | Cloud" per task or agent, with cost and time shown; the timeline (ADR-099) shows cloud events; Needs you for approval.
- **S5 — Live check** on a small repo, with a deliberate failure (kill, over budget) to prove the machine is destroyed.

**Open:** provider, billing, budget cap, and whether to do this at all now. **My recommendation: do S0 only when you want it, and keep 1 to 10 first.**

## Still open (my defaults in bold)
**Editing and sidebar (Parts A and B)**
1. **Accept saves at once** with an Undo (my reading of "No notes for accept"). Say so if you meant something else, before item 2.
2. Typing speed and cap: **about 60 characters a second, 1.5 s at most**.
3. The single-line fields (names, search): **left as they are**.

**New features (Part C)**
4. Search: calendar and reminders included? **No, not in v1.**
5. Remembering: **a quiet "Remember?" row in the chat**, never a notification or spoken.
6. Daily brief: **08:00, events + reminders + weather + overnight tasks + what needs you, spoken off.**
7. Quick actions: the **shortcut** (not chosen yet) and the first actions (**Summarize, Translate, Fix writing, Make shorter, Reply, Ask**).
8. Image generation: **which provider and key**, and the monthly cap. This one blocks the item.
9. Cloud sandboxes: provider, **API-key billing** (the plan cannot be used remotely), budget cap, and whether to start the spike at all.
