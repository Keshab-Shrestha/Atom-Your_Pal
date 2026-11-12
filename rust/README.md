# ARK in Rust

This folder holds the Rust build of ARK (ADR-278, docs/rust-migration-plan.md). It is in Phase 1. The running ARK app does not use this code.

This folder holds the Rust build of ARK (ADR-278, docs/rust-migration-plan.md). The running ARK app uses this code only when you set `ARK_RUNTIME=rust` (Phase 2.1, below).

## Contents

- `Cargo.toml`: the Cargo workspace. `cargo build` and `cargo test` act on ARK's own crates only.
- `rust-toolchain.toml`: Rust 1.99.1, the same version as Rune.
- `vendor/rune/`: a copy of part of Rune (MIT), the UI base. `vendor/rune/UPSTREAM.md` gives the source commit and the ARK patches.
- `crates/`: ARK's own crates (table below).
- `scripts/gen-fixtures.ts`: runs the TypeScript code and writes the parity fixtures of `ark-core`.

- `crates/ark-hello/`: a hello window. It proves that the Rune copy builds, draws headless and reports its tree.
- `crates/ark-spike/`: the Phase 0.2 spike checks (text input, windows, native views, accessibility). ARK does not ship it. `cargo run -p ark-spike -- --check text|windows|views|a11y` opens one check. `crates/ark-spike/CHECKLIST.md` gives the steps, `docs/rust-phase-0-results.md` the results.

- `crates/ark-protocol/`: the island commands and events as serde types, with a line codec.
- `crates/ark-runtime/`: the runtime forwarder between the Swift app and the Node runtime. It answers `brain.note` and `brain.search` itself.
- `crates/ark-ui/`: the UI state. `Model::apply` folds island events into what the views draw. No window code.
- `crates/ark-app/`: the Rust ARK window (Phase 3). `cargo run -p ark-app` starts the runtime child from `ARK_RUNTIME_BIN` (default: `ark-runtime` next to the app) with `ARK_RUNTIME_ARGS` (default: the Node command). `ark-fake-runtime <script.jsonl>` is a scripted runtime for tests. Headless: `ARK_UI_EVENTS=crates/ark-app/fixtures/chat.jsonl cargo run -p ark-app -- --snap chat.png --size 1040x700 --theme dark`. `ARK_UI_SCREEN=settings|agents|tasks|dashboard` picks the screen.
- `THIRD_PARTY.txt`: the third-party licences of the Rust build.

## Crates

| Crate | Phase | What it holds |
| --- | --- | --- |
| `ark-hello` | 0 | A hello window. It proves that the Rune copy builds, draws headless and reports its tree. |
| `ark-core` | 1 | Pure logic, no IO: safety policy (pure parts), org chart, job tree and quiet mark, `ark-visual` card, questions card, text and unified diffs, shortcut matcher. |

## Parity fixtures

`ark-core/tests/fixtures/*.json` hold inputs and the answers of the TypeScript code. The test `parity` checks each Rust answer against them. When a ported TypeScript function changes, make the fixtures again from the repository root: `node rust/scripts/gen-fixtures.ts` (it needs `pnpm install`). Then run `cargo test -p ark-core`.

## Set up

1. Install `rustup`: `brew install rustup`.
2. Homebrew does not link `rustup`, `cargo` and `rustc` into its `bin` folder. Put them on your PATH: `export PATH="$(brew --prefix rustup)/bin:$PATH"`.
3. Go to this folder (`cd rust`). Run `rustup toolchain install 1.99.1 --profile minimal --component clippy`.
4. Run the commands below in this folder. `rust-toolchain.toml` selects 1.99.1.

Do not run a bare `rustup` or `cargo` command outside this folder. With no default toolchain, `rustup` then installs the `stable` toolchain without a question.

On macOS, Rune needs the Xcode Command Line Tools and no other system libraries.

## Build, test and run

```sh
cargo build                     # debug build of ark-core and ark-hello
cargo test                      # ark-core tests (with the parity fixtures) and ark-hello tests (headless snapshot and tree)
cargo run -p ark-hello          # open the hello window
cargo run -p ark-hello -- --snap hello.png --scale 2   # draw the window to a PNG, no screen
cargo run -p ark-hello -- --tree tree.json             # write the element and accessibility tree
cargo clippy -p ark-core -p ark-hello --all-targets --no-deps -- -D warnings
```

Rune's own tools work on every Rune app: `--scene`, `--at`, `--size`, `--theme`, `--script`, `--trace`. The Rune README in `vendor/rune/crates/rune/README.md` ("Agent tooling") lists them.

Build output goes to `target/` (not in git). A debug and a release build use about 3.3 GB.

## Try the Rust runtime forwarder

`crates/ark-runtime` is Phase 2.1: a pure forwarder. `ark-runtime <program> [args...]` starts the program and copies each line between the app and the program without a change. The program's stderr, its exit code and the signals SIGTERM, SIGINT, SIGHUP and SIGQUIT pass through.

1. Build it in this folder: `cargo build --release -p ark-runtime`.
2. Quit ARK.
3. Start ARK with the forwarder: `open --env ARK_RUNTIME=rust --env ARK_RUNTIME_BIN="$PWD/target/release/ark-runtime" ../apps/mac/island/build/ARK.app`. `build-app.sh` builds ARK.app at that path.
4. ARK works as before. `ps -ax | grep ark-runtime` shows the forwarder with Node as its child.

Without `ARK_RUNTIME=rust`, ARK starts Node directly. With `ARK_RUNTIME=rust` and no forwarder at `ARK_RUNTIME_BIN` or next to the app's binary, ARK shows an error and does not start.

Run the smoke test through the forwarder from the project folder: `ARK_RUNTIME_BIN="$PWD/rust/target/release/ark-runtime" node --test tests/smoke.test.ts`.

## Update the Rune copy

Follow "How to update the copy" in `vendor/rune/UPSTREAM.md`.
