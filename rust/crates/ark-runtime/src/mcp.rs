//! ARK as an MCP server over stdio (Phase 2 step 5; port of apps/mac/src/mcp-serve.ts). A thin client of the local HTTP
//! API: `handle` answers one JSON-RPC line; `Api` calls `http://127.0.0.1:<port>` with the bearer token from `data/api-token`.
//! The HTTP API itself stays in Node until the agent loop moves, because every route needs the loop.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use serde_json::{Value, json};

pub const DEFAULT_API_PORT: u16 = 4790;
/// An ARK turn can take minutes.
const CALL_TIMEOUT: Duration = Duration::from_secs(600);
const PROTOCOL_VERSION: &str = "2024-11-05";

/// `(name, description, properties, required, method, path template)`; `{key}` in a path is filled from the argument `key`.
type Tool = (&'static str, &'static str, Value, &'static [&'static str]);

fn tools() -> Vec<Tool> {
    vec![
        ("ark_give_goal", "Give a goal to ARK. ARK hands it to its team of workers, who work in the background. Returns goalId (null when ARK answered without handing it out) and ARK's answer.", json!({ "goal": { "type": "string", "description": "What to get done, in plain words" } }), &["goal"]),
        ("ark_goal_status", "A goal's status (running or ended), its tasks and, once it has ended, its combined report.", json!({ "goalId": { "type": "number", "description": "The goalId from ark_give_goal" } }), &["goalId"]),
        ("ark_chat", "Say one thing to ARK and get its answer. Turns with the same chatId continue one conversation.", json!({ "text": { "type": "string", "description": "What to say" }, "chatId": { "type": "string", "description": "Optional: 1 to 40 letters, digits, - or _ that name the conversation" } }), &["text"]),
        ("ark_list_tasks", "ARK's tasks, newest first. Optionally only those in one state.", json!({ "state": { "type": "string", "description": "Optional state", "enum": ["queued", "running", "done", "failed", "stopped"] } }), &[]),
        ("ark_task_report", "One task and its report (title, summary, body and sources), when it has one.", json!({ "taskId": { "type": "number", "description": "The task's number" } }), &["taskId"]),
        ("ark_needs_you", "What waits for the user's answer in ARK (questions, plans, proposals, held and failed tasks), with the actions each one takes. The user answers them in ARK or on Telegram.", json!({}), &[]),
        ("ark_answer_need", "Answer one thing that waits in ARK (see ark_needs_you). Give its key and one of its actions. Only plans (approve, reject) and retries can be answered here; every other card (a risky action, a skill, a soul change) is answered in the ARK window or on Telegram, and ark_needs_you marks it answerable: false.", json!({ "key": { "type": "string", "description": "The key from ark_needs_you" }, "action": { "type": "string", "description": "One of the actions listed for that key" } }), &["key", "action"]),
    ]
}

/// One HTTP call: `(method, path, body)` to `data`, or a message for the user.
pub trait Api {
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String>;
}

fn text(v: Option<&Value>) -> String {
    v.and_then(Value::as_str).unwrap_or_default().to_string()
}

/// Like `encodeURIComponent(String(v ?? ""))`.
fn enc(v: Option<&Value>) -> String {
    let s = match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(other) => other.to_string(),
    };
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

fn route(name: &str, a: &Value) -> Option<(&'static str, String, Option<Value>)> {
    let arg = |k: &str| a.get(k);
    Some(match name {
        "ark_give_goal" => ("POST", "/v1/goals".into(), Some(json!({ "goal": text(arg("goal")) }))),
        "ark_goal_status" => ("GET", format!("/v1/goals/{}", enc(arg("goalId"))), None),
        "ark_chat" => {
            let mut body = json!({ "text": text(arg("text")) });
            if let Some(chat) = arg("chatId").filter(|v| v.as_str().is_none_or(|s| !s.is_empty()) && !v.is_null()) {
                body["chatId"] = json!(text(Some(chat)));
            }
            ("POST", "/v1/chat".into(), Some(body))
        }
        "ark_list_tasks" => {
            let state = text(arg("state"));
            ("GET", if state.is_empty() { "/v1/tasks".into() } else { format!("/v1/tasks?state={}", enc(Some(&json!(state)))) }, None)
        }
        "ark_task_report" => ("GET", format!("/v1/tasks/{}", enc(arg("taskId"))), None),
        "ark_needs_you" => ("GET", "/v1/needs".into(), None),
        "ark_answer_need" => ("POST", format!("/v1/needs/{}", enc(arg("key"))), Some(json!({ "action": text(arg("action")) }))),
        _ => return None,
    })
}

