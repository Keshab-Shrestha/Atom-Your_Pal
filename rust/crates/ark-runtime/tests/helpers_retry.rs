//! The native retry plans leave the same tables as the TypeScript store (`rust/scripts/gen-retry.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use ark_runtime::{helpers_life, helpers_retry};
use rusqlite::{Connection, types::ValueRef};
use serde_json::{Value, json};

const NEW_JOBS_FROM: i64 = 11;

fn fixtures() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures"))
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

fn dump(conn: &Connection) -> Value {
    let audit: Vec<Value> = rows(conn, "SELECT action, detail FROM audit_log ORDER BY id")
        .iter()
        .map(|r| {
            let mut detail = serde_json::from_str::<Value>(r["detail"].as_str().unwrap()).unwrap();
            if detail.get("ms").is_some() {
                detail["ms"] = json!("<ms>"); // the time a task lived is the clock of the moment
            }
            json!({ "action": r["action"], "detail": detail })
        })
        .collect();
    let jobs: Vec<Value> = rows(conn, "SELECT * FROM jobs ORDER BY id")
        .into_iter()
        .map(|mut j| {
            if j["id"].as_i64().unwrap() > NEW_JOBS_FROM {
                j["created_at"] = json!("<new>");
                if !j["ended_at"].is_null() {
                    j["ended_at"] = json!("<new>");
                }
            }
            j
        })
        .collect();
    json!({ "jobs": jobs, "events": rows(conn, "SELECT job_id, kind FROM job_events ORDER BY id"), "audit": audit })
}

fn copy_base(name: &str) -> (PathBuf, Connection) {
    let dir = std::env::temp_dir().join(format!("ark-retry-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::copy(fixtures().join("helpers-writes/base/helpers.db"), dir.join("helpers.db")).unwrap();
    let conn = Connection::open(dir.join("helpers.db")).unwrap();
    (dir, conn)
}

fn run_step(conn: &Connection, step: &Value) -> Value {
    let (id, op) = (step["id"].as_i64().unwrap(), step["op"].as_str().unwrap());
    match op {
        "retry" => helpers_retry::queue_native_retry(conn, id, true).map_or(json!({ "refused": true }), |(job, created)| json!({ "done": { "job": job, "created": created } })),
        "fail" => helpers_retry::fail_queued_retry(conn, id, step["reason"].as_str().unwrap()).map_or(json!({ "refused": true }), |()| json!({ "done": null })),
        _ => helpers_life::remove(conn, id).map_or(json!({ "refused": true }), |gone| json!({ "done": gone })),
    }
}

#[test]
fn every_retry_plan_leaves_the_tables_the_typescript_leaves() {
    let want: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("retry/expected.json")).unwrap()).unwrap();
    let (dir, conn) = copy_base("before");
    assert_eq!(dump(&conn), want["before"], "the base");
    std::fs::remove_dir_all(Path::new(&dir)).unwrap();
    for (i, case) in want["cases"].as_array().unwrap().iter().enumerate() {
        let name = case["name"].as_str().unwrap();
        let (dir, conn) = copy_base(&format!("case{i}"));
        for (step, outcome) in case["steps"].as_array().unwrap().iter().zip(case["outcomes"].as_array().unwrap()) {
            let got = run_step(&conn, step);
            if let Some(done) = outcome.get("done") {
                assert_eq!(got["done"], *done, "{name}: {step}");
            } else {
                assert!(got.get("refused").is_some(), "{name}: {step} is refused (Node gives the words)");
            }
        }
        let got = dump(&conn);
        for part in ["jobs", "events", "audit"] {
            let (g, w) = (got[part].as_array().unwrap(), case["after"][part].as_array().unwrap());
            assert_eq!(g.len(), w.len(), "{name}: {part} count");
            for (a, b) in g.iter().zip(w) {
                for (key, value) in a.as_object().unwrap() {
                    assert_eq!(value, &b[key], "{name}: {part} {key} of {a}");
                }
                assert_eq!(a, b, "{name}: {part}");
            }
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
