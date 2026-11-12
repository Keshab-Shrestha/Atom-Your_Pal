//! The chat view: messages, tool cards, approval cards and the composer.

use ark_protocol::Command;
use ark_ui::{Approval, Message, Question, Role, ToolCall, ToolState, Work, WorkState};
use rune::{El, ScrollSpec, col, row, text};
use rune_kit::{Button, ButtonVariant, Kit, Markdown, TextArea};

use crate::app::App;

const COLUMN: f32 = 760.0;

pub fn status(app: &App, k: &Kit, line: &str) -> El {
    let c = &k.c;
    let ink = if matches!(app.model.conn, ark_ui::Conn::Down(_)) { c.danger.fg } else { c.text_muted };
    text(line.to_owned()).key("status").font(k.ty.small).color(ink)
}

fn user_bubble(m: &Message, i: usize, k: &Kit) -> El {
    row().key(format!("msg-{i}")).w_full().justify_end().child(
        col().max_w(560.0).py(8.0).px(14.0).radius(k.radius.md).fill(k.c.layer_02).child(text(m.text.clone()).font(k.ty.body).color(k.c.text_base).wrap().selectable(true)),
    )
}

fn assistant_message(m: &Message, i: usize, k: &Kit) -> El {
    let whole = m.text.clone();
    let copy = Button::new("Copy").on_press_tx(move |_: &mut App, tx: &mut rune::Tx| tx.copy(whole.clone())).build(k).key(format!("copy-{i}"));
    let mut body = col().key(format!("msg-{i}")).w_full().gap(8.0);
    for (n, piece) in super::visual::split(&m.text).into_iter().enumerate() {
        body = body.child(match piece {
            super::visual::Piece::Text(t) => Markdown::new(t).selectable(true).build(k).key(format!("md-{n}")),
            super::visual::Piece::Visual(v) => super::visual::card(&v, format!("visual-{i}-{n}"), k),
        });
    }
    body.child(row().justify_end().child(copy))
}

fn tool_dot(state: ToolState, k: &Kit) -> rune::Color {
    match state {
        ToolState::Started => k.c.info.icon,
        ToolState::Ok => k.c.success.icon,
        ToolState::Error => k.c.danger.icon,
        ToolState::Unknown => k.c.text_faint,
    }
}

fn tool_card(call: &ToolCall, k: &Kit) -> El {
    let label = match (call.state, call.ms) {
        (ToolState::Started, _) => "running".to_owned(),
        (ToolState::Ok, Some(ms)) => format!("done in {ms} ms"),
        (ToolState::Ok, None) => "done".to_owned(),
        (ToolState::Error, _) => "failed".to_owned(),
        (ToolState::Unknown, _) => "unknown".to_owned(),
    };
    row()
        .key(format!("tool-{}", call.id))
        .w_full()
        .gap(8.0)
        .center_y()
        .py(6.0)
        .px(10.0)
        .radius(k.radius.md)
        .fill(k.c.layer_01)
        .border(1.0, k.c.border_weak)
        .child(row().size(8.0, 8.0).radius(4.0).fill(tool_dot(call.state, k)))
        .child(text(call.tool.clone()).font(k.ty.mono).color(k.c.text_base))
        .child(row().grow(1.0))
        .child(text(label).font(k.ty.small).color(k.c.text_muted))
}

fn work_card(work: &Work, k: &Kit) -> Option<El> {
    if work.calls.is_empty() && work.state != WorkState::Working {
        return None;
    }
    let head = match work.state {
        WorkState::Working => format!("Working · {}s", work.elapsed_ms / 1000),
        WorkState::Completed => "Finished".to_owned(),
        WorkState::Failed => "Failed".to_owned(),
        WorkState::Stopped => "Stopped".to_owned(),
    };
    let mut card = col().key("work").w_full().gap(6.0).child(text(head).key("work-title").font(k.ty.small_medium).color(k.c.text_muted));
    for call in &work.calls {
        card = card.child(tool_card(call, k));
    }
    if work.omitted > 0 {
        card = card.child(text(format!("{} earlier calls hidden", work.omitted)).font(k.ty.small).color(k.c.text_faint));
    }
    Some(card)
}

