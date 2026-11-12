//! Native chat turns (ADR-278 Phase 2, step 1): `text.send` answered by `ark-agent` instead of Node.
//! Off unless `ARK_RUNTIME_NATIVE_CHAT=1`. Only plain text in a saved, writable, non-project chat that the app has
//! already opened (or a new unsaved one, which gets its row with the first answer) is handled here; everything else
//! (files, notes, `/skill`, a shared chat, a
//! busy chat) goes to Node. The current chat comes from Node's own `chats` and `chat.opened` events.
//! The turn is appended to the same SQLite file Node uses (WAL, busy timeout, one `BEGIN IMMEDIATE`), and then Node
//! gets `chat.open` so its in-memory chat matches the file.

use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ark_agent::{Agent, Approver, Policy, ToolRunner};
use ark_llm::{Block, Message, Provider};
use ark_protocol::events::{ErrorStage, LoopState};
use ark_protocol::{Command, Event, Parsed, parse_command};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

use crate::store;

/// A function that writes one line (with its newline) to the app or to Node.
pub type Sink = Arc<dyn Fn(&str) + Send + Sync>;

/// Replay budget, as `CHAT_REPLAY_BYTES` and `MAX_MESSAGES` in `chat-history.ts`.
const REPLAY_BYTES: usize = 48_000;
const MAX_MESSAGES: usize = 120;

pub struct Chat {
    pub db: PathBuf,
    pub provider: Arc<dyn Provider>,
    pub tools: Arc<dyn ToolRunner>,
    pub policy: Arc<dyn Policy>,
    pub model: String,
    current: Mutex<Option<String>>,
    busy: AtomicBool,
    approvals: Arc<Approvals>,
    /// Chats with a turn running for the local API.
    api_busy: Mutex<std::collections::HashSet<String>>,
    changed: Mutex<Option<Arc<dyn Fn() + Send + Sync>>>,
    questions: Arc<crate::ask::Questions>,
    turn_seq: AtomicU64,
    extras: crate::extras::Extras,
}

/// How long a question waits for the app (the runtime declines by itself after this, as Node does).
const APPROVAL_WAIT: Duration = Duration::from_secs(60);

/// A question that waits: the channel for the answer and the text the asker sees.
struct Waiting {
    tx: mpsc::Sender<bool>,
    summary: String,
    reason: String,
}

/// Questions that wait for `approval.answer`. Ids start with `rs-`, so an answer for a Node question goes to Node.
#[derive(Default)]
pub struct Approvals {
    next: AtomicU64,
    waiting: Mutex<HashMap<String, Waiting>>,
}

impl Approvals {
    /// Gives the answer to the question `id`. `false` when no such question waits.
    pub fn answer(&self, id: &str, approved: bool) -> bool {
        let waiting = self.waiting.lock().ok().and_then(|mut w| w.remove(id));
        waiting.is_some_and(|w| w.tx.send(approved).is_ok())
    }

    /// The questions that wait now: id, summary, reason. Oldest id first.
    pub fn pending(&self) -> Vec<(String, String, String)> {
        let mut all: Vec<_> = self.waiting.lock().map(|w| w.iter().map(|(id, v)| (id.clone(), v.summary.clone(), v.reason.clone())).collect()).unwrap_or_default();
        all.sort_by_key(|(id, _, _)| id.trim_start_matches("rs-").parse::<u64>().unwrap_or(0));
        all
    }

    /// Every waiting question gets a no (the turn was cancelled or the chat changed).
    fn decline_all(&self) {
        if let Ok(mut waiting) = self.waiting.lock() {
            for (_, w) in waiting.drain() {
                w.tx.send(false).ok();
            }
        }
    }
}

/// Asks the app through `approval.request`. No answer in time is a no.
struct AppApprover {
    approvals: Arc<Approvals>,
    /// The app, when the turn comes from the window.
    to_app: Option<Sink>,
    /// Told when a question starts or ends (the Telegram bot shows it).
    on_change: Option<Arc<dyn Fn() + Send + Sync>>,
    wait: Duration,
}

impl Approver for AppApprover {
    fn approve(&self, summary: &str, reason: &str) -> bool {
        let id = format!("rs-{}", self.approvals.next.fetch_add(1, Ordering::SeqCst) + 1);
        let (tx, rx) = mpsc::channel();
        match self.approvals.waiting.lock() {
            Ok(mut waiting) => waiting.insert(id.clone(), Waiting { tx, summary: summary.into(), reason: reason.into() }),
            Err(_) => return false,
        };
        let request = Event::Other(json!({ "type": "approval.request", "id": id, "summary": summary, "reason": reason }).as_object().cloned().unwrap_or_default());
        if let Some(to_app) = &self.to_app {
            to_app(&request.to_line());
        }
        if let Some(changed) = &self.on_change {
            changed();
        }
        let approved = rx.recv_timeout(self.wait).unwrap_or(false);
        if let Ok(mut waiting) = self.approvals.waiting.lock() {
            waiting.remove(&id);
        }
        if let Some(to_app) = &self.to_app {
            to_app(&Event::ApprovalClosed { id }.to_line());
        }
        if let Some(changed) = &self.on_change {
            changed();
        }
        approved
    }
}

/// Chats another surface writes: the window does not write them (see `chat-owner.ts`).
fn is_shared(id: &str) -> bool {
    id == "telegram" || id == "api" || id.starts_with("api-")
}

impl Chat {
    pub fn new(db: PathBuf, provider: Arc<dyn Provider>, tools: Arc<dyn ToolRunner>, policy: Arc<dyn Policy>, model: &str) -> Chat {
        Chat { db, provider, tools, policy, model: model.into(), current: Mutex::new(None), busy: AtomicBool::new(false), approvals: Arc::default(), api_busy: Mutex::default(), changed: Mutex::default(), questions: Arc::default(), turn_seq: AtomicU64::new(0), extras: crate::extras::Extras::default() }
    }

