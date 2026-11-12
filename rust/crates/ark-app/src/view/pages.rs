//! The pages: settings, agents, tasks and dashboard. Each reads the model and has no state of its own.

use ark_protocol::Command;
use ark_ui::{Helper, Job, JobState, Stats};
use rune::{El, ScrollSpec, col, row, text};
use rune_kit::{Button, ButtonVariant, Kit};

use crate::app::App;
use crate::form::Form;

const COLUMN: f32 = 720.0;

/// A scrolling page with a title and a column of cards.
pub(super) fn page(k: &Kit, key: &'static str, title: &str, cards: Vec<El>) -> El {
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
    let mut defaults = card(k, "settings-defaults", "New chats");
    let mut access = row().gap(8.0).wrap();
    for (id, label) in crate::prefs::ACCESS {
        let current = app.prefs.access == id;
        let asking = id == "full" && app.confirm_full;
        access = access.child(
            Button::new(if asking { "Confirm Full access" } else { label })
                .variant(if current || asking { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                .on_press(move |s: &mut App| s.set_access(id))
                .build(k)
                .key(format!("access-{id}")),
        );
    }
    defaults = defaults.child(text("Access").font(k.ty.ui_medium).color(k.c.text_base)).child(access);
    if app.confirm_full {
        defaults = defaults.child(text("New chats skip routine file, command and plugin prompts. Protected files and macOS permissions still ask.").key("full-warning").font(k.ty.small).color(k.c.danger.fg).wrap());
    }
    let mut effort = row().gap(8.0).wrap();
    for (id, label) in crate::prefs::EFFORT {
        effort = effort.child(
            Button::new(label)
                .variant(if app.prefs.effort == id { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                .on_press(move |s: &mut App| s.set_effort(id))
                .build(k)
                .key(format!("effort-{}", if id.is_empty() { "model" } else { id })),
        );
    }
    defaults = defaults.child(text("Thinking").font(k.ty.ui_medium).color(k.c.text_base)).child(effort);
    let mut cards = vec![model, defaults, connections];
    if let Some(values) = m.brief {
        let mut brief = card(k, "settings-brief", "Morning brief");
        for (i, ((_, label), on)) in ark_ui::BRIEF_SWITCHES.iter().zip(values).enumerate() {
            let button = Button::new(if on { "On" } else { "Off" })
                .variant(if on { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                .on_press(move |s: &mut App| s.set_brief(i, !on))
                .build(k)
                .key(format!("brief-{i}"));
            brief = brief.child(row().w_full().justify_between().items_center().child(text((*label).to_owned()).font(k.ty.ui).color(k.c.text_base)).child(button));
        }
        cards.push(brief);
    }
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
    let mut actions = row().justify_end().gap(8.0);
    let (task_for, soul_of) = (h.id.clone(), h.clone());
    if h.available {
        actions = actions.child(Button::new("New task").on_press(move |s: &mut App| s.open_form(Form::new_task(&task_for))).build(k).key(format!("newtask-{}", h.id)));
    }
    if soul_of.soul.is_some() {
        actions = actions.child(
            Button::new("Edit soul")
                .on_press(move |s: &mut App| {
                    if let Some(soul) = &soul_of.soul {
                        s.open_form(Form::soul(&soul_of.id, &soul_of.name, soul));
                    }
                })
                .build(k)
                .key(format!("soul-{}", h.id)),
        );
    }
    card(k, &format!("agent-{}", h.id), &h.name)
        .child(text(meta.join(" · ")).font(k.ty.small).color(k.c.text_muted))
        .child(line(k, "Status", status))
        .child(line(k, "Tasks", h.jobs.len().to_string()))
        .child(actions)
}

pub fn agents(app: &App, k: &Kit) -> El {
    let cards = match &app.model.helpers {
        None => vec![text("Loading agents…").key("agents-loading").font(k.ty.ui).color(k.c.text_faint)],
        Some(helpers) if helpers.is_empty() => vec![text("No agents yet.").key("agents-empty").font(k.ty.ui).color(k.c.text_faint)],
        Some(helpers) => helpers.iter().map(|h| helper_card(h, k)).collect(),
    };
    let mut cards = cards;
    cards.push(row().justify_end().child(Button::new("New agent").on_press(|s: &mut App| s.open_form(Form::new_agent())).build(k).key("new-agent")));
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

fn forget_button(id: u64, k: &Kit) -> El {
    Button::new("Forget").on_press(move |s: &mut App| {
        s.send(&Command::MemoryForget { id });
        s.send(&Command::MemoryList);
    }).build(k).key(format!("forget-{id}"))
}

fn note_card(app: &App, k: &Kit) -> Option<El> {
    let note = app.model.brain_note.as_ref()?;
    let id = note.id;
    let mut c = card(k, "brain-note", &note.title).child(text(format!("{:?} · {}", note.kind, note.tags.join(", "))).font(k.ty.small).color(k.c.text_muted));
    c = c.child(text(note.body.clone()).font(k.ty.ui).color(k.c.text_base).wrap());
    let links: Vec<String> = note.links.iter().map(|l| l.title.clone()).collect();
    if !links.is_empty() {
        c = c.child(line(k, "Links", links.join(", ")));
    }
    let backlinks: Vec<String> = note.backlinks.iter().map(|l| l.title.clone()).collect();
    if !backlinks.is_empty() {
        c = c.child(line(k, "Linked from", backlinks.join(", ")));
    }
    let delete = Button::new("Delete note").on_press(move |s: &mut App| {
        s.send(&Command::BrainDelete { id });
        s.model.brain_note = None;
        s.send(&Command::BrainGet);
    });
    Some(c.child(row().justify_end().child(delete.build(k).key("brain-delete"))))
}

pub fn memory(app: &App, k: &Kit) -> El {
    let mut cards = Vec::new();
    match &app.model.memory {
        None => cards.push(text("Loading memory…").key("memory-loading").font(k.ty.ui).color(k.c.text_faint)),
        Some(m) => {
            let mut facts = card(k, "memory-facts", if m.enabled { "What ARK remembers" } else { "Memory is off" });
            if m.facts.is_empty() {
                facts = facts.child(text("Nothing yet.").font(k.ty.ui).color(k.c.text_faint));
            }
            for (id, fact) in &m.facts {
                facts = facts.child(row().w_full().gap(12.0).items_center().child(col().grow(1.0).child(text(fact.clone()).font(k.ty.ui).color(k.c.text_base).wrap())).child(forget_button(*id, k)));
            }
            cards.push(facts);
            if !m.episodes.is_empty() {
                let mut eps = card(k, "memory-episodes", "Past conversations");
                for e in &m.episodes {
                    eps = eps.child(text(e.clone()).font(k.ty.ui).color(k.c.text_muted).wrap());
                }
                cards.push(eps);
            }
        }
    }
    if let Some(open) = note_card(app, k) {
        cards.push(open);
    }
    if let Some(nodes) = &app.model.brain {
        let mut brain = card(k, "brain-notes", "Brain notes");
        for n in nodes.iter().filter(|n| !n.ghost).take(80) {
            let id = n.id;
            brain = brain.child(
                row().w_full().justify_between().items_center().gap(12.0)
                    .child(text(format!("{} · {}", n.title, n.kind)).font(k.ty.ui).color(k.c.text_base))
                    .child(Button::new("Open").on_press(move |s: &mut App| s.send(&Command::BrainNote { id })).build(k).key(format!("note-{id}"))),
            );
        }
        cards.push(brain);
    }
    page(k, "memory", "Memory", cards)
}
