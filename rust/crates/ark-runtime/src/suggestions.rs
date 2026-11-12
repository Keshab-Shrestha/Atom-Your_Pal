//! `suggestions.deny` and `suggestions.set` (ADR-278): ports of `deny` and `setEnabled` in `services/memory/src/suggestions.ts`, and the
//! `suggestions` event of `island.ts`. The receipts of facts kept by themselves (`kept`) live in the memory of Node, so the event takes them
//! from the last `suggestions` event Node sent; with none yet, Node answers. `suggestions.accept` and `.undo` are here too (the memory
//! store write of `keep`, and the receipt list). `suggestions.get` stays in Node: Node owns the receipts of facts it keeps by itself and the
//! watch that pushes them, so it must see the `get`. A text with letters outside ASCII goes to Node:
//! its hash needs Unicode NFKC folding.

use std::path::Path;
use std::sync::{Mutex, OnceLock};

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::sha256::hex_digest;

const SUGGESTION_DAYS: i64 = 14;
const DAY_MS: i64 = 86_400_000;
const HASH_CHARS: usize = 32;

// ponytail: one process-wide copy of the last `kept` list; a second runtime in one process would share it.
static KEPT: OnceLock<Mutex<Option<Value>>> = OnceLock::new();

fn kept_slot() -> &'static Mutex<Option<Value>> {
    KEPT.get_or_init(|| Mutex::new(None))
}

/// A line Node sent to the app: a `suggestions` event gives the receipts.
pub fn observe(line: &str) {
    if !line.starts_with("{\"type\":\"suggestions\"") {
        return;
    }
    if let (Ok(event), Ok(mut slot)) = (serde_json::from_str::<Value>(line), kept_slot().lock()) {
        *slot = Some(event["kept"].clone());
    }
}

/// `foldFact` for ASCII text, then the first 32 hex digits of its SHA-256 (`hashOf`).
fn hash_of(text: &str) -> String {
    let lower = text.to_lowercase();
    // `\s+` to one space (an edge space stays until the trim), then the trailing dots, then the trim.
    let mut folded = String::new();
    for c in lower.chars() {
        if !c.is_whitespace() { folded.push(c) } else if !folded.ends_with(' ') { folded.push(' ') }
    }
    let folded = folded.trim_end_matches('.').trim();
    hex_digest(folded.as_bytes()).chars().take(HASH_CHARS).collect()
}

fn sweep(conn: &Connection) -> rusqlite::Result<()> {
    let cutoff = jiff::Timestamp::now().as_millisecond() - SUGGESTION_DAYS * DAY_MS;
    let cutoff = jiff::Timestamp::from_millisecond(cutoff).map_or_else(|_| String::new(), |t| t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string());
    conn.execute("DELETE FROM fact_suggestions WHERE created_at < ?", [cutoff]).map(|_| ())
}

fn event(conn: &Connection, kept: &Value) -> Option<String> {
    sweep(conn).ok()?;
    let enabled = conn.query_row("SELECT value FROM suggestion_settings WHERE key = 'enabled'", [], |r| r.get::<_, String>(0)).optional().ok()?.is_none_or(|v| v != "off");
    let items: Vec<Value> = conn
        .prepare("SELECT id, text, created_at FROM fact_suggestions ORDER BY id")
        .ok()?
        .query_map([], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "text": r.get::<_, String>(1)?, "createdAt": r.get::<_, String>(2)? })))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    Some(format!("{}\n", json!({ "type": "suggestions", "enabled": enabled, "items": items, "kept": kept })))
}

