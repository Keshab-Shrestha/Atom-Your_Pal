//! Read-only API routes that Rust answers from the data files: `/v1/memories`, `/v1/brain/notes` and `/v1/audit`
//! (the same JSON as `apps/mac/src/api-server.ts`). Each function gives the data, or the status and message to send.

use std::path::Path;

use ark_core::js::{utf16_len, utf16_prefix};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

use crate::store;

type Reply = Result<Value, (u16, Value)>;

const MEMORIES_LIMIT: i64 = 500;
const NOTE_TEXT_UNITS: usize = 1500;
const LOCAL_OWNER: &str = "local";

fn unavailable(what: &str) -> (u16, Value) {
    (503, json!(format!("ARK {what} is unavailable.")))
}

fn now_iso() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// `GET /v1/memories`: the newest 500 kept facts.
pub fn memories(db: &Path) -> Reply {
    let fail = || unavailable("memory");
    let conn = store::open_read_write(db).map_err(|_| fail())?;
    let mut stmt = conn
        .prepare("SELECT id, text, created_at FROM memories WHERE owner = ? AND superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY id DESC LIMIT ?")
        .map_err(|_| fail())?;
    let rows = stmt.query_map(rusqlite::params![LOCAL_OWNER, now_iso(), MEMORIES_LIMIT], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "text": r.get::<_, String>(1)?, "createdAt": r.get::<_, String>(2)? }))).map_err(|_| fail())?;
    Ok(json!({ "memories": rows.flatten().collect::<Vec<_>>() }))
}

/// The file name of a note that came from a memory, when its source file is `memory-<id>.md`.
fn source_memory_id(conn: &Connection, id: i64) -> Option<String> {
    let path: String = conn.query_row("SELECT path FROM brain_source_files WHERE note_id = ? AND excluded = 0", [id], |r| r.get(0)).optional().ok()??;
    let stem = path.strip_suffix(".md")?;
    let ok = stem.strip_prefix("memory-").is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'));
    ok.then(|| stem.to_string())
}