    /// Looks at a line from Node to the app and keeps the id of the open chat.
    pub fn observe(&self, line: &str) {
        if !(line.contains("\"chats\"") || line.contains("chat.opened") || line.contains("conversation.reset")) {
            return;
        }
        let Ok(Value::Object(event)) = serde_json::from_str::<Value>(line) else { return };
        let next = match event.get("type").and_then(Value::as_str) {
            Some("chats") => event.get("current").and_then(Value::as_str).filter(|s| !s.is_empty()).map(String::from),
            Some("chat.opened") => event.get("id").and_then(Value::as_str).map(String::from),
            Some("conversation.reset") => None,
            _ => return,
        };
        if let Ok(mut current) = self.current.lock() {
            *current = next;
        }
    }

    /// The `chats` event for the open chat, built from the memory file and `data/ui-state.json` (see `chats.rs`). `None` when Node must answer.
    pub(crate) fn extras(&self) -> &crate::extras::Extras {
        &self.extras
    }

    pub(crate) fn chats_line(&self) -> Option<String> {
        let state = crate::chats::UiState::read(&self.db.parent()?.join("ui-state.json"))?;
        let conn = crate::chats::open_read_only(&self.db)?;
        let current = self.current.lock().ok()?.clone().unwrap_or_default();
        let event = crate::chats::event(&conn, &state, &current)?;
        Some(Event::Other(event.as_object()?.clone()).to_line())
    }

    /// `project.rename`, `.archive`, `.web` and `.model` with no model (`projects_store.rs`). `None` means: not ours, give it to Node.
    fn project_command(&self, command: &Command) -> Option<Result<(), String>> {
        use crate::projects_store as p;
        let done = |op: &dyn Fn(&Connection) -> Result<(), String>| -> Option<Result<(), String>> {
            // Without the state file the app could not get the new list: Node does it all.
            self.chats_line()?;
            let conn = store::open_read_write(&self.db).ok()?;
            Some(op(&conn))
        };
        match command {
            Command::ProjectRename { id, name } => done(&|c| p::rename(c, id, name)),
            Command::ProjectArchive { id, archived } => done(&|c| p::archive(c, id, *archived)),
            Command::ProjectWeb { id, web } => done(&|c| p::set_web(c, id, *web)),
            Command::ProjectModel { id, provider, model } if provider.is_empty() && model.is_empty() => done(&|c| p::clear_model(c, id)),
            Command::ProjectAdd { name, path } => self.project_add(name, path),
            Command::ProjectRemove { id, delete_chats } => {
                self.chats_line()?;
                let conn = store::open_read_write(&self.db).ok()?;
                crate::projects_add::remove(&conn, &self.db.parent()?.join("ui-state.json"), id, delete_chats.unwrap_or(false)).into_result()
            }
            _ => None,
        }
    }

    /// `project.add`: the folder grant, the project's coder Agent, the row and the list (`projects_add.rs`). Needs the helpers file beside the memory file.
    fn project_add(&self, name: &str, path: &str) -> Option<Result<(), String>> {
        let dir = self.db.parent()?;
        let helpers_file = dir.join("helpers.db");
        if !helpers_file.exists() {
            return None;
        }
        self.chats_line()?;
        let (memory, helpers) = (store::open_read_write(&self.db).ok()?, store::open_read_write(&helpers_file).ok()?);
        let home = std::env::var_os("HOME").map(std::path::PathBuf::from)?;
        crate::projects_add::add(&memory, &helpers, &dir.join("agents"), &home, &dir.join("ui-state.json"), name, path).into_result()
    }

    /// `chat.open` for a saved chat that is not in a project: the app gets `chat.opened` and `chats` from the files, and Node only moves its
    /// Core session (`core.resume`, which says nothing back). `false` means: give it to Node.
    fn open_chat(&self, line: &str, to_app: &Sink, to_node: &Sink) -> bool {
        if !line.contains("\"chat.open\"") || self.busy.load(Ordering::SeqCst) {
            return false;
        }
        let Ok(Value::Object(command)) = serde_json::from_str::<Value>(line) else { return false };
        if command.get("type").and_then(Value::as_str) != Some("chat.open") {
            return false;
        }
        let Some(id) = command.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')) else { return false };
        let Ok(conn) = crate::chats::open_read_only(&self.db).ok_or(()) else { return false };
        let row: Option<Option<String>> = conn.query_row("SELECT project_id FROM chats WHERE id = ?", [id], |r| r.get::<_, Option<String>>(0)).optional().ok().flatten();
        // No row, or a project chat (its replay is capped by Node): Node answers.
        if !matches!(row, Some(None)) {
            return false;
        }
        let Ok(history) = read_history(&conn, id) else { return false };
        let messages: Vec<Value> = history.iter().enumerate().map(|(i, (role, text))| json!({ "role": role, "text": text, "seq": i + 1 })).collect();
        let previous = self.current.lock().ok().and_then(|mut c| c.replace(id.to_string()));
        let Some(chats) = self.chats_line() else {
            if let Ok(mut c) = self.current.lock() {
                *c = previous;
            }
            return false;
        };
        self.approvals.decline_all();
        self.questions.skip_all();
        to_app(&Event::Other(json!({ "type": "chat.opened", "id": id, "messages": messages }).as_object().cloned().unwrap_or_default()).to_line());
        to_app(&chats);
        to_node(&format!("{}\n", json!({ "type": "core.resume", "id": id })));
        true
    }

    /// `chat.delete`: the chat and everything kept for it go in one write (`chat_store.rs`); the app gets `conversation.reset` when it was the open
    /// chat, and `chats`. Node only moves its Core session. `false` means: give it to Node.
    fn delete_chat(&self, line: &str, to_app: &Sink, to_node: &Sink) -> bool {
        if !line.contains("\"chat.delete\"") {
            return false;
        }
        let Ok(Value::Object(command)) = serde_json::from_str::<Value>(line) else { return false };
        if command.get("type").and_then(Value::as_str) != Some("chat.delete") {
            return false;
        }
        let Some(id) = command.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')) else { return false };
        let was_open = self.current.lock().ok().is_some_and(|c| c.as_deref() == Some(id));
        if is_shared(id) || (was_open && self.busy.load(Ordering::SeqCst)) {
            return false;
        }
        let Some(dir) = self.db.parent() else { return false };
        // Without the state file the app could not get the new list: Node does it all.
        if self.chats_line().is_none() {
            return false;
        }
        let Ok(conn) = store::open_read_write(&self.db) else { return false };
        if crate::chat_store::delete_chat(&conn, &dir.join("attachments"), id).is_err() {
            return false;
        }
        if was_open {
            if let Ok(mut c) = self.current.lock() {
                *c = None;
            }
            self.approvals.decline_all();
            self.questions.skip_all();
            to_app(&Event::Other(json!({ "type": "conversation.reset" }).as_object().cloned().unwrap_or_default()).to_line());
            to_node(&format!("{}\n", json!({ "type": "core.resume" })));
        }
        if let Some(chats) = self.chats_line() {
            to_app(&chats);
        }
        true
    }

