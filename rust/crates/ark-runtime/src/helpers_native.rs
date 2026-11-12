//! `helpers.list` answered by Rust (ADR-278 Phase 4, slice 6), opt-in with `ARK_HELPERS_NATIVE=1`. Rust builds the event
//! from `helpers.db` (`helpers_event::build`) and takes the parts that only Node knows from the last `helpers` event Node
//! sent. Until Node has sent one, `helpers.list` goes to Node. Node keeps sending changes after that first answer, so the
//! stuck dot of a task still shows. Writes (`job.*`, `skill.*`) stay in Node: its runner and Telegram listen to them.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::helpers_bus::{Bus, Tail};
use crate::helpers_runner::Runner;
use crate::{helpers_event, helpers_life, helpers_roster, helpers_write};

/// Where the helpers file and the agent folders are.
#[derive(Debug)]
pub struct HelpersNative {
    db: PathBuf,
    agents: PathBuf,
    cached: Mutex<Option<Value>>,
    host: helpers_event::Host,
    bus: Arc<Bus>,
    tail: Mutex<Tail>,
    runner: Mutex<Option<Arc<Runner>>>,
    quiet: crate::helpers_quiet::Quiet,
}

impl HelpersNative {
    /// `db` is the helpers file; the agents folder is `agents` beside it (as in `runtime.ts`).
    pub fn new(db: PathBuf) -> HelpersNative {
        let agents = db.parent().map_or_else(|| PathBuf::from("agents"), |p| p.join("agents"));
        let host = helpers_event::Host::of_this_mac(&db);
        let native = HelpersNative { db, agents, cached: Mutex::new(None), host, bus: Arc::new(Bus::default()), tail: Mutex::new(Tail::default()), runner: Mutex::new(None), quiet: crate::helpers_quiet::Quiet::default() };
        native.quiet.listen(&native.bus, native.db.clone());
        native.pump(); // marks the end of the audit log: only later changes reach the listeners
        native
    }

    /// With a runner attached, Rust owns the life of a task: `job.add`, `job.retry`, `job.steer`, `job.interrupt`, `job.fresh`,
    /// `job.stop` and `job.delete` of a task that runs (the runner starts what is queued). Without one they stay in Node.
    pub fn attach_runner(&self, runner: Arc<Runner>) {
        runner.listen_once(&self.bus);
        if let Ok(mut slot) = self.runner.lock() {
            *slot = Some(runner);
        }
    }

    /// Attaches the runner with the chat engine's model parts, and starts what waits in the queue.
    pub fn attach_chat_runner(&self, chat: &crate::chat::Chat) {
        let runner = Runner::new(self.db.clone(), chat.provider.clone(), chat.tools.clone(), chat.policy.clone(), &chat.model, self.bus.clone());
        self.attach_runner(runner.clone());
        runner.schedule();
    }

    /// The folder of the kept file copies (`checkpoints` beside the helpers file, as in `runtime.ts`).
    fn checkpoints_dir(&self) -> PathBuf {
        self.db.parent().map_or_else(|| PathBuf::from("checkpoints"), |p| p.join("checkpoints"))
    }

    /// The writes that touch files: `job.undo`, `job.delete` of an ended task that kept file copies, and the skill decisions.
    fn files(&self, conn: &rusqlite::Connection, command: &Value) -> Option<()> {
        match command["type"].as_str()? {
            "skill.approve" | "skill.edit.accept" | "skill.edit.undo" => crate::helpers_skills::apply(conn, command, self.host.ark_skills.as_deref()?, &self.host.user_skills),
            "job.undo" => crate::helpers_checkpoints::undo_job(conn, &self.checkpoints_dir(), self.host.home.as_deref()?, command),
            "job.delete" => {
                let id = command["id"].as_i64()?;
                let job = helpers_life::get(conn, id).filter(|j| j.state.is_final())?;
                let copies: i64 = conn.query_row("SELECT COUNT(*) FROM checkpoints WHERE job_id = ?", [id], |r| r.get(0)).ok()?;
                if copies == 0 || !helpers_life::remove(conn, job.id).ok()? {
                    return None;
                }
                crate::helpers_checkpoints::forget_dir(&self.checkpoints_dir(), id);
                Some(())
            }
            _ => None,
        }
    }

