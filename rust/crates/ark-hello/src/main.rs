//! ARK's Phase 0 hello window (ADR-278): one title and one line of text, drawn by Rune.
//! `cargo run -p ark-hello` opens the window. `-- --snap hello.png` draws it headless and
//! `-- --tree tree.json` writes its element and accessibility tree.

use rune::tok::{self, type_};
use rune::{AppSpec, Cx, El, col, text};

const TITLE: &str = "Hello from ARK";
const SUBTITLE: &str = "Rust and Rune, Phase 0";

fn view(_: &(), _: &mut Cx<()>) -> El {
    let t = tok::theme(true);
    col().w_full().h_full().center().gap(8.0).fill(t.bg)
        .child(text(TITLE).key("title").font(type_::TITLE).color(t.text))
        .child(text(SUBTITLE).key("subtitle").color(t.text))
}

fn main() {
    rune::run(AppSpec::new("ARK", (360.0, 200.0), || (), view));
}
