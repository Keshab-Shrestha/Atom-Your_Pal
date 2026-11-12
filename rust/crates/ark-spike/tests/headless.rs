//! Runs the text check headless with a Rune `--script` and checks that the spike logs keys,
//! text changes, undo and paste forms, and that its fields are in the accessibility tree.
//! The input-method, dictation and VoiceOver checks need a person: see CHECKLIST.md.
#![allow(clippy::expect_used)] // Test code: a failed step should stop the test with its message.

use std::path::PathBuf;
use std::process::Command;

const SCRIPT: &str = r#"[
 {"t":0.1,"type":"type","text":"ab"},
 {"t":0.3,"type":"key","name":"Backspace"},
 {"t":0.4,"type":"key","name":"z","cmd":true},
 {"t":0.5,"type":"paste","text":"Ship it","html":"<b>Ship</b> it"}
]"#;

fn temp(name: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("ark-spike");
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir.join(name)
}

#[test]
fn text_check_logs_keys_changes_undo_and_paste() {
    let (script, tree) = (temp("script.json"), temp("tree.json"));
    std::fs::write(&script, SCRIPT).expect("script written");
    if tree.exists() {
        std::fs::remove_file(&tree).expect("remove old tree");
    }

    let out = Command::new(env!("CARGO_BIN_EXE_ark-spike"))
        .args(["--check", "text", "--script", script.to_str().expect("utf-8"), "--tree", tree.to_str().expect("utf-8")])
        .output()
        .expect("ark-spike starts");
    assert!(out.status.success(), "ark-spike failed: {}", String::from_utf8_lossy(&out.stderr));
    let log = String::from_utf8_lossy(&out.stdout);
    for line in [
        "spike: single change: \"ab\"",
        "spike: single key: Backspace",
        "spike: single key: Command('z') cmd",
        "spike: single paste: text=\"Ship it\" html=true rtf=false",
        "spike: single change: \"abShip it\"",
    ] {
        assert!(log.contains(line), "log lacks {line:?}:\n{log}");
    }

    let json: serde_json::Value = serde_json::from_slice(&std::fs::read(&tree).expect("tree written")).expect("valid JSON");
    let a11y = json.get("accessibility").expect("accessibility tree").to_string();
    for want in ["\"text-input\"", "\"multiline-text-input\"", "Single-line field", "Multi-line field", "abShip it"] {
        assert!(a11y.contains(want), "accessibility tree lacks {want}: {a11y}");
    }
}
