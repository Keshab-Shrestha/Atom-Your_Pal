//! Runs the built ark-app headless with a scripted event file (no runtime, no screen), as CI does.
//! `--snap` checks that the chat draws; `--tree` and `--script` check what a screen reader and a click reach.
#![allow(clippy::expect_used)] // Test code: a failed step should stop the test with its message.

use std::collections::HashSet;
use std::io::Cursor;
use std::path::PathBuf;
use std::process::Command;

fn fixture(name: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name).to_str().expect("utf-8").to_owned()
}

fn fresh(name: &str) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("ark-app");
    std::fs::create_dir_all(&dir).expect("temp dir");
    let path = dir.join(name);
    if path.exists() {
        std::fs::remove_file(&path).expect("remove old output");
    }
    path
}

fn run(events: &str, args: &[&str]) {
    let out = Command::new(env!("CARGO_BIN_EXE_ark-app")).args(args).env("ARK_UI_EVENTS", fixture(events)).output().expect("ark-app starts");
    assert!(out.status.success(), "ark-app {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
}

/// The text of the element tree and the accessibility tree, as one string.
fn tree_after(tag: &str, events: &str, script: Option<&str>) -> String {
    let tree = fresh(&format!("{tag}-tree.json"));
    let path = tree.to_str().expect("utf-8");
    match script {
        None => run(events, &["--tree", path]),
        Some(steps) => {
            let file = fresh(&format!("{tag}-script.json"));
            std::fs::write(&file, steps).expect("script written");
            run(events, &["--script", file.to_str().expect("utf-8"), "--tree", path]);
        }
    }
    std::fs::read_to_string(&tree).expect("tree written")
}

#[test]
fn snap_draws_the_chat() {
    let png = fresh("chat.png");
    run("chat.jsonl", &["--snap", png.to_str().expect("utf-8"), "--size", "1040x700", "--scale", "1", "--theme", "dark"]);
    let mut reader = png::Decoder::new(Cursor::new(std::fs::read(&png).expect("png written"))).read_info().expect("valid PNG");
    let mut pixels = vec![0; reader.output_buffer_size().expect("buffer size")];
    let info = reader.next_frame(&mut pixels).expect("PNG frame");
    assert_eq!((info.width, info.height), (1040, 700));
    let bpp = info.line_size / info.width as usize;
    let colours: HashSet<&[u8]> = pixels[..info.buffer_size()].chunks_exact(bpp).collect();
    assert!(colours.len() > 20, "the chat looks blank: {} colours", colours.len());
}

#[test]
fn tree_holds_chats_messages_tool_and_approval() {
    let tree = tree_after("plain", "chat.jsonl", None);
    for want in ["Plan the Rust port", "Fix the notch bar", "List the crates.", "run_command", "ARK asks first", "Allow", "Decline", "Message ARK", "Copy"] {
        assert!(tree.contains(want), "tree lacks {want:?}");
    }
}

#[test]
fn clicking_allow_closes_the_approval() {
    let tree = tree_after("allow", "chat.jsonl", Some(r#"[{"t":0.2,"type":"click","key":"allow-a1"}]"#));
    assert!(!tree.contains("The command changes files in target/."), "the approval card is still there");
    assert!(tree.contains("List the crates."), "the transcript is gone");
}

#[test]
fn enter_sends_the_draft_and_clears_the_composer() {
    let typed = tree_after("typed", "chat.jsonl", Some(r#"[{"t":0.1,"type":"type","text":"zzqx"}]"#));
    assert!(typed.contains("zzqx"), "the draft is not in the composer");
    let sent = tree_after("sent", "chat.jsonl", Some(r#"[{"t":0.1,"type":"type","text":"zzqx"},{"t":0.4,"type":"key","name":"Enter"}]"#));
    assert!(!sent.contains("zzqx"), "the composer kept the draft after Enter");
}

#[test]
fn the_sidebar_opens_the_pages() {
    let page = |tag: &str, key: &str| tree_after(tag, "chat.jsonl", Some(&format!(r#"[{{"t":0.2,"type":"click","key":"{key}"}}]"#)));
    let tasks = page("nav-tasks", "nav-tasks");
    for want in ["Read the island protocol", "Fix the build", "cargo test failed", "Stop", "Retry"] {
        assert!(tasks.contains(want), "tasks page lacks {want:?}");
    }
    let agents = page("nav-agents", "nav-agents");
    for want in ["Sid", "researcher", "Coming soon", "Reading docs", "Team", "CEO", "Agent"] {
        assert!(agents.contains(want), "agents page lacks {want:?}");
    }
    let dashboard = page("nav-dashboard", "nav-dashboard");
    for want in ["Average answer", "2300 ms", "run_command", "12 calls"] {
        assert!(dashboard.contains(want), "dashboard lacks {want:?}");
    }
    let memory = page("nav-memory", "nav-memory");
    for want in ["Keshab likes terse answers", "Forget", "Planned the Rust port", "Rune notes", "Open"] {
        assert!(memory.contains(want), "memory page lacks {want:?}");
    }
    let settings = page("nav-settings", "nav-settings");
    for want in ["Opus", "Sonnet", "Gemini (no key)", "On, port 4317", "42%", "Morning brief", "Read aloud", "Saved permissions", "Full access", "Model default", "Appearance", "Dark", "Shortcuts", "Control + Option + Z"] {
        assert!(settings.contains(want), "settings page lacks {want:?}");
    }
}

#[test]
fn agent_forms_open_from_the_agents_page() {
    let steps = |key: &str| format!(r#"[{{"t":0.1,"type":"click","key":"nav-agents"}},{{"t":0.3,"type":"click","key":"{key}"}}]"#);
    let soul = tree_after("form-soul", "chat.jsonl", Some(&steps("soul-sid")));
    for want in ["Soul of Sid", "Calm and exact", "Cite sources", "Cancel", "Save"] {
        assert!(soul.contains(want), "soul form lacks {want:?}");
    }
    let agent = tree_after("form-agent", "chat.jsonl", Some(&steps("new-agent")));
    for want in ["New agent", "Role", "Research", "Think"] {
        assert!(agent.contains(want), "new agent form lacks {want:?}");
    }
    let task = tree_after("form-task", "chat.jsonl", Some(&steps("newtask-sid")));
    assert!(task.contains("New task"), "task form lacks its title");
}

#[test]
fn a_picked_file_shows_as_a_chip() {
    let steps = r#"[{"t":0.1,"type":"click","key":"attach"},{"t":0.4,"type":"file-dialog","path":"/tmp/notes.txt"}]"#;
    let tree = tree_after("attach", "chat.jsonl", Some(steps));
    assert!(tree.contains("notes.txt"), "the chip for the picked file is missing");
}

#[test]
fn find_in_chat_counts_matches() {
    let tree = fresh("find-tree.json");
    let out = Command::new(env!("CARGO_BIN_EXE_ark-app"))
        .args(["--tree", tree.to_str().expect("utf-8")])
        .env("ARK_UI_EVENTS", fixture("chat.jsonl"))
        .env("ARK_UI_FIND", "crates")
        .output()
        .expect("ark-app starts");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let text = std::fs::read_to_string(&tree).expect("tree written");
    assert!(text.contains(" of ") && text.contains("Previous") && text.contains("List the crates."), "the find bar lacks its parts");
}

#[test]
fn the_palette_lists_screens_and_chats() {
    let tree = fresh("palette-tree.json");
    let out = Command::new(env!("CARGO_BIN_EXE_ark-app"))
        .args(["--tree", tree.to_str().expect("utf-8")])
        .env("ARK_UI_EVENTS", fixture("chat.jsonl"))
        .env("ARK_UI_PALETTE", "1")
        .output()
        .expect("ark-app starts");
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let text = std::fs::read_to_string(&tree).expect("tree written");
    for want in ["Go to Settings", "New chat", "Open chat: Plan the Rust port"] {
        assert!(text.contains(want), "the palette lacks {want:?}");
    }
}

#[test]
fn full_access_needs_a_second_press() {
    let click = |key: &str| format!(r#"{{"t":0.3,"type":"click","key":"{key}"}}"#);
    let steps = format!(r#"[{{"t":0.1,"type":"click","key":"nav-settings"}},{}]"#, click("access-full"));
    let tree = tree_after("full", "chat.jsonl", Some(&steps));
    assert!(tree.contains("Confirm Full access"), "the first press should ask to confirm");
}

#[test]
fn a_task_opens_its_report_and_file_changes() {
    let steps = r#"[{"t":0.1,"type":"click","key":"nav-tasks"},{"t":0.3,"type":"click","key":"details-3"}]"#;
    let tree = tree_after("job", "chat.jsonl", Some(steps));
    for want in ["Build fix", "File changes (2)", "src/lib.rs", "Undo", "Back to tasks"] {
        assert!(tree.contains(want), "task details lack {want:?}");
    }
}

#[test]
fn a_file_review_shows_the_diff() {
    let tree = tree_after("diff", "chat.jsonl", None);
    for want in ["docs/notes.txt", "+1 -1", "- two", "+ TWO"] {
        assert!(tree.contains(want), "the review lacks {want:?}");
    }
}
