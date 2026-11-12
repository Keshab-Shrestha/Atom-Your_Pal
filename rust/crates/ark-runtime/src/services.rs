//! Services the runtime owns when `ARK_RUNTIME=rust` runs with a native chat engine (ADR-278 Phase 2):
//! the local HTTP API (the `api.set` and `api.regenerate` commands) and the Telegram bot (`ARK_RUNTIME_TELEGRAM=1`).
//! The runtime tells Node about it with `ARK_API_OWNER=rust` and `ARK_TELEGRAM_OWNER=rust` in Node's environment,
//! so Node binds no port and polls no bot.

use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use ark_protocol::events::Event;
use ark_protocol::{Command, Parsed, parse_command};
use ark_telegram::Config;
use ark_telegram::bot::{Ask, Bot, BoxFut, Brain, Options};

use crate::api::{self, ChatBackend, DEFAULT_PORT, Server};
use crate::chat::Chat;

struct Running {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<()>,
}

/// The local API that the Settings switch turns on and off.
pub struct ApiHost {
    token_file: PathBuf,
    db: PathBuf,
    port: u16,
    host: Option<String>,
    chat: Arc<Chat>,
    running: Mutex<Option<Running>>,
}

impl ApiHost {
    /// `folder`: the ARK folder (the token is `data/api-token`). `port` and `host` follow `ARK_API_PORT` and `ARK_API_HOST`.
    pub fn new(folder: &std::path::Path, db: PathBuf, chat: Arc<Chat>, env: impl Fn(&str) -> Option<String>) -> ApiHost {
        let port = env("ARK_API_PORT").and_then(|p| p.trim().parse::<u16>().ok()).filter(|p| *p > 0).unwrap_or(DEFAULT_PORT);
        ApiHost { token_file: folder.join("data/api-token"), db, port, host: env("ARK_API_HOST"), chat, running: Mutex::new(None) }
    }

    fn status(&self, on: bool, error: Option<String>) -> String {
        Event::Api { on, port: self.port, token_file: "data/api-token".into(), error }.to_line()
    }

    fn start(&self) -> Result<(), String> {
        let token = api::read_or_create_token(&self.token_file)?;
        let listener = TcpListener::bind(("127.0.0.1", self.port)).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AddrInUse { format!("Port {} is in use. Set ARK_API_PORT in .env to another port, then restart ARK.", self.port) } else { e.to_string() }
        })?;
        let stop = Arc::new(AtomicBool::new(false));
        let server = Server::new(token, self.host.as_deref(), self.db.clone(), Arc::new(ChatBackend(Arc::clone(&self.chat))));
        let flag = Arc::clone(&stop);
        let thread = std::thread::spawn(move || server.serve_until(listener, &flag));
        *self.running.lock().map_err(|_| "lock poisoned".to_string())? = Some(Running { stop, thread });
        Ok(())
    }

    fn stop(&self) -> bool {
        let Some(run) = self.running.lock().ok().and_then(|mut r| r.take()) else { return false };
        run.stop.store(true, Ordering::SeqCst);
        // The port is free again when the accept loop has ended.
        run.thread.join().ok();
        true
    }

    fn is_on(&self) -> bool {
        self.running.lock().is_ok_and(|r| r.is_some())
    }

    /// The answer line for `api.set` or `api.regenerate`. `None` for any other line.
    pub fn handle(&self, line: &str) -> Option<String> {
        if !(line.contains("api.set") || line.contains("api.regenerate")) {
            return None;
        }
        let Parsed::Command(command) = parse_command(line) else { return None };
        match *command {
            Command::ApiSet { on: false } => {
                self.stop();
                Some(self.status(false, None))
            }
            Command::ApiSet { on: true } => {
                if self.is_on() {
                    return Some(self.status(true, None));
                }
                Some(match self.start() {
                    Ok(()) => self.status(true, None),
                    Err(e) => self.status(false, Some(e)),
                })
            }
            Command::ApiRegenerate => {
                let was_on = self.stop();
                let result = std::fs::remove_file(&self.token_file).or_else(|e| if e.kind() == std::io::ErrorKind::NotFound { Ok(()) } else { Err(e) }).map_err(|e| e.to_string());
                let result = result.and_then(|()| api::read_or_create_token(&self.token_file).map(|_| ()));
                let restarted = was_on && result.is_ok() && self.start().is_ok();
                Some(self.status(restarted, result.err()))
            }
            _ => None,
        }
    }
}

