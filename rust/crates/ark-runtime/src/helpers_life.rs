//! The life of a task in `helpers.db` (ADR-278 Phase 4, step 2): `start`, `finish`, `fail`, `stop`, `interrupt`, `retry`,
//! `fresh`, `comment` and `add_job`. Ports of `transition`, `wake` and the same-named methods of `HelperStore`
//! (`services/helpers/src/store.ts`), with the state machine and the retry rules of `ark-core`. Every change writes the audit row
//! that `emit` writes, so the change bus (`helpers_bus::Tail`) tells the listeners. Errors carry the words of the TypeScript.
//! File copies are in `helpers_checkpoints`; the retry plans of a chat (`queueNativeRetry`) are in `helpers_retry`.

use ark_core::jobs::{JobState, MAX_AUTO_RETRIES, MAX_BLOCKERS, is_retryable, makes_cycle, move_job};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use std::collections::HashMap;

use crate::helpers_write::{audit_detail, iso_now};

/// The columns of a task that the life of it reads.
#[derive(Debug, Clone)]
pub struct Row {
    pub id: i64,
    pub helper: String,
    pub task: String,
    pub state: JobState,
    pub chat_id: Option<String>,
    pub parent_id: Option<i64>,
    pub created_at: String,
    pub wake_pending: bool,
    pub interrupted: bool,
    pub auto_retries: i64,
    pub native_scope: Option<String>,
    pub error: Option<String>,
    pub goal_id: Option<i64>,
}

pub fn get(conn: &Connection, id: i64) -> Option<Row> {
    conn.query_row(
        "SELECT id, helper, task, state, chat_id, parent_id, created_at, COALESCE(wake_pending, 0), COALESCE(interrupted, 0), COALESCE(auto_retries, 0), native_scope, error, goal_id FROM jobs WHERE id = ?",
        [id],
        |r| {
            Ok(Row {
                id: r.get(0)?,
                helper: r.get(1)?,
                task: r.get(2)?,
                state: JobState::parse(&r.get::<_, String>(3)?).unwrap_or(JobState::Failed),
                chat_id: r.get(4)?,
                parent_id: r.get(5)?,
                created_at: r.get(6)?,
                wake_pending: r.get::<_, i64>(7)? != 0,
                interrupted: r.get::<_, i64>(8)? != 0,
                auto_retries: r.get(9)?,
                native_scope: r.get(10)?,
                error: r.get(11)?,
                goal_id: r.get(12)?,
            })
        },
    )
    .optional()
    .ok()
    .flatten()
}

fn must_get(conn: &Connection, id: i64) -> Result<Row, String> {
    get(conn, id).ok_or_else(|| format!("There is no job {id}."))
}

pub(crate) fn sql<T>(r: rusqlite::Result<T>) -> Result<T, String> {
    r.map_err(|e| format!("The helpers file refused the change: {e}"))
}

/// One change in one transaction: a refusal (`Err`) undoes every write of it.
pub(crate) fn atomic<T>(conn: &Connection, work: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    sql(conn.execute_batch("BEGIN IMMEDIATE"))?;
    match work() {
        Ok(v) if conn.execute_batch("COMMIT").is_ok() => Ok(v),
        other => {
            conn.execute_batch("ROLLBACK").ok();
            other.and(Err("The helpers file could not save the change.".into()))
        }
    }
}

pub(crate) fn log(conn: &Connection, id: i64, kind: &str) -> Result<(), String> {
    sql(conn.execute("INSERT INTO job_events (job_id, kind, at) VALUES (?, ?, ?)", params![id, kind, iso_now()]))?;
    Ok(())
}

pub(crate) fn announce(conn: &Connection, action: &str, detail: &Value) -> Result<(), String> {
    audit_detail(conn, action, detail).ok_or_else(|| "The audit log refused the change.".to_string())
}

fn announce_state(conn: &Connection, job: &Row, state: &str, ms: Option<i64>) -> Result<(), String> {
    let mut detail = json!({ "helper": job.helper, "job": job.id, "state": state });
    if let Some(ms) = ms {
        detail["ms"] = json!(ms);
    }
    announce(conn, "job", &detail)
}