    /// Takes `line` when it is a plain `text.send` this runtime can answer. `false` means: give it to Node.
    pub fn handle(self: &Arc<Self>, line: &str, to_app: Sink, to_node: Sink) -> bool {
        let Parsed::Command(command) = parse_command(line) else { return false };
        match *command {
            Command::ApprovalAnswer { ref id, approved, .. } => return self.approvals.answer(id, approved),
            // A command that ends the turn counts as "no" for a question that waits (the line still goes to Node).
            Command::ChatQuestionAnswer { ref chat, ref turn, ref id, ref text } => {
                return crate::ask::Questions::is_ours(id) && self.questions.answer(chat, turn, id, text.as_deref());
            }
            // A new chat outside a project: the app gets the reset and the list at once; Node mints its Core session quietly (`core.new`).
            Command::ChatNew { project_id: None } if !self.busy.load(Ordering::SeqCst) && self.chats_line().is_some() => {
                self.approvals.decline_all();
                self.questions.skip_all();
                if let Ok(mut c) = self.current.lock() {
                    *c = None;
                }
                to_app(&Event::Other(json!({ "type": "conversation.reset" }).as_object().cloned().unwrap_or_default()).to_line());
                if let Some(chats) = self.chats_line() {
                    to_app(&chats);
                }
                to_node(&format!("{}\n", json!({ "type": "core.new" })));
                return true;
            }
            Command::TalkCancel | Command::TalkStart | Command::ConversationReset | Command::ChatNew { .. } => {
                self.approvals.decline_all();
                self.questions.skip_all();
                return false;
            }
            _ => {}
        }
        if self.extras.project(self, line, &to_app) {
            return true;
        }
        if let Some(result) = self.project_command(&command) {
            match result {
                Ok(()) => {
                    if let Some(chats) = self.chats_line() {
                        to_app(&chats);
                    }
                }
                Err(message) => to_app(&Event::error(ErrorStage::Settings, &message).to_line()),
            }
            return true;
        }
        if self.open_chat(line, &to_app, &to_node) || self.delete_chat(line, &to_app, &to_node) {
            return true;
        }
        if matches!(*command, Command::ChatsList) {
            // The app gets the list at once. Node also gets the command, so it keeps pushing its own changes (it sets `chatsWatched`);
            // its answer has the same content as this one.
            if let Some(line) = self.chats_line() {
                to_app(&line);
            }
            return false;
        }
        let Command::TextSend { text, files, notes, request, chat } = *command else { return false };
        let plain = files.is_none_or(|f| f.is_empty()) && notes.is_none_or(|n| n.is_empty()) && request.is_none() && chat.is_none();
        if !plain || text.trim().is_empty() || text.trim_start().starts_with('/') {
            return false;
        }
        let Some(id) = self.current.lock().ok().and_then(|c| c.clone()) else { return false };
        if is_shared(&id) || !self.writable(&id) {
            return false;
        }
        if self.busy.swap(true, Ordering::SeqCst) {
            to_app(&Event::error(ErrorStage::Settings, "ARK is answering in this chat. Try again in a moment.").to_line());
            return true;
        }
        let me = Arc::clone(self);
        std::thread::spawn(move || {
            me.turn(&id, &text, &to_app);
            me.busy.store(false, Ordering::SeqCst);
            // Node reloads the chat from the file, so its memory matches and the app gets `chat.opened` and `chats`.
            to_node(&format!("{}\n", json!({ "type": "chat.open", "id": id })));
        });
        true
    }

