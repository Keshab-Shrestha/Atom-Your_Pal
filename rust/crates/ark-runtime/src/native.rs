//! Commands the forwarder answers itself (Phase 2, step 2): the brain reads, and the Memory page (`memory.list`,
//! `memory.forget`, `memory.clear`, `episode.forget`, `episode.clear`). `try_answer` gives the event line to send to
//! the app, or `None` when Node must handle the command (every other command, and every case where Rust cannot give
//! the answer Node would give). The only writes are the five memory commands above, in the memory file.
//! The change feed (`poll_changes`) is one channel for every watched view: `PRAGMA data_version` tells that another
//! connection (Node) committed, and each watched view is built again and pushed when it differs from the last push.
//! The way back, Node to Rust writes, is the same signal read by Node (`ARK_MEMORY_OWNER=rust`, see `runtime.ts`).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};

use ark_protocol::{Command, Event, Parsed, parse_command};

use crate::helpers_native::HelpersNative;
use crate::{brain, memory};

/// Where the Rust side reads from.
#[derive(Debug)]
pub struct Native {
    memory_db: PathBuf,
    /// `brain.get` was answered: from now on a change of the graph is pushed (as Node does after its own `brain.get`).
    brain_watched: AtomicBool,
    /// `memory.list` was answered: from now on a change of the Memory page is pushed (as Node does after its own `memory.list`).
    memory_watched: AtomicBool,
    feed: Mutex<Feed>,
    /// `helpers.list` answered by Rust (opt-in, `ARK_HELPERS_NATIVE=1`).
    helpers: Option<HelpersNative>,
}

/// The change feed: one connection whose `PRAGMA data_version` changes when another connection commits.
#[derive(Debug, Default)]
struct Feed {
    conn: Option<rusqlite::Connection>,
    version: Option<i64>,
    last_brain: Option<String>,
    last_memory: Option<String>,
}

impl Native {
    pub fn new(memory_db: PathBuf) -> Native {
        Native { memory_db, brain_watched: AtomicBool::new(false), memory_watched: AtomicBool::new(false), feed: Mutex::new(Feed::default()), helpers: None }
    }

    /// The Helpers change bus, when Rust owns the Helpers page.
    pub fn helpers_bus(&self) -> Option<std::sync::Arc<crate::helpers_bus::Bus>> {
        self.helpers.as_ref().map(HelpersNative::bus)
    }

    /// Lets the Rust runner run the queued tasks with the chat engine's model (no-op when Rust does not own the Helpers page).
    pub fn attach_helpers_runner(&self, chat: &crate::chat::Chat) {
        if let Some(helpers) = &self.helpers {
            helpers.attach_chat_runner(chat);
        }
    }

    /// Lets Rust answer `helpers.list`.
    pub fn with_helpers(mut self, helpers: Option<HelpersNative>) -> Native {
        self.helpers = helpers;
        self
    }

    /// A line Node sent to the app.
    pub fn observe_node_line(&self, line: &str) {
        if let Some(helpers) = &self.helpers {
            helpers.observe(line);
        }
    }

    /// The memory file path.
    pub fn memory_db(&self) -> &Path {
        &self.memory_db
    }

    /// The lines to push after a change of the data file by another connection (Node). Call it every few hundred
    /// milliseconds. It sends nothing until `brain.get` or `memory.list` was answered, and nothing for a view that did not change.
    pub fn poll_changes(&self) -> Vec<String> {
        let mut lines = Vec::new();
        if let Some(helpers) = &self.helpers {
            helpers.pump();
            lines.extend(helpers.quiet_event());
        }
        lines.extend(self.poll_data_changes());
        lines
    }