fn millis_since(created: &str) -> i64 {
    let (Ok(then), now) = (created.parse::<jiff::Timestamp>(), jiff::Timestamp::now()) else { return 0 };
    now.as_millisecond() - then.as_millisecond()
}

/// Moves a task through the state machine (`transition`): saves, tells, wakes a task asked again, retries a failure once,
/// and fails or unblocks the queued tasks that waited for it.
pub(crate) fn transition(conn: &Connection, job: &Row, to: JobState, partial: bool, error: Option<&str>) -> Result<(), String> {
    move_job(job.state, to)?;
    let ended = to.is_final().then(iso_now);
    sql(conn.execute("UPDATE jobs SET state = ?, step = NULL, partial = ?, error = ?, ended_at = ?, wake_pending = 0 WHERE id = ?", params![to.name(), i64::from(partial), error, ended, job.id]))?;
    log(conn, job.id, to.name())?;
    announce_state(conn, job, to.name(), ended.as_ref().map(|_| millis_since(&job.created_at)))?;
    let native = job.chat_id.is_some();
    if to != JobState::Stopped && job.wake_pending && !native {
        return wake(conn, job.id);
    }
    if to == JobState::Failed && !native && is_retryable(error) && job.auto_retries < i64::from(MAX_AUTO_RETRIES) {
        sql(conn.execute("UPDATE jobs SET auto_retries = COALESCE(auto_retries, 0) + 1 WHERE id = ?", [job.id]))?;
        log(conn, job.id, "retried")?;
        return wake(conn, job.id);
    }
    if !matches!(to, JobState::Failed | JobState::Stopped) {
        return Ok(());
    }
    if to == JobState::Failed && job.helper != "tinker" {
        ask_skill_edits(conn, job)?;
    }
    let mut stmt = sql(conn.prepare("SELECT j.id FROM job_blockers b JOIN jobs j ON j.id = b.job_id WHERE b.blocker_id = ? AND j.state = 'queued' ORDER BY j.id"))?;
    let waiting: Vec<i64> = sql(stmt.query_map([job.id], |r| r.get(0)).and_then(Iterator::collect))?;
    for id in waiting {
        let Some(dependent) = get(conn, id).filter(|d| d.state == JobState::Queued) else { continue };
        if job.parent_id == Some(id) {
            // A sub-task that did not finish does not fail the task that handed it off: that one runs again without it.
            sql(conn.execute("DELETE FROM job_blockers WHERE job_id = ? AND blocker_id = ?", params![id, job.id]))?;
            announce(conn, "blockers", &json!({ "helper": dependent.helper, "job": id }))?;
            continue;
        }
        let why = format!("Task {}, which it waited for, {}.", job.id, if to == JobState::Failed { "failed" } else { "was stopped" });
        transition(conn, &dependent, JobState::Failed, false, Some(&why))?;
    }
    Ok(())
}

/// ADR-094: a skill of ARK's (in `data/skills`, not the owner's, not from the hub) that a failed task used gets one Tinker task to improve it.
fn ask_skill_edits(conn: &Connection, job: &Row) -> Result<(), String> {
    let Some(db) = conn.path().map(std::path::PathBuf::from) else { return Ok(()) };
    let ark = db.with_file_name("skills");
    let user = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join(".claude").join("skills"));
    let mut stmt = sql(conn.prepare("SELECT skill FROM skill_uses WHERE job_id = ? ORDER BY skill"))?;
    let used: Vec<String> = sql(stmt.query_map([job.id], |r| r.get(0)).and_then(Iterator::collect))?;
    for skill in used {
        let named = !skill.is_empty() && skill.len() <= 64 && skill.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && skill.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
        let theirs = user.as_ref().is_some_and(|u| u.join(&skill).exists());
        let hub: i64 = conn.query_row("SELECT COUNT(*) FROM skill_hub WHERE name = ?", [&skill], |r| r.get(0)).unwrap_or(0);
        if named && ark.join(&skill).exists() && !theirs && hub == 0 {
            let task = format!("Improve the {skill} skill (task {})", job.id);
            // The new Tinker task is announced by `ask_tinker_about`.
            crate::helpers_write::ask_tinker_about(conn, job.id, &task, Some("edit"), Some(&skill)).ok_or("Tinker could not be asked.")?;
        }
    }
    Ok(())
}

