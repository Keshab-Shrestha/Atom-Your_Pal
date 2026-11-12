use std::pin::Pin;

use futures_util::Stream;
use futures_util::future::BoxFuture;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String, #[serde(default, skip_serializing_if = "std::ops::Not::not")] is_error: bool },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: Vec<Block>,
}

impl Message {
    pub fn user_text(text: &str) -> Self {
        Self { role: "user".into(), content: vec![Block::Text { text: text.into() }] }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Request {
    pub model: String,
    pub system: Option<String>,
    pub messages: Vec<Message>,
    pub tools: Vec<ToolSpec>,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// One step of a model answer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Text { text: String },
    Thinking { text: String },
    /// A whole tool call (the input JSON is complete).
    ToolUse { id: String, name: String, input: Value },
    Done { stop_reason: String, usage: Usage },
}

#[derive(Debug)]
pub enum LlmError {
    Http(String),
    /// The server answered with an error status or an `error` event.
    Api { status: u16, message: String },
    /// The stream broke the protocol.
    Protocol(String),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(m) => write!(f, "network error: {m}"),
            Self::Api { status, message } => write!(f, "API error {status}: {message}"),
            Self::Protocol(m) => write!(f, "protocol error: {m}"),
        }
    }
}

impl std::error::Error for LlmError {}

pub type EventStream = Pin<Box<dyn Stream<Item = Result<Event, LlmError>> + Send>>;

/// A model backend. Implementations: [`crate::anthropic::AnthropicClient`], [`crate::bridge::ClaudeBridge`].
pub trait Provider: Send + Sync {
    fn stream<'a>(&'a self, req: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>>;
}

/// The whole answer of one stream.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Answer {
    pub content: Vec<Block>,
    pub stop_reason: String,
    pub usage: Usage,
}

/// Reads a stream to its end and builds the answer. `on_event` sees each event first (for live output).
pub async fn collect(mut stream: EventStream, mut on_event: impl FnMut(&Event)) -> Result<Answer, LlmError> {
    use futures_util::StreamExt;
    let mut answer = Answer::default();
    let mut done = false;
    while let Some(item) = stream.next().await {
        let event = item?;
        on_event(&event);
        match event {
            Event::Text { text } => match answer.content.last_mut() {
                Some(Block::Text { text: t }) => t.push_str(&text),
                _ => answer.content.push(Block::Text { text }),
            },
            Event::Thinking { .. } => {}
            Event::ToolUse { id, name, input } => answer.content.push(Block::ToolUse { id, name, input }),
            Event::Done { stop_reason, usage } => {
                answer.stop_reason = stop_reason;
                answer.usage = usage;
                done = true;
            }
        }
    }
    if done { Ok(answer) } else { Err(LlmError::Protocol("stream ended before the done event".into())) }
}
