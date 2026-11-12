//! The native brief settings and a brief with no sources match the TypeScript store and runner (`rust/scripts/gen-brief.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::sync::atomic::AtomicBool;

use ark_runtime::brief::{Run, ensure, make, settings, update};
use rusqlite::Connection;
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/brief.json")).unwrap()).unwrap()
}

#[test]
fn settings_changes_match_typescript() {
    let conn = Connection::open_in_memory().unwrap();
    ensure(&conn).unwrap();
    for step in fixture()["steps"].as_array().unwrap() {
        let result = update(&conn, &step["change"]);
        match step.get("error") {
            Some(e) => assert_eq!(result.unwrap_err(), e.as_str().unwrap(), "{step}"),
            None => result.unwrap(),
        }
        assert_eq!(Value::Object(settings(&conn)), step["settings"], "{step}");
    }
}

#[test]
fn a_brief_with_no_sources_matches_typescript() {
    let f = fixture();
    let conn = Connection::open_in_memory().unwrap();
    ensure(&conn).unwrap();
    for step in f["steps"].as_array().unwrap() {
        update(&conn, &step["change"]).ok();
    }
    let agents = std::path::Path::new("/none");
    let stop = AtomicBool::new(false);
    let write = |_: &str| -> Result<String, String> { panic!("no data, no model") };
    make(&Run { memory: &conn, helpers: None, agents, write: &write, abort: &stop }).unwrap();
    let (lines, source, prepared): (String, String, Option<String>) = conn.query_row("SELECT lines, source, preparation FROM briefs", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&lines).unwrap(), f["savedPrepared"]["lines"]);
    assert_eq!(source, f["savedPrepared"]["source"].as_str().unwrap());
    assert_eq!(serde_json::from_str::<Value>(&prepared.unwrap()).unwrap(), f["savedPrepared"]["preparation"]);
}

#[test]
fn a_plain_brief_uses_the_model_or_the_template() {
    let conn = Connection::open_in_memory().unwrap();
    ensure(&conn).unwrap();
    let helpers = Connection::open_in_memory().unwrap();
    helpers.execute_batch("CREATE TABLE jobs (id INTEGER PRIMARY KEY, helper TEXT, state TEXT, ended_at TEXT, plan_status TEXT); CREATE TABLE reports (job_id INTEGER, title TEXT); CREATE TABLE proposals (state TEXT); CREATE TABLE skill_drafts (state TEXT); INSERT INTO jobs VALUES (1, 'sid', 'done', '2099-01-01T00:00:00Z', NULL), (2, 'sid', 'queued', NULL, 'awaiting'); INSERT INTO reports VALUES (1, 'Found X');").unwrap();
    let agents = std::path::Path::new("/none");
    let stop = AtomicBool::new(false);
    let seen = std::cell::RefCell::new(String::new());
    let ok = |task: &str| -> Result<String, String> {
        *seen.borrow_mut() = task.to_string();
        Ok("- Good morning.\n* One thing is done.\n".into())
    };
    make(&Run { memory: &conn, helpers: Some(&helpers), agents, write: &ok, abort: &stop }).unwrap();
    assert!(seen.borrow().contains("Finished while you were away:\n- sid: Found X"));
    assert!(seen.borrow().contains("1 plan to approve"));
    let lines: String = conn.query_row("SELECT lines FROM briefs", [], |r| r.get(0)).unwrap();
    assert_eq!(lines, "[\"Good morning.\",\"One thing is done.\"]");
    let down = |_: &str| -> Result<String, String> { Err("no model".into()) };
    make(&Run { memory: &conn, helpers: Some(&helpers), agents, write: &down, abort: &stop }).unwrap();
    let (lines, source): (String, String) = conn.query_row("SELECT lines, source FROM briefs ORDER BY id DESC LIMIT 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!(source, "template");
    assert!(lines.contains("Done:") && lines.contains("Waiting for you: 1 plan to approve."));
    // An aborted run saves nothing.
    let aborted = AtomicBool::new(true);
    assert!(make(&Run { memory: &conn, helpers: Some(&helpers), agents, write: &ok, abort: &aborted }).is_err());
}
