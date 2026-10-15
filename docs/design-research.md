# Design research: Open Design systems and templates

Date: 2026-10-15. Source: `github.com/nexu-io/open-design`, folders `design-systems`, `design-templates` and `craft`.

## 1. What I read

- `design-systems/`: 151 packages. I read the README, the schema (`_schema`), and the systems closest to ATOM: HUD, Agentic, Dashboard, Linear, Raycast, Warp and Claude.
- `design-templates/`: more than 100 templates. I read the rules file and five templates that fit ATOM: Dashboard, Kanban board, Live dashboard, Worker visualizer and Critique.
- `craft/`: the shared rules the templates require. I read State coverage, Anti-AI-slop, Animation discipline, Accessibility baseline, Typography hierarchy, Laws of UX and Color.

I did not read every package. Most of the 151 are the same shape with different colours. The sample above covers the ideas that matter for ATOM.

## 2. What a design system is, in this repository

A package is three files: `manifest.json` (name, category, provenance), `DESIGN.md` (the prose for an agent) and `tokens.css` (the values). A guard checks that the three agree.

The tokens have layers:

| Layer | Content | Example |
|---|---|---|
| Identity | Background, text, accent, fonts | `--bg`, `--fg`, `--accent` |
| Structure | Type scale, container width | per brand |
| Shared defaults | State colours, 4 px spacing, radius scale, three elevation levels, focus ring, two motion durations | `--space-4`, `--focus-ring` |
| Slots | Alias tokens | `--fg-2`, `--border-soft` |
| Extensions | Brand-only tokens | per brand |

This split is the main idea to keep. An agent that reads the package knows which values it may choose and which are fixed.

## 3. Ideas that I took for ATOM

1. **A package for ATOM.** `design/atom-design-system/` has `manifest.json`, `DESIGN.md` and `tokens.css` for Void and Daylight. The designer agent (Puff) and the playground can read it.
2. **A test against drift.** The reference repository has a guard that compares `tokens.css` with the prose. ATOM now has `DesignTokensTests.swift`. It fails when a value in `tokens.css` differs from `Theme.swift`. I proved this with a one-digit change.
3. **A 4 px spacing grid.** ATOM's spacing constants were 22, 14, 18 and 26. They are now 24, 16, 20 and 24.
4. **Three text levels, with secondary text softer than main text.** ATOM already had this. The Daylight theme broke it in the first draft (black secondary text). The test now checks it.
5. **Two elevation levels in a flat theme.** A hairline is the edge, and a lighter surface is the depth. Linear and Raycast do the same on dark surfaces. ATOM's Void already works this way.
6. **Keyboard and focus.** The accessibility baseline says to keep focus visible. I found a fault that I caused: the draggable sidebar rows lost keyboard focus. They now take focus, and Return and Space press them.
7. **Five states for every list and page.** Loading, empty, error, populated and edge. This is the most useful rule in the whole set. It is now in `DESIGN.md` and in the backlog below.
8. **Status as a dot with a word** (from HUD). ATOM already does this in Void.

## 4. Ideas that I did not take

- **Warm parchment, serif headlines and terracotta (Claude).** It is a good look, but it is Anthropic's brand. ATOM has its own.
- **Uppercase labels with wide spacing (Warp).** ATOM uses this in the Second brain page only, where it fits the HUD look.
- **Phosphor green (HUD).** The Second brain page uses ATOM's own "live" colour for the same effect.
- **Large display type with negative letter spacing (Linear).** ATOM is a tool window, not a marketing page.
- **A strict seven-section dashboard layout.** ATOM's Dashboard is about token use, not sales.

## 5. Review of ATOM, with the Critique template's five dimensions

Scores are my judgement from the rendered screens, not a measurement. 0 is poor and 10 is excellent.

| Dimension | Score | Evidence |
|---|---|---|
| Philosophy | 8 | One idea (calm, flat, hairlines, one accent). It is consistent in Void and Daylight. |
| Visual hierarchy | 6 | Many ad-hoc sizes (10.5 to 13 pt in 0.5 steps). The Dashboard shows six KPI cards of equal weight, and its sections have equal spacing. |
| Detail | 7 | Good: concentric radii, tabular numbers, hover and focus states. Weak: the Chats list in the gallery overlaps, and long lines in "Recent turns" are dense. |
| Functionality | 7 | Keyboard focus was lost on the sidebar (fixed). Empty, loading and error states are uneven across pages. |
| Innovation | 8 | The Pal character, the office floor, the Second brain HUD and the drag-to-arrange sidebar are all distinct. |

### Keep

- The flat, hairline look and the single accent.
- Named motion with a Reduce Motion form.
- Contrast tests for every theme.
- Status dots with words.

### Fix

- **Dashboard hierarchy.** Make one number the lead (today's tokens). Show the other cards smaller. Add a change against the previous period, as the Dashboard template asks ("label, big number, delta").
- **Dashboard colour.** Blue is on every bar and meter. The rule is the accent on at most two things per view.
- **"Recent turns" rows.** Make columns with aligned numbers. A long run-on line is hard to scan.
- **Stale data.** The Live dashboard template shows "updated 12 s ago" and a refresh. The Dashboard shows no age.
- **Type scale.** Move to 11, 12, 13, 15, 18 and 26.
- **Board.** The Kanban template gives each column a count chip and an add action.

### Quick wins (small, safe)

- Add "Updated N s ago" to the Dashboard.
- Add a count chip to each Board column.
- Replace half-point sizes (10.5, 11.5, 12.5) with the scale.

## 6. State coverage backlog

Check each page for the five states. A page that lacks a state is a task.

| Page | Loading | Empty | Error | Edge |
|---|---|---|---|---|
| Chats list | "Loading…" | yes | not shown | 40 rows cap; a very long title |
| Needs you | not checked | yes | not checked | not checked |
| Issues | not checked | "None" | the page is the error list | many failures |
| Board | not checked | yes | not checked | 50 agents (done in the gallery) |
| Scheduled | not checked | yes | not checked | not checked |
| Second brain | "Waiting for ATOM…" | yes | yes | 400 notes cap |
| Plugins | not checked | yes | server test fails | very long skill list (dropdown now) |
| Dashboard | not checked | not checked | not checked | not checked |

"Not checked" means I did not verify it. Do this next, one page at a time, with a gallery shot for each state.

## 7. What changed in the repository for this research

- New: `design/atom-design-system/` (three files).
- New: `apps/mac/island/Tests/AtomIslandCoreTests/DesignTokensTests.swift` (3 tests).
- Changed: `Spacing` constants on a 4 pt grid (`Theme.swift`).
- Changed: sidebar rows take keyboard focus (`HelpersView.swift`).
- Golden shots updated for the spacing change.

## 8. Limits

- I read a sample of the repository, not all of it.
- The scores in section 5 are my own review.
- I did not check keyboard focus on the sidebar in the running app. The code follows the pattern the Projects rows already use.
- Open Design's templates target web pages. I took their rules and structure, not their HTML.
