//! The `ask_user` tool (ADR-275) for native chat turns: one card with 1 to 4 questions, shown by the app as a `chat.work`
//! event. The answers come back as `chat.question.answer` commands. It is a clarification, never a permission
//! (`apps/mac/src/chat-work.ts`). Rust answers only for cards it made (ids start with `rq-`); other ids go to Node.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::Duration;

use ark_agent::{Decision, Policy, ToolRunner};
use ark_core::questions::{Question, parse_questions};
use ark_llm::ToolSpec;
use ark_protocol::Event;
use serde_json::{Map, Value, json};

use crate::chat::Sink;

/// 90 seconds per question, as in Node.
const WAIT_PER_QUESTION: Duration = Duration::from_secs(90);
/// Questions per turn.
const MAX_PER_TURN: usize = 4;

const DESCRIPTION: &str = "Ask the person in the ARK window necessary clarifications in one card and wait for their answers. Not a permission approval: never use this to obtain file/system access. Do not ask for passwords or secrets. Use question (+ choices) for one question, or questions for 2–4 related ones. Each choice is one line: a short label, optionally ' | ' and a short reason, and ' (recommended)' at the end of the one you prefer. The user picks an option, writes a note, or leaves a question blank (unanswered). Available only during a foreground window turn; not to workers.";

struct Slot {
    chat: String,
    turn: String,
    tx: mpsc::Sender<(String, Option<String>)>,
}

/// The questions that wait for an answer, shared by every turn of the runtime.
#[derive(Default)]
pub struct Questions {
    next: AtomicU64,
    waiting: Mutex<HashMap<String, Slot>>,
}

impl Questions {
    /// Gives an answer (`None`: left blank) to the question `id` of this chat and turn. `false` when no such question waits here.
    pub fn answer(&self, chat: &str, turn: &str, id: &str, text: Option<&str>) -> bool {
        let Ok(waiting) = self.waiting.lock() else { return false };
        let Some(slot) = waiting.get(id).filter(|s| s.chat == chat && s.turn == turn) else { return false };
        match text.map(str::trim) {
            Some("") => {} // an empty note does not answer the question
            Some(t) => drop(slot.tx.send((id.to_string(), Some(t.to_string())))),
            None => drop(slot.tx.send((id.to_string(), None))),
        }
        true
    }

    /// Every waiting question ends unanswered (the turn was cancelled).
    pub fn skip_all(&self) {
        if let Ok(waiting) = self.waiting.lock() {
            for (id, slot) in waiting.iter() {
                slot.tx.send((id.clone(), None)).ok();
            }
        }
    }

    pub fn is_ours(id: &str) -> bool {
        id.starts_with("rq-")
    }
}

/// The tool for one turn: it knows the chat, the turn and where to send the card.
pub struct AskUser {
    questions: Arc<Questions>,
    to_app: Sink,
    chat: String,
    turn: String,
    started: String,
    asked: Mutex<usize>,
    wait: Duration,
    /// The rows of every card of this turn, for the closing event.
    rows: Mutex<Vec<Value>>,
}

fn now() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

impl AskUser {
    pub fn new(questions: Arc<Questions>, to_app: Sink, chat: &str, turn: &str) -> AskUser {
        AskUser { questions, to_app, chat: chat.into(), turn: turn.into(), started: now(), asked: Mutex::new(0), wait: WAIT_PER_QUESTION, rows: Mutex::default() }
    }

    #[cfg(test)]
    fn with_wait(mut self, wait: Duration) -> AskUser {
        self.wait = wait;
        self
    }

    fn emit(&self, state: &str) {
        let rows = self.rows.lock().map(|r| r.clone()).unwrap_or_default();
        let event = json!({ "type": "chat.work", "chat": self.chat, "turn": self.turn, "startedAt": self.started, "elapsedMs": 0, "state": state, "calls": [], "omitted": 0, "questions": rows });
        (self.to_app)(&Event::Other(event.as_object().cloned().unwrap_or_default()).to_line());
    }

    /// The turn ended: the card closes. Does nothing when no question was asked.
    pub fn finish(&self, ok: bool) {
        if self.rows.lock().is_ok_and(|r| !r.is_empty()) {
            self.emit(if ok { "completed" } else { "failed" });
        }
    }

