//! The agent loop skeleton (ADR-278 Phase 2, CLAUDE.md rules 8, 9 and 12).
//!
//! ```text
//! LLM -> proposed tool call -> Policy (deterministic) -> Tool -> result -> LLM ... -> final text
//! ```
//!
//! The model only proposes. The [`Policy`] decides. A refused call never reaches the tool: the model gets the reason
//! as an error result and can try something else. An unknown tool name is refused by default.

pub mod floor;
mod policy;
pub mod tools;

use ark_llm::{Answer, Block, Event, LlmError, Message, Provider, Request, ToolSpec, Usage, collect};
use serde_json::{Map, Value};

pub use policy::{Decision, FloorPolicy, Policy, RuntimeTools, ToolRunner};

#[derive(Debug)]
pub enum AgentError {
    Llm(LlmError),
    /// The model kept calling tools past `max_steps`.
    TooManySteps(usize),
}

impl std::fmt::Display for AgentError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Llm(e) => write!(f, "{e}"),
            Self::TooManySteps(n) => write!(f, "the model did not finish in {n} steps"),
        }
    }
}

impl std::error::Error for AgentError {}

impl From<LlmError> for AgentError {
    fn from(e: LlmError) -> Self {
        Self::Llm(e)
    }
}

/// What happened to one tool call. For logs and tests.
#[derive(Debug, Clone, PartialEq)]
pub struct CallRecord {
    pub name: String,
    pub refused: Option<String>,
    pub is_error: bool,
}

#[derive(Debug, Default)]
pub struct Outcome {
    /// The whole conversation, including the new turns.
    pub messages: Vec<Message>,
    /// The text of the last answer.
    pub text: String,
    pub calls: Vec<CallRecord>,
    pub usage: Usage,
}

pub struct Agent<'a> {
    pub provider: &'a dyn Provider,
    pub policy: &'a dyn Policy,
    pub tools: &'a dyn ToolRunner,
    pub model: String,
    pub system: Option<String>,
    pub max_tokens: u32,
    /// The most model calls in one turn.
    pub max_steps: usize,
}

impl<'a> Agent<'a> {
    pub fn new(provider: &'a dyn Provider, policy: &'a dyn Policy, tools: &'a dyn ToolRunner, model: &str) -> Self {
        Self { provider, policy, tools, model: model.into(), system: None, max_tokens: 4096, max_steps: 12 }
    }

    /// Runs one turn: `history` plus the new user message, until the model answers without a tool call.
    /// `on_event` sees each model event (live text).
    pub async fn run(&self, history: Vec<Message>, user: &str, mut on_event: impl FnMut(&Event)) -> Result<Outcome, AgentError> {
        let mut out = Outcome { messages: history, ..Outcome::default() };
        out.messages.push(Message::user_text(user));
        let specs: Vec<ToolSpec> = self.tools.specs();
        for _ in 0..self.max_steps {
            let req = Request { model: self.model.clone(), system: self.system.clone(), messages: out.messages.clone(), tools: specs.clone(), max_tokens: self.max_tokens };
            let Answer { content, usage, .. } = collect(self.provider.stream(&req).await?, &mut on_event).await?;
            out.usage.input_tokens += usage.input_tokens;
            out.usage.output_tokens += usage.output_tokens;
            let calls: Vec<(String, String, Value)> = content
                .iter()
                .filter_map(|b| if let Block::ToolUse { id, name, input } = b { Some((id.clone(), name.clone(), input.clone())) } else { None })
                .collect();
            out.text = content.iter().filter_map(|b| if let Block::Text { text } = b { Some(text.as_str()) } else { None }).collect::<Vec<_>>().join("");
            out.messages.push(Message { role: "assistant".into(), content });
            if calls.is_empty() {
                return Ok(out);
            }
            let results = calls.into_iter().map(|(id, name, input)| self.call(id, &name, &input, &mut out.calls)).collect();
            out.messages.push(Message { role: "user".into(), content: results });
        }
        Err(AgentError::TooManySteps(self.max_steps))
    }

    /// One proposed call: the policy first, then the tool. Always gives a result block, so the model can go on.
    fn call(&self, id: String, name: &str, input: &Value, records: &mut Vec<CallRecord>) -> Block {
        let empty = Map::new();
        let input = input.as_object().unwrap_or(&empty);
        let (content, is_error, refused) = match self.policy.check(name, input) {
            Decision::Deny(reason) => (format!("Refused by policy: {reason}"), true, Some(reason)),
            Decision::Allow => match self.tools.run(name, input) {
                Ok(text) => (text, false, None),
                Err(e) => (e, true, None),
            },
        };
        records.push(CallRecord { name: name.into(), refused, is_error });
        Block::ToolResult { tool_use_id: id, content, is_error }
    }
}
