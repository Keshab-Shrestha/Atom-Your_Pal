//! Commands the forwarder answers itself (Phase 2, step 2): the read-only ones. `try_answer` gives the event
//! line to send to the app, or `None` when Node must handle the command (every other command, and every case
//! where Rust cannot give the answer Node would give). Rust never writes to the data folder.

use std::path::{Path, PathBuf};

use ark_protocol::{Command, Event, Parsed, parse_command};

use crate::brain;

/// Where the Rust side reads from.
#[derive(Debug, Clone)]
pub struct Native {
    memory_db: PathBuf,
}

impl Native {
    pub fn new(memory_db: PathBuf) -> Native {
        Native { memory_db }
    }

    /// The memory file of the runtime started in `folder`: `ARK_MEMORY_FILE` (then `ATOM_`, then `ZENO_`) from the
    /// environment or from `.env`, else `data/memory.db`. A relative path counts from `folder`.
    pub fn from_environment(folder: &Path, env: impl Fn(&str) -> Option<String>) -> Native {
        let dotenv = std::fs::read_to_string(folder.join(".env")).unwrap_or_default();
        let lookup = |name: &str| env(name).filter(|v| !v.is_empty()).or_else(|| dotenv_value(&dotenv, name));
        let file = ["ARK_MEMORY_FILE", "ATOM_MEMORY_FILE", "ZENO_MEMORY_FILE"].iter().find_map(|name| lookup(name)).unwrap_or_else(|| "data/memory.db".into());
        Native::new(folder.join(file))
    }

    /// The line to send to the app for `line`, or `None` to forward `line` to Node.
    pub fn try_answer(&self, line: &str) -> Option<String> {
        let Parsed::Command(command) = parse_command(line) else { return None };
        let reply = match *command {
            Command::BrainNote { id } => {
                let conn = brain::open_read_only(&self.memory_db)?;
                Event::BrainNote { note: brain::note(&conn, id)? }
            }
            Command::BrainSearch { query } => {
                let conn = brain::open_read_only(&self.memory_db)?;
                Event::BrainHits { hits: brain::search(&conn, &query)?, query }
            }
            _ => return None,
        };
        Some(reply.to_line())
    }
}

