//! The app state `S` that Rune holds, and the setup and poll hooks.

use std::path::PathBuf;
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
        Ok("dashboard") => Screen::Dashboard,
        _ => Screen::Chat,
    };
    App { model, bridge: None, draft, sidebar: PaneState::new(260.0).range(180.0, 420.0), screen }
}

/// The runtime program and its arguments: `ARK_RUNTIME_BIN` (the `ark-runtime` forwarder, or the
/// program next to this app) and `ARK_RUNTIME_ARGS` (the default starts Node, like the Swift app).
fn runtime_command() -> (String, Vec<String>) {
    let bin = std::env::var("ARK_RUNTIME_BIN").unwrap_or_else(|_| {
        let sibling = std::env::current_exe().ok().and_then(|p| p.parent().map(|d| d.join("ark-runtime")));
        sibling.unwrap_or_else(|| PathBuf::from("ark-runtime")).to_string_lossy().into_owned()
    });
    let args = match std::env::var("ARK_RUNTIME_ARGS") {
        Ok(args) => args.split_whitespace().map(str::to_owned).collect(),
        Err(_) => ["node", "--env-file-if-exists=.env", "apps/mac/src/main.ts", "--island"].map(str::to_owned).to_vec(),
    };
    (bin, args)
}

/// Starts the runtime child once, with the waker that redraws the window when an event arrives.
pub fn setup(app: &mut App, wake: Waker) {
    if std::env::var_os("ARK_UI_EVENTS").is_some() {
        return;
    }
    let (bin, args) = runtime_command();
    match Bridge::spawn(&bin, &args, Arc::clone(&wake)) {
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
    let Some(bridge) = &app.bridge else { return false };
    let mut changed = false;
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
