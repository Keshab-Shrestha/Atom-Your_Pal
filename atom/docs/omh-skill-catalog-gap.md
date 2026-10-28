# OMH skill catalog and improvement gap — 27 October 2026

Keshab clarified that the intended addition includes OMH's 150+ skill library and improvement features, not only architectural patterns. At this diagnostic checkpoint the shipped skill catalog did not meet that intent. Subsequent user authorization led to the [151-skill ATOM-owned library](omh-skill-library.md); the findings below describe the pre-import state.

## Verified current state

- `listSkills(userSkillsDir(), data/skills)` returns exactly 96 entries, all source `yours`, from `~/.claude/skills`. `data/skills` does not exist. No OMH catalog is installed. This is not a loading/count limit.
- Runtime discovery in `apps/mac/src/skills.ts` merges global Claude skills with ATOM-owned skills. Global names win collisions. It has no bundled OMH source. The Hub currently permits only `anthropics/skills`.
- The pinned source checkout at `171ccfa698fd94b6ec23a8940f9658556b430351` contains 151 top-level packaged skills in `skills/`. The separate `agent-skills/` export contains 119 top-level skills; those are different surfaces and must not be confused. Its catalog files are not present in ATOM's runtime discovery path.
- Native OMH work added contracts, three conservative research/build/review guides, context budgets, scheduling, evidence, retry/repair and memory/recovery records. Those are not 151 skills.
- ATOM's existing Tinker runner can propose worker changes, turn completed tasks into skill drafts and propose edits to ATOM-owned skills used in poorly rated tasks. Applying proposals requires review; it never edits global Claude skills. It currently uses the Claude plan. The local `proposals`, `skill_drafts` and `skill_edits` tables contain no records. Code presence is not proof that this loop has been exercised for the installed app.

## Required follow-up, in order

1. Add a pinned, attributed ATOM-owned OMH catalog source, with honest source counts and namespacing/collision handling. Keep global skills separate and avoid changing their files. Catalog visibility must not be labelled as full runtime support.
2. Audit referenced files, scripts, Hermes/OMH tool names and provider prerequisites. Adapt usable guidance to existing ATOM capabilities and label remaining dependencies/unsupported operations. Do not install or execute the upstream runtime merely to inflate the count.
3. Make the catalog searchable and load only relevant/explicitly selected guidance. Do not inject 151 complete skills into every chat. Preserve provider selection, grants, Stop, history and current context-budget rules.
4. Extend the existing improvement mechanism with usage/outcome records and reviewable, versioned ATOM-owned overlays, evidence and rollback. Keep vendor versions and global originals intact. Silent automatic application, automatic provider switching or broader authority are separate decisions, not implied by adding a catalog.
5. Accept the result in the actual app: source counts, source inspection, explicit selection, relevant routing, unsupported dependency explanations and an approved/undone fictional improvement. Do not count imported guidance as implemented integrations.

This checkpoint is a read-only diagnosis and backlog correction. No installation, new model calls, tests, rebuild, permission changes, commit or push occurred.
