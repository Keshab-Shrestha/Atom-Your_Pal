# ATOM-owned OMH skill library — 27 October 2026

Keshab requested the OMH skills as ATOM's own library, leaving Claude Code alone. ATOM now carries the 151-skill packaged catalog at upstream revision `171ccfa698fd94b6ec23a8940f9658556b430351`. This extends, rather than replaces, the native orchestration implementation.

## Ownership and installation

- `assets/skills/omh/`: 151 adapted SKILL.md entries and 252 supporting files, plus MIT notice, README and provenance/checksum catalog. Original entry hashes and adapted material hashes are retained. Per-material upstream license notices are preserved.
- Entries prepend an ATOM compatibility notice. Upstream procedures remain guidance; ATOM's tools, permissions, selected provider, Stop, memory admission, review and Git authority remain unchanged. Unsupported OMH/Hermes commands require explanation rather than invented execution.
- On runtime startup, the host validates catalog paths/checksums and seeds missing folders into its own `data/skills`. A folder is published only after its materials are copied. Existing entries are preserved, including user edits; no automatic upstream update or overwrite occurs. Failed setup logs `skills.bundle_unavailable` without inventing installed skills.
- Existing discovery/source semantics remain compatible (`zeno` means ATOM-owned). Global Claude Code names retain their existing collision precedence. The library is not copied into ~/.claude/skills, and no global skill is edited.
- Native Skills and composer menus separate **ATOM library**, **Claude Code** and **Skills hub**, with source counts. The full catalog and notices are packaged in ATOM.app resources as well; this checkout-based runtime resolves its bundled source from the project assets.

## Reading and use

The model can search/paginate `use_skill` by query and source instead of seeing only the first 40 names. Multiword queries match terms across names/descriptions. Named entries and relative supporting text files can be read in bounded 8,000-character pages, with explicit continuation offsets and end-of-file markers. The reader checks containment, traversal, file kind, hard links, UTF-8 and size; it never executes a script. Slash selection retains the existing bounded first page and now tells the model how to continue. Workers still load only explicitly assigned skill folders through their existing plugin path.

This adds no unconditional 151-skill prompt block, automatic dispatch, new provider, permission, daemon or Hermes runtime. Bundled supporting scripts are materials requiring their own approved tools/dependencies, not actions performed by installation. Existing reviewed Tinker drafts/edits and Undo remain the improvement mechanism; broader outcome learning and automatic application are not delivered by this catalog import.

## Verification

- TypeScript and diff checks passed. No unit/full suite or provider/model request was run.
- Actual installation: 151 installed; second invocation: 0 installed / 151 retained. Discovery: 247 total = 151 ATOM-owned + 96 global Claude Code skills. All 151 owned descriptions are present.
- All 151 complete instruction bodies were reassembled through 258 bounded pages and matched installed full text. All 252 supporting files were readable as bounded text. Traversal was refused. Search found web research; the next catalog page correctly showed entries 41–80 of 151.
- All 96 previously installed Claude Code SKILL.md hashes remained unchanged after import.
- Signed release packaging passed (AtomIsland compilation: 65.79 seconds), as did strict signature verification. Actual Plugins UI showed ATOM library: 151 / Claude Code: 96 / Hub: 0. Both source groups appeared in the picker. Opening omh-web-research showed ATOM library and the complete 12,548-character file including the compatibility note; no Save was performed. Returned to the existing chat, Ready. Startup logged 0 installed / 151 retained. No commit/push. Prior uncommitted chat and stopped-summary work and unrelated graphify-out/ remain preserved.

## Follow-up

Audit actual readiness and tool mappings per workflow, expand routing only where supported, exercise a fictional reviewed improvement/undo, and complete the earlier provider/recovery acceptance backlog. Catalog availability is not full OMH runtime parity.
