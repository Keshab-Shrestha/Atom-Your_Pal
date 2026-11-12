//! `foreground.list`, `foreground.read`, `foreground.dismiss` and `foreground.ack` in Rust (ports of
//! `apps/mac/src/foreground-recovery.ts` and the `ForegroundStore` reads and dismissals in `services/memory/src/foreground.ts`,
//! ADR-157, ADR-278). The tables are `foreground_attempts` and `foreground_answers` in the memory file. Rust only reads them and
//! clears a record (dismiss, ack); Node still prepares, starts and finishes attempts. `None` means "send the line to Node":
//! a missing table, an unreadable file, a line that fails the checks (Node gives the words of the refusal).

use std::path::Path;

use rusqlite::{Connection, OpenFlags, params};
use serde_json::{Map, Value, json};

use crate::sha256::hex_digest;

/// The reply chunk of `foreground.read`, in bytes of its JSON string.
const READ_CHUNK: usize = 8192;
const MAX_OFFSET: i64 = 8_000_000;
const MAX_IDS: usize = 2000;
const LIST_LIMIT: i64 = 100;

fn is_uuid(v: &Value) -> bool {
    let Some(s) = v.as_str() else { return false };
    let parts: Vec<&str> = s.split('-').collect();
    parts.len() == 5 && [8, 4, 4, 4, 12].iter().zip(&parts).all(|(n, p)| p.len() == *n && p.chars().all(|c| c.is_ascii_hexdigit()))
}

fn is_digest(v: &Value) -> bool {
    v.as_str().is_some_and(|s| s.len() == 64 && s.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f')))
}

fn ids(v: &Value) -> bool {
    v.as_array().is_some_and(|a| a.len() <= MAX_IDS && a.iter().all(is_uuid))
}

/// The same checks as `parseForeground`: exact keys, uuids, bounded cursor.
fn valid(command: &Map<String, Value>) -> bool {
    let kind = command.get("type").and_then(Value::as_str).unwrap_or("");
    let keys: &[&str] = match kind {
        "foreground.list" => &["type", "request", "pending", "pendingAnswers"],
        "foreground.read" => &["type", "request", "id", "offset"],
        "foreground.dismiss" => &["type", "request", "id"],
        _ => &["type", "id"],
    };
    if command.keys().any(|k| !keys.contains(&k.as_str())) || (kind != "foreground.ack" && !command.get("request").is_some_and(is_uuid)) {
        return false;
    }
    let get = |k: &str| command.get(k).unwrap_or(&Value::Null);
    match kind {
        "foreground.list" => {
            ids(get("pending"))
                && get("pendingAnswers").as_array().is_some_and(|a| {
                    a.len() <= MAX_IDS && a.iter().all(|r| r.as_object().is_some_and(|o| o.len() == 2 && o.get("id").is_some_and(is_uuid) && o.get("digest").is_some_and(is_digest)))
                })
        }
        "foreground.read" => is_uuid(get("id")) && get("offset").as_i64().is_some_and(|n| (0..=MAX_OFFSET).contains(&n)),
        _ => is_uuid(get("id")),
    }
}

/// The line for the app, or `None` to send `line` to Node. `foreground.ack` and a dismiss write; the rest read.
pub fn answer(memory_db: &Path, line: &str) -> Option<String> {
    if !line.contains("\"foreground.") {
        return None;
    }
    let Value::Object(command) = serde_json::from_str::<Value>(line.trim()).ok()? else { return None };
    let kind = command.get("type")?.as_str()?.to_string();
    if !kind.starts_with("foreground.") || !valid(&command) {
        return None;
    }
    let write = matches!(kind.as_str(), "foreground.dismiss" | "foreground.ack");
    let conn = open(memory_db, write)?;
    let request = command.get("request").cloned().unwrap_or(Value::Null);
    let id = command.get("id").and_then(Value::as_str).unwrap_or("");
    let base = |ok: bool| json!({"type": "foreground.recovery", "request": request, "ok": ok});
    let with = |mut v: Value, k: &str, x: Value| {
        v[k] = x;
        v
    };
    let event = match kind.as_str() {
        "foreground.list" => {
            let pending: Vec<&str> = command["pending"].as_array()?.iter().filter_map(Value::as_str).collect();
            let receipts = command["pendingAnswers"].as_array()?;
            let mut v = with(base(true), "attempts", Value::Array(list(&conn)?));
            v = with(v, "known", Value::Array(pending.into_iter().filter(|p| exists(&conn, p)).map(Value::from).collect()));
            with(v, "knownAnswers", Value::Array(receipts.iter().filter(|r| known_answer(&conn, r)).map(|r| r["id"].clone()).collect()))
        }
        "foreground.dismiss" => match dismiss(&conn, id, false)? {
            true => base(true),
            false => with(base(false), "error", "That attempt is still running or is unavailable. Stop it before dismissing.".into()),
        },
        "foreground.read" => match read(&conn, id, command["offset"].as_i64()?)? {
            Ok(record) => with(base(true), "record", record),
            Err(message) => with(base(false), "error", message.into()),
        },
        _ => {
            // ack: no answer. A refusal keeps the record for a later review.
            dismiss(&conn, id, true);
            return Some(String::new());
        }
    };
    Some(format!("{event}\n"))
}

fn open(path: &Path, write: bool) -> Option<Connection> {
    let flags = if write { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY } | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags).ok()?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).ok()?;
    crate::store::check_schema(&conn, &[("foreground_attempts", &["id", "chat", "state", "reply", "archived", "archive_seq", "reply_hash", "dismissed"]), ("foreground_answers", &["attempt_id", "id", "answer_hash"])]).ok()?;
    Some(conn)
}

