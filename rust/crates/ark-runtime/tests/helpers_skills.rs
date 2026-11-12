//! The native skill decisions leave the same rows and files as the TypeScript store (`rust/scripts/gen-skills.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use ark_runtime::helpers_skills;
use rusqlite::{Connection, types::ValueRef};
use serde_json::{Value, json};

const OLD: &str = "2026-01-01T00:00:00.000Z";

fn fixtures() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/skills"))
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_dir(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn rows(conn: &Connection, sql: &str) -> Vec<Value> {
    let mut stmt = conn.prepare(sql).unwrap();
    let names: Vec<String> = stmt.column_names().map(str::to_string).collect();
    stmt.query_map([], |row| {
        let mut object = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            let value = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                ValueRef::Blob(_) => Value::Null,
            };
            object.insert(name.clone(), value);
        }
        Ok(Value::Object(object))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

fn walk(root: &Path, rel: &Path, out: &mut BTreeMap<String, String>) {
    for entry in std::fs::read_dir(root.join(rel)).unwrap() {
        let entry = entry.unwrap();
        let path = rel.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            walk(root, &path, out);
        } else {
            out.insert(path.to_string_lossy().into_owned(), std::fs::read_to_string(root.join(&path)).unwrap());
        }
    }
}

fn dump(dir: &Path, conn: &Connection) -> Value {
    let mask = |mut r: Value| {
        if r.get("decided_at").is_some_and(|d| d.as_str().is_some_and(|d| d != OLD)) {
            r["decided_at"] = json!("<now>");
        }
        r
    };
    let audit: Vec<Value> = rows(conn, "SELECT action, detail FROM audit_log ORDER BY id").iter().map(|r| json!({ "action": r["action"], "detail": serde_json::from_str::<Value>(r["detail"].as_str().unwrap()).unwrap() })).collect();
    let mut files = BTreeMap::new();
    walk(&dir.join("skills"), Path::new(""), &mut files);
    json!({ "drafts": rows(conn, "SELECT * FROM skill_drafts ORDER BY id").into_iter().map(mask).collect::<Vec<_>>(), "edits": rows(conn, "SELECT * FROM skill_edits ORDER BY id"), "audit": audit, "files": files })
}

#[test]
fn every_decision_leaves_the_rows_and_files_the_typescript_leaves() {
    let want: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap()).unwrap();
    let copy = |name: &str| {
        let dir = std::env::temp_dir().join(format!("ark-skills-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        copy_dir(&fixtures().join("base"), &dir);
        let conn = Connection::open(dir.join("helpers.db")).unwrap();
        (dir, conn)
    };
    let (dir, conn) = copy("before");
    assert_eq!(dump(&dir, &conn), want["before"], "the base");
    std::fs::remove_dir_all(&dir).unwrap();
    for (i, case) in want["cases"].as_array().unwrap().iter().enumerate() {
        let name = case["name"].as_str().unwrap();
        let (dir, conn) = copy(&format!("case{i}"));
        let (ark, user) = (dir.join("skills"), dir.join("home/.claude/skills"));
        let got: Vec<&str> = case["cmds"].as_array().unwrap().iter().map(|cmd| if helpers_skills::apply(&conn, cmd, &ark, &user).is_some() { "done" } else { "refused" }).collect();
        let said: Vec<&str> = case["outcomes"].as_array().unwrap().iter().map(|o| if o.as_str().unwrap().starts_with("refused") { "refused" } else { "done" }).collect();
        assert_eq!(got, said, "{name}: outcomes");
        assert_eq!(dump(&dir, &conn), case["after"], "{name}: rows and files");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

#[test]
fn the_hub_part_is_the_one_the_typescript_builds() {
    let want: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap()).unwrap();
    let conn = Connection::open_with_flags(fixtures().join("base/helpers.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert_eq!(helpers_skills::hub_payload(&conn, None).unwrap().unwrap(), want["hubPayload"]);
}

#[test]
fn the_models_and_the_paperclip_issues_are_the_ones_the_typescript_builds() {
    use ark_runtime::helpers_nodeparts as parts;
    let want: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap()).unwrap();
    assert_eq!(parts::models(&Value::Null), want["nodeParts"]["models"]);
    assert_eq!(parts::paperclip(&fixtures().join("paperclip.json"), Some("http://localhost:3100"), &Value::Null).unwrap(), want["nodeParts"]["paperclip"]);
}