    fn ask(&self, asked: Vec<Question>) -> Result<String, String> {
        let (tx, rx) = mpsc::channel::<(String, Option<String>)>();
        let ids: Vec<String> = asked.iter().map(|_| format!("rq-{}", self.questions.next.fetch_add(1, Ordering::SeqCst) + 1)).collect();
        let first_row = {
            let mut rows = self.rows.lock().map_err(|_| "lock poisoned".to_string())?;
            let at = rows.len();
            for (id, q) in ids.iter().zip(&asked) {
                rows.push(json!({ "id": id, "prompt": q.prompt, "choices": q.choices, "state": "pending" }));
            }
            at
        };
        {
            let mut waiting = self.questions.waiting.lock().map_err(|_| "lock poisoned".to_string())?;
            for id in &ids {
                waiting.insert(id.clone(), Slot { chat: self.chat.clone(), turn: self.turn.clone(), tx: tx.clone() });
            }
        }
        self.emit("working");
        drop(tx);
        let deadline = std::time::Instant::now() + self.wait * ids.len() as u32;
        // The card settles when every question has an answer or a blank, or when the time ends.
        let mut given: HashMap<String, Option<String>> = HashMap::new();
        while given.len() < ids.len() {
            let left = deadline.saturating_duration_since(std::time::Instant::now());
            match rx.recv_timeout(left) {
                Ok((id, answer)) => {
                    given.entry(id).or_insert(answer);
                }
                Err(_) => break,
            }
        }
        let expired = given.len() < ids.len();
        let answers: Vec<Option<String>> = ids.iter().map(|id| given.get(id).cloned().flatten()).collect();
        if let Ok(mut waiting) = self.questions.waiting.lock() {
            for id in &ids {
                waiting.remove(id);
            }
        }
        if let Ok(mut rows) = self.rows.lock() {
            for (i, id) in ids.iter().enumerate() {
                let state = if answers[i].is_some() { "answered" } else if given.contains_key(id) || !expired { "skipped" } else { "expired" };
                if let Some(row) = rows.get_mut(first_row + i) {
                    row["state"] = json!(state);
                    if let Some(a) = &answers[i] {
                        row["answer"] = json!(a);
                    }
                }
            }
        }
        self.emit("working");
        let note = "Clarification only. This is not a file/system permission grant; normal policy checks still apply.";
        if answers.iter().all(Option::is_none) {
            return Ok("The user did not answer this card. Do not assume consent or a choice. Ask in your reply if it is still necessary.".into());
        }
        if asked.len() == 1 {
            return Ok(json!({ "userAnswer": answers[0], "note": note }).to_string());
        }
        let list: Vec<Value> = asked.iter().zip(&answers).map(|(q, a)| match a {
            Some(a) => json!({ "question": q.prompt, "userAnswer": a }),
            None => json!({ "question": q.prompt, "unanswered": true }),
        }).collect();
        Ok(json!({ "answers": list, "note": format!("{note} Do not assume a choice for an unanswered question.") }).to_string())
    }
}

impl ToolRunner for AskUser {
    fn specs(&self) -> Vec<ToolSpec> {
        vec![ToolSpec {
            name: "ask_user".into(),
            description: DESCRIPTION.into(),
            input_schema: json!({ "type": "object", "properties": {
                "question": { "type": "string", "description": "One question, 1–600 characters. Omit when you use questions." },
                "choices": { "type": "string", "description": "Optional newline-separated choices for question, at most four, each at most 160 characters" },
                "questions": { "type": "string", "description": "Optional, instead of question: a JSON array of 2–4 objects {\"question\": string, \"choices\": newline-separated string}, with the same limits" },
            } }),
        }]
    }

    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        if name != "ask_user" {
            return Err(format!("unknown tool {name}"));
        }
        let asked = parse_questions(input).map_err(String::from)?;
        {
            let mut count = self.asked.lock().map_err(|_| "lock poisoned".to_string())?;
            if *count + asked.len() > MAX_PER_TURN {
                return Err("At most four questions may be asked per turn. Continue with the available answers or ask in your reply.".into());
            }
            *count += asked.len();
        }
        self.ask(asked)
    }
}

/// The policy plus `ask_user`, which is always allowed: it asks, it does not act.
pub struct WithAsk<'a>(pub &'a dyn Policy);