/// The bot's view of the runtime: a turn in the chat `telegram`, and the questions that wait.
pub struct TelegramBrain {
    pub chat: Arc<Chat>,
}

impl Brain for TelegramBrain {
    fn ask(&self, text: String) -> BoxFut<'_, Result<String, String>> {
        let chat = Arc::clone(&self.chat);
        Box::pin(async move {
            match tokio::task::spawn_blocking(move || chat.ask_telegram(&text)).await {
                Ok(result) => result.map_err(|(_, message)| message),
                Err(e) => Err(e.to_string()),
            }
        })
    }

    fn pending_asks(&self) -> Vec<Ask> {
        self.chat.pending_asks().into_iter().map(|(id, summary, reason)| Ask { id, summary, reason }).collect()
    }

    fn answer_ask(&self, id: &str, approved: bool) {
        self.chat.answer_ask(id, approved);
    }
}

/// Starts the bot on its own tokio runtime. Keep the returned value alive as long as the bot should run.
pub struct TelegramService {
    pub bot: Arc<Bot>,
    _runtime: tokio::runtime::Runtime,
}

impl TelegramService {
    pub fn start(cfg: Config, chat: Arc<Chat>) -> Option<TelegramService> {
        let runtime = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().ok()?;
        let _guard = runtime.enter();
        let (bot, _telegram) = Bot::start(cfg, Arc::new(TelegramBrain { chat: Arc::clone(&chat) }), Options::default());
        let for_change = Arc::clone(&bot);
        let handle = runtime.handle().clone();
        chat.set_on_change(Arc::new(move || {
            let bot = Arc::clone(&for_change);
            handle.spawn(async move { bot.asks_changed() });
        }));
        Some(TelegramService { bot, _runtime: runtime })
    }

    /// Handles `telegram.set` (the push switch). `true` when the line was taken.
    pub fn handle(&self, line: &str) -> bool {
        if !line.contains("telegram.set") {
            return false;
        }
        match parse_command(line) {
            Parsed::Command(c) => match *c {
                Command::TelegramSet { push } => {
                    self.bot.set_push(push);
                    true
                }
                _ => false,
            },
            _ => false,
        }
    }
}

/// What the runtime owns, as one handler for the command lines from the app.
pub struct Services {
    pub api: Option<ApiHost>,
    pub telegram: Option<TelegramService>,
}

impl Services {
    /// `None`: not ours, forward the line. `Some(None)`: taken. `Some(Some(line))`: taken, and the app gets `line`.
    pub fn handle(&self, line: &str) -> Option<Option<String>> {
        if let Some(reply) = self.api.as_ref().and_then(|a| a.handle(line)) {
            return Some(Some(reply));
        }
        self.telegram.as_ref().is_some_and(|t| t.handle(line)).then_some(None)
    }
}

/// The owners the runtime can take, from the environment (`ARK_RUNTIME=rust`, a chat engine, `ARK_RUNTIME_TELEGRAM=1`).
pub fn from_environment(folder: &std::path::Path, db: &std::path::Path, chat: Option<&Arc<Chat>>, env: impl Fn(&str) -> Option<String> + Copy) -> Option<Services> {
    let chat = chat.filter(|_| env("ARK_RUNTIME").as_deref() == Some("rust"))?;
    let telegram = (env("ARK_RUNTIME_TELEGRAM").as_deref() == Some("1")).then(Config::from_env).flatten().and_then(|cfg| TelegramService::start(cfg, Arc::clone(chat)));
    Some(Services { api: Some(ApiHost::new(folder, db.to_path_buf(), Arc::clone(chat), env)), telegram })
}

impl Services {
    /// The variables that tell Node to leave what the runtime owns.
    pub fn node_env(&self) -> Vec<(&'static str, &'static str)> {
        let mut vars = Vec::new();
        if self.api.is_some() {
            vars.push(("ARK_API_OWNER", "rust"));
        }
        if self.telegram.is_some() {
            vars.push(("ARK_TELEGRAM_OWNER", "rust"));
        }
        vars
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use ark_agent::{FloorPolicy, RuntimeTools, tools::Tools};
    use ark_llm::{EventStream, LlmError, Provider, Request, Usage};
    use futures_util::future::BoxFuture;
    use std::io::{Read, Write};

    struct Fixed;
    impl Provider for Fixed {
        fn stream<'a>(&'a self, _: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
            let items = vec![Ok(ark_llm::Event::Text { text: "Pong".into() }), Ok(ark_llm::Event::Done { stop_reason: "end_turn".into(), usage: Usage::default() })];
            Box::pin(async move { Ok(Box::pin(futures_util::stream::iter(items)) as ark_llm::EventStream) })
        }
    }

