//! Native `memory.keepChat` writes the rows of the TypeScript chat index, and the digest text and the plain digest match (`rust/scripts/gen-kept.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_runtime::kept_keep::{Digest, chat_sections, digest_brief, fallback_digest, keep};
use rusqlite::Connection;
use serde_json::{Value, json};

fn rows(conn: &Connection, sql: &str, cols: usize) -> Value {
    let list: Vec<Vec<Value>> = conn
        .prepare(sql)
        .unwrap()
        .query_map([], |r| (0..cols).map(|i| r.get::<_, rusqlite::types::Value>(i).map(|v| match v { rusqlite::types::Value::Text(t) => json!(t), rusqlite::types::Value::Integer(n) => json!(n), _ => Value::Null })).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    json!(list)
}

#[test]
fn rows_and_digests_match_typescript() {
    let f: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/kept.json")).unwrap()).unwrap();
    let messages: Vec<(String, String)> = f["messages"].as_array().unwrap().iter().map(|m| (m[0].as_str().unwrap().into(), m[1].as_str().unwrap().into())).collect();
    let sections = chat_sections(&messages);
    assert_eq!(digest_brief("Tea chat", &sections), f["brief"].as_str().unwrap());
    let plain = fallback_digest("Tea chat", &sections);
    assert_eq!(plain, Digest { summary: f["plain"]["summary"].as_str().unwrap().into(), headings: f["plain"]["headings"].as_array().unwrap().iter().map(|h| h.as_str().unwrap().into()).collect() });
    for (name, digest) in [("plain", plain), ("model", Digest { summary: "  A chat about tea.  ".into(), headings: vec!["Tea talk".into(), "  ".into()] })] {
        let conn = Connection::open_in_memory().unwrap();
        keep(&conn, "c1", "Tea chat", messages.len() as i64, &sections, &digest, None, "2026-11-13T00:00:00.000Z").unwrap();
        let want = &f["cases"][name];
        let tuple = |v: &Value, keys: &[&str]| json!(v.as_array().unwrap().iter().map(|o| keys.iter().map(|k| o[*k].clone()).collect::<Vec<_>>()).collect::<Vec<_>>());
        assert_eq!(rows(&conn, "SELECT chat_id, title, summary, messages, kept_at, vec IS NULL FROM kept_chats", 6), tuple(&want["chats"], &["chat_id", "title", "summary", "messages", "kept_at", "no_vec"]), "{name} chats");
        assert_eq!(rows(&conn, "SELECT chat_id, seq, heading, body FROM kept_sections ORDER BY id", 4), tuple(&want["sections"], &["chat_id", "seq", "heading", "body"]), "{name} sections");
        assert_eq!(rows(&conn, "SELECT section_id, seq, role, text FROM kept_lines ORDER BY id", 4), tuple(&want["lines"], &["section_id", "seq", "role", "text"]), "{name} lines");
        assert_eq!(rows(&conn, "SELECT text, level, ref FROM kept_fts ORDER BY rowid", 3), tuple(&want["fts"], &["text", "level", "ref"]), "{name} fts");
    }
}