    /// The change a life command asks for, in one write; `None` for another command or a refusal (Node gives the words).
    fn life(&self, conn: &rusqlite::Connection, command: &Value) -> Option<()> {
        self.runner.lock().ok()?.as_ref()?;
        let id = command["id"].as_i64();
        match command["type"].as_str()? {
            "job.add" => {
                let helper = command["helper"].as_str()?;
                let (members, _) = helpers_roster::roster(conn, &self.agents)?;
                let member = members.iter().find(|m| m.id == helper)?;
                let core = helpers_roster::member_core(conn, member)?;
                let name = core["name"].as_str()?.to_string();
                let blockers: Vec<i64> = command["blockedBy"].as_array().map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
                let available = core["available"] == true;
                helpers_life::add_job(conn, helper, Some((&name, available, &member.role)), command["task"].as_str()?, &blockers, command["planFirst"] == true).ok().map(|_| ())
            }
            "job.retry" => helpers_life::retry(conn, id?).ok(),
            "job.fresh" => helpers_life::fresh(conn, id?).ok(),
            "job.interrupt" => helpers_life::interrupt(conn, id?).ok(),
            "job.steer" => helpers_life::comment(conn, id?, command["text"].as_str()?).ok(),
            "job.stop" => helpers_life::stop(conn, id?).ok().filter(|stopped| !stopped.is_empty()).map(|_| ()),
            // A task that ended is deleted by `helpers_write` (it knows the kept file copies); one that runs is stopped first.
            "job.delete" => {
                let job = helpers_life::get(conn, id?).filter(|j| !j.state.is_final())?;
                helpers_life::remove(conn, job.id).ok().filter(|gone| *gone).map(|_| ())?;
                crate::helpers_checkpoints::forget_dir(&self.checkpoints_dir(), job.id);
                Some(())
            }
            _ => None,
        }
    }

    /// A task became quiet since the last call: the new `helpers` event for the app (the stuck dot shows without a request).
    pub fn quiet_event(&self) -> Option<String> {
        let conn = helpers_event::open_read_only(&self.db)?;
        if self.quiet.sweep(&conn).is_empty() {
            return None;
        }
        let cached = self.cached.lock().ok()?.clone()?;
        let event = helpers_event::build_with(&conn, &self.agents, &jiff::Zoned::now(), &cached, &self.host, Some(&self.quiet))?;
        Some(format!("{event}\n"))
    }

    /// The change bus: the runner, Telegram and the workflows listen here (`HelperStore.onChange` of the TypeScript).
    pub fn bus(&self) -> Arc<Bus> {
        self.bus.clone()
    }

    /// Gives the listeners the changes that the audit log gained, from Node or from Rust. Call it often (the feed thread does).
    pub fn pump(&self) -> usize {
        let (Some(conn), Ok(mut tail)) = (helpers_event::open_read_only(&self.db), self.tail.lock()) else { return 0 };
        tail.poll(&conn, &self.bus)
    }

    /// The helpers file of the runtime started in `folder`: `ARK_HELPERS_FILE` (default `data/helpers.db`), when
    /// `ARK_HELPERS_NATIVE=1`.
    pub fn from_environment(folder: &Path, env: impl Fn(&str) -> Option<String>) -> Option<HelpersNative> {
        // On by default with the Rust runtime and its native chat: nothing else would run the queued tasks.
        let rust_chat = env("ARK_RUNTIME").as_deref() == Some("rust") && env("ARK_RUNTIME_NATIVE_CHAT").as_deref() == Some("1");
        if env("ARK_HELPERS_NATIVE").as_deref() != Some("1") && !(rust_chat && env("ARK_HELPERS_NATIVE").as_deref() != Some("0")) {
            return None;
        }
        Some(HelpersNative::new(folder.join(env("ARK_HELPERS_FILE").unwrap_or_else(|| "data/helpers.db".into()))))
    }

