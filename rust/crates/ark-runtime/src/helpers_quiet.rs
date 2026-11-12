//! The stuck dot (ADR-273) in Rust: the marks of `ark_core::jobs::QuietWatch`, fed by the change bus and swept from `helpers.db`.
//! A running task of a chat that made no step, tool call or state change for 8 minutes is marked once; its next move clears the mark.

use std::sync::{Arc, Mutex};

use ark_core::jobs::{QuietWatch, RunningJob};
use rusqlite::Connection;
use serde_json::Value;

use crate::helpers_bus::Bus;

/// The sweep runs each minute (the feed thread calls `sweep`).
#[derive(Debug, Default, Clone)]
pub struct Quiet {
    watch: Arc<Mutex<QuietWatch>>,
}

fn now_ms() -> i64 {
    jiff::Timestamp::now().as_millisecond()
}

impl Quiet {
    /// Hears the moves on `bus`. `parent_of` reads the parent of a task from `db`.
    pub fn listen(&self, bus: &Bus, db: std::path::PathBuf) {
        let watch = self.watch.clone();
        bus.subscribe(move |change| {
            if !matches!(change["action"].as_str(), Some("step" | "toolCall" | "job")) {
                return;
            }
            let Some(job) = change["job"].as_i64() else { return };
            let Ok(conn) = Connection::open_with_flags(&db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else { return };
            let parent_of = |id: i64| conn.query_row("SELECT parent_id FROM jobs WHERE id = ?", [id], |r| r.get::<_, Option<i64>>(0)).ok().flatten();
            if let Ok(mut w) = watch.lock() {
                w.moved(job, parent_of, now_ms());
            }
        });
    }

    /// Checks every running task of a chat now. Gives the tasks that became quiet.
    pub fn sweep(&self, conn: &Connection) -> Vec<i64> {
        let running: Vec<RunningJob> = conn
            .prepare("SELECT id, parent_id FROM jobs WHERE state = 'running' AND chat_id IS NOT NULL")
            .and_then(|mut s| s.query_map([], |r| Ok(RunningJob { id: r.get(0)?, parent: r.get(1)? })).and_then(Iterator::collect))
            .unwrap_or_default();
        self.watch.lock().map(|mut w| w.sweep(&running, now_ms()).into_iter().map(|e| e.job).collect()).unwrap_or_default()
    }

    /// `quietSince` of a task, as the event writes it.
    pub fn since_iso(&self, job: i64) -> Option<String> {
        let at = self.watch.lock().ok()?.since(job)?;
        Some(jiff::Timestamp::from_millisecond(at).ok()?.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
    }

    /// Puts `quietSince` on the tasks of an event that are quiet.
    pub fn mark(&self, event: &mut Value) {
        let Some(helpers) = event["helpers"].as_array_mut() else { return };
        for job in helpers.iter_mut().filter_map(|h| h["jobs"].as_array_mut()).flatten() {
            if let Some(at) = job["id"].as_i64().and_then(|id| self.since_iso(id)) {
                job["quietSince"] = Value::String(at);
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_running_chat_task_with_no_move_becomes_quiet_and_a_move_clears_it() {
        let dir = std::env::temp_dir().join(format!("ark-quiet-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("h.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TABLE jobs (id INTEGER PRIMARY KEY, state TEXT, chat_id TEXT, parent_id INTEGER); INSERT INTO jobs VALUES (1, 'running', 'c', NULL)").unwrap();
        let (bus, quiet) = (Bus::default(), Quiet::default());
        quiet.listen(&bus, db);
        assert!(quiet.sweep(&conn).is_empty(), "the first sweep only starts the count");
        // Make the mark old: the watch took `now`, so move the clock by editing through a long-ago move.
        quiet.watch.lock().unwrap().moved(1, |_| None, now_ms() - 9 * 60_000);
        assert_eq!(quiet.sweep(&conn), vec![1]);
        let mut event = json!({"helpers": [{"jobs": [{"id": 1}, {"id": 2}]}]});
        quiet.mark(&mut event);
        assert!(event["helpers"][0]["jobs"][0]["quietSince"].is_string());
        assert!(event["helpers"][0]["jobs"][1].get("quietSince").is_none());
        bus.emit(&json!({"action": "toolCall", "helper": "a", "job": 1}));
        assert!(quiet.since_iso(1).is_none(), "a tool call clears the mark");
    }
}