/// `GET /v1/brain/notes`: the notes of the graph, without ghosts and without memory copies. The text stops at 1500 characters.
pub fn brain_notes(db: &Path) -> Reply {
    let fail = || unavailable("Second Brain");
    let conn = crate::brain::open_read_only(db).ok_or_else(fail)?;
    let graph = crate::brain::graph(&conn).ok_or_else(fail)?;
    let mut notes = Vec::new();
    for node in graph["nodes"].as_array().into_iter().flatten() {
        if node["ghost"] == true {
            continue;
        }
        let Some(id) = node["id"].as_i64() else { continue };
        let row: Option<(String, String, Option<String>, i64, String)> = conn
            .query_row("SELECT title, body, ref, ghost, updated_at FROM brain_notes WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .optional()
            .map_err(|_| fail())?;
        let Some((title, body, reference, ghost, _)) = row else { continue };
        if ghost == 1 || reference.as_deref().is_some_and(|r| r.starts_with("memory:")) {
            continue;
        }
        let truncated = utf16_len(&body) > NOTE_TEXT_UNITS;
        let mut note = json!({ "id": id, "title": title, "text": utf16_prefix(&body, NOTE_TEXT_UNITS), "truncated": truncated, "updatedAt": node["updatedAt"] });
        if let Some(source) = source_memory_id(&conn, id) {
            note["sourceMemoryId"] = json!(source);
        }
        notes.push(note);
    }
    Ok(json!({ "notes": notes, "omitted": graph["omitted"] }))
}

/// `GET /v1/audit?limit=`: the newest changes (ids and states only).
pub fn audit(helpers_db: Option<&Path>, query: &str) -> Reply {
    let limit = query.split('&').find_map(|kv| kv.strip_prefix("limit=")).map_or(Ok(50), str::parse::<i64>);
    let limit = match limit {
        Ok(n) if (1..=500).contains(&n) => n,
        _ => return Err((400, json!("\"limit\" must be a whole number from 1 to 500."))),
    };
    let fail = || unavailable("audit log");
    let conn = store::open_read_write(helpers_db.ok_or_else(fail)?).map_err(|_| fail())?;
    let mut stmt = conn.prepare("SELECT id, at, action, detail FROM audit_log ORDER BY id DESC LIMIT ?").map_err(|_| fail())?;
    let rows = stmt
        .query_map([limit], |r| {
            let detail: String = r.get(3)?;
            Ok(json!({ "id": r.get::<_, i64>(0)?, "at": r.get::<_, String>(1)?, "action": r.get::<_, String>(2)?, "detail": serde_json::from_str::<Value>(&detail).unwrap_or(Value::Null) }))
        })
        .map_err(|_| fail())?;
    Ok(json!({ "entries": rows.flatten().collect::<Vec<_>>() }))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    /// A copy of a fixture file: opening it in place would write a WAL file next to it.
    fn copy(name: &str) -> std::path::PathBuf {
        let to = std::env::temp_dir().join(format!("ark-routes-{}-{name}", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", to.display())).ok();
        }
        std::fs::copy(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR")), &to).unwrap();
        to
    }

    #[test]
    fn memories_come_newest_first_with_ids_text_and_dates() {
        let data = memories(&copy("memory.db")).unwrap();
        let list = data["memories"].as_array().unwrap();
        assert_eq!(list.len(), 17);
        assert_eq!(list[0]["id"], 17);
        assert_eq!(list[16], json!({"id": 1, "text": "Keshab likes green tea.", "createdAt": list[16]["createdAt"].clone()}));
        assert!(list[16]["createdAt"].as_str().unwrap().starts_with("2026-11-01T09:00:"));
        assert!(memories(Path::new("/nonexistent/ark.db")).is_err());
    }

    #[test]
    fn brain_notes_skip_ghosts_and_memory_copies_and_cut_long_text() {
        let db = copy("brain.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute("INSERT INTO brain_notes (title, body, kind, ghost, created_at, updated_at) VALUES ('Very long', ?, 'note', 0, '2026-11-01T09:00:00.000Z', '2026-11-01T09:00:00.000Z')", [format!("{}日本", "x".repeat(1600))]).unwrap();
        drop(conn);
        let data = brain_notes(&db).unwrap();
        let notes = data["notes"].as_array().unwrap();
        assert!(!notes.is_empty());
        let by_title = |t: &str| notes.iter().find(|n| n["title"] == t);
        assert!(by_title("Memory fact").is_none(), "a copy of a memory is not listed");
        let long = by_title("Very long").unwrap();
        assert_eq!(long["truncated"], true);
        assert_eq!(utf16_len(long["text"].as_str().unwrap()), 1500);
        let oslo = by_title("Oslo trip").unwrap();
        assert_eq!(oslo["truncated"], false);
        assert!(oslo["text"].as_str().unwrap().starts_with("Plan the trip"));
        assert_eq!(data["omitted"], 0);
        assert!(notes.iter().all(|n| n.get("sourceMemoryId").is_none()));
    }

    #[test]
    fn the_audit_log_gives_the_newest_entries_and_checks_the_limit() {
        let path = std::env::temp_dir().join(format!("ark-routes-audit-{}.db", std::process::id()));
        std::fs::remove_file(&path).ok();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
            INSERT INTO audit_log (at, action, detail) VALUES ('2026-11-01T00:00:00.000Z', 'start', '{\"id\":1}'), ('2026-11-01T00:00:01.000Z', 'done', '{\"id\":1,\"state\":\"done\"}');").unwrap();
        drop(conn);
        let data = audit(Some(&path), "limit=1").unwrap();
        assert_eq!(data["entries"], json!([{"id": 2, "at": "2026-11-01T00:00:01.000Z", "action": "done", "detail": {"id": 1, "state": "done"}}]));
        assert_eq!(audit(Some(&path), "").unwrap()["entries"].as_array().unwrap().len(), 2);
        for bad in ["limit=0", "limit=501", "limit=abc", "limit=1.5"] {
            assert_eq!(audit(Some(&path), bad).unwrap_err().0, 400, "{bad}");
        }
        assert_eq!(audit(None, "").unwrap_err().0, 503);
    }
}
