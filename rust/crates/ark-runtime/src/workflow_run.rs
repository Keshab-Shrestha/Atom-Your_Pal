//! `workflow.run` (ADR-278): a port of `run` in the workflows block of `runtime.ts` and `workflowPrompt`. Node ran one hidden model turn
//! that called `plan_work` with the steps in order and started each portion. The prompt allows no choice (no added, merged or skipped
//! portion, no work by the model), so Rust makes the same plan by code: one work plan, and one queued task for each step that waits for
//! the task before it. Every task has the chat `workflow-<id>-<time>`, so a finished task never starts an event workflow. The one-sentence
//! summary the model gave at the end is not made. The run time is saved in `workflows.json`.

use std::path::Path;

use jiff::Timestamp;
use rusqlite::{Connection, params};
use serde_json::{Value, json};

use crate::{helpers_life, helpers_roster, workflows};

/// Node must run the command (a file or a fact is missing).
#[derive(Debug)]
pub struct Forward;

const NO_WORKFLOW: &str = "That workflow is gone.";

/// The chat that marks every task of one run.
pub fn run_chat(id: &str, at: Timestamp) -> String {
    format!("workflow-{id}-{}", at.as_millisecond())
}

/// Starts the workflow `id` "by hand". `Ok(Some(problem))` is a refusal for the `workflows` event; `Err(Forward)` means Node must do it.
pub fn start(dir: &Path, helpers: &Connection, id: &str, now: Timestamp) -> Result<Option<String>, Forward> {
    let path = dir.join("workflows.json");
    let mut list = workflows::read(&path, now).ok_or(Forward)?;
    let Some(i) = list.iter().position(|w| w["id"] == id) else { return Ok(Some(NO_WORKFLOW.into())) };
    let workflow = list[i].clone();
    let (members, _) = helpers_roster::roster(helpers, &dir.join("agents")).ok_or(Forward)?;
    let mut portions = Vec::new();
    let mut previous: Option<i64> = None;
    let mut jobs = Vec::new();
    let chat = run_chat(id, now);
    for (index, step) in workflow["steps"].as_array().ok_or(Forward)?.iter().enumerate() {
        let helper = step["helper"].as_str().ok_or(Forward)?;
        let member = members.iter().find(|m| m.id == helper).ok_or(Forward)?;
        let core = helpers_roster::member_core(helpers, member).ok_or(Forward)?;
        let name = core["name"].as_str().ok_or(Forward)?;
        let task = step["task"].as_str().ok_or(Forward)?;
        let blockers: Vec<i64> = previous.into_iter().collect();
        let job = match helpers_life::add_job(helpers, helper, Some((name, core["available"] == true, &member.role)), task, &blockers, false) {
            Ok(job) => job,
            Err(_) if jobs.is_empty() => return Err(Forward),
            Err(message) => return Ok(Some(message.chars().take(200).collect())),
        };
        helpers.execute("UPDATE jobs SET chat_id = ? WHERE id = ?", params![chat, job]).map_err(|_| Forward)?;
        let n = index as i64 + 1;
        portions.push(json!({ "n": n, "agent": helper, "task": task, "after": if n > 1 { vec![n - 1] } else { Vec::new() } }));
        previous = Some(job);
        jobs.push((n, job));
    }
    let goal = format!("Run the workflow \"{}\" (run by hand)", workflow["name"].as_str().unwrap_or(id));
    let at = now.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    helpers.execute("INSERT INTO work_plans (chat_id, goal, portions, created_at) VALUES (?, ?, ?, ?)", params![chat, goal, Value::Array(portions).to_string(), at]).map_err(|_| Forward)?;
    let plan = helpers.last_insert_rowid();
    for (n, job) in jobs {
        helpers.execute("INSERT OR IGNORE INTO plan_jobs (plan_id, n, job_id) VALUES (?, ?, ?)", params![plan, n, job]).map_err(|_| Forward)?;
    }
    helpers_life::announce(helpers, "plan_work", &json!({ "plan": plan })).map_err(|_| Forward)?;
    list[i]["lastRunAt"] = json!(at);
    workflows::write(&path, &list).ok_or(Forward)?;
    Ok(None)
}

/// The `workflows` event after a run.
pub fn event(dir: &Path, now: Timestamp, problem: Option<&str>) -> Option<String> {
    Some(workflows::event(&workflows::read(&dir.join("workflows.json"), now)?, problem))
}
