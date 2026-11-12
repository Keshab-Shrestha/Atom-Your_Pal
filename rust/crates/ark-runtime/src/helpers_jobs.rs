//! The tasks of the Helpers page (ADR-278 Phase 4, slice 3): the newest 20 tasks of a worker as `JobItem`s, with their
//! blockers, note count, retry link and labels. A port of `toJob`/`toJobRow` in `services/helpers/src/store.ts` and
//! `store-schema.ts`, and of `toJobItem` in `apps/mac/src/island-helpers.ts`. The stuck dot (`quietSince`) lives in Node's
//! memory, so Rust never sends it.

use rusqlite::{Connection, OptionalExtension, Row};
use serde_json::{Map, Value, json};

/// The columns the task list reads.
pub const SCHEMA: &[(&str, &[&str])] = &[
    (
        "jobs",
        &[
            "id", "helper", "task", "state", "step", "partial", "error", "created_at", "ended_at", "model", "model_reason", "goal", "goal_id", "parent_id", "session_id", "plan_first", "plan_summary", "plan_status",
            "interrupted", "rating", "reviews", "auto_retries", "chat_id", "native_scope", "recovery_needed", "retry_of", "retry_next",
        ],
    ),
    ("reports", &["job_id", "title", "summary"]),
    ("job_blockers", &["job_id", "blocker_id"]),
    ("job_comments", &["job_id"]),
    ("goals", &["id", "ended_at"]),
    ("job_labels", &["job_id", "label"]),
];

/// Tasks listed per worker.
pub const JOBS_PER_HELPER: i64 = 20;

fn put(map: &mut Map<String, Value>, key: &str, value: Value) {
    map.insert(key.into(), value);
}

/// A text column that is non-empty (JavaScript truthiness of a string).
fn text(row: &Row, column: &str) -> rusqlite::Result<Option<String>> {
    Ok(row.get::<_, Option<String>>(column)?.filter(|s| !s.is_empty()))
}

fn item(conn: &Connection, row: &Row) -> rusqlite::Result<Option<Value>> {
    let id: i64 = row.get("id")?;
    let state: String = row.get("state")?;
    let recovery = row.get::<_, Option<i64>>("recovery_needed")? == Some(1);
    let mut v = Map::new();
    if let Some(chat) = text(row, "chat_id")? {
        put(&mut v, "chatId", json!(chat));
    }
    put(&mut v, "id", json!(id));
    put(&mut v, "task", json!(row.get::<_, String>("task")?));
    put(&mut v, "state", json!(state));
    put(&mut v, "createdAt", json!(row.get::<_, String>("created_at")?));
    if let Some(ended) = text(row, "ended_at")? {
        put(&mut v, "endedAt", json!(ended));
    }
    if let Some(step) = text(row, "step")?.filter(|_| state == "running" || recovery) {
        put(&mut v, "step", json!(step));
    }
    if row.get::<_, i64>("partial")? == 1 {
        put(&mut v, "partial", json!(true));
    }
    if let Some(title) = row.get::<_, Option<String>>("title")? {
        put(&mut v, "title", json!(title));
    }
    if let Some(summary) = row.get::<_, Option<String>>("summary")? {
        put(&mut v, "summary", json!(summary));
    }
    if let Some(error) = text(row, "error")? {
        put(&mut v, "error", json!(error));
    }
    if recovery {
        put(&mut v, "recoveryNeeded", json!(true));
    }
    if row.get::<_, Option<String>>("native_scope")?.as_deref() == Some("advisory") {
        put(&mut v, "advisory", json!(true));
    }
    if let Some(of) = row.get::<_, Option<i64>>("retry_of")? {
        put(&mut v, "retryOf", json!(of));
    }
    let next = match row.get::<_, Option<i64>>("retry_next")? {
        Some(n) => Some(n),
        None => conn.query_row("SELECT id FROM jobs WHERE retry_of = ?", [id], |r| r.get::<_, i64>(0)).optional()?,
    };
    if let Some(n) = next {
        put(&mut v, "retriedAs", json!(n));
    }
    if let Some(model) = text(row, "model")? {
        put(&mut v, "model", json!(model));
    }
    if let Some(reason) = text(row, "model_reason")? {
        put(&mut v, "modelReason", json!(reason));
    }
    let blockers: Vec<(i64, String)> = conn
        .prepare("SELECT b.blocker_id, x.state FROM job_blockers b JOIN jobs x ON x.id = b.blocker_id WHERE b.job_id = ? ORDER BY b.blocker_id")?
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;
    put(&mut v, "blockedBy", json!(blockers.iter().map(|b| b.0).collect::<Vec<_>>()));
    put(&mut v, "waitingFor", json!(blockers.iter().filter(|b| b.1 != "done").map(|b| b.0).collect::<Vec<_>>()));
    put(&mut v, "comments", json!(conn.query_row("SELECT COUNT(*) FROM job_comments WHERE job_id = ?", [id], |r| r.get::<_, i64>(0))?));
    if let Some(goal) = text(row, "goal")? {
        put(&mut v, "goal", json!(goal));
    }
    if let Some(goal_id) = row.get::<_, Option<i64>>("goal_id")? {
        put(&mut v, "goalId", json!(goal_id));
        let ended: Option<String> = conn.query_row("SELECT ended_at FROM goals WHERE id = ?", [goal_id], |r| r.get(0)).optional()?.flatten();
        if ended.is_some_and(|e| !e.is_empty()) {
            put(&mut v, "goalEnded", json!(true));
        }
    }
    if text(row, "session_id")?.is_some() {
        put(&mut v, "resumable", json!(true));
    }
    if row.get::<_, Option<i64>>("interrupted")? == Some(1) && state == "queued" {
        put(&mut v, "interrupted", json!(true));
    }
    if row.get::<_, Option<i64>>("plan_first")? == Some(1) {
        put(&mut v, "planFirst", json!(true));
    }
    if let Some(status) = row.get::<_, Option<String>>("plan_status")?.filter(|s| s == "awaiting" || s == "approved") {
        put(&mut v, "planStatus", json!(status));
    }
    if let Some(summary) = text(row, "plan_summary")? {
        put(&mut v, "planSummary", json!(summary));
    }
    if let Some(rating) = row.get::<_, Option<String>>("rating")?.filter(|s| s == "good" || s == "bad") {
        put(&mut v, "rating", json!(rating));
    }
    if let Some(reviews) = row.get::<_, Option<i64>>("reviews")? {
        put(&mut v, "reviews", json!(reviews));
    }
    if let Some(retries) = row.get::<_, Option<i64>>("auto_retries")?.filter(|n| *n != 0) {
        put(&mut v, "autoRetries", json!(retries));
    }
    if let Some(parent) = row.get::<_, Option<i64>>("parent_id")? {
        put(&mut v, "parentId", json!(parent));
    }
    let labels: Vec<String> = conn.prepare("SELECT label FROM job_labels WHERE job_id = ? ORDER BY label")?.query_map([id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    if !labels.is_empty() {
        put(&mut v, "labels", json!(labels));
    }
    Ok(Some(Value::Object(v)))
}

/// The newest tasks of one worker, newest first.
pub fn jobs_of(conn: &Connection, helper: &str) -> Option<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT j.*, r.title, r.summary FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.helper = ? ORDER BY j.id DESC LIMIT ?").ok()?;
    let rows = stmt.query_map(rusqlite::params![helper, JOBS_PER_HELPER], |row| item(conn, row)).ok()?;
    rows.map(|r| r.ok().flatten()).collect()
}
