//! Writes of the Helpers page that Rust does itself (ADR-278 Phase 4, slice 6): `job.label.add`, `job.label.remove`,
//! `job.block` and `job.delete` of a finished task. Ports of `addLabel`, `removeLabel`, `setBlockers` and `remove` in
//! `services/helpers/src/store*.ts`, with the audit row of `emit`. Every function gives `None` for anything the TypeScript
//! refuses or does with more machinery (a running task, kept file copies): the caller then forwards the command to Node,
//! which gives the exact words of the refusal. A refused call leaves the file as it was.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;

const MAX_LABELS: i64 = 6;
const MAX_BLOCKERS: usize = 6;

/// The tables and columns the writes use.
pub const SCHEMA: &[(&str, &[&str])] = &[
    ("jobs", &["id", "helper", "state", "parent_id"]),
    ("job_labels", &["job_id", "label"]),
    ("job_blockers", &["job_id", "blocker_id"]),
    ("job_events", &["job_id", "kind", "at"]),
    ("audit_log", &["at", "action", "detail"]),
    ("checkpoints", &["job_id"]),
];

fn iso_now() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn job(conn: &Connection, id: i64) -> Option<(String, String)> {
    conn.query_row("SELECT helper, state FROM jobs WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok()?
}

/// One change, announced as `emit` does: an audit row with the ids (`detail` has no action).
fn audit(conn: &Connection, action: &str, helper: &str, id: i64) -> Option<()> {
    conn.execute("INSERT INTO audit_log (at, action, detail) VALUES (?, ?, ?)", params![iso_now(), action, json!({ "helper": helper, "job": id }).to_string()]).ok()?;
    Some(())
}

/// Runs `work` in one transaction; any `None` rolls back.
fn transaction(conn: &Connection, work: impl FnOnce() -> Option<()>) -> Option<()> {
    conn.execute_batch("BEGIN IMMEDIATE").ok()?;
    if work().is_some() && conn.execute_batch("COMMIT").is_ok() {
        return Some(());
    }
    conn.execute_batch("ROLLBACK").ok();
    None
}

/// A label as stored: trimmed, lower case, single spaces, letters a to z, digits, dashes and spaces.
fn clean_label(raw: &str) -> Option<String> {
    let label = raw.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    let mut chars = label.chars();
    let first_ok = chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    (first_ok && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == ' ' || c == '-')).then_some(label)
}

/// `job.label.add`.
pub fn add_label(conn: &Connection, id: i64, raw: &str) -> Option<()> {
    let (helper, _) = job(conn, id)?;
    let label = clean_label(raw)?;
    transaction(conn, || {
        let have: Vec<String> = conn.prepare("SELECT label FROM job_labels WHERE job_id = ?").ok()?.query_map([id], |r| r.get(0)).ok()?.collect::<Result<_, _>>().ok()?;
        if i64::try_from(have.len()).ok()? >= MAX_LABELS && !have.contains(&label) {
            return None;
        }
        conn.execute("INSERT OR IGNORE INTO job_labels (job_id, label) VALUES (?, ?)", params![id, label]).ok()?;
        audit(conn, "label", &helper, id)
    })
}

/// `job.label.remove`: nothing is recorded when the task had no such label.
pub fn remove_label(conn: &Connection, id: i64, label: &str) -> Option<()> {
    let (helper, _) = job(conn, id)?;
    transaction(conn, || {
        let changed = conn.execute("DELETE FROM job_labels WHERE job_id = ? AND label = ?", params![id, label.trim().to_lowercase()]).ok()?;
        if changed > 0 { audit(conn, "label", &helper, id) } else { Some(()) }
    })
}

