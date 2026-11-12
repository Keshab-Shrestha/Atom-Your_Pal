//! Work plans of the Helpers page (ADR-278 Phase 4, slice 5): the newest five plans that were not dismissed, with the
//! state of each portion read from the tasks. A port of `viewOfPlan` (`plans.ts`), `blockedPortions` and `isComplete`
//! (`work-plan.ts`), `workflowRecovery` (`workflow-recovery.ts`) and the plan list in `island-helpers.ts`.
//! A plan that has a saved repair gets `None` here: its repair receipt needs checks that stay in Node.

use std::collections::{HashMap, HashSet};

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

/// The tables and columns the plan list reads.
pub const SCHEMA: &[(&str, &[&str])] = &[
    ("work_plans", &["id", "chat_id", "goal", "portions", "created_at", "dismissed_at"]),
    ("plan_jobs", &["plan_id", "n", "job_id"]),
    ("plan_repairs", &["plan_id", "n"]),
    ("task_attempts", &["id", "job_id", "seq", "state"]),
];

/// Plans listed on the Board.
pub const PLANS_LISTED: i64 = 5;
const RECOVERY_SCHEMA: &str = "atom.workflow-recovery/v1";

struct Portion {
    n: i64,
    agent: String,
    task: String,
    after: Vec<i64>,
}

struct Job {
    state: String,
    retry_of: bool,
    recovery_needed: bool,
    has_report: bool,
}

fn job(conn: &Connection, id: i64) -> Option<Option<Job>> {
    conn.query_row("SELECT j.state, j.retry_of, j.recovery_needed, r.job_id FROM jobs j LEFT JOIN reports r ON r.job_id = j.id WHERE j.id = ?", [id], |r| {
        Ok(Job { state: r.get(0)?, retry_of: r.get::<_, Option<i64>>(1)?.is_some(), recovery_needed: r.get::<_, Option<i64>>(2)? == Some(1), has_report: r.get::<_, Option<i64>>(3)?.is_some() })
    })
    .optional()
    .ok()
}

/// The latest attempt of a task, when its record is well formed (`stateOf` in `task-evidence.ts`).
fn attempt(conn: &Connection, id: i64) -> Option<Option<String>> {
    let row: Option<(String, String)> = conn.query_row("SELECT id, state FROM task_attempts WHERE job_id = ? ORDER BY seq DESC LIMIT 1", [id], |r| Ok((r.get(0)?, r.get(1)?))).optional().ok()?;
    Some(row.filter(|(uuid, state)| is_uuid(uuid) && ["running", "reported", "failed", "stopped", "interrupted"].contains(&state.as_str())).map(|r| r.1))
}

fn is_uuid(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    parts.len() == 5 && [8, 4, 4, 4, 12].iter().zip(&parts).all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

/// What a portion's task explains (`workflowRecovery`, without a repair).
fn recovery_kind(state: &str, id: Option<i64>, job: Option<&Job>, attempt: Option<&str>) -> &'static str {
    if id.is_some() && job.is_none() {
        return "unconfirmed";
    }
    if job.is_some_and(|j| j.recovery_needed) || attempt == Some("interrupted") {
        return "interrupted";
    }
    let jstate = job.map(|j| j.state.as_str());
    if jstate == Some("done") && job.is_some_and(|j| !j.has_report) {
        return "unconfirmed";
    }
    if let Some(a) = attempt
        && ((jstate == Some("done") && a != "reported") || (jstate == Some("running") && a != "running") || ((jstate == Some("failed") || jstate == Some("stopped")) && a == "reported"))
    {
        return "unconfirmed";
    }
    if state == "blocked" {
        return if jstate == Some("running") { "unconfirmed" } else { "blocked" };
    }
    if jstate == Some("queued") && job.is_some_and(|j| j.retry_of) {
        return "retry-queued";
    }
    let (expected, kind) = match state {
        "done" => (Some("done"), "reported"),
        "running" => (Some("running"), "working"),
        "failed" => (Some("failed"), "failed"),
        "stopped" => (Some("stopped"), "stopped"),
        "waiting" if job.is_none() || jstate == Some("queued") => return "waiting",
        _ => return "unconfirmed",
    };
    if jstate == expected { kind } else { "unconfirmed" }
}