/// An ended task runs again (its goal opens again); a running one runs once more when it ends; an interrupted one runs with the message.
fn wake(conn: &Connection, id: i64) -> Result<(), String> {
    let job = must_get(conn, id)?;
    if job.chat_id.is_some() {
        return Ok(());
    }
    if job.state == JobState::Running {
        return sql(conn.execute("UPDATE jobs SET wake_pending = 1 WHERE id = ?", [id])).map(|_| ());
    }
    if job.interrupted {
        sql(conn.execute("UPDATE jobs SET interrupted = 0 WHERE id = ?", [id]))?;
    } else if job.state.is_final() {
        sql(conn.execute("UPDATE jobs SET state = 'queued', step = NULL, partial = 0, error = NULL, ended_at = NULL, wake_pending = 0 WHERE id = ?", [id]))?;
        if let Some(goal) = job.goal_id {
            sql(conn.execute("UPDATE goals SET ended_at = NULL WHERE id = ?", [goal]))?;
        }
    } else {
        return Ok(());
    }
    log(conn, id, "woken")?;
    announce_state(conn, &job, "queued", None)
}

/// A task is waiting for another that is not done.
fn waiting_for(conn: &Connection, id: i64) -> Result<Vec<i64>, String> {
    let mut stmt = sql(conn.prepare("SELECT b.blocker_id FROM job_blockers b JOIN jobs j ON j.id = b.blocker_id WHERE b.job_id = ? AND j.state != 'done' ORDER BY b.blocker_id"))?;
    sql(stmt.query_map([id], |r| r.get(0)).and_then(Iterator::collect))
}

/// `start`: the claim. Only one caller can move a task from queued. `paused` is the helper's pause (the caller reads it from the roster).
pub fn start(conn: &Connection, id: i64, paused: bool) -> Result<(), String> {
    let job = must_get(conn, id)?;
    if paused {
        return Err(format!("{} is paused. Set it to Ready before starting new work.", job.helper));
    }
    move_job(job.state, JobState::Running)?;
    let waits = waiting_for(conn, id)?;
    if !waits.is_empty() {
        return Err(format!("Task {id} still waits for {}.", waits.iter().map(i64::to_string).collect::<Vec<_>>().join(", ")));
    }
    atomic(conn, || {
        let claimed = sql(conn.execute(
            "UPDATE jobs SET state = 'running', step = NULL, brief_from = seen_comments, seen_comments = (SELECT COUNT(*) FROM job_comments WHERE job_id = jobs.id) WHERE id = ? AND state = 'queued'",
            [id],
        ))?;
        if claimed == 0 {
            return Err(format!("Task {id} has already started."));
        }
        log(conn, id, "running")?;
        announce_state(conn, &job, "running", None)
    })
}

/// `step`: the line under a running task. `true` when the task is still running (the caller tells the bus: `step` is not audited).
pub fn step(conn: &Connection, id: i64, text: &str) -> bool {
    conn.execute("UPDATE jobs SET step = ? WHERE id = ? AND state = 'running'", params![text, id]).is_ok_and(|n| n > 0)
}

/// `finish`: a running task is done with its report (`sources` is a JSON list of `{title, url}`).
pub fn finish(conn: &Connection, id: i64, title: &str, summary: &str, body: &str, sources: &Value, partial: bool) -> Result<(), String> {
    let job = must_get(conn, id)?;
    move_job(job.state, JobState::Done)?; // refuse before anything is written
    atomic(conn, || {
        sql(conn.execute("INSERT OR REPLACE INTO reports (job_id, title, summary, body, sources) VALUES (?, ?, ?, ?, ?)", params![id, title, summary, body, sources.to_string()]))?;
        transition(conn, &job, JobState::Done, partial, None)
    })
}

/// `fail`: only a run fails here; a queued task fails only when what it waits for does (in `transition`).
pub fn fail(conn: &Connection, id: i64, error: &str, partial: bool) -> Result<(), String> {
    let job = must_get(conn, id)?;
    if job.state != JobState::Running {
        return Err(format!("A {} job cannot become failed.", job.state.name()));
    }
    atomic(conn, || transition(conn, &job, JobState::Failed, partial, Some(error)))
}