impl Policy for WithAsk<'_> {
    fn check(&self, tool: &str, input: &Map<String, Value>) -> Decision {
        if tool == "ask_user" { Decision::Allow } else { self.0.check(tool, input) }
    }
}

/// The turn's tools plus `ask_user`.
pub struct Plus<'a>(pub &'a dyn ToolRunner, pub &'a AskUser);

impl ToolRunner for Plus<'_> {
    fn specs(&self) -> Vec<ToolSpec> {
        let mut specs = self.0.specs();
        specs.extend(self.1.specs());
        specs
    }

    fn run(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        if name == "ask_user" { self.1.run(name, input) } else { self.0.run(name, input) }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::time::Instant;

    fn tool(wait: Duration) -> (Arc<AskUser>, Arc<Questions>, mpsc::Receiver<Value>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let sink: Sink = Arc::new(move |l: &str| drop(tx.lock().unwrap().send(serde_json::from_str::<Value>(l).unwrap())));
        let q = Arc::new(Questions::default());
        (Arc::new(AskUser::new(Arc::clone(&q), sink, "c1", "t1").with_wait(wait)), q, rx)
    }

    fn input(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    /// Waits for the card event with `pending` rows and gives their ids.
    fn pending_ids(rx: &mpsc::Receiver<Value>) -> Vec<String> {
        let event = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event["type"], "chat.work");
        event["questions"].as_array().unwrap().iter().map(|r| r["id"].as_str().unwrap().to_string()).collect()
    }

    #[test]
    fn one_question_waits_for_its_answer_and_gives_it_to_the_model() {
        let (tool, q, rx) = tool(Duration::from_secs(10));
        let t = Arc::clone(&tool);
        let run = std::thread::spawn(move || t.run("ask_user", &input(json!({"question": "Which one?", "choices": "A\nB"}))));
        let ids = pending_ids(&rx);
        assert!(!q.answer("c1", "other-turn", &ids[0], Some("x")), "a wrong turn is refused");
        assert!(!q.answer("c1", "t1", "rq-999", Some("x")), "an unknown id is not ours to answer");
        assert!(q.answer("c1", "t1", &ids[0], Some("  B  ")));
        let content: Value = serde_json::from_str(&run.join().unwrap().unwrap()).unwrap();
        assert_eq!(content["userAnswer"], "B");
        let closed = rx.try_iter().last().unwrap();
        assert_eq!(closed["questions"][0]["state"], "answered");
        tool.finish(true);
        assert_eq!(rx.try_iter().last().unwrap()["state"], "completed");
    }

    #[test]
    fn a_blank_leaves_one_unanswered_and_the_text_of_the_card_says_so() {
        let (tool, q, rx) = tool(Duration::from_secs(10));
        let t = Arc::clone(&tool);
        let questions = json!([{"question": "One?"}, {"question": "Two?"}]).to_string();
        let run = std::thread::spawn(move || t.run("ask_user", &input(json!({"questions": questions}))));
        let ids = pending_ids(&rx);
        assert!(q.answer("c1", "t1", &ids[1], Some("yes")));
        assert!(q.answer("c1", "t1", &ids[0], None));
        let content: Value = serde_json::from_str(&run.join().unwrap().unwrap()).unwrap();
        assert_eq!(content["answers"][0], json!({"question": "One?", "unanswered": true}));
        assert_eq!(content["answers"][1], json!({"question": "Two?", "userAnswer": "yes"}));
    }

    #[test]
    fn no_answer_in_time_expires_and_a_bad_input_or_a_fifth_question_is_refused() {
        let (tool, _q, rx) = tool(Duration::from_millis(100));
        let started = Instant::now();
        let text = tool.run("ask_user", &input(json!({"question": "Late?"}))).unwrap();
        assert!(text.starts_with("The user did not answer this card"));
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_eq!(rx.try_iter().last().unwrap()["questions"][0]["state"], "expired");
        assert!(tool.run("ask_user", &input(json!({"question": "x", "bogus": 1}))).is_err());
        for _ in 0..3 {
            tool.run("ask_user", &input(json!({"question": "More?"}))).unwrap();
        }
        assert!(tool.run("ask_user", &input(json!({"question": "Fifth?"}))).unwrap_err().contains("At most four"));
    }
}
