//! The app state `S` that Rune holds, and the setup and poll hooks.

use std::sync::Arc;

use ark_protocol::Event;
use ark_ui::Model;
use rune::{TextEdit, Tx, Waker};
use rune_kit::shell::PaneState;

use crate::bridge::{Bridge, Inbound};

impl Screen {
    /// The name saved in the prefs and used by `ARK_UI_SCREEN`.
    pub fn name(self) -> &'static str {
        match self {
            Screen::Chat => "chat",
            Screen::Settings => "settings",
            Screen::Agents => "agents",
            Screen::Tasks => "tasks",
            Screen::Memory => "memory",
            Screen::Projects => "projects",
            Screen::Branches => "branches",
            Screen::Dashboard => "dashboard",
        }
    }

    pub fn from_name(name: &str) -> Screen {
        [Screen::Settings, Screen::Agents, Screen::Tasks, Screen::Memory, Screen::Projects, Screen::Branches, Screen::Dashboard].into_iter().find(|s| s.name() == name).unwrap_or(Screen::Chat)
    }
}

/// The screen in the main pane.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Screen {
    #[default]
    Chat,
    Settings,
    Agents,
    Tasks,
    Memory,
    Projects,
    Branches,
    Dashboard,
}

pub struct App {
    pub model: Model,
    /// None when the events come from `ARK_UI_EVENTS` (tests and snapshots) or the runtime did not start.
    pub bridge: Option<Bridge>,
    pub draft: TextEdit,
    pub sidebar: PaneState,
    pub screen: Screen,
    /// An open form (soul, new agent, new task); it replaces the page while it is open.
    /// The waker for the window, kept to start the runtime again after it ends.
    pub wake: Option<Waker>,
    pub backoff: crate::reconnect::Backoff,
    /// When the next start is due; None while the runtime runs.
    pub retry_at: Option<std::time::Instant>,
    /// The project whose files are open on the Projects page.
    pub workspace_project: Option<String>,
    /// The shortcut waiting for a key press.
    pub recording: Option<ark_core::shortcuts::ShortcutAction>,
    /// The brain search field.
    pub brain_query: TextEdit,
    /// The key field in the setup card, and the last note about saving.
    pub key_draft: TextEdit,
    pub key_note: Option<String>,
    /// The chat details card is open above the transcript.
    pub details: bool,
    /// The task whose details are open on the Tasks page.
    pub open_job: Option<u64>,
    /// The saved choices (new-chat defaults, theme).
    pub prefs: crate::prefs::Prefs,
    /// Full access was chosen once and waits for the second press.
    pub confirm_full: bool,
    /// The command palette's filter. None when it is closed.
    pub palette: Option<TextEdit>,
    /// The find bar: the query and the selected match. None when the bar is closed.
    pub find: Option<(TextEdit, usize)>,
    /// Files attached to the next message (paths).
    pub attachments: Vec<String>,
    pub form: Option<crate::form::Form>,
    pub form_error: Option<String>,
}

/// Feeds the model from a JSON-lines file, the same lines a runtime would send (`ARK_UI_EVENTS`).
fn preload(model: &mut Model, path: &str) {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("ARK_UI_EVENTS {path}: {e}"));
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        match Event::parse(line) {
            Ok(event) => {
                model.apply(&event);
            }
            Err(e) => panic!("ARK_UI_EVENTS {path}: {e}: {line}"),
        }
    }
}

pub fn init() -> App {
    let mut model = Model::default();
    if let Ok(path) = std::env::var("ARK_UI_EVENTS") {
        preload(&mut model, &path);
    }
    let prefs = if std::env::var_os("ARK_UI_EVENTS").is_some() && std::env::var_os("ARK_UI_PREFS").is_none() { crate::prefs::Prefs::default() } else { crate::prefs::Prefs::load() };
    // Tests and snapshots show the "runtime is down" state.
    if let Ok(why) = std::env::var("ARK_UI_DOWN") {
        model.runtime_down(why);
    }
    let mut draft = TextEdit::new("");
    draft.focused = true;
    // `ARK_UI_SCREEN` picks the page for tests; otherwise the page of the last run comes back.
    let screen = Screen::from_name(&std::env::var("ARK_UI_SCREEN").unwrap_or_else(|_| prefs.screen.clone()));
    let mut sidebar = PaneState::new(260.0).range(180.0, 420.0).with_width(prefs.sidebar_width);
    if !prefs.sidebar_open {
        sidebar.set_open(false);
    }
    // Tests and snapshots open the find bar with a query.
    let find = std::env::var("ARK_UI_FIND").ok().map(|q| (TextEdit::new(q), 0));
    let welcome = std::env::var_os("ARK_UI_EVENTS").is_none() && !prefs.welcomed;
    App { model, bridge: None, draft, sidebar, screen, brain_query: TextEdit::new(std::env::var("ARK_UI_BRAIN_QUERY").unwrap_or_default()), key_draft: TextEdit::new("").secure(), key_note: None, wake: None, backoff: Default::default(), retry_at: None, workspace_project: None, recording: None, details: std::env::var_os("ARK_UI_DETAILS").is_some(), open_job: std::env::var("ARK_UI_JOB").ok().and_then(|v| v.parse().ok()), prefs, confirm_full: false, palette: std::env::var_os("ARK_UI_PALETTE").map(|_| TextEdit::new("")), find, attachments: Vec::new(), form: welcome.then(|| crate::form::Form::owner(true, "")), form_error: None }
}

