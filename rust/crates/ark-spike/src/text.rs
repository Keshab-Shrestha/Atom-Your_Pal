//! Check group A (text) and D (a11y): Rune's single-line and multi-line text fields, with a log
//! of keys, text changes, input-method compositions (preedit) and paste forms.

use rune::tok::{self, type_};
use rune::{AppSpec, ClipboardContent, Cx, El, KeyEvent, TextEdit, Tx, col, row, text, text_input};

use crate::log::{self, log};

pub struct Text {
    single: TextEdit,
    multi: TextEdit,
    spellcheck: bool,
    /// The last preedit seen for each field, to log only changes.
    preedit: [Option<String>; 2],
    /// `log::count()` at the last frame.
    seen: u64,
}

fn init() -> Text {
    let mut single = TextEdit::new("");
    single.focused = true;
    Text { single, multi: TextEdit::new(""), spellcheck: true, preedit: [None, None], seen: 0 }
}

fn field_log(field: &str, edit: &TextEdit) {
    log(format!("{field} change: {}", log::short(&edit.text)));
}

fn key_log(field: &'static str) -> impl Fn(&mut Text, &KeyEvent, &mut Tx) -> bool {
    move |_, ev, _| {
        let m = ev.mods;
        let mods: Vec<&str> = [(m.cmd, "cmd"), (m.ctrl, "ctrl"), (m.alt, "alt"), (m.shift, "shift")].into_iter().filter(|(on, _)| *on).map(|(_, n)| n).collect();
        log(format!("{field} key: {:?} {}", ev.key, mods.join("+")));
        false
    }
}

fn paste_log(field: &'static str) -> impl Fn(&mut Text, &ClipboardContent, &mut Tx) -> bool {
    move |_, c, _| {
        log(format!(
            "{field} paste: text={} html={} rtf={} image={} files={}",
            log::short(c.text()),
            c.html().is_some(),
            c.rtf().is_some(),
            c.image().is_some(),
            c.files().len()
        ));
        false // the editor pastes the plain text as usual
    }
}

/// Logs each change of an input-method composition; true when it logged.
fn poll(s: &mut Text, _: f64, _: &mut Tx) -> bool {
    for (i, (name, edit)) in [("single", &s.single), ("multi", &s.multi)].into_iter().enumerate() {
        let now = edit.preedit().map(|(p, _)| p.to_owned());
        if now != s.preedit[i] {
            match &now {
                Some(p) => log(format!("{name} preedit: {}", log::short(p))),
                None => log(format!("{name} preedit end")),
            }
            s.preedit[i] = now;
        }
    }
    let changed = log::count() != s.seen;
    s.seen = log::count();
    changed
}

fn view(s: &Text, _: &mut Cx<Text>) -> El {
    let t = tok::theme(true);
    let field = |el: El| el.padding(6.0).w_full().border(1.0, t.separator).radius(6.0).caret(t.text, t.press).color(t.text);
    col().w_full().h_full().gap(8.0).padding(16.0).pt(36.0).fill(t.bg)
        .on_spellcheck(s.spellcheck, |s: &mut Text, on, _| {
            s.spellcheck = on;
            log(format!("spellcheck: {on}"));
        })
        .child(text("ARK spike: text").key("heading").role("heading").font(type_::TITLE).color(t.text))
        .child(text("Single-line field").color(t.text_secondary))
        .child(field(text_input(&s.single, type_::BODY).single_line())
            .key("single").label("Single-line field")
            .spellcheck(s.spellcheck)
            .on_edit(|s: &mut Text| &mut s.single)
            .on_input_change(|s: &mut Text, _| field_log("single", &s.single))
            .on_input_key(key_log("single"))
            .on_input_paste(paste_log("single")))
        .child(text("Multi-line field (Shift+Return: new line)").color(t.text_secondary))
        .child(field(text_input(&s.multi, type_::BODY))
            .key("multi").label("Multi-line field").h(90.0)
            .spellcheck(s.spellcheck)
            .on_edit(|s: &mut Text| &mut s.multi)
            .on_input_change(|s: &mut Text, _| field_log("multi", &s.multi))
            .on_input_key(key_log("multi"))
            .on_input_paste(paste_log("multi"))
            .on_submit(|s: &mut Text, _| log(format!("multi submit: {}", log::short(&s.multi.text)))))
        .child(row().gap(8.0)
            .child(text("Test button").key("test-button").role("button").padding(6.0).radius(6.0).fill(t.card).color(t.text)
                .on_press(|_: &mut Text| log("test button pressed"))))
        .child(text("Event log").color(t.text_secondary))
        .child(log::view(14, t.text))
}

/// The text check's app; the embed host (`embed.rs`) draws the same app in a SwiftUI view.
pub fn spec() -> AppSpec<Text> {
    AppSpec { setup: Some(|_, w| log::set_waker(w)), poll: Some(poll), ..AppSpec::new("ARK spike: text", (560.0, 640.0), init, view) }
}

pub fn run() {
    rune::run(spec());
}
