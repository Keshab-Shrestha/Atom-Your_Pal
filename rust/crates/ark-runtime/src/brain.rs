//! The read-only brain commands (`brain.note`, `brain.search`), answered from `memory.db`.
//! The SQL is the SQL of services/memory/src/brain.ts. The connection is read-only with a busy timeout.
//! Every helper gives `None` when it cannot give the answer the TypeScript runtime would give, so the caller forwards the command to Node.

use std::path::Path;
use std::time::Duration;

use ark_protocol::events::{BrainHit, BrainLink, BrainNoteItem, NoteKind};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};

/// How long a read waits for a writer (Node holds the file open).
const BUSY_TIMEOUT: Duration = Duration::from_millis(250);
/// `brain.search` gives at most this many hits (`brain.search(query, 12)` in brain-wiring.ts).
const SEARCH_LIMIT: i64 = 12;
const MAX_QUERY_WORDS: usize = 8;
const SNIPPET_BEFORE: usize = 40;
const SNIPPET_LENGTH: usize = 140;

pub fn open_read_only(path: &Path) -> Option<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
    conn.busy_timeout(BUSY_TIMEOUT).ok()?;
    Some(conn)
}

fn kind_of(text: &str) -> NoteKind {
    match text {
        "memory" => NoteKind::Memory,
        "episode" => NoteKind::Episode,
        "chat" => NoteKind::Chat,
        "project" => NoteKind::Project,
        "entity" => NoteKind::Entity,
        _ => NoteKind::Note,
    }
}

fn links(conn: &Connection, sql: &str, id: i64, with_ghost: bool) -> rusqlite::Result<Vec<BrainLink>> {
    let mut statement = conn.prepare_cached(sql)?;
    let rows = statement.query_map(params![id], |row| {
        Ok(BrainLink {
            id: row.get::<_, i64>(0)?.unsigned_abs(),
            title: row.get(1)?,
            kind: kind_of(&row.get::<_, String>(2)?),
            ghost: if with_ghost { Some(row.get::<_, i64>(4)? == 1) } else { None },
            auto: row.get::<_, i64>(3)? == 1,
        })
    })?;
    rows.collect()
}

/// A note with its links. `None` when the note is gone, when a connected folder holds a copy of it (the state of that copy is Node's to compute), or on any error.
pub fn note(conn: &Connection, id: u64) -> Option<BrainNoteItem> {
    let id = i64::try_from(id).ok().filter(|id| *id > 0)?;
    let row = conn
        .query_row("SELECT title, body, kind, ghost, updated_at FROM brain_notes WHERE id = ?", params![id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?))
        })
        .optional()
        .ok()??;
    // A missing source table means no folder is connected. Any row for this note means Node must answer.
    if let Ok(Some(_)) = conn.query_row("SELECT 1 FROM brain_source_files WHERE note_id = ? AND excluded = 0", params![id], |_| Ok(())).optional() {
        return None;
    }
    let tags = {
        let mut statement = conn.prepare_cached("SELECT tag FROM brain_tags WHERE note = ? ORDER BY tag").ok()?;
        statement.query_map(params![id], |r| r.get::<_, String>(0)).ok()?.collect::<Result<Vec<_>, _>>().ok()?
    };
    let links_out = links(
        conn,
        "SELECT n.id, n.title, n.kind, MIN(l.auto) AS auto, n.ghost FROM brain_links l JOIN brain_notes n ON n.id = l.dst WHERE l.src = ? GROUP BY n.id ORDER BY n.title",
        id,
        true,
    )
    .ok()?;
    let backlinks = links(
        conn,
        "SELECT n.id, n.title, n.kind, MIN(l.auto) AS auto FROM brain_links l JOIN brain_notes n ON n.id = l.src WHERE l.dst = ? GROUP BY n.id ORDER BY n.title",
        id,
        false,
    )
    .ok()?;
    Some(BrainNoteItem {
        source: None,
        id: id.unsigned_abs(),
        title: row.0,
        body: row.1,
        kind: kind_of(&row.2),
        ghost: row.3 == 1,
        tags,
        links: links_out,
        backlinks,
        updated_at: row.4,
    })
}

/// An FTS5 query from the user's words: each word quoted, matched as a prefix (`ftsQuery` in brain.ts).
// ponytail: `char::is_alphanumeric` stands for `[\p{L}\p{N}_]`; it differs for a few combining marks.
fn fts_query(query: &str) -> Option<String> {
    let words: Vec<&str> = query.split(|c: char| !(c.is_alphanumeric() || c == '_')).filter(|w| !w.is_empty()).take(MAX_QUERY_WORDS).collect();
    (!words.is_empty()).then(|| words.iter().map(|w| format!("\"{w}\"*")).collect::<Vec<_>>().join(" "))
}

fn utf16_find(haystack: &[u16], needle: &[u16]) -> Option<usize> {
    if needle.is_empty() {
        return Some(0);
    }
    haystack.windows(needle.len()).position(|w| w == needle)
}

/// A short piece of the body around the first word of the query (`snippetOf` in brain.ts; offsets count UTF-16 units, as in JavaScript).
fn snippet(body: &str, query: &str) -> String {
    let flat: Vec<u16> = body.split_whitespace().collect::<Vec<_>>().join(" ").encode_utf16().collect();
    let lowered: Vec<u16> = String::from_utf16_lossy(&flat).to_lowercase().encode_utf16().collect();
    let lower_query = query.to_lowercase();
    let first = if lower_query.starts_with(char::is_whitespace) { "" } else { lower_query.split_whitespace().next().unwrap_or("") };
    let first: Vec<u16> = first.encode_utf16().collect();
    let start = utf16_find(&lowered, &first).map_or(0, |at| at.saturating_sub(SNIPPET_BEFORE));
    let end = (start + SNIPPET_LENGTH).min(flat.len());
    let part = String::from_utf16_lossy(&flat[start.min(flat.len())..end]);
    format!("{}{}{}", if start > 0 { "…" } else { "" }, part, if start + SNIPPET_LENGTH < flat.len() { "…" } else { "" })
}

/// The hits for a query (at most 12, best match first). `None` on any error.
pub fn search(conn: &Connection, query: &str) -> Option<Vec<BrainHit>> {
    let Some(fts) = fts_query(query) else { return Some(Vec::new()) };
    let mut statement = conn
        .prepare_cached(
            "SELECT n.id, n.title, n.kind, n.body FROM brain_fts f JOIN brain_notes n ON n.id = f.rowid WHERE brain_fts MATCH ? AND n.ghost = 0 ORDER BY bm25(brain_fts) LIMIT ?",
        )
        .ok()?;
    let rows = statement
        .query_map(params![fts, SEARCH_LIMIT], |r| {
            let body: String = r.get(3)?;
            Ok(BrainHit { id: r.get::<_, i64>(0)?.unsigned_abs(), title: r.get(1)?, kind: kind_of(&r.get::<_, String>(2)?), snippet: snippet(&body, query) })
        })
        .ok()?;
    rows.collect::<Result<Vec<_>, _>>().ok()
}
