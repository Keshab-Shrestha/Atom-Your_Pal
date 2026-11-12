//! Native `agent.create` leaves the same files and rows as the TypeScript store (`rust/scripts/gen-agent-create.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use ark_runtime::helpers_agent_create::create;
use rusqlite::Connection;
use serde_json::{Value, json};

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let target = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() { copy_dir(&e.path(), &target) } else { std::fs::copy(e.path(), target).unwrap(); }
    }
}

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ark-agent-create-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    copy_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/helpers-writes/base"), &dir);
    for ext in ["-wal", "-shm"] {
        std::fs::remove_file(dir.join(format!("helpers.db{ext}"))).ok();
    }
    dir
}

#[test]
fn creates_the_same_agents_as_typescript() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/agent-create.json")).unwrap()).unwrap();
    let dir = scratch("parity");
    let conn = Connection::open(dir.join("helpers.db")).unwrap();
    for case in fixture["results"].as_array().unwrap() {
        let mut command = case["input"].clone();
        command["type"] = json!("agent.create");
        let got = create(&conn, &dir.join("agents"), &command);
        match case["ok"].as_bool().unwrap() {
            true => assert_eq!(got.as_deref(), case["id"].as_str(), "{}", case["input"]),
            false => assert_eq!(got, None, "{} should be refused: {}", case["input"], case["error"]),
        }
    }
    let state = &fixture["state"];
    for (id, text) in state["agents"].as_object().unwrap() {
        assert_eq!(&std::fs::read_to_string(dir.join("agents").join(id).join("soul.md")).unwrap(), text.as_str().unwrap(), "soul.md of {id}");
    }
    let mut stmt = conn.prepare("SELECT helper, version, name, personality, how_it_works, rules, lessons FROM souls ORDER BY helper, version").unwrap();
    let souls: Vec<Value> = stmt
        .query_map([], |r| Ok(json!({ "helper": r.get::<_, String>(0)?, "version": r.get::<_, i64>(1)?, "name": r.get::<_, String>(2)?, "personality": r.get::<_, String>(3)?, "how_it_works": r.get::<_, String>(4)?, "rules": r.get::<_, String>(5)?, "lessons": r.get::<_, String>(6)? })))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(Value::Array(souls), state["souls"]);
    let mut stmt = conn.prepare("SELECT action, detail FROM audit_log WHERE action = 'agent' ORDER BY id").unwrap();
    let audit: Vec<Value> = stmt.query_map([], |r| Ok(json!({ "action": r.get::<_, String>(0)?, "detail": serde_json::from_str::<Value>(&r.get::<_, String>(1)?).unwrap() }))).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(Value::Array(audit), state["audit"]);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn unicode_names_and_managers_go_to_node() {
    let dir = scratch("forward");
    let conn = Connection::open(dir.join("helpers.db")).unwrap();
    let base = json!({ "type": "agent.create", "name": "Cafe", "role": "coder", "kit": "think", "personality": "x", "howItWorks": "", "rules": "" });
    let mut accent = base.clone();
    accent["name"] = json!("Café");
    let mut boss = base.clone();
    boss["reportsTo"] = json!("boss");
    assert_eq!(create(&conn, &dir.join("agents"), &accent), None);
    assert_eq!(create(&conn, &dir.join("agents"), &boss), None);
    assert_eq!(create(&conn, &dir.join("agents"), &base).as_deref(), Some("cafe"));
    std::fs::remove_dir_all(&dir).ok();
}
