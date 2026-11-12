//! The workflow listener on the Rust change bus (ADR-278 Phase 4): a port of the `helpers.onChange` block in `apps/mac/src/runtime.ts`
//! that starts the published workflows whose trigger is a Board task that fails or finishes. A task of a workflow's own run (chat
//! `workflow-…`) never starts another, and one workflow starts at most once in five minutes. What a start does (the hidden turn that
//! calls `plan_work`) is the `run` function of the caller: the runtime hands it the workflow and the cause.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde_json::Value;

use crate::helpers_bus::Bus;

/// The least time between two event starts of one workflow.
const EVENT_GAP_MS: i64 = 5 * 60_000;

/// Starts what `run` gets: the workflow and why (`task #3 failed`).
pub type Run = Arc<dyn Fn(&Value, &str) + Send + Sync>;

/// `eventWorkflows` with the five-minute gap: the workflows that `event` starts now, each marked as started at `now_ms`.
#[derive(Debug, Default)]
pub struct EventStarts {
    last: Mutex<HashMap<String, i64>>,
}

impl EventStarts {
    pub fn due(&self, list: &[Value], event: &str, now_ms: i64) -> Vec<Value> {
        let Ok(mut last) = self.last.lock() else { return Vec::new() };
        list.iter()
            .filter(|w| w["enabled"] == true && w["trigger"]["kind"] == "event" && w["trigger"]["event"] == event)
            .filter(|w| {
                let id = w["id"].as_str().unwrap_or("");
                if now_ms - last.get(id).copied().unwrap_or(i64::MIN / 2) < EVENT_GAP_MS {
                    return false;
                }
                last.insert(id.to_string(), now_ms);
                true
            })
            .cloned()
            .collect()
    }
}

/// The stored workflows (`data/workflows.json`); none for a missing or damaged file.
fn stored(file: &std::path::Path) -> Vec<Value> {
    std::fs::read_to_string(file).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()).and_then(|v| v["workflows"].as_array().cloned()).unwrap_or_default()
}

/// Listens on `bus`: a task that ended (`done` or `failed`) starts the workflows of that event through `run`.
pub fn listen_workflow_events(bus: &Bus, db: PathBuf, file: PathBuf, run: Run) -> u64 {
    let starts = EventStarts::default();
    bus.subscribe(move |change| {
        let event = match (change["action"].as_str(), change["state"].as_str()) {
            (Some("job"), Some("failed")) => "task.failed",
            (Some("job"), Some("done")) => "task.done",
            _ => return,
        };
        let Some(job) = change["job"].as_i64() else { return };
        let Ok(conn) = Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return };
        let chat: Option<String> = conn.query_row("SELECT chat_id FROM jobs WHERE id = ?", [job], |r| r.get(0)).ok().flatten();
        if chat.is_some_and(|c| c.starts_with("workflow-")) {
            return;
        }
        let cause = if event == "task.failed" { format!("task #{job} failed") } else { format!("task #{job} finished") };
        for workflow in starts.due(&stored(&file), event, jiff::Timestamp::now().as_millisecond()) {
            run(&workflow, &cause);
        }
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn workflow(id: &str, enabled: bool, event: &str) -> Value {
        json!({ "id": id, "enabled": enabled, "trigger": { "kind": "event", "event": event } })
    }

    #[test]
    fn only_enabled_workflows_of_the_event_start_and_not_twice_in_five_minutes() {
        let list = vec![workflow("a", true, "task.failed"), workflow("b", false, "task.failed"), workflow("c", true, "task.done"), json!({ "id": "d", "enabled": true, "trigger": { "kind": "manual" } })];
        let starts = EventStarts::default();
        assert_eq!(starts.due(&list, "task.failed", 1_000).iter().map(|w| w["id"].clone()).collect::<Vec<_>>(), [json!("a")]);
        assert!(starts.due(&list, "task.failed", 1_000 + EVENT_GAP_MS - 1).is_empty(), "too soon");
        assert_eq!(starts.due(&list, "task.failed", 1_000 + EVENT_GAP_MS).len(), 1);
        assert_eq!(starts.due(&list, "task.done", 2_000).len(), 1, "another workflow has its own gap");
    }

    #[test]
    fn the_bus_starts_a_workflow_for_a_task_that_ended_but_not_for_a_workflows_own_task() {
        let dir = std::env::temp_dir().join(format!("ark-listeners-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (db, file) = (dir.join("helpers.db"), dir.join("workflows.json"));
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE jobs (id INTEGER PRIMARY KEY, chat_id TEXT); INSERT INTO jobs VALUES (1, NULL), (2, 'workflow-x'), (3, 'chat-a');").unwrap();
        std::fs::write(&file, json!({ "version": 1, "workflows": [workflow("w", true, "task.failed"), workflow("v", true, "task.done")] }).to_string()).unwrap();
        let (bus, heard) = (Bus::default(), Arc::new(Mutex::new(Vec::<(String, String)>::new())));
        let sink = heard.clone();
        listen_workflow_events(&bus, db, file, Arc::new(move |w, cause| sink.lock().unwrap().push((w["id"].as_str().unwrap().into(), cause.into()))));
        bus.emit(&json!({ "action": "job", "job": 2, "state": "failed" }));
        bus.emit(&json!({ "action": "job", "job": 1, "state": "running" }));
        bus.emit(&json!({ "action": "step", "job": 1 }));
        assert!(heard.lock().unwrap().is_empty());
        bus.emit(&json!({ "action": "job", "job": 1, "state": "failed" }));
        bus.emit(&json!({ "action": "job", "job": 3, "state": "done" }));
        assert_eq!(*heard.lock().unwrap(), [("w".to_string(), "task #1 failed".to_string()), ("v".to_string(), "task #3 finished".to_string())]);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