struct Row {
    id: String,
    chat: String,
    text: String,
    files: String,
    notes: String,
    source: String,
    provider: Option<String>,
    model: Option<String>,
    state: String,
    created_at: String,
    updated_at: String,
    reply: String,
    archived: bool,
    archive_seq: Option<i64>,
    reply_hash: Option<String>,
    dismissed: bool,
}

fn row(conn: &Connection, id: &str) -> Option<Row> {
    conn.query_row(
        "SELECT id, chat, text, files, notes, source, provider, model, state, created_at, updated_at, reply, archived, archive_seq, reply_hash, dismissed FROM foreground_attempts WHERE id = ?",
        [id],
        |r| {
            Ok(Row { id: r.get(0)?, chat: r.get(1)?, text: r.get(2)?, files: r.get(3)?, notes: r.get(4)?, source: r.get(5)?, provider: r.get(6)?, model: r.get(7)?, state: r.get(8)?, created_at: r.get(9)?, updated_at: r.get(10)?, reply: r.get(11)?, archived: r.get::<_, i64>(12)? == 1, archive_seq: r.get(13)?, reply_hash: r.get(14)?, dismissed: r.get::<_, i64>(15)? == 1 })
        },
    )
    .ok()
}

fn exists(conn: &Connection, id: &str) -> bool {
    conn.query_row("SELECT 1 FROM foreground_attempts WHERE id = ?", [id], |_| Ok(())).is_ok()
}

fn known_answer(conn: &Connection, receipt: &Value) -> bool {
    conn.query_row("SELECT 1 FROM foreground_answers WHERE id = ? AND answer_hash = ?", params![receipt["id"].as_str().unwrap_or(""), receipt["digest"].as_str().unwrap_or("")], |_| Ok(())).is_ok()
}

/// The saved reply: the retained text, or the archived chat message when its hash still matches.
fn reply_of(conn: &Connection, r: &Row) -> String {
    if !r.reply.is_empty() {
        return r.reply.clone();
    }
    let (true, false, Some(seq)) = (r.archived, r.dismissed, r.archive_seq) else { return String::new() };
    let saved: Option<String> = conn.query_row("SELECT content FROM chat_messages WHERE chat_id = ? AND seq = ? AND role = 'assistant'", params![r.chat, seq], |c| c.get(0)).ok();
    saved.filter(|content| r.reply_hash.as_deref() == Some(hex_digest(content.as_bytes()).as_str())).unwrap_or_default()
}

fn answers(conn: &Connection, id: &str) -> Vec<Value> {
    let Ok(mut s) = conn.prepare("SELECT id, question, answer FROM foreground_answers WHERE attempt_id = ? ORDER BY rowid") else { return Vec::new() };
    s.query_map([id], |r| Ok(json!({"id": r.get::<_, String>(0)?, "question": r.get::<_, String>(1)?, "answer": r.get::<_, String>(2)?}))).map(|rows| rows.flatten().collect()).unwrap_or_default()
}

/// The fields of the summary (no text, files, notes, reply, answers).
fn summary(r: &Row) -> Map<String, Value> {
    let mut m = Map::new();
    for (k, v) in [("id", json!(r.id)), ("chat", json!(r.chat)), ("source", json!(r.source))] {
        m.insert(k.into(), v);
    }
    for (k, v) in [("provider", &r.provider), ("model", &r.model)] {
        if let Some(v) = v.as_ref().filter(|v| !v.is_empty()) {
            m.insert(k.into(), json!(v));
        }
    }
    for (k, v) in [("state", json!(r.state)), ("createdAt", json!(r.created_at)), ("updatedAt", json!(r.updated_at)), ("archived", json!(r.archived)), ("dismissed", json!(r.dismissed))] {
        m.insert(k.into(), v);
    }
    m
}

