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
    // Rule 2 of section 5f: a file with another schema is Node's to read.
    crate::store::check_schema(&conn, crate::store::BRAIN_SCHEMA).ok()?;
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

const MAX_GRAPH_NODES: usize = 400;

/// `new Date(text).toISOString()`; `None` when `text` is not a date.
fn iso(text: &str) -> Option<String> {
    let at: jiff::Timestamp = text.parse().ok()?;
    Some(at.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// The `brain` event of `brain.get`: at most 400 notes (most linked first), their links, the tags with counts (`graph()` and `tags()` in brain.ts and brain-wiring.ts).
/// `None` on any error or a date that JavaScript would not read as Node does.
pub fn graph(conn: &Connection) -> Option<serde_json::Value> {
    use serde_json::json;
    use std::collections::HashMap;
    let rows: Vec<(i64, String, String, i64, String)> = conn
        .prepare_cached("SELECT id, title, kind, ghost, updated_at FROM brain_notes")
        .ok()?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    let edges: Vec<(i64, i64, i64)> = conn
        .prepare_cached("SELECT src, dst, MIN(auto) AS auto FROM brain_links WHERE src != dst GROUP BY src, dst")
        .ok()?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    let mut degree: HashMap<i64, u64> = HashMap::new();
    for (a, b, _) in &edges {
        *degree.entry(*a).or_default() += 1;
        *degree.entry(*b).or_default() += 1;
    }
    let mut tags: HashMap<i64, Vec<String>> = HashMap::new();
    let tag_rows: Vec<(i64, String)> =
        conn.prepare_cached("SELECT note, tag FROM brain_tags ORDER BY tag").ok()?.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).ok()?.collect::<Result<_, _>>().ok()?;
    for (note, tag) in tag_rows {
        tags.entry(note).or_default().push(tag);
    }
    let mut ranked: Vec<_> = rows.iter().map(|r| (r, degree.get(&r.0).copied().unwrap_or(0))).collect();
    ranked.sort_by(|(x, dx), (y, dy)| dy.cmp(dx).then_with(|| y.4.cmp(&x.4)).then_with(|| x.0.cmp(&y.0)));
    let kept = &ranked[..ranked.len().min(MAX_GRAPH_NODES)];
    let ids: std::collections::HashSet<i64> = kept.iter().map(|(r, _)| r.0).collect();
    let mut nodes = Vec::new();
    for (r, d) in kept {
        let kind = match kind_of(&r.2) {
            NoteKind::Memory => "memory",
            NoteKind::Episode => "episode",
            NoteKind::Chat => "chat",
            NoteKind::Project => "project",
            NoteKind::Entity => "entity",
            NoteKind::Note => "note",
        };
        nodes.push(json!({ "id": r.0, "title": r.1, "kind": kind, "ghost": r.3 == 1, "tags": tags.get(&r.0).cloned().unwrap_or_default(), "degree": d, "updatedAt": iso(&r.4)? }));
    }
    let edge_json: Vec<_> = edges.iter().filter(|(a, b, _)| ids.contains(a) && ids.contains(b)).map(|(a, b, auto)| json!({ "a": a, "b": b, "auto": *auto == 1 })).collect();
    let tag_counts: Vec<serde_json::Value> = conn
        .prepare_cached("SELECT tag, count(*) AS n FROM brain_tags GROUP BY tag ORDER BY n DESC, tag LIMIT 100")
        .ok()?
        .query_map([], |r| Ok(json!({ "tag": r.get::<_, String>(0)?, "count": r.get::<_, i64>(1)? })))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    Some(json!({ "type": "brain", "nodes": nodes, "edges": edge_json, "omitted": rows.len().saturating_sub(kept.len()), "tags": tag_counts }))
}
