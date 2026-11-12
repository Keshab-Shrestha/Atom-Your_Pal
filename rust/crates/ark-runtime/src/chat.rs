//! Native chat turns (ADR-278 Phase 2, step 1): `text.send` answered by `ark-agent` instead of Node.
//! Off unless `ARK_RUNTIME_NATIVE_CHAT=1`. Only plain text in a saved, writable, non-project chat that the app has
//! already opened is handled here; everything else (files, notes, `/skill`, a new unsaved chat, a shared chat, a
//! busy chat) goes to Node. The current chat comes from Node's own `chats` and `chat.opened` events.
//! The turn is appended to the same SQLite file Node uses (WAL, busy timeout, one `BEGIN IMMEDIATE`), and then Node
//! gets `chat.open` so its in-memory chat matches the file.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use ark_agent::{Agent, Policy, ToolRunner};
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
const SYSTEM: &str = "You are ARK, a personal assistant on the owner's Mac. Answer briefly and plainly.";

pub struct Chat {
    pub db: PathBuf,
    pub provider: Arc<dyn Provider>,
    pub tools: Arc<dyn ToolRunner>,
    pub policy: Arc<dyn Policy>,
    pub model: String,
    current: Mutex<Option<String>>,
    busy: AtomicBool,
}

/// Chats another surface writes: the window does not write them (see `chat-owner.ts`).
fn is_shared(id: &str) -> bool {
    id == "telegram" || id == "api" || id.starts_with("api-")
}

impl Chat {
    pub fn new(db: PathBuf, provider: Arc<dyn Provider>, tools: Arc<dyn ToolRunner>, policy: Arc<dyn Policy>, model: &str) -> Chat {
        Chat { db, provider, tools, policy, model: model.into(), current: Mutex::new(None), busy: AtomicBool::new(false) }
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

    /// Takes `line` when it is a plain `text.send` this runtime can answer. `false` means: give it to Node.
    pub fn handle(self: &Arc<Self>, line: &str, to_app: Sink, to_node: Sink) -> bool {
        let Parsed::Command(command) = parse_command(line) else { return false };
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
        matches!(row, Some((0, None)))
    }

    fn turn(&self, id: &str, text: &str, to_app: &Sink) {
        let emit = |event: Event| to_app(&event.to_line());
        emit(Event::Transcript { text: text.into() });
        emit(Event::State { state: LoopState::Thinking });
        let started = Instant::now();
        let result = self.answer(id, text);
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
    fn answer(&self, id: &str, text: &str) -> Result<String, String> {
        let conn = store::open_read_write(&self.db).map_err(|e| format!("The chat file could not be opened: {e}"))?;
        let saved = read_history(&conn, id).map_err(|e| format!("The chat could not be read: {e}"))?;
        let history = replay_window(&saved, text)?;
        let mut agent = Agent::new(self.provider.as_ref(), self.policy.as_ref(), self.tools.as_ref(), &self.model);
        agent.system = Some(SYSTEM.into());
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|e| e.to_string())?;
        let outcome = runtime.block_on(agent.run(history, text, |_| {})).map_err(|e| e.to_string())?;
        append_exchange(&conn, id, saved.len(), text, &outcome.text).map_err(|e| format!("The answer could not be saved: {e}"))?;
        Ok(outcome.text)
    }
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
        assert_eq!(kinds, ["transcript", "state", "reply", "state", "turn.complete"]);
        assert_eq!(types[2]["text"], "Pong");
        let rows = read_history(&Connection::open(&db).unwrap(), "c1").unwrap();
        assert_eq!(rows.len(), 4);
        assert_eq!(rows[2], ("user".into(), "Ping".into()));
        assert_eq!(rows[3], ("assistant".into(), "Pong".into()));
    }

    #[test]
    fn everything_else_goes_to_node() {
        let chat = chat(scratch("no"));
        let (app, _a) = sinks();
        let (node, _n) = sinks();
        let go = |line: &str| chat.handle(line, app.clone(), node.clone());
        assert!(!go("{\"type\":\"text.send\",\"text\":\"x\"}\n"), "no open chat yet");
        for current in ["old", "telegram", "api-5", "missing"] {
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
}
