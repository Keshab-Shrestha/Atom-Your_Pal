//! Tests the Anthropic client against a local mock HTTP server. No network, no real key.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::sync::{Arc, Mutex};

use ark_llm::anthropic::AnthropicClient;
use ark_llm::{Block, Event, LlmError, Message, Provider, Request, ToolSpec, collect};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Serves one canned response. Returns the base URL and the captured request (headers + body).
async fn mock(status: &str, content_type: &str, body: String) -> (String, Arc<Mutex<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let seen = Arc::new(Mutex::new(String::new()));
    let (seen2, status, ct) = (seen.clone(), status.to_string(), content_type.to_string());
    tokio::spawn(async move {
        let (mut sock, _) = listener.accept().await.unwrap();
        let mut buf = Vec::new();
        let mut chunk = [0u8; 4096];
        loop {
            let n = sock.read(&mut chunk).await.unwrap();
            buf.extend_from_slice(&chunk[..n]);
            let text = String::from_utf8_lossy(&buf).to_string();
            if let Some(i) = text.find("\r\n\r\n") {
                let len = text[..i].to_lowercase().split("content-length: ").nth(1).and_then(|s| s.split("\r\n").next()?.trim().parse::<usize>().ok()).unwrap_or(0);
                if buf.len() >= i + 4 + len || n == 0 {
                    break;
                }
            }
        }
        *seen2.lock().unwrap() = String::from_utf8_lossy(&buf).to_string();
        let head = format!("HTTP/1.1 {status}\r\ncontent-type: {ct}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", body.len());
        let (a, b) = body.as_bytes().split_at(body.len() / 2);
        sock.write_all(head.as_bytes()).await.unwrap();
        sock.write_all(a).await.unwrap(); // two writes: the client must join split chunks
        sock.flush().await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        sock.write_all(b).await.unwrap();
    });
    (url, seen)
}

fn sse(parts: &[(&str, &str)]) -> String {
    parts.iter().map(|(e, d)| format!("event: {e}\ndata: {d}\n\n")).collect()
}

fn request() -> Request {
    Request {
        model: "claude-test".into(),
        system: Some("be brief".into()),
        messages: vec![Message::user_text("hi")],
        tools: vec![ToolSpec { name: "current_time".into(), description: "time".into(), input_schema: serde_json::json!({"type":"object"}) }],
        max_tokens: 100,
    }
}

#[tokio::test]
async fn streams_text_and_tool_use() {
    let body = sse(&[
        ("message_start", r#"{"type":"message_start","message":{"usage":{"input_tokens":11,"output_tokens":1}}}"#),
        ("content_block_start", r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#),
        ("content_block_delta", r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}"#),
        ("ping", r#"{"type":"ping"}"#),
        ("content_block_delta", r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}"#),
        ("content_block_stop", r#"{"type":"content_block_stop","index":0}"#),
        ("content_block_start", r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"current_time","input":{}}}"#),
        ("content_block_delta", r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"timezone\":"}}"#),
        ("content_block_delta", r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\"Asia/Tokyo\"}"}}"#),
        ("content_block_stop", r#"{"type":"content_block_stop","index":1}"#),
        ("message_delta", r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":42}}"#),
        ("message_stop", r#"{"type":"message_stop"}"#),
    ]);
    let (url, seen) = mock("200 OK", "text/event-stream", body).await;
    let client = AnthropicClient::with_base_url("test-key", &url);
    let req = request();
    let stream = client.stream(&req).await.unwrap();
    let mut live = Vec::new();
    let answer = collect(stream, |e| live.push(e.clone())).await.unwrap();

    assert_eq!(live.iter().filter(|e| matches!(e, Event::Text { .. })).count(), 2);
    assert_eq!(answer.content, vec![
        Block::Text { text: "Hello".into() },
        Block::ToolUse { id: "tu_1".into(), name: "current_time".into(), input: serde_json::json!({"timezone":"Asia/Tokyo"}) },
    ]);
    assert_eq!(answer.stop_reason, "tool_use");
    assert_eq!((answer.usage.input_tokens, answer.usage.output_tokens), (11, 42));

    let sent = seen.lock().unwrap().to_lowercase();
    assert!(sent.contains("post /v1/messages"));
    assert!(sent.contains("x-api-key: test-key"));
    assert!(sent.contains("anthropic-version: 2023-06-01"));
    assert!(sent.contains(r#""stream":true"#) && sent.contains(r#""system":"be brief""#));
}

#[tokio::test]
async fn http_error_becomes_api_error() {
    let (url, _) = mock("401 Unauthorized", "application/json", r#"{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#.into()).await;
    let client = AnthropicClient::with_base_url("bad", &url);
    let req = request();
    match client.stream(&req).await {
        Err(LlmError::Api { status: 401, message }) => assert_eq!(message, "invalid x-api-key"),
        other => panic!("unexpected {:?}", other.err()),
    }
}

#[tokio::test]
async fn stream_error_event_and_truncation_fail() {
    let body = sse(&[("error", r#"{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}"#)]);
    let (url, _) = mock("200 OK", "text/event-stream", body).await;
    let req = request();
    let stream = AnthropicClient::with_base_url("k", &url).stream(&req).await.unwrap();
    assert!(matches!(collect(stream, |_| {}).await, Err(LlmError::Api { message, .. }) if message == "Overloaded"));

    let (url, _) = mock("200 OK", "text/event-stream", sse(&[("message_start", r#"{"message":{"usage":{"input_tokens":1}}}"#)])).await;
    let stream = AnthropicClient::with_base_url("k", &url).stream(&req).await.unwrap();
    assert!(matches!(collect(stream, |_| {}).await, Err(LlmError::Protocol(_))));
}
