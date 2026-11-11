# Rune copy: upstream record

This folder is a copy of part of Rune (ADR-278, decision 1A in docs/rust-migration-plan.md).

## Source

- Repository: github.com/anomalyco/rune, branch `dev`.
- Commit: `b556a38a1ff88aa8690d21b45ebf9b9167038674`.
- Copied on: 2026-11-11.
- Licence: MIT, © 2026 Anomaly. `LICENSE` is the upstream file, unchanged.

## What the copy keeps

- The crates in the migration plan: `rune`, `rune-kit`, `rune-motion`, `rune-staging`, `rune-taffy`, `rune-mac`, `rune-notify`, `rune-highlights`, `rune-mermaid`.
- Three more parts that the build needs:
  - `procwatch`: an optional dependency of `rune` and a test dependency of `rune-kit`.
  - `rune-ref`: a test dependency of `rune-kit`.
  - `themes/opencode`: a test dependency of `rune-kit`. Tests in `rune` and `rune-kit` read its font files.
- Each kept crate is complete: source, tests, examples, assets and README.
- `clippy.toml`: Rune's lint settings for the crates in this folder.
- The licence files: `LICENSE`, `crates/rune/assets/Inter-LICENSE.txt`, `crates/rune/assets/IBMPlexMono-LICENSE.txt`, `crates/rune-highlights/vendor/LICENSE.md` (for `highlights.wasm`).

## What the copy drops

- Folders: `demo/`, `site/`, `www/`, `examples/`, `research/`, `scripts/`, `spikes/`, `tools/`, `changelog/`.
- Crates: `rune-i18n`, `rune-fx`, `rune-light`, `rune-register`, `rune-knobs`, `rune-perf`, `rune-luau`.
- Files: `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `PLAN.md`, `WEB.md`, `README.md`, `pack.new`.
- Moved, not dropped: the workspace `Cargo.toml` becomes `rust/Cargo.toml`, ARK's workspace. It keeps Rune's `dev` and `release` profiles and Rune's workspace lints. It drops Rune's `perf`, `bench` and `rune-hot` profiles.
- `Cargo.lock` becomes `rust/Cargo.lock`, so ARK builds with the same dependency versions.
- `rust-toolchain.toml` becomes `rust/rust-toolchain.toml` (1.99.1). It drops the `rustfmt` component.

## ARK patches

None. Each ARK change to a file in this folder gets one line here: the file, the reason and the ADR.

## Later commits on `dev`

On 2026-11-11 `dev` was at `40504db3`, two commits after the copy:

- `e42fdff6`: `rune-luau` starts a script from precompiled bytecode. ARK does not copy `rune-luau`.
- `40504db3`: icons draw a stroke of one device pixel or less as a hairline (`crates/rune/src/text/hairline.rs`, `text/icon.rs`, `text.rs`). Not in the copy. Take it with the next update.

## How to update the copy

1. Pick a new commit on `dev`. Read its changelog entries.
2. Download that commit into a temporary folder outside the ARK repository.
3. Replace each kept crate folder, `themes/opencode`, `LICENSE` and `clippy.toml` with the new version.
4. Copy the upstream `Cargo.lock` to `rust/Cargo.lock`. Compare the upstream `Cargo.toml` profiles and lints with `rust/Cargo.toml`.
5. Apply each ARK patch in the list above again.
6. If a kept crate has a new path dependency, copy that crate too and add it to this file and to `rust/Cargo.toml`.
7. In `rust/`, run `cargo build`, `cargo test` and the headless snapshot (`rust/README.md`).
8. Update the commit, the date and the lists in this file. Update `rust/THIRD_PARTY.txt`.
9. Delete the temporary folder.