/// ADR-272: stopping a native task stops its native children, and theirs. Gives the ids that were stopped.
fn stop_children(conn: &Connection, id: i64, stopped: &mut Vec<i64>) -> Result<(), String> {
    let mut stmt = sql(conn.prepare("SELECT id FROM jobs WHERE parent_id = ?"))?;
    let kids: Vec<i64> = sql(stmt.query_map([id], |r| r.get(0)).and_then(Iterator::collect))?;
    for kid in kids {
        let Some(child) = get(conn, kid) else { continue };
        if (child.native_scope.as_deref() != Some("advisory") && child.chat_id.is_none()) || child.state.is_final() {
            continue;
        }
        transition(conn, &child, JobState::Stopped, false, None)?;
        stopped.push(kid);
        stop_children(conn, kid, stopped)?;
    }
    Ok(())
}

/// `stop`: `Ok(ids)` of every task stopped (the task and its native children), empty when it is gone or already ended.
pub fn stop(conn: &Connection, id: i64) -> Result<Vec<i64>, String> {
    let Some(job) = get(conn, id).filter(|j| !j.state.is_final()) else { return Ok(Vec::new()) };
    atomic(conn, || {
        transition(conn, &job, JobState::Stopped, false, None)?;
        let mut stopped = vec![id];
        stop_children(conn, id, &mut stopped)?;
        Ok(stopped)
    })
}

/// `remove`: stops what runs (so a runner that listens for "stopped" ends it), then deletes the task.
pub fn remove(conn: &Connection, id: i64) -> Result<bool, String> {
    let Some(job) = get(conn, id) else { return Ok(false) };
    atomic(conn, || {
        if !job.state.is_final() {
            transition(conn, &job, JobState::Stopped, false, None)?;
        }
        stop_children(conn, id, &mut Vec::new())?;
        for table in ["reports", "job_comments", "job_events", "tool_calls", "plan_jobs", "checkpoints"] {
            sql(conn.execute(&format!("DELETE FROM {table} WHERE job_id = ?"), [id]))?;
        }
        sql(conn.execute("DELETE FROM jobs WHERE id = ?", [id]))?;
        sql(conn.execute("DELETE FROM job_blockers WHERE job_id = ? OR blocker_id = ?", params![id, id]))?;
        sql(conn.execute("UPDATE jobs SET parent_id = NULL WHERE parent_id = ?", [id]))?;
        announce(conn, "deleted", &json!({ "helper": job.helper, "job": id }))?;
        Ok(true)
    })
}

/// `retry`: a failed or stopped task runs again.
pub fn retry(conn: &Connection, id: i64) -> Result<(), String> {
    let job = must_get(conn, id)?;
    if job.native_scope.as_deref() == Some("advisory") {
        return Err("Advisory children cannot retry independently. Ask their parent for a new bounded review.".into());
    }
    if job.chat_id.is_some() {
        return Err("Native tasks need the runtime's explicit retry dispatcher.".into());
    }
    if !matches!(job.state, JobState::Failed | JobState::Stopped) {
        return Err("Only a failed or stopped task can be tried again.".into());
    }
    atomic(conn, || {
        log(conn, id, "retried")?;
        wake(conn, id)
    })
}

/// `startFresh`: forget the session, then run again.
pub fn fresh(conn: &Connection, id: i64) -> Result<(), String> {
    let job = must_get(conn, id)?;
    if job.chat_id.is_some() {
        return Err("Native tasks start a new attempt through Retry; their original attempt is kept.".into());
    }
    if job.state == JobState::Running {
        return Err("Wait for the run to end, or stop it, before starting fresh.".into());
    }
    atomic(conn, || {
        sql(conn.execute("UPDATE jobs SET session_id = NULL WHERE id = ?", [id]))?;
        log(conn, id, "fresh")?;
        announce(conn, "comment", &json!({ "helper": job.helper, "job": id }))?;
        wake(conn, id)
    })
}