fn reply(id: &Value, result: Value) -> String {
    format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn failure(id: &Value, code: i64, message: &str) -> String {
    format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
}

/// The answer line for one request line, or `None` for a notification (no answer) or a blank line.
pub fn handle(line: &str, api: &dyn Api) -> Option<String> {
    if line.trim().is_empty() {
        return None;
    }
    let Ok(request) = serde_json::from_str::<Value>(line) else { return Some(failure(&Value::Null, -32700, "Parse error")) };
    let id = request.get("id").cloned()?; // no id: a notification
    let params = request.get("params").cloned().unwrap_or(Value::Null);
    Some(match request.get("method").and_then(Value::as_str) {
        Some("initialize") => {
            let version = params.get("protocolVersion").and_then(Value::as_str).unwrap_or(PROTOCOL_VERSION);
            reply(&id, json!({ "protocolVersion": version, "capabilities": { "tools": {} }, "serverInfo": { "name": "ark", "version": "1.0.0" } }))
        }
        Some("ping") => reply(&id, json!({})),
        Some("tools/list") => {
            let list: Vec<Value> = tools()
                .into_iter()
                .map(|(name, description, properties, required)| {
                    let mut schema = json!({ "type": "object", "properties": properties });
                    if !required.is_empty() {
                        schema["required"] = json!(required);
                    }
                    json!({ "name": name, "description": description, "inputSchema": schema })
                })
                .collect();
            reply(&id, json!({ "tools": list }))
        }
        Some("tools/call") => {
            let name = text(params.get("name"));
            let arguments = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let result = match route(&name, &arguments) {
                None => Err(format!("There is no tool called {name}.")),
                Some((method, path, body)) => api.call(method, &path, body.as_ref()),
            };
            match result {
                Ok(data) => reply(&id, json!({ "content": [{ "type": "text", "text": serde_json::to_string_pretty(&data).unwrap_or_default() }] })),
                Err(message) => reply(&id, json!({ "isError": true, "content": [{ "type": "text", "text": message }] })),
            }
        }
        Some(other) => failure(&id, -32601, &format!("Method not found: {other}")),
        None => failure(&id, -32600, "Invalid Request"),
    })
}

/// The real client: plain HTTP/1.1 over a TCP socket to 127.0.0.1.
pub struct HttpApi {
    pub port: u16,
    pub token_file: std::path::PathBuf,
}

impl Api for HttpApi {
    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
        let token = std::fs::read_to_string(&self.token_file)
            .map_err(|_| format!("No token in {}. Turn on Settings → General → \"Local API\" in ARK first.", self.token_file.display()))?;
        let down = || format!("ARK does not answer at http://127.0.0.1:{}. Start ARK and turn on Settings → General → \"Local API\".", self.port);
        let mut stream = TcpStream::connect(("127.0.0.1", self.port)).map_err(|_| down())?;
        stream.set_read_timeout(Some(CALL_TIMEOUT)).ok();
        let payload = body.map(Value::to_string);
        let mut request = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nConnection: close\r\n", self.port, token.trim());
        if let Some(p) = &payload {
            request.push_str(&format!("Content-Type: application/json\r\nContent-Length: {}\r\n", p.len()));
        }
        request.push_str("\r\n");
        request.push_str(payload.as_deref().unwrap_or(""));
        stream.write_all(request.as_bytes()).map_err(|_| down())?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).map_err(|_| down())?;
        let (status, body) = split_response(&raw).ok_or_else(|| "ARK sent an answer that is not HTTP.".to_string())?;
        let json: Value = serde_json::from_slice(&body).unwrap_or_else(|_| json!({ "ok": false, "error": format!("ARK answered {status}.") }));
        if json.get("ok").and_then(Value::as_bool) != Some(true) {
            return Err(json.get("error").and_then(Value::as_str).map_or_else(|| format!("ARK answered {status}."), str::to_string));
        }
        Ok(json.get("data").cloned().unwrap_or(Value::Null))
    }
}

/// The status code and the body (chunked bodies are joined).
fn split_response(raw: &[u8]) -> Option<(u16, Vec<u8>)> {
    let at = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let head = String::from_utf8_lossy(&raw[..at]).into_owned();
    let status = head.lines().next()?.split_whitespace().nth(1)?.parse().ok()?;
    let body = &raw[at + 4..];
    if !head.to_lowercase().contains("transfer-encoding: chunked") {
        return Some((status, body.to_vec()));
    }
    let (mut out, mut rest) = (Vec::new(), body);
    loop {
        let eol = rest.windows(2).position(|w| w == b"\r\n")?;
        let size = usize::from_str_radix(String::from_utf8_lossy(&rest[..eol]).split(';').next()?.trim(), 16).ok()?;
        if size == 0 {
            return Some((status, out));
        }
        out.extend_from_slice(rest.get(eol + 2..eol + 2 + size)?);
        rest = rest.get(eol + 2 + size + 2..)?;
    }
}

