//! The model and the fold of events into it.

use ark_protocol::Event;
use ark_protocol::events::LoopState;
use serde_json::{Map, Value};

/// How the runtime child is doing.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Conn {
    /// Started, no `ready` yet.
    #[default]
    Starting,
    Ready,
    /// The child ended or never started. The text says why, in words for the user.
    Down(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub role: Role,
    pub text: String,
}

/// One row of the chat list (`chats` event).
#[derive(Debug, Clone, PartialEq)]
pub struct ChatItem {
    pub id: String,
    pub title: String,
    pub messages: u64,
    pub read_only: bool,
    pub pinned: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolState {
    Started,
    Ok,
    Error,
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolCall {
    pub id: String,
    pub tool: String,
    pub state: ToolState,
    pub ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkState {
    Working,
    Completed,
    Failed,
    Stopped,
}

/// One `ask_user` question of a `chat.work` snapshot.
#[derive(Debug, Clone, PartialEq)]
pub struct Question {
    pub id: String,
    pub prompt: String,
    pub choices: Vec<String>,
    /// `pending`, `answered`, `skipped` or `expired`.
    pub state: String,
    pub answer: Option<String>,
}

/// The `chat.work` snapshot of the foreground turn.
#[derive(Debug, Clone, PartialEq)]
pub struct Work {
    pub chat: String,
    pub turn: String,
    pub state: WorkState,
    pub elapsed_ms: u64,
    pub calls: Vec<ToolCall>,
    pub omitted: u64,
    pub questions: Vec<Question>,
}

/// An `approval.request` that waits for Allow or Decline.
#[derive(Debug, Clone, PartialEq)]
pub struct Approval {
    pub id: String,
    pub summary: String,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Model {
    pub conn: Conn,
    pub provider: String,
    pub model: String,
    pub loop_state: Option<LoopState>,
    pub chats: Vec<ChatItem>,
    /// The id of the open chat.
    pub current: Option<String>,
    pub messages: Vec<Message>,
    pub work: Option<Work>,
    pub approvals: Vec<Approval>,
    /// The last error or notice, in words for the user.
    pub banner: Option<String>,
}

fn str_of(map: &Map<String, Value>, key: &str) -> String {
    map.get(key).and_then(Value::as_str).unwrap_or_default().to_owned()
}

fn bool_of(map: &Map<String, Value>, key: &str) -> bool {
    map.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn u64_of(map: &Map<String, Value>, key: &str) -> u64 {
    map.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn objects<'a>(map: &'a Map<String, Value>, key: &str) -> impl Iterator<Item = &'a Map<String, Value>> {
    map.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object)
}

fn parse_work(map: &Map<String, Value>) -> Work {
    let state = match str_of(map, "state").as_str() {
        "completed" => WorkState::Completed,
        "failed" => WorkState::Failed,
        "stopped" => WorkState::Stopped,
        _ => WorkState::Working,
    };
    let calls = objects(map, "calls")
        .map(|c| ToolCall {
            id: str_of(c, "id"),
            tool: str_of(c, "tool"),
            state: match str_of(c, "state").as_str() {
                "started" => ToolState::Started,
                "ok" => ToolState::Ok,
                "error" => ToolState::Error,
                _ => ToolState::Unknown,
            },
            ms: c.get("ms").and_then(Value::as_u64),
        })
        .collect();
    let questions = objects(map, "questions")
        .map(|q| Question {
            id: str_of(q, "id"),
            prompt: str_of(q, "prompt"),
            choices: q.get("choices").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect(),
            state: str_of(q, "state"),
            answer: q.get("answer").and_then(Value::as_str).map(str::to_owned),
        })
        .collect();
    Work { chat: str_of(map, "chat"), turn: str_of(map, "turn"), state, elapsed_ms: u64_of(map, "elapsedMs"), calls, omitted: u64_of(map, "omitted"), questions }
}

fn parse_chats(map: &Map<String, Value>) -> Vec<ChatItem> {
    objects(map, "chats")
        .map(|c| ChatItem { id: str_of(c, "id"), title: str_of(c, "title"), messages: u64_of(c, "messages"), read_only: bool_of(c, "readOnly"), pinned: bool_of(c, "pinned") })
        .collect()
}

fn parse_messages(map: &Map<String, Value>) -> Vec<Message> {
    objects(map, "messages")
        .map(|m| Message { role: if str_of(m, "role") == "user" { Role::User } else { Role::Assistant }, text: str_of(m, "text") })
        .collect()
}

impl Model {
    /// The runtime child ended (or could not start). Open approvals cannot be answered any more.
    pub fn runtime_down(&mut self, why: impl Into<String>) {
        self.conn = Conn::Down(why.into());
        self.loop_state = None;
        self.approvals.clear();
    }

    /// Takes an approval out of the list when the user answers it. The island sends `approval.answer`.
    pub fn close_approval(&mut self, id: &str) {
        self.approvals.retain(|a| a.id != id);
    }

    /// True while a turn runs: the composer shows the stop state and tool cards stay open.
    pub fn busy(&self) -> bool {
        matches!(self.loop_state, Some(LoopState::Thinking | LoopState::Transcribing | LoopState::Speaking))
            || self.work.as_ref().is_some_and(|w| w.state == WorkState::Working)
    }

    pub fn current_title(&self) -> &str {
        self.current.as_deref().and_then(|id| self.chats.iter().find(|c| c.id == id)).map_or("New chat", |c| c.title.as_str())
    }

    /// Folds one event into the model. Returns whether the model changed.
    pub fn apply(&mut self, event: &Event) -> bool {
        let before = self.clone();
        match event {
            Event::Ready { provider, model, .. } => {
                self.conn = Conn::Ready;
                self.provider.clone_from(provider);
                self.model.clone_from(model);
                self.banner = None;
            }
            Event::State { state } => {
                self.loop_state = Some(*state);
            }
            Event::Transcript { text } => self.messages.push(Message { role: Role::User, text: text.clone() }),
            Event::Reply { text } => self.messages.push(Message { role: Role::Assistant, text: text.clone() }),
            Event::ConversationReset { .. } => {
                self.messages.clear();
                self.work = None;
                self.approvals.clear();
            }
            Event::ApprovalClosed { id } => self.close_approval(id),
            Event::Notice { message, .. } => self.banner = Some(message.clone()),
            Event::Error { message, .. } => self.banner = Some(message.clone()),
            Event::Other(map) => self.apply_other(map),
            _ => {}
        }
        *self != before
    }

    fn apply_other(&mut self, map: &Map<String, Value>) {
        match str_of(map, "type").as_str() {
            "info" => {
                self.provider = str_of(map, "provider");
                self.model = str_of(map, "model");
            }
            "chats" => {
                self.chats = parse_chats(map);
                let current = str_of(map, "current");
                self.current = (!current.is_empty()).then_some(current);
            }
            "chat.opened" => {
                self.current = Some(str_of(map, "id"));
                self.messages = parse_messages(map);
                self.work = None;
                self.approvals.clear();
            }
            "chat.work" => {
                let work = parse_work(map);
                self.work = Some(work);
            }
            "approval.request" => {
                let id = str_of(map, "id");
                if !self.approvals.iter().any(|a| a.id == id) {
                    self.approvals.push(Approval { id, summary: str_of(map, "summary"), reason: str_of(map, "reason") });
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(model: &mut Model, lines: &[&str]) {
        for line in lines {
            let event = Event::parse(line).unwrap_or_else(|e| panic!("{line}: {e}"));
            model.apply(&event);
        }
    }

    #[test]
    fn folds_a_conversation() {
        let mut m = Model::default();
        feed(
            &mut m,
            &[
                r#"{"type":"ready","protocol":1,"provider":"claude","model":"opus","microphone":"x","voice":false}"#,
                r#"{"type":"chats","chats":[{"id":"c1","title":"Plan","updatedAt":"x","messages":2},{"id":"t","title":"Telegram","messages":1,"readOnly":true}],"current":"c1"}"#,
                r#"{"type":"chat.opened","id":"c1","messages":[{"role":"user","text":"hi"},{"role":"assistant","text":"**hello**"}]}"#,
                r#"{"type":"transcript","text":"list files"}"#,
                r#"{"type":"state","state":"thinking"}"#,
                r#"{"type":"chat.work","chat":"c1","turn":"u","startedAt":"x","elapsedMs":1200,"state":"working","calls":[{"id":"k","tool":"Read","state":"started"}],"omitted":0,"questions":[]}"#,
                r#"{"type":"approval.request","id":"a1","summary":"Click Send","reason":"It sends mail"}"#,
            ],
        );
        assert_eq!(m.conn, Conn::Ready);
        assert_eq!(m.current_title(), "Plan");
        assert!(m.chats[1].read_only);
        assert_eq!(m.messages.len(), 3);
        assert!(m.busy());
        assert_eq!(m.work.as_ref().map(|w| w.calls.len()), Some(1));
        assert_eq!(m.approvals.len(), 1);

        feed(&mut m, &[r#"{"type":"approval.closed","id":"a1"}"#, r#"{"type":"reply","text":"done"}"#, r#"{"type":"state","state":"idle"}"#]);
        feed(&mut m, &[r#"{"type":"chat.work","chat":"c1","turn":"u","startedAt":"x","elapsedMs":9,"state":"completed","calls":[],"omitted":0,"questions":[]}"#]);
        assert!(m.approvals.is_empty());
        assert_eq!(m.messages.last().map(|x| x.text.as_str()), Some("done"));
        assert!(!m.busy());
    }

    #[test]
    fn duplicate_approval_is_kept_once_and_reset_clears() {
        let mut m = Model::default();
        let line = r#"{"type":"approval.request","id":"a1","summary":"s","reason":"r"}"#;
        feed(&mut m, &[line, line]);
        assert_eq!(m.approvals.len(), 1);
        feed(&mut m, &[r#"{"type":"reply","text":"x"}"#, r#"{"type":"conversation.reset"}"#]);
        assert!(m.messages.is_empty() && m.approvals.is_empty());
    }

    #[test]
    fn runtime_down_shows_why() {
        let mut m = Model::default();
        m.runtime_down("exit 78");
        assert_eq!(m.conn, Conn::Down("exit 78".into()));
    }
}
