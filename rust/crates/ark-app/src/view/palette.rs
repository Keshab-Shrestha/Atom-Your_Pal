//! The command palette pane: a filter field and the matching entries.

use rune::{El, TextEdit, col, text};
use rune_kit::{Button, Kit, TextArea};

use super::pages::page;
use crate::app::App;
use crate::palette::{entries, filter};

pub fn view(app: &App, query: &TextEdit, k: &Kit) -> El {
    let input = TextArea::new(query)
        .placeholder("Type a command or a chat title")
        .label("Command palette")
        .auto_grow(1, 1)
        .on_edit(|s: &mut App| s.palette.get_or_insert_with(|| TextEdit::new("")))
        .on_submit(|s: &mut App, _| {
            let first = s.palette.as_ref().and_then(|q| filter(entries(&s.model), &q.text).into_iter().next());
            if let Some(e) = first {
                s.run_palette(e.action);
            }
        })
        .build(k)
        .key("palette-input")
        .w_full();
    let mut cards = vec![input];
    let hits = filter(entries(&app.model), &query.text);
    if hits.is_empty() {
        cards.push(text("Nothing matches.").key("palette-empty").font(k.ty.ui).color(k.c.text_faint));
    }
    let mut list = col().w_full().gap(4.0);
    for (i, e) in hits.into_iter().take(12).enumerate() {
        let action = e.action.clone();
        list = list.child(Button::new(e.title).on_press(move |s: &mut App| s.run_palette(action.clone())).build(k).key(format!("palette-{i}")));
    }
    cards.push(list);
    cards.push(Button::new("Close").on_press(|s: &mut App| s.toggle_palette()).build(k).key("palette-close"));
    page(k, "palette", "Command palette", cards)
}
