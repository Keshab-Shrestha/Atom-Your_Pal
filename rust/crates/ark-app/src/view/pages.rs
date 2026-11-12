//! The pages: settings, agents, tasks and dashboard. Each reads the model and has no state of its own.

use ark_protocol::Command;
use ark_ui::{Helper, Job, JobState, Stats};
use rune::{El, ScrollSpec, col, row, text};
use rune_kit::{Button, ButtonVariant, Kit};

use crate::app::App;
use crate::form::Form;
use crate::prefs::Theme;

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
    let mut look = row().gap(8.0).wrap();
    for (theme, label) in [(Theme::System, "System"), (Theme::Light, "Light"), (Theme::Dark, "Dark")] {
        look = look.child(
            Button::new(label)
                .variant(if app.prefs.theme == theme { ButtonVariant::Submit } else { ButtonVariant::Neutral })
                .on_press(move |s: &mut App| s.set_theme(theme))
                .build(k)
                .key(format!("theme-{label}")),
        );
    }
    let translucent = app.prefs.translucent;
    let glass = row().w_full().justify_between().items_center()
        .child(text("Translucent window (applies after a restart)").font(k.ty.ui).color(k.c.text_base))
        .child(Button::new(if translucent { "On" } else { "Off" }).variant(if translucent { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(move |s: &mut App| s.set_translucent(!translucent)).build(k).key("translucent"));
    let appearance = card(k, "settings-appearance", "Appearance").child(look).child(glass);
    let general = card(k, "settings-general", "General")
        .child(line(k, "ARK calls you", if app.prefs.owner.is_empty() { "Not set".into() } else { app.prefs.owner.clone() }))
        .child(row().justify_end().child(Button::new("Change name").on_press(|s: &mut App| {
            let current = s.prefs.owner.clone();
            s.open_form(Form::owner(false, &current));
        }).build(k).key("owner-change")));
    let mut access = card(k, "settings-permissions", "macOS permissions");
    #[cfg(target_os = "macos")]
    if app.screen == crate::app::Screen::Settings && std::env::var_os("ARK_UI_EVENTS").is_none() {
        for (name, on) in crate::mac::permissions() {
            access = access.child(line(k, name, if on { "Allowed".into() } else { "Not allowed".into() }));
        }
        access = access.child(row().justify_end().gap(8.0)
            .child(Button::new("Input Monitoring…").on_press(|_: &mut App| crate::mac::open_privacy_pane("Privacy_ListenEvent")).build(k).key("perm-listen"))
            .child(Button::new("Accessibility…").on_press(|_: &mut App| crate::mac::open_privacy_pane("Privacy_Accessibility")).build(k).key("perm-ax")));
    }
    if std::env::var_os("ARK_UI_EVENTS").is_some() {
        access = access.child(text("Permissions show in the running app.").font(k.ty.small).color(k.c.text_faint));
    }
    let mut keys = card(k, "settings-keys", "API keys").child(text("Keys are kept in the macOS Keychain, never in a file. A saved key shows only as Saved.").font(k.ty.small).color(k.c.text_muted).wrap());
    for (name, label) in crate::keychain::KEYS {
        let saved = std::env::var_os("ARK_UI_EVENTS").is_none() && crate::keychain::get(name).is_some();
        let mut r = row().w_full().justify_between().items_center().gap(8.0)
            .child(text(label.to_owned()).font(k.ty.ui).color(k.c.text_base))
            .child(text(if saved { "Saved" } else { "Not set" }.to_owned()).font(k.ty.small).color(k.c.text_muted))
            .child(Button::new("Save typed key").on_press(move |s: &mut App| s.save_key(name)).build(k).key(format!("key-save-{name}")));
        if saved {
            r = r.child(Button::new("Remove").on_press(move |s: &mut App| s.remove_key(name)).build(k).key(format!("key-remove-{name}")));
        }
        keys = keys.child(r);
    }
    keys = keys.child(rune_kit::TextArea::new(&app.key_draft).secure().placeholder("Paste an API key").label("API key").auto_grow(1, 1).on_edit(|s: &mut App| &mut s.key_draft).build(k).key("key-field").w_full());
    if let Some(note) = &app.key_note {
        keys = keys.child(text(note.clone()).key("key-note").font(k.ty.small).color(k.c.text_muted).wrap());
    }
    let mut shortcuts = card(k, "settings-shortcuts", "Shortcuts");
    for action in ark_core::shortcuts::ShortcutAction::ALL {
        let words = if app.recording == Some(action) { "Press the new shortcut (Esc cancels)".to_owned() } else { crate::prefs::describe(action, &app.prefs.combo(action)) };
        let id = crate::prefs::action_id(action);
        let changed = app.prefs.shortcuts.contains_key(id);
        let mut buttons = row().gap(6.0).child(Button::new(if app.recording == Some(action) { "Cancel" } else { "Change" }).on_press(move |s: &mut App| s.record_shortcut(action)).build(k).key(format!("shortcut-record-{id}")));
        if changed {
            buttons = buttons.child(Button::new("Reset").on_press(move |s: &mut App| s.reset_shortcut(action)).build(k).key(format!("shortcut-reset-{id}")));
        }
        shortcuts = shortcuts.child(row().w_full().justify_between().items_center().gap(12.0).child(text(crate::prefs::action_title(action).to_owned()).font(k.ty.ui).color(k.c.text_muted)).child(text(words).font(k.ty.ui).color(k.c.text_base)).child(buttons));
    }
    let mut cards = vec![model, general, defaults, appearance, keys, shortcuts, access, connections];
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

fn org_rows(chart: &ark_core::org::OrgChart, id: &str, depth: usize, names: &dyn Fn(&str) -> String, k: &Kit, out: &mut Vec<El>) {
    let level = chart.level(id);
    out.push(
        row().key(format!("org-{id}")).gap(8.0).pl(depth as f32 * 20.0)
            .child(text(names(id)).font(k.ty.ui).color(k.c.text_base))
            .child(text(level.title().to_owned()).font(k.ty.small).color(k.c.text_faint)),
    );
    if depth >= ark_core::org::OrgChart::MAX_DEPTH {
        return;
    }
    for child in chart.children(id) {
        org_rows(chart, &child, depth + 1, names, k, out);
    }
}

/// The team as an org chart: the owner, ARK, then the agents under their leads (`ark_core::org`).
fn org_card(helpers: &[Helper], k: &Kit) -> El {
    use ark_core::org::{ChartMember, OrgChart};
    let members: Vec<ChartMember<'_>> = helpers.iter().filter(|h| h.available).map(|h| ChartMember { id: &h.id, role: &h.role, reports_to: h.reports_to.as_deref() }).collect();
    let chart = OrgChart::new(&members);
    let names = |id: &str| match id {
        OrgChart::OWNER => "You".to_owned(),
        OrgChart::ARK => "ARK".to_owned(),
        other => helpers.iter().find(|h| h.id == other).map_or_else(|| other.to_owned(), |h| h.name.clone()),
    };
    let mut rows = Vec::new();
    org_rows(&chart, OrgChart::OWNER, 0, &names, k, &mut rows);
    let mut c = card(k, "org-chart", "Team");
    for r in rows {
        c = c.child(r);
    }
    c
}

pub fn agents(app: &App, k: &Kit) -> El {
    let cards = match &app.model.helpers {
        None => vec![text("Loading agents…").key("agents-loading").font(k.ty.ui).color(k.c.text_faint)],
        Some(helpers) if helpers.is_empty() => vec![text("No agents yet.").key("agents-empty").font(k.ty.ui).color(k.c.text_faint)],
        Some(helpers) => helpers.iter().map(|h| helper_card(h, k)).collect(),
    };
    let mut cards = cards;
    if let Some(helpers) = app.model.helpers.as_ref().filter(|h| !h.is_empty()) {
        cards.insert(0, org_card(helpers, k));
    }
    cards.insert(0, row().justify_end().child(Button::new("New agent").on_press(|s: &mut App| s.open_form(Form::new_agent())).build(k).key("new-agent")));
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
    let details = Button::new("Details").on_press(move |s: &mut App| {
        s.open_job = Some(id);
        s.send(&Command::JobOpen { id });
    }).build(k).key(format!("details-{id}"));
    let action = match action {
        Some(a) => row().gap(8.0).child(details).child(a),
        None => row().gap(8.0).child(details),
    };
    let action = Some(action);
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

fn job_details(app: &App, id: u64, k: &Kit) -> El {
    let mut cards = vec![Button::new("Back to tasks").on_press(|s: &mut App| s.open_job = None).build(k).key("job-back")];
    let title = app.model.jobs().into_iter().find(|j| j.id == id).map_or_else(|| format!("Task {id}"), |j| j.title.clone().unwrap_or_else(|| j.task.clone()));
    match app.model.threads.get(&id) {
        None => cards.push(text("Loading the task…").key("job-loading").font(k.ty.ui).color(k.c.text_faint)),
        Some(t) => {
            if let Some(plan) = &t.plan {
                cards.push(card(k, "job-plan", "Plan").child(text(plan.clone()).font(k.ty.ui).color(k.c.text_base).wrap()));
            }
            if let Some(body) = &t.report_body {
                cards.push(card(k, "job-report", t.report_title.as_deref().unwrap_or("Report")).child(rune_kit::Markdown::new(body.clone()).selectable(true).build(k).key("report-md")));
            }
            let mut files = card(k, "job-files", &format!("File changes ({})", t.checkpoints.len()));
            if t.checkpoints.is_empty() {
                files = files.child(text("No file edits recorded.").font(k.ty.ui).color(k.c.text_muted));
            }
            for (i, c) in t.checkpoints.iter().enumerate() {
                let path = c.path.clone();
                let state = match c.state.as_str() {
                    "ready" => Some(("Undo", false)),
                    "changed" => Some(("Restore anyway", true)),
                    _ => None,
                };
                let mut r = row().w_full().justify_between().items_center().gap(12.0).child(text(format!("{} · {}", c.path, if c.created { "created" } else { "edited" })).font(k.ty.ui).color(k.c.text_base));
                r = match state {
                    Some((label, force)) => r.child(Button::new(label).on_press(move |s: &mut App| s.send(&Command::JobUndo { id, path: Some(path.clone()), force: force.then_some(true) })).build(k).key(format!("undo-{i}"))),
                    None => r.child(text(c.state.clone()).font(k.ty.small).color(k.c.text_faint)),
                };
                files = files.child(r);
            }
            cards.push(files);
        }
    }
    page(k, "job-details", &title, cards)
}

pub fn tasks(app: &App, k: &Kit) -> El {
    if let Some(id) = app.open_job {
        return job_details(app, id, k);
    }
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
    let search = rune_kit::TextArea::new(&app.brain_query)
        .placeholder("Search the brain")
        .label("Search the brain")
        .auto_grow(1, 1)
        .on_edit(|s: &mut App| &mut s.brain_query)
        .on_submit(|s: &mut App, _| s.search_brain())
        .build(k)
        .key("brain-search")
        .w_full();
    cards.push(search);
    if let Some((query, hits)) = &app.model.brain_hits {
        let mut found = card(k, "brain-hits", &format!("{} found for \"{query}\"", hits.len()));
        for h in hits.iter().take(30) {
            let id = h.id;
            found = found.child(
                row().w_full().justify_between().items_center().gap(12.0)
                    .child(col().grow(1.0).child(text(h.title.clone()).font(k.ty.ui_medium).color(k.c.text_base)).child(text(h.snippet.clone()).font(k.ty.small).color(k.c.text_muted).wrap()))
                    .child(Button::new("Open").on_press(move |s: &mut App| s.send(&Command::BrainNote { id })).build(k).key(format!("hit-{id}"))),
            );
        }
        cards.push(found);
    }
    if let Some(nodes) = app.model.brain.as_ref().filter(|n| !n.is_empty()) {
        cards.push(brain_graph(nodes, &app.model.brain_edges, k));
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

pub fn projects(app: &App, k: &Kit) -> El {
    let add = Button::new("Add project").variant(ButtonVariant::Submit).on_press_tx(|_: &mut App, tx: &mut rune::Tx| {
        tx.open_folder(rune::FileDialogOptions { title: "Choose the project folder".into(), ..Default::default() }, |s: &mut App, result, _| {
            if let Ok(Some(path)) = result {
                let name = path.file_name().map_or_else(|| "Project".to_owned(), |n| n.to_string_lossy().into_owned());
                s.send(&Command::ProjectAdd { name, path: path.to_string_lossy().into_owned() });
            }
        });
    }).build(k).key("project-add");
    let mut cards = vec![row().justify_end().child(add)];
    if app.model.projects.is_empty() {
        cards.push(text("No projects yet. A project is a folder with its own chats.").key("projects-empty").font(k.ty.ui).color(k.c.text_faint).wrap());
    }
    for p in &app.model.projects {
        let (new_id, remove_id, archive_id, archived) = (p.id.clone(), p.id.clone(), p.id.clone(), p.archived);
        let mut meta = vec![p.folder.clone(), format!("{} chats", p.chats)];
        if p.missing {
            meta.push("folder missing".into());
        }
        if p.archived {
            meta.push("archived".into());
        }
        let actions = row().justify_end().gap(8.0)
            .child(Button::new("New chat").on_press(move |s: &mut App| {
                s.screen = crate::app::Screen::Chat;
                s.send(&Command::ChatNew { project_id: Some(new_id.clone()) });
            }).build(k).key(format!("project-chat-{}", p.id)))
            .child(Button::new(if archived { "Unarchive" } else { "Archive" }).on_press(move |s: &mut App| s.send(&Command::ProjectArchive { id: archive_id.clone(), archived: !archived })).build(k).key(format!("project-archive-{}", p.id)))
            .child(Button::new("Remove").on_press(move |s: &mut App| s.send(&Command::ProjectRemove { id: remove_id.clone(), delete_chats: None })).build(k).key(format!("project-remove-{}", p.id)));
        let (rename_id, rename_name, web_id, web) = (p.id.clone(), p.name.clone(), p.id.clone(), p.web);
        let settings = row().gap(8.0).wrap()
            .child(Button::new("Rename").on_press(move |s: &mut App| s.open_form(Form::project_name(&rename_id, &rename_name))).build(k).key(format!("project-rename-{}", p.id)))
            .child(Button::new(if web { "Web search: on" } else { "Web search: off" }).variant(if web { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(move |s: &mut App| s.send(&Command::ProjectWeb { id: web_id.clone(), web: !web })).build(k).key(format!("project-web-{}", p.id)));
        let mut models = row().gap(6.0).wrap();
        for pr in app.model.providers.iter().filter(|x| x.available) {
            for (mid, mname) in &pr.models {
                let (pid, mid2, prov, current) = (p.id.clone(), mid.clone(), pr.id.clone(), p.model.as_ref().is_some_and(|(a, b)| *a == pr.id && b == mid));
                models = models.child(Button::new(mname.clone()).variant(if current { ButtonVariant::Submit } else { ButtonVariant::Neutral }).on_press(move |s: &mut App| s.send(&Command::ProjectModel { id: pid.clone(), provider: prov.clone(), model: mid2.clone() })).build(k).key(format!("project-model-{}-{mid}", p.id)));
            }
        }
        cards.push(
            card(k, &format!("project-{}", p.id), &p.name)
                .child(text(meta.join(" · ")).font(k.ty.small).color(k.c.text_muted).wrap())
                .child(settings)
                .child(text("Model for this project's chats").font(k.ty.small).color(k.c.text_muted))
                .child(models)
                .child(actions),
        );
    }
    page(k, "projects", "Projects", cards)
}

pub fn branches(app: &App, k: &Kit) -> El {
    let mut cards = Vec::new();
    match &app.model.branches {
        None => cards.push(text("Loading branches…").key("branches-loading").font(k.ty.ui).color(k.c.text_faint)),
        Some(list) if list.is_empty() => cards.push(text("No task branches yet.").key("branches-empty").font(k.ty.ui).color(k.c.text_faint)),
        Some(list) => {
            for (i, b) in list.iter().enumerate() {
                let (repo, branch, repo2, branch2) = (b.repo.clone(), b.branch.clone(), b.repo.clone(), b.branch.clone());
                let mut c = card(k, &format!("branch-{i}"), b.title.as_deref().unwrap_or(&b.branch))
                    .child(text(format!("{} · {} from {} · pushed: {}", b.repo_name, b.branch, b.base, b.pushed)).font(k.ty.small).color(k.c.text_muted).wrap());
                for (sha, subject) in b.commits.iter().take(5) {
                    c = c.child(text(format!("{} {subject}", sha.chars().take(7).collect::<String>())).font(k.ty.small).color(k.c.text_base).wrap());
                }
                for (path, added, removed) in b.files.iter().take(8) {
                    c = c.child(line(k, path, format!("+{} -{}", added.map_or("?".into(), |n| n.to_string()), removed.map_or("?".into(), |n| n.to_string()))));
                }
                let mut actions = row().justify_end().gap(8.0).child(Button::new("Diff").on_press(move |s: &mut App| s.send(&Command::GitDiff { repo: repo.clone(), branch: branch.clone() })).build(k).key(format!("branch-diff-{i}")));
                if b.push_allowed {
                    actions = actions.child(Button::new("Push").on_press(move |s: &mut App| s.send(&Command::GitPush { repo: repo2.clone(), branch: branch2.clone() })).build(k).key(format!("branch-push-{i}")));
                }
                cards.push(c.child(actions));
            }
        }
    }
    if let Some((_, branch, text_diff)) = &app.model.branch_diff {
        let mut d = card(k, "branch-patch", &format!("Changes on {branch}"));
        for l in text_diff.lines().take(200) {
            let ink = match l.chars().next() {
                Some('+') => k.c.success.fg,
                Some('-') => k.c.danger.fg,
                _ => k.c.text_muted,
            };
            d = d.child(text(l.to_owned()).font(k.ty.small).color(ink));
        }
        cards.push(d);
    }
    page(k, "branches", "Branches", cards)
}

const GRAPH_W: f32 = 680.0;
const GRAPH_H: f32 = 300.0;
/// Notes drawn at most; the layout cost grows with the square of this.
const GRAPH_MAX: usize = 120;

/// The brain as a graph: links as lines, notes as dots (bigger when more linked), laid out by `ark_ui::graph`.
fn brain_graph(nodes: &[ark_ui::BrainNode], edges: &[(u64, u64)], k: &Kit) -> El {
    let shown: Vec<&ark_ui::BrainNode> = nodes.iter().filter(|n| !n.ghost).take(GRAPH_MAX).collect();
    let ids: Vec<u64> = shown.iter().map(|n| n.id).collect();
    let placed = ark_ui::graph::layout(&ids, edges, GRAPH_W, GRAPH_H);
    let at = |id: u64| placed.iter().find(|p| p.id == id).map(|p| [p.x, p.y]);
    let mut shape = rune::Shape::new().view_box(GRAPH_W, GRAPH_H);
    let mut drawn = 0;
    for (a, b) in edges {
        if let (Some(pa), Some(pb)) = (at(*a), at(*b)) {
            shape = shape.line(pa, pb, 1.0, rune::LineCap::Round, k.c.border_weak);
            drawn += 1;
        }
    }
    for p in &placed {
        let degree = edges.iter().filter(|(a, b)| *a == p.id || *b == p.id).count();
        let r = 3.0 + (degree as f32).min(8.0) * 0.6;
        let ring: Vec<[f32; 2]> = (0..10).map(|i| { let t = std::f32::consts::TAU * i as f32 / 10.0; [p.x + r * t.cos(), p.y + r * t.sin()] }).collect();
        shape = shape.fill(ring, k.c.text_base);
    }
    col().key("brain-graph").w_full().gap(6.0).padding(14.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_weak)
        .child(text(format!("Graph: {} notes, {} links", placed.len(), drawn)).font(k.ty.ui_medium).color(k.c.text_base))
        .child(rune::canvas(shape).w(GRAPH_W).h(GRAPH_H))
}
