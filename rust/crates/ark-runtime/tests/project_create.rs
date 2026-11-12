//! `project.create` with a fake Git: sources, limits, cancel, partial folders and the URL rules (fixtures in a temp folder only).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use ark_runtime::project_create::{Git, Limits, Request, World, create, repository_url};
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

struct W {
    root: std::path::PathBuf,
    memory: Connection,
    helpers: Connection,
}

fn world(name: &str) -> W {
    let raw = std::env::temp_dir().join(format!("ark-project-create-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&raw).ok();
    std::fs::create_dir_all(&raw).unwrap();
    let root = std::fs::canonicalize(&raw).unwrap();
    std::fs::create_dir_all(root.join("home/Developer")).unwrap();
    copy_dir(&Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/helpers-writes/base"), &root.join("h"));
    for ext in ["-wal", "-shm"] {
        std::fs::remove_file(root.join(format!("h/helpers.db{ext}"))).ok();
    }
    let memory = Connection::open_in_memory().unwrap();
    memory
        .execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, folders TEXT NOT NULL, helper TEXT, provider TEXT, model TEXT, kit TEXT NOT NULL DEFAULT 'folders', web INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE chats (id TEXT PRIMARY KEY, project_id TEXT);",
        )
        .unwrap();
    std::fs::write(root.join("ui-state.json"), json!({ "current": { "provider": "p", "model": "m" }, "reasoning": [], "projects": [] }).to_string()).unwrap();
    let helpers = Connection::open(root.join("h/helpers.db")).unwrap();
    W { root, memory, helpers }
}

fn request(source: &str, name: &str, path: &str, remote: Option<&str>) -> Request {
    let mut v = json!({ "type": "project.create", "request": "11111111-2222-3333-4444-555555555555", "source": source, "name": name, "path": path });
    if let Some(r) = remote {
        v["remote"] = json!(r);
    }
    Request::parse(&v).unwrap()
}

fn run(w: &W, req: &Request, cancel: &AtomicBool, limits: Limits, git: &Git<'_>) -> Value {
    let (agents, state, home) = (w.root.join("h/agents"), w.root.join("ui-state.json"), w.root.join("home"));
    create(req, &World { memory: &w.memory, helpers: &w.helpers, agents: &agents, home: &home, state: &state }, cancel, limits, git)
}

#[test]
fn a_new_source_makes_the_folder_and_registers_the_project() {
    let w = world("new");
    let path = w.root.join("home/Developer/fresh").to_string_lossy().to_string();
    let seen = std::cell::RefCell::new(Vec::new());
    let git = |args: &[String], cwd: &Path, tick: &mut ark_runtime::project_create::Tick<'_>| {
        seen.borrow_mut().push(args.to_vec());
        tick()?;
        std::fs::write(cwd.join("a.txt"), "x").unwrap();
        Ok(())
    };
    let event = run(&w, &request("new", "Fresh", &path, None), &AtomicBool::new(false), Limits::default(), &git);
    assert_eq!(event["ok"], true, "{event}");
    assert!(event["project"].as_str().unwrap().starts_with("p-"));
    assert_eq!(seen.borrow()[0], ["init", "--quiet", "--", "."]);
    let state: Value = serde_json::from_str(&std::fs::read_to_string(w.root.join("ui-state.json")).unwrap()).unwrap();
    assert_eq!(state["projects"][0]["name"], "Fresh");
    // The same destination is never overwritten, and no partial folder is claimed for it.
    let again = run(&w, &request("new", "Other", &path, None), &AtomicBool::new(false), Limits::default(), &git);
    assert_eq!(again["ok"], false);
    assert!(again["error"].as_str().unwrap().starts_with("The destination already exists"));
    assert!(again.get("partial").is_none());
}

#[test]
fn a_clone_over_the_budget_is_stopped_and_leaves_a_partial_folder() {
    let w = world("budget");
    let path = w.root.join("home/Developer/big").to_string_lossy().to_string();
    let git = |_: &[String], cwd: &Path, tick: &mut ark_runtime::project_create::Tick<'_>| {
        std::fs::write(cwd.join("big.bin"), vec![0u8; 5000]).unwrap();
        tick()
    };
    let limits = Limits { bytes: 1000, ..Limits::default() };
    let event = run(&w, &request("github", "Big", &path, Some("owner/repo")), &AtomicBool::new(false), limits, &git);
    assert_eq!(event["ok"], false);
    assert_eq!(event["partial"], true);
    assert!(event["error"].as_str().unwrap().starts_with("The repository exceeds the disk budget."), "{event}");
    assert!(Path::new(&path).is_dir(), "the partial folder stays");
}

