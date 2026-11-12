//! The `claude-bridge` provider: Claude on the user's own subscription (plan section 5(a), ADR-055).
//! Rust starts the Node helper `services/llm-gateway/src/providers/claude-bridge.ts`. It speaks line-delimited JSON on
//! stdio and runs the Agent SDK, which starts the signed-in `claude` program. ARK never reads a login.
//! One helper process serves one request. It ends when its stdin closes.
//! The bridge has no tools yet: a tool call from the model is a later step (it would come back to Rust for policy).

use std::path::PathBuf;
use std::process::Stdio;

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
}

impl ClaudeBridge {
    pub fn new(program: impl Into<PathBuf>, args: Vec<String>) -> Self {
        Self { program: program.into(), args, claude_path: None }
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
            if let Some(path) = &self.claude_path {
                run["claudePath"] = json!(path);
            }
            let line = format!("{run}\n");
            stdin.write_all(line.as_bytes()).await.map_err(|e| LlmError::Http(format!("helper stdin: {e}")))?;
            stdin.flush().await.map_err(|e| LlmError::Http(e.to_string()))?;
            Ok(events(child, stdin, BufReader::new(stdout).lines(), id))
        })
    }
}

/// The helper's lines as model events. `child` and `stdin` stay alive until the stream ends.
fn events(child: Child, stdin: ChildStdin, lines: Lines<BufReader<ChildStdout>>, id: &'static str) -> EventStream {
    Box::pin(stream::unfold(Some((child, stdin, lines)), move |state| async move {
        let (child, stdin, mut lines) = state?;
        loop {
            let line = match lines.next_line().await {
                Ok(Some(l)) => l,
                Ok(None) => return Some((Err(LlmError::Protocol("helper ended before the done line".into())), None)),
                Err(e) => return Some((Err(LlmError::Http(e.to_string())), None)),
            };
            let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
            if v["id"].as_str().is_some_and(|got| got != id) {
                continue;
            }
            let text = || v["text"].as_str().unwrap_or_default().to_string();
            match v["type"].as_str() {
                Some("text") => return Some((Ok(Event::Text { text: text() }), Some((child, stdin, lines)))),
                Some("thinking") => return Some((Ok(Event::Thinking { text: text() }), Some((child, stdin, lines)))),
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
    }))
}