    /// The chat has a saved row, is not archived and is not in a project.
    fn writable(&self, id: &str) -> bool {
        let Ok(conn) = store::open_read_write(&self.db) else { return false };
        let row: Option<(i64, Option<String>)> = conn
            .query_row("SELECT archived, project_id FROM chats WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?)))
            .optional()
            .unwrap_or(None);
        // No row: a new unsaved chat. Node saves it after the first answer, and so does `turn`.
        matches!(row, Some((0, None)) | None)
    }

    /// Makes the row of a new chat. `true` when it was made now.
    fn ensure_chat(&self, id: &str, first_text: &str) -> Result<bool, String> {
        let conn = store::open_read_write(&self.db).map_err(|e| format!("The chat file could not be opened: {e}"))?;
        let at = jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        Ok(conn.execute("INSERT OR IGNORE INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", rusqlite::params![id, chat_title(first_text), at, at]).map_err(|e| e.to_string())? > 0)
    }

    /// Like Node: a chat with no saved answer leaves no row.
    fn drop_empty(&self, id: &str) {
        if let Ok(conn) = store::open_read_write(&self.db) {
            conn.execute("DELETE FROM chats WHERE id = ? AND NOT EXISTS (SELECT 1 FROM chat_messages WHERE chat_id = ?)", [id, id]).ok();
        }
    }

    fn turn(&self, id: &str, text: &str, to_app: &Sink) {
        let emit = |event: Event| to_app(&event.to_line());
        emit(Event::Transcript { text: text.into() });
        emit(Event::State { state: LoopState::Thinking });
        let started = Instant::now();
        let approver = AppApprover { approvals: Arc::clone(&self.approvals), to_app: Some(Arc::clone(to_app)), on_change: self.on_change(), wait: APPROVAL_WAIT };
        let ask = crate::ask::AskUser::new(Arc::clone(&self.questions), Arc::clone(to_app), id, &format!("rt-{}", self.turn_seq.fetch_add(1, Ordering::SeqCst) + 1));
        let created = self.ensure_chat(id, text);
        let result = match created {
            Ok(created) => {
                let r = self.answer(id, text, Some(&approver), true, Some(&ask), Some(to_app));
                if created && r.is_err() {
                    self.drop_empty(id);
                }
                r
            }
            Err(e) => Err(e),
        };
        ask.finish(result.is_ok());
        match result {
            Ok(reply) => {
                emit(Event::Reply { text: reply });
                emit(Event::State { state: LoopState::Idle });
                emit(Event::TurnComplete { speech_ms: 0, transcription_ms: 0, model_ms: started.elapsed().as_millis() as u64, first_sound_ms: None });
            }
            Err(message) => {
                emit(Event::error(ErrorStage::Model, message));
                emit(Event::State { state: LoopState::Idle });
            }
        }
    }

    /// Runs the agent on the saved history and appends the exchange. Gives the reply text.
    fn answer(&self, id: &str, text: &str, approver: Option<&dyn Approver>, typed: bool, ask: Option<&crate::ask::AskUser>, live: Option<&Sink>) -> Result<String, String> {
        let conn = store::open_read_write(&self.db).map_err(|e| format!("The chat file could not be opened: {e}"))?;
        let saved = read_history(&conn, id).map_err(|e| format!("The chat could not be read: {e}"))?;
        let history = replay_window(&saved, text)?;
        let with_ask = crate::ask::WithAsk(self.policy.as_ref());
        let plus = ask.map(|a| crate::ask::Plus(self.tools.as_ref(), a));
        let mut agent = match (&plus, ask) {
            (Some(plus), Some(_)) => Agent::new(self.provider.as_ref(), &with_ask, plus, &self.model),
            _ => Agent::new(self.provider.as_ref(), self.policy.as_ref(), self.tools.as_ref(), &self.model),
        };
        agent.system = Some(crate::context::SYSTEM_PROMPT.into());
        agent.approver = approver;
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
        let asked = crate::context::with_context(Some(&conn), id, text, saved.is_empty(), typed, &jiff::Zoned::now());
        let outcome = runtime.block_on(agent.run(history, &asked, |e| {
            if let (ark_llm::Event::Text { text }, Some(live)) = (e, live) {
                live(&Event::ReplyDelta { text: text.clone() }.to_line());
            }
        })).map_err(|e| e.to_string())?;
        append_exchange(&conn, id, saved.len(), text, &outcome.text).map_err(|e| format!("The answer could not be saved: {e}"))?;
        Ok(outcome.text)
    }
}

impl Chat {
    /// The questions that wait now (for the Telegram bot): id, summary, reason.
    pub fn pending_asks(&self) -> Vec<(String, String, String)> {
        self.approvals.pending()
    }

    /// The answer to a waiting question. `false` when no such question waits.
    pub fn answer_ask(&self, id: &str, approved: bool) -> bool {
        self.approvals.answer(id, approved)
    }

    /// Called when a question starts or ends. The Telegram bot sets it.
    pub fn set_on_change(&self, f: Arc<dyn Fn() + Send + Sync>) {
        if let Ok(mut slot) = self.changed.lock() {
            *slot = Some(f);
        }
    }

    fn on_change(&self) -> Option<Arc<dyn Fn() + Send + Sync>> {
        self.changed.lock().ok().and_then(|c| c.clone())
    }

    /// One turn in the chat `telegram`. A call that needs approval becomes a question the bot shows with buttons.
    pub fn ask_telegram(&self, text: &str) -> Result<String, (u16, String)> {
        let approver = AppApprover { approvals: Arc::clone(&self.approvals), to_app: None, on_change: self.on_change(), wait: APPROVAL_WAIT };
        self.ask_with("telegram", text, Some(&approver), false)
    }

    /// One turn for the local API in chat `id` (made when it is new). No approver: a call that needs approval is refused.
    /// `Err((409, _))` when a turn runs in that chat already.
    pub fn ask_in(&self, id: &str, text: &str) -> Result<String, (u16, String)> {
        self.ask_with(id, text, None, false)
    }

    fn ask_with(&self, id: &str, text: &str, approver: Option<&dyn Approver>, typed: bool) -> Result<String, (u16, String)> {
        if !self.api_busy.lock().map_err(|_| (500, "lock poisoned".to_string()))?.insert(id.to_string()) {
            return Err((409, "ARK is answering in this chat. Try again in a moment.".into()));
        }
        let result = self.ask_in_unlocked(id, text, approver, typed).map_err(|e| (502, format!("ARK could not answer: {e}")));
        if let Ok(mut busy) = self.api_busy.lock() {
            busy.remove(id);
        }
        result
    }

