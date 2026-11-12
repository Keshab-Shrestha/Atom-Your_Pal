//! Anthropic Messages API client with streaming (`stream: true`, server-sent events).
//! The API key comes from the caller (env or config). This module never stores it.

use futures_util::future::BoxFuture;
use futures_util::{StreamExt, stream};
use serde_json::{Value, json};

use crate::sse::SseParser;
use crate::{Event, EventStream, LlmError, Provider, Request, Usage};

pub const DEFAULT_BASE_URL: &str = "https://api.anthropic.com";
const API_VERSION: &str = "2023-06-01";

pub struct AnthropicClient {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl AnthropicClient {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_base_url(api_key, DEFAULT_BASE_URL)
    }

    pub fn with_base_url(api_key: impl Into<String>, base_url: &str) -> Self {
        Self { http: reqwest::Client::new(), base_url: base_url.trim_end_matches('/').to_string(), api_key: api_key.into() }
    }
}

/// The JSON body of a streaming request.
pub fn request_body(req: &Request) -> Value {
    let mut body = json!({
        "model": req.model,
        "max_tokens": if req.max_tokens == 0 { 4096 } else { req.max_tokens },
        "stream": true,
        "messages": req.messages,
    });
    if let Some(system) = &req.system {
        body["system"] = json!(system);
    }
    if !req.tools.is_empty() {
        body["tools"] = json!(req.tools);
    }
    body
}

impl Provider for AnthropicClient {
    fn stream<'a>(&'a self, req: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
        Box::pin(async move {
            let resp = self
                .http
                .post(format!("{}/v1/messages", self.base_url))
                .header("x-api-key", &self.api_key)
                .header("anthropic-version", API_VERSION)
                .json(&request_body(req))
                .send()
                .await
                .map_err(|e| LlmError::Http(e.to_string()))?;
            let status = resp.status();
            if !status.is_success() {
                let text = resp.text().await.unwrap_or_default();
                return Err(LlmError::Api { status: status.as_u16(), message: error_message(&text) });
            }
            Ok(events(resp.bytes_stream().map(|r| r.map(|b| b.to_vec()).map_err(|e| LlmError::Http(e.to_string())))))
        })
    }
}

fn error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(300).collect())
}

/// Turns a stream of raw bytes into model events.
pub fn events(bytes: impl futures_util::Stream<Item = Result<Vec<u8>, LlmError>> + Send + 'static) -> EventStream {
    let state = Assembler::default();
    Box::pin(
        stream::unfold((Box::pin(bytes), SseParser::default(), state, false), |(mut bytes, mut sse, mut st, finished)| async move {
            if finished {
                return None;
            }
            loop {
                if let Some(ev) = st.pending.pop_front() {
                    let stop = matches!(ev, Ok(Event::Done { .. }) | Err(_));
                    return Some((ev, (bytes, sse, st, stop)));
                }
                match bytes.next().await {
                    None => return None,
                    Some(Err(e)) => return Some((Err(e), (bytes, sse, st, true))),
                    Some(Ok(chunk)) => {
                        for e in sse.push(&chunk) {
                            st.handle(&e.event, &e.data);
                        }
                    }
                }
            }
        }),
    )
}

#[derive(Default)]
struct Assembler {
    pending: std::collections::VecDeque<Result<Event, LlmError>>,
    tool: Option<(String, String, String)>,
    stop_reason: String,
    usage: Usage,
}

impl Assembler {
    fn handle(&mut self, kind: &str, data: &str) {
        let v: Value = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(e) => return self.fail(format!("bad JSON in {kind} event: {e}")),
        };
        match kind {
            "message_start" => {
                self.usage.input_tokens = v.pointer("/message/usage/input_tokens").and_then(Value::as_u64).unwrap_or(0);
            }
            "content_block_start" => {
                let b = &v["content_block"];
                if b["type"] == "tool_use" {
                    let s = |k: &str| b[k].as_str().unwrap_or_default().to_string();
                    self.tool = Some((s("id"), s("name"), String::new()));
                }
            }
            "content_block_delta" => self.delta(&v["delta"]),
            "content_block_stop" => {
                if let Some((id, name, json)) = self.tool.take() {
                    let raw = if json.trim().is_empty() { "{}" } else { json.as_str() };
                    match serde_json::from_str(raw) {
                        Ok(input) => self.pending.push_back(Ok(Event::ToolUse { id, name, input })),
                        Err(e) => self.fail(format!("tool input of {name} is not JSON: {e}")),
                    }
                }
            }
            "message_delta" => {
                if let Some(r) = v.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    self.stop_reason = r.to_string();
                }
                if let Some(n) = v.pointer("/usage/output_tokens").and_then(Value::as_u64) {
                    self.usage.output_tokens = n;
                }
            }
            "message_stop" => {
                let done = Event::Done { stop_reason: std::mem::take(&mut self.stop_reason), usage: self.usage.clone() };
                self.pending.push_back(Ok(done));
            }
            "error" => {
                let message = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("unknown").to_string();
                self.pending.push_back(Err(LlmError::Api { status: 0, message }));
            }
            _ => {}
        }
    }

    fn delta(&mut self, d: &Value) {
        let ev = match d["type"].as_str() {
            Some("text_delta") => Event::Text { text: d["text"].as_str().unwrap_or_default().into() },
            Some("thinking_delta") => Event::Thinking { text: d["thinking"].as_str().unwrap_or_default().into() },
            Some("input_json_delta") => {
                if let Some((_, _, json)) = self.tool.as_mut() {
                    json.push_str(d["partial_json"].as_str().unwrap_or_default());
                }
                return;
            }
            _ => return,
        };
        self.pending.push_back(Ok(ev));
    }

    fn fail(&mut self, m: String) {
        self.pending.push_back(Err(LlmError::Protocol(m)));
    }
}
