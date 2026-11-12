//! Soul proposals and test cases of the Helpers page (ADR-278 Phase 4, slice 4). A port of `proposalTable.list`
//! (`feedback.ts`), `testCaseTable` (`test-cases.ts`) and `testsOf`, `testCases` in `apps/mac/src/island-helpers.ts`.

use jiff::Timestamp;
use rusqlite::Connection;
use serde_json::{Map, Value, json};

/// The tables and columns these views read.
pub const SCHEMA: &[(&str, &[&str])] = &[
    ("proposals", &["id", "helper", "field", "text", "reason", "job_id", "state", "created_at", "previous_version"]),
    ("test_cases", &["id", "target_kind", "target", "job_id", "task", "created_at"]),
    ("test_results", &["kind", "item_id", "case_id", "task", "state", "better", "reason", "old_answer", "new_answer", "at"]),
];

/// Proposals listed per worker: every pending one and the newest few others.
const PROPOSALS_LISTED: i64 = 5;
const TEST_TASK_CHARS: usize = 200;
const TEST_ANSWER_CHARS: usize = 800;

/// `text.slice(0, limit - 1) + "…"` when the text is longer than `limit`.
// ponytail: JavaScript counts UTF-16 units; this counts characters, so text with emoji near the cut can differ by one.
fn cut_to(text: &str, limit: usize) -> String {
    if text.chars().count() <= limit {
        return text.to_string();
    }
    let mut cut: String = text.chars().take(limit - 1).collect();
    cut.push('…');
    cut
}

/// A soul proposal's or skill edit's test run; `None` when it has none (`testsOf`).
pub fn tests_of(conn: &Connection, kind: &str, id: i64) -> Option<Option<Value>> {
    let mut stmt = conn.prepare("SELECT case_id, task, state, better, reason, old_answer, new_answer FROM test_results WHERE kind = ? AND item_id = ? ORDER BY case_id DESC").ok()?;
    type Row = (i64, String, String, Option<String>, Option<String>, Option<String>, Option<String>);
    let rows: Vec<Row> = stmt.query_map(rusqlite::params![kind, id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).ok()?.collect::<Result<_, _>>().ok()?;
    if rows.is_empty() {
        return Some(None);
    }
    let count = |f: &dyn Fn(&Row) -> bool| rows.iter().filter(|r| f(r)).count();
    let results: Vec<Value> = rows
        .iter()
        .map(|(case_id, task, state, better, reason, old, new)| {
            let mut v = Map::new();
            v.insert("caseId".into(), json!(case_id));
            v.insert("task".into(), json!(cut_to(task, TEST_TASK_CHARS)));
            v.insert("state".into(), json!(state));
            if let Some(b) = better.as_ref().filter(|s| !s.is_empty()) {
                v.insert("better".into(), json!(b));
            }
            if let Some(r) = reason.as_ref().filter(|s| !s.is_empty()) {
                v.insert("reason".into(), json!(r));
            }
            if let Some(a) = old.as_ref().filter(|s| !s.is_empty()) {
                v.insert("oldAnswer".into(), json!(cut_to(a, TEST_ANSWER_CHARS)));
            }
            if let Some(a) = new.as_ref().filter(|s| !s.is_empty()) {
                v.insert("newAnswer".into(), json!(cut_to(a, TEST_ANSWER_CHARS)));
            }
            Value::Object(v)
        })
        .collect();
    let better = |b: &str| count(&|r| r.3.as_deref() == Some(b));
    let state = |s: &str| count(&|r| r.2 == s);
    Some(Some(json!({ "better": better("new"), "same": better("same"), "worse": better("old"), "notRun": state("skipped"), "failed": state("failed"), "running": state("running"), "results": results })))
}

/// A worker's proposals: every pending one and the newest others, newest first.
pub fn proposals_of(conn: &Connection, helper: &str) -> Option<Vec<Value>> {
    let mut stmt = conn
        .prepare("SELECT id, field, text, reason, job_id, state, created_at FROM proposals WHERE helper = ?1 AND (state = 'pending' OR id IN (SELECT id FROM proposals WHERE helper = ?1 ORDER BY id DESC LIMIT ?2)) ORDER BY id DESC")
        .ok()?;
    let rows: Vec<(i64, String, String, String, i64, String, String)> =
        stmt.query_map(rusqlite::params![helper, PROPOSALS_LISTED], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).ok()?.collect::<Result<_, _>>().ok()?;
    let mut out = Vec::new();
    for (id, field, text, reason, job_id, state, created_at) in rows {
        let mut v = json!({ "id": id, "field": field, "text": text, "reason": reason, "jobId": job_id, "state": state, "createdAt": iso(&created_at)? });
        if let Some(tests) = tests_of(conn, "soul", id)? {
            v["tests"] = tests;
        }
        out.push(v);
    }
    Some(out)
}

/// The saved test cases, newest first (`testCases`).
pub fn test_cases(conn: &Connection) -> Option<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id, target_kind, target, job_id, task, created_at FROM test_cases ORDER BY id DESC").ok()?;
    let rows: Vec<(i64, String, String, i64, String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).ok()?.collect::<Result<_, _>>().ok()?;
    rows.into_iter().map(|(id, kind, target, job, task, at)| Some(json!({ "id": id, "kind": kind, "target": target, "jobId": job, "task": cut_to(&task, TEST_TASK_CHARS), "createdAt": iso(&at)? }))).collect()
}

/// `new Date(text).toISOString()`.
fn iso(text: &str) -> Option<String> {
    let t: Timestamp = text.parse().ok()?;
    Some(t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}