    fn ask_in_unlocked(&self, id: &str, text: &str, approver: Option<&dyn Approver>, typed: bool) -> Result<String, String> {
        let created = self.ensure_chat(id, text)?;
        let result = self.answer(id, text, approver, typed, None, None);
        if created && result.is_err() {
            self.drop_empty(id);
        }
        result
    }
}

impl Chat {
    /// The chat engine from the environment: `ANTHROPIC_API_KEY`, else the Claude bridge helper named by `ARK_CLAUDE_BRIDGE`
    /// (a TypeScript file run by `node`). `ARK_NATIVE_ACTIONS=1` adds `write_file` and `run_command` (each call asks the user;
    /// writes go only to `ARK_NATIVE_WRITE_ROOTS`, absolute folders separated by `:`). `ARK_NATIVE_CHAT_MODEL` sets the model.
    /// `None` without a model to call.
    pub fn from_process_env(memory_db: &std::path::Path) -> Option<Arc<Chat>> {
        let env = |name: &str| std::env::var(name).ok().filter(|v| !v.is_empty());
    let provider: Arc<dyn ark_llm::Provider> = match (env("ANTHROPIC_API_KEY"), env("ARK_CLAUDE_BRIDGE")) {
        (Some(key), _) => match env("ANTHROPIC_BASE_URL") {
            Some(url) => Arc::new(ark_llm::anthropic::AnthropicClient::with_base_url(key, &url)),
            None => Arc::new(ark_llm::anthropic::AnthropicClient::new(key)),
        },
        (None, Some(script)) => Arc::new(ark_llm::bridge::ClaudeBridge::new("node", vec!["--disable-warning=ExperimentalWarning".into(), script])),
        _ => return None,
    };
    let home = std::path::PathBuf::from(env("HOME")?);
    let cwd = std::env::current_dir().ok()?;
    let tools = ark_agent::tools::Tools { home: home.clone(), roots: Vec::new(), cwd: cwd.clone() };
    let mut runners: Vec<Arc<dyn ark_agent::ToolRunner>> = vec![Arc::new(ark_agent::RuntimeTools(tools))];
    let mut allowed = vec!["current_time"];
    let mut policy = ark_agent::FloorPolicy::new(&allowed, &home, Vec::new(), &cwd);
    // `ARK_NATIVE_ACTIONS=1` adds write_file and run_command; each call asks the user. Writes go only to the folders in
    // `ARK_NATIVE_WRITE_ROOTS` (absolute paths, separated by `:`).
    if env("ARK_NATIVE_ACTIONS").as_deref() == Some("1") {
        let roots: Vec<std::path::PathBuf> = env("ARK_NATIVE_WRITE_ROOTS").unwrap_or_default().split(':').filter(|r| r.starts_with('/')).map(Into::into).collect();
        allowed.extend(["write_file", "run_command"]);
        policy = ark_agent::FloorPolicy::new(&allowed, &home, Vec::new(), &cwd).with_write_roots(roots.clone());
        runners.push(Arc::new(ark_agent::ActionTools { home: home.clone(), write_roots: roots, cwd: cwd.clone() }));
    }
    let model = env("ARK_NATIVE_CHAT_MODEL").unwrap_or_else(|| "claude-sonnet-5-5".into());
    Some(Arc::new(Chat::new(memory_db.to_path_buf(), provider, Arc::new(ark_agent::Combined(runners)), Arc::new(policy), &model)))
    }
}

/// The chat's title: the first words on one line, 60 characters at most (`chatTitle` in `chats.ts`).
pub fn chat_title(first: &str) -> String {
    let line = first.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.is_empty() {
        return "New chat".into();
    }
    if line.chars().count() > 60 { format!("{}…", line.chars().take(59).collect::<String>().trim_end()) } else { line }
}

/// The saved messages of a chat, oldest first.
pub fn read_history(conn: &Connection, id: &str) -> rusqlite::Result<Vec<(String, String)>> {
    conn.prepare("SELECT role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq")?.query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect()
}

/// The newest messages that fit the replay budget (`chatContext` in `chat-history.ts`, without its half-window step).
pub fn replay_window(saved: &[(String, String)], current: &str) -> Result<Vec<Message>, String> {
    let cost = |text: &str| text.len() + 32;
    let mut bytes = cost(current);
    if bytes > REPLAY_BYTES {
        return Err(format!("This message exceeds ARK's {REPLAY_BYTES}-byte conversation replay budget. Shorten it or attach the text as a file. Your saved chat is unchanged."));
    }
    let mut first = saved.len();
    while first > 0 && saved.len() - first < MAX_MESSAGES && bytes + cost(&saved[first - 1].1) <= REPLAY_BYTES {
        first -= 1;
        bytes += cost(&saved[first].1);
    }
    Ok(saved[first..].iter().map(|(role, content)| Message { role: role.clone(), content: vec![Block::Text { text: content.clone() }] }).collect())
}

/// Adds the user message and the reply at the end, in one write transaction. It refuses when the chat changed since it was read.
pub fn append_exchange(conn: &Connection, id: &str, expected: usize, user: &str, reply: &str) -> Result<(), String> {
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM chat_messages WHERE chat_id = ?", [id], |r| r.get(0)).map_err(|e| e.to_string())?;
        if count as usize != expected {
            return Err("the chat changed while ARK answered".into());
        }
        let mut insert = conn.prepare("INSERT INTO chat_messages (chat_id, seq, role, content) VALUES (?, ?, ?, ?)").map_err(|e| e.to_string())?;
        insert.execute(rusqlite::params![id, count, "user", user]).map_err(|e| e.to_string())?;
        insert.execute(rusqlite::params![id, count + 1, "assistant", reply]).map_err(|e| e.to_string())?;
        let at = jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", rusqlite::params![at, id]).map_err(|e| e.to_string())?;
        Ok(())
    })();
    match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
        Err(e) => {
            conn.execute_batch("ROLLBACK").ok();
            Err(e)
        }
    }
}