    fn poll_data_changes(&self) -> Vec<String> {
        let (brain, memory) = (self.brain_watched.load(Ordering::SeqCst), self.memory_watched.load(Ordering::SeqCst));
        if !brain && !memory {
            return Vec::new();
        }
        let Ok(mut feed) = self.feed.lock() else { return Vec::new() };
        if feed.conn.is_none() {
            feed.conn = brain::open_read_only(&self.memory_db).or_else(|| memory::open_plain(&self.memory_db));
        }
        let Some(conn) = feed.conn.as_ref() else { return Vec::new() };
        let Ok(version) = conn.query_row("PRAGMA data_version", [], |r| r.get::<_, i64>(0)) else {
            feed.conn = None;
            return Vec::new();
        };
        if feed.version == Some(version) {
            return Vec::new();
        }
        let brain_line = brain.then(|| brain::graph(conn).map(|graph| Event::Other(graph.as_object().cloned().unwrap_or_default()).to_line())).flatten();
        let memory_line = memory.then(|| memory::open_read_only(&self.memory_db).and_then(|c| memory::view(&c)).map(|v| line_of(&v))).flatten();
        feed.version = Some(version);
        let mut lines = Vec::new();
        if let Some(line) = brain_line.filter(|l| feed.last_brain.as_deref() != Some(l)) {
            feed.last_brain = Some(line.clone());
            lines.push(line);
        }
        if let Some(line) = memory_line.filter(|l| feed.last_memory.as_deref() != Some(l)) {
            feed.last_memory = Some(line.clone());
            lines.push(line);
        }
        lines
    }

    /// The `memory` line now. The feed starts from it: it pushes only what differs from it.
    fn memory_line(&self) -> Option<String> {
        // The version is read before the view, so a commit in between is seen by the next poll.
        let probe = brain::open_read_only(&self.memory_db).or_else(|| memory::open_plain(&self.memory_db));
        let version = probe.as_ref().and_then(|c| c.query_row("PRAGMA data_version", [], |r| r.get(0)).ok());
        let line = line_of(&memory::view(&memory::open_read_only(&self.memory_db)?)?);
        if let Ok(mut feed) = self.feed.lock() {
            if feed.conn.is_none() {
                feed.conn = probe;
            }
            feed.version = version.or(feed.version);
            feed.last_memory = Some(line.clone());
        }
        self.memory_watched.store(true, Ordering::SeqCst);
        Some(line)
    }

    /// The memory file of the runtime started in `folder`: `ARK_MEMORY_FILE` (then `ATOM_`, then `ZENO_`) from the
    /// environment or from `.env`, else `data/memory.db`. A relative path counts from `folder`.
    pub fn from_environment(folder: &Path, env: impl Fn(&str) -> Option<String>) -> Native {
        let dotenv = std::fs::read_to_string(folder.join(".env")).unwrap_or_default();
        let lookup = |name: &str| env(name).filter(|v| !v.is_empty()).or_else(|| dotenv_value(&dotenv, name));
        let file = ["ARK_MEMORY_FILE", "ATOM_MEMORY_FILE", "ZENO_MEMORY_FILE"].iter().find_map(|name| lookup(name)).unwrap_or_else(|| "data/memory.db".into());
        Native::new(folder.join(file)).with_helpers(HelpersNative::from_environment(folder, |name| lookup(name)))
    }

    /// The line to send to the app for `line`, or `None` to forward `line` to Node.
    pub fn try_answer(&self, line: &str) -> Option<String> {
        if let Some(reply) = self.helpers.as_ref().and_then(|h| h.answer(line)) {
            return Some(reply);
        }
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
            Command::BrainGet => {
                let conn = brain::open_read_only(&self.memory_db)?;
                // The version is read before the graph, so a commit in between is seen by the next poll.
                let version = conn.query_row("PRAGMA data_version", [], |r| r.get(0)).ok();
                let line = Event::Other(brain::graph(&conn)?.as_object().cloned()?).to_line();
                // The feed starts from this answer: it pushes only what differs from it.
                if let Ok(mut feed) = self.feed.lock() {
                    feed.version = version;
                    feed.last_brain = Some(line.clone());
                    feed.conn = Some(conn);
                }
                self.brain_watched.store(true, Ordering::SeqCst);
                return Some(line);
            }
            Command::MemoryList => return self.memory_line(),
            Command::MemoryForget { id } => return memory::forget(&self.memory_db, id).ok().and_then(|()| self.memory_line()),
            Command::MemoryClear => return memory::clear(&self.memory_db).ok().and_then(|()| self.memory_line()),
            Command::EpisodeForget { id } => return memory::forget_episode(&self.memory_db, id).ok().and_then(|()| self.memory_line()),
            Command::EpisodeClear => return memory::clear_episodes(&self.memory_db).ok().and_then(|()| self.memory_line()),
            _ => return None,
        };
        Some(reply.to_line())
    }
}

