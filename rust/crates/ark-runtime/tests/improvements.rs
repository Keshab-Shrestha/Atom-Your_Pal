//! Native `improvements.*` and `improvement.*` leave the same file and event as the TypeScript store (`rust/scripts/gen-improvements.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_runtime::improvements::{answer, observe};
use serde_json::{Value, json};

/// A time made by the clock reads `<now>`; the times of the seed stay.
fn timeless(mut state: Value, seed: &Value) -> Value {
    let old = seed.to_string();
    if let Some(notes) = state["notes"].as_array_mut() {
        for n in notes {
            if n["fixStartedAt"].as_str().is_some_and(|t| !old.contains(t)) {
                n["fixStartedAt"] = json!("<now>");
            }
        }
    }
    if let Some(d) = state["dismissed"].as_object_mut() {
        for v in d.values_mut() {
            if v.as_str().is_some_and(|t| !old.contains(t)) {
                *v = json!("<now>");
            }
        }
    }
    state
}

#[test]
fn commands_match_typescript() {
    let fixture: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/improvements.json")).unwrap()).unwrap();
    let dir = std::env::temp_dir().join(format!("ark-improvements-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(&dir).unwrap();
    let memory = dir.join("memory.db");
    std::fs::write(dir.join("improvements.json"), fixture["seed"].to_string()).unwrap();
    let line = |v: &Value| format!("{v}\n");
    assert_eq!(answer(&memory, "{\"type\":\"improvements.get\"}\n"), None, "Node answers until it has said whether a run goes");
    observe("{\"type\":\"improvements\",\"enabled\":true,\"running\":true,\"notes\":[],\"resolved\":[]}\n");
    let got: Value = serde_json::from_str(&answer(&memory, "{\"type\":\"improvements.get\"}\n").unwrap()).unwrap();
    assert_eq!(got, fixture["get"]);
    for step in fixture["steps"].as_array().unwrap() {
        let reply: Value = serde_json::from_str(&answer(&memory, &line(&step["cmd"])).unwrap()).unwrap();
        assert_eq!(reply, step["event"], "{} event", step["cmd"]);
        let file: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("improvements.json")).unwrap()).unwrap();
        assert_eq!(timeless(file, &fixture["seed"]), timeless(step["file"].clone(), &fixture["seed"]), "{} file", step["cmd"]);
    }
    assert_eq!(answer(&memory, "{\"type\":\"improvements.run\"}\n"), None);
    std::fs::write(dir.join("improvements.json"), "not json").unwrap();
    assert_eq!(answer(&memory, "{\"type\":\"improvements.get\"}\n"), None);
    std::fs::remove_dir_all(&dir).ok();
}
