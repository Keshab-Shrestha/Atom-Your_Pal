//! The runner of queued tasks on `ark-agent` (ADR-278 Phase 4, step 2). Port of `tinker-runner.ts`, widened to every helper's
//! queued task that has no chat: it listens on the change bus, claims a queued task (`helpers_life::start`), runs one agent
//! turn with the helper's soul as the system text, and ends the task with a report or an error. A stop or a delete on the bus
//! cancels the run and drops its late result. The model, the tools and the policy come from the caller (a scripted provider in
//! the tests). The delegation gate of a child task (`ark_core::org::delegation_problem`) is not wired yet.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ark_agent::{Agent, Policy, ToolRunner};
use ark_core::jobs::JobState;
use ark_llm::{Event, Provider};
use rusqlite::Connection;
use serde_json::json;

use crate::helpers_bus::{Bus, Change};
use crate::{helpers_life, helpers_roster};

/// A task makes one run; it is stopped after this long (`TINKER_TIME_LIMIT_MS`).
pub const TIME_LIMIT: Duration = Duration::from_secs(15 * 60);
const SUMMARY_CHARS: usize = 240;
const TITLE_CHARS: usize = 80;
const CANCEL_POLL: Duration = Duration::from_millis(25);

pub struct Runner {
    db: PathBuf,
    agents: PathBuf,
    provider: Arc<dyn Provider>,
    tools: Arc<dyn ToolRunner>,
    policy: Arc<dyn Policy>,
    model: String,
    time_limit: Duration,
    running: Mutex<HashMap<i64, Arc<AtomicBool>>>,
    bus: Arc<Bus>,
}

impl std::fmt::Debug for Runner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Runner")
    }
}

/// How a run ended.
enum Ended {
    Report(String),
    Error(String),
    Cancelled,
}

fn cut(text: &str, chars: usize) -> String {
    text.chars().take(chars).collect()
}

impl Runner {
    pub fn new(db: PathBuf, provider: Arc<dyn Provider>, tools: Arc<dyn ToolRunner>, policy: Arc<dyn Policy>, model: &str, bus: Arc<Bus>) -> Arc<Runner> {
        let agents = db.parent().map_or_else(|| PathBuf::from("agents"), |p| p.join("agents"));
        Arc::new(Runner { db, agents, provider, tools, policy, model: model.into(), time_limit: TIME_LIMIT, running: Mutex::default(), bus })
    }

    /// A runner with a shorter time limit (tests).
    #[must_use]
    pub fn with_time_limit(self: Arc<Self>, limit: Duration) -> Arc<Runner> {
        match Arc::try_unwrap(self) {
            Ok(mut runner) => {
                runner.time_limit = limit;
                Arc::new(runner)
            }
            Err(shared) => shared,
        }
    }

    /// Listens on the bus: a new queued task starts, a stop or delete ends a run. Returns the subscription number.
    pub fn listen(self: &Arc<Self>) -> u64 {
        let runner = self.clone();
        self.bus.subscribe(move |change: &Change| runner.heard(change))
    }

    fn heard(self: &Arc<Self>, change: &Change) {
        let state = change["state"].as_str();
        match (change["action"].as_str(), state) {
            (Some("job"), Some("queued")) => self.schedule(),
            (Some("job"), Some("stopped")) | (Some("deleted"), _) => self.cancel(change["job"].as_i64().unwrap_or(0)),
            _ => {}
        }
    }

