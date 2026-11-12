//! The `chats` event for `chats.list` (ADR-278 Phase 2): a port of `sendChats` in `apps/mac/src/island.ts` and `islandChats.list` in
//! `runtime.ts`. The chats, the access mode, the chat's own model and its thinking choice come from the memory file. What only Node can
//! compute (the model in Settings, the thinking levels of each model, the project items) comes from `data/ui-state.json`, which
//! `runtime.ts` writes when `ARK_MEMORY_OWNER=rust`. Without that file, or with a file of another shape, Node answers.

use std::path::Path;

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{Map, Value, json};

use crate::store::{self, BUSY_TIMEOUT};

const LISTED: i64 = 50;
const FLAGGED: i64 = 500;

const SCHEMA: &[(&str, &[&str])] = &[
    ("chats", &["id", "title", "updated_at", "project_id", "pinned", "archived", "flags_version", "provider", "model"]),
    ("chat_messages", &["chat_id"]),
    ("chat_access", &["chat_id", "mode"]),
    ("chat_reasoning", &["chat_id", "provider", "model", "effort"]),
];

/// A read-only connection, or `None` when the file has another schema.
pub fn open_read_only(path: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    conn.busy_timeout(BUSY_TIMEOUT).ok()?;
    store::check_schema(&conn, SCHEMA).ok()?;
    Some(conn)
}

/// `chatWriter` in `chat-owner.ts`: chats that another surface writes. The window reads them only.
fn is_written_elsewhere(id: &str) -> bool {
    id == "telegram" || id.strip_prefix("routine-").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// The shape of `data/ui-state.json`.
pub struct UiState {
    current: (String, String),
    reasoning: Vec<Value>,
    projects: Option<Vec<Value>>,
}

impl UiState {
    pub fn read(path: &Path) -> Option<UiState> {
        let value: Value = serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()?;
        let current = (value["current"]["provider"].as_str()?.to_string(), value["current"]["model"].as_str()?.to_string());
        let projects = match &value["projects"] {
            Value::Null => None,
            Value::Array(list) => Some(list.clone()),
            _ => return None,
        };
        Some(UiState { current, reasoning: value["reasoning"].as_array()?.clone(), projects })
    }

    fn project(&self, id: &str) -> Option<&Value> {
        self.projects.as_ref()?.iter().find(|p| p["id"] == id)
    }

    /// `settings.reasoning(provider, model)`: the listed capability, else the default for an unknown model.
    fn capability(&self, provider: &str, model: &str) -> Value {
        if let Some(found) = self.reasoning.iter().find(|r| r["provider"] == provider && r["model"] == model) {
            return found.clone();
        }
        let note = if provider != "claude-plan" && provider != "codex" { "This provider does not expose thinking controls in ARK." } else { "Thinking levels are unavailable for this model. Refresh the model catalog in Settings." };
        json!({ "provider": provider, "model": model, "levels": [], "default": if provider == "codex" { "low" } else { "off" }, "note": note })
    }
}

struct Row {
    id: String,
    title: String,
    updated_at: String,
    messages: i64,
    project_id: Option<String>,
    pinned: bool,
    archived: bool,
    flags_version: i64,
}

/// `memory.chats.list(...)`: pinned first, then newest.
fn list(conn: &Connection, project: Option<Option<&str>>, pinned: Option<bool>, archived: Option<bool>, limit: i64) -> Option<Vec<Row>> {
    let mut sql = String::from("SELECT c.id, c.title, c.updated_at, c.project_id, c.pinned, c.archived, c.flags_version, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) FROM chats c WHERE 1 = 1");
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    match project {
        Some(None) => sql.push_str(" AND c.project_id IS NULL"),
        Some(Some(id)) => {
            sql.push_str(" AND c.project_id = ?");
            args.push(id.to_string().into());
        }
        None => {}
    }
    for (column, flag) in [("pinned", pinned), ("archived", archived)] {
        if let Some(flag) = flag {
            sql.push_str(&format!(" AND c.{column} = ?"));
            args.push(i64::from(flag).into());
        }
    }
    sql.push_str(" ORDER BY c.pinned DESC, c.updated_at DESC, c.rowid DESC LIMIT ?");
    args.push(limit.into());
    let mut stmt = conn.prepare(&sql).ok()?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(args), |r| {
            Ok(Row { id: r.get(0)?, title: r.get(1)?, updated_at: r.get(2)?, project_id: r.get(3)?, pinned: r.get::<_, i64>(4)? != 0, archived: r.get::<_, i64>(5)? != 0, flags_version: r.get(6)?, messages: r.get(7)? })
        })
        .ok()?;
    rows.collect::<Result<_, _>>().ok()
}