fn list(conn: &Connection) -> Option<Vec<Value>> {
    let mut s = conn.prepare("SELECT id FROM foreground_attempts WHERE dismissed = 0 ORDER BY updated_at DESC, rowid DESC LIMIT ?").ok()?;
    let found: Vec<String> = s.query_map([LIST_LIMIT], |r| r.get(0)).ok()?.flatten().collect();
    Some(
        found
            .iter()
            .filter_map(|id| row(conn, id))
            .map(|r| {
                let mut m = summary(&r);
                m.insert("hasReply".into(), json!(!reply_of(conn, &r).is_empty()));
                m.insert("answerCount".into(), json!(answers(conn, &r.id).len()));
                Value::Object(m)
            })
            .collect(),
    )
}

/// `Ok(record)` or `Err(words)` for the app. `None`: Rust cannot read the row at all, so Node answers.
fn read(conn: &Connection, id: &str, offset: i64) -> Option<Result<Value, &'static str>> {
    let Some(r) = row(conn, id).filter(|r| !r.dismissed) else { return Some(Err("That recovery record is no longer available.")) };
    let reply = reply_of(conn, &r);
    let units: Vec<u16> = reply.encode_utf16().collect();
    let offset = usize::try_from(offset).ok()?;
    let split = offset > 0 && units.get(offset - 1).is_some_and(|u| (0xD800..0xDC00).contains(u)) && units.get(offset).is_some_and(|u| (0xDC00..0xE000).contains(u));
    if offset > units.len() || split {
        return Some(Err("Invalid reply cursor. Reload this record."));
    }
    let tail = String::from_utf16_lossy(&units[offset..]);
    let text = excerpt(&tail, READ_CHUNK);
    let used = text.encode_utf16().count();
    let mut m = summary(&r);
    m.insert("text".into(), json!(r.text));
    m.insert("files".into(), serde_json::from_str(&r.files).ok()?);
    m.insert("notes".into(), serde_json::from_str(&r.notes).ok()?);
    m.insert("reply".into(), json!(text));
    m.insert("offset".into(), json!(offset));
    if offset + used < units.len() {
        m.insert("nextOffset".into(), json!(offset + used));
    }
    m.insert("answers".into(), Value::Array(answers(conn, id)));
    Some(Ok(Value::Object(m)))
}

/// The longest prefix whose JSON string (with quotes) takes at most `max` bytes (`excerpt` in `chat-history.ts`).
fn excerpt(text: &str, max: usize) -> String {
    let mut bytes = 2;
    let mut end = 0;
    for (i, c) in text.char_indices() {
        bytes += match c {
            '"' | '\\' | '\u{8}' | '\u{c}' | '\n' | '\r' | '\t' => 2,
            c if (c as u32) < 0x20 => 6,
            c => c.len_utf8(),
        };
        if bytes > max {
            break;
        }
        end = i + c.len_utf8();
    }
    text[..end].to_string()
}

