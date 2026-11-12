//! The helper writes of the Rust runtime leave the same tables as the TypeScript store (`rust/scripts/gen-helpers-writes.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use ark_runtime::helpers_write;
use rusqlite::{Connection, OpenFlags, types::ValueRef};
use serde_json::{Value, json};

/// Tasks made by a write get the clock of the moment; the test cannot compare their time.
const NEW_JOBS_FROM: i64 = 11;

fn rows(conn: &Connection, sql: &str) -> Value {
    let mut stmt = conn.prepare(sql).unwrap();
    let names: Vec<String> = stmt.column_names().map(str::to_string).collect();
    let out: Vec<Value> = stmt
        .query_map([], |row| {
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
        .collect::<Result<_, _>>()
        .unwrap();
    Value::Array(out)
}

fn dump(conn: &Connection) -> Value {
    let audit: Vec<Value> = rows(conn, "SELECT action, detail FROM audit_log ORDER BY id")
        .as_array()
        .unwrap()
        .iter()
        .map(|r| json!({ "action": r["action"], "detail": serde_json::from_str::<Value>(r["detail"].as_str().unwrap()).unwrap() }))
        .collect();
    json!({
        "jobs": rows(conn, "SELECT * FROM jobs ORDER BY id").as_array().unwrap().iter().map(|j| {
            let mut j = j.clone();
            if j["id"].as_i64().unwrap() > NEW_JOBS_FROM {
                j["created_at"] = json!("<new>");
            }
            j
        }).collect::<Vec<_>>(),
        "labels": rows(conn, "SELECT * FROM job_labels ORDER BY job_id, label"),
        "blockers": rows(conn, "SELECT * FROM job_blockers ORDER BY job_id, blocker_id"),
        "events": rows(conn, "SELECT job_id, kind FROM job_events ORDER BY id"),
        "comments": rows(conn, "SELECT job_id FROM job_comments ORDER BY id"),
        "reports": rows(conn, "SELECT job_id FROM reports ORDER BY job_id"),
        "planJobs": rows(conn, "SELECT * FROM plan_jobs ORDER BY plan_id, n"),
        "audit": audit,
    })
}

fn copy_base(name: &str) -> (PathBuf, Connection) {
    let dir = std::env::temp_dir().join(format!("ark-helpers-writes-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("helpers.db");
    std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers-writes/base/helpers.db"), &file).unwrap();
    let conn = Connection::open_with_flags(&file, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap();
    conn.busy_timeout(std::time::Duration::from_secs(5)).unwrap();
    (dir, conn)
}

#[test]
fn every_write_leaves_the_tables_the_typescript_leaves() {
    let want: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers-writes/expected.json")).unwrap()).unwrap();
    let (_dir, conn) = copy_base("before");
    assert_eq!(dump(&conn), want["before"], "the base file");
    for (i, case) in want["cases"].as_array().unwrap().iter().enumerate() {
        let name = case["name"].as_str().unwrap();
        let (_dir, conn) = copy_base(&format!("case{i}"));
        let outcomes: Vec<&str> = case["outcomes"].as_array().unwrap().iter().map(|o| o.as_str().unwrap()).collect();
        let cmds = case["cmds"].as_array().unwrap();
        let mut got = Vec::new();
        for cmd in cmds {
            got.push(if helpers_write::apply(&conn, cmd).is_some() { "done" } else { "refused" });
        }
        if outcomes == ["forward"] {
            assert_eq!(got, ["refused"], "{name}: Rust sends it to Node");
            assert_eq!(dump(&conn), want["before"], "{name}: nothing changed");
            continue;
        }
        let said: Vec<&str> = outcomes.iter().map(|o| if o.starts_with("refused") { "refused" } else { "done" }).collect();
        assert_eq!(got, said, "{name}: outcomes");
        assert_eq!(dump(&conn), case["after"], "{name}: tables");
    }
}