    /// A line Node sent to the app: a `helpers` event is kept for the parts Node alone knows.
    pub fn observe(&self, line: &str) {
        if !line.starts_with("{\"type\":\"helpers\"") {
            return;
        }
        if let (Ok(value), Ok(mut cached)) = (serde_json::from_str::<Value>(line), self.cached.lock()) {
            *cached = Some(value);
        }
    }

    /// The line for the app when `line` is `helpers.list`, or a write Rust does itself (`helpers_write`), and Rust can build
    /// the event; `None` sends the line to Node. A write is made only when the event can be built after it, so the app
    /// never waits for a push that Node does not know about.
    pub fn answer(&self, line: &str) -> Option<String> {
        if !["\"helpers.list\"", "\"job.", "\"skill.", "\"proposal.", "\"helper.planFirst\"", "\"helper.browser\"", "\"agent.pause\"", "\"helpers.settings\"", "\"routine.", "\"mcp.set\"", "\"mcp.add\"", "\"mcp.remove\""].iter().any(|k| line.contains(k)) {
            return None;
        }
        let command: Value = serde_json::from_str(line).ok()?;
        let cached = self.cached.lock().ok()?.clone()?;
        if command["type"] != "helpers.list" {
            let conn = crate::store::open_read_write(&self.db).ok()?;
            if self.life(&conn, &command).is_none() && self.files(&conn, &command).is_none() && crate::helpers_settings::apply(&conn, &command).is_none() && crate::helpers_routine_edit::apply(&conn, &command, &self.agents).is_none() && crate::helpers_mcp_edit::apply(&conn, &command, &self.agents).is_none() {
                helpers_write::apply(&conn, &command)?;
            }
            self.pump();
        }
        let conn = helpers_event::open_read_only(&self.db)?;
        let event = helpers_event::build_with(&conn, &self.agents, &jiff::Zoned::now(), &cached, &self.host, Some(&self.quiet))?;
        Some(format!("{event}\n"))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("ark-helpers-native-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/helpers.db"), dir.join("helpers.db")).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/org.json"), dir.join("org.json")).unwrap();
        for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/agents")).unwrap() {
            let id = entry.unwrap().file_name();
            std::fs::create_dir_all(dir.join("agents").join(&id)).unwrap();
            std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/agents/").to_string() + &id.to_string_lossy() + "/soul.md", dir.join("agents").join(&id).join("soul.md")).unwrap();
        }
        dir
    }

    #[test]
    fn it_is_off_unless_asked_and_goes_to_node_until_node_sent_an_event() {
        assert!(HelpersNative::from_environment(Path::new("/x"), |_| None).is_none());
        let dir = scratch();
        let on = |name: &str| match name {
            "ARK_HELPERS_NATIVE" => Some("1".to_string()),
            "ARK_HELPERS_FILE" => Some("helpers.db".to_string()),
            _ => None,
        };
        let mut native = HelpersNative::from_environment(&dir, on).unwrap();
        native.host.app_dirs = Vec::new();
        native.host.home = None;
        native.host.user_skills = dir.join("none");
        let heard = Arc::new(Mutex::new(Vec::<Value>::new()));
        let sink = heard.clone();
        native.bus().subscribe(move |c| sink.lock().unwrap().push(c.clone()));
        assert!(native.answer("{\"type\":\"helpers.list\"}\n").is_none(), "no event from Node yet");
        native.observe("{\"type\":\"helpers\",\"apps\":[\"Safari\"],\"models\":[],\"skills\":[]}\n");
        let line = native.answer("{\"type\":\"helpers.list\"}\n").unwrap();
        let event: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(event["type"], "helpers");
        assert_eq!(event["apps"], serde_json::json!(["Finder"]), "the apps come from the folders, not from Node");
        assert_eq!(event["helpers"].as_array().unwrap().len(), 10);
        assert!(native.answer("{\"type\":\"job.stop\",\"id\":1}\n").is_none(), "stop stays in Node");
        // A write: the label is saved and the new event carries it.
        let line = native.answer("{\"type\":\"job.label.add\",\"id\":8,\"label\":\"Fresh\"}\n").unwrap();
        let event: Value = serde_json::from_str(&line).unwrap();
        let labels: Vec<&Value> = event["helpers"].as_array().unwrap().iter().flat_map(|h| h["jobs"].as_array().unwrap()).filter(|j| j["id"] == 8).map(|j| &j["labels"]).collect();
        assert_eq!(labels, [&serde_json::json!(["fresh"])]);
        assert_eq!(heard.lock().unwrap().len(), 1, "the label change reached the bus once");
        assert_eq!(heard.lock().unwrap()[0]["action"], "label");
        assert!(native.answer("{\"type\":\"job.delete\",\"id\":4}\n").is_none(), "a task that has not ended goes to Node");
    }

    #[test]
    fn the_rust_runtime_with_native_chat_turns_it_on_unless_told_not_to() {
        let env = |off: Option<&'static str>| move |n: &str| match n {
            "ARK_RUNTIME" => Some("rust".to_string()),
            "ARK_RUNTIME_NATIVE_CHAT" => Some("1".to_string()),
            "ARK_HELPERS_NATIVE" => off.map(String::from),
            _ => None,
        };
        let folder = std::env::temp_dir().join("ark-default-on");
        assert!(HelpersNative::from_environment(&folder, env(None)).is_some());
        assert!(HelpersNative::from_environment(&folder, env(Some("0"))).is_none());
    }

    #[test]
    fn with_a_runner_job_add_is_made_and_run_by_rust() {
        use ark_agent::{FloorPolicy, RuntimeTools, tools::Tools};
        use ark_llm::{Event, EventStream, LlmError, Provider, Request, Usage};
        use futures_util::future::BoxFuture;
        struct Done;
        impl Provider for Done {
            fn stream<'a>(&'a self, _: &'a Request) -> BoxFuture<'a, Result<EventStream, LlmError>> {
                let items = vec![Ok(Event::Text { text: "All done.".into() }), Ok(Event::Done { stop_reason: "end_turn".into(), usage: Usage::default() })];
                Box::pin(async move { Ok(Box::pin(futures_util::stream::iter(items)) as EventStream) })
            }
        }
        let dir = scratch();
        let on = |name: &str| match name {
            "ARK_HELPERS_NATIVE" => Some("1".to_string()),
            "ARK_HELPERS_FILE" => Some("helpers.db".to_string()),
            _ => None,
        };
        let mut native = HelpersNative::from_environment(&dir, on).unwrap();
        native.host.app_dirs = Vec::new();
        native.host.home = None;
        native.host.user_skills = dir.join("none");
        native.observe("{\"type\":\"helpers\",\"apps\":[],\"models\":[],\"skills\":[]}\n");
        assert!(native.answer("{\"type\":\"job.add\",\"helper\":\"sid\",\"task\":\"x\"}\n").is_none(), "no runner: Node adds it");
        let home = std::env::temp_dir();
        let tools = Arc::new(RuntimeTools(Tools { home: home.clone(), roots: vec![], cwd: home.clone() }));
        let policy = Arc::new(FloorPolicy::new(&[], &home, vec![], &home));
        native.attach_runner(Runner::new(dir.join("helpers.db"), Arc::new(Done), tools, policy, "m", native.bus()));
        let line = native.answer("{\"type\":\"job.add\",\"helper\":\"sid\",\"task\":\"Find it\"}\n").unwrap();
        let event: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(event["type"], "helpers");
        let conn = rusqlite::Connection::open(dir.join("helpers.db")).unwrap();
        let id: i64 = conn.query_row("SELECT MAX(id) FROM jobs WHERE task = 'Find it'", [], |r| r.get(0)).unwrap();
        for _ in 0..200 {
            native.pump();
            let state: String = conn.query_row("SELECT state FROM jobs WHERE id = ?", [id], |r| r.get(0)).unwrap();
            if state == "done" {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        panic!("the task did not finish");
    }
}
