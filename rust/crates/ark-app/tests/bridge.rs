//! The bridge against the fake runtime: events come in, commands go out, the model follows.
#![allow(clippy::expect_used)] // Test code: a failed step should stop the test with its message.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use ark_app::bridge::{Bridge, Inbound};
use ark_ui::{Conn, Model, Role};

fn fixture(name: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures").join(name).to_str().expect("utf-8").to_owned()
}

/// Feeds the model until `done` is true. Fails after 10 s.
fn pump(bridge: &Bridge, model: &mut Model, done: impl Fn(&Model) -> bool) {
    let end = Instant::now() + Duration::from_secs(10);
    while !done(model) {
        assert!(Instant::now() < end, "timed out; model: {model:?}");
        for message in bridge.drain() {
            match message {
                Inbound::Event(e) => {
                    model.apply(&e);
                }
                Inbound::Down(why) => model.runtime_down(why),
            }
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn text_send_and_approval_round_trip() {
    let bridge = Bridge::spawn(env!("CARGO_BIN_EXE_ark-fake-runtime"), &[fixture("demo.jsonl")], Arc::new(|| {})).expect("spawn");
    let mut model = Model::default();
    pump(&bridge, &mut model, |m| m.conn == Conn::Ready && m.current.is_some());

    bridge.send_text("hello");
    pump(&bridge, &mut model, |m| m.approvals.len() == 1);
    assert_eq!(model.messages.last().map(|m| (m.role, m.text.as_str())), Some((Role::User, "hello")));

    bridge.answer("a1", true);
    pump(&bridge, &mut model, |m| m.approvals.is_empty() && m.messages.len() == 2);
    assert_eq!(model.messages[1].role, Role::Assistant);

    drop(bridge);
}

#[test]
fn a_dead_runtime_shows_down() {
    let bridge = Bridge::spawn("/usr/bin/false", &[], Arc::new(|| {})).expect("spawn");
    let mut model = Model::default();
    pump(&bridge, &mut model, |m| matches!(m.conn, Conn::Down(_)));
    assert_eq!(model.conn, Conn::Down("The runtime stopped (exit 1).".into()));
}
