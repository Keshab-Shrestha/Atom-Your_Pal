//! The pages: settings, agents, tasks and dashboard. Each reads the model and has no state of its own.

use ark_protocol::Command;
use ark_ui::{Helper, Job, JobState, Stats};
use rune::{El, ScrollSpec, col, row, text};
use rune_kit::{Button, ButtonVariant, Kit};

use crate::app::App;

const COLUMN: f32 = 720.0;

/// A scrolling page with a title and a column of cards.
pub fn page(k: &Kit, key: &'static str, title: &str, cards: Vec<El>) -> El {
    let mut body = col().key(key).w_full().max_w(COLUMN).gap(14.0).padding(24.0).child(text(title.to_owned()).key("page-title").font(k.ty.body_medium).color(k.c.text_base));
    for card in cards {
        body = body.child(card);
    }
    col().w_full().grow(1.0).min_h(0.0).items_center().scroll(ScrollSpec { stick_bottom: false }).child(body)
}

fn card(k: &Kit, key: &str, title: &str) -> El {
    col()
        .key(key.to_owned())
        .w_full()
        .gap(8.0)
        .padding(14.0)
        .radius(k.radius.md)
        .fill(k.c.layer_01)
        .border(1.0, k.c.border_weak)
        .child(text(title.to_owned()).font(k.ty.ui_medium).color(k.c.text_base))
}

fn line(k: &Kit, label: &str, value: String) -> El {
    row()
        .w_full()
        .justify_between()
        .gap(12.0)
        .child(text(label.to_owned()).font(k.ty.ui).color(k.c.text_muted))
        .child(text(value).font(k.ty.ui).color(k.c.text_base).wrap())
}

fn yes_no(on: bool) -> String {
    if on { "On" } else { "Off" }.to_owned()
}

