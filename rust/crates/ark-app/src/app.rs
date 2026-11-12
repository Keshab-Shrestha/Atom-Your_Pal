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
    Dashboard,
}

pub struct App {
    pub model: Model,
    /// None when the events come from `ARK_UI_EVENTS` (tests and snapshots) or the runtime did not start.
    pub bridge: Option<Bridge>,
    pub draft: TextEdit,
    pub sidebar: PaneState,
    pub screen: Screen,
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
    let mut draft = TextEdit::new("");
    draft.focused = true;
    let screen = match std::env::var("ARK_UI_SCREEN").as_deref() {
        Ok("settings") => Screen::Settings,
        Ok("agents") => Screen::Agents,
        Ok("tasks") => Screen::Tasks,
        Ok("memory") => Screen::Memory,
        Ok("dashboard") => Screen::Dashboard,
        _ => Screen::Chat,
    };
    App { model, bridge: None, draft, sidebar: PaneState::new(260.0).range(180.0, 420.0), screen }
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
        }
        Err(e) => app.model.runtime_down(format!("The runtime did not start ({bin}): {e}")),
    }
}

/// Runs at the start of every frame: moves what the bridge queued into the model.
pub fn poll(app: &mut App, _: f64, _: &mut Tx) -> bool {
    let mut changed = false;
    #[cfg(target_os = "macos")]
    for action in crate::mac::take_actions() {
        if action == crate::mac::Action::NewChat {
            app.new_chat();
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
            Screen::Chat | Screen::Settings => {}
        }
    }

    /// Sends the draft as a `text.send` and clears the composer.
    pub fn submit(&mut self) {
        let text = self.draft.text.trim().to_owned();
        if text.is_empty() || !self.can_type() {
            return;
        }
        if let Some(bridge) = &self.bridge {
            bridge.send_text(&text);
        }
        self.draft = TextEdit::new("");
        self.draft.focused = true;
    }

    /// The composer works when the runtime is ready and the chat is not read-only (Telegram, API).
    pub fn can_type(&self) -> bool {
        let read_only = self.model.current.as_deref().and_then(|id| self.model.chats.iter().find(|c| c.id == id)).is_some_and(|c| c.read_only);
        self.model.conn == ark_ui::Conn::Ready && !read_only
    }
}
