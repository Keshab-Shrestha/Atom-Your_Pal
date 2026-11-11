# ARK in Rust

This folder holds the Rust build of ARK (ADR-278, docs/rust-migration-plan.md). It is in Phase 0. The running ARK app does not use this code.

## Contents

- `Cargo.toml`: the Cargo workspace. `cargo build` and `cargo test` act on ARK's own crates only.
- `rust-toolchain.toml`: Rust 1.99.1, the same version as Rune.
- `vendor/rune/`: a copy of part of Rune (MIT), the UI base. `vendor/rune/UPSTREAM.md` gives the source commit and the ARK patches.
- `crates/ark-hello/`: a hello window. It proves that the Rune copy builds, draws headless and reports its tree.
- `THIRD_PARTY.txt`: the third-party licences of the Rust build.

## Set up

1. Install `rustup` (for example, `brew install rustup`).
2. Run `rustup toolchain install 1.99.1 --profile minimal --component clippy`.
3. Run the commands below in this folder. `rust-toolchain.toml` selects 1.99.1.

On macOS, Rune needs the Xcode Command Line Tools and no other system libraries.

## Build, test and run

```sh
cargo build                     # debug build of ark-hello
cargo test                      # ark-hello tests (they run the headless snapshot and tree)
cargo run -p ark-hello          # open the hello window
cargo run -p ark-hello -- --snap hello.png --scale 2   # draw the window to a PNG, no screen
cargo run -p ark-hello -- --tree tree.json             # write the element and accessibility tree
cargo clippy -p ark-hello --all-targets --no-deps -- -D warnings
```

Rune's own tools work on every Rune app: `--scene`, `--at`, `--size`, `--theme`, `--script`, `--trace`. The Rune README in `vendor/rune/crates/rune/README.md` ("Agent tooling") lists them.

Build output goes to `target/` (not in git). A debug and a release build use about 3.3 GB.

## Update the Rune copy

Follow "How to update the copy" in `vendor/rune/UPSTREAM.md`.
