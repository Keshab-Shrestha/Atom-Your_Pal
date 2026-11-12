//! The system prompt and the memory block of the native chat match the TypeScript output (`rust/scripts/gen-fixtures.ts`).
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_runtime::context::{CONTEXT_LABEL, MEMORY_GUIDANCE, SYSTEM_PROMPT, TYPED_NOTE, memory_facts, now_line, with_context};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

fn fixture() -> Value {
    let path = format!("{}/tests/fixtures/context.json", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// The fixture file is read through a copy: opening it in place would write a WAL file next to it.
fn memory_db(name: &str) -> Connection {
    let from = format!("{}/tests/fixtures/memory.db", env!("CARGO_MANIFEST_DIR"));
    let to = std::env::temp_dir().join(format!("ark-ctx-{name}-{}.db", std::process::id()));
    std::fs::copy(from, &to).unwrap();
    Connection::open_with_flags(to, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

#[test]
fn constants_match_typescript() {
    let f = fixture();
    assert_eq!(SYSTEM_PROMPT, f["systemPrompt"].as_str().unwrap());
    assert_eq!(MEMORY_GUIDANCE, f["memoryGuidance"].as_str().unwrap());
    assert_eq!(CONTEXT_LABEL, f["contextLabel"].as_str().unwrap());
    assert_eq!(TYPED_NOTE, f["typedNote"].as_str().unwrap());
}

#[test]
fn memory_facts_match_typescript() {
    let conn = memory_db("facts");
    for pick in fixture()["picks"].as_array().unwrap() {
        let request = pick["request"].as_str().unwrap();
        assert_eq!(memory_facts(&conn, request).as_deref(), pick["text"].as_str(), "request {request:?}");
    }
}

#[test]
fn the_user_message_gets_the_context_block() {
    let conn = memory_db("block");
    let now: jiff::Zoned = "2026-11-12T20:30:00+09:00[Asia/Tokyo]".parse().unwrap();
    assert_eq!(now_line(&now), "It is now Thursday 12 November 2026 at 20:30 (Asia/Tokyo, UTC+09:00).");
    let message = with_context(Some(&conn), "c1", "hello", true, true, &now);
    assert!(message.starts_with("hello\n\nContext from ARK, not said by the user:\nYou can keep facts"));
    assert!(message.contains(TYPED_NOTE) && message.contains("It is now Thursday"));
    let later = with_context(Some(&conn), "c1", "hello", false, false, &now);
    assert!(!later.contains("You can keep facts") && !later.contains(TYPED_NOTE));
    let bare = with_context(None, "c1", "hello", true, false, &now);
    assert_eq!(bare, "hello\n\nContext from ARK, not said by the user:\nIt is now Thursday 12 November 2026 at 20:30 (Asia/Tokyo, UTC+09:00).");
}
