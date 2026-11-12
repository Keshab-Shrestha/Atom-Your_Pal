//! The native undo leaves the same files and rows as the TypeScript checkpoints (`rust/scripts/gen-checkpoints.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use ark_runtime::helpers_checkpoints::undo;
use rusqlite::Connection;
use serde_json::{Value, json};

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

fn state(dir: &Path, conn: &Connection) -> Value {
    let mut stmt = conn.prepare("SELECT job_id, rel, kind, state, reason, sha_before, sha_after FROM checkpoints ORDER BY id").unwrap();
    let rows: Vec<Value> = stmt
        .query_map([], |r| Ok(json!({ "job_id": r.get::<_, i64>(0)?, "rel": r.get::<_, String>(1)?, "kind": r.get::<_, String>(2)?, "state": r.get::<_, String>(3)?, "reason": r.get::<_, Option<String>>(4)?, "sha_before": r.get::<_, Option<String>>(5)?, "sha_after": r.get::<_, Option<String>>(6)? })))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    let mut files = serde_json::Map::new();
    for name in ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"] {
        files.insert(name.into(), std::fs::read_to_string(dir.join("work").join(name)).map_or(Value::Null, Value::String));
    }
    let leftovers: Vec<String> = std::fs::read_dir(dir.join("work")).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|n| n.starts_with(".ark-undo")).collect();
    json!({ "rows": rows, "files": files, "leftovers": leftovers })
}

fn fixtures() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/checkpoints"))
}

#[test]
fn every_undo_leaves_the_files_and_rows_the_typescript_leaves() {
    let want: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap()).unwrap();
    let old_base = want["base"].as_str().unwrap();
    for (i, case) in want["cases"].as_array().unwrap().iter().enumerate() {
        let name = case["name"].as_str().unwrap();
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("ark-ckpt-parity-{i}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        copy_dir(&fixtures().join("base"), &dir);
        let conn = Connection::open(dir.join("checkpoints.db")).unwrap();
        conn.execute("UPDATE checkpoints SET path = replace(path, ?, ?)", [old_base, dir.to_str().unwrap()]).unwrap();
        let roots: Vec<PathBuf> = case["roots"].as_array().unwrap().iter().map(|r| PathBuf::from(r.as_str().unwrap().replace(old_base, dir.to_str().unwrap()))).collect();
        let got = undo(&conn, &dir.join("copies"), &roots, 1, case["path"].as_str(), case["force"] == true, false).unwrap();
        let got: Vec<Value> = got.iter().map(|r| r.to_json()).collect();
        assert_eq!(Value::Array(got), case["results"], "{name}: results");
        assert_eq!(state(&dir, &conn), case["after"], "{name}: files and rows");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
