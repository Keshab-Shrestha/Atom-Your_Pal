//! Native `project.add` and `project.remove` leave the same rows, files and project list as the TypeScript wiring (`rust/scripts/gen-project-add.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use ark_runtime::projects_add::{Outcome, add, remove};
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

struct World {
    root: std::path::PathBuf,
    memory: Connection,
    helpers: Connection,
    state: std::path::PathBuf,
}

fn world(name: &str) -> World {
    let raw = std::env::temp_dir().join(format!("ark-project-add-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&raw).ok();
    std::fs::create_dir_all(&raw).unwrap();
    let root = std::fs::canonicalize(&raw).unwrap();
    for d in ["Developer/haat", "Developer/other", "Developer/notes", "Library/Keys", ".ssh"] {
        std::fs::create_dir_all(root.join("home").join(d)).unwrap();
    }
    std::fs::write(root.join("home/file.txt"), "x").unwrap();
    copy_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/helpers-writes/base"), &root.join("h"));
    for ext in ["-wal", "-shm"] {
        std::fs::remove_file(root.join(format!("h/helpers.db{ext}"))).ok();
    }
    let memory = Connection::open_in_memory().unwrap();
    memory
        .execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, folders TEXT NOT NULL, helper TEXT, provider TEXT, model TEXT, kit TEXT NOT NULL DEFAULT 'folders', web INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE chats (id TEXT PRIMARY KEY, project_id TEXT);",
        )
        .unwrap();
    let state = root.join("ui-state.json");
    std::fs::write(&state, json!({ "current": { "provider": "p", "model": "m" }, "reasoning": [], "projects": [] }).to_string()).unwrap();
    let helpers = Connection::open(root.join("h/helpers.db")).unwrap();
    World { root, memory, helpers, state }
}

fn rows(conn: &Connection, sql: &str, cols: usize) -> Vec<Vec<String>> {
    conn.prepare(sql).unwrap().query_map([], |r| (0..cols).map(|i| r.get::<_, rusqlite::types::Value>(i).map(|v| match v { rusqlite::types::Value::Text(t) => t, rusqlite::types::Value::Integer(n) => n.to_string(), _ => String::new() })).collect()).unwrap().collect::<Result<_, _>>().unwrap()
}

#[test]
fn add_and_remove_match_typescript() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/project-add.json")).unwrap()).unwrap();
    let w = world("parity");
    let (home, agents) = (w.root.join("home"), w.root.join("h/agents"));
    let root = w.root.to_string_lossy().to_string();
    for case in fixture["results"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let outcome = if case["op"] == "add" {
            let path = case["path"].as_str().unwrap().replace("<root>", &root);
            add(&w.memory, &w.helpers, &agents, &home, &w.state, name, &path)
        } else {
            let id: String = w.memory.query_row("SELECT COALESCE((SELECT id FROM projects WHERE name = ?), 'p-none')", [name], |r| r.get(0)).unwrap();
            remove(&w.memory, &w.state, &id, false)
        };
        match case["ok"].as_bool().unwrap() {
            true => assert_eq!(outcome, Outcome::Done, "{case}"),
            false => assert_eq!(outcome, Outcome::Refused(case["error"].as_str().unwrap().to_string()), "{case}"),
        }
    }
    let got_rows: Vec<Value> = rows(&w.memory, "SELECT name, folders, COALESCE(helper, ''), kit, web, archived FROM projects ORDER BY created_at, rowid", 6)
        .into_iter()
        .map(|r| json!({ "name": r[0], "folders": serde_json::from_str::<Value>(&r[1].replace(&root, "<root>")).unwrap(), "helper": if r[2].is_empty() { Value::Null } else { json!(r[2]) }, "kit": r[3], "web": r[4] == "1", "archived": r[5] == "1" }))
        .collect();
    assert_eq!(Value::Array(got_rows), fixture["rows"]);
    let state: Value = serde_json::from_str(&std::fs::read_to_string(&w.state).unwrap()).unwrap();
    let mut items: Vec<Value> = state["projects"].as_array().unwrap().iter().map(|i| json!({ "name": i["name"], "folderLabel": i["folderLabel"], "missing": i["missing"], "archived": i["archived"], "chatCount": i["chatCount"], "web": i["web"], "agent": i["agent"] })).collect();
    items.reverse();
    assert_eq!(Value::Array(items), fixture["items"]);
    let st = &fixture["state"];
    for (id, text) in st["agents"].as_object().unwrap() {
        assert_eq!(&std::fs::read_to_string(agents.join(id).join("soul.md")).unwrap(), text.as_str().unwrap(), "soul.md of {id}");
    }
    let grants: Vec<Value> = rows(&w.helpers, "SELECT helper, path FROM grants ORDER BY helper, path", 2).into_iter().map(|r| json!({ "helper": r[0], "path": r[1].replace(&root, "<root>") })).collect();
    assert_eq!(Value::Array(grants), st["grants"]);
    let souls: Vec<Value> = rows(&w.helpers, "SELECT helper, version, name FROM souls ORDER BY helper, version", 3).into_iter().map(|r| json!({ "helper": r[0], "version": r[1].parse::<i64>().unwrap(), "name": r[2] })).collect();
    assert_eq!(Value::Array(souls), st["souls"]);
    let audit: Vec<Value> = rows(&w.helpers, "SELECT action, detail FROM audit_log WHERE action IN ('agent', 'grant') ORDER BY id", 2).into_iter().map(|r| json!({ "action": r[0], "detail": serde_json::from_str::<Value>(&r[1]).unwrap() })).collect();
    assert_eq!(Value::Array(audit), st["audit"]);
    std::fs::remove_dir_all(&w.root).ok();
}

#[test]
fn deleting_chats_and_many_chats_go_to_node() {
    let w = world("forward");
    let (home, agents) = (w.root.join("home"), w.root.join("h/agents"));
    let path = home.join("Developer/haat").to_string_lossy().to_string();
    assert_eq!(add(&w.memory, &w.helpers, &agents, &home, &w.state, "Haat", &path), Outcome::Done);
    let id: String = w.memory.query_row("SELECT id FROM projects", [], |r| r.get(0)).unwrap();
    w.memory.execute("INSERT INTO chats VALUES ('c1', ?)", [&id]).unwrap();
    assert_eq!(remove(&w.memory, &w.state, &id, true), Outcome::Forward);
    assert_eq!(remove(&w.memory, &w.state, &id, false), Outcome::Done);
    let detached: Option<String> = w.memory.query_row("SELECT project_id FROM chats WHERE id = 'c1'", [], |r| r.get(0)).unwrap();
    assert_eq!(detached, None);
    std::fs::remove_dir_all(&w.root).ok();
}