/// The chats of the window: plain chats and each project's, newest first; then the pinned and archived ones not yet in.
fn listed(conn: &Connection, state: &UiState) -> Option<Vec<Value>> {
    let mut by_id: Vec<Row> = Vec::new();
    let take = |rows: Vec<Row>, out: &mut Vec<Row>| {
        for row in rows {
            match out.iter().position(|r| r.id == row.id) {
                Some(i) => out[i] = row,
                None => out.push(row),
            }
        }
    };
    let mut summaries: Vec<Row> = Vec::new();
    match &state.projects {
        None => take(list(conn, None, None, None, LISTED)?, &mut summaries),
        Some(projects) => {
            take(list(conn, Some(None), None, Some(false), LISTED)?, &mut summaries);
            for p in projects {
                take(list(conn, Some(Some(p["id"].as_str()?)), None, Some(false), LISTED)?, &mut summaries);
            }
            // JavaScript's sort is stable: equal dates keep their order.
            summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        }
    }
    take(summaries, &mut by_id);
    take(list(conn, None, Some(true), None, FLAGGED)?, &mut by_id);
    take(list(conn, None, None, Some(true), FLAGGED)?, &mut by_id);
    by_id
            .into_iter()
            .map(|c| {
                let mut item = json!({ "id": c.id, "title": if c.id == "telegram" { "Telegram".to_string() } else { c.title }, "updatedAt": c.updated_at, "messages": c.messages });
                let fields = item.as_object_mut()?;
                if let Some(p) = &c.project_id {
                    fields.insert("projectId".into(), json!(p));
                }
                if c.pinned {
                    fields.insert("pinned".into(), json!(true));
                }
                if c.archived {
                    fields.insert("archived".into(), json!(true));
                }
                if c.flags_version != 0 {
                    fields.insert("flagsVersion".into(), json!(c.flags_version));
                }
                if is_written_elsewhere(&c.id) {
                    fields.insert("readOnly".into(), json!(true));
                }
                Some(item)
            })
            .collect::<Option<Vec<_>>>()
}

/// The `chats` event with `current` as the open chat (empty for none).
pub fn event(conn: &Connection, state: &UiState, current: &str) -> Option<Value> {
    let row: Option<(Option<String>, Option<String>, Option<String>)> =
        conn.query_row("SELECT project_id, provider, model FROM chats WHERE id = ?", [current], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional().ok()?;
    let (project_id, own_provider, own_model) = row.unwrap_or((None, None, None));
    let own = match (own_provider, own_model) {
        (Some(p), Some(m)) => Some((p, m)),
        _ => project_id.as_deref().and_then(|id| state.project(id)).and_then(|p| Some((p["provider"].as_str()?.to_string(), p["model"].as_str()?.to_string()))),
    };
    let mut out = Map::new();
    out.insert("type".into(), json!("chats"));
    out.insert("chats".into(), Value::Array(listed(conn, state)?));
    out.insert("current".into(), json!(current));
    if !current.is_empty()
        && let Some((provider, model)) = &own
    {
        out.insert("currentProvider".into(), json!(provider));
        out.insert("currentModel".into(), json!(model));
    }
    if let Some(projects) = &state.projects {
        out.insert("projects".into(), Value::Array(projects.clone()));
    }
    if !current.is_empty() {
        if let Some(id) = &project_id {
            out.insert("currentProjectId".into(), json!(id));
        }
        let mode: Option<String> = conn.query_row("SELECT mode FROM chat_access WHERE chat_id = ?", [current], |r| r.get(0)).optional().ok()?;
        out.insert("access".into(), json!(mode.unwrap_or_else(|| "checked".into())));
        let (provider, model) = own.unwrap_or_else(|| state.current.clone());
        let mut reasoning = state.capability(&provider, &model);
        let selected: Option<String> = conn
            .query_row("SELECT effort FROM chat_reasoning WHERE chat_id = ? AND provider = ? AND model = ?", [current, &provider, &model], |r| r.get(0))
            .optional()
            .ok()?;
        let effective = selected.clone().or_else(|| reasoning["default"].as_str().map(String::from));
        let fields = reasoning.as_object_mut()?;
        if let Some(selected) = selected {
            fields.insert("selected".into(), json!(selected));
        }
        fields.insert("effective".into(), json!(effective));
        out.insert("reasoning".into(), reasoning);
    }
    Some(Value::Object(out))
}

/// Used by the tests to look at a chat by id.
#[cfg(test)]
fn by_id(event: &Value) -> std::collections::HashMap<String, Value> {
    event["chats"].as_array().into_iter().flatten().map(|c| (c["id"].as_str().unwrap_or_default().to_string(), c.clone())).collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn fixtures() -> (Connection, UiState, Value) {
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        let db = std::env::temp_dir().join(format!("ark-chats-{}-{}.db", std::process::id(), NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", db.display())).ok();
        }
        std::fs::copy(format!("{dir}/chats-view.db"), &db).unwrap();
        let conn = open_read_only(&db).unwrap();
        let state = UiState::read(Path::new(&format!("{dir}/chats-view-state.json"))).unwrap();
        let expected: Value = serde_json::from_str(&std::fs::read_to_string(format!("{dir}/chats-view.json")).unwrap()).unwrap();
        (conn, state, expected)
    }

    #[test]
    fn the_chats_event_matches_typescript_for_each_current_chat() {
        let (conn, state, expected) = fixtures();
        let cases = expected["events"].as_array().unwrap();
        assert!(cases.len() >= 6);
        for case in cases {
            let current = case["current"].as_str().unwrap();
            assert_eq!(event(&conn, &state, current).unwrap(), case["event"], "current {current:?}");
        }
    }

    #[test]
    fn telegram_is_read_only_and_titled() {
        let (conn, state, _) = fixtures();
        let chats = by_id(&event(&conn, &state, "").unwrap());
        assert_eq!(chats["telegram"]["readOnly"], true);
        assert_eq!(chats["telegram"]["title"], "Telegram");
        assert_eq!(chats["routine-7"]["readOnly"], true);
        assert!(chats["plain-1"].get("readOnly").is_none());
    }

    #[test]
    fn a_bad_state_file_gives_nothing() {
        let path = std::env::temp_dir().join(format!("ark-chats-state-{}.json", std::process::id()));
        std::fs::write(&path, "{\"current\":{}}").unwrap();
        assert!(UiState::read(&path).is_none());
        assert!(UiState::read(Path::new("/nonexistent/ui-state.json")).is_none());
    }
}
