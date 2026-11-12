//! The local HTTP API in Rust (ADR-278 Phase 2): the same envelope, token, Host check and lockout as `apps/mac/src/api-server.ts`.
//! Plain HTTP/1.1 on `std::net`, one thread per connection, `Connection: close` (no new crate). It serves the routes Rust
//! can answer now: `POST /v1/chat`, `GET /v1/noah/chats` and `GET /v1/noah/chats/:id`. The other Node routes answer 501.
//! It logs method, route pattern and status, never a body.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::chat::Chat;
use crate::store;

pub const DEFAULT_PORT: u16 = 4790;
const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_HEAD_BYTES: usize = 16 * 1024;
const MAX_WRONG_TOKENS: usize = 10;
const LOCK_WINDOW: Duration = Duration::from_secs(60);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// Routes that Node serves and Rust does not yet.
const NODE_ONLY: &[&str] = &["goals", "tasks", "memories", "brain", "audit", "needs", "hooks"];

/// The status code and message of a refused request.
pub type ApiError = (u16, String);

/// What the API needs from ARK: one chat turn.
pub trait Backend: Send + Sync {
    fn chat(&self, text: &str, chat_id: Option<&str>) -> Result<String, ApiError>;
}

/// The agent loop as a backend. The chat id `x` is stored as `api-x`, and no id as `api` (as in Node).
pub struct ChatBackend(pub Arc<Chat>);

impl Backend for ChatBackend {
    fn chat(&self, text: &str, chat_id: Option<&str>) -> Result<String, ApiError> {
        let id = chat_id.map_or_else(|| "api".to_string(), |c| format!("api-{c}"));
        self.0.ask_in(&id, text)
    }
}