fn line_of(view: &serde_json::Value) -> String {
    Event::Other(view.as_object().cloned().unwrap_or_default()).to_line()
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
    fn brain_get_matches_typescript_and_the_feed_pushes_changes() {
        let scratch = Scratch::new("graph");
        let native = scratch.native();
        assert!(native.poll_changes().is_empty(), "nothing is pushed before brain.get");
        let reply = native.try_answer("{\"type\":\"brain.get\"}\n").expect("brain.get is answered");
        assert_eq!(as_value(&reply), fixture()["graph"], "graph");
        assert!(native.poll_changes().is_empty(), "no change yet");
        // Node (a second connection) saves a note: the feed pushes the new graph once.
        let writer = crate::store::open_read_write(&scratch.0.join("data/memory.db")).unwrap();
        writer.execute("UPDATE brain_notes SET title = 'Oslo trip 2' WHERE id = 1", []).unwrap();
        let pushed = native.poll_changes();
        assert_eq!(pushed.len(), 1);
        assert!(pushed[0].contains("Oslo trip 2"));
        assert!(native.poll_changes().is_empty(), "the same graph is not pushed twice");
        // A change that leaves the graph as it is pushes nothing.
        writer.execute("CREATE TABLE IF NOT EXISTS other (x)", []).unwrap();
        assert!(native.poll_changes().is_empty());
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
    fn memory_commands_match_typescript_and_the_feed_pushes_changes() {
        let dir = std::env::temp_dir().join(format!("ark-runtime-memory-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("data")).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/memory-view.db"), dir.join("data/memory.db")).unwrap();
        let native = Native::from_environment(&dir, |_| None);
        let expected: Value = serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/memory-view.json")).unwrap()).unwrap();
        assert!(native.poll_changes().is_empty(), "nothing is pushed before memory.list");
        assert_eq!(as_value(&native.try_answer("{\"type\":\"memory.list\"}\n").unwrap()), expected["event"]);
        assert!(native.poll_changes().is_empty(), "no change yet");
        // Node saves a fact (a second connection): the feed pushes the new page once.
        let writer = crate::store::open_read_write(&dir.join("data/memory.db")).unwrap();
        writer.execute("INSERT INTO memories (text, owner, source, created_at) VALUES ('New fact.', 'local', 'text', '2026-11-02T00:00:00.000Z')", []).unwrap();
        let pushed = native.poll_changes();
        assert_eq!(pushed.len(), 1);
        assert_eq!(as_value(&pushed[0])["count"], 5);
        assert!(native.poll_changes().is_empty(), "the same page is not pushed twice");
        // The page answers its own writes at once, and the feed does not push that state again.
        let after = as_value(&native.try_answer("{\"type\":\"memory.forget\",\"id\":1}\n").unwrap());
        assert_eq!(after["count"], 4);
        assert!(native.poll_changes().is_empty());
        assert_eq!(as_value(&native.try_answer("{\"type\":\"memory.clear\"}\n").unwrap())["count"], 0);
        assert_eq!(as_value(&native.try_answer("{\"type\":\"episode.clear\"}\n").unwrap())["episodes"], json!([]));
        drop(writer);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn other_commands_and_a_missing_file_go_to_node() {
        let scratch = Scratch::new("other");
        let native = scratch.native();
        for line in ["{\"type\":\"brain.save\",\"title\":\"t\",\"body\":\"b\"}", "{\"type\":\"chats.list\"}", "{\"type\":\"quit\"}", "not json", "", "{\"type\":\"brain.note\",\"id\":0}", "{\"type\":\"brain.note\",\"id\":-1}", "{\"type\":\"brain.note\"}"] {
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
