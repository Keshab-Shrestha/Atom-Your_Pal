#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tests the Telegram channel against a local mock Bot API server. No network, no real token.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ark_telegram::{Button, Config, Input, Telegram};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

type Calls = Arc<Mutex<Vec<(String, Value)>>>;

/// A mock server: each request goes to `handler(method, call_number_of_that_method, body)` and gets `(status, json)`.
async fn mock(handler: impl Fn(&str, usize, &Value) -> (u16, Value) + Send + Sync + 'static) -> (String, Calls) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let calls: Calls = Arc::default();
    let (calls2, handler) = (calls.clone(), Arc::new(handler));
    tokio::spawn(async move {
        loop {
            let (mut sock, _) = listener.accept().await.unwrap();
            let (calls, handler) = (calls2.clone(), handler.clone());
            tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                let (path, body) = loop {
                    let n = sock.read(&mut chunk).await.unwrap_or(0);
                    buf.extend_from_slice(&chunk[..n]);
                    let text = String::from_utf8_lossy(&buf).to_string();
                    if let Some(i) = text.find("\r\n\r\n") {
                        let len = text[..i].to_lowercase().split("content-length: ").nth(1).and_then(|s| s.split("\r\n").next()?.trim().parse::<usize>().ok()).unwrap_or(0);
                        if buf.len() >= i + 4 + len || n == 0 {
                            break (text.split(' ').nth(1).unwrap_or("").to_string(), text[i + 4..].to_string());
                        }
                    } else if n == 0 {
                        return;
                    }
                };
                let method = path.rsplit('/').next().unwrap_or("").to_string();
                let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                let (status, reply) = {
                    let mut c = calls.lock().unwrap();
                    let nth = c.iter().filter(|(m, _)| *m == method).count();
                    c.push((method.to_string(), body.clone()));
                    handler(&method, nth, &body)
                };
                let text = reply.to_string();
                let head = format!("HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", text.len());
                sock.write_all(head.as_bytes()).await.ok();
                sock.write_all(text.as_bytes()).await.ok();
            });
        }
    });
    (url, calls)
}

fn cfg(url: &str) -> Config {
    let mut c = Config::new("SECRET-TOKEN", "100");
    c.base_url = url.into();
    c.retry_delays = vec![Duration::from_millis(1); 3];
    c.first_backoff = Duration::from_millis(5);
    c.stuck_backoff = Duration::from_millis(30);
    c.poll_seconds = 0;
    c
}

fn text(update_id: i64, chat: i64, from: i64, t: &str) -> Value {
    json!({"update_id": update_id, "message": {"chat": {"id": chat}, "from": {"id": from}, "text": t}})
}

fn ok(v: Value) -> (u16, Value) {
    (200, json!({"ok": true, "result": v}))
}

async fn wait_for(what: &str, f: impl Fn() -> bool) {
    for _ in 0..400 {
        if f() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("timed out waiting for {what}");
}

#[tokio::test]
async fn skips_the_backlog_then_serves_only_the_one_person() {
    let (url, calls) = mock(|method, n, _| match (method, n) {
        ("getUpdates", 0) => ok(json!([text(1, 100, 100, "old command"), text(2, 100, 100, "older")])),
        ("getUpdates", 1) => ok(json!([])),
        ("getUpdates", 2) => ok(json!([
            text(3, 100, 100, "hello"),
            text(4, 999, 999, "stranger chat"),
            text(5, 100, 555, "other member"),
            json!({"update_id": 6, "callback_query": {"id": "q1", "from": {"id": 100}, "data": "allow:1", "message": {"chat": {"id": 100}}}}),
        ])),
        _ => ok(json!([])),
    })
    .await;
    let inputs = Arc::new(Mutex::new(Vec::new()));
    let backlog = Arc::new(Mutex::new(0usize));
    let (i2, b2) = (inputs.clone(), backlog.clone());
    let mut c = cfg(&url);
    c.on_backlog = Some(Arc::new(move |n| *b2.lock().unwrap() = n));
    let tg = Telegram::start(c, move |i| i2.lock().unwrap().push(i));
    wait_for("two inputs", || inputs.lock().unwrap().len() >= 2).await;
    tg.stop();
    assert_eq!(*inputs.lock().unwrap(), vec![Input::Text("hello".into()), Input::Button { data: "allow:1".into(), query_id: "q1".into() }]);
    assert_eq!(*backlog.lock().unwrap(), 2);
    // The offset moves past every update, including the ignored ones.
    let calls = calls.lock().unwrap();
    let offsets: Vec<i64> = calls.iter().filter(|(m, _)| m == "getUpdates").map(|(_, b)| b["offset"].as_i64().unwrap()).collect();
    assert_eq!(&offsets[..4], &[0, 3, 3, 7]);
}

#[tokio::test]
async fn sends_long_text_in_parts_with_buttons_on_the_last() {
    let (url, calls) = mock(|m, _, _| if m == "getUpdates" { ok(json!([])) } else { ok(json!({})) }).await;
    let tg = Telegram::start(cfg(&url), |_| {});
    let long = format!("{}\n{}", "a".repeat(3000), "b".repeat(3000));
    let buttons = vec![vec![Button { text: "Allow".into(), data: "allow:1".into() }]];
    assert!(tg.send(&long, &buttons).await);
    tg.stop();
    let calls = calls.lock().unwrap();
    let sends: Vec<&Value> = calls.iter().filter(|(m, _)| m == "sendMessage").map(|(_, b)| b).collect();
    assert_eq!(sends.len(), 2);
    assert!(sends[0].get("reply_markup").is_none());
    assert_eq!(sends[1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"], "allow:1");
    assert_eq!(sends[0]["chat_id"], "100");
}

#[tokio::test]
async fn retries_a_server_error_but_not_a_client_error() {
    let (url, calls) = mock(|m, n, body| match m {
        "getUpdates" => ok(json!([])),
        "sendMessage" if body["text"] == "flaky" && n < 2 => (500, json!({"ok": false, "error_code": 500})),
        "sendMessage" if body["text"] == "blocked" => (403, json!({"ok": false, "error_code": 403, "description": "bot was blocked"})),
        _ => ok(json!({})),
    })
    .await;
    let tg = Telegram::start(cfg(&url), |_| {});
    assert!(tg.send("flaky", &[]).await);
    let count = |calls: &Calls| calls.lock().unwrap().iter().filter(|(m, _)| m == "sendMessage").count();
    assert_eq!(count(&calls), 3, "two failures, then one success");
    assert!(!tg.send("blocked", &[]).await);
    assert_eq!(count(&calls), 4, "a 403 is tried once");
    tg.stop();
}

#[tokio::test]
async fn a_wrong_token_waits_and_warns_once_without_leaking_the_token() {
    let (url, calls) = mock(|_, _, _| (401, json!({"ok": false, "error_code": 401, "description": "Unauthorized"}))).await;
    let logs = Arc::new(Mutex::new(Vec::<String>::new()));
    let l2 = logs.clone();
    let mut c = cfg(&url);
    c.log = Arc::new(move |name, detail| l2.lock().unwrap().push(format!("{name} {detail}")));
    let tg = Telegram::start(c, |_| {});
    wait_for("two polls", || calls.lock().unwrap().len() >= 2).await;
    tg.stop();
    let logs = logs.lock().unwrap();
    assert_eq!(logs.iter().filter(|l| l.starts_with("telegram.token_rejected")).count(), 1);
    assert!(logs.iter().all(|l| !l.contains("SECRET-TOKEN")));
}