    fn folder(name: &str) -> PathBuf {
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("ark-services-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn chat(dir: &std::path::Path) -> Arc<Chat> {
        let db = dir.join("memory.db");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE chat_messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (chat_id, seq));",
        )
        .unwrap();
        let tools = Tools { home: dir.to_path_buf(), roots: vec![], cwd: dir.to_path_buf() };
        let policy = FloorPolicy::new(&["current_time"], dir, vec![], dir);
        Arc::new(Chat::new(db, Arc::new(Fixed), Arc::new(RuntimeTools(tools)), Arc::new(policy), "m"))
    }

    fn free_port() -> u16 {
        TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    fn get(port: u16, auth: Option<&str>) -> Option<String> {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port)).ok()?;
        let header = auth.map(|t| format!("Authorization: Bearer {t}\r\n")).unwrap_or_default();
        s.write_all(format!("GET /v1/noah/chats HTTP/1.1\r\nHost: 127.0.0.1\r\n{header}\r\n").as_bytes()).ok()?;
        let mut out = String::new();
        s.read_to_string(&mut out).ok()?;
        Some(out)
    }

    #[test]
    fn api_set_starts_and_stops_the_server_and_regenerate_changes_the_token() {
        let dir = folder("api");
        let port = free_port().to_string();
        let host = ApiHost::new(&dir, dir.join("memory.db"), chat(&dir), |n| (n == "ARK_API_PORT").then(|| port.clone()));
        let line = host.handle("{\"type\":\"api.set\",\"on\":true}\n").unwrap();
        assert!(line.contains("\"on\":true") && line.contains("data/api-token"), "{line}");
        let token = std::fs::read_to_string(dir.join("data/api-token")).unwrap();
        let token = token.trim();
        let port: u16 = port.parse().unwrap();
        assert!(get(port, None).unwrap().starts_with("HTTP/1.1 401"));
        assert!(get(port, Some(token)).unwrap().starts_with("HTTP/1.1 200"));
        let second = host.handle("{\"type\":\"api.regenerate\"}\n").unwrap();
        assert!(second.contains("\"on\":true"), "{second}");
        let fresh = std::fs::read_to_string(dir.join("data/api-token")).unwrap();
        assert_ne!(fresh.trim(), token);
        assert!(get(port, Some(fresh.trim())).unwrap().starts_with("HTTP/1.1 200"));
        assert!(get(port, Some(token)).unwrap().starts_with("HTTP/1.1 401"));
        assert!(host.handle("{\"type\":\"api.set\",\"on\":false}\n").unwrap().contains("\"on\":false"));
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(get(port, Some(fresh.trim())).is_none(), "the port is closed");
        assert!(host.handle("{\"type\":\"text.send\",\"text\":\"x\"}\n").is_none());
    }

    #[test]
    fn a_port_in_use_gives_an_error_status() {
        let dir = folder("busy");
        let taken = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = taken.local_addr().unwrap().port().to_string();
        let host = ApiHost::new(&dir, dir.join("memory.db"), chat(&dir), |n| (n == "ARK_API_PORT").then(|| port.clone()));
        let line = host.handle("{\"type\":\"api.set\",\"on\":true}\n").unwrap();
        assert!(line.contains("\"on\":false") && line.contains("is in use"), "{line}");
    }

    #[test]
    fn the_brain_runs_a_turn_in_the_telegram_chat_and_lists_no_questions() {
        let dir = folder("brain");
        let chat = chat(&dir);
        let brain = TelegramBrain { chat: Arc::clone(&chat) };
        let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        assert_eq!(runtime.block_on(brain.ask("Ping".into())).unwrap(), "Pong");
        let conn = rusqlite::Connection::open(dir.join("memory.db")).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM chat_messages WHERE chat_id = 'telegram'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
        assert!(brain.pending_asks().is_empty());
        assert!(!chat.answer_ask("rs-9", true));
    }
}
