//! The Memory page (ADR-278 Phase 2): the `memory` event for `memory.list`, and the writes of `memory.forget`,
//! `memory.clear`, `episode.forget` and `episode.clear`. A port of `islandMemory` in `apps/mac/src/runtime.ts`,
//! `createKeptChats().chats()` in `kept-chats.ts` and `block` in `services/memory/src/suggestions.ts`.
//! Not ported: `memory.keepChat` (it needs a model digest and the embedder) and `memory.dropChat`; they stay in Node.
//! The `indexing` flag of a chat that is being kept lives in Node's memory, so Rust never sends it.

use std::path::Path;

use ark_core::facts::fact_hash;
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{Value, json};

use crate::store::{self, BUSY_TIMEOUT};

const OWNER: &str = "local";
const MAX_MEMORIES: i64 = 500;
const MAX_EPISODES: i64 = 50;
const RECENT_CHATS: i64 = 30;

/// The tables and columns the Memory page reads.
const SCHEMA: &[(&str, &[&str])] = &[
    ("memories", &["id", "text", "owner", "source", "created_at", "expires_at", "superseded_by"]),
    ("episodes", &["id", "owner", "summary", "exchanges", "ended_at"]),
    ("chats", &["id", "title", "updated_at", "pinned", "archived"]),
    ("chat_messages", &["chat_id"]),
    ("kept_chats", &["chat_id", "title", "messages", "kept_at"]),
];

fn now_iso() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// A read-only connection, or `None` when the file has another schema (Node answers then).
pub fn open_read_only(path: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    conn.busy_timeout(BUSY_TIMEOUT).ok()?;
    store::check_schema(&conn, SCHEMA).ok()?;
    Some(conn)
}

/// A read-only connection with no schema check: the feed only reads `PRAGMA data_version` from it.
pub fn open_plain(path: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    conn.busy_timeout(BUSY_TIMEOUT).ok()?;
    Some(conn)
}

/// The `memory` event: live facts (newest 500), summaries (newest 50) and chats (30 recent, then kept ones that are not recent).
pub fn view(conn: &Connection) -> Option<Value> {
    let now = now_iso();
    let live = "owner = ? AND superseded_by IS NULL AND (expires_at IS NULL OR expires_at > ?)";
    let count: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM memories WHERE {live}"), rusqlite::params![OWNER, now], |r| r.get(0)).ok()?;
    let memories: Vec<Value> = conn
        .prepare(&format!("SELECT id, text, created_at, source FROM memories WHERE {live} ORDER BY id DESC LIMIT ?"))
        .ok()?
        .query_map(rusqlite::params![OWNER, now, MAX_MEMORIES], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "text": r.get::<_, String>(1)?, "createdAt": r.get::<_, String>(2)?, "source": r.get::<_, String>(3)? })))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    let episodes: Vec<Value> = conn
        .prepare("SELECT id, summary, ended_at, exchanges FROM episodes WHERE owner = ? ORDER BY ended_at DESC, id DESC LIMIT ?")
        .ok()?
        .query_map(rusqlite::params![OWNER, MAX_EPISODES], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "summary": r.get::<_, String>(1)?, "endedAt": r.get::<_, String>(2)?, "exchanges": r.get::<_, i64>(3)? })))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    Some(json!({ "type": "memory", "enabled": true, "count": count, "memories": memories, "episodes": episodes, "chats": chats(conn)? }))
}

fn chats(conn: &Connection) -> Option<Vec<Value>> {
    let mut kept = std::collections::HashMap::new();
    let mut kept_order = Vec::new();
    let mut stmt = conn.prepare("SELECT chat_id, title, messages, kept_at FROM kept_chats ORDER BY kept_at DESC").ok()?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?))).ok()? {
        let (id, title, messages, kept_at) = row.ok()?;
        kept_order.push(id.clone());
        kept.insert(id, (title, messages, kept_at));
    }
    let mut stmt = conn
        .prepare("SELECT c.id, c.title, c.updated_at, (SELECT COUNT(*) FROM chat_messages m WHERE m.chat_id = c.id) FROM chats c ORDER BY c.pinned DESC, c.updated_at DESC, c.rowid DESC LIMIT ?")
        .ok()?;
    let recent: Vec<(String, String, String, i64)> = stmt.query_map([RECENT_CHATS], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).ok()?.collect::<Result<_, _>>().ok()?;
    let mut items: Vec<Value> = recent
        .iter()
        .map(|(id, title, updated, messages)| {
            let mut item = json!({ "id": id, "title": title, "updatedAt": updated, "messages": messages, "kept": kept.contains_key(id) });
            if let Some((_, _, kept_at)) = kept.get(id) {
                item["keptAt"] = json!(kept_at);
            }
            item
        })
        .collect();
    for id in &kept_order {
        if recent.iter().any(|(r, ..)| r == id) {
            continue;
        }
        let (title, messages, kept_at) = &kept[id];
        items.push(json!({ "id": id, "title": title, "messages": messages, "kept": true, "keptAt": kept_at }));
    }
    Some(items)
}

