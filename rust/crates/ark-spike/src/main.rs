//! Phase 0.2 spike checks (ADR-278, docs/rust-phase-0-results.md). Not shipped.
//!
//! `cargo run -p ark-spike -- --check text|windows|views|a11y` opens the window for one check
//! group. Each event the check needs is a log line in the window and a `spike:` line on stdout.
//! `--snap` and `--tree` work for `text` and `a11y` (Rune's headless tools).

use ark_spike::{text, views, windows};

const USAGE: &str = "usage: ark-spike --check text|windows|views|a11y [--catch] [--all-spaces] [Rune flags]";

fn main() {
    let args = rune::extra_args();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let check = args.iter().position(|a| a == "--check").and_then(|i| args.get(i + 1)).map(String::as_str);
    match check {
        // a11y uses the text window: it has a heading, labelled fields and a button.
        Some("text") | Some("a11y") => text::run(),
        Some("windows") => windows::run(flag("--catch"), flag("--all-spaces")),
        Some("views") => views::run(),
        _ => {
            eprintln!("{USAGE}");
            std::process::exit(2);
        }
    }
}
