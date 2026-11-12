//! Native `improvements.run` gives the same state as the TypeScript improver for one made-up log (`rust/scripts/gen-improve-run.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_runtime::improve_run::{normalize_reason, run};
use serde_json::{Map, Value};

#[test]
fn a_run_matches_typescript() {
    let f: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/improve-run.json")).unwrap()).unwrap();
    let lines: Vec<String> = f["lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect();
    let now: jiff::Timestamp = f["now"].as_str().unwrap().parse().unwrap();
    let seed: Map<String, Value> = f["seed"].as_object().unwrap().clone();
    let answer = f["answer"].as_str().unwrap().to_string();
    let asked = std::cell::RefCell::new(Vec::new());
    let next = run(&seed, &lines, now.as_millisecond(), &|text| {
        asked.borrow_mut().push(text.to_string());
        Ok(answer.clone())
    });
    // `enabled`, `dismissed` and the other keys are kept as the seed had them.
    let mut got = Value::Object(next);
    got["lastRunAt"] = f["after"]["lastRunAt"].clone();
    assert_eq!(got, f["after"]);
    assert_eq!(asked.borrow().len(), 1);
    assert_eq!(serde_json::from_str::<Value>(&asked.borrow()[0]).unwrap(), serde_json::from_str::<Value>(f["asked"][0].as_str().unwrap()).unwrap());
}

#[test]
fn a_failed_model_call_leaves_the_plain_findings() {
    let f: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/improve-run.json")).unwrap()).unwrap();
    let lines: Vec<String> = f["lines"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect();
    let now: jiff::Timestamp = f["now"].as_str().unwrap().parse().unwrap();
    let next = run(f["seed"].as_object().unwrap(), &lines, now.as_millisecond(), &|_| Err("no model".into()));
    assert!(next["notes"].as_array().unwrap().iter().any(|n| n["why"] == "ARK saw this often enough to count."));
}

#[test]
fn reasons_are_flattened_like_typescript() {
    let f: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/improve-run.json")).unwrap()).unwrap();
    for pair in f["reasons"].as_array().unwrap() {
        assert_eq!(normalize_reason(pair[0].as_str().unwrap()), pair[1].as_str().unwrap(), "{pair}");
    }
}
