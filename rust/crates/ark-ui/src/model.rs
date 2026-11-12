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

/// One AI provider and its models (`info` event). Never carries keys.
#[derive(Debug, Clone, PartialEq)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub available: bool,
    /// (id, name) of each model.
    pub models: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobState {
    Queued,
    Running,
    Done,
    Failed,
    Stopped,
}

/// One task of a helper (`helpers` event, `jobs`).
#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    pub id: u64,
    pub helper: String,
    pub task: String,
    pub state: JobState,
    pub step: Option<String>,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    /// Why a runnable task waits for the user (a plan to approve, an interrupted run).
    pub held: Option<String>,
}

/// One helper, a worker agent (`helpers` event).
#[derive(Debug, Clone, PartialEq)]
pub struct Helper {
    pub id: String,
    pub name: String,
    pub role: String,
    pub available: bool,
    pub kit: Option<String>,
    pub custom: bool,
    /// The soul text: personality, how it works, rules, lessons.
    pub soul: Option<[String; 4]>,
    pub jobs: Vec<Job>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolRow {
    pub name: String,
    pub calls: u64,
    pub failed: u64,
    pub avg_ms: u64,
}

/// The numbers of the Stats page (`stats` event).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Stats {
    pub days: u64,
    pub turns: u64,
    pub avg_turn_ms: u64,
    pub slow_turns: u64,
    pub total_calls: u64,
    pub total_failed: u64,
    pub tools: Vec<ToolRow>,
}

/// The local API (`api` event).
#[derive(Debug, Clone, PartialEq)]
pub struct ApiStatus {
    pub on: bool,
    pub port: u16,
    pub error: Option<String>,
}

/// What ARK remembers (`memory` event): facts and conversation summaries.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Memory {
    pub enabled: bool,
    /// (id, text)
    pub facts: Vec<(u64, String)>,
    pub episodes: Vec<String>,
}

/// One note in the brain list (`brain` event).
#[derive(Debug, Clone, PartialEq)]
pub struct BrainNode {
    pub id: u64,
    pub title: String,
    pub kind: String,
    pub ghost: bool,
}

/// The morning-brief switches, in the order the settings page shows them: (key in the `brief` event, label).
pub const BRIEF_SWITCHES: [(&str, &str); 9] = [
    ("enabled", "Morning brief"),
    ("events", "Calendar events"),
    ("reminders", "Reminders"),
    ("weather", "Weather"),
    ("tasks", "Tasks"),
    ("needsYou", "What needs you"),
    ("notify", "Notification"),
    ("telegram", "Send to Telegram"),
    ("spoken", "Read aloud"),
];

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Model {
    /// The values of `BRIEF_SWITCHES`, once the runtime has sent the `brief` event.
    pub brief: Option<[bool; 9]>,
    pub memory: Option<Memory>,
    pub brain: Option<Vec<BrainNode>>,
    /// The note open in the brain page.
    pub brain_note: Option<ark_protocol::events::BrainNoteItem>,
    pub conn: Conn,
    pub provider: String,
    pub model: String,
    pub loop_state: Option<LoopState>,
    pub chats: Vec<ChatItem>,
    /// The id of the open chat.
    pub current: Option<String>,
    pub messages: Vec<Message>,
    /// The reply text so far, while the model writes it. Empty when no reply is streaming.
    pub streaming: String,
    pub work: Option<Work>,
    pub approvals: Vec<Approval>,
    /// The last error or notice, in words for the user.
    pub banner: Option<String>,
    pub providers: Vec<Provider>,
    pub microphone: String,
    pub voice: bool,
    pub telegram: bool,
    pub computer: bool,
    pub api: Option<ApiStatus>,
    /// None until the runtime answers `helpers.list`.
    pub helpers: Option<Vec<Helper>>,
    pub stats: Option<Stats>,
    /// The share of the plan used: (five hours, seven days), 0 to 1.
    pub plan_usage: (Option<f64>, Option<f64>),
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

fn parse_providers(map: &Map<String, Value>) -> Vec<Provider> {
    objects(map, "providers")
        .map(|p| Provider {
            id: str_of(p, "id"),
            name: str_of(p, "name"),
            available: bool_of(p, "available"),
            models: objects(p, "models").map(|m| (str_of(m, "id"), str_of(m, "name"))).collect(),
        })
        .collect()
}

fn opt_str(map: &Map<String, Value>, key: &str) -> Option<String> {
    map.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned)
}