/// `job.block`: what a task that has not started waits for.
pub fn set_blockers(conn: &Connection, id: i64, raw: &[i64]) -> Option<()> {
    let (helper, state) = job(conn, id)?;
    if state != "queued" {
        return None;
    }
    let mut blockers: Vec<i64> = Vec::new();
    for b in raw {
        if !blockers.contains(b) {
            blockers.push(*b);
        }
    }
    if blockers.len() > MAX_BLOCKERS {
        return None;
    }
    for b in &blockers {
        let (_, bstate) = job(conn, *b)?;
        if *b == id || bstate == "failed" || bstate == "stopped" {
            return None;
        }
    }
    let mut edges: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut stmt = conn.prepare("SELECT job_id, blocker_id FROM job_blockers").ok()?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))).ok()? {
        let (j, b) = row.ok()?;
        if j != id {
            edges.entry(j).or_default().push(b);
        }
    }
    if makes_cycle(&edges, id, &blockers) {
        return None;
    }
    transaction(conn, || {
        conn.execute("DELETE FROM job_blockers WHERE job_id = ?", [id]).ok()?;
        for b in &blockers {
            conn.execute("INSERT INTO job_blockers (job_id, blocker_id) VALUES (?, ?)", params![id, b]).ok()?;
        }
        conn.execute("INSERT INTO job_events (job_id, kind, at) VALUES (?, 'waits', ?)", params![id, iso_now()]).ok()?;
        audit(conn, "blockers", &helper, id)
    })
}

/// Whether waiting for `blockers` would make `id` wait for itself (`makesCycle`).
fn makes_cycle(edges: &HashMap<i64, Vec<i64>>, id: i64, blockers: &[i64]) -> bool {
    let mut seen = HashSet::new();
    let mut stack: Vec<i64> = blockers.to_vec();
    while let Some(next) = stack.pop() {
        if next == id {
            return true;
        }
        if !seen.insert(next) {
            continue;
        }
        stack.extend(edges.get(&next).into_iter().flatten());
    }
    false
}

/// `job.delete` of a finished task. A task that has not ended, or has kept file copies, goes to Node.
pub fn remove_job(conn: &Connection, id: i64) -> Option<()> {
    let (helper, state) = job(conn, id)?;
    if !matches!(state.as_str(), "done" | "failed" | "stopped") {
        return None;
    }
    if conn.query_row("SELECT COUNT(*) FROM checkpoints WHERE job_id = ?", [id], |r| r.get::<_, i64>(0)).ok()? > 0 {
        return None;
    }
    transaction(conn, || {
        conn.execute("DELETE FROM reports WHERE job_id = ?", [id]).ok()?;
        conn.execute("DELETE FROM jobs WHERE id = ?", [id]).ok()?;
        conn.execute("DELETE FROM job_blockers WHERE job_id = ? OR blocker_id = ?", params![id, id]).ok()?;
        conn.execute("DELETE FROM plan_jobs WHERE job_id = ?", [id]).ok()?;
        conn.execute("UPDATE jobs SET parent_id = NULL WHERE parent_id = ?", [id]).ok()?;
        conn.execute("DELETE FROM job_comments WHERE job_id = ?", [id]).ok()?;
        conn.execute("DELETE FROM job_events WHERE job_id = ?", [id]).ok()?;
        conn.execute("DELETE FROM tool_calls WHERE job_id = ?", [id]).ok()?;
        audit(conn, "deleted", &helper, id)
    })
}

/// The write that `command` (a command line as a JSON value) asks for, or `None` for another command or a call Node must answer.
pub fn apply(conn: &Connection, command: &serde_json::Value) -> Option<()> {
    let id = command["id"].as_i64()?;
    match command["type"].as_str()? {
        "job.label.add" => add_label(conn, id, command["label"].as_str()?),
        "job.label.remove" => remove_label(conn, id, command["label"].as_str()?),
        "job.block" => set_blockers(conn, id, &command["blockedBy"].as_array()?.iter().map(serde_json::Value::as_i64).collect::<Option<Vec<_>>>()?),
        "job.delete" => remove_job(conn, id),
        _ => None,
    }
}
