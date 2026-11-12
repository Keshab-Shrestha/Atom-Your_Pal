#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The agent loop against a scripted fake provider. No network, no model.
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;

use ark_agent::{Agent, AgentError, FloorPolicy, Policy, RuntimeTools, ToolRunner};
use ark_llm::{Block, Event, EventStream, LlmError, Provider, Request, Usage};
use serde_json::{Value, json};

/// Gives the scripted events of one answer per call, and keeps each request it saw.
struct Script {
    answers: Mutex<VecDeque<Result<Vec<Event>, String>>>,
    seen: Mutex<Vec<Request>>,
}

impl Script {
    fn new(answers: Vec<Result<Vec<Event>, String>>) -> Self {
        Self { answers: Mutex::new(answers.into()), seen: Mutex::default() }
    }
}

impl Provider for Script {
    fn stream<'a>(&'a self, req: &'a Request) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EventStream, LlmError>> + Send + 'a>> {
        Box::pin(async move {
            self.seen.lock().unwrap().push(req.clone());
            let next = self.answers.lock().unwrap().pop_front().expect("the script ran out");
            let events = next.map_err(LlmError::Http)?;
            let items: Vec<Result<Event, LlmError>> = events.into_iter().map(Ok).collect();
            Ok(Box::pin(futures_util::stream::iter(items)) as EventStream)
        })
    }
}

fn done(reason: &str) -> Event {
    Event::Done { stop_reason: reason.into(), usage: Usage { input_tokens: 10, output_tokens: 5 } }
}

fn call(id: &str, name: &str, input: Value) -> Event {
    Event::ToolUse { id: id.into(), name: name.into(), input }
}

fn text(t: &str) -> Event {
    Event::Text { text: t.into() }
}

struct Fixture {
    dir: PathBuf,
}