    fn cancel(&self, id: i64) {
        if let Some(flag) = self.running.lock().ok().and_then(|r| r.get(&id).cloned()) {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// Starts every queued task that has no chat, is not interrupted and waits for nothing. Runs each on its own thread.
    pub fn schedule(self: &Arc<Self>) {
        let Ok(conn) = crate::store::open_read_write(&self.db) else { return };
        let ids: Vec<i64> = conn
            .prepare("SELECT id FROM jobs WHERE state = 'queued' AND chat_id IS NULL AND COALESCE(interrupted, 0) = 0 AND retry_of IS NULL ORDER BY id")
            .and_then(|mut s| s.query_map([], |r| r.get(0)).and_then(Iterator::collect))
            .unwrap_or_default();
        for id in ids {
            let Ok(mut running) = self.running.lock() else { return };
            if running.contains_key(&id) {
                continue;
            }
            let flag = Arc::new(AtomicBool::new(false));
            running.insert(id, flag.clone());
            drop(running);
            let runner = self.clone();
            std::thread::spawn(move || {
                runner.drive(id, &flag);
                if let Ok(mut running) = runner.running.lock() {
                    running.remove(&id);
                }
                runner.bus.emit(&json!({ "action": "runner", "job": id }));
            });
        }
    }

    fn paused(&self, conn: &Connection, helper: &str) -> bool {
        helpers_roster::roster(conn, &self.agents)
            .and_then(|(members, _)| members.into_iter().find(|m| m.id == helper))
            .and_then(|m| helpers_roster::member_core(conn, &m))
            .is_some_and(|v| v["paused"] == true)
    }

    fn system_text(conn: &Connection, helper: &str) -> String {
        helpers_roster::current(conn, helper).map_or_else(String::new, |(soul, _)| {
            format!("You are {}.\nPersonality: {}\nHow you work: {}\nRules: {}\nLessons: {}\nEnd with a short report.", soul.name, soul.personality, soul.how_it_works, soul.rules, soul.lessons)
        })
    }

    fn drive(&self, id: i64, cancel: &Arc<AtomicBool>) {
        let Ok(conn) = crate::store::open_read_write(&self.db) else { return };
        let Some(job) = helpers_life::get(&conn, id) else { return };
        let paused = self.paused(&conn, &job.helper);
        if helpers_life::start(&conn, id, paused).is_err() {
            return; // stopped, deleted, paused or still waiting: nothing to run
        }
        let system = Self::system_text(&conn, &job.helper);
        let ended = self.run_turn(&conn, id, &system, &job.task, cancel);
        // Stopped or deleted: the store already says so, and the result is dropped.
        if helpers_life::get(&conn, id).is_none_or(|j| j.state != JobState::Running) {
            return;
        }
        let saved = match ended {
            Ended::Cancelled => helpers_life::stop(&conn, id).map(|_| ()),
            Ended::Error(message) => helpers_life::fail(&conn, id, &message, false),
            Ended::Report(text) => {
                let first = text.lines().find(|l| !l.trim().is_empty()).unwrap_or("Report");
                helpers_life::finish(&conn, id, &cut(first.trim_start_matches('#').trim(), TITLE_CHARS), &cut(&text, SUMMARY_CHARS), &text, &json!([]), false)
                    // A report the store refuses still ends the task.
                    .or_else(|e| helpers_life::fail(&conn, id, &e, false))
            }
        };
        if saved.is_err() {
            helpers_life::stop(&conn, id).ok();
        }
    }

    fn run_turn(&self, conn: &Connection, id: i64, system: &str, task: &str, cancel: &Arc<AtomicBool>) -> Ended {
        let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_time().build() else { return Ended::Error("The task could not run.".into()) };
        let mut agent = Agent::new(self.provider.as_ref(), self.policy.as_ref(), self.tools.as_ref(), &self.model);
        agent.system = Some(system.to_string());
        let mut line = String::new();
        let turn = agent.run(Vec::new(), task, |event| {
            if let Event::Text { text } = event {
                line.push_str(text);
                let last = line.lines().last().unwrap_or("").trim().to_string();
                if !last.is_empty() && helpers_life::step(conn, id, &cut(&last, 120)) {
                    self.bus.emit(&json!({ "action": "step", "job": id }));
                }
            }
        });
        let watch = async {
            while !cancel.load(Ordering::SeqCst) {
                tokio::time::sleep(CANCEL_POLL).await;
            }
        };
        rt.block_on(async {
            tokio::select! {
                result = tokio::time::timeout(self.time_limit, turn) => match result {
                    Err(_) => Ended::Error(format!("Took longer than {} minutes", (self.time_limit.as_secs() / 60).max(1))),
                    Ok(Err(e)) => Ended::Error(e.to_string()),
                    Ok(Ok(out)) if out.text.trim().is_empty() => Ended::Error("The helper ended without a report.".into()),
                    Ok(Ok(out)) => Ended::Report(out.text),
                },
                () = watch => Ended::Cancelled,
            }
        })
    }

    /// Whether a run is going for this task.
    pub fn is_running(&self, id: i64) -> bool {
        self.running.lock().is_ok_and(|r| r.contains_key(&id))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use crate::helpers_bus::Tail;
    use ark_agent::{FloorPolicy, RuntimeTools, tools::Tools};
    use ark_llm::{EventStream, LlmError, Request, Usage};
    use futures_util::future::BoxFuture;

    /// Answers with `text`; `hang` never answers (a run that only a stop ends).
    struct Script {
        text: &'static str,
        hang: bool,
    }
    impl Provider for Script {
        fn stream<'a>(&'a self, _: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
            let items = vec![Ok(Event::Text { text: self.text.into() }), Ok(Event::Done { stop_reason: "end_turn".into(), usage: Usage::default() })];
            let hang = self.hang;
            Box::pin(async move {
                if hang {
                    std::future::pending::<()>().await;
                }
                Ok(Box::pin(futures_util::stream::iter(items)) as EventStream)
            })
        }
    }

    fn setup(name: &str, provider: Script) -> (PathBuf, Arc<Runner>, Arc<Bus>) {
        let dir = std::env::temp_dir().join(format!("ark-runner-{name}-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        let db = dir.join("helpers.db");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/helpers.db"), &db).unwrap();
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("DELETE FROM jobs; DELETE FROM job_blockers; DELETE FROM job_events; DELETE FROM reports; DELETE FROM audit_log").unwrap();
        let home = std::env::temp_dir();
        let tools = Arc::new(RuntimeTools(Tools { home: home.clone(), roots: vec![], cwd: home.clone() }));
        let policy = Arc::new(FloorPolicy::new(&[], &home, vec![], &home));
        let bus = Arc::new(Bus::default());
        let runner = Runner::new(db.clone(), Arc::new(provider), tools, policy, "m", bus.clone());
        (db, runner, bus)
    }

    fn wait_for(conn: &Connection, id: i64, state: &str) {
        for _ in 0..200 {
            let now: String = conn.query_row("SELECT state FROM jobs WHERE id = ?", [id], |r| r.get(0)).unwrap();
            if now == state {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("task {id} did not reach {state}");
    }

    #[test]
    fn a_queued_task_runs_to_a_report_when_the_bus_says_queued() {
        let (db, runner, bus) = setup("ok", Script { text: "# Found X\nX is 42.", hang: false });
        runner.listen();
        let conn = crate::store::open_read_write(&db).unwrap();
        let mut tail = Tail::default();
        tail.poll(&conn, &bus); // marks the end of the log
        let id = helpers_life::add_job(&conn, "sid", Some(("Sid", true, "researcher")), "Find X", &[], false).unwrap();
        tail.poll(&conn, &bus); // the audit row reaches the bus: the runner starts
        wait_for(&conn, id, "done");
        let (title, body): (String, String) = conn.query_row("SELECT title, body FROM reports WHERE job_id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(title, "Found X");
        assert!(body.contains("42"));
    }

    #[test]
    fn a_stop_on_the_bus_ends_the_run_and_drops_its_result() {
        let (db, runner, bus) = setup("stop", Script { text: "late", hang: true });
        runner.listen();
        let conn = crate::store::open_read_write(&db).unwrap();
        let mut tail = Tail::default();
        tail.poll(&conn, &bus);
        let id = helpers_life::add_job(&conn, "sid", Some(("Sid", true, "researcher")), "Slow", &[], false).unwrap();
        tail.poll(&conn, &bus);
        wait_for(&conn, id, "running");
        helpers_life::stop(&conn, id).unwrap();
        tail.poll(&conn, &bus);
        wait_for(&conn, id, "stopped");
        for _ in 0..100 {
            if !runner.is_running(id) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(!runner.is_running(id));
        let reports: i64 = conn.query_row("SELECT COUNT(*) FROM reports", [], |r| r.get(0)).unwrap();
        assert_eq!(reports, 0);
    }

    #[test]
    fn a_run_past_the_time_limit_fails_and_is_retried_once() {
        let (db, runner, bus) = setup("slow", Script { text: "x", hang: true });
        let runner = runner.with_time_limit(Duration::from_millis(100));
        runner.listen();
        let conn = crate::store::open_read_write(&db).unwrap();
        let mut tail = Tail::default();
        tail.poll(&conn, &bus);
        let id = helpers_life::add_job(&conn, "sid", Some(("Sid", true, "researcher")), "Slow", &[], false).unwrap();
        for _ in 0..200 {
            tail.poll(&conn, &bus);
            let (state, retries, error): (String, i64, Option<String>) = conn.query_row("SELECT state, COALESCE(auto_retries, 0), error FROM jobs WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
            if state == "failed" && retries == 1 {
                assert!(error.unwrap().starts_with("Took longer than"));
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("the task did not fail after its one retry");
    }
}