/// The port and the token file for the process: `ARK_API_PORT` (then `ATOM_`, `ZENO_`) and `ARK_API_TOKEN_FILE`, else `<folder>/data/api-token`.
pub fn api_from_environment(folder: &Path, env: impl Fn(&str) -> Option<String>) -> HttpApi {
    let first = |names: [&str; 3]| names.iter().find_map(|n| env(n).filter(|v| !v.trim().is_empty()));
    let port = first(["ARK_API_PORT", "ATOM_API_PORT", "ZENO_API_PORT"]).and_then(|v| v.trim().parse().ok()).unwrap_or(DEFAULT_API_PORT);
    let token_file = env("ARK_API_TOKEN_FILE").filter(|v| !v.is_empty()).map_or_else(|| folder.join("data/api-token"), std::path::PathBuf::from);
    HttpApi { port, token_file }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    struct Fake(RefCell<Vec<(String, String, Option<Value>)>>);
    impl Api for Fake {
        fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
            self.0.borrow_mut().push((method.into(), path.into(), body.cloned()));
            if path.contains("boom") { Err("nope".into()) } else { Ok(json!({ "x": 1 })) }
        }
    }

    fn ask(api: &Fake, request: Value) -> Value {
        serde_json::from_str(&handle(&request.to_string(), api).unwrap()).unwrap()
    }

    #[test]
    fn lists_the_seven_tools_and_maps_calls_to_routes() {
        let api = Fake(RefCell::new(Vec::new()));
        let init = ask(&api, json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-03-26" } }));
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "ark");
        assert!(handle("{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}", &api).is_none());
        let list = ask(&api, json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }));
        let names: Vec<_> = list["result"]["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["ark_give_goal", "ark_goal_status", "ark_chat", "ark_list_tasks", "ark_task_report", "ark_needs_you", "ark_answer_need"]);
        let call = |name: &str, args: Value| ask(&api, json!({ "jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": { "name": name, "arguments": args } }));
        let ok = call("ark_chat", json!({ "text": "hi", "chatId": "c-1" }));
        assert_eq!(ok["result"]["content"][0]["text"], "{\n  \"x\": 1\n}");
        call("ark_list_tasks", json!({ "state": "running" }));
        call("ark_goal_status", json!({ "goalId": 7 }));
        call("ark_answer_need", json!({ "key": "plan/1 x", "action": "approve" }));
        assert_eq!(call("ark_nope", json!({}))["result"]["isError"], true);
        assert_eq!(call("ark_task_report", json!({ "taskId": "boom" }))["result"]["content"][0]["text"], "nope");
        let seen = api.0.borrow();
        assert_eq!(seen[0], ("POST".into(), "/v1/chat".into(), Some(json!({ "text": "hi", "chatId": "c-1" }))));
        assert_eq!(seen[1].1, "/v1/tasks?state=running");
        assert_eq!(seen[2].1, "/v1/goals/7");
        assert_eq!(seen[3], ("POST".into(), "/v1/needs/plan%2F1%20x".into(), Some(json!({ "action": "approve" }))));
        assert!(handle("garbage", &api).unwrap().contains("-32700"));
        assert!(ask(&api, json!({ "jsonrpc": "2.0", "id": 9, "method": "nope" }))["error"]["code"] == -32601);
    }

    #[test]
    fn the_http_client_sends_the_token_and_reads_chunked_and_plain_answers() {
        let dir = std::env::temp_dir().join(format!("ark-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tok"), "secret\n").unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let mut heads = Vec::new();
            for (i, answer) in [b"HTTP/1.1 200 OK\r\nContent-Length: 28\r\n\r\n{\"ok\":true,\"data\":{\"a\":[1]}}".to_vec(), b"HTTP/1.1 401 Unauthorized\r\nTransfer-Encoding: chunked\r\n\r\n11\r\n{\"ok\":false,\"erro\r\n10\r\nr\":\"Bad token.\"}\r\n0\r\n\r\n".to_vec()].into_iter().enumerate() {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut head = String::new();
                let mut length = 0;
                loop {
                    let mut l = String::new();
                    reader.read_line(&mut l).unwrap();
                    if l == "\r\n" { break; }
                    if let Some(v) = l.to_lowercase().strip_prefix("content-length:") { length = v.trim().parse().unwrap(); }
                    head.push_str(&l);
                }
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();
                heads.push((head, String::from_utf8(body).unwrap(), i));
                (&stream).write_all(&answer).unwrap();
            }
            heads
        });
        let api = HttpApi { port, token_file: dir.join("tok") };
        assert_eq!(api.call("POST", "/v1/chat", Some(&json!({ "text": "hi" }))).unwrap(), json!({ "a": [1] }));
        assert_eq!(api.call("GET", "/v1/needs", None).unwrap_err(), "Bad token.");
        let heads = server.join().unwrap();
        assert!(heads[0].0.starts_with("POST /v1/chat HTTP/1.1") && heads[0].0.contains("Authorization: Bearer secret"));
        assert_eq!(heads[0].1, "{\"text\":\"hi\"}");
        // No token file, and nothing listening.
        let missing = HttpApi { port, token_file: dir.join("none") };
        assert!(missing.call("GET", "/x", None).unwrap_err().starts_with("No token in"));
        assert!(api.call("GET", "/x", None).unwrap_err().contains("does not answer"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn port_and_token_file_follow_the_environment() {
        let folder = Path::new("/p");
        let none = api_from_environment(folder, |_| None);
        assert_eq!((none.port, none.token_file.as_path()), (4790, Path::new("/p/data/api-token")));
        let legacy = api_from_environment(folder, |n| (n == "ZENO_API_PORT").then(|| "5000".to_string()));
        assert_eq!(legacy.port, 5000);
    }
}