#[test]
fn a_cancel_stops_the_clone() {
    let w = world("cancel");
    let path = w.root.join("home/Developer/c").to_string_lossy().to_string();
    let cancel = AtomicBool::new(false);
    let git = |_: &[String], _: &Path, tick: &mut ark_runtime::project_create::Tick<'_>| {
        cancel.store(true, Ordering::SeqCst);
        tick()
    };
    let event = run(&w, &request("git", "C", &path, Some("https://example.com/a/b.git")), &cancel, Limits::default(), &git);
    assert_eq!(event["error"], "Project creation cancelled. A partial folder remains at the selected destination; inspect it before retrying.");
}

#[test]
fn a_folder_source_registers_without_git() {
    let w = world("folder");
    let path = w.root.join("home/Developer");
    let event = run(&w, &request("folder", "Dev", &path.to_string_lossy(), None), &AtomicBool::new(false), Limits::default(), &|_, _, _| panic!("no git"));
    assert_eq!(event["ok"], true, "{event}");
}

#[test]
fn refusals_use_the_node_words() {
    let w = world("refuse");
    assert!(Request::parse(&json!({ "type": "project.create", "request": "11111111-2222-3333-4444-555555555555", "source": "new", "name": "X", "path": "/a/../b" })).is_none());
    let trailing = run(&w, &request("new", "X", &format!("{}/", w.root.join("home/z").display()), None), &AtomicBool::new(false), Limits::default(), &|_, _, _| Ok(()));
    assert_eq!(trailing["error"], "Choose an absolute destination without traversal or control characters.");
    let hidden = w.root.join("home/.x").to_string_lossy().to_string();
    let event = run(&w, &request("new", "X", &hidden, None), &AtomicBool::new(false), Limits::default(), &|_, _, _| Ok(()));
    assert_eq!(event["error"], "Choose a normal, non-hidden project folder name.");
    let event = run(&w, &request("git", "X", &w.root.join("home/y").to_string_lossy(), Some("http://github.com/a/b")), &AtomicBool::new(false), Limits::default(), &|_, _, _| Ok(()));
    assert!(event["error"].as_str().unwrap().starts_with("Use an HTTPS repository URL"));
}

#[test]
fn repository_urls_follow_the_typescript_rules() {
    assert_eq!(repository_url("github", "owner/repo").unwrap(), "https://github.com/owner/repo");
    assert_eq!(repository_url("github", "https://github.com/owner/repo/").unwrap(), "https://github.com/owner/repo");
    assert_eq!(repository_url("git", "https://example.com/a/b.git").unwrap(), "https://example.com/a/b.git");
    for (source, raw) in [("git", "http://example.com/a"), ("git", "https://u:p@example.com/a"), ("git", "https://example.com/a?x=1"), ("git", "https://example.com/"), ("github", "https://gitlab.com/a/b"), ("github", "https://github.com/a/b/c"), ("git", "ssh://git@x/a")] {
        assert!(repository_url(source, raw).is_err(), "{raw}");
    }
}

#[test]
fn the_real_git_init_runs_in_a_temp_folder() {
    let w = world("realgit");
    let path = w.root.join("home/Developer/real").to_string_lossy().to_string();
    let git = |args: &[String], cwd: &Path, tick: &mut ark_runtime::project_create::Tick<'_>| ark_runtime::project_create::run_git(args, cwd, tick);
    let event = run(&w, &request("new", "Real", &path, None), &AtomicBool::new(false), Limits::default(), &git);
    assert_eq!(event["ok"], true, "{event}");
    assert!(Path::new(&path).join(".git").is_dir());
}