/// `memory.forget`: removes the fact and blocks its text, so ARK never notices it again. Nothing happens for an unknown id.
pub fn forget(db: &Path, id: u64) -> Result<(), String> {
    let conn = store::open_read_write(db).map_err(|e| e.to_string())?;
    let id = i64::try_from(id).map_err(|e| e.to_string())?;
    let text: Option<String> = conn.query_row("SELECT text FROM memories WHERE owner = ? AND id = ?", rusqlite::params![OWNER, id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
    let Some(text) = text else { return Ok(()) };
    conn.execute("DELETE FROM memories WHERE owner = ? AND id = ?", rusqlite::params![OWNER, id]).map_err(|e| e.to_string())?;
    // The same two statements as `openSuggestions`: the table may not exist in a file Node has not finished opening.
    conn.execute("CREATE TABLE IF NOT EXISTS denied_facts (hash TEXT PRIMARY KEY)", []).map_err(|e| e.to_string())?;
    conn.execute("INSERT OR IGNORE INTO denied_facts (hash) VALUES (?)", [fact_hash(&text)]).map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_all(db: &Path, table: &str) -> Result<(), String> {
    let conn = store::open_read_write(db).map_err(|e| e.to_string())?;
    conn.execute(&format!("DELETE FROM {table} WHERE owner = ?"), [OWNER]).map(|_| ()).map_err(|e| e.to_string())
}

/// `memory.clear`: every fact, kept ones and the others (Node does not block the texts here).
pub fn clear(db: &Path) -> Result<(), String> {
    delete_all(db, "memories")
}

/// `episode.forget`.
pub fn forget_episode(db: &Path, id: u64) -> Result<(), String> {
    let conn = store::open_read_write(db).map_err(|e| e.to_string())?;
    let id = i64::try_from(id).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM episodes WHERE owner = ? AND id = ?", rusqlite::params![OWNER, id]).map(|_| ()).map_err(|e| e.to_string())
}

/// `episode.clear`.
pub fn clear_episodes(db: &Path) -> Result<(), String> {
    delete_all(db, "episodes")
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/memory-view.json")).unwrap()).unwrap()
    }

    /// A copy of the fixture file: opening it in place would write a WAL file next to it.
    fn copy(name: &str) -> std::path::PathBuf {
        let to = std::env::temp_dir().join(format!("ark-memory-{}-{name}.db", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", to.display())).ok();
        }
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/memory-view.db"), &to).unwrap();
        to
    }

    #[test]
    fn the_memory_event_matches_typescript() {
        let db = copy("view");
        let got = view(&open_read_only(&db).unwrap()).unwrap();
        assert_eq!(got, fixture()["event"]);
    }

    #[test]
    fn forget_removes_the_fact_and_blocks_its_text_like_typescript() {
        let db = copy("forget");
        forget(&db, 1).unwrap();
        forget(&db, 999).unwrap();
        let got = view(&open_read_only(&db).unwrap()).unwrap();
        assert_eq!(got["count"], 3);
        assert!(got["memories"].as_array().unwrap().iter().all(|m| m["id"] != 1));
        let conn = Connection::open(&db).unwrap();
        let hash: String = conn.query_row("SELECT hash FROM denied_facts", [], |r| r.get(0)).unwrap();
        let expected = fixture()["hashes"].as_array().unwrap().iter().find(|h| h["text"] == "Keshab likes green tea.").unwrap()["hash"].clone();
        assert_eq!(json!(hash), expected);
        // The full-text index followed the delete (the trigger of the table).
        let hits: i64 = conn.query_row("SELECT COUNT(*) FROM memories_fts WHERE memories_fts MATCH 'tea'", [], |r| r.get(0)).unwrap();
        assert_eq!(hits, 0);
    }

    #[test]
    fn clear_and_the_episode_commands_change_only_their_rows() {
        let db = copy("clear");
        forget_episode(&db, 1).unwrap();
        assert_eq!(view(&open_read_only(&db).unwrap()).unwrap()["episodes"].as_array().unwrap().len(), 1);
        clear_episodes(&db).unwrap();
        clear(&db).unwrap();
        let got = view(&open_read_only(&db).unwrap()).unwrap();
        assert_eq!((got["count"].clone(), got["memories"].clone(), got["episodes"].clone()), (json!(0), json!([]), json!([])));
        assert_eq!(got["chats"].as_array().unwrap().len(), 4, "chats stay");
        let denied: i64 = Connection::open(&db).unwrap().query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'denied_facts'", [], |r| r.get(0)).unwrap();
        assert_eq!(denied, 0, "clear blocks nothing");
    }

    #[test]
    fn a_file_with_another_schema_is_not_read() {
        let path = std::env::temp_dir().join(format!("ark-memory-other-{}.db", std::process::id()));
        std::fs::remove_file(&path).ok();
        Connection::open(&path).unwrap().execute("CREATE TABLE memories (id INTEGER)", []).unwrap();
        assert!(open_read_only(&path).is_none());
        assert!(open_read_only(Path::new("/nonexistent/x.db")).is_none());
    }
}
