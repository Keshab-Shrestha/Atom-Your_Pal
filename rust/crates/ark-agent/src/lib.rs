//! The agent loop skeleton (ADR-278 Phase 2, CLAUDE.md rules 8, 9 and 12).
//!
//! ```text
//! LLM -> proposed tool call -> Policy (deterministic) -> Tool -> result -> LLM ... -> final text
//! ```
//!
//! The model only proposes. The [`Policy`] decides. A refused call never reaches the tool: the model gets the reason
//! as an error result and can try something else. An unknown tool name is refused by default.

pub mod actions;
pub mod floor;
mod policy;
pub mod tools;

use ark_llm::{Answer, Block, Event, LlmError, Message, Provider, Request, ToolSpec, Usage, collect};
use serde_json::{Map, Value};

pub use actions::{ActionTools, Approver, Combined};
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
    /// Answers `Decision::Ask`. None: an Ask is refused.
    pub approver: Option<&'a dyn Approver>,
}

/// A call after the policy: id, name, input, and the refusal text with its reason (`None` when the call may run).
type Decided = (String, String, Map<String, Value>, Option<(String, Option<String>)>);

impl<'a> Agent<'a> {
    pub fn new(provider: &'a dyn Provider, policy: &'a dyn Policy, tools: &'a dyn ToolRunner, model: &str) -> Self {
        Self { provider, policy, tools, model: model.into(), system: None, max_tokens: 4096, max_steps: 12, approver: None }
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
            let results = self.batch(calls, &mut out.calls);
            out.messages.push(Message { role: "user".into(), content: results });
        }
        Err(AgentError::TooManySteps(self.max_steps))
    }

    /// A batch of calls from one model turn. The policy decides each call in order (an approval question waits for the user, one at a
    /// time). The calls that passed run side by side, one thread each. The results keep the order of the calls.
    fn batch(&self, calls: Vec<(String, String, Value)>, records: &mut Vec<CallRecord>) -> Vec<Block> {
        let empty = Map::new();
        // Each entry: the call, and either a ready result (refused) or `None` (to run).
        let decided: Vec<Decided> = calls
            .into_iter()
            .map(|(id, name, input)| {
                let input = input.as_object().unwrap_or(&empty).clone();
                let refuse = |why: String| Some((format!("Refused by policy: {why}"), Some(why)));
                let refused = match self.policy.check(&name, &input) {
                    Decision::Deny(reason) => refuse(reason),
                    Decision::Ask { summary, reason } => match self.approver {
                        None => refuse("it needs the user's approval and none is available".into()),
                        Some(approver) if approver.approve(&summary, &reason) => None,
                        Some(_) => refuse("the user said no".into()),
                    },
                    Decision::Allow => None,
                };
                (id, name, input, refused)
            })
            .collect();
        let ran: Vec<Option<Result<String, String>>> = std::thread::scope(|scope| {
            let handles: Vec<_> = decided.iter().map(|(_, name, input, refused)| refused.is_none().then(|| scope.spawn(move || self.tools.run(name, input)))).collect();
            handles.into_iter().map(|h| h.map(|h| h.join().unwrap_or_else(|_| Err("the tool stopped unexpectedly".into())))).collect()
        });
        decided
            .into_iter()
            .zip(ran)
            .map(|((id, name, _, refused), result)| {
                let (content, is_error, refused) = match (refused, result) {
                    (Some((text, why)), _) => (text, true, why),
                    (None, Some(Ok(text))) => (text, false, None),
                    (None, Some(Err(e))) => (e, true, None),
                    (None, None) => ("the tool did not run".into(), true, None),
                };
                records.push(CallRecord { name, refused, is_error });
                Block::ToolResult { tool_use_id: id, content, is_error }
            })
            .collect()
    }
}
