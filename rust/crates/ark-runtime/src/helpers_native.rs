//! `helpers.list` answered by Rust (ADR-278 Phase 4, slice 6), opt-in with `ARK_HELPERS_NATIVE=1`. Rust builds the event
//! from `helpers.db` (`helpers_event::build`) and takes the parts that only Node knows from the last `helpers` event Node
//! sent. Until Node has sent one, `helpers.list` goes to Node. Node keeps sending changes after that first answer, so the
//! stuck dot of a task still shows. Writes (`job.*`, `skill.*`) stay in Node: its runner and Telegram listen to them.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;

use crate::helpers_event;

/// Where the helpers file and the agent folders are.
#[derive(Debug)]
pub struct HelpersNative {
    db: PathBuf,
    agents: PathBuf,
    cached: Mutex<Option<Value>>,
}

impl HelpersNative {
    /// `db` is the helpers file; the agents folder is `agents` beside it (as in `runtime.ts`).
    pub fn new(db: PathBuf) -> HelpersNative {
        let agents = db.parent().map_or_else(|| PathBuf::from("agents"), |p| p.join("agents"));
        HelpersNative { db, agents, cached: Mutex::new(None) }
    }

    /// The helpers file of the runtime started in `folder`: `ARK_HELPERS_FILE` (default `data/helpers.db`), when
    /// `ARK_HELPERS_NATIVE=1`.
    pub fn from_environment(folder: &Path, env: impl Fn(&str) -> Option<String>) -> Option<HelpersNative> {
        if env("ARK_HELPERS_NATIVE").as_deref() != Some("1") {
            return None;
        }
        Some(HelpersNative::new(folder.join(env("ARK_HELPERS_FILE").unwrap_or_else(|| "data/helpers.db".into()))))
    }

    /// A line Node sent to the app: a `helpers` event is kept for the parts Node alone knows.
    pub fn observe(&self, line: &str) {
        if !line.starts_with("{\"type\":\"helpers\"") {
            return;
        }
        if let (Ok(value), Ok(mut cached)) = (serde_json::from_str::<Value>(line), self.cached.lock()) {
            *cached = Some(value);
        }
    }

    /// The line for the app when `line` is `helpers.list` and Rust can build the event; `None` sends it to Node.
    pub fn answer(&self, line: &str) -> Option<String> {
        if !line.contains("\"helpers.list\"") || serde_json::from_str::<Value>(line).ok()?["type"] != "helpers.list" {
            return None;
        }
        let cached = self.cached.lock().ok()?.clone()?;
        let conn = helpers_event::open_read_only(&self.db)?;
        let event = helpers_event::build(&conn, &self.agents, &jiff::Zoned::now(), &cached)?;
        Some(format!("{event}\n"))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ark-helpers-native-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/helpers.db"), dir.join("helpers.db")).unwrap();
        for entry in std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/agents")).unwrap() {
            let id = entry.unwrap().file_name();
            std::fs::create_dir_all(dir.join("agents").join(&id)).unwrap();
            std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/agents/").to_string() + &id.to_string_lossy() + "/soul.md", dir.join("agents").join(&id).join("soul.md")).unwrap();
        }
        dir
    }

    #[test]
    fn it_is_off_unless_asked_and_goes_to_node_until_node_sent_an_event() {
        assert!(HelpersNative::from_environment(Path::new("/x"), |_| None).is_none());
        let on = |name: &str| match name {
            "ARK_HELPERS_NATIVE" => Some("1".to_string()),
            "ARK_HELPERS_FILE" => Some("helpers.db".to_string()),
            _ => None,
        };
        let native = HelpersNative::from_environment(&scratch(), on).unwrap();
        assert!(native.answer("{\"type\":\"helpers.list\"}\n").is_none(), "no event from Node yet");
        native.observe("{\"type\":\"helpers\",\"apps\":[\"Safari\"],\"models\":[],\"skills\":[]}\n");
        let line = native.answer("{\"type\":\"helpers.list\"}\n").unwrap();
        let event: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(event["type"], "helpers");
        assert_eq!(event["apps"][0], "Safari");
        assert_eq!(event["helpers"].as_array().unwrap().len(), 10);
        assert!(native.answer("{\"type\":\"job.stop\",\"id\":1}\n").is_none());
    }
}
