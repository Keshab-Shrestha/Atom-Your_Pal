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
    col().key(format!("msg-{i}")).w_full().child(Markdown::new(m.text.clone()).selectable(true).build(k).key("md"))
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
    row().key("composer-row").w_full().max_w(COLUMN).gap(8.0).items_end().child(col().grow(1.0).min_w(0.0).child(input.w_full())).child(send)
}

pub fn view(app: &App, k: &Kit) -> El {
    let mut bottom = col().w_full().items_center().padding(16.0).gap(8.0);
    if let Some(banner) = &app.model.banner {
        bottom = bottom.child(text(banner.clone()).key("banner").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    bottom = bottom.child(composer(app, k));
    col().key("chat").w_full().h_full().min_h(0.0).child(transcript(app, k)).child(bottom)
}
