//! The Telegram Needs-you list of Rust is the one `needsYou` builds (`rust/scripts/gen-needs.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::{Path, PathBuf};

use ark_runtime::helpers_team::Team;
use ark_telegram::{Button, bot::Need};
use serde_json::{Value, json};

fn fixtures() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/needs"))
}

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

fn team(name: &str) -> (PathBuf, Team) {
    let dir = std::env::temp_dir().join(format!("ark-team-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    copy_dir(&fixtures().join("base"), &dir);
    let team = Team { db: dir.join("helpers.db"), agents: dir.join("agents"), ark_skills: Some(dir.join("skills")), user_skills: dir.join("home/.claude/skills") };
    (dir, team)
}

fn as_json(needs: &[Need]) -> Value {
    Value::Array(
        needs
            .iter()
            .map(|n| {
                let buttons: Vec<Vec<Value>> = n.buttons.iter().map(|row| row.iter().map(|b: &Button| json!({ "text": b.text, "data": b.data })).collect()).collect();
                json!({ "key": n.key, "push": n.push, "text": n.text, "buttons": buttons })
            })
            .collect(),
    )
}

#[test]
fn the_needs_are_the_ones_the_typescript_builds() {
    let want: Value = serde_json::from_str(&std::fs::read_to_string(fixtures().join("expected.json")).unwrap()).unwrap();
    let (dir, team) = team("needs");
    let questions: Vec<Need> = want["asks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| {
            let id = a["id"].as_str().unwrap();
            let buttons = if a["fileReview"] == true {
                vec![vec![Button { text: "Decline".into(), data: format!("a:{id}:0") }]]
            } else {
                vec![vec![Button { text: "Allow".into(), data: format!("a:{id}:1") }, Button { text: "Decline".into(), data: format!("a:{id}:0") }]]
            };
            Need { key: format!("ask-{id}"), push: true, text: format!("ARK asks: {}\n{}", a["summary"].as_str().unwrap(), a["reason"].as_str().unwrap()), buttons }
        })
        .collect();
    let got = as_json(&team.needs(questions));
    for (g, w) in got.as_array().unwrap().iter().zip(want["items"].as_array().unwrap()) {
        assert_eq!(g, w, "{}", w["key"]);
    }
    assert_eq!(got.as_array().unwrap().len(), want["items"].as_array().unwrap().len());
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn tasks_report_and_buttons_work_on_the_file() {
    let (dir, team) = team("commands");
    let tasks = team.tasks().unwrap();
    assert!(tasks.starts_with("Waiting:\n#") || tasks.starts_with("Running:"), "{tasks}");
    assert_eq!(team.report(9999).unwrap(), "Task #9999 has no report.");
    assert!(team.report(8).unwrap().len() > 10, "a done task has a report");
    // The draft in the fixture waits: Reject changes the file, and the item is gone from the list.
    assert_eq!(team.press("d:1:0").unwrap(), "Skill rejected.");
    assert!(team.needs(Vec::new()).iter().all(|n| n.key != "skill-draft-1"));
    assert!(team.press("p:7:1").is_none(), "approving a plan stays in Node");
    assert_eq!(team.press("r:5:1").unwrap(), "Review the interrupted attempt in ARK on your Mac before retrying.");
    rusqlite::Connection::open(&team.db).unwrap().execute("UPDATE jobs SET recovery_needed = NULL WHERE id = 3", []).unwrap();
    assert_eq!(team.press("r:3:1").unwrap(), "Retry requested.");
    std::fs::remove_dir_all(dir).unwrap();
}
