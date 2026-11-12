//! The retry plan of a task that a chat started (ADR-278 Phase 4): a port of `queueNativeRetry` and `failQueuedRetry` in
//! `services/helpers/src/store.ts`. A retry is a new queued task with the old one's helper and text, linked both ways
//! (`retry_of`, `retry_next`) and bound to the chat `task-retry-<id>`. Asking twice gives the same attempt. The retry of a task
//! that came from a workflow plan carries the plan's context; that part stays in Node, so such a call gives `None`. Nothing here
//! starts the attempt: the caller starts it, or calls `fail_queued_retry` when it cannot.

use ark_core::jobs::JobState;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

use crate::helpers_life::{announce, atomic, get, log, sql, transition};
use crate::helpers_write::iso_now;

/// The most steps of a retry lineage that are followed (`retryLineage` of the TypeScript).
const MAX_LINEAGE: usize = 1000;

/// Does the task, or a task it is a retry of, sit in a workflow plan? Then Node builds the plan of the retry. An unreadable lineage reads as yes.
fn in_workflow(conn: &Connection, id: i64) -> bool {
    let mut current = id;
    for _ in 0..MAX_LINEAGE {
        let linked: i64 = conn.query_row("SELECT COUNT(*) FROM plan_jobs WHERE job_id = ?", [current], |r| r.get(0)).unwrap_or(1);
        if linked > 0 {
            return true;
        }
        match conn.query_row("SELECT retry_of FROM jobs WHERE id = ?", [current], |r| r.get::<_, Option<i64>>(0)) {
            Ok(Some(parent)) => current = parent,
            Ok(None) => return false,
            Err(_) => return true,
        }
    }
    true
}

/// `queueNativeRetry(id)`: the attempt and whether it was made now. `available` is whether the helper can take work (`availableHelper`).
/// `None` for a refusal or a workflow retry: Node gives the words, and nothing changed here.
pub fn queue_native_retry(conn: &Connection, id: i64, available: bool) -> Option<(i64, bool)> {
    let old = get(conn, id)?;
    if old.native_scope.as_deref() == Some("advisory") {
        return None;
    }
    let next: Option<i64> = conn.query_row("SELECT COALESCE(retry_next, (SELECT child.id FROM jobs child WHERE child.retry_of = jobs.id)) FROM jobs WHERE id = ?", [id], |r| r.get(0)).optional().ok()??;
    if let Some(next) = next {
        return get(conn, next).map(|_| (next, false)); // a removed attempt is a refusal
    }
    if !matches!(old.state, JobState::Failed | JobState::Stopped) || !available || in_workflow(conn, id) {
        return None;
    }
    let attempt = atomic(conn, || {
        let at = iso_now();
        sql(conn.execute("INSERT INTO jobs (helper, task, state, created_at, goal, parent_id, goal_id, plan_first) VALUES (?, ?, 'queued', ?, NULL, NULL, NULL, 0)", params![old.helper, old.task, at]))?;
        let attempt = conn.last_insert_rowid();
        log(conn, attempt, "created")?;
        sql(conn.execute("UPDATE jobs SET retry_of = ?, chat_id = ? WHERE id = ?", params![id, format!("task-retry-{attempt}"), attempt]))?;
        sql(conn.execute("UPDATE jobs SET retry_next = ? WHERE id = ?", params![attempt, id]))?;
        log(conn, id, "retried")?;
        announce(conn, "job", &json!({ "helper": old.helper, "job": attempt, "state": "queued" }))?;
        Ok(attempt)
    })
    .ok()?;
    Some((attempt, true))
}

/// `failQueuedRetry(id, reason)`: a queued retry that could not start fails with the reason.
pub fn fail_queued_retry(conn: &Connection, id: i64, reason: &str) -> Option<()> {
    let job = get(conn, id)?;
    let is_retry: bool = conn.query_row("SELECT retry_of IS NOT NULL FROM jobs WHERE id = ?", [id], |r| r.get(0)).ok()?;
    if !is_retry || job.state != JobState::Queued {
        return Some(());
    }
    atomic(conn, || transition(conn, &job, JobState::Failed, false, Some(reason))).ok()
}