fn approval_card(a: &Approval, k: &Kit) -> El {
    let (allow_id, decline_id) = (a.id.clone(), a.id.clone());
    col()
        .key(format!("approval-{}", a.id))
        .role("group")
        .label("Approval needed")
        .w_full()
        .gap(8.0)
        .padding(14.0)
        .radius(k.radius.md)
        .fill(k.c.layer_02)
        .border(1.0, k.c.warning.border)
        .child(text("ARK asks first").font(k.ty.small_medium).color(k.c.warning.fg))
        .child(text(a.summary.clone()).font(k.ty.ui_medium).color(k.c.text_base).wrap())
        .child(text(a.reason.clone()).font(k.ty.ui).color(k.c.text_muted).wrap())
        .child(
            row()
                .gap(8.0)
                .justify_end()
                .child(Button::new("Decline").on_press(move |s: &mut App| decide(s, &decline_id, false)).build(k).key(format!("decline-{}", a.id)))
                .child(Button::new("Allow").variant(ButtonVariant::Submit).on_press(move |s: &mut App| decide(s, &allow_id, true)).build(k).key(format!("allow-{}", a.id))),
        )
}

fn decide(app: &mut App, id: &str, approved: bool) {
    if let Some(bridge) = &app.bridge {
        bridge.answer(id, approved);
    }
    app.model.close_approval(id);
}

fn question_card(q: &Question, work: &Work, k: &Kit) -> El {
    let mut card = col()
        .key(format!("question-{}", q.id))
        .w_full()
        .gap(8.0)
        .padding(14.0)
        .radius(k.radius.md)
        .fill(k.c.layer_02)
        .border(1.0, k.c.border_weak)
        .child(text(q.prompt.clone()).font(k.ty.ui_medium).color(k.c.text_base).wrap());
    let mut choices = row().gap(8.0).wrap();
    for (i, choice) in q.choices.iter().enumerate() {
        let (chat, turn, id, answer) = (work.chat.clone(), work.turn.clone(), q.id.clone(), choice.clone());
        choices = choices.child(
            Button::new(choice.clone())
                .on_press(move |s: &mut App| {
                    s.send(&Command::ChatQuestionAnswer { chat: chat.clone(), turn: turn.clone(), id: id.clone(), text: Some(answer.clone()) });
                })
                .build(k)
                .key(format!("choice-{}-{i}", q.id)),
        );
    }
    card = card.child(choices);
    let (chat, turn, id) = (work.chat.clone(), work.turn.clone(), q.id.clone());
    card.child(
        Button::new("Skip")
            .variant(ButtonVariant::Ghost)
            .on_press(move |s: &mut App| s.send(&Command::ChatQuestionAnswer { chat: chat.clone(), turn: turn.clone(), id: id.clone(), text: None }))
            .build(k)
            .key(format!("skip-{}", q.id)),
    )
}

fn transcript(app: &App, k: &Kit) -> El {
    let mut list = col().key("messages").w_full().max_w(COLUMN).gap(18.0).padding(24.0);
    if app.model.messages.is_empty() && app.model.conn == ark_ui::Conn::Ready {
        list = list.child(text("Ask ARK anything.").key("empty").font(k.ty.body).color(k.c.text_faint));
    }
    for (i, m) in app.model.messages.iter().enumerate() {
        list = list.child(match m.role {
            Role::User => user_bubble(m, i, k),
            Role::Assistant => assistant_message(m, i, k),
        });
    }
    if !app.model.streaming.is_empty() {
        let live = ark_ui::Message { role: Role::Assistant, text: app.model.streaming.clone() };
        list = list.child(assistant_message(&live, app.model.messages.len(), k));
    }
    if let Some(work) = &app.model.work {
        if let Some(card) = work_card(work, k) {
            list = list.child(card);
        }
        for q in work.questions.iter().filter(|q| q.state == "pending") {
            list = list.child(question_card(q, work, k));
        }
    }
    for a in &app.model.approvals {
        list = list.child(approval_card(a, k));
    }
    col().key("transcript").w_full().grow(1.0).min_h(0.0).items_center().scroll(ScrollSpec { stick_bottom: true }).child(list)
}

