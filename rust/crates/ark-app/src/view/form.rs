//! The form pane: labelled text areas, a kit choice for a new agent, Save and Cancel.

use ark_protocol::commands::AgentKit;
use rune::{El, row, text};
use rune_kit::{Button, ButtonVariant, Kit, TextArea};

use super::pages::page;
use crate::app::App;
use crate::form::{Form, FormKind};

fn kit_buttons(form: &Form, k: &Kit) -> El {
    let mut r = row().gap(8.0);
    for (kit, label) in [(AgentKit::Research, "Research"), (AgentKit::Folders, "Folders"), (AgentKit::Think, "Think")] {
        r = r.child(
            Button::new(label)
                .variant(if form.kit == kit { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                .on_press(move |s: &mut App| {
                    if let Some(f) = s.form.as_mut() {
                        f.kit = kit;
                    }
                })
                .build(k)
                .key(format!("kit-{label}")),
        );
    }
    r
}

pub fn view(app: &App, form: &Form, k: &Kit) -> El {
    let mut cards = Vec::new();
    for (i, label) in form.labels().iter().enumerate() {
        let area = TextArea::new(&form.fields[i])
            .label(*label)
            .placeholder(*label)
            .auto_grow(1, 8)
            .on_edit(move |s: &mut App| {
                let f = s.form.get_or_insert_with(Form::new_agent);
                let last = f.fields.len() - 1;
                &mut f.fields[i.min(last)]
            })
            .build(k)
            .key(format!("field-{i}"))
            .w_full();
        cards.push(text((*label).to_owned()).key(format!("label-{i}")).font(k.ty.small).color(k.c.text_muted));
        cards.push(area);
    }
    if form.kind == FormKind::NewAgent {
        cards.push(kit_buttons(form, k));
    }
    if let Some(banner) = &app.form_error {
        cards.push(text(banner.clone()).key("form-error").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    cards.push(
        row()
            .justify_end()
            .gap(8.0)
            .child(Button::new("Cancel").on_press(|s: &mut App| s.close_form()).build(k).key("form-cancel"))
            .child(Button::new("Save").variant(ButtonVariant::Submit).on_press(|s: &mut App| s.submit_form()).build(k).key("form-save")),
    );
    page(k, "form", &form.title(), cards)
}
