//! The later screens, drawn headless from `fixtures/more.jsonl` with `--tree`: each shows what the runtime sent.
#![allow(clippy::expect_used)] // Test code: a failed step should stop the test with its message.

use std::path::PathBuf;
use std::process::Command;

/// The text of the element tree of `screen`, after the optional click steps.
fn tree(screen: &str, steps: Option<&str>) -> String {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("ark-app-more");
    std::fs::create_dir_all(&dir).expect("temp dir");
    let out = dir.join(format!("{screen}-{}.json", steps.map_or(0, str::len)));
    drop(std::fs::remove_file(&out));
    let events = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/more.jsonl");
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_ark-app"));
    cmd.env("ARK_UI_EVENTS", events).env("ARK_UI_SCREEN", screen);
    if let Some(steps) = steps {
        let file = dir.join(format!("{screen}-steps.json"));
        std::fs::write(&file, steps).expect("steps written");
        cmd.arg("--script").arg(file);
    }
    let run = cmd.arg("--tree").arg(&out).output().expect("ark-app starts");
    assert!(run.status.success(), "ark-app failed: {}", String::from_utf8_lossy(&run.stderr));
    std::fs::read_to_string(&out).expect("tree written")
}

fn has_all(tree: &str, words: &[&str]) {
    for want in words {
        assert!(tree.contains(want), "tree lacks {want:?}");
    }
}

#[test]
fn automations_list_workflows_and_routines_and_filter_them() {
    let all = tree("workflows", None);
    has_all(&all, &["Automations", "Morning news", "Every day at 8:00", "1. sid: Collect the news", "2. quill: Write a short summary", "After a failure", "When a Board task fails", "Read the news", "Run", "New automation"]);
    let timer = tree("workflows", Some(r#"[{"t":0.2,"type":"click","key":"flow-filter-1"}]"#));
    assert!(timer.contains("Morning news") && !timer.contains("After a failure"), "the timer filter keeps only the schedule");
    let by_hand = tree("workflows", Some(r#"[{"t":0.2,"type":"click","key":"flow-filter-3"}]"#));
    assert!(!by_hand.contains("Morning news"));
}

#[test]
fn delete_asks_twice() {
    let first = tree("workflows", Some(r#"[{"t":0.2,"type":"click","key":"flow-delete-w1"}]"#));
    assert!(first.contains("Confirm delete"), "the first press arms the delete");
}
