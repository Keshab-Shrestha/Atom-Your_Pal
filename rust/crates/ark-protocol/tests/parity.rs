//! Parity with the TypeScript protocol code: `tests/fixtures/protocol.json` comes from `node rust/scripts/gen-fixtures.ts`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_protocol::names::COMMAND_NAMES;
use ark_protocol::{Command, Event, Parsed, parse_command};
use serde_json::Value;

fn fixture() -> Value {
    let path = format!("{}/tests/fixtures/protocol.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

#[test]
fn command_names_match_the_typescript_set() {
    let fixture = fixture();
    let ts: Vec<&str> = fixture["commandNames"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    assert_eq!(COMMAND_NAMES, ts.as_slice(), "update crates/ark-protocol/src/names.rs");
}

#[test]
fn command_lines_parse_as_typescript_parses_them() {
    const SHARED_ERRORS: [&str; 4] = ["Command is not valid JSON.", "Command must be a JSON object.", "Command has no \"type\".", "Unknown command"];
    let mut typed = 0;
    for case in fixture()["cases"].as_array().unwrap() {
        let line = case["line"].as_str().unwrap();
        let out = &case["out"];
        let got = parse_command(line);
        if out.get("blank").is_some() {
            assert_eq!(got, Parsed::Blank, "{line}");
        } else if let Some(error) = out.get("error").and_then(Value::as_str) {
            // Rust checks the shape only; TypeScript also checks values (ids, branch names). Rust may accept more.
            if SHARED_ERRORS.iter().any(|shared| error.starts_with(shared)) {
                assert_eq!(got, Parsed::Error(error.to_string()), "{line}");
            }
        } else {
            let Parsed::Command(command) = got else { panic!("{line}: TypeScript accepts, Rust gives {got:?}") };
            if !matches!(*command, Command::Other { .. }) {
                typed += 1;
                let back: Value = serde_json::from_str(&command.to_line()).unwrap();
                assert_eq!(&back, &out["command"], "{line}");
            }
        }
    }
    assert!(typed >= 40, "only {typed} typed commands were compared");
}

#[test]
fn events_round_trip() {
    for case in fixture()["eventCases"].as_array().unwrap() {
        let line = case["line"].as_str().unwrap();
        let event = Event::parse(line).unwrap();
        assert_eq!(matches!(event, Event::Other(_)), !case["typed"].as_bool().unwrap(), "{line}");
        let (a, b): (Value, Value) = (serde_json::from_str(line).unwrap(), serde_json::from_str(&event.to_line()).unwrap());
        assert_eq!(a, b, "{line}");
        assert!(event.to_line().ends_with('\n') && !event.to_line()[..event.to_line().len() - 1].contains('\n'));
    }
}

#[test]
fn every_command_name_has_a_known_shape_or_other() {
    // A bare `{"type": name}` is never a panic: it parses, or it is an error with words.
    for name in COMMAND_NAMES {
        match parse_command(&format!("{{\"type\":\"{name}\"}}")) {
            Parsed::Command(command) => assert_eq!(command.kind(), *name),
            Parsed::Error(message) => assert!(message.contains(name), "{name}: {message}"),
            Parsed::Blank => panic!("{name}: blank"),
        }
    }
}
