#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Tests the claude-bridge provider against a fake helper (a shell script). No Node, no `claude`, no network.
use std::path::PathBuf;

use ark_llm::bridge::ClaudeBridge;
use ark_llm::{Block, LlmError, Message, Provider, Request, collect};

fn fake(name: &str, body: &str) -> (PathBuf, PathBuf) {
    let dir = std::env::temp_dir().join(format!("ark-llm-bridge-{}-{name}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let script = dir.join("helper.sh");
    std::fs::write(&script, format!("#!/bin/sh\n{body}\n")).unwrap();
    (dir, script)
}

fn request(text: &str) -> Request {
    Request { model: "claude-test".into(), system: Some("be brief".into()), messages: vec![Message::user_text(text)], ..Default::default() }
}

#[tokio::test]
async fn streams_text_from_the_helper_and_sends_the_run_line() {
    // The helper writes the run line it got to a file, then answers.
    let (dir, script) = fake("ok", r#"echo '{"type":"ready"}'
read line
printf '%s' "$line" > "$(dirname "$0")/run.json"
echo '{"id":"1","type":"text","text":"Hel"}'
echo '{"id":"9","type":"text","text":"WRONG ID"}'
echo '{"id":"1","type":"thinking","text":"hm"}'
echo '{"id":"1","type":"text","text":"lo"}'
echo '{"id":"1","type":"done","stopReason":"end_turn","usage":{"input":5,"output":2}}'"#);
    let bridge = ClaudeBridge::new("sh", vec![script.to_string_lossy().into()]);
    let req = request("hi");
    let answer = collect(bridge.stream(&req).await.unwrap(), |_| {}).await.unwrap();
    assert_eq!(answer.content, vec![Block::Text { text: "Hello".into() }]);
    assert_eq!((answer.stop_reason.as_str(), answer.usage.input_tokens, answer.usage.output_tokens), ("end_turn", 5, 2));
    let sent: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("run.json")).unwrap()).unwrap();
    assert_eq!((sent["type"].as_str(), sent["prompt"].as_str(), sent["model"].as_str(), sent["system"].as_str()), (Some("run"), Some("hi"), Some("claude-test"), Some("be brief")));
}

#[tokio::test]
async fn helper_error_line_becomes_an_error() {
    let (_, script) = fake("err", r#"read line
echo '{"id":"1","type":"error","message":"Claude Code is using an API key"}'"#);
    let bridge = ClaudeBridge::new("sh", vec![script.to_string_lossy().into()]);
    let req = request("hi");
    let got = collect(bridge.stream(&req).await.unwrap(), |_| {}).await;
    assert!(matches!(got, Err(LlmError::Api { message, .. }) if message.contains("API key")));
}

#[tokio::test]
async fn helper_that_dies_and_a_missing_helper_both_fail() {
    let (_, script) = fake("die", "read line\nexit 3");
    let req = request("hi");
    let bridge = ClaudeBridge::new("sh", vec![script.to_string_lossy().into()]);
    assert!(matches!(collect(bridge.stream(&req).await.unwrap(), |_| {}).await, Err(LlmError::Protocol(_))));
    let missing = ClaudeBridge::new("/no/such/helper", vec![]);
    assert!(matches!(missing.stream(&req).await.err(), Some(LlmError::Http(_))));
}

#[test]
fn prompt_joins_earlier_turns_like_the_typescript_helper() {
    let msgs = vec![Message::user_text("a"), Message { role: "assistant".into(), content: vec![Block::Text { text: "b".into() }] }, Message::user_text("c")];
    assert_eq!(ark_llm::bridge::prompt_from(&msgs), "Conversation so far:\nUser: a\nARK: b\n\nThe user now says:\nc");
}

#[tokio::test]
async fn a_tool_call_parks_the_helper_and_the_result_resumes_the_same_run() {
    let (dir, script) = fake("tool", r#"echo '{"type":"ready"}'
read run
printf '%s' "$run" > "$(dirname "$0")/run.json"
echo '{"id":"1","type":"tool","callId":"t1","name":"current_time","input":{"timezone":"UTC"}}'
read result
printf '%s' "$result" > "$(dirname "$0")/result.json"
echo '{"id":"1","type":"text","text":"It is noon."}'
echo '{"id":"1","type":"done","stopReason":"end_turn","usage":{"input":3,"output":1}}'"#);
    let bridge = ClaudeBridge::new("sh", vec![script.to_string_lossy().into()]);
    let mut req = request("time?");
    req.tools = vec![ark_llm::ToolSpec { name: "current_time".into(), description: "d".into(), input_schema: serde_json::json!({"type": "object"}) }];
    let first = collect(bridge.stream(&req).await.unwrap(), |_| {}).await.unwrap();
    assert_eq!(first.stop_reason, "tool_use");
    assert_eq!(first.content, vec![Block::ToolUse { id: "t1".into(), name: "current_time".into(), input: serde_json::json!({"timezone": "UTC"}) }]);
    let sent: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("run.json")).unwrap()).unwrap();
    assert_eq!(sent["tools"][0]["name"], "current_time");
    assert!(sent["tools"][0].get("inputSchema").is_some());
    // The agent loop answers with the result; the same helper goes on.
    req.messages.push(Message { role: "assistant".into(), content: first.content });
    req.messages.push(Message { role: "user".into(), content: vec![Block::ToolResult { tool_use_id: "t1".into(), content: "12:00".into(), is_error: false }] });
    let second = collect(bridge.stream(&req).await.unwrap(), |_| {}).await.unwrap();
    assert_eq!(second.content, vec![Block::Text { text: "It is noon.".into() }]);
    assert_eq!(second.stop_reason, "end_turn");
    let got: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("result.json")).unwrap()).unwrap();
    assert_eq!((got["type"].as_str(), got["callId"].as_str(), got["content"].as_str(), got["isError"].as_bool()), (Some("tool_result"), Some("t1"), Some("12:00"), Some(false)));
}
