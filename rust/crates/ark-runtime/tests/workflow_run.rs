//! `workflow.run` makes one plan and a chain of queued tasks in a copy of the fixture helpers file; the run time is saved.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;

use ark_runtime::workflow_run::start;
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

#[test]
fn a_run_makes_a_plan_and_a_chain_of_tasks() {
    let dir = std::env::temp_dir().join(format!("ark-workflow-run-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    copy_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/helpers-writes/base"), &dir);
    for ext in ["-wal", "-shm"] {
        std::fs::remove_file(dir.join(format!("helpers.db{ext}"))).ok();
    }
    let flow = json!({ "id": "w1", "name": "Daily", "enabled": false, "trigger": { "kind": "manual" }, "steps": [{ "helper": "sid", "task": "Find X" }, { "helper": "quill", "task": "Write X" }], "createdAt": "2026-11-01T00:00:00.000Z" });
    std::fs::write(dir.join("workflows.json"), json!({ "version": 1, "workflows": [flow] }).to_string()).unwrap();
    let conn = Connection::open(dir.join("helpers.db")).unwrap();
    let now = "2026-11-13T00:00:00Z".parse().unwrap();
    assert_eq!(start(&dir, &conn, "nope", now).unwrap().as_deref(), Some("That workflow is gone."));
    assert_eq!(start(&dir, &conn, "w1", now).unwrap(), None);
    let jobs: Vec<(i64, String, String, String)> = conn.prepare("SELECT id, helper, state, chat_id FROM jobs WHERE chat_id LIKE 'workflow-w1-%' ORDER BY id").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(jobs.len(), 2);
    assert!(jobs.iter().all(|j| j.2 == "queued"));
    let blocker: i64 = conn.query_row("SELECT blocker_id FROM job_blockers WHERE job_id = ?", [jobs[1].0], |r| r.get(0)).unwrap();
    assert_eq!(blocker, jobs[0].0);
    let portions: String = conn.query_row("SELECT portions FROM work_plans ORDER BY id DESC LIMIT 1", [], |r| r.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&portions).unwrap()[1], json!({ "n": 2, "agent": "quill", "task": "Write X", "after": [1] }));
    let saved: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("workflows.json")).unwrap()).unwrap();
    assert!(saved["workflows"][0]["lastRunAt"].as_str().unwrap().starts_with("2026-11-13"));
    std::fs::remove_dir_all(&dir).ok();
}