/// Starts the runtime child once, with the waker that redraws the window when an event arrives.
pub fn setup(app: &mut App, wake: Waker) {
    if std::env::var_os("ARK_UI_EVENTS").is_some() {
        return;
    }
    #[cfg(target_os = "macos")]
    crate::mac::install(Arc::clone(&wake));
    #[cfg(target_os = "macos")]
    app.apply_shortcuts();
    app.wake = Some(wake);
    start_runtime(app);
}

/// Starts the runtime child. A failure shows why and schedules another try.
fn start_runtime(app: &mut App) {
    let Some(wake) = app.wake.clone() else { return };
    let plan = crate::launch::real_plan();
    let bin = plan.program.clone();
    let mut env = crate::keychain::env_pairs(&|n| std::env::var(n).ok());
    env.extend(plan.env.clone());
    match Bridge::spawn_with_env(&plan.program, &plan.args, plan.cwd.as_deref(), &env, wake) {
        Ok(bridge) => {
            app.bridge = Some(bridge);
            app.retry_at = None;
            // Native clients ask for the work snapshots (docs/island-protocol.md, chat.work).
            app.send(&ark_protocol::Command::ChatWorkWatch);
            app.send_defaults();
            if !app.prefs.owner.is_empty() {
                app.send(&ark_protocol::Command::OwnerSet { name: app.prefs.owner.clone() });
            }
        }
        Err(e) => schedule_retry(app, format!("The runtime did not start ({bin}): {e}")),
    }
}

/// Shows why the runtime is down and starts it again after the next wait (1, 2, 4, ... 30 seconds).
fn schedule_retry(app: &mut App, why: String) {
    app.bridge = None;
    let wait = app.backoff.next_delay();
    app.retry_at = Some(std::time::Instant::now() + wait);
    app.model.runtime_down(format!("{why} Starting again in {} s.", wait.as_secs()));
    if let Some(wake) = app.wake.clone() {
        std::thread::spawn(move || {
            std::thread::sleep(wait);
            wake();
        });
    }
}

/// Saves the page and the sidebar when they changed since the last save. Cheap to call every frame.
fn remember_layout(app: &mut App) {
    let (screen, width, open) = (app.screen.name(), app.sidebar.width(), app.sidebar.is_open());
    if app.bridge.is_none() && std::env::var_os("ARK_UI_EVENTS").is_some() {
        return;
    }
    if app.prefs.screen != screen || (app.prefs.sidebar_width - width).abs() > 0.5 || app.prefs.sidebar_open != open {
        // The pane is mid-drag while resizing: save when it settles.
        if app.sidebar.is_resizing() {
            return;
        }
        app.prefs.screen = screen.to_owned();
        app.prefs.sidebar_width = width;
        app.prefs.sidebar_open = open;
        app.prefs.save();
    }
}