/// `interrupt`: a running task goes back to the queue and waits for Keshab's message (or runs again at once if one waits).
pub fn interrupt(conn: &Connection, id: i64) -> Result<(), String> {
    let job = must_get(conn, id)?;
    if job.native_scope.as_deref() == Some("advisory") {
        return Err("Stop this advisory child instead; it cannot enter the legacy run queue.".into());
    }
    atomic(conn, || {
        let changed = sql(conn.execute(
            "UPDATE jobs SET state = 'queued', step = NULL, interrupted = CASE WHEN wake_pending = 1 THEN 0 ELSE 1 END, wake_pending = 0 WHERE id = ? AND state = 'running'",
            [id],
        ))?;
        if changed == 0 {
            return Err(format!("A {} job cannot be interrupted.", job.state.name()));
        }
        log(conn, id, "interrupted")?;
        announce_state(conn, &job, "queued", None)
    })
}

/// A note for a task (`job.steer`): `live` when the task runs (the run reads it at its next step), else it wakes the task.
pub fn comment(conn: &Connection, id: i64, text: &str) -> Result<(), String> {
    let job = must_get(conn, id)?;
    let text = text.trim();
    if text.is_empty() {
        return Err("The note is empty.".into());
    }
    atomic(conn, || {
        let delivery = (job.state == JobState::Running).then_some("live");
        sql(conn.execute("INSERT INTO job_comments (job_id, text, created_at, delivery) VALUES (?, ?, ?, ?)", params![id, text, iso_now(), delivery]))?;
        announce(conn, "comment", &json!({ "helper": job.helper, "job": id }))?;
        wake(conn, id)
    })
}

/// `addJob`: a new queued task. `member` is `Some((name, available, role))` of the roster entry, or `None` for an unknown helper.
pub fn add_job(conn: &Connection, helper: &str, member: Option<(&str, bool, &str)>, task: &str, blocked_by: &[i64], plan_first: bool) -> Result<i64, String> {
    let Some((name, available, role)) = member else { return Err(format!("There is no helper called \"{}\".", helper.chars().take(40).collect::<String>())) };
    if role == "improver" {
        return Err(format!("{name} only reviews tasks you rate as not good."));
    }
    if !available {
        return Err(format!("{name} is not ready yet."));
    }
    let task = task.trim();
    if task.is_empty() {
        return Err("The job is empty.".into());
    }
    let mut ids: Vec<i64> = Vec::new();
    for b in blocked_by {
        if !ids.contains(b) {
            ids.push(*b);
        }
    }
    if ids.len() > MAX_BLOCKERS {
        return Err(format!("A task can wait for at most {MAX_BLOCKERS} others."));
    }
    for b in &ids {
        let blocker = get(conn, *b).ok_or_else(|| format!("There is no task {b} to wait for."))?;
        if matches!(blocker.state, JobState::Failed | JobState::Stopped) {
            return Err(format!("Task {b} has {}; nothing can wait for it.", if blocker.state == JobState::Failed { "failed" } else { "been stopped" }));
        }
    }
    atomic(conn, || {
        let at = iso_now();
        sql(conn.execute("INSERT INTO jobs (helper, task, state, created_at, plan_first) VALUES (?, ?, 'queued', ?, ?)", params![helper, task, at, i64::from(plan_first)]))?;
        let id = conn.last_insert_rowid();
        for b in &ids {
            sql(conn.execute("INSERT INTO job_blockers (job_id, blocker_id) VALUES (?, ?)", params![id, b]))?;
        }
        sql(conn.execute("INSERT INTO job_events (job_id, kind, at) VALUES (?, 'created', ?)", params![id, at]))?;
        announce(conn, "job", &json!({ "helper": helper, "job": id, "state": "queued" }))?;
        Ok(id)
    })
}

