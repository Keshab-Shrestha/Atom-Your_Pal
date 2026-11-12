#![allow(clippy::unwrap_used, clippy::expect_used)]
//! `write_file` and `run_command` behind the policy, with a scripted model and a fake approver. Temp-folder fixture only.
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use ark_agent::{ActionTools, Agent, Approver, Combined, Decision, FloorPolicy, Policy, ToolRunner};
use ark_llm::{Event, EventStream, LlmError, Provider, Request, Usage};
use serde_json::{Map, Value, json};

struct Script(Mutex<VecDeque<Vec<Event>>>);
impl Provider for Script {
    fn stream<'a>(&'a self, _: &'a Request) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<EventStream, LlmError>> + Send + 'a>> {
        Box::pin(async move {
            let events = self.0.lock().unwrap().pop_front().expect("script ran out");
            let items: Vec<Result<Event, LlmError>> = events.into_iter().map(Ok).collect();
            Ok(Box::pin(futures_util::stream::iter(items)) as EventStream)
        })
    }
}

struct Answer {
    yes: bool,
    asked: AtomicUsize,
}
impl Approver for Answer {
    fn approve(&self, _: &str, _: &str) -> bool {
        self.asked.fetch_add(1, Ordering::SeqCst);
        self.yes
    }
}

fn setup(name: &str) -> (PathBuf, FloorPolicy, ActionTools) {
    let dir = std::env::temp_dir().join(format!("ark-actions-{}-{name}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(dir.join("home/work/.git")).unwrap();
    let dir = std::fs::canonicalize(&dir).unwrap();
    let (home, work) = (dir.join("home"), dir.join("home/work"));
    let policy = FloorPolicy::new(&["write_file", "run_command"], &home, vec![], &work).with_write_roots(vec![work.clone()]);
    let tools = ActionTools { home, write_roots: vec![work.clone()], cwd: work };
    (dir, policy, tools)
}

fn input(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

async fn turn(policy: &FloorPolicy, tools: &dyn ToolRunner, approver: Option<&dyn Approver>, tool: &str, args: Value) -> (ark_agent::CallRecord, String) {
    let done = Event::Done { stop_reason: "x".into(), usage: Usage::default() };
    let model = Script(Mutex::new(VecDeque::from([vec![Event::ToolUse { id: "t".into(), name: tool.into(), input: args }, done.clone()], vec![Event::Text { text: "ok".into() }, done]])));
    let mut agent = Agent::new(&model, policy, tools, "m");
    agent.approver = approver;
    let out = agent.run(vec![], "go", |_| {}).await.unwrap();
    let result = out.messages.iter().flat_map(|m| &m.content).find_map(|b| if let ark_llm::Block::ToolResult { content, .. } = b { Some(content.clone()) } else { None }).unwrap();
    (out.calls[0].clone(), result)
}

#[tokio::test]
async fn a_write_asks_and_happens_only_on_yes_inside_the_granted_folder() {
    let (dir, policy, tools) = setup("write");
    let file = dir.join("home/work/a.txt");
    let yes = Answer { yes: true, asked: AtomicUsize::new(0) };
    let no = Answer { yes: false, asked: AtomicUsize::new(0) };
    let args = json!({"path": file, "content": "hello"});

    let (rec, _) = turn(&policy, &tools, Some(&no), "write_file", args.clone()).await;
    assert_eq!((no.asked.load(Ordering::SeqCst), rec.refused.is_some(), file.exists()), (1, true, false), "no: nothing written");
    let (rec, _) = turn(&policy, &tools, None, "write_file", args.clone()).await;
    assert!(rec.refused.is_some() && !file.exists(), "no approver: refused");
    let (rec, text) = turn(&policy, &tools, Some(&yes), "write_file", args).await;
    assert_eq!((rec.refused, yes.asked.load(Ordering::SeqCst), std::fs::read_to_string(&file).unwrap()), (None, 1, "hello".into()), "{text}");

    // Denied without asking: outside the granted folder, inside .git, and a path with a variable in it.
    for path in [dir.join("home/other.txt").to_string_lossy().into_owned(), dir.join("outside.txt").to_string_lossy().into_owned(), dir.join("home/work/.git/config").to_string_lossy().into_owned(), "$HOME/x".into()] {
        let before = yes.asked.load(Ordering::SeqCst);
        let (rec, _) = turn(&policy, &tools, Some(&yes), "write_file", json!({"path": path, "content": "x"})).await;
        assert!(rec.refused.is_some(), "{path}");
        assert_eq!(yes.asked.load(Ordering::SeqCst), before, "{path}: the user is not asked about a refused call");
    }
    assert!(!dir.join("home/other.txt").exists() && !dir.join("home/work/.git/config").exists());
}

#[tokio::test]
async fn a_command_asks_runs_with_a_timeout_and_a_refused_one_never_starts() {
    let (dir, policy, tools) = setup("cmd");
    let yes = Answer { yes: true, asked: AtomicUsize::new(0) };
    let (rec, out) = turn(&policy, &tools, Some(&yes), "run_command", json!({"command": "echo hi; pwd"})).await;
    assert_eq!((rec.refused, rec.is_error, yes.asked.load(Ordering::SeqCst)), (None, false, 1));
    assert!(out.contains("exit 0") && out.contains("hi") && out.contains("work"), "{out}");
    let (rec, out) = turn(&policy, &tools, Some(&yes), "run_command", json!({"command": "sh -c 'exit 3'"})).await;
    assert!(rec.refused.is_some(), "inline shell code is refused: {out}");
    let (rec, out) = turn(&policy, &tools, Some(&yes), "run_command", json!({"command": "exit 3"})).await;
    assert!(rec.is_error && out.contains("exit 3"), "{out}");
    for command in ["git push origin main", "rm -rf /tmp/x", "touch ../outside-marker; git push"] {
        let (rec, _) = turn(&policy, &tools, Some(&yes), "run_command", json!({"command": command})).await;
        assert!(rec.refused.is_some(), "{command}");
    }
    assert_eq!(yes.asked.load(Ordering::SeqCst), 2, "refused commands were not asked about");
    assert!(!dir.join("home/outside-marker").exists());
    // Direct: the tool checks again, so a caller that skips the policy still cannot start a refused command.
    assert!(tools.run("run_command", &input(json!({"command": "git push"}))).is_err());
}

#[test]
fn combined_runs_the_first_tool_that_lists_the_name() {
    let (_, _, tools) = setup("combined");
    let all = Combined(vec![Arc::new(tools)]);
    assert_eq!(all.specs().len(), 2);
    assert!(all.run("nope", &Map::new()).is_err());
}

#[test]
fn the_policy_asks_for_a_plain_command() {
    let (_, policy, _) = setup("ask");
    assert!(matches!(policy.check("run_command", &input(json!({"command": "ls"}))), Decision::Ask { .. }));
}

#[test]
fn a_command_runs_in_the_sandbox_it_writes_only_in_the_granted_folder_and_has_no_secrets_or_network() {
    let (work, _policy, tools) = setup("sandbox");
    // A place that is writable for the user but is not a granted folder or a temporary folder: this crate's own folder.
    let outside = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("sandbox-probe-{}.txt", std::process::id()));
    std::fs::remove_file(&outside).ok();
    let home = &tools.home;
    std::fs::create_dir_all(home.join(".ssh")).unwrap();
    std::fs::write(home.join(".ssh/id_test"), "secret").unwrap();
    let run = |command: &str| tools.run("run_command", &input(json!({ "command": command })));
    let inside = run("echo ok > in.txt && echo wrote");
    assert!(inside.is_ok(), "{inside:?}");
    assert_eq!(std::fs::read_to_string(tools.cwd.join("in.txt")).unwrap().trim(), "ok");
    let blocked = run(&format!("echo no > {}", outside.display()));
    let wrote = outside.exists();
    std::fs::remove_file(&outside).ok();
    assert!(blocked.is_err() && !wrote, "a write outside the granted folders must fail: {blocked:?}");
    assert!(run("cat ../.ssh/id_test").is_err(), "secret folders are not readable");
    let net = run("/usr/bin/nc -z -w 2 1.1.1.1 80 && echo connected");
    assert!(!net.is_ok_and(|o| o.contains("connected")), "no network");
    // The environment is small: a key in the parent environment does not reach the command.
    // SAFETY: this test sets a variable with its own name, and no other test reads it.
    unsafe { std::env::set_var("ARK_TEST_SECRET_TOKEN", "leak") };
    let env = run("env").unwrap();
    assert!(!env.contains("ARK_TEST_SECRET_TOKEN") && env.contains("PATH="));
    let _ = work;
}