/// `clear` and its tombstone rules of the store: the ids and hashes stay, the content goes. A running or prepared attempt
/// stays (`false`). With `archived_only` only a completed attempt that is archived goes.
fn dismiss(conn: &Connection, id: &str, archived_only: bool) -> Option<bool> {
    let r = row(conn, id)?;
    if matches!(r.state.as_str(), "running" | "prepared") || (archived_only && !(r.state == "completed" && r.archived)) {
        return Some(false);
    }
    let now = jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    let tx = conn.unchecked_transaction().ok()?;
    tx.execute("UPDATE foreground_attempts SET text = '', files = '[]', notes = '[]', reply = '', dismissed = 1, updated_at = ? WHERE id = ?", params![now, id]).ok()?;
    tx.execute("UPDATE foreground_answers SET question = '', answer = '' WHERE attempt_id = ?", [id]).ok()?;
    tx.commit().ok()?;
    Some(true)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    const A: &str = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const B: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const R: &str = "cccccccc-cccc-cccc-cccc-cccccccccccc";

    fn fixture() -> std::path::PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!("ark-foreground-{}-{}.db", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        std::fs::remove_file(&path).ok();
        let c = Connection::open(&path).unwrap();
        let hash = hex_digest(b"saved reply");
        c.execute_batch(&format!(
            "CREATE TABLE foreground_attempts (id TEXT PRIMARY KEY COLLATE NOCASE, chat TEXT, signature TEXT, text TEXT, files TEXT, notes TEXT, source TEXT, provider TEXT, model TEXT, state TEXT, created_at TEXT, updated_at TEXT, reply TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, archive_seq INTEGER, reply_hash TEXT, dismissed INTEGER NOT NULL DEFAULT 0);
             CREATE TABLE foreground_answers (attempt_id TEXT, id TEXT PRIMARY KEY COLLATE NOCASE, question TEXT, answer TEXT, answer_hash TEXT);
             CREATE TABLE chat_messages (chat_id TEXT, seq INTEGER, role TEXT, content TEXT);
             INSERT INTO chat_messages VALUES ('c1', 4, 'assistant', 'saved reply');
             INSERT INTO foreground_attempts VALUES ('{A}', 'c1', 's', 'hello', '[]', '[]', 'text', 'claude-plan', 'm', 'completed', 't0', 't1', '', 1, 4, '{hash}', 0);
             INSERT INTO foreground_attempts VALUES ('{B}', 'c1', 's2', 'busy', '[]', '[]', 'voice', NULL, NULL, 'running', 't0', 't2', '', 0, NULL, NULL, 0);
             INSERT INTO foreground_answers VALUES ('{B}', '{R}', 'q', 'a', '{h}');",
            h = "d".repeat(64)
        ))
        .unwrap();
        path
    }

    fn ask(db: &Path, body: Value) -> Value {
        serde_json::from_str(answer(db, &body.to_string()).unwrap().trim()).unwrap()
    }

    #[test]
    fn list_gives_summaries_and_the_known_ids() {
        let db = fixture();
        let v = ask(&db, json!({"type": "foreground.list", "request": R, "pending": [A.to_uppercase(), R], "pendingAnswers": [{"id": R, "digest": "d".repeat(64)}, {"id": A, "digest": "e".repeat(64)}]}));
        assert_eq!(v["ok"], true);
        let attempts = v["attempts"].as_array().unwrap();
        assert_eq!(attempts[0]["id"], B, "newest update first");
        assert_eq!((attempts[0]["hasReply"].clone(), attempts[0]["answerCount"].clone()), (json!(false), json!(1)));
        assert_eq!(attempts[1]["hasReply"], true, "the archived reply is read from the chat when its hash matches");
        assert!(attempts[1].get("text").is_none());
        assert_eq!(v["known"], json!([A.to_uppercase()]));
        assert_eq!(v["knownAnswers"], json!([R]));
    }

    #[test]
    fn read_gives_the_record_and_dismiss_keeps_a_running_attempt() {
        let db = fixture();
        let v = ask(&db, json!({"type": "foreground.read", "request": R, "id": A, "offset": 6}));
        assert_eq!((v["record"]["reply"].as_str(), v["record"]["text"].as_str(), v["record"]["offset"].as_i64()), (Some("reply"), Some("hello"), Some(6)));
        assert!(v["record"].get("nextOffset").is_none());
        assert_eq!(ask(&db, json!({"type": "foreground.read", "request": R, "id": A, "offset": 99}))["error"], "Invalid reply cursor. Reload this record.");
        assert_eq!(ask(&db, json!({"type": "foreground.dismiss", "request": R, "id": B}))["ok"], false);
        assert_eq!(ask(&db, json!({"type": "foreground.dismiss", "request": R, "id": A}))["ok"], true);
        assert_eq!(ask(&db, json!({"type": "foreground.read", "request": R, "id": A, "offset": 0}))["error"], "That recovery record is no longer available.");
        let c = Connection::open(&db).unwrap();
        let (text, dismissed): (String, i64) = c.query_row("SELECT text, dismissed FROM foreground_attempts WHERE id = ?", [A], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((text.as_str(), dismissed), ("", 1), "the content goes, the row stays as a tombstone");
    }

    #[test]
    fn ack_clears_only_an_archived_completion_and_answers_nothing() {
        let db = fixture();
        assert_eq!(answer(&db, &json!({"type": "foreground.ack", "id": B}).to_string()).unwrap(), "");
        assert_eq!(answer(&db, &json!({"type": "foreground.ack", "id": A}).to_string()).unwrap(), "");
        let c = Connection::open(&db).unwrap();
        let n: i64 = c.query_row("SELECT dismissed FROM foreground_attempts WHERE id = ?", [B], |r| r.get(0)).unwrap();
        let m: i64 = c.query_row("SELECT dismissed FROM foreground_attempts WHERE id = ?", [A], |r| r.get(0)).unwrap();
        assert_eq!((n, m), (0, 1));
    }

    #[test]
    fn a_bad_line_goes_to_node() {
        let db = fixture();
        assert!(answer(&db, &json!({"type": "foreground.read", "request": "x", "id": A, "offset": 0}).to_string()).is_none());
        assert!(answer(&db, &json!({"type": "foreground.read", "request": R, "id": A, "offset": 0, "extra": 1}).to_string()).is_none());
        assert!(answer(&db, r#"{"type":"chat.send"}"#).is_none());
    }

    #[test]
    fn excerpt_counts_json_bytes_and_keeps_whole_characters() {
        assert_eq!(excerpt("abcdef", 5), "abc");
        assert_eq!(excerpt("a\"b", 5), "a\"", "a quote takes two bytes");
        assert_eq!(excerpt("éé", 6), "éé");
        assert_eq!(excerpt("ééé", 7), "éé");
    }
}
