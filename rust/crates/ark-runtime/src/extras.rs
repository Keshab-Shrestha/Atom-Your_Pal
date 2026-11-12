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
    brief: Arc<crate::brief::Runner>,
    /// The last `brief` line the app got, so the poller sends only a change.
    brief_last: Arc<Mutex<String>>,
}

fn line_of(value: &Value) -> String {
    Event::Other(value.as_object().cloned().unwrap_or_default()).to_line()
}

impl Extras {
    /// Takes `line` when it is one of these commands. `false` means: give it to Node.
    pub fn handle(&self, chat: &Arc<Chat>, line: &str, to_app: &Sink) -> bool {
        self.project(chat, line, to_app) || workflow(chat, line, to_app) || improvements(chat, line, to_app) || self.brief_commands(chat, line, to_app)
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

    /// `brief.get`, `brief.set`, `brief.note` (out of the list) and `brief.run` (`brief.rs`).
    fn brief_commands(&self, chat: &Arc<Chat>, line: &str, to_app: &Sink) -> bool {
        use crate::brief;
        if !line.contains("\"brief.") {
            return false;
        }
        let Ok(command) = serde_json::from_str::<Value>(line) else { return false };
        let kind = command["type"].as_str().unwrap_or("");
        if !["brief.get", "brief.set", "brief.note", "brief.run"].contains(&kind) || (kind == "brief.note" && command["included"] != false) {
            return false;
        }
        let Some(dir) = chat.db.parent().map(std::path::Path::to_path_buf) else { return false };
        let state = dir.join("ui-state.json");
        let Ok(memory) = store::open_read_write(&chat.db) else { return false };
        if brief::ensure(&memory).is_err() {
            return false;
        }
        let runner = &self.brief;
        let send = |memory: &rusqlite::Connection| {
            let text = brief::event(memory, &state, runner.running.load(Ordering::SeqCst), runner.notice().as_deref());
            if let Ok(mut last) = self.brief_last.lock() {
                last.clone_from(&text);
            }
            to_app(&text);
        };
        let error = |message: &str| to_app(&Event::error(ark_protocol::events::ErrorStage::Settings, message).to_line());
        match kind {
            "brief.get" => {
                self.watch_brief(chat, to_app);
                send(&memory);
            }
            "brief.set" => {
                if let Err(message) = brief::update(&memory, &command["change"]) {
                    error(&message);
                } else {
                    runner.settings_changed(brief::settings(&memory)["preparation"] == true);
                }
                send(&memory);
            }
            "brief.note" => {
                let Some(id) = command["id"].as_i64() else { return false };
                let ids: Vec<Value> = brief::settings(&memory)["preparationNoteIds"].as_array().cloned().unwrap_or_default().into_iter().filter(|v| v.as_i64() != Some(id)).collect();
                if let Err(message) = brief::update(&memory, &serde_json::json!({ "preparationNoteIds": ids })) {
                    error(&message);
                    return true;
                }
                runner.settings_changed(brief::settings(&memory)["preparation"] == true);
                self.watch_brief(chat, to_app);
                send(&memory);
            }
            _ => {
                if runner.running.swap(true, Ordering::SeqCst) {
                    return true;
                }
                runner.set_notice(None);
                let abort = Cancel::default();
                if let Ok(mut slot) = runner.abort.lock() {
                    *slot = Some(abort.clone());
                }
                let (chat, runner) = (Arc::clone(chat), Arc::clone(&self.brief));
                std::thread::spawn(move || {
                    let (Ok(memory), helpers) = (store::open_read_write(&chat.db), store::open_read_write(&dir.join("helpers.db")).ok().filter(|_| dir.join("helpers.db").exists())) else {
                        runner.running.store(false, Ordering::SeqCst);
                        return;
                    };
                    let agents = dir.join("agents");
                    let write = |task: &str| crate::llm_once::ask(chat.provider.as_ref(), &chat.model, brief::INSTRUCTIONS, task, brief::MODEL_TOKENS);
                    let run = brief::Run { memory: &memory, helpers: helpers.as_ref(), agents: &agents, write: &write, abort: &abort };
                    if let Err(message) = brief::make(&run) {
                        runner.set_notice(Some(if abort.load(Ordering::SeqCst) { message } else { brief::FAILED.into() }));
                    }
                    if let Ok(mut slot) = runner.abort.lock() {
                        *slot = None;
                    }
                    runner.running.store(false, Ordering::SeqCst);
                });
            }
        }
        true
    }

    /// From the first `brief.get` on, a change of the brief (a new brief, new settings, the running flag, the notice) is pushed.
    fn watch_brief(&self, chat: &Arc<Chat>, to_app: &Sink) {
        if self.brief.watched.swap(true, Ordering::SeqCst) {
            return;
        }
        let (runner, last, to_app, db) = (Arc::clone(&self.brief), Arc::clone(&self.brief_last), to_app.clone(), chat.db.clone());
        std::thread::spawn(move || {
            let state = db.parent().map(|d| d.join("ui-state.json")).unwrap_or_default();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(500));
                let Ok(conn) = crate::memory::open_plain(&db).ok_or(()) else { continue };
                let text = crate::brief::event(&conn, &state, runner.running.load(Ordering::SeqCst), runner.notice().as_deref());
                let Ok(mut last) = last.lock() else { return };
                if *last != text {
                    last.clone_from(&text);
                    to_app(&text);
                }
            }
        });
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

/// The log file: `ARK_LOG_FILE`, else `logs/ark.log`, from the folder the runtime started in.
fn log_path() -> std::path::PathBuf {
    let folder = std::env::current_dir().unwrap_or_default();
    folder.join(std::env::var("ARK_LOG_FILE").ok().filter(|v| !v.is_empty()).unwrap_or_else(|| "logs/ark.log".into()))
}

/// `improvements.run` (`improve_run.rs`): the run goes in a thread; the app gets the state at the start and at the end.
fn improvements(chat: &Arc<Chat>, line: &str, to_app: &Sink) -> bool {
    use crate::improvements as store;
    if !line.contains("\"improvements.run\"") || !serde_json::from_str::<Value>(line).is_ok_and(|c| c["type"] == "improvements.run") {
        return false;
    }
    let Some(path) = chat.db.parent().map(|d| d.join("improvements.json")) else { return false };
    let Some(state) = store::read(&path) else { return false };
    if store::is_running() {
        to_app(&store::event(&state, true));
        return true;
    }
    store::set_running(true);
    to_app(&store::event(&state, true));
    let (chat, to_app) = (Arc::clone(chat), to_app.clone());
    std::thread::spawn(move || {
        let lines = crate::improve_run::read_log_tail(&log_path());
        let suggest = |text: &str| crate::llm_once::ask(chat.provider.as_ref(), &chat.model, crate::improve_run::SUGGEST_INSTRUCTION, text, 1024);
        let next = crate::improve_run::run(&state, &lines, jiff::Timestamp::now().as_millisecond(), &suggest);
        let saved = store::write(&path, &next).is_some();
        store::set_running(false);
        to_app(&store::event(if saved { &next } else { &state }, false));
    });
    true
}