/// `addNativeJob` with a `parentId` (ADR-272): an agent in `chat` hands part of its task to another agent. The org gate
/// (`delegation_problem` of `ark-core`) says who may call whom. The child is a full worker that runs at once under its parent.
#[allow(clippy::too_many_arguments)]
pub fn delegate(conn: &Connection, parent: i64, chat: &str, helper: &str, member: Option<(&str, bool, &str)>, task: &str, map: &ark_core::org::ReportsTo, agent_ids: &[String], name: ark_core::org::Names<'_>) -> Result<i64, String> {
    let Some((member_name, available, role)) = member else { return Err(format!("There is no helper called \"{}\".", helper.chars().take(40).collect::<String>())) };
    let parent_row = must_get(conn, parent)?;
    if parent_row.state != JobState::Running || parent_row.chat_id.as_deref() != Some(chat) || parent_row.native_scope.is_some() {
        return Err("A delegated task needs a running parent task in this chat.".into());
    }
    if parent_row.helper == helper {
        return Err("An agent cannot give a task to itself.".into());
    }
    if let Some(problem) = ark_core::org::delegation_problem(&parent_row.helper, helper, map, agent_ids, name) {
        return Err(problem);
    }
    if role == "improver" {
        return Err(format!("{member_name} only reviews tasks you rate as not good."));
    }
    if !available {
        return Err(format!("{member_name} is not ready yet."));
    }
    let task = task.trim();
    if task.is_empty() {
        return Err("The job is empty.".into());
    }
    atomic(conn, || {
        let at = iso_now();
        sql(conn.execute("INSERT INTO jobs (helper, task, state, created_at, parent_id, chat_id, seen_comments) VALUES (?, ?, 'running', ?, ?, ?, 0)", params![helper, task, at, parent, chat]))?;
        let id = conn.last_insert_rowid();
        sql(conn.execute("INSERT INTO job_events (job_id, kind, at) VALUES (?, 'created', ?)", params![id, at]))?;
        log(conn, id, "running")?;
        announce(conn, "job", &json!({ "helper": helper, "job": id, "state": "running" }))?;
        Ok(id)
    })
}

/// The edges of `job_blockers`, for a caller that checks a circle (`makes_cycle` of `ark-core`).
pub fn blocker_edges(conn: &Connection) -> HashMap<i64, Vec<i64>> {
    let mut edges: HashMap<i64, Vec<i64>> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT job_id, blocker_id FROM job_blockers") {
        for (j, b) in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?))).into_iter().flatten().flatten() {
            edges.entry(j).or_default().push(b);
        }
    }
    edges
}

