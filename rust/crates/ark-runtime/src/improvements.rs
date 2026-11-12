//! `improvements.get`, `improvements.set`, `improvement.fixing` and `improvement.dismiss` (ADR-278): ports of `createImproveStore`, `markFixing` in
//! `apps/mac/src/improve.ts`, the `improvements` lambdas of `runtime.ts` and the `improvements` event of `island.ts`. The state is
//! `data/improvements.json`; Node reads it again when its time stamp changes. `improvements.run` is `improve_run.rs` (it reads the log and asks the
//! model). Whether a run is going (`running`) is in the memory of Node, so the event takes it from the last `improvements` event Node
//! sent; with none yet, Node answers.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde_json::{Map, Value, json};

// ponytail: one process-wide copy of the last `running` flag; a second runtime in one process would share it.
static RUNNING: OnceLock<Mutex<Option<bool>>> = OnceLock::new();

fn running_slot() -> &'static Mutex<Option<bool>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// A line Node sent to the app: an `improvements` event says whether a run goes.
pub fn observe(line: &str) {
    if !line.starts_with("{\"type\":\"improvements\"") {
        return;
    }
    if let (Ok(event), Ok(mut slot)) = (serde_json::from_str::<Value>(line), running_slot().lock()) {
        *slot = Some(event["running"] == true);
    }
}

/// Rust runs the improvement run now (or it ended): the `running` flag of the next `improvements` event.
pub(crate) fn set_running(on: bool) {
    if let Ok(mut slot) = running_slot().lock() {
        *slot = Some(on);
    }
}

/// A run goes (started by Rust).
pub(crate) fn is_running() -> bool {
    running_slot().lock().is_ok_and(|s| *s == Some(true))
}

fn now() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

fn has_id(v: &&Value) -> bool {
    v.get("id").is_some_and(Value::is_string)
}

/// The state as `createImproveStore` reads it: only the known keys, a note or a result without a string id dropped. `None` for a damaged file.
pub(crate) fn read(path: &Path) -> Option<Map<String, Value>> {
    let raw: Value = if path.exists() { serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()? } else { json!({}) };
    let list = |key: &str| Value::Array(raw[key].as_array().map(|a| a.iter().filter(has_id).cloned().collect()).unwrap_or_default());
    let mut state = Map::new();
    state.insert("enabled".into(), json!(raw["enabled"] != false));
    if let Some(last) = raw["lastRunAt"].as_str().filter(|s| !s.is_empty()) {
        state.insert("lastRunAt".into(), json!(last));
    }
    state.insert("notes".into(), list("notes"));
    state.insert("dismissed".into(), if raw["dismissed"].is_object() { raw["dismissed"].clone() } else { json!({}) });
    state.insert("resolved".into(), list("resolved"));
    Some(state)
}

pub(crate) fn write(path: &Path, state: &Map<String, Value>) -> Option<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::create_dir_all(path.parent()?).ok()?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, Value::Object(state.clone()).to_string()).ok()?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).ok()?;
    std::fs::rename(&tmp, path).ok()
}

pub(crate) fn event(state: &Map<String, Value>, running: bool) -> String {
    let notes: Vec<Value> = state["notes"].as_array().into_iter().flatten().map(|n| {
        let fixing = n["fixStartedAt"].as_str().is_some_and(|s| !s.is_empty());
        json!({ "id": n["id"], "title": n["title"], "evidence": n["evidence"], "severity": n["severity"], "why": n["why"], "change": n["change"], "fixing": fixing, "cameBack": n["cameBack"] == true })
    }).collect();
    let resolved: Vec<Value> = state["resolved"].as_array().into_iter().flatten().map(|r| json!({ "id": r["id"], "title": r["title"], "how": r["how"], "resolvedAt": r["resolvedAt"] })).collect();
    let mut event = json!({ "type": "improvements", "enabled": state["enabled"], "running": running, "notes": notes, "resolved": resolved });
    if let Some(last) = state.get("lastRunAt") {
        event["lastRunAt"] = last.clone();
    }
    format!("{event}\n")
}

/// The line for the app, or `None` when Node must answer.
pub fn answer(memory_db: &Path, line: &str) -> Option<String> {
    if !["\"improvements.get\"", "\"improvements.set\"", "\"improvement.fixing\"", "\"improvement.dismiss\""].iter().any(|k| line.contains(k)) {
        return None;
    }
    let command: Value = serde_json::from_str(line).ok()?;
    let running = (*running_slot().lock().ok()?)?;
    let path = memory_db.parent()?.join("improvements.json");
    let mut state = read(&path)?;
    match command["type"].as_str()? {
        "improvements.get" => {}
        "improvements.set" => {
            state.insert("enabled".into(), json!(command["enabled"].as_bool()?));
            write(&path, &state)?;
        }
        "improvement.fixing" => {
            let id = command["id"].as_str()?;
            let mut notes = state["notes"].as_array().cloned().unwrap_or_default();
            if let Some(note) = notes.iter_mut().find(|n| n["id"] == id) {
                if note["fixStartedAt"].as_str().is_none_or(str::is_empty) {
                    note["fixStartedAt"] = json!(now());
                }
                state.insert("notes".into(), Value::Array(notes));
                write(&path, &state)?;
            }
        }
        "improvement.dismiss" => {
            let id = command["id"].as_str()?;
            let notes: Vec<Value> = state["notes"].as_array().into_iter().flatten().filter(|n| n["id"] != id).cloned().collect();
            state.insert("notes".into(), Value::Array(notes));
            state["dismissed"][id] = json!(now());
            write(&path, &state)?;
        }
        _ => return None,
    }
    Some(event(&state, running))
}
