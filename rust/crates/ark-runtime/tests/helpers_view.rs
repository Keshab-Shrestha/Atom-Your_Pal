//! The Helpers page data of the Rust runtime matches the TypeScript helper store (`rust/scripts/gen-helpers.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use ark_runtime::{helpers_plans as plans, helpers_extras as extras, helpers_jobs as jobs, helpers_roster as roster, helpers_tests as tests, helpers_routines as routines};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

/// The fixture folder, copied (opening the file in place would write a WAL file next to it).
fn fixture(name: &str) -> (PathBuf, Connection) {
    let from = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers"));
    let to = std::env::temp_dir().join(format!("ark-helpers-{name}-{}", std::process::id()));
    std::fs::create_dir_all(to.join("agents")).unwrap();
    std::fs::copy(from.join("helpers.db"), to.join("helpers.db")).unwrap();
    for entry in std::fs::read_dir(from.join("agents")).unwrap() {
        let id = entry.unwrap().file_name();
        std::fs::create_dir_all(to.join("agents").join(&id)).unwrap();
        std::fs::copy(from.join("agents").join(&id).join("soul.md"), to.join("agents").join(&id).join("soul.md")).unwrap();
    }
    let conn = Connection::open_with_flags(to.join("helpers.db"), OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    (to, conn)
}

fn expected() -> Value {
    serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/expected.json")).unwrap()).unwrap()
}

/// The keys the later slices add.
const LATER: [&str; 0] = [];

#[test]
fn roster_core_matches_typescript() {
    let (dir, conn) = fixture("roster");
    let (members, problems) = roster::roster(&conn, &dir.join("agents")).unwrap();
    let want = expected();
    assert_eq!(Value::Array(problems), want["problems"]);
    let now: jiff::Timestamp = want["now"].as_str().unwrap().parse().unwrap();
    let now = now.in_tz("Asia/Tokyo").unwrap();
    let got: Vec<Value> = members
        .iter()
        .map(|m| {
            let mut view = roster::member_core(&conn, m).unwrap();
            view["proposals"] = Value::Array(tests::proposals_of(&conn, &m.id).unwrap());
            view["jobs"] = Value::Array(jobs::jobs_of(&conn, &m.id).unwrap());
            view["routines"] = Value::Array(routines::routines_of(&conn, &m.id, &now).unwrap());
            view
        })
        .collect();
    let mut wanted = want["helpers"].as_array().unwrap().clone();
    for helper in &mut wanted {
        for key in LATER {
            helper.as_object_mut().unwrap().remove(key);
        }
    }
    assert_eq!(got, wanted);
    assert_eq!(Value::Array(tests::test_cases(&conn).unwrap()), want["testCases"]);
}

#[test]
fn a_changed_soul_file_goes_to_node() {
    let (dir, conn) = fixture("changed");
    std::fs::write(dir.join("agents/scout/soul.md"), "---\nname: Scout\nrole: researcher\nkit: research\n---\n\n## Personality\nSlow.\n").unwrap();
    assert!(roster::roster(&conn, &dir.join("agents")).is_none());
}

#[test]
fn mcp_switch_drafts_and_edits_match_typescript() {
    let (_dir, conn) = fixture("extras");
    let want = &expected()["extras"];
    assert_eq!(Value::Bool(extras::allow_large(&conn).unwrap()), want["allowLarge"]);
    assert_eq!(Value::Array(extras::mcp(&conn).unwrap()), want["mcp"]);
    assert_eq!(Value::Array(extras::skill_drafts(&conn).unwrap()), want["skillDrafts"]);
    assert_eq!(Value::Array(extras::skill_edits(&conn).unwrap()), want["skillEdits"]);
}

#[test]
fn plans_match_typescript() {
    let (dir, conn) = fixture("plans");
    let (members, _) = roster::roster(&conn, &dir.join("agents")).unwrap();
    let names: Vec<(String, String)> = members.iter().map(|m| (m.id.clone(), roster::current(&conn, &m.id).unwrap().0.name)).collect();
    let name_of = |agent: &str| names.iter().find(|n| n.0 == agent).map_or_else(|| agent.to_string(), |n| n.1.clone());
    let got = plans::plans(&conn, &name_of).unwrap();
    let want = &expected()["extras"]["plans"];
    assert_eq!(Value::Array(got), *want);
    assert_eq!(want.as_array().unwrap().len(), 3);
}
