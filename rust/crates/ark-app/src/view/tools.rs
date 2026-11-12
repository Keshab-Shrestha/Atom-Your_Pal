//! Local backup (LocalBackupPane.swift), reply drafts (ReplyDraftPane.swift) and plans (PlanViews.swift).

use ark_protocol::Command;
use rune::{El, row, text};
use rune_kit::{Button, ButtonVariant, Kit, TextArea};

use super::pages::{card, page, waiting};
use crate::app::{App, Screen};
use crate::form::Form;
use crate::more::PLAN_MARKS;

fn btn(k: &Kit, key: String, label: &str, on: bool, f: impl Fn(&mut App) + Send + Sync + 'static) -> El {
    Button::new(label).variant(if on { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(f).build(k).key(key)
}

fn note(k: &Kit, key: &str, words: String) -> El {
    text(words).key(key.to_owned()).font(k.ty.small).color(k.c.text_muted).wrap()
}

pub fn backup(app: &App, k: &Kit) -> El {
    let mut cards = vec![note(k, "bk-intro", "A model on this Mac or your network answers when the cloud is down. Messages stay in this window and are not saved.".into())];
    let Some(b) = &app.model.extras.backup else {
        cards.push(waiting(app, "bk-loading", "the backup model", k));
        return page(k, "backup", "Local backup", cards);
    };
    let set = !b.endpoint.is_empty();
    let (endpoint, model) = (b.endpoint.clone(), b.model.clone());
    let ready = match b.ready {
        Some((true, true)) => "Ready: the model is listed and answered a test.",
        Some((true, false)) => "The model is listed but did not answer a test.",
        Some((false, _)) => "The server did not list this model.",
        None => "Not checked yet.",
    };
    let armed = app.more.confirm.as_deref() == Some("backup-forget");
    let mut c = card(k, "bk-config", "Model").child(note(k, "bk-address", if set { format!("{} · {}", b.endpoint, b.model) } else { "Not set.".into() })).child(note(k, "bk-ready", ready.into()));
    if let Some(error) = &b.error {
        c = c.child(text(error.clone()).key("bk-error").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    if let Some(usage) = &b.usage {
        c = c.child(note(k, "bk-usage", usage.clone()));
    }
    cards.push(c.child(
        row()
            .gap(8.0)
            .wrap()
            .child(btn(k, "bk-set".into(), "Set address", !set, move |s| s.open_form(Form::backup_config(&endpoint, &model))))
            .child(btn(k, "bk-check".into(), "Check", false, |s| s.backup("probe", serde_json::json!({}))))
            .child(btn(k, "bk-forget".into(), if armed { "Confirm forget" } else { "Forget" }, armed, |s| s.confirm_or("backup-forget", |s| s.backup("forget", serde_json::json!({}))))),
    ));
    let mut chat = card(k, "bk-chat", "Try it");
    if b.turns.is_empty() {
        chat = chat.child(note(k, "bk-none", "No messages yet.".into()));
    }
    for (i, (role, content)) in b.turns.iter().enumerate() {
        chat = chat.child(text(format!("{}: {content}", if role == "user" { "You" } else { "Backup" })).key(format!("bk-turn-{i}")).font(k.ty.ui).color(k.c.text_base).wrap());
    }
    cards.push(chat.child(row().gap(8.0).justify_end().child(btn(k, "bk-clear".into(), "Clear", false, |s| s.backup("clear", serde_json::json!({})))).child(btn(k, "bk-send".into(), "Send a message", set, |s| s.open_form(Form::backup_send())))));
    page(k, "backup", "Local backup", cards)
}

fn area(app: &App, k: &Kit, i: usize, label: &'static str, key: &'static str) -> El {
    let _ = app;
    TextArea::new(&app.more.reply[i]).placeholder(label).label(label).auto_grow(2, 6).on_edit(move |s: &mut App| &mut s.more.reply[i]).build(k).key(key).w_full()
}

pub fn replies(app: &App, k: &Kit) -> El {
    let d = &app.model.extras.drafts;
    let mut cards = vec![note(k, "rp-intro", "Paste what someone wrote, say what you want to answer, and ARK drafts one reply. It never sends anything.".into()), area(app, k, 0, "What they wrote", "rp-conversation"), area(app, k, 1, "What you want to say", "rp-intent"), area(app, k, 2, "Background (optional)", "rp-background")];
    let lookup = TextArea::new(&app.more.reply[3]).placeholder("Look in your notes (optional)").label("Look in your notes").auto_grow(1, 1).on_edit(|s: &mut App| &mut s.more.reply[3]).on_submit(|s: &mut App, _| { let q = s.more.reply[3].text.trim().to_owned(); s.reply_lookup(&q); }).build(k).key("rp-lookup").w_full();
    cards.push(lookup);
    for (i, (id, title, _, excerpt)) in d.items.iter().enumerate() {
        let on = app.more.reply_checked.contains(id);
        let id = id.clone();
        cards.push(
            card(k, &format!("rp-note-{i}"), title)
                .child(text(excerpt.chars().take(200).collect::<String>()).key(format!("rp-excerpt-{i}")).font(k.ty.small).color(k.c.text_muted).wrap())
                .child(row().justify_end().child(btn(k, format!("rp-use-{i}"), if on { "Using it" } else { "Use this note" }, on, move |s| {
                    if let Some(at) = s.more.reply_checked.iter().position(|x| *x == id) { s.more.reply_checked.remove(at); } else { s.more.reply_checked.push(id.clone()); }
                }))),
        );
    }
    cards.push(row().justify_end().child(btn(k, "rp-draft".into(), "Draft a reply", true, |s| s.reply_draft())));
    if let Some(error) = &d.error {
        cards.push(text(error.clone()).key("rp-error").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    if let Some(reply) = &d.text {
        let whole = reply.clone();
        cards.push(card(k, "rp-result", "Draft").child(text(reply.clone()).font(k.ty.ui).color(k.c.text_base).wrap()).child(row().justify_end().child(Button::new("Copy").on_press_tx(move |_: &mut App, tx: &mut rune::Tx| tx.copy(whole.clone())).build(k).key("rp-copy"))));
    }
    page(k, "replies", "Reply drafts", cards)
}

pub fn plans(app: &App, k: &Kit) -> El {
    let x = &app.model.extras;
    let mut cards = vec![note(k, "pl-intro", "A plan waits for your OK before an agent starts. Work plans split one goal into parts.".into())];
    if app.model.helpers.is_none() {
        cards.push(waiting(app, "pl-loading", "plans", k));
        return page(k, "plans", "Plans", cards);
    }
    if x.task_plans.is_empty() && x.plans.is_empty() {
        cards.push(card(k, "pl-empty", "No plans").child(text("Nothing waits for your OK.").font(k.ty.ui).color(k.c.text_faint)));
    }
    for p in &x.task_plans {
        let id = p.job;
        cards.push(
            card(k, &format!("tp-{id}"), &format!("{} has a plan for your OK", p.helper))
                .child(note(k, &format!("tp-task-{id}"), p.task.clone()))
                .child(text(p.summary.clone()).key(format!("tp-summary-{id}")).font(k.ty.ui).color(k.c.text_base).wrap())
                .child(row().gap(8.0).justify_end().child(btn(k, format!("tp-reject-{id}"), "Reject", false, move |s| s.send(&Command::PlanReject { id }))).child(btn(k, format!("tp-approve-{id}"), "Approve", true, move |s| s.send(&Command::PlanApprove { id })))),
        );
    }
    for plan in &x.plans {
        let pid = plan.id;
        let status = if plan.complete { "Done" } else if plan.stuck { "Stuck" } else { "In progress" };
        let mut c = card(k, &format!("wp-{pid}"), &plan.goal).child(note(k, &format!("wp-state-{pid}"), status.into()));
        for q in &plan.portions {
            let n = q.n;
            let mark = app.more.plan_notes.iter().find(|m| m.0 == pid && m.1 == n).map(|m| m.2);
            let mut marks = row().gap(6.0).wrap();
            for (i, label) in PLAN_MARKS.iter().enumerate() {
                marks = marks.child(btn(k, format!("wp-mark-{pid}-{n}-{i}"), label, mark == Some(i), move |s| s.mark_portion(pid, n, i)));
            }
            if let Some(job) = q.job {
                marks = marks.child(btn(k, format!("wp-open-{pid}-{n}"), "Open", false, move |s| {
                    s.screen = Screen::Tasks;
                    s.open_job = Some(job);
                    s.send(&Command::JobOpen { id: job });
                }));
            }
            c = c.child(text(format!("P{n} {} · {} · {}", q.agent, q.state_text(&plan.portions), q.task)).key(format!("wp-portion-{pid}-{n}")).font(k.ty.ui).color(k.c.text_base).wrap()).child(marks);
        }
        let has_notes = app.more.plan_notes.iter().any(|m| m.0 == pid);
        cards.push(c.child(row().gap(8.0).justify_end().child(btn(k, format!("wp-dismiss-{pid}"), "Dismiss", false, move |s| s.send(&Command::PlanDismiss { id: pid }))).child(btn(k, format!("wp-notes-{pid}"), "Send notes", has_notes, move |s| s.send_plan_notes(pid)))));
    }
    page(k, "plans", "Plans", cards)
}