/// Whether native chat is switched on.
pub fn enabled(env: impl Fn(&str) -> Option<String>) -> bool {
    env("ARK_RUNTIME_NATIVE_CHAT").as_deref() == Some("1")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use ark_agent::{FloorPolicy, RuntimeTools, tools::Tools};
    use ark_llm::{EventStream, LlmError, Request, Usage};
    use futures_util::future::BoxFuture;
    use std::sync::mpsc;
    use std::time::Duration;

    struct Fixed(&'static str);
    impl Provider for Fixed {
        fn stream<'a>(&'a self, _: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
            let items = vec![Ok(ark_llm::Event::Text { text: self.0.into() }), Ok(ark_llm::Event::Done { stop_reason: "end_turn".into(), usage: Usage::default() })];
            Box::pin(async move { Ok(Box::pin(futures_util::stream::iter(items)) as EventStream) })
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("ark-chat-{name}-{}.db", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", path.display())).ok();
        }
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE chat_messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (chat_id, seq));
             INSERT INTO chats (id, title, created_at, updated_at) VALUES ('c1', 'Hi', 'a', 'a');
             INSERT INTO chats (id, title, created_at, updated_at, archived) VALUES ('old', 'Old', 'a', 'a', 1);
             INSERT INTO chat_messages VALUES ('c1', 0, 'user', 'Hi'), ('c1', 1, 'assistant', 'Hello');",
        )
        .unwrap();
        path
    }

    fn chat(db: PathBuf) -> Arc<Chat> {
        let home = std::env::temp_dir();
        let tools = Tools { home: home.clone(), roots: vec![], cwd: home.clone() };
        let policy = FloorPolicy::new(&["current_time"], &home, vec![], &home);
        Arc::new(Chat::new(db, Arc::new(Fixed("Pong")), Arc::new(RuntimeTools(tools)), Arc::new(policy), "m"))
    }

    fn sinks() -> (Sink, mpsc::Receiver<String>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        (Arc::new(move |l: &str| drop(tx.lock().unwrap().send(l.to_string()))), rx)
    }

    #[test]
    fn a_plain_text_send_in_the_open_chat_is_answered_saved_and_synced() {
        let db = scratch("ok");
        let chat = chat(db.clone());
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"c1\"}\n");
        let (app, app_rx) = sinks();
        let (node, node_rx) = sinks();
        assert!(chat.handle("{\"type\":\"text.send\",\"text\":\"Ping\"}\n", app, node));
        let sync = node_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(sync, format!("{}\n", json!({ "type": "chat.open", "id": "c1" })));
        let lines: Vec<String> = app_rx.try_iter().collect();
        let types: Vec<Value> = lines.iter().map(|l| serde_json::from_str::<Value>(l).unwrap()).collect();
        let kinds: Vec<&str> = types.iter().map(|v| v["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["transcript", "state", "reply.delta", "reply", "state", "turn.complete"]);
        assert_eq!(types[2]["text"], "Pong");
        assert_eq!(types[3]["text"], "Pong");
        let rows = read_history(&Connection::open(&db).unwrap(), "c1").unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[2], ("user".into(), "Ping".into()));
        assert_eq!(rows[3], ("assistant".into(), "Pong".into()));
    }

    #[test]
    fn a_new_unsaved_chat_is_made_with_its_first_answer() {
        let db = scratch("new");
        let chat = chat(db.clone());
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"fresh-1\"}\n");
        let (app, _a) = sinks();
        let (node, node_rx) = sinks();
        assert!(chat.handle("{\"type\":\"text.send\",\"text\":\"Ping there\"}\n", app, node));
        node_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        let conn = Connection::open(&db).unwrap();
        let title: String = conn.query_row("SELECT title FROM chats WHERE id = 'fresh-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "Ping there");
        assert_eq!(read_history(&conn, "fresh-1").unwrap(), [("user".to_string(), "Ping there".to_string()), ("assistant".into(), "Pong".into())]);
    }

    #[test]
    fn everything_else_goes_to_node() {
        let chat = chat(scratch("no"));
        let (app, _a) = sinks();
        let (node, _n) = sinks();
        let go = |line: &str| chat.handle(line, app.clone(), node.clone());
        assert!(!go("{\"type\":\"text.send\",\"text\":\"x\"}\n"), "no open chat yet");
        for current in ["old", "telegram", "api-5"] {
            chat.observe(&format!("{{\"type\":\"chat.opened\",\"id\":\"{current}\",\"messages\":[]}}\n"));
            assert!(!go("{\"type\":\"text.send\",\"text\":\"x\"}\n"), "{current}");
        }
        chat.observe("{\"type\":\"chat.opened\",\"id\":\"c1\",\"messages\":[]}\n");
        assert!(!go("{\"type\":\"text.send\",\"text\":\"/skill hi\"}\n"));
        assert!(!go("{\"type\":\"text.send\",\"text\":\"x\",\"files\":[\"/a\"]}\n"));
        assert!(!go("{\"type\":\"text.send\",\"text\":\"  \"}\n"));
        assert!(!go("{\"type\":\"chats.list\"}\n"));
        chat.observe("{\"type\":\"conversation.reset\"}\n");
        assert!(!go("{\"type\":\"text.send\",\"text\":\"x\"}\n"), "reset clears the open chat");
    }

    #[test]
    fn chats_list_is_answered_from_the_files_and_still_goes_to_node() {
        let dir = std::env::temp_dir().join(format!("ark-chat-list-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        std::fs::copy(format!("{fixtures}/chats-view.db"), dir.join("memory.db")).unwrap();
        std::fs::copy(format!("{fixtures}/chats-view-state.json"), dir.join("ui-state.json")).unwrap();
        let chat = chat(dir.join("memory.db"));
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"plain-2\"}\n");
        let ((app, from_app), (node, _)) = (sinks(), sinks());
        assert!(!chat.handle("{\"type\":\"chats.list\"}\n", app, node), "Node still gets the command");
        let sent: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!((sent["type"].clone(), sent["current"].clone(), sent["access"].clone()), (json!("chats"), json!("plain-2"), json!("ask-changes")));
        // No state file: nothing is sent, and Node answers.
        std::fs::remove_file(dir.join("ui-state.json")).unwrap();
        let ((app, from_app), (node, _)) = (sinks(), sinks());
        assert!(!chat.handle("{\"type\":\"chats.list\"}\n", app, node));
        assert!(from_app.try_recv().is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chat_open_is_answered_from_the_files_and_node_only_moves_its_core() {
        let dir = std::env::temp_dir().join(format!("ark-chat-open-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        std::fs::copy(format!("{fixtures}/chats-view.db"), dir.join("memory.db")).unwrap();
        std::fs::copy(format!("{fixtures}/chats-view-state.json"), dir.join("ui-state.json")).unwrap();
        let chat = chat(dir.join("memory.db"));
        let ((app, from_app), (node, from_node)) = (sinks(), sinks());
        assert!(chat.handle("{\"type\":\"chat.open\",\"id\":\"plain-2\"}\n", app, node), "the line is taken");
        let opened: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!((opened["type"].clone(), opened["id"].clone()), (json!("chat.opened"), json!("plain-2")));
        let list: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!((list["type"].clone(), list["current"].clone()), (json!("chats"), json!("plain-2")));
        let quiet: Value = serde_json::from_str(&from_node.try_recv().unwrap()).unwrap();
        assert_eq!(quiet, json!({ "type": "core.resume", "id": "plain-2" }));
        // A project chat, an unknown chat and a bad id go to Node.
        for line in ["{\"type\":\"chat.open\",\"id\":\"proj-1\"}\n", "{\"type\":\"chat.open\",\"id\":\"nope\"}\n", "{\"type\":\"chat.open\",\"id\":\"../x\"}\n"] {
            let ((app, _), (node, _)) = (sinks(), sinks());
            assert!(!chat.handle(line, app, node), "{line}");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chat_delete_removes_the_chat_resets_the_app_and_tells_node_quietly() {
        let dir = std::env::temp_dir().join(format!("ark-chat-delete-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        std::fs::copy(format!("{fixtures}/chats-view.db"), dir.join("memory.db")).unwrap();
        std::fs::copy(format!("{fixtures}/chats-view-state.json"), dir.join("ui-state.json")).unwrap();
        let chat = chat(dir.join("memory.db"));
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"plain-2\"}\n");
        let ((app, from_app), (node, from_node)) = (sinks(), sinks());
        assert!(chat.handle("{\"type\":\"chat.delete\",\"id\":\"plain-2\"}\n", app, node));
        let reset: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!(reset["type"], json!("conversation.reset"));
        let list: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert!(!list["chats"].as_array().unwrap().iter().any(|c| c["id"] == "plain-2"));
        assert_eq!(serde_json::from_str::<Value>(&from_node.try_recv().unwrap()).unwrap(), json!({ "type": "core.resume" }));
        let conn = Connection::open(dir.join("memory.db")).unwrap();
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM chat_messages WHERE chat_id = 'plain-2'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        // Another chat than the open one: no reset. The Telegram chat goes to Node.
        let ((app, from_app), (node, _)) = (sinks(), sinks());
        assert!(chat.handle("{\"type\":\"chat.delete\",\"id\":\"plain-1\"}\n", app, node));
        assert_eq!(serde_json::from_str::<Value>(&from_app.try_recv().unwrap()).unwrap()["type"], json!("chats"));
        let ((app, _), (node, _)) = (sinks(), sinks());
        assert!(!chat.handle("{\"type\":\"chat.delete\",\"id\":\"telegram\"}\n", app, node));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn chat_new_resets_the_app_and_node_mints_its_session_quietly() {
        let dir = std::env::temp_dir().join(format!("ark-chat-new-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        std::fs::copy(format!("{fixtures}/chats-view.db"), dir.join("memory.db")).unwrap();
        std::fs::copy(format!("{fixtures}/chats-view-state.json"), dir.join("ui-state.json")).unwrap();
        let chat = chat(dir.join("memory.db"));
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"plain-2\"}\n");
        let ((app, from_app), (node, from_node)) = (sinks(), sinks());
        assert!(chat.handle("{\"type\":\"chat.new\"}\n", app, node));
        assert_eq!(serde_json::from_str::<Value>(&from_app.try_recv().unwrap()).unwrap()["type"], json!("conversation.reset"));
        let list: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!(list["current"], json!(""));
        assert_eq!(serde_json::from_str::<Value>(&from_node.try_recv().unwrap()).unwrap(), json!({ "type": "core.new" }));
        // A project chat goes to Node.
        let ((app, _), (node, _)) = (sinks(), sinks());
        assert!(!chat.handle("{\"type\":\"chat.new\",\"projectId\":\"p-1\"}\n", app, node));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn project_commands_change_the_rows_and_refresh_the_list() {
        let dir = std::env::temp_dir().join(format!("ark-chat-project-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        std::fs::copy(format!("{fixtures}/chats-view.db"), dir.join("memory.db")).unwrap();
        std::fs::copy(format!("{fixtures}/chats-view-state.json"), dir.join("ui-state.json")).unwrap();
        let chat = chat(dir.join("memory.db"));
        let ((app, from_app), (node, from_node)) = (sinks(), sinks());
        assert!(chat.handle("{\"type\":\"project.rename\",\"id\":\"p-959297e8\",\"name\":\"Renamed\"}\n", app, node));
        let list: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!(list["projects"][0]["name"], json!("Renamed"));
        assert!(from_node.try_recv().is_err(), "Node hears nothing");
        let ((app, from_app), (node, _)) = (sinks(), sinks());
        assert!(chat.handle("{\"type\":\"project.rename\",\"id\":\"p-none\",\"name\":\"X\"}\n", app, node));
        let error: Value = serde_json::from_str(&from_app.try_recv().unwrap()).unwrap();
        assert_eq!((error["type"].clone(), error["message"].clone()), (json!("error"), json!("There is no such project.")));
        // Choosing a model needs Node's check.
        let ((app, _), (node, _)) = (sinks(), sinks());
        assert!(!chat.handle("{\"type\":\"project.model\",\"id\":\"p-959297e8\",\"provider\":\"claude\",\"model\":\"m\"}\n", app, node));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_chat_changed_by_node_in_the_meantime_is_not_overwritten() {
        let db = scratch("race");
        let conn = store::open_read_write(&db).unwrap();
        assert!(append_exchange(&conn, "c1", 1, "u", "a").is_err());
        assert_eq!(read_history(&conn, "c1").unwrap().len(), 2);
        assert!(append_exchange(&conn, "c1", 2, "u", "a").is_ok());
    }

    #[test]
    fn replay_keeps_the_newest_messages_within_the_budget() {
        let saved: Vec<(String, String)> = (0..300).map(|i| ("user".to_string(), format!("m{i}"))).collect();
        let window = replay_window(&saved, "now").unwrap();
        assert_eq!(window.len(), MAX_MESSAGES);
        assert!(matches!(&window[MAX_MESSAGES - 1].content[0], Block::Text { text } if text == "m299"));
        assert!(replay_window(&[], &"x".repeat(REPLAY_BYTES)).is_err());
    }

    /// Asks for `write_file` the first time, then answers with text.
    struct WritesOnce(PathBuf, AtomicU64);
    impl Provider for WritesOnce {
        fn stream<'a>(&'a self, _: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
            let first = self.1.fetch_add(1, Ordering::SeqCst) == 0;
            let done = ark_llm::Event::Done { stop_reason: "x".into(), usage: Usage::default() };
            let items = if first {
                vec![Ok(ark_llm::Event::ToolUse { id: "t".into(), name: "write_file".into(), input: json!({"path": self.0, "content": "data"}) }), Ok(done)]
            } else {
                vec![Ok(ark_llm::Event::Text { text: "Done".into() }), Ok(done)]
            };
            Box::pin(async move { Ok(Box::pin(futures_util::stream::iter(items)) as EventStream) })
        }
    }

    fn write_chat(db: PathBuf, file: PathBuf) -> Arc<Chat> {
        use ark_agent::{ActionTools, Combined};
        let dir = file.parent().unwrap().to_path_buf();
        let home = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let policy = FloorPolicy::new(&["write_file"], &home, vec![], &dir).with_write_roots(vec![dir.clone()]);
        let tools = Combined(vec![Arc::new(ActionTools { home: home.clone(), write_roots: vec![dir.clone()], cwd: dir })]);
        Arc::new(Chat::new(db, Arc::new(WritesOnce(file, AtomicU64::new(0))), Arc::new(tools), Arc::new(policy), "m"))
    }

    fn approval_round(answer: bool) -> (bool, Vec<Value>) {
        let name = if answer { "yes" } else { "no" };
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("ark-chat-write-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("out.txt");
        let chat = write_chat(scratch(&format!("w{name}")), file.clone());
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"c1\"}\n");
        let (app, app_rx) = sinks();
        let (node, node_rx) = sinks();
        assert!(chat.handle("{\"type\":\"text.send\",\"text\":\"write it\"}\n", app.clone(), node.clone()));
        let mut seen = Vec::new();
        let id = loop {
            let line = app_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let v: Value = serde_json::from_str(&line).unwrap();
            seen.push(v.clone());
            if v["type"] == "approval.request" {
                assert!(v["summary"].as_str().unwrap().contains("Write 4 bytes"));
                break v["id"].as_str().unwrap().to_string();
            }
        };
        assert!(!file.exists(), "nothing is written before the answer");
        assert!(!chat.handle("{\"type\":\"approval.answer\",\"id\":\"a-node\",\"approved\":true}\n", app.clone(), node.clone()), "a Node question goes to Node");
        assert!(chat.handle(&format!("{}\n", json!({"type": "approval.answer", "id": id, "approved": answer})), app, node));
        node_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        seen.extend(app_rx.try_iter().map(|l| serde_json::from_str::<Value>(&l).unwrap()));
        (file.exists(), seen)
    }

    #[test]
    fn a_write_waits_for_approval_answer_and_a_no_writes_nothing() {
        let (written, seen) = approval_round(true);
        assert!(written);
        assert!(seen.iter().any(|v| v["type"] == "approval.closed"));
        assert!(seen.iter().any(|v| v["type"] == "reply" && v["text"] == "Done"));
        let (written, _) = approval_round(false);
        assert!(!written);
    }

    /// Asks `ask_user` the first time, then answers with the user's answer.
    struct AsksOnce(AtomicU64, Mutex<String>);
    impl Provider for AsksOnce {
        fn stream<'a>(&'a self, req: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
            let first = self.0.fetch_add(1, Ordering::SeqCst) == 0;
            let done = ark_llm::Event::Done { stop_reason: "x".into(), usage: Usage::default() };
            let items = if first {
                assert!(req.tools.iter().any(|t| t.name == "ask_user"), "the tool is offered in a window turn");
                vec![Ok(ark_llm::Event::ToolUse { id: "q".into(), name: "ask_user".into(), input: json!({"question": "Tea or coffee?", "choices": "Tea\nCoffee"}) }), Ok(done)]
            } else {
                let last = req.messages.last().unwrap();
                let Block::ToolResult { content, .. } = &last.content[0] else { panic!("no tool result") };
                *self.1.lock().unwrap() = content.clone();
                vec![Ok(ark_llm::Event::Text { text: "Noted".into() }), Ok(done)]
            };
            Box::pin(async move { Ok(Box::pin(futures_util::stream::iter(items)) as EventStream) })
        }
    }

    #[test]
    fn ask_user_shows_a_card_and_the_answer_command_reaches_the_model() {
        let provider = Arc::new(AsksOnce(AtomicU64::new(0), Mutex::default()));
        let home = std::env::temp_dir();
        let tools = Tools { home: home.clone(), roots: vec![], cwd: home.clone() };
        let policy = FloorPolicy::new(&["current_time"], &home, vec![], &home);
        let chat = Arc::new(Chat::new(scratch("ask"), provider.clone(), Arc::new(RuntimeTools(tools)), Arc::new(policy), "m"));
        chat.observe("{\"type\":\"chats\",\"chats\":[],\"current\":\"c1\"}\n");
        let (app, app_rx) = sinks();
        let (node, node_rx) = sinks();
        assert!(chat.handle("{\"type\":\"text.send\",\"text\":\"coffee?\"}\n", app.clone(), node.clone()));
        let (turn, id) = loop {
            let v: Value = serde_json::from_str(&app_rx.recv_timeout(Duration::from_secs(5)).unwrap()).unwrap();
            if v["type"] == "chat.work" {
                break (v["turn"].as_str().unwrap().to_string(), v["questions"][0]["id"].as_str().unwrap().to_string());
            }
        };
        assert!(!chat.handle(&format!("{}\n", json!({"type": "chat.question.answer", "chat": "c1", "turn": turn, "id": "q-node", "text": "x"})), app.clone(), node.clone()), "a Node card goes to Node");
        assert!(chat.handle(&format!("{}\n", json!({"type": "chat.question.answer", "chat": "c1", "turn": turn, "id": id, "text": "Tea"})), app, node));
        node_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(provider.1.lock().unwrap().contains("\"userAnswer\":\"Tea\""));
        let kinds: Vec<Value> = app_rx.try_iter().map(|l| serde_json::from_str(&l).unwrap()).collect();
        assert!(kinds.iter().any(|v| v["type"] == "chat.work" && v["state"] == "completed"));
        assert!(kinds.iter().any(|v| v["type"] == "reply" && v["text"] == "Noted"));
    }

    #[test]
    fn a_cancel_declines_a_waiting_question() {
        let approvals = Approvals::default();
        let (tx, rx) = mpsc::channel();
        approvals.waiting.lock().unwrap().insert("rs-1".into(), Waiting { tx, summary: "s".into(), reason: "r".into() });
        approvals.decline_all();
        assert!(!rx.recv().unwrap());
        assert!(!approvals.answer("rs-1", true), "a closed question is ignored");
    }
}