fn parse_helpers(map: &Map<String, Value>) -> Vec<Helper> {
    objects(map, "helpers")
        .map(|h| {
            let id = str_of(h, "id");
            let jobs = objects(h, "jobs")
                .map(|j| Job {
                    id: u64_of(j, "id"),
                    helper: id.clone(),
                    task: str_of(j, "task"),
                    state: match str_of(j, "state").as_str() {
                        "running" => JobState::Running,
                        "done" => JobState::Done,
                        "failed" => JobState::Failed,
                        "stopped" => JobState::Stopped,
                        _ => JobState::Queued,
                    },
                    step: opt_str(j, "step"),
                    title: opt_str(j, "title"),
                    summary: opt_str(j, "summary"),
                    error: opt_str(j, "error"),
                    held: opt_str(j, "held"),
                })
                .collect();
            Helper { name: str_of(h, "name"), role: str_of(h, "role"), available: bool_of(h, "available"), kit: opt_str(h, "kit"), custom: bool_of(h, "custom"), soul: h.get("soul").and_then(Value::as_object).map(|o| [str_of(o, "personality"), str_of(o, "howItWorks"), str_of(o, "rules"), str_of(o, "lessons")]), jobs, id }
        })
        .collect()
}

fn parse_stats(map: &Map<String, Value>) -> Stats {
    Stats {
        days: u64_of(map, "days"),
        turns: u64_of(map, "turns"),
        avg_turn_ms: u64_of(map, "avgTurnMs"),
        slow_turns: u64_of(map, "slowTurns"),
        total_calls: u64_of(map, "totalCalls"),
        total_failed: u64_of(map, "totalFailed"),
        tools: objects(map, "tools").map(|t| ToolRow { name: str_of(t, "name"), calls: u64_of(t, "calls"), failed: u64_of(t, "failed"), avg_ms: u64_of(t, "avgMs") }).collect(),
    }
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

    /// Every task of every helper, running first, then queued, then the newest ended ones.
    pub fn jobs(&self) -> Vec<&Job> {
        let mut jobs: Vec<&Job> = self.helpers.iter().flatten().flat_map(|h| h.jobs.iter()).collect();
        let rank = |j: &Job| match j.state {
            JobState::Running => 0,
            JobState::Queued => 1,
            _ => 2,
        };
        jobs.sort_by(|a, b| rank(a).cmp(&rank(b)).then(b.id.cmp(&a.id)));
        jobs
    }

    pub fn current_title(&self) -> &str {
        self.current.as_deref().and_then(|id| self.chats.iter().find(|c| c.id == id)).map_or("New chat", |c| c.title.as_str())
    }

    /// Folds one event into the model. Returns whether the model changed.
    pub fn apply(&mut self, event: &Event) -> bool {
        let before = self.clone();
        match event {
            Event::Ready { provider, model, microphone, voice, telegram, computer, .. } => {
                self.microphone.clone_from(microphone);
                self.voice = *voice;
                self.telegram = telegram.unwrap_or(false);
                self.computer = computer.unwrap_or(false);
                self.conn = Conn::Ready;
                self.provider.clone_from(provider);
                self.model.clone_from(model);
                self.banner = None;
            }
            Event::State { state } => {
                self.loop_state = Some(*state);
            }
            Event::Transcript { text } => self.messages.push(Message { role: Role::User, text: text.clone() }),
            Event::ReplyDelta { text } => self.streaming.push_str(text),
            Event::Reply { text } => {
                self.streaming.clear();
                self.messages.push(Message { role: Role::Assistant, text: text.clone() });
            }
            Event::ConversationReset { .. } => {
                self.messages.clear();
                self.streaming.clear();
                self.work = None;
                self.approvals.clear();
            }
            Event::ApprovalClosed { id } => self.close_approval(id),
            Event::Api { on, port, error, .. } => self.api = Some(ApiStatus { on: *on, port: *port, error: error.clone() }),
            Event::Notice { message, .. } => self.banner = Some(message.clone()),
            Event::Error { message, .. } => {
                self.streaming.clear();
                self.banner = Some(message.clone());
            }
            Event::BrainNote { note } => self.brain_note = Some(note.clone()),
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
                self.providers = parse_providers(map);
            }
            "brief" => {
                let settings = map.get("settings").and_then(Value::as_object);
                self.brief = settings.map(|o| BRIEF_SWITCHES.map(|(key, _)| bool_of(o, key)));
            }
            "memory" => {
                self.memory = Some(Memory {
                    enabled: bool_of(map, "enabled"),
                    facts: objects(map, "memories").map(|m| (u64_of(m, "id"), str_of(m, "text"))).collect(),
                    episodes: objects(map, "episodes").map(|e| str_of(e, "summary")).collect(),
                })
            }
            "brain" => {
                self.brain = Some(
                    objects(map, "nodes")
                        .map(|n| BrainNode { id: u64_of(n, "id"), title: str_of(n, "title"), kind: str_of(n, "kind"), ghost: bool_of(n, "ghost") })
                        .collect(),
                )
            }
            "helpers" => self.helpers = Some(parse_helpers(map)),
            "stats" => self.stats = Some(parse_stats(map)),
            "plan.usage" => self.plan_usage = (map.get("fiveHour").and_then(Value::as_f64), map.get("sevenDay").and_then(Value::as_f64)),
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
    fn deltas_stream_then_the_reply_replaces_them() {
        let mut m = Model::default();
        feed(&mut m, &[r#"{"type":"reply.delta","text":"Hel"}"#, r#"{"type":"reply.delta","text":"lo"}"#]);
        assert_eq!(m.streaming, "Hello");
        assert!(m.messages.is_empty());
        feed(&mut m, &[r#"{"type":"reply","text":"Hello"}"#]);
        assert!(m.streaming.is_empty());
        assert_eq!(m.messages.len(), 1);
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
    fn folds_settings_agents_tasks_and_stats() {
        let mut m = Model::default();
        feed(
            &mut m,
            &[
                r#"{"type":"ready","protocol":1,"provider":"claude","model":"opus","microphone":"Mac mini Mic","voice":true,"telegram":true}"#,
                r#"{"type":"info","provider":"claude","model":"opus","providers":[{"id":"claude","name":"Claude","available":true,"models":[{"id":"opus","name":"Opus"},{"id":"sonnet","name":"Sonnet"}]}]}"#,
                r#"{"type":"api","on":true,"port":4317,"tokenFile":"t"}"#,
                r#"{"type":"helpers","helpers":[{"id":"sid","name":"Sid","role":"researcher","available":true,"kit":"research","jobs":[{"id":1,"task":"old","state":"done","createdAt":"x"},{"id":2,"task":"now","state":"running","step":"Reading","createdAt":"x"}]},{"id":"dev","name":"Dev","role":"coder","available":false,"jobs":[{"id":3,"task":"wait","state":"queued","held":"Plan waits","createdAt":"x"}]}],"apps":[]}"#,
                r#"{"type":"stats","days":7,"turns":4,"avgTurnMs":900,"slowTurns":1,"totalCalls":10,"totalFailed":2,"tools":[{"name":"Read","calls":6,"failed":0,"avgMs":12,"repeats":0}]}"#,
                r#"{"type":"plan.usage","fiveHour":0.42}"#,
            ],
        );
        assert!(m.voice && m.telegram && !m.computer);
        assert_eq!(m.providers[0].models.len(), 2);
        assert_eq!(m.api.as_ref().map(|a| a.port), Some(4317));
        let helpers = m.helpers.as_ref().map(Vec::len);
        assert_eq!(helpers, Some(2));
        let order: Vec<u64> = m.jobs().iter().map(|j| j.id).collect();
        assert_eq!(order, vec![2, 3, 1]);
        assert_eq!(m.stats.as_ref().map(|s| s.tools[0].calls), Some(6));
        assert_eq!(m.plan_usage.0, Some(0.42));
    }

    #[test]
    fn runtime_down_shows_why() {
        let mut m = Model::default();
        m.runtime_down("exit 78");
        assert_eq!(m.conn, Conn::Down("exit 78".into()));
    }
}