fn parse_portions(text: &str) -> Option<Vec<Portion>> {
    let value: Value = serde_json::from_str(text).ok()?;
    value
        .as_array()?
        .iter()
        .map(|p| Some(Portion { n: p.get("n")?.as_i64()?, agent: p.get("agent")?.as_str()?.to_string(), task: p.get("task")?.as_str()?.to_string(), after: p.get("after")?.as_array()?.iter().map(Value::as_i64).collect::<Option<_>>()? }))
        .collect()
}

/// The newest plans, with `name_of` giving an agent's current name. `None` when a plan has a repair or a row of another shape.
pub fn plans(conn: &Connection, name_of: &dyn Fn(&str) -> String) -> Option<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id, goal, portions, created_at FROM work_plans WHERE dismissed_at IS NULL ORDER BY id DESC LIMIT ?").ok()?;
    let rows: Vec<(i64, String, String, String)> = stmt.query_map([PLANS_LISTED], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).ok()?.collect::<Result<_, _>>().ok()?;
    rows.into_iter().map(|(id, goal, portions, created)| plan(conn, id, goal, &portions, &created, name_of)).collect()
}

fn plan(conn: &Connection, id: i64, goal: String, portions: &str, created: &str, name_of: &dyn Fn(&str) -> String) -> Option<Value> {
    if conn.query_row("SELECT COUNT(*) FROM plan_repairs WHERE plan_id = ?", [id], |r| r.get::<_, i64>(0)).ok()? > 0 {
        return None;
    }
    let portions = parse_portions(portions)?;
    let links: HashMap<i64, i64> = conn
        .prepare("SELECT n, job_id FROM plan_jobs WHERE plan_id = ? ORDER BY n")
        .ok()?
        .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    // The job behind each started portion; a retry waiting in the queue reads as "waiting", a vanished job as `None`.
    let mut jobs: HashMap<i64, Option<Job>> = HashMap::new();
    for j in links.values() {
        jobs.insert(*j, job(conn, *j)?);
    }
    let state_of = |n: i64| -> &'static str {
        let Some(j) = links.get(&n) else { return "waiting" };
        match jobs.get(j).and_then(Option::as_ref) {
            Some(job) if job.retry_of && job.state == "queued" => "waiting",
            Some(job) => match job.state.as_str() {
                "done" => "done",
                "failed" => "failed",
                "stopped" => "stopped",
                _ => "running",
            },
            None => "running",
        }
    };
    let failed: HashSet<i64> = portions.iter().filter(|p| matches!(state_of(p.n), "failed" | "stopped")).map(|p| p.n).collect();
    let mut dead = failed.clone();
    for p in &portions {
        if p.after.iter().any(|a| dead.contains(a)) {
            dead.insert(p.n);
        }
    }
    let blocked: HashSet<i64> = portions.iter().filter(|p| dead.contains(&p.n) && !failed.contains(&p.n)).map(|p| p.n).collect();
    let done: HashSet<i64> = portions.iter().filter(|p| state_of(p.n) == "done").map(|p| p.n).collect();
    let mut views = Vec::new();
    let mut states = Vec::new();
    for p in &portions {
        let state = if blocked.contains(&p.n) { "blocked" } else { state_of(p.n) };
        states.push((state, p));
        let job_id = links.get(&p.n).copied();
        let found = job_id.and_then(|j| jobs.get(&j)).and_then(Option::as_ref);
        let latest = match job_id {
            Some(j) => attempt(conn, j)?,
            None => None,
        };
        let kind = recovery_kind(state, job_id, found, latest.as_deref());
        let mut v = json!({ "n": p.n, "agent": p.agent, "name": name_of(&p.agent), "task": p.task, "after": p.after, "recovery": { "schema": RECOVERY_SCHEMA, "kind": kind }, "state": state });
        if let Some(j) = job_id {
            v["job"] = json!(j);
        }
        views.push(v);
    }
    let complete = portions.iter().all(|p| done.contains(&p.n));
    let running = states.iter().any(|(s, _)| *s == "running");
    let can_start = states.iter().any(|(s, p)| *s == "waiting" && p.after.iter().all(|a| done.contains(a)));
    let stuck = !complete && !running && (!failed.is_empty() || !blocked.is_empty()) && !can_start;
    let created: jiff::Timestamp = created.parse().ok()?;
    Some(json!({ "id": id, "goal": goal, "createdAt": created.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string(), "portions": views, "complete": complete, "stuck": stuck }))
}
