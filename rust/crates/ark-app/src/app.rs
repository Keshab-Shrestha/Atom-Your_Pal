//! The app state `S` that Rune holds, and the setup and poll hooks.

use std::sync::Arc;

use ark_protocol::Event;
use ark_ui::Model;
use rune::{TextEdit, Tx, Waker};
use rune_kit::shell::PaneState;

use crate::bridge::{Bridge, Inbound};

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
    let mut draft = TextEdit::new("");
    draft.focused = true;
    let screen = match std::env::var("ARK_UI_SCREEN").as_deref() {
        Ok("settings") => Screen::Settings,
        Ok("agents") => Screen::Agents,
        Ok("tasks") => Screen::Tasks,
        Ok("memory") => Screen::Memory,
        Ok("projects") => Screen::Projects,
        Ok("dashboard") => Screen::Dashboard,
        _ => Screen::Chat,
    };
    // Tests and snapshots open the find bar with a query.
    let find = std::env::var("ARK_UI_FIND").ok().map(|q| (TextEdit::new(q), 0));
    let welcome = std::env::var_os("ARK_UI_EVENTS").is_none() && !prefs.welcomed;
    App { model, bridge: None, draft, sidebar: PaneState::new(260.0).range(180.0, 420.0), screen, details: std::env::var_os("ARK_UI_DETAILS").is_some(), open_job: std::env::var("ARK_UI_JOB").ok().and_then(|v| v.parse().ok()), prefs, confirm_full: false, palette: std::env::var_os("ARK_UI_PALETTE").map(|_| TextEdit::new("")), find, attachments: Vec::new(), form: welcome.then(|| crate::form::Form::owner(true, "")), form_error: None }
}

/// Starts the runtime child once, with the waker that redraws the window when an event arrives.
pub fn setup(app: &mut App, wake: Waker) {
    if std::env::var_os("ARK_UI_EVENTS").is_some() {
        return;
    }
    #[cfg(target_os = "macos")]
    crate::mac::install(Arc::clone(&wake));
    let plan = crate::launch::real_plan();
    let bin = plan.program.clone();
    match Bridge::spawn(&plan.program, &plan.args, plan.cwd.as_deref(), Arc::clone(&wake)) {
        Ok(bridge) => {
            app.bridge = Some(bridge);
            // Native clients ask for the work snapshots (docs/island-protocol.md, chat.work).
            app.send(&ark_protocol::Command::ChatWorkWatch);
            app.send_defaults();
            if !app.prefs.owner.is_empty() {
                app.send(&ark_protocol::Command::OwnerSet { name: app.prefs.owner.clone() });
            }
        }
        Err(e) => app.model.runtime_down(format!("The runtime did not start ({bin}): {e}")),
    }
}

/// Runs at the start of every frame: moves what the bridge queued into the model.
pub fn poll(app: &mut App, _: f64, _: &mut Tx) -> bool {
    let mut changed = false;
    #[cfg(target_os = "macos")]
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
    let Some(bridge) = &app.bridge else { return changed };
    for message in bridge.drain() {
        changed |= match message {
            Inbound::Event(event) => app.model.apply(&event),
            Inbound::Down(why) => {
                app.model.runtime_down(why);
                true
            }
        };
    }
    crate::overlay::sync(app.model.loop_state, !app.model.approvals.is_empty());
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
