//! The `claude-bridge` provider: Claude on the user's own subscription (plan section 5(a), ADR-055).
//! Rust starts the Node helper `services/llm-gateway/src/providers/claude-bridge.ts`. It speaks line-delimited JSON on
//! stdio and runs the Agent SDK, which starts the signed-in `claude` program. ARK never reads a login.
//! One helper process serves one request. It ends when its stdin closes.
//! Tools: the run line lists the request's tools. A tool call comes back as a `tool` line; the bridge gives it out as
//! `Event::ToolUse` plus `Done("tool_use")` and keeps the helper process parked. The agent loop checks the call with its
//! policy and calls `stream` again with the result. The bridge sends it to the parked helper as a `tool_result` line and
//! goes on reading the same run. Calls that come close together are one batch; the loop answers all of them in one message. One parked run per bridge: a new run drops an older one.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use futures_util::future::BoxFuture;
use futures_util::stream;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

use crate::{Block, Event, EventStream, LlmError, Provider, Request, Usage};

/// Helper environment names that could switch Claude Code to per-token billing. The helper scrubs them too (defence twice).
const SCRUBBED_PREFIXES: &[&str] = &["ANTHROPIC_"];

pub struct ClaudeBridge {
    /// The helper command, for example `node`.
    pub program: PathBuf,
    /// Its arguments, for example `["--disable-warning=ExperimentalWarning", "…/claude-bridge.ts"]`.
    pub args: Vec<String>,
    /// The `claude` program to run (the SDK finds one when this is `None`).
    pub claude_path: Option<String>,
    parked: Arc<Mutex<Option<Parked>>>,
}

/// A helper that waits for the result of a tool call.
struct Parked {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    carry: Option<String>,
}

impl ClaudeBridge {
    pub fn new(program: impl Into<PathBuf>, args: Vec<String>) -> Self {
        Self { program: program.into(), args, claude_path: None, parked: Arc::default() }
    }
}

/// The conversation as one prompt: earlier turns as a transcript, then the newest message (as `promptFrom` in plan-support.ts).
pub fn prompt_from(messages: &[crate::Message]) -> String {
    let text = |m: &crate::Message| {
        m.content.iter().filter_map(|b| if let Block::Text { text } = b { Some(text.as_str()) } else { None }).collect::<Vec<_>>().join("\n").trim().to_string()
    };
    let turns: Vec<(&str, String)> = messages.iter().map(|m| (m.role.as_str(), text(m))).filter(|(_, t)| !t.is_empty()).collect();
    let Some((_, last)) = turns.last() else { return String::new() };
    if turns.len() == 1 {
        return last.clone();
    }
    let earlier: Vec<String> = turns[..turns.len() - 1].iter().map(|(r, t)| format!("{}: {t}", if *r == "user" { "User" } else { "ARK" })).collect();
    format!("Conversation so far:\n{}\n\nThe user now says:\n{last}", earlier.join("\n"))
}

