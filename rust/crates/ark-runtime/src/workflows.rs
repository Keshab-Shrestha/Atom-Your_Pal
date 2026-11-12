//! `workflows.list`, `workflow.save` and `workflow.delete` (ADR-278): ports of `checkWorkflow` and `createWorkflowStore` in
//! `apps/mac/src/workflows.ts`, and the `workflows` event of `island.ts`. The store is `data/workflows.json`, beside the memory file.
//! `workflow.run` stays in Node: a run is a hidden model turn. Node reads the file again when its time stamp changes, so both sides
//! can write it. `None` gives the line to Node (no helpers file to name the agents, a damaged file, a very large workflow).

use std::path::Path;

use jiff::Timestamp;
use rusqlite::Connection;
use serde_json::{Map, Value, json};

use crate::helpers_roster;
use crate::helpers_routines::{Schedule, iso, next_due};

const MAX_WORKFLOWS: usize = 20;
const MAX_STEPS: usize = 8;
const MAX_NAME: usize = 80;
const MAX_TASK: usize = 2000;
const MAX_LAYOUT: f64 = 100_000.0;
const MAX_SAVED_JSON: usize = 32_000;
const MAX_PROBLEM: usize = 200;
const SCHEDULE_PROBLEM: &str = "A routine runs daily or weekly at a time, or every 1 to 168 hours.";

fn whole(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9e15).map(|f| f as i64))
}

/// `text`: not empty, not longer than `max` (in UTF-16 units, as JavaScript counts), trimmed.
fn text(v: &Value, max: usize, what: &str) -> Result<String, String> {
    let s = v.as_str().filter(|s| !s.trim().is_empty()).ok_or_else(|| format!("{what} is empty."))?;
    if s.encode_utf16().count() > max {
        return Err(format!("{what} is longer than {max} characters."));
    }
    Ok(s.trim().to_string())
}

/// `checkSchedule`.
fn check_schedule(s: &Value) -> Result<Value, String> {
    let minute = |v: &Value| whole(v).filter(|m| (0..24 * 60).contains(m));
    let bad = || SCHEDULE_PROBLEM.to_string();
    match s["kind"].as_str() {
        Some("daily") => Ok(json!({ "kind": "daily", "minute": minute(&s["minute"]).ok_or_else(bad)? })),
        Some("weekly") => Ok(json!({ "kind": "weekly", "weekday": whole(&s["weekday"]).filter(|d| (0..=6).contains(d)).ok_or_else(bad)?, "minute": minute(&s["minute"]).ok_or_else(bad)? })),
        Some("hours") => Ok(json!({ "kind": "hours", "every": whole(&s["every"]).filter(|e| (1..=168).contains(e)).ok_or_else(bad)? })),
        _ => Err(bad()),
    }
}

/// `checkLayout`: known node keys with finite numbers, rounded (JavaScript rounds half up) and clamped.
fn check_layout(input: &Value, steps: usize) -> Option<Value> {
    let coord = |v: f64| (v + 0.5).floor().clamp(-MAX_LAYOUT, MAX_LAYOUT);
    let kept: Map<String, Value> = input
        .as_object()?
        .iter()
        .filter(|(key, _)| key.as_str() == "trigger" || (key.len() == 1 && key.as_bytes()[0].is_ascii_digit() && key.as_bytes()[0] < b'8' && usize::from(key.as_bytes()[0] - b'0') < steps))
        .filter_map(|(key, p)| Some((key.clone(), json!({ "x": coord(p["x"].as_f64()?) as i64, "y": coord(p["y"].as_f64()?) as i64 }))))
        .collect();
    (!kept.is_empty()).then_some(Value::Object(kept))
}

fn valid_time(v: &Value) -> Option<&str> {
    // ponytail: RFC 3339 only; JavaScript's Date.parse also takes looser forms (those read as "no time" here).
    v.as_str().filter(|s| s.parse::<Timestamp>().is_ok())
}

fn fresh_id(conn: &Connection) -> Option<String> {
    conn.query_row("SELECT lower(hex(randomblob(4)))", [], |r| r.get(0)).ok()
}