/// Whether `id` waiting for `blockers` would make a circle.
pub fn would_circle(conn: &Connection, id: i64, blockers: &[i64]) -> bool {
    makes_cycle(&blocker_edges(conn), id, blockers)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn db(name: &str) -> Connection {
        let path = std::env::temp_dir().join(format!("ark-life-{name}-{}.db", std::process::id()));
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/helpers.db"), &path).unwrap();
        let conn = Connection::open(path).unwrap();
        conn.execute_batch("DELETE FROM jobs; DELETE FROM job_blockers; DELETE FROM job_events; DELETE FROM reports; DELETE FROM audit_log").unwrap();
        conn
    }

    const SID: Option<(&str, bool, &str)> = Some(("Sid", true, "researcher"));

    fn state(conn: &Connection, id: i64) -> String {
        conn.query_row("SELECT state FROM jobs WHERE id = ?", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn a_task_runs_finishes_and_a_dependent_waits_for_it() {
        let conn = db("run");
        let a = add_job(&conn, "sid", SID, " Look up X ", &[], false).unwrap();
        let b = add_job(&conn, "sid", SID, "Then Y", &[a], false).unwrap();
        assert!(start(&conn, b, false).unwrap_err().contains("still waits for"));
        start(&conn, a, false).unwrap();
        assert!(start(&conn, a, false).is_err(), "claimed once");
        assert!(step(&conn, a, "reading"));
        finish(&conn, a, "T", "S", "B", &json!([]), false).unwrap();
        assert_eq!(state(&conn, a), "done");
        start(&conn, b, false).unwrap();
        let kinds: i64 = conn.query_row("SELECT COUNT(*) FROM audit_log WHERE action = 'job'", [], |r| r.get(0)).unwrap();
        assert_eq!(kinds, 5, "queued a, queued b, running a, done a, running b");
    }

    #[test]
    fn a_failed_blocker_fails_what_waits_and_a_retryable_failure_runs_again_once() {
        let conn = db("fail");
        let a = add_job(&conn, "sid", SID, "A", &[], false).unwrap();
        let b = add_job(&conn, "sid", SID, "B", &[a], false).unwrap();
        start(&conn, a, false).unwrap();
        fail(&conn, a, "Took longer than 15 minutes", false).unwrap();
        assert_eq!(state(&conn, a), "queued", "retried by itself");
        start(&conn, a, false).unwrap();
        fail(&conn, a, "Took longer than 15 minutes", false).unwrap();
        assert_eq!(state(&conn, a), "failed");
        assert_eq!(state(&conn, b), "failed");
        retry(&conn, a).unwrap();
        assert_eq!(state(&conn, a), "queued");
        assert!(retry(&conn, a).is_err());
    }

    #[test]
    fn a_native_parent_hands_a_task_down_but_not_up_or_to_itself() {
        let conn = db("delegate");
        conn.execute("INSERT INTO jobs (helper, task, state, created_at, chat_id) VALUES ('sid', 'lead', 'running', 'x', 'c1')", []).unwrap();
        let parent = conn.last_insert_rowid();
        let ids: Vec<String> = vec!["sid".into(), "kame".into()];
        let map = ark_core::org::ReportsTo::from([("kame".to_string(), "sid".to_string())]);
        let name = |id: &str| Some(id.to_uppercase());
        let kame = Some(("Kame", true, "coder"));
        let child = delegate(&conn, parent, "c1", "kame", kame, "part", &map, &ids, &name).unwrap();
        assert_eq!(state(&conn, child), "running");
        assert!(delegate(&conn, parent, "c1", "sid", SID, "x", &map, &ids, &name).unwrap_err().contains("to itself"));
        assert!(delegate(&conn, parent, "other", "kame", kame, "x", &map, &ids, &name).unwrap_err().contains("running parent"));
        conn.execute("UPDATE jobs SET helper = 'kame' WHERE id = ?", [parent]).unwrap();
        assert!(delegate(&conn, parent, "c1", "sid", SID, "x", &map, &ids, &name).unwrap_err().contains("above you"), "no calling up");
    }

    #[test]
    fn a_failed_task_that_used_an_ark_skill_asks_tinker_once() {
        let conn = db("edit");
        let skills = std::path::Path::new(conn.path().unwrap()).with_file_name("skills").join("tidy");
        std::fs::create_dir_all(&skills).unwrap();
        conn.execute("DELETE FROM skill_hub", []).unwrap();
        let a = add_job(&conn, "sid", SID, "A", &[], false).unwrap();
        start(&conn, a, false).unwrap();
        conn.execute("INSERT INTO skill_uses (job_id, skill) VALUES (?, 'tidy'), (?, 'elsewhere')", [a, a]).unwrap();
        fail(&conn, a, "It went wrong", false).unwrap();
        let (n, task): (i64, String) = conn.query_row("SELECT COUNT(*), MIN(task) FROM jobs WHERE helper = 'tinker' AND review_kind = 'edit'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((n, task.as_str()), (1, &*format!("Improve the tidy skill (task {a})")));
    }

    #[test]
    fn interrupt_comment_fresh_stop_and_remove() {
        let conn = db("misc");
        let a = add_job(&conn, "sid", SID, "A", &[], false).unwrap();
        assert!(interrupt(&conn, a).unwrap_err().contains("cannot be interrupted"));
        start(&conn, a, false).unwrap();
        comment(&conn, a, "also Z").unwrap();
        interrupt(&conn, a).unwrap();
        assert_eq!(state(&conn, a), "queued");
        let wake_pending: i64 = conn.query_row("SELECT wake_pending FROM jobs WHERE id = ?", [a], |r| r.get(0)).unwrap();
        assert_eq!(wake_pending, 0);
        start(&conn, a, false).unwrap();
        assert!(fresh(&conn, a).is_err(), "not while it runs");
        assert_eq!(stop(&conn, a).unwrap(), vec![a]);
        assert!(stop(&conn, a).unwrap().is_empty());
        fresh(&conn, a).unwrap();
        assert_eq!(state(&conn, a), "queued");
        assert!(remove(&conn, a).unwrap());
        assert!(get(&conn, a).is_none());
        assert!(add_job(&conn, "tinker", Some(("Tinker", false, "improver")), "x", &[], false).is_err());
        assert!(add_job(&conn, "nobody", None, "x", &[], false).is_err());
    }
}