pub fn settings(app: &App, k: &Kit) -> El {
    let m = &app.model;
    let mut model = card(k, "settings-model", "Model");
    if m.providers.is_empty() {
        model = model.child(line(k, "In use", format!("{} · {}", m.provider, m.model)));
    }
    for p in &m.providers {
        let mut models = row().gap(8.0).wrap();
        for (id, name) in &p.models {
            let current = m.provider == p.id && m.model == *id;
            let (provider, model_id) = (p.id.clone(), id.clone());
            models = models.child(
                Button::new(name.clone())
                    .variant(if current { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                    .disabled(!p.available)
                    .on_press(move |s: &mut App| s.send(&Command::ModelSet { provider: provider.clone(), model: model_id.clone() }))
                    .build(k)
                    .key(format!("model-{}-{id}", p.id)),
            );
        }
        let title = if p.available { p.name.clone() } else { format!("{} (no key)", p.name) };
        model = model.child(col().gap(6.0).child(text(title).font(k.ty.ui_medium).color(k.c.text_base)).child(models));
    }
    let api = match &m.api {
        Some(a) if a.on => format!("On, port {}", a.port),
        Some(a) => a.error.clone().unwrap_or_else(|| "Off".into()),
        None => "Unknown".into(),
    };
    let connections = card(k, "settings-connections", "Connections")
        .child(line(k, "Microphone", if m.microphone.is_empty() { "None".into() } else { m.microphone.clone() }))
        .child(line(k, "Voice", yes_no(m.voice)))
        .child(line(k, "Telegram bot", yes_no(m.telegram)))
        .child(line(k, "Computer control", yes_no(m.computer)))
        .child(line(k, "Local API", api));
    let mut cards = vec![model, connections];
    if let Some(used) = m.plan_usage.0 {
        cards.push(card(k, "settings-plan", "Plan usage").child(line(k, "Last five hours", format!("{:.0}%", used * 100.0))).child(line(
            k,
            "Last seven days",
            m.plan_usage.1.map_or("Unknown".into(), |u| format!("{:.0}%", u * 100.0)),
        )));
    }
    page(k, "settings", "Settings", cards)
}

fn helper_card(h: &Helper, k: &Kit) -> El {
    let running = h.jobs.iter().find(|j| j.state == JobState::Running);
    let status = match (h.available, running) {
        (false, _) => "Coming soon".to_owned(),
        (true, Some(j)) => j.step.clone().unwrap_or_else(|| "Working".into()),
        (true, None) => "Idle".to_owned(),
    };
    let mut meta = vec![h.role.clone()];
    if let Some(kit) = &h.kit {
        meta.push(format!("{kit} kit"));
    }
    if h.custom {
        meta.push("custom".into());
    }
    card(k, &format!("agent-{}", h.id), &h.name)
        .child(text(meta.join(" · ")).font(k.ty.small).color(k.c.text_muted))
        .child(line(k, "Status", status))
        .child(line(k, "Tasks", h.jobs.len().to_string()))
}

pub fn agents(app: &App, k: &Kit) -> El {
    let cards = match &app.model.helpers {
        None => vec![text("Loading agents…").key("agents-loading").font(k.ty.ui).color(k.c.text_faint)],
        Some(helpers) if helpers.is_empty() => vec![text("No agents yet.").key("agents-empty").font(k.ty.ui).color(k.c.text_faint)],
        Some(helpers) => helpers.iter().map(|h| helper_card(h, k)).collect(),
    };
    page(k, "agents", "Agents", cards)
}

fn state_label(state: JobState) -> (&'static str, bool) {
    match state {
        JobState::Queued => ("Queued", false),
        JobState::Running => ("Running", false),
        JobState::Done => ("Done", false),
        JobState::Failed => ("Failed", true),
        JobState::Stopped => ("Stopped", false),
    }
}

fn job_card(j: &Job, helper_name: &str, k: &Kit) -> El {
    let (label, bad) = state_label(j.state);
    let detail = j.error.clone().or_else(|| j.held.clone()).or_else(|| j.step.clone()).or_else(|| j.summary.clone());
    let id = j.id;
    let action = match j.state {
        JobState::Queued | JobState::Running => Some(Button::new("Stop").on_press(move |s: &mut App| s.send(&Command::JobStop { id })).build(k).key(format!("stop-{id}"))),
        JobState::Failed | JobState::Stopped => {
            Some(Button::new("Retry").on_press(move |s: &mut App| s.send(&Command::JobRetry { id })).build(k).key(format!("retry-{id}")))
        }
        JobState::Done => None,
    };
    let mut c = card(k, &format!("job-{id}"), j.title.as_deref().unwrap_or(&j.task))
        .child(text(format!("{helper_name} · {label}")).font(k.ty.small).color(if bad { k.c.danger.fg } else { k.c.text_muted }));
    if let Some(d) = detail {
        c = c.child(text(d).font(k.ty.ui).color(k.c.text_muted).wrap());
    }
    match action {
        Some(a) => c.child(row().justify_end().child(a)),
        None => c,
    }
}

pub fn tasks(app: &App, k: &Kit) -> El {
    let jobs = app.model.jobs();
    let cards = if jobs.is_empty() {
        vec![text("No tasks yet.").key("tasks-empty").font(k.ty.ui).color(k.c.text_faint)]
    } else {
        let name = |id: &str| app.model.helpers.iter().flatten().find(|h| h.id == id).map_or_else(|| id.to_owned(), |h| h.name.clone());
        jobs.into_iter().map(|j| job_card(j, &name(&j.helper), k)).collect()
    };
    page(k, "tasks", "Tasks", cards)
}

fn tile(k: &Kit, key: &str, label: &str, value: String) -> El {
    col()
        .key(key.to_owned())
        .grow(1.0)
        .gap(2.0)
        .padding(14.0)
        .radius(k.radius.md)
        .fill(k.c.layer_01)
        .border(1.0, k.c.border_weak)
        .child(text(value).font(k.ty.body_medium).color(k.c.text_base))
        .child(text(label.to_owned()).font(k.ty.small).color(k.c.text_muted))
}

fn stats_cards(s: &Stats, k: &Kit) -> Vec<El> {
    let tiles = row()
        .w_full()
        .gap(10.0)
        .child(tile(k, "tile-turns", "Turns", s.turns.to_string()))
        .child(tile(k, "tile-answer", "Average answer", format!("{} ms", s.avg_turn_ms)))
        .child(tile(k, "tile-calls", "Tool calls", s.total_calls.to_string()))
        .child(tile(k, "tile-failed", "Failed calls", s.total_failed.to_string()));
    let mut tools = card(k, "dashboard-tools", &format!("Tools, last {} days", s.days));
    for t in &s.tools {
        tools = tools.child(line(k, &t.name, format!("{} calls · {} failed · {} ms", t.calls, t.failed, t.avg_ms)));
    }
    vec![tiles, tools]
}

pub fn dashboard(app: &App, k: &Kit) -> El {
    let cards = match &app.model.stats {
        None => vec![text("Loading numbers…").key("dashboard-loading").font(k.ty.ui).color(k.c.text_faint)],
        Some(s) => stats_cards(s, k),
    };
    page(k, "dashboard", "Dashboard", cards)
}
