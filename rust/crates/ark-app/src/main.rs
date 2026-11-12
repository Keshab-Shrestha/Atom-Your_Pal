//! `ark-app`: the ARK window. It starts the runtime child (`ARK_RUNTIME_BIN`, `ARK_RUNTIME_ARGS`) and draws its events.
//! Headless: `ARK_UI_EVENTS=events.jsonl ark-app --snap out.png` draws the state those events make, `--tree tree.json` dumps the tree.

use ark_app::app::{self, App};
use ark_app::overlay;
use ark_app::view::{self, CHROME};
use rune::AppSpec;

fn main() {
    let spec = AppSpec {
        setup: Some(app::setup),
        poll: Some(app::poll),
        on_key: Some(view::on_key),
        fonts: rune_theme_opencode::FONTS,
        families: rune_theme_opencode::FAMILIES,
        min_size: Some((640.0, 420.0)),
        ..AppSpec::<App>::new("ARK", (1040.0, 700.0), app::init, view::view)
    };
    let mut app = rune::App::new(spec).chrome(CHROME);
    overlay::install(app.overlay(overlay::spec(), overlay::Pill::default()));
    for item in view::menu_items() {
        app = app.menu_item(item);
    }
    app.run();
}