fn composer(app: &App, k: &Kit) -> El {
    let enabled = app.can_type();
    let placeholder = if enabled { "Message ARK" } else { "ARK cannot take a message now" };
    let input = TextArea::new(&app.draft)
        .placeholder(placeholder)
        .label("Message")
        .auto_grow(1, 6)
        .disabled(!enabled)
        .on_edit(|s: &mut App| &mut s.draft)
        .on_submit(|s: &mut App, _| s.submit())
        .build(k)
        .key("composer");
    let send = Button::new("Send").variant(ButtonVariant::Submit).disabled(!enabled).on_press(|s: &mut App| s.submit()).build(k).key("send");
    let attach = Button::new("Attach")
        .disabled(!enabled)
        .on_press_tx(|_: &mut App, tx: &mut rune::Tx| {
            tx.open_file(rune::FileDialogOptions { title: "Attach a file".into(), ..Default::default() }, |s: &mut App, result, _| {
                if let Ok(Some(path)) = result {
                    s.attachments.push(path.to_string_lossy().into_owned());
                }
            });
        })
        .build(k)
        .key("attach");
    let mut chips = row().key("attachments").w_full().gap(6.0).wrap();
    for (i, path) in app.attachments.iter().enumerate() {
        let name = std::path::Path::new(path).file_name().map_or_else(|| path.clone(), |n| n.to_string_lossy().into_owned());
        chips = chips.child(Button::new(format!("{name}  ×")).on_press(move |s: &mut App| {
                if i < s.attachments.len() {
                    s.attachments.remove(i);
                }
            }).build(k).key(format!("chip-{i}")));
    }
    let mut c = col().key("composer-col").w_full().max_w(COLUMN).gap(6.0);
    if !app.attachments.is_empty() {
        c = c.child(chips);
    }
    c.child(row().key("composer-row").w_full().gap(8.0).items_end().child(attach).child(col().grow(1.0).min_w(0.0).child(input.w_full())).child(send))
}

fn find_bar(app: &App, k: &Kit) -> Option<El> {
    let (query, selected) = app.find.as_ref()?;
    let results = ark_ui::find::find(&app.model.messages, &query.text);
    let count = if results.matches.is_empty() { "0 matches".to_owned() } else { format!("{} of {}{}", selected % results.matches.len() + 1, results.matches.len(), if results.more { "+" } else { "" }) };
    let input = TextArea::new(query)
        .placeholder("Find in loaded messages")
        .label("Find in chat")
        .auto_grow(1, 1)
        .on_edit(|s: &mut App| &mut s.find.get_or_insert_with(|| (rune::TextEdit::new(""), 0)).0)
        .on_submit(|s: &mut App, _| s.move_find(1))
        .build(k)
        .key("find-input");
    let none = results.matches.is_empty();
    let step = |label: &'static str, by: isize| Button::new(label).disabled(none).on_press(move |s: &mut App| s.move_find(by)).build(k).key(format!("find-{label}"));
    let detail = match results.selected(*selected) {
        Some(m) => text(format!("{}{}[{}]{}", if m.user { "You: " } else { "ARK: " }, m.before, m.found, m.after)).key("find-detail").font(k.ty.small).color(k.c.text_muted).wrap(),
        None => text("Searches the loaded messages only, not archived history.").key("find-detail").font(k.ty.small).color(k.c.text_faint),
    };
    Some(
        col().key("find-bar").w_full().max_w(COLUMN).gap(4.0).padding(8.0).child(
            row().w_full().gap(8.0).items_center().child(col().grow(1.0).min_w(0.0).child(input.w_full())).child(text(count).key("find-count").font(k.ty.small).color(k.c.text_muted)).child(step("Previous", -1)).child(step("Next", 1)).child(Button::new("Close").on_press(|s: &mut App| s.toggle_find()).build(k).key("find-close")),
        ).child(detail),
    )
}

pub fn view(app: &App, k: &Kit) -> El {
    let mut bottom = col().w_full().items_center().padding(16.0).gap(8.0);
    if let Some(banner) = &app.model.banner {
        bottom = bottom.child(text(banner.clone()).key("banner").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    bottom = bottom.child(composer(app, k));
    let mut chat = col().key("chat").w_full().h_full().min_h(0.0).items_center();
    if let Some(bar) = find_bar(app, k) {
        chat = chat.child(bar);
    }
    chat.child(transcript(app, k)).child(bottom)
}