/// Runs at the start of every frame: moves what the bridge queued into the model.
pub fn poll(app: &mut App, _: f64, _: &mut Tx) -> bool {
    let mut changed = false;
    #[cfg(target_os = "macos")]
    crate::mac::remember_window_frame();
    for (action, combo) in crate::mac::take_recorded() {
        app.recording = None;
        if let Some(combo) = combo {
            app.prefs.shortcuts.insert(crate::prefs::action_id(action).to_owned(), combo);
            app.prefs.save();
            app.apply_shortcuts();
        }
        changed = true;
    }
    for action in crate::mac::take_actions() {
        match action {
            crate::mac::Action::NewChat => app.new_chat(),
            crate::mac::Action::DictateStart => app.send(&ark_protocol::Command::TalkStart),
            crate::mac::Action::DictateSend => app.send(&ark_protocol::Command::TalkSend),
            crate::mac::Action::DictateCancel => app.send(&ark_protocol::Command::TalkCancel),
            crate::mac::Action::Show => {}
        }
        changed = true;
    }
    if app.bridge.is_none() && app.retry_at.is_some_and(|at| std::time::Instant::now() >= at) {
        start_runtime(app);
        changed = true;
    }
    let Some(bridge) = &app.bridge else { return changed };
    let mut gone: Option<String> = None;
    for message in bridge.drain() {
        changed |= match message {
            Inbound::Event(event) => {
                if matches!(*event, ark_protocol::Event::Ready { .. }) {
                    app.backoff.reset();
                }
                app.model.apply(&event)
            }
            Inbound::Down(why) => {
                gone = Some(why);
                true
            }
        };
    }
    if let Some(why) = gone {
        schedule_retry(app, why);
    }
    crate::overlay::sync(app.model.loop_state, !app.model.approvals.is_empty());
    remember_layout(app);
    changed
}

impl App {
    pub fn send(&self, command: &ark_protocol::Command) {
        if let Some(bridge) = &self.bridge {
            bridge.send(command);
        }
    }

    pub fn new_chat(&mut self) {
        self.screen = Screen::Chat;
        self.send(&ark_protocol::Command::ChatNew { project_id: None });
    }

    /// Opens a screen and asks the runtime for the data it shows.
    pub fn goto(&mut self, screen: Screen) {
        self.screen = screen;
        match screen {
            Screen::Agents | Screen::Tasks => self.send(&ark_protocol::Command::HelpersList),
            Screen::Memory => {
                self.send(&ark_protocol::Command::MemoryList);
                self.send(&ark_protocol::Command::BrainGet);
            }
            Screen::Dashboard => self.send(&ark_protocol::Command::StatsGet),
            Screen::Settings => self.send(&ark_protocol::Command::BriefGet),
            Screen::Projects => {}
            Screen::Branches => self.send(&ark_protocol::Command::GitList),
            Screen::Chat => {}
        }
    }

    /// Turns one morning-brief switch (index into `BRIEF_SWITCHES`) on or off and asks for the new state.
    pub fn set_brief(&mut self, index: usize, on: bool) {
        use ark_protocol::commands::BriefChange;
        let mut change = BriefChange::default();
        let value = Some(on);
        match index {
            0 => change.enabled = value,
            1 => change.events = value,
            2 => change.reminders = value,
            3 => change.weather = value,
            4 => change.tasks = value,
            5 => change.needs_you = value,
            6 => change.notify = value,
            7 => change.telegram = value,
            8 => change.spoken = value,
            _ => return,
        }
        self.send(&ark_protocol::Command::BriefSet { change });
        self.send(&ark_protocol::Command::BriefGet);
    }

    /// Tells the runtime the access and thinking a new chat starts with (`chat.defaults`).
    pub fn send_defaults(&self) {
        self.send(&ark_protocol::Command::ChatDefaults { access: self.prefs.access.clone(), effort: self.prefs.effort.clone() });
    }

    /// Sets the new-chat access. Full access asks for a second press first (it skips routine prompts).
    pub fn set_access(&mut self, access: &str) {
        if access == "full" && self.prefs.access != "full" && !self.confirm_full {
            self.confirm_full = true;
            return;
        }
        self.confirm_full = false;
        self.prefs.access = access.to_owned();
        self.prefs.save();
        self.send_defaults();
    }

    pub fn set_theme(&mut self, theme: crate::prefs::Theme) {
        self.prefs.theme = theme;
        self.prefs.save();
    }

    /// Starts recording a new shortcut for `action`; a second call cancels.
    pub fn record_shortcut(&mut self, action: ark_core::shortcuts::ShortcutAction) {
        if self.recording == Some(action) {
            self.recording = None;
            #[cfg(target_os = "macos")]
            crate::mac::stop_recording();
            return;
        }
        self.recording = Some(action);
        #[cfg(target_os = "macos")]
        crate::mac::start_recording(action);
    }

    /// Puts the shortcut back to its default.
    pub fn reset_shortcut(&mut self, action: ark_core::shortcuts::ShortcutAction) {
        self.prefs.shortcuts.remove(crate::prefs::action_id(action));
        self.prefs.save();
        self.apply_shortcuts();
    }

    /// Gives the matcher the shortcuts in use.
    pub fn apply_shortcuts(&self) {
        #[cfg(target_os = "macos")]
        crate::mac::apply_shortcuts(ark_core::shortcuts::ShortcutAction::ALL.iter().map(|a| (*a, self.prefs.combo(*a))).collect());
    }

