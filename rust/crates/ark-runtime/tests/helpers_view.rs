//! The Helpers page data of the Rust runtime matches the TypeScript helper store (`rust/scripts/gen-helpers.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;

use ark_runtime::helpers_roster as roster;
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
const LATER: [&str; 3] = ["routines", "proposals", "jobs"];

#[test]
fn roster_core_matches_typescript() {
    let (dir, conn) = fixture("roster");
    let (members, problems) = roster::roster(&conn, &dir.join("agents")).unwrap();
    let want = expected();
    assert_eq!(Value::Array(problems), want["problems"]);
    let got: Vec<Value> = members.iter().map(|m| roster::member_core(&conn, m).unwrap()).collect();
    let mut wanted = want["helpers"].as_array().unwrap().clone();
    for helper in &mut wanted {
        for key in LATER {
            helper.as_object_mut().unwrap().remove(key);
        }
    }
    assert_eq!(got, wanted);
}

#[test]
fn a_changed_soul_file_goes_to_node() {
    let (dir, conn) = fixture("changed");
    std::fs::write(dir.join("agents/scout/soul.md"), "---\nname: Scout\nrole: researcher\nkit: research\n---\n\n## Personality\nSlow.\n").unwrap();
    assert!(roster::roster(&conn, &dir.join("agents")).is_none());
}