impl Provider for ClaudeBridge {
    fn stream<'a>(&'a self, req: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
        Box::pin(async move {
            let results: Vec<(&str, &str, bool)> = req
                .messages
                .last()
                .filter(|m| m.role == "user")
                .map(|m| m.content.iter().filter_map(|b| if let Block::ToolResult { tool_use_id, content, is_error } = b { Some((tool_use_id.as_str(), content.as_str(), *is_error)) } else { None }).collect())
                .unwrap_or_default();
            let parked = self.parked.lock().map_err(|_| LlmError::Protocol("bridge lock poisoned".into()))?.take();
            if let (Some(mut run), false) = (parked, results.is_empty()) {
                for (call_id, content, is_error) in results {
                    let line = format!("{}\n", json!({"type": "tool_result", "callId": call_id, "content": content, "isError": is_error}));
                    run.stdin.write_all(line.as_bytes()).await.map_err(|e| LlmError::Http(format!("helper stdin: {e}")))?;
                }
                run.stdin.flush().await.map_err(|e| LlmError::Http(e.to_string()))?;
                return Ok(events(run.child, run.stdin, run.lines, run.carry, "1", Arc::clone(&self.parked)));
            }
            let mut cmd = Command::new(&self.program);
            cmd.args(&self.args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
            for (key, _) in std::env::vars_os() {
                if SCRUBBED_PREFIXES.iter().any(|p| key.to_string_lossy().starts_with(p)) {
                    cmd.env_remove(key);
                }
            }
            let mut child = cmd.spawn().map_err(|e| LlmError::Http(format!("cannot start {}: {e}", self.program.display())))?;
            let (Some(mut stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
                return Err(LlmError::Protocol("helper has no stdio".into()));
            };
            let id = "1";
            let mut run = json!({"type": "run", "id": id, "prompt": prompt_from(&req.messages), "model": req.model});
            if let Some(system) = &req.system {
                run["system"] = json!(system);
            }
            if !req.tools.is_empty() {
                // The helper uses the TypeScript spelling `inputSchema`.
                run["tools"] = req.tools.iter().map(|t| json!({"name": t.name, "description": t.description, "inputSchema": t.input_schema})).collect();
            }
            if let Some(path) = &self.claude_path {
                run["claudePath"] = json!(path);
            }
            let line = format!("{run}\n");
            stdin.write_all(line.as_bytes()).await.map_err(|e| LlmError::Http(format!("helper stdin: {e}")))?;
            stdin.flush().await.map_err(|e| LlmError::Http(e.to_string()))?;
            Ok(events(child, stdin, BufReader::new(stdout).lines(), None, id, Arc::clone(&self.parked)))
        })
    }
}

/// How long the bridge waits after a `tool` line for more `tool` lines of the same model turn (parallel calls).
const BATCH_WINDOW: std::time::Duration = std::time::Duration::from_millis(100);

/// The run while its events are given out.
struct Live {
    child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    /// Events read but not yet given out (a batch of tool calls).
    queue: VecDeque<Event>,
    /// The queue holds tool calls: park the run when it is empty and give out `Done("tool_use")`.
    park: bool,
    /// A line read while a batch was collected that is not a tool call.
    carry: Option<String>,
}

fn tool_event(v: &Value) -> Event {
    Event::ToolUse { id: v["callId"].as_str().unwrap_or_default().to_string(), name: v["name"].as_str().unwrap_or_default().to_string(), input: v["input"].clone() }
}

/// The helper's lines as model events. `child` and `stdin` stay alive until the stream ends.
/// Tool calls that the helper sends within `BATCH_WINDOW` of each other come out together, so the loop can run them as one batch.
fn events(child: Child, stdin: ChildStdin, lines: Lines<BufReader<ChildStdout>>, carry: Option<String>, id: &'static str, parked: Arc<Mutex<Option<Parked>>>) -> EventStream {
    Box::pin(stream::unfold(Some(Live { child, stdin, lines, queue: VecDeque::new(), park: false, carry }), move |state| {
        let parked = Arc::clone(&parked);
        async move {
            let mut live = state?;
            loop {
                if let Some(event) = live.queue.pop_front() {
                    return Some((Ok(event), Some(live)));
                }
                if live.park {
                    if let Ok(mut slot) = parked.lock() {
                        *slot = Some(Parked { child: live.child, stdin: live.stdin, lines: live.lines, carry: live.carry });
                    }
                    return Some((Ok(Event::Done { stop_reason: "tool_use".into(), usage: Usage::default() }), None));
                }
                let line = match live.carry.take() {
                    Some(l) => l,
                    None => match live.lines.next_line().await {
                        Ok(Some(l)) => l,
                        Ok(None) => return Some((Err(LlmError::Protocol("helper ended before the done line".into())), None)),
                        Err(e) => return Some((Err(LlmError::Http(e.to_string())), None)),
                    },
                };
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                if v["id"].as_str().is_some_and(|got| got != id) {
                    continue;
                }
                let text = || v["text"].as_str().unwrap_or_default().to_string();
                match v["type"].as_str() {
                    Some("text") => return Some((Ok(Event::Text { text: text() }), Some(live))),
                    Some("thinking") => return Some((Ok(Event::Thinking { text: text() }), Some(live))),
                    Some("tool") => {
                        live.queue.push_back(tool_event(&v));
                        live.park = true;
                        // More calls of the same model turn arrive close together.
                        while let Ok(Ok(Some(next))) = tokio::time::timeout(BATCH_WINDOW, live.lines.next_line()).await {
                            match serde_json::from_str::<Value>(&next) {
                                Ok(w) if w["type"].as_str() == Some("tool") && w["id"].as_str().is_none_or(|got| got == id) => live.queue.push_back(tool_event(&w)),
                                Ok(_) => {
                                    live.carry = Some(next);
                                    break;
                                }
                                Err(_) => {}
                            }
                        }
                    }
                    Some("done") => {
                        let n = |k: &str| v.pointer(&format!("/usage/{k}")).and_then(Value::as_u64).unwrap_or(0);
                        let done = Event::Done { stop_reason: v["stopReason"].as_str().unwrap_or("end_turn").to_string(), usage: Usage { input_tokens: n("input"), output_tokens: n("output") } };
                        return Some((Ok(done), None)); // dropping stdin and child ends the helper
                    }
                    Some("error") => {
                        let message = v["message"].as_str().unwrap_or("unknown error").to_string();
                        return Some((Err(LlmError::Api { status: 0, message }), None));
                    }
                    _ => {} // "ready" and unknown lines
                }
            }
        }
    }))
}