    pub fn search_brain(&self) {
        let query = self.brain_query.text.trim().to_owned();
        if !query.is_empty() {
            self.send(&ark_protocol::Command::BrainSearch { query });
        }
    }

    /// Saves the typed key under `name` in the Keychain and clears the field. The key applies at the next start.
    pub fn save_key(&mut self, name: &str) {
        let key = self.key_draft.text.trim().to_owned();
        self.key_note = Some(match crate::keychain::save(name, &key) {
            Ok(()) => "Saved in macOS Keychain. Restart ARK to use it.".to_owned(),
            Err(why) => why,
        });
        self.key_draft = TextEdit::new("").secure();
    }

    pub fn remove_key(&mut self, name: &str) {
        self.key_note = Some(match crate::keychain::remove(name) {
            Ok(()) => "Key removed from Keychain.".to_owned(),
            Err(why) => why,
        });
    }

    /// Asks for a folder listing (`list`) or a file's text (`read`) in a project's folder.
    pub fn workspace(&mut self, project: &str, action: &str, path: &str) {
        self.workspace_project = Some(project.to_owned());
        let chat = self.model.current.clone().unwrap_or_default();
        let fields = serde_json::json!({ "type": "workspace", "request": format!("ui-{action}-{path}"), "chat": chat, "project": project, "action": action, "path": path });
        self.send(&ark_protocol::Command::Other { kind: "workspace".into(), fields: fields.as_object().cloned().unwrap_or_default() });
    }

    pub fn set_translucent(&mut self, on: bool) {
        self.prefs.translucent = on;
        self.prefs.save();
    }

    pub fn set_effort(&mut self, effort: &str) {
        self.prefs.effort = effort.to_owned();
        self.prefs.save();
        self.send_defaults();
    }

    pub fn toggle_find(&mut self) {
        self.screen = Screen::Chat;
        self.find = match self.find {
            Some(_) => None,
            None => {
                let mut q = TextEdit::new("");
                q.focused = true;
                Some((q, 0))
            }
        };
    }

    /// Moves the selected match by `step` (1 or -1), wrapping.
    pub fn move_find(&mut self, step: isize) {
        let count = self.find.as_ref().map_or(0, |(q, _)| ark_ui::find::find(&self.model.messages, &q.text).matches.len());
        if let (Some((_, sel)), true) = (self.find.as_mut(), count > 0) {
            *sel = (*sel as isize + step).rem_euclid(count as isize) as usize;
        }
    }

    pub fn open_form(&mut self, form: crate::form::Form) {
        self.form = Some(form);
        self.form_error = None;
    }

    /// Closes the form. Cancelling the welcome window counts as answered, so it does not return.
    pub fn close_form(&mut self) {
        if matches!(self.form.as_ref().map(|f| &f.kind), Some(crate::form::FormKind::Owner { first_run: true })) {
            self.prefs.welcomed = true;
            self.prefs.save();
        }
        self.form = None;
        self.form_error = None;
    }

    /// Sends the form as one command, then closes it and asks for fresh data. A form that is not ready stays open.
    pub fn submit_form(&mut self) {
        let Some(form) = &self.form else { return };
        match form.submit() {
            Ok(command) => {
                if let ark_protocol::Command::OwnerSet { name } = &command {
                    self.prefs.owner.clone_from(name);
                    self.prefs.welcomed = true;
                    self.prefs.save();
                }
                self.send(&command);
                self.close_form();
                self.send(&ark_protocol::Command::HelpersList);
            }
            Err(why) => self.form_error = Some(why.to_owned()),
        }
    }

    /// Sends the draft as a `text.send` and clears the composer.
    pub fn submit(&mut self) {
        let text = self.draft.text.trim().to_owned();
        if text.is_empty() || !self.can_type() {
            return;
        }
        let files = (!self.attachments.is_empty()).then(|| std::mem::take(&mut self.attachments));
        self.send(&ark_protocol::Command::TextSend { text, files, notes: None, request: None, chat: None });
        self.draft = TextEdit::new("");
        self.draft.focused = true;
    }

    /// The composer works when the runtime is ready and the chat is not read-only (Telegram, API).
    pub fn can_type(&self) -> bool {
        let read_only = self.model.current.as_deref().and_then(|id| self.model.chats.iter().find(|c| c.id == id)).is_some_and(|c| c.read_only);
        self.model.conn == ark_ui::Conn::Ready && !read_only
    }
}
