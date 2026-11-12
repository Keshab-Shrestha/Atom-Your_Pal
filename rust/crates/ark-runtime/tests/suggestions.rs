//! Native `suggestions.deny` and `suggestions.set` leave the same rows as the TypeScript store (`rust/scripts/gen-suggestions.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_runtime::suggestions::{answer, observe};
use rusqlite::Connection;
use serde_json::{Value, json};

fn tables(conn: &Connection) -> Value {
    let suggestions: Vec<Value> = conn
        .prepare("SELECT id, text, hash, chat_id, created_at FROM fact_suggestions ORDER BY id").unwrap()
        .query_map([], |r| Ok(json!({ "id": r.get::<_, i64>(0)?, "text": r.get::<_, String>(1)?, "hash": r.get::<_, String>(2)?, "chat_id": r.get::<_, String>(3)?, "created_at": r.get::<_, String>(4)? })))
        .unwrap().collect::<Result<_, _>>().unwrap();
    let denied: Vec<Value> = conn.prepare("SELECT hash FROM denied_facts ORDER BY hash").unwrap().query_map([], |r| Ok(json!({ "hash": r.get::<_, String>(0)? }))).unwrap().collect::<Result<_, _>>().unwrap();
    let off: Option<String> = conn.query_row("SELECT value FROM suggestion_settings WHERE key = 'enabled'", [], |r| r.get(0)).ok();
    json!({ "suggestions": suggestions, "denied": denied, "enabled": off.as_deref() != Some("off") })
}

#[test]
fn deny_and_set_match_typescript() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/suggestions.json")).unwrap()).unwrap();
    let path = std::env::temp_dir().join(format!("ark-suggestions-{}.db", std::process::id()));
    std::fs::remove_file(&path).ok();
    let conn = Connection::open(&path).unwrap();
    conn.execute_batch("CREATE TABLE fact_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, hash TEXT NOT NULL, chat_id TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE denied_facts (hash TEXT PRIMARY KEY); CREATE TABLE suggestion_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").unwrap();
    for r in fixture["seed"]["suggestions"].as_array().unwrap() {
        // Old enough to expire in a real clock is not wanted here: the rows get today's time.
        let now = jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
        conn.execute("INSERT INTO fact_suggestions (id, text, hash, chat_id, created_at) VALUES (?, ?, ?, ?, ?)", rusqlite::params![r["id"].as_i64(), r["text"].as_str(), r["hash"].as_str(), r["chat_id"].as_str(), now]).unwrap();
    }
    let line = |v: &Value| format!("{v}\n");
    assert_eq!(answer(&path, &line(&json!({ "type": "suggestions.set", "enabled": true }))), None, "Node answers until it has sent its receipts");
    observe("{\"type\":\"suggestions\",\"enabled\":true,\"items\":[],\"kept\":[{\"id\":5,\"text\":\"Kept\"}]}\n");
    for step in fixture["steps"].as_array().unwrap() {
        let reply: Value = serde_json::from_str(&answer(&path, &line(&step["cmd"])).expect("answered")).unwrap();
        assert_eq!(reply["kept"], json!([{ "id": 5, "text": "Kept" }]));
        let mut got = tables(&conn);
        let mut want = step["after"].clone();
        for t in [&mut got, &mut want] {
            t["suggestions"].as_array_mut().unwrap().iter_mut().for_each(|r| { r.as_object_mut().unwrap().remove("created_at"); });
        }
        assert_eq!(got, want, "{}", step["cmd"]);
        assert_eq!(reply["enabled"], want["enabled"]);
        assert_eq!(reply["items"].as_array().unwrap().len(), want["suggestions"].as_array().unwrap().len());
    }
    assert_eq!(answer(&path, "{\"type\":\"suggestions.accept\",\"id\":1}\n"), None);
    conn.execute("INSERT INTO fact_suggestions (text, hash, chat_id, created_at) VALUES ('Café', 'h', 'c', '2026-11-01T00:00:00.000Z')", []).unwrap();
    assert_eq!(answer(&path, &line(&json!({ "type": "suggestions.deny", "id": 4 }))), None, "a text outside ASCII goes to Node");
    std::fs::remove_file(&path).ok();
}
