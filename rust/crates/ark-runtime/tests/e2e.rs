//! End to end: the app's Bridge -> the real `ark-runtime` binary (native chat) -> a mock Anthropic server on localhost.
//! Everything lives in a temp folder; the child program is `/bin/cat`, so no Node runs. No real key or network is used.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_app::bridge::{Bridge, Inbound};
use ark_protocol::{Command, Event};
use rusqlite::Connection;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

const WAIT: Duration = Duration::from_secs(20);

fn sse(events: &[(&str, Value)]) -> String {
    events.iter().map(|(kind, data)| format!("event: {kind}\ndata: {data}\n\n")).collect()
}

fn text_reply(parts: &[&str]) -> String {
    use serde_json::json;
    let mut ev = vec![("message_start", json!({"type": "message_start", "message": {"usage": {"input_tokens": 3}}})), ("content_block_start", json!({"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}))];
    for p in parts {
        ev.push(("content_block_delta", json!({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": p}})));
    }
    ev.push(("content_block_stop", json!({"type": "content_block_stop", "index": 0})));
    ev.push(("message_delta", json!({"type": "message_delta", "delta": {"stop_reason": "end_turn"}, "usage": {"output_tokens": 2}})));
    ev.push(("message_stop", json!({"type": "message_stop"})));
    sse(&ev)
}

fn tool_reply(name: &str, input: &Value) -> String {
    use serde_json::json;
    sse(&[
        ("message_start", json!({"type": "message_start", "message": {"usage": {"input_tokens": 3}}})),
        ("content_block_start", json!({"type": "content_block_start", "index": 0, "content_block": {"type": "tool_use", "id": "tu1", "name": name}})),
        ("content_block_delta", json!({"type": "content_block_delta", "index": 0, "delta": {"type": "input_json_delta", "partial_json": input.to_string()}})),
        ("content_block_stop", json!({"type": "content_block_stop", "index": 0})),
        ("message_delta", json!({"type": "message_delta", "delta": {"stop_reason": "tool_use"}, "usage": {"output_tokens": 5}})),
        ("message_stop", json!({"type": "message_stop"})),
    ])
}

/// A mock `POST /v1/messages`: with a tool result in the request it answers "Written."; else it calls `tool` if given, else says "Pong".
fn mock(tool: Option<(&'static str, Value)>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut raw = Vec::new();
            let mut chunk = [0u8; 4096];
            let (head_end, length) = loop {
                let n = s.read(&mut chunk).unwrap_or(0);
                raw.extend_from_slice(&chunk[..n]);
                if let Some(at) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&raw[..at]).to_lowercase();
                    let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
                    break (at + 4, len);
                }
                if n == 0 {
                    return;
                }
            };
            while raw.len() < head_end + length {
                let n = s.read(&mut chunk).unwrap_or(0);
                if n == 0 {
                    break;
                }
                raw.extend_from_slice(&chunk[..n]);
            }
            let body = String::from_utf8_lossy(&raw[head_end..]).into_owned();
            let reply = if body.contains("tool_result") {
                text_reply(&["Writ", "ten."])
            } else if let Some((name, input)) = &tool {
                tool_reply(name, input)
            } else {
                text_reply(&["Po", "ng"])
            };
            let head = format!("HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", reply.len());
            s.write_all(head.as_bytes()).and_then(|()| s.write_all(reply.as_bytes())).ok();
        }
    });
    port
}

struct Run {
    bridge: Bridge,
    dir: PathBuf,
    seen: Vec<Event>,
}

fn temp(name: &str) -> PathBuf {
    let dir = std::fs::canonicalize(std::env::temp_dir()).expect("tmp").join(format!("ark-e2e-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn start(name: &str, port: u16, actions: bool) -> Run {
    let dir = temp(name);
    let db = dir.join("mem.db");
    // A fixture file set (a chat database and its state file), never the owner's live data.
    let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
    std::fs::copy(format!("{fixtures}/chats-view.db"), &db).expect("fixture db");
    std::fs::copy(format!("{fixtures}/chats-view-state.json"), dir.join("ui-state.json")).expect("fixture state");
    let mut env = vec![
        ("ARK_RUNTIME_NATIVE_CHAT".to_owned(), "1".to_owned()),
        ("ANTHROPIC_API_KEY".to_owned(), "test-key-0123456789abcdef".to_owned()),
        ("ANTHROPIC_BASE_URL".to_owned(), format!("http://127.0.0.1:{port}")),
        ("HOME".to_owned(), dir.to_string_lossy().into_owned()),
        ("ARK_MEMORY_FILE".to_owned(), db.to_string_lossy().into_owned()),
    ];
    if actions {
        env.push(("ARK_NATIVE_ACTIONS".to_owned(), "1".to_owned()));
        env.push(("ARK_NATIVE_WRITE_ROOTS".to_owned(), dir.to_string_lossy().into_owned()));
    }
    let bridge = Bridge::spawn_with_env(env!("CARGO_BIN_EXE_ark-runtime"), &["/bin/cat".to_owned()], Some(&dir), &env, Arc::new(|| {})).expect("the runtime starts");
    Run { bridge, dir, seen: Vec::new() }
}

impl Run {
    /// Reads events until `done` says one is the one; returns it. Fails after `WAIT`.
    fn until(&mut self, what: &str, done: impl Fn(&Event) -> bool) -> Event {
        let end = Instant::now() + WAIT;
        loop {
            for m in self.bridge.drain() {
                if let Inbound::Event(e) = m {
                    let e = *e;
                    self.seen.push(e.clone());
                    if done(&e) {
                        return e;
                    }
                }
            }
            assert!(Instant::now() < end, "timed out waiting for {what}; saw {:?}", self.seen);
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// Node's `chats` event says which chat is open. With `/bin/cat` as the child, a line sent to it comes back as that event.
    fn open_chat(&mut self) {
        let fields = serde_json::json!({ "type": "chats", "chats": [], "current": "e2e-1" }).as_object().cloned().expect("object");
        self.bridge.send(&Command::Other { kind: "chats".into(), fields });
        self.until("the chats event echoed back", |e| matches!(e, Event::Other(m) if m.get("type").and_then(Value::as_str) == Some("chats")));
    }

    fn history(&self) -> Vec<(String, String)> {
        let conn = Connection::open(self.dir.join("mem.db")).expect("db");
        conn.prepare("SELECT role, content FROM chat_messages WHERE chat_id = 'e2e-1' ORDER BY seq").expect("prepare").query_map([], |r| Ok((r.get(0)?, r.get(1)?))).expect("query").map(Result::unwrap).collect()
    }
}

#[test]
fn a_text_send_streams_deltas_then_the_reply_and_is_saved() {
    let mut run = start("stream", mock(None), false);
    run.open_chat();
    run.bridge.send_text("Ping");
    run.until("turn.complete", |e| matches!(e, Event::TurnComplete { .. }));
    let kinds: Vec<&str> = run.seen.iter().filter_map(|e| match e {
        Event::ReplyDelta { .. } => Some("delta"),
        Event::Reply { .. } => Some("reply"),
        _ => None,
    }).collect();
    assert!(kinds.iter().filter(|k| **k == "delta").count() >= 1, "no reply.delta seen: {kinds:?}");
    assert_eq!(kinds.last(), Some(&"reply"), "the reply comes after the deltas: {kinds:?}");
    let streamed: String = run.seen.iter().filter_map(|e| if let Event::ReplyDelta { text } = e { Some(text.as_str()) } else { None }).collect();
    assert_eq!(streamed, "Pong");
    assert!(run.seen.iter().any(|e| matches!(e, Event::Reply { text } if text == "Pong")));
    assert_eq!(run.history(), [("user".to_owned(), "Ping".to_owned()), ("assistant".to_owned(), "Pong".to_owned())]);
}

#[test]
fn a_write_waits_for_the_approval_and_runs_after_yes() {
    let dir_hint = std::fs::canonicalize(std::env::temp_dir()).expect("tmp").join(format!("ark-e2e-approval-{}", std::process::id()));
    let target: &Path = &dir_hint.join("out.txt");
    let input = serde_json::json!({"path": target.to_string_lossy(), "content": "data"});
    let mut run = start("approval", mock(Some(("write_file", input))), true);
    assert_eq!(run.dir, dir_hint);
    run.open_chat();
    run.bridge.send_text("write it");
    let ask = run.until("the approval request", |e| matches!(e, Event::Other(m) if m.get("type").and_then(Value::as_str) == Some("approval.request")));
    let Event::Other(fields) = ask else { unreachable!() };
    assert!(!target.exists(), "nothing is written before the answer");
    let id = fields["id"].as_str().expect("approval id").to_owned();
    run.bridge.answer(&id, true, None);
    run.until("turn.complete", |e| matches!(e, Event::TurnComplete { .. }));
    assert_eq!(std::fs::read_to_string(target).expect("the file was written"), "data");
    assert!(run.seen.iter().any(|e| matches!(e, Event::Reply { text } if text == "Written.")));
    assert!(run.history().iter().any(|(role, text)| role == "assistant" && text == "Written."));
}
