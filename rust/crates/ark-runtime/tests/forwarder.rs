//! Runs the `ark-runtime` binary with small fake children (`cat`, `sh`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::process::ExitStatusExt;
use std::process::{Child, Command, Output, Stdio};
use std::thread;
use std::time::Duration;

fn forwarder(args: &[&str]) -> Child {
    Command::new(env!("CARGO_BIN_EXE_ark-runtime"))
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start ark-runtime")
}

/// Writes `input` on a thread (so a full pipe cannot block the test), then closes stdin and collects the output.
fn run(args: &[&str], input: Vec<u8>) -> Output {
    let mut child = forwarder(args);
    let mut stdin = child.stdin.take().unwrap();
    let writer = thread::spawn(move || stdin.write_all(&input).unwrap());
    let output = child.wait_with_output().unwrap();
    writer.join().unwrap();
    output
}

#[test]
fn forwards_lines_both_ways_unchanged() {
    let input = b"{\"type\":\"chats.list\"}\n{\"type\":\"quit\",\"text\":\"\xc3\xa9\"}\n".to_vec();
    let output = run(&["cat"], input.clone());
    assert_eq!(output.stdout, input);
    assert_eq!(output.status.code(), Some(0));
}

#[test]
fn answers_each_line_before_the_next_is_sent() {
    let mut child = forwarder(&["cat"]);
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    for n in 0..3 {
        let line = format!("{{\"n\":{n}}}\n");
        stdin.write_all(line.as_bytes()).unwrap();
        let mut back = String::new();
        stdout.read_line(&mut back).unwrap();
        assert_eq!(back, line, "line {n} came back at once, before stdin closed");
    }
    drop(stdin);
    assert_eq!(child.wait().unwrap().code(), Some(0));
}

#[test]
fn forwards_a_one_megabyte_line() {
    let mut input = vec![b'x'; 1 << 20];
    input.push(b'\n');
    input.extend_from_slice(b"{\"after\":true}\n");
    let output = run(&["cat"], input.clone());
    assert_eq!(output.stdout.len(), input.len());
    assert_eq!(output.stdout, input);
}

#[test]
fn propagates_the_child_exit_code() {
    let output = run(&["sh", "-c", "exit 7"], Vec::new());
    assert_eq!(output.status.code(), Some(7));
}

#[test]
fn closing_stdin_ends_the_child_and_the_forwarder() {
    // `cat` exits at end of input; the last line has no newline and still arrives.
    let output = run(&["cat"], b"one\ntwo".to_vec());
    assert_eq!(output.stdout, b"one\ntwo");
    assert_eq!(output.status.code(), Some(0));
}

#[test]
fn passes_stderr_through() {
    let output = run(&["sh", "-c", "echo to-stderr >&2; echo to-stdout"], Vec::new());
    assert_eq!(output.stderr, b"to-stderr\n");
    assert_eq!(output.stdout, b"to-stdout\n");
}

#[test]
fn forwards_sigterm_and_dies_by_the_same_signal() {
    let mut child = forwarder(&["sh", "-c", "echo started; exec sleep 30"]);
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    assert_eq!(line, "started\n");
    thread::sleep(Duration::from_millis(100)); // the forwarder installs its handlers after the start
    let pid = child.id().to_string();
    assert!(Command::new("kill").args(["-TERM", &pid]).status().unwrap().success());
    let status = child.wait().unwrap();
    assert_eq!(status.signal(), Some(libc::SIGTERM));
    let mut rest = Vec::new();
    stdout.read_to_end(&mut rest).unwrap();
    assert!(rest.is_empty());
}

#[test]
fn reports_a_program_that_cannot_start() {
    let output = run(&["/nonexistent/ark-node"], Vec::new());
    assert_eq!(output.status.code(), Some(127));
    assert!(String::from_utf8_lossy(&output.stderr).contains("cannot start /nonexistent/ark-node"));
}

/// A scratch folder with the fixture data file at `data/memory.db`.
fn folder_with_data(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("ark-runtime-it-{name}-{}", std::process::id()));
    std::fs::remove_dir_all(&dir).ok();
    std::fs::create_dir_all(dir.join("data")).unwrap();
    std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/brain.db"), dir.join("data/memory.db")).unwrap();
    dir
}

#[test]
fn answers_brain_reads_itself_and_forwards_the_rest() {
    let dir = folder_with_data("native");
    let mut child = Command::new(env!("CARGO_BIN_EXE_ark-runtime"))
        .args(["cat"])
        .current_dir(&dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ask = |line: &str| {
        stdin.write_all(format!("{line}\n").as_bytes()).unwrap();
        let mut back = String::new();
        stdout.read_line(&mut back).unwrap();
        back
    };
    let note = ask(r#"{"type":"brain.note","id":1}"#);
    assert!(note.starts_with('{') && note.contains(r#""type":"brain.note""#) && note.contains("Oslo trip"), "{note}");
    let hits = ask(r#"{"type":"brain.search","query":"oslo"}"#);
    assert!(hits.contains(r#""type":"brain.hits""#) && hits.contains("Oslo trip"), "{hits}");
    // A command Rust does not answer reaches the child (`cat` echoes it back unchanged).
    let echoed = r#"{"type":"memory.list"}"#;
    assert_eq!(ask(echoed).trim_end(), echoed);
    // A note that is gone is Node's to answer ("That note is gone."): it is forwarded.
    let gone = r#"{"type":"brain.note","id":999}"#;
    assert_eq!(ask(gone).trim_end(), gone);
    drop(stdin);
    assert_eq!(child.wait().unwrap().code(), Some(0));
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn native_answers_can_be_turned_off() {
    let dir = folder_with_data("off");
    let mut child = Command::new(env!("CARGO_BIN_EXE_ark-runtime"))
        .args(["cat"])
        .current_dir(&dir)
        .env("ARK_RUNTIME_NATIVE", "0")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let line = r#"{"type":"brain.note","id":1}"#;
    child.stdin.take().unwrap().write_all(format!("{line}\n").as_bytes()).unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(String::from_utf8(out.stdout).unwrap().trim_end(), line);
    std::fs::remove_dir_all(&dir).ok();
}