/// `checkWorkflow`. `agents` are the ids the steps may name; `new_id` makes an id when the input has none that fits.
fn check_workflow(input: &Value, agents: &[String], now: Timestamp, new_id: &dyn Fn() -> Option<String>) -> Result<Option<Value>, String> {
    let Some(map) = input.as_object() else { return Err("A workflow is an object.".into()) };
    let trigger = map.get("trigger").filter(|t| t.is_object()).ok_or("A workflow needs a trigger.")?;
    let checked = match trigger["kind"].as_str() {
        Some("manual") => json!({ "kind": "manual" }),
        Some("schedule") => json!({ "kind": "schedule", "schedule": check_schedule(&trigger["schedule"])? }),
        Some("event") if matches!(trigger["event"].as_str(), Some("task.failed" | "task.done")) => json!({ "kind": "event", "event": trigger["event"] }),
        _ => return Err("The trigger is by hand, a schedule, or a Board task that fails or finishes.".into()),
    };
    let list = map.get("steps").and_then(Value::as_array).filter(|s| !s.is_empty() && s.len() <= MAX_STEPS).ok_or_else(|| format!("A workflow has 1 to {MAX_STEPS} steps."))?;
    let mut steps = Vec::new();
    for (i, step) in list.iter().enumerate() {
        if !step.is_object() {
            return Err(format!("Step {} is not a step.", i + 1));
        }
        let helper = step["helper"].as_str().filter(|h| agents.iter().any(|a| a == h)).ok_or_else(|| format!("Step {} needs one of your agents.", i + 1))?;
        steps.push(json!({ "helper": helper, "task": text(&step["task"], MAX_TASK, &format!("Step {}'s task", i + 1))? }));
    }
    let id = match map.get("id").and_then(Value::as_str).filter(|id| (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')) {
        Some(id) => id.to_string(),
        None => match new_id() {
            Some(id) => id,
            None => return Ok(None),
        },
    };
    let layout = map.get("layout").and_then(|l| check_layout(l, steps.len()));
    let mut out = Map::new();
    out.insert("id".into(), json!(id));
    out.insert("name".into(), json!(text(map.get("name").unwrap_or(&Value::Null), MAX_NAME, "The name")?));
    out.insert("enabled".into(), json!(map.get("enabled") == Some(&Value::Bool(true))));
    out.insert("trigger".into(), checked);
    out.insert("steps".into(), Value::Array(steps));
    out.insert("createdAt".into(), json!(map.get("createdAt").and_then(valid_time).map_or_else(|| iso(now), String::from)));
    if let Some(last) = map.get("lastRunAt").and_then(valid_time) {
        out.insert("lastRunAt".into(), json!(last));
    }
    if let Some(layout) = layout {
        out.insert("layout".into(), layout);
    }
    Ok(Some(Value::Object(out)))
}

fn step_agents(w: &Value) -> Vec<String> {
    w["steps"].as_array().map(|s| s.iter().filter_map(|x| x["helper"].as_str().map(String::from)).collect()).unwrap_or_default()
}

/// The stored list, each one checked again (a damaged entry is skipped). `None` when the file is not JSON.
fn read(path: &Path, now: Timestamp) -> Option<Vec<Value>> {
    if !path.exists() {
        return Some(Vec::new());
    }
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
    let list = raw["workflows"].as_array().cloned().unwrap_or_default();
    Some(list.iter().filter_map(|w| check_workflow(w, &step_agents(w), now, &|| None).ok().flatten()).collect())
}

fn write(path: &Path, list: &[Value]) -> Option<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(path.parent()?).ok()?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string_pretty(&json!({ "version": 1, "workflows": list })).ok()?).ok()?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).ok()?;
    std::fs::rename(&tmp, path).ok()
}

/// The `workflows` event: each published schedule workflow with its next time.
fn event(list: &[Value], problem: Option<&str>) -> String {
    let now = jiff::Zoned::now();
    let items: Vec<Value> = list
        .iter()
        .map(|w| {
            let mut w = w.clone();
            let next = (w["enabled"] == true && w["trigger"]["kind"] == "schedule")
                .then(|| Schedule::from_json(&w["trigger"]["schedule"]).zip(w["createdAt"].as_str().and_then(|c| c.parse::<Timestamp>().ok())))
                .flatten()
                .and_then(|(s, created)| next_due(&s, created, &now));
            if let Some(at) = next {
                w["nextAt"] = json!(iso(at));
            }
            w
        })
        .collect();
    let mut event = json!({ "type": "workflows", "workflows": items });
    if let Some(p) = problem {
        event["problem"] = json!(p.chars().take(MAX_PROBLEM).collect::<String>());
    }
    format!("{event}\n")
}

/// The line for the app, or `None` when Node must answer.
pub fn answer(memory_db: &Path, line: &str) -> Option<String> {
    if !["\"workflows.list\"", "\"workflow.save\"", "\"workflow.delete\""].iter().any(|k| line.contains(k)) {
        return None;
    }
    let command: Value = serde_json::from_str(line).ok()?;
    let dir = memory_db.parent()?;
    let path = dir.join("workflows.json");
    let now = Timestamp::now();
    let mut list = read(&path, now)?;
    match command["type"].as_str()? {
        "workflows.list" => {}
        "workflow.delete" => {
            let id = command["id"].as_str()?;
            list.retain(|w| w["id"] != id);
            write(&path, &list)?;
        }
        "workflow.save" => {
            let workflow = command["workflow"].as_object().map(|_| &command["workflow"])?;
            if workflow.to_string().len() > MAX_SAVED_JSON {
                return None;
            }
            let helpers = dir.join("helpers.db");
            helpers.exists().then_some(())?;
            let conn = crate::helpers_event::open_read_only(&helpers)?;
            let agent_ids: Vec<String> = helpers_roster::roster(&conn, &dir.join("agents"))?.0.into_iter().map(|m| m.id).collect();
            let saved = match check_workflow(workflow, &agent_ids, now, &|| fresh_id(&conn)) {
                Ok(saved) => saved?,
                Err(problem) => return Some(event(&list, Some(&problem))),
            };
            let others = list.iter().filter(|w| w["id"] != saved["id"]).count();
            if others >= MAX_WORKFLOWS {
                return Some(event(&list, Some(&format!("ARK keeps at most {MAX_WORKFLOWS} workflows."))));
            }
            match list.iter().position(|w| w["id"] == saved["id"]) {
                Some(i) => list[i] = saved,
                None => list.push(saved),
            }
            write(&path, &list)?;
        }
        _ => return None,
    }
    Some(event(&list, None))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn layout_rounds_half_up_and_clamps() {
        let layout = check_layout(&json!({ "trigger": { "x": 1.5, "y": -2.5 }, "0": { "x": 200000, "y": 3 }, "7": { "x": 1, "y": 1 } }), 1).unwrap();
        assert_eq!(layout, json!({ "trigger": { "x": 2, "y": -2 }, "0": { "x": 100000, "y": 3 } }));
    }
}