/// `NAME=value` from `.env` text: the last assignment, with one pair of quotes removed. Comments and blank lines are skipped.
fn dotenv_value(text: &str, name: &str) -> Option<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("export ").unwrap_or(line.trim()).split_once('='))
        .filter(|(key, _)| key.trim() == name)
        .map(|(_, value)| {
            let value = value.trim();
            let unquoted = [('"', '"'), ('\'', '\'')].iter().find_map(|(a, b)| value.strip_prefix(*a).and_then(|v| v.strip_suffix(*b)));
            unquoted.unwrap_or(value).to_string()
        })
        .next_back()
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    /// A scratch folder with a copy of the fixture data file at `data/memory.db`. It is removed on drop.
    struct Scratch(PathBuf);
    impl Scratch {
        fn new(name: &str) -> Scratch {
            let dir = std::env::temp_dir().join(format!("ark-runtime-{name}-{}", std::process::id()));
            std::fs::remove_dir_all(&dir).ok();
            std::fs::create_dir_all(dir.join("data")).unwrap();
            std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/brain.db"), dir.join("data/memory.db")).unwrap();
            Scratch(dir)
        }
        fn native(&self) -> Native {
            Native::from_environment(&self.0, |_| None)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            std::fs::remove_dir_all(&self.0).ok();
        }
    }

    fn fixture() -> Value {
        serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/brain.json")).unwrap()).unwrap()
    }

    fn as_value(line: &str) -> Value {
        serde_json::from_str(line).unwrap()
    }

    #[test]
    fn brain_note_matches_typescript_or_goes_to_node() {
        let scratch = Scratch::new("note");
        let native = scratch.native();
        let (mut answered, mut forwarded) = (0, 0);
        for case in fixture()["notes"].as_array().unwrap() {
            let line = format!("{{\"type\":\"brain.note\",\"id\":{}}}\n", case["id"]);
            match (native.try_answer(&line), &case["note"]) {
                (Some(reply), expected) if !expected.is_null() => {
                    assert_eq!(as_value(&reply), json!({ "type": "brain.note", "note": expected }), "note {}", case["id"]);
                    answered += 1;
                }
                (None, expected) if expected.is_null() => forwarded += 1,
                (got, expected) => panic!("note {}: Rust {got:?}, TypeScript {expected}", case["id"]),
            }
        }
        assert!(answered >= 8 && forwarded >= 1, "answered {answered}, forwarded {forwarded}");
    }

    #[test]
    fn brain_search_matches_typescript() {
        let scratch = Scratch::new("search");
        let native = scratch.native();
        for case in fixture()["searches"].as_array().unwrap() {
            let line = format!("{}\n", json!({ "type": "brain.search", "query": case["query"] }));
            let reply = native.try_answer(&line).unwrap_or_else(|| panic!("search {} was not answered", case["query"]));
            assert_eq!(as_value(&reply), json!({ "type": "brain.hits", "query": case["query"], "hits": case["hits"] }), "search {}", case["query"]);
        }
    }

    #[test]
    fn a_note_with_a_source_copy_goes_to_node() {
        let scratch = Scratch::new("source");
        let conn = rusqlite::Connection::open(scratch.0.join("data/memory.db")).unwrap();
        conn.execute_batch("CREATE TABLE brain_source_files (path TEXT, note_id INTEGER, excluded INTEGER); INSERT INTO brain_source_files VALUES ('a.md', 1, 0), ('b.md', 2, 1);").unwrap();
        drop(conn);
        let native = scratch.native();
        assert_eq!(native.try_answer("{\"type\":\"brain.note\",\"id\":1}\n"), None);
        assert!(native.try_answer("{\"type\":\"brain.note\",\"id\":2}\n").is_some(), "an excluded source row does not count");
    }

    #[test]
    fn other_commands_and_a_missing_file_go_to_node() {
        let scratch = Scratch::new("other");
        let native = scratch.native();
        for line in ["{\"type\":\"brain.save\",\"title\":\"t\",\"body\":\"b\"}", "{\"type\":\"memory.list\"}", "{\"type\":\"quit\"}", "not json", "", "{\"type\":\"brain.note\",\"id\":0}", "{\"type\":\"brain.note\",\"id\":-1}", "{\"type\":\"brain.note\"}"] {
            assert_eq!(native.try_answer(&format!("{line}\n")), None, "{line}");
        }
        let missing = Native::new(scratch.0.join("nope.db"));
        assert_eq!(missing.try_answer("{\"type\":\"brain.search\",\"query\":\"oslo\"}\n"), None);
        // A data file that is not a database goes to Node as well.
        std::fs::write(scratch.0.join("junk.db"), "not a database").unwrap();
        assert_eq!(Native::new(scratch.0.join("junk.db")).try_answer("{\"type\":\"brain.search\",\"query\":\"oslo\"}\n"), None);
    }

    #[test]
    fn the_read_does_not_change_the_data_file() {
        let scratch = Scratch::new("readonly");
        let before = std::fs::read(scratch.0.join("data/memory.db")).unwrap();
        let native = scratch.native();
        native.try_answer("{\"type\":\"brain.search\",\"query\":\"oslo\"}\n").unwrap();
        native.try_answer("{\"type\":\"brain.note\",\"id\":1}\n").unwrap();
        assert_eq!(std::fs::read(scratch.0.join("data/memory.db")).unwrap(), before);
        let names: Vec<_> = std::fs::read_dir(scratch.0.join("data")).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 1, "no -wal or -journal file: {names:?}");
    }

    #[test]
    fn dotenv_reads_the_last_value_and_strips_quotes() {
        let text = "# c\nARK_MEMORY_FILE=a.db\nexport ARK_MEMORY_FILE=\"b c.db\"\nOTHER=x\n";
        assert_eq!(dotenv_value(text, "ARK_MEMORY_FILE").as_deref(), Some("b c.db"));
        assert_eq!(dotenv_value(text, "MISSING"), None);
    }

    #[test]
    fn the_memory_file_follows_the_env_prefixes() {
        let folder = Path::new("/p");
        let none = |_: &str| None;
        assert_eq!(Native::from_environment(folder, none).memory_db, Path::new("/p/data/memory.db"));
        let legacy = |name: &str| (name == "ZENO_MEMORY_FILE").then(|| "old.db".to_string());
        assert_eq!(Native::from_environment(folder, legacy).memory_db, Path::new("/p/old.db"));
        let both = |name: &str| (name == "ARK_MEMORY_FILE" || name == "ZENO_MEMORY_FILE").then(|| name.to_string());
        assert_eq!(Native::from_environment(folder, both).memory_db, Path::new("/p/ARK_MEMORY_FILE"));
    }
}