/// `data/api-token`: 64 hex digits. Made with 32 random bytes (mode 0600) when missing.
pub fn read_or_create_token(file: &Path) -> Result<String, String> {
    match std::fs::read_to_string(file) {
        Ok(text) => {
            let token = text.trim().to_string();
            if token.len() != 64 || !token.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
                return Err(format!("{} does not hold a valid token. Delete it, and ARK makes a new one.", file.display()));
            }
            Ok(token)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            use std::os::unix::fs::OpenOptionsExt;
            let mut bytes = [0u8; 32];
            std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).map_err(|e| e.to_string())?;
            let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            if let Some(dir) = file.parent() {
                std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            }
            let mut out = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(file).map_err(|e| e.to_string())?;
            writeln!(out, "{token}").map_err(|e| e.to_string())?;
            Ok(token)
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Equal without stopping at the first difference.
fn same(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    diff == 0
}

pub struct Request {
    pub method: String,
    pub path: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

pub struct Server {
    token: String,
    hosts: HashSet<String>,
    db: PathBuf,
    backend: Arc<dyn Backend>,
    wrong: Mutex<Vec<Instant>>,
}

impl Server {
    /// `extra_host`: the one private name allowed besides this machine's (`ARK_API_HOST`).
    pub fn new(token: String, extra_host: Option<&str>, db: PathBuf, backend: Arc<dyn Backend>) -> Arc<Server> {
        let mut hosts: HashSet<String> = ["127.0.0.1", "localhost"].iter().map(|s| s.to_string()).collect();
        hosts.extend(extra_host.map(|h| h.trim().to_lowercase()).filter(|h| !h.is_empty()));
        Arc::new(Server { token, hosts, db, backend, wrong: Mutex::default() })
    }

    /// Serves until the process ends. Each connection has its own thread.
    pub fn serve(self: &Arc<Self>, listener: TcpListener) {
        for stream in listener.incoming().flatten() {
            let me = Arc::clone(self);
            std::thread::spawn(move || me.connection(stream));
        }
    }

    /// Like `serve`, but returns when `stop` is set (checked every 50 ms). The listener is dropped then, so the port is free again.
    pub fn serve_until(self: &Arc<Self>, listener: TcpListener, stop: &std::sync::atomic::AtomicBool) {
        use std::sync::atomic::Ordering;
        if listener.set_nonblocking(true).is_err() {
            return;
        }
        while !stop.load(Ordering::SeqCst) {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).ok();
                    let me = Arc::clone(self);
                    std::thread::spawn(move || me.connection(stream));
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => std::thread::sleep(Duration::from_millis(50)),
            }
        }
    }

    fn locked(&self) -> bool {
        let Ok(mut wrong) = self.wrong.lock() else { return true };
        wrong.retain(|t| t.elapsed() < LOCK_WINDOW);
        wrong.len() >= MAX_WRONG_TOKENS
    }

    fn connection(&self, mut stream: TcpStream) {
        stream.set_read_timeout(Some(REQUEST_TIMEOUT)).ok();
        let (status, body) = match read_request(&mut stream) {
            Ok(request) => self.handle(&request),
            Err(refusal) => refusal,
        };
        let text = envelope(status, &body);
        let head = format!("HTTP/1.1 {status} X\r\ncontent-type: application/json; charset=utf-8\r\ncache-control: no-store\r\nx-content-type-options: nosniff\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", text.len());
        stream.write_all(head.as_bytes()).and_then(|()| stream.write_all(text.as_bytes())).ok();
    }

    /// The answer to one request: the status and the data (a string is an error message).
    pub fn handle(&self, req: &Request) -> (u16, Value) {
        let host = req.headers.get("host").map(|h| h.trim().to_lowercase()).and_then(|h| h.split(':').next().map(String::from)).unwrap_or_default();
        if !self.hosts.contains(&host) {
            return (403, json!("This address is not allowed. Use 127.0.0.1, or the name in ARK_API_HOST."));
        }
        if self.locked() {
            return (429, json!("Too many wrong tokens. Wait a minute."));
        }
        let given = req.headers.get("authorization").and_then(|h| h.strip_prefix("Bearer ")).map_or("", str::trim);
        if !same(given, &self.token) {
            // Only a request with an Authorization header is a guess at the token (a plain page request cannot lock the owner out).
            if req.headers.contains_key("authorization")
                && let Ok(mut wrong) = self.wrong.lock()
            {
                wrong.push(Instant::now());
            }
            return (401, json!("A valid token is needed: Authorization: Bearer <the token in data/api-token>."));
        }
        let path = req.path.split('?').next().unwrap_or("");
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        match (req.method.as_str(), parts.as_slice()) {
            ("POST", ["v1", "chat"]) => self.chat(&req.body),
            ("GET", ["v1", "noah", "chats"]) => self.chats().map_or_else(|e| e, |data| (200, data)),
            ("GET", ["v1", "noah", "chats", id]) if valid_chat_id(id) => self.chat_messages(id).map_or_else(|e| e, |data| (200, data)),
            (_, ["v1", name, ..]) if NODE_ONLY.contains(name) => (501, json!("The Rust runtime does not serve this endpoint yet.")),
            _ => (404, json!("There is no such endpoint.")),
        }
    }

    fn chat(&self, body: &[u8]) -> (u16, Value) {
        let Ok(Value::Object(body)) = serde_json::from_slice::<Value>(if body.is_empty() { b"{}" } else { body }) else {
            return (400, json!("The body must be a JSON object."));
        };
        let Some(text) = body.get("text").and_then(Value::as_str).map(str::trim).filter(|t| !t.is_empty()) else {
            return (400, json!("\"text\" must be text that is not empty."));
        };
        let chat_id = match body.get("chatId") {
            None => None,
            Some(Value::String(id)) if valid_chat_id(id) => {
                if id.to_lowercase().starts_with("goal-") {
                    return (400, json!("\"chatId\" must not start with \"goal-\": goals have those chats."));
                }
                Some(id.as_str())
            }
            Some(_) => return (400, json!("\"chatId\" must be 1 to 40 letters, digits, \"-\" or \"_\".")),
        };
        if let Some(id) = chat_id
            && self.archived(&format!("api-{id}"))
        {
            return (409, json!("This chat is archived in ARK. Unarchive it there before continuing."));
        }
        match self.backend.chat(text, chat_id) {
            Ok(answer) => (200, json!({ "answer": answer })),
            Err((status, message)) => (status, json!(message)),
        }
    }

    fn archived(&self, id: &str) -> bool {
        store::open_read_write(&self.db)
            .ok()
            .and_then(|c| c.query_row("SELECT archived FROM chats WHERE id = ?", [id], |r| r.get::<_, i64>(0)).ok())
            .is_some_and(|a| a != 0)
    }

    fn chats(&self) -> Result<Value, (u16, Value)> {
        let unavailable = || (503, json!("ARK chat history is unavailable."));
        let conn = store::open_read_write(&self.db).map_err(|_| unavailable())?;
        let mut stmt = conn.prepare("SELECT id, title, updated_at FROM chats WHERE archived = 0 AND id NOT LIKE 'api-goal-%' ORDER BY updated_at DESC, rowid DESC LIMIT 500").map_err(|_| unavailable())?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(|_| unavailable())?;
        let chats: Vec<Value> = rows
            .flatten()
            .map(|(id, title, at)| match id.strip_prefix("api-") {
                Some(rest) => json!({ "id": rest, "title": title, "updatedAt": at, "origin": "noah" }),
                None => json!({ "id": id, "title": title, "updatedAt": at, "origin": "ark" }),
            })
            .collect();
        Ok(json!({ "chats": chats }))
    }

    fn chat_messages(&self, id: &str) -> Result<Value, (u16, Value)> {
        let gone = || (404, json!("This chat is unavailable or archived in ARK."));
        if id.to_lowercase().starts_with("goal-") {
            return Err(gone());
        }
        let stored = if id.starts_with("noah-") { format!("api-{id}") } else { id.to_string() };
        let conn = store::open_read_write(&self.db).map_err(|_| (503, json!("ARK chat history is unavailable.")))?;
        match conn.query_row("SELECT archived FROM chats WHERE id = ?", [&stored], |r| r.get::<_, i64>(0)) {
            Ok(0) => {}
            _ => return Err(gone()),
        }
        let mut stmt = conn.prepare("SELECT role, content FROM (SELECT seq, role, content FROM chat_messages WHERE chat_id = ? ORDER BY seq DESC LIMIT 60) ORDER BY seq").map_err(|_| gone())?;
        let messages: Vec<Value> = stmt.query_map([&stored], |r| Ok(json!({ "role": r.get::<_, String>(0)?, "content": r.get::<_, String>(1)? }))).map_err(|_| gone())?.flatten().collect();
        Ok(json!({ "origin": if id.starts_with("noah-") { "noah" } else { "ark" }, "messages": messages }))
    }
}

