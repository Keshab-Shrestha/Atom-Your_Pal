//! Commands that Node alone ran until ADR-278 and that need the chat's sinks: `project.create` (async, cancellable) and the commands
//! of the morning brief. `Extras` lives in `Chat`, so it is on with `ARK_RUNTIME_NATIVE_CHAT=1`. `handle` gives `false` when Node must answer.

use std::collections::VecDeque;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use ark_protocol::Event;
use serde_json::Value;

use crate::chat::{Chat, Sink};
use crate::project_create::{Cancel, Limits, Request, World, create, run_git};
use crate::store;

const RECEIPTS: usize = 32;

#[derive(Default)]
pub struct Extras {
    creation: Mutex<Option<(String, Cancel)>>,
    receipts: Mutex<VecDeque<(String, String)>>,
}

fn line_of(value: &Value) -> String {
    Event::Other(value.as_object().cloned().unwrap_or_default()).to_line()
}

impl Extras {
    /// Takes `line` when it is one of these commands. `false` means: give it to Node.
    pub fn handle(&self, chat: &Arc<Chat>, line: &str, to_app: &Sink) -> bool {
        self.project(chat, line, to_app) || workflow(chat, line, to_app)
    }

    /// `project.create` and `project.create.cancel`.
    fn project(&self, chat: &Arc<Chat>, line: &str, to_app: &Sink) -> bool {
        if !line.contains("\"project.create") {
            return false;
        }
        let Ok(command) = serde_json::from_str::<Value>(line) else { return false };
        match command["type"].as_str() {
            Some("project.create.cancel") => {
                let Ok(current) = self.creation.lock() else { return false };
                match current.as_ref().filter(|(r, _)| command["request"] == r.as_str()) {
                    Some((_, cancel)) => {
                        cancel.store(true, Ordering::SeqCst);
                        true
                    }
                    None => false,
                }
            }
            Some("project.create") => self.create(chat, &command, to_app),
            _ => false,
        }
    }

    fn create(&self, chat: &Arc<Chat>, command: &Value, to_app: &Sink) -> bool {
        let Some(request) = Request::parse(command) else { return false };
        if let Some((_, line)) = self.receipts.lock().ok().and_then(|r| r.iter().find(|(id, _)| *id == request.request).cloned()) {
            to_app(&line);
            return true;
        }
        let Ok(mut current) = self.creation.lock() else { return false };
        if current.as_ref().is_some_and(|(r, _)| *r == request.request) {
            return true;
        }
        if current.is_some() {
            to_app(&line_of(&serde_json::json!({ "type": "project.created", "request": request.request, "ok": false, "error": "Another project is being created." })));
            return true;
        }
        // Without the helpers file, the state file or HOME Node does it all.
        let Some(dir) = chat.db.parent().map(std::path::Path::to_path_buf) else { return false };
        let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) else { return false };
        if !dir.join("helpers.db").exists() || chat.chats_line().is_none() {
            return false;
        }
        let cancel = Cancel::default();
        *current = Some((request.request.clone(), cancel.clone()));
        drop(current);
        let (chat, to_app) = (Arc::clone(chat), to_app.clone());
        std::thread::spawn(move || {
            let event = match (store::open_read_write(&chat.db), store::open_read_write(&dir.join("helpers.db"))) {
                (Ok(memory), Ok(helpers)) => {
                    let agents = dir.join("agents");
                    let state = dir.join("ui-state.json");
                    let world = World { memory: &memory, helpers: &helpers, agents: &agents, home: &home, state: &state };
                    create(&request, &world, &cancel, Limits::default(), &|args, cwd, tick| run_git(args, cwd, tick))
                }
                _ => serde_json::json!({ "type": "project.created", "request": request.request, "ok": false, "error": "Project creation was not confirmed. Inspect the destination before retrying." }),
            };
            let line = line_of(&event);
            chat.extras().finish(&request.request, &line);
            if event["ok"] == true
                && let Some(chats) = chat.chats_line()
            {
                to_app(&chats);
            }
            to_app(&line);
        });
        true
    }

    fn finish(&self, request: &str, line: &str) {
        if let Ok(mut current) = self.creation.lock() {
            *current = None;
        }
        if let Ok(mut receipts) = self.receipts.lock() {
            receipts.push_back((request.to_string(), line.to_string()));
            if receipts.len() > RECEIPTS {
                receipts.pop_front();
            }
        }
    }
}

/// `workflow.run` (`workflow_run.rs`). Needs the helpers file, and the Rust runner that runs the queued tasks.
fn workflow(chat: &Arc<Chat>, line: &str, to_app: &Sink) -> bool {
    if !line.contains("\"workflow.run\"") || std::env::var("ARK_HELPERS_NATIVE").as_deref() == Ok("0") {
        return false;
    }
    let Ok(command) = serde_json::from_str::<Value>(line) else { return false };
    let (Some("workflow.run"), Some(id), Some(dir)) = (command["type"].as_str(), command["id"].as_str(), chat.db.parent()) else { return false };
    let Ok(helpers) = store::open_read_write(&dir.join("helpers.db")) else { return false };
    let now = jiff::Timestamp::now();
    let Ok(problem) = crate::workflow_run::start(dir, &helpers, id, now) else { return false };
    match crate::workflow_run::event(dir, now, problem.as_deref()) {
        Some(event) => {
            to_app(&event);
            true
        }
        None => false,
    }
}
