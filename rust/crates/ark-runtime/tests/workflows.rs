//! Native `workflow.save` and `workflow.delete` leave the same `workflows.json` as the TypeScript store (`rust/scripts/gen-workflows.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use ark_runtime::workflows::answer;
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
    let dir = std::env::temp_dir().join(format!("ark-workflows-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    copy_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/helpers-writes/base"), &dir);
    for ext in ["-wal", "-shm"] {
        std::fs::remove_file(dir.join(format!("helpers.db{ext}"))).ok();
    }
    dir
}

fn kept(dir: &Path) -> Vec<Value> {
    let raw: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("workflows.json")).unwrap()).unwrap();
    normal(raw["workflows"].as_array().unwrap())
}

/// A made-up id is random: both sides read `<id>` for it.
fn normal(list: &[Value]) -> Vec<Value> {
    list.iter().map(|w| if w["name"] == "Fresh id" { let mut w = w.clone(); w["id"] = json!("<id>"); w } else { w.clone() }).collect()
}

#[test]
fn save_and_delete_match_typescript() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/workflows.json")).unwrap()).unwrap();
    let dir = scratch("parity");
    let memory = dir.join("memory.db");
    for (call, result) in fixture["calls"].as_array().unwrap().iter().zip(fixture["results"].as_array().unwrap()) {
        let line = format!("{call}\n");
        let reply: Value = serde_json::from_str(&answer(&memory, &line).unwrap_or_else(|| panic!("forwarded: {call}"))).unwrap();
        assert_eq!(reply["type"], "workflows");
        match result["ok"].as_bool().unwrap() {
            true => assert!(reply.get("problem").is_none(), "{call}: {reply}"),
            false => assert_eq!(reply["problem"], result["error"], "{call}"),
        }
    }
    let mut got = kept(&dir);
    got.iter_mut().for_each(|w| { w.as_object_mut().unwrap().remove("nextAt"); });
    assert_eq!(Value::Array(got), Value::Array(normal(fixture["kept"].as_array().unwrap())));
    let reply: Value = serde_json::from_str(&answer(&memory, "{\"type\":\"workflows.list\"}\n").unwrap()).unwrap();
    assert!(reply["workflows"].as_array().unwrap().iter().all(|w| w.get("nextAt").is_none() == (w["enabled"] == false || w["trigger"]["kind"] != "schedule")), "only a published schedule has a next time");
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn the_twenty_first_workflow_is_refused_and_foreign_lines_go_to_node() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/workflows.json")).unwrap()).unwrap();
    let dir = scratch("limit");
    let memory = dir.join("memory.db");
    let mut last = Value::Null;
    for i in 0..21 {
        let w = json!({ "id": format!("w{i}"), "name": format!("W{i}"), "enabled": true, "trigger": { "kind": "schedule", "schedule": { "kind": "daily", "minute": 5 } }, "steps": [{ "helper": "sid", "task": "t" }], "createdAt": "2026-11-01T00:00:00.000Z" });
        last = serde_json::from_str(&answer(&memory, &format!("{}\n", json!({ "type": "workflow.save", "workflow": w }))).unwrap()).unwrap();
    }
    assert_eq!(last["problem"], fixture["limit"]);
    assert!(last["workflows"].as_array().unwrap().iter().all(|w| w.get("nextAt").is_some()), "a published schedule shows its next time");
    assert_eq!(answer(&memory, "{\"type\":\"workflow.run\",\"id\":\"w1\"}\n"), None);
    assert_eq!(answer(&memory, "{\"type\":\"workflow.save\",\"workflow\":5}\n"), None);
    std::fs::write(dir.join("workflows.json"), "not json").unwrap();
    assert_eq!(answer(&memory, "{\"type\":\"workflows.list\"}\n"), None);
    std::fs::remove_dir_all(&dir).ok();
}