/// The line for the app, or `None` when Node must answer.
pub fn answer(memory_db: &Path, line: &str) -> Option<String> {
    if !["\"suggestions.deny\"", "\"suggestions.set\"", "\"suggestions.accept\"", "\"suggestions.undo\""].iter().any(|k| line.contains(k)) {
        return None;
    }
    let command: Value = serde_json::from_str(line).ok()?;
    let kept = kept_slot().lock().ok()?.clone()?;
    let conn = crate::store::open_read_write(memory_db).ok()?;
    let mut problem = None;
    let mut kept = kept;
    match command["type"].as_str()? {
        "suggestions.accept" => {
            let id = command["id"].as_i64()?;
            let edited = match command.get("text") {
                None | Some(Value::Null) => None,
                Some(t) => Some(t.as_str()?),
            };
            // A refusal leaves the suggestion waiting, so it can be edited; the app hears the words.
            problem = accept(&conn, id, edited).err();
        }
        "suggestions.undo" => {
            let id = command["id"].as_i64()?;
            let list = kept.as_array()?.clone();
            if let Some(receipt) = list.iter().find(|r| r["id"].as_i64() == Some(id)) {
                let text = receipt["text"].as_str()?;
                if !text.is_ascii() {
                    return None;
                }
                let gone = conn.execute("DELETE FROM memories WHERE owner = 'local' AND id = ?", [id]).ok()? > 0;
                if gone {
                    conn.execute("INSERT OR IGNORE INTO denied_facts (hash) VALUES (?)", [hash_of(text)]).ok()?;
                    kept = Value::Array(list.into_iter().filter(|r| r["id"].as_i64() != Some(id)).collect());
                    if let Ok(mut slot) = kept_slot().lock() {
                        *slot = Some(kept.clone());
                    }
                }
            }
        }
        "suggestions.deny" => {
            let id = command["id"].as_i64()?;
            let text: Option<String> = conn.query_row("SELECT text FROM fact_suggestions WHERE id = ?", [id], |r| r.get(0)).optional().ok()?;
            if let Some(text) = text {
                if !text.is_ascii() {
                    return None;
                }
                conn.execute("INSERT OR IGNORE INTO denied_facts (hash) VALUES (?)", [hash_of(&text)]).ok()?;
                conn.execute("DELETE FROM fact_suggestions WHERE id = ?", [id]).ok()?;
            }
        }
        "suggestions.set" => {
            let on = command["enabled"].as_bool()?;
            conn.execute("INSERT INTO suggestion_settings (key, value) VALUES ('enabled', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params![if on { "on" } else { "off" }]).ok()?;
        }
        _ => return None,
    }
    let line = event(&conn, &kept)?;
    Some(match problem {
        Some(message) => format!("{}{line}", ark_protocol::Event::error(ark_protocol::events::ErrorStage::Settings, &message).to_line()),
        None => line,
    })
}

const MAX_MEMORIES: i64 = 500;

/// `accept`: keeps the fact through the checks of `keep` in `services/memory/src/store.ts`, then drops the suggestion. `Err` has the words.
fn accept(conn: &Connection, id: i64, edited: Option<&str>) -> Result<(), String> {
    let row: Option<String> = conn.query_row("SELECT text FROM fact_suggestions WHERE id = ?", [id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let Some(original) = row else { return Err("That suggestion is gone.".into()) };
    let text = edited.unwrap_or(&original).split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err("Say what to remember: the fact is empty.".into());
    }
    if crate::reply::looks_secret(&text) {
        return Err("That looks like a password or other secret; ARK does not keep those.".into());
    }
    let now = jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let live = "superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?)";
    let existing: Option<i64> = conn.query_row(&format!("SELECT id FROM memories WHERE owner = 'local' AND lower(text) = lower(?) AND {live}"), params![text, now], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    if existing.is_none() {
        let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM memories WHERE owner = 'local' AND {live}"), [&now], |r| r.get(0)).map_err(|e| e.to_string())?;
        if count >= MAX_MEMORIES {
            return Err(format!("Memory is full ({MAX_MEMORIES} kept). Ask the user to forget some first."));
        }
        conn.execute("INSERT INTO memories (text, owner, scope, source, request_id, created_at, expires_at) VALUES (?, 'local', 'personal', 'text', NULL, ?, NULL)", params![text, now]).map_err(|e| e.to_string())?;
    }
    conn.execute("DELETE FROM fact_suggestions WHERE id = ?", [id]).map_err(|e| e.to_string())?;
    Ok(())
}