fn valid_chat_id(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn envelope(status: u16, data: &Value) -> String {
    if status == 200 { json!({ "ok": true, "data": data, "error": null }) } else { json!({ "ok": false, "data": null, "error": data }) }.to_string()
}

/// Reads one request. `Err` is the refusal to send (400 or 413).
fn read_request(stream: &mut TcpStream) -> Result<Request, (u16, Value)> {
    let bad = |m: &str| (400, json!(m));
    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(i) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            break i;
        }
        if buf.len() > MAX_HEAD_BYTES {
            return Err(bad("That is not a valid request."));
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Err(bad("That is not a valid request.")),
            Ok(n) => buf.extend_from_slice(&chunk[..n]),
        }
    };
    let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or("").split(' ');
    let (method, path) = (first.next().unwrap_or("").to_string(), first.next().unwrap_or("").to_string());
    if method.is_empty() || !path.starts_with('/') {
        return Err(bad("That is not a valid address."));
    }
    let headers: HashMap<String, String> = lines.filter_map(|l| l.split_once(':')).map(|(k, v)| (k.trim().to_lowercase(), v.trim().to_string())).collect();
    let length: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if length > MAX_BODY_BYTES {
        return Err((413, json!("The body is larger than 64 KB.")));
    }
    let mut body = buf[head_end + 4..].to_vec();
    while body.len() < length {
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return Err(bad("The body is incomplete.")),
            Ok(n) => body.extend_from_slice(&chunk[..n]),
        }
    }
    body.truncate(length);
    Ok(Request { method, path, headers, body })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    struct Echo;
    impl Backend for Echo {
        fn chat(&self, text: &str, chat_id: Option<&str>) -> Result<String, ApiError> {
            if text == "boom" { Err((502, "ARK could not answer: x".into())) } else { Ok(format!("{text} in {}", chat_id.unwrap_or("-"))) }
        }
    }

    const TOKEN: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn start(name: &str) -> (String, PathBuf) {
        let db = std::env::temp_dir().join(format!("ark-api-{name}-{}.db", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", db.display())).ok();
        }
        Connection::open(&db)
            .unwrap()
            .execute_batch(
                "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_id TEXT, archived INTEGER NOT NULL DEFAULT 0);
                 CREATE TABLE chat_messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, PRIMARY KEY (chat_id, seq));
                 INSERT INTO chats VALUES ('c1', 'Hello', 'a', '2026-01-02T00:00:00.000Z', NULL, 0), ('api-noah-9', 'Noah', 'a', '2026-01-03T00:00:00.000Z', NULL, 0),
                   ('api-goal-1', 'Goal', 'a', '2026-01-04T00:00:00.000Z', NULL, 0), ('old', 'Old', 'a', '2026-01-01T00:00:00.000Z', NULL, 1), ('api-arch', 'Arch', 'a', 'a', NULL, 1);
                 INSERT INTO chat_messages VALUES ('c1', 0, 'user', 'hi'), ('c1', 1, 'assistant', 'hello'), ('api-noah-9', 0, 'user', 'q');",
            )
            .unwrap();
        let server = Server::new(TOKEN.into(), Some("Mini.lan"), db.clone(), Arc::new(Echo));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        std::thread::spawn(move || server.serve(listener));
        (addr, db)
    }

    /// One raw request; gives the status and the parsed JSON body.
    fn call(addr: &str, method: &str, path: &str, host: &str, token: Option<&str>, body: &str) -> (u16, Value) {
        let auth = token.map_or(String::new(), |t| format!("Authorization: Bearer {t}\r\n"));
        let mut s = TcpStream::connect(addr).unwrap();
        write!(s, "{method} {path} HTTP/1.1\r\nHost: {host}\r\n{auth}Content-Length: {}\r\n\r\n{body}", body.len()).ok();
        s.flush().ok();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        let status = raw.split(' ').nth(1).unwrap().parse().unwrap();
        (status, serde_json::from_str(raw.split("\r\n\r\n").nth(1).unwrap()).unwrap())
    }

    #[test]
    fn auth_host_and_routes_follow_the_node_server() {
        let (addr, _) = start("routes");
        let ok = |m: &str, p: &str, b: &str| call(&addr, m, p, "127.0.0.1:4790", Some(TOKEN), b);
        assert_eq!(call(&addr, "GET", "/v1/noah/chats", "127.0.0.1", None, "").0, 401);
        assert_eq!(call(&addr, "GET", "/v1/noah/chats", "evil.example", Some(TOKEN), "").0, 403, "DNS rebinding name");
        assert_eq!(call(&addr, "GET", "/v1/noah/chats", "mini.lan:4790", Some(TOKEN), "").0, 200, "the private name in ARK_API_HOST");
        let (status, body) = ok("POST", "/v1/chat", r#"{"text":" hi ","chatId":"abc"}"#);
        assert_eq!((status, body["ok"].clone(), body["data"]["answer"].clone()), (200, json!(true), json!("hi in abc")));
        assert_eq!(ok("POST", "/v1/chat", r#"{"text":"hi"}"#).1["data"]["answer"], "hi in -");
        for bad in [r#"{"text":""}"#, "[1]", "nope", r#"{"text":"x","chatId":"bad id"}"#, r#"{"text":"x","chatId":"goal-1"}"#] {
            assert_eq!(ok("POST", "/v1/chat", bad).0, 400, "{bad}");
        }
        assert_eq!(ok("POST", "/v1/chat", r#"{"text":"x","chatId":"arch"}"#).0, 409, "archived");
        let (status, body) = ok("POST", "/v1/chat", r#"{"text":"boom"}"#);
        assert_eq!((status, body["ok"].clone(), body["data"].clone()), (502, json!(false), Value::Null));
        let chats = ok("GET", "/v1/noah/chats", "").1["data"]["chats"].clone();
        assert_eq!(chats, json!([{"id": "noah-9", "title": "Noah", "updatedAt": "2026-01-03T00:00:00.000Z", "origin": "noah"}, {"id": "c1", "title": "Hello", "updatedAt": "2026-01-02T00:00:00.000Z", "origin": "ark"}]));
        assert_eq!(ok("GET", "/v1/noah/chats/c1", "").1["data"], json!({"origin": "ark", "messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}]}));
        assert_eq!(ok("GET", "/v1/noah/chats/noah-9", "").1["data"]["origin"], "noah");
        for gone in ["old", "goal-1", "missing"] {
            assert_eq!(ok("GET", &format!("/v1/noah/chats/{gone}"), "").0, 404, "{gone}");
        }
        assert_eq!(ok("GET", "/v1/tasks", "").0, 501);
        assert_eq!(ok("GET", "/v1/nothing", "").0, 404);
        // A body that is announced as too large is refused before it is read.
        let mut s = TcpStream::connect(&addr).unwrap();
        write!(s, "POST /v1/chat HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer {TOKEN}\r\nContent-Length: 70000\r\n\r\n").unwrap();
        let mut raw = String::new();
        s.read_to_string(&mut raw).unwrap();
        assert!(raw.starts_with("HTTP/1.1 413"), "{raw}");
    }

    #[test]
    fn ten_wrong_tokens_lock_the_api_but_a_page_without_a_header_does_not() {
        let (addr, _) = start("lock");
        for _ in 0..20 {
            assert_eq!(call(&addr, "GET", "/v1/noah/chats", "127.0.0.1", None, "").0, 401);
        }
        assert_eq!(call(&addr, "GET", "/v1/noah/chats", "127.0.0.1", Some(TOKEN), "").0, 200, "no lockout from header-less requests");
        for _ in 0..10 {
            assert_eq!(call(&addr, "GET", "/v1/noah/chats", "127.0.0.1", Some("wrong"), "").0, 401);
        }
        assert_eq!(call(&addr, "GET", "/v1/noah/chats", "127.0.0.1", Some(TOKEN), "").0, 429, "locked, even for the right token");
    }

    #[test]
    fn the_token_file_is_made_once_with_mode_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("ark-api-token-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let file = dir.join("data/api-token");
        let token = read_or_create_token(&file).unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(read_or_create_token(&file).unwrap(), token);
        assert_eq!(std::fs::metadata(&file).unwrap().permissions().mode() & 0o777, 0o600);
        std::fs::write(&file, "short").unwrap();
        assert!(read_or_create_token(&file).is_err());
        assert!(same("abc", "abc") && !same("abc", "abd") && !same("abc", "ab"));
    }
}