fn fixture(name: &str) -> Fixture {
    let dir = std::env::temp_dir().join(format!("ark-agent-{}-{name}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(dir.join("home/work")).unwrap();
    std::fs::write(dir.join("home/work/note.txt"), "the secret plan is tea").unwrap();
    std::fs::write(dir.join("outside.txt"), "not yours").unwrap();
    Fixture { dir: std::fs::canonicalize(&dir).unwrap() }
}

fn parts(f: &Fixture) -> (FloorPolicy, RuntimeTools) {
    let home = f.dir.join("home");
    let roots = vec![home.join("work")];
    let tools = ark_runtime::tools::Tools { home: home.clone(), roots: roots.clone(), cwd: home.clone() };
    (FloorPolicy::new(&["current_time", "read_file"], &home, roots, &home), RuntimeTools(tools))
}

fn results(req: &Request) -> Vec<(String, bool)> {
    req.messages
        .iter()
        .flat_map(|m| &m.content)
        .filter_map(|b| if let Block::ToolResult { content, is_error, .. } = b { Some((content.clone(), *is_error)) } else { None })
        .collect()
}

#[tokio::test]
async fn tool_call_round_trip_reads_an_allowed_file() {
    let f = fixture("ok");
    let (policy, tools) = parts(&f);
    let path = f.dir.join("home/work/note.txt").to_string_lossy().into_owned();
    let model = Script::new(vec![
        Ok(vec![text("Let me look. "), call("t1", "read_file", json!({"path": path})), done("tool_use")]),
        Ok(vec![text("The plan is tea."), done("end_turn")]),
    ]);
    let agent = Agent::new(&model, &policy, &tools, "m");
    let mut live = String::new();
    let out = agent.run(vec![], "what is in my note?", |e| if let Event::Text { text } = e { live.push_str(text) }).await.unwrap();
    assert_eq!(out.text, "The plan is tea.");
    assert_eq!(live, "Let me look. The plan is tea.");
    assert_eq!((out.calls.len(), out.calls[0].refused.clone(), out.calls[0].is_error), (1, None, false));
    assert_eq!(results(&model.seen.lock().unwrap()[1]), vec![("the secret plan is tea".to_string(), false)]);
    assert_eq!(model.seen.lock().unwrap()[0].tools.len(), 2);
    assert_eq!((out.usage.input_tokens, out.usage.output_tokens), (20, 10));
    assert_eq!(out.messages.len(), 4); // user, assistant(tool_use), user(tool_result), assistant
}

#[tokio::test]
async fn policy_refuses_outside_paths_and_unknown_tools_and_the_tool_never_runs() {
    let f = fixture("deny");
    let (policy, inner) = parts(&f);
    struct Counting<'a>(&'a RuntimeTools, Mutex<Vec<String>>);
    impl ToolRunner for Counting<'_> {
        fn specs(&self) -> Vec<ark_llm::ToolSpec> {
            self.0.specs()
        }
        fn run(&self, name: &str, input: &serde_json::Map<String, Value>) -> Result<String, String> {
            self.1.lock().unwrap().push(name.into());
            self.0.run(name, input)
        }
    }
    let tools = Counting(&inner, Mutex::default());
    let outside = f.dir.join("outside.txt").to_string_lossy().into_owned();
    let model = Script::new(vec![
        Ok(vec![
            call("a", "read_file", json!({"path": outside})),
            call("b", "run_shell", json!({"command": "rm -rf /"})),
            call("c", "read_file", json!({"path": "~/.ssh/id_rsa"})),
            done("tool_use"),
        ]),
        Ok(vec![text("I could not do that."), done("end_turn")]),
    ]);
    let out = Agent::new(&model, &policy, &tools, "m").run(vec![], "go", |_| {}).await.unwrap();
    assert!(tools.1.lock().unwrap().is_empty(), "no refused call reached a tool");
    assert_eq!(out.calls.iter().map(|c| c.refused.is_some()).collect::<Vec<_>>(), vec![true, true, true]);
    let seen = model.seen.lock().unwrap();
    let r = results(&seen[1]);
    assert!(r.iter().all(|(c, err)| *err && c.starts_with("Refused by policy: ")), "{r:?}");
    assert!(r[1].0.contains("run_shell is not allowed"));
}

#[tokio::test]
async fn a_tool_error_goes_back_to_the_model_and_current_time_runs() {
    let f = fixture("err");
    let (policy, tools) = parts(&f);
    let model = Script::new(vec![
        Ok(vec![call("a", "current_time", json!({"timezone": "Mars/Base"})), call("b", "current_time", json!({"timezone": "UTC"})), done("tool_use")]),
        Ok(vec![text("done"), done("end_turn")]),
    ]);
    let out = Agent::new(&model, &policy, &tools, "m").run(vec![], "time?", |_| {}).await.unwrap();
    let r = results(&model.seen.lock().unwrap()[1]);
    assert_eq!(r[0], ("\"Mars/Base\" is not a time zone name".to_string(), true));
    assert!(r[1].0.ends_with("UTC") && !r[1].1);
    assert_eq!(out.calls.iter().map(|c| c.is_error).collect::<Vec<_>>(), vec![true, false]);
}

#[tokio::test]
async fn step_limit_and_provider_errors_stop_the_turn() {
    let f = fixture("limit");
    let (policy, tools) = parts(&f);
    let again = || Ok(vec![call("a", "current_time", json!({})), done("tool_use")]);
    let model = Script::new(vec![again(), again(), again()]);
    let mut agent = Agent::new(&model, &policy, &tools, "m");
    agent.max_steps = 3;
    assert!(matches!(agent.run(vec![], "loop", |_| {}).await, Err(AgentError::TooManySteps(3))));

    let broken = Script::new(vec![Err("offline".into())]);
    assert!(matches!(Agent::new(&broken, &policy, &tools, "m").run(vec![], "hi", |_| {}).await, Err(AgentError::Llm(LlmError::Http(_)))));
    let _: &dyn Policy = &policy;
}
