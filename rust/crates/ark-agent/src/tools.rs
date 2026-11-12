//! The simple tools Rust runs itself (Phase 2 step 1): `current_time` (services/tool-engine/src/tools/time.ts) and
//! `read_file` (a file inside the granted folders, checked by `floor`). `Tools::call` is the one entry point; the
//! MCP server (step 3) and the agent loop call it.

use std::io::Read;
use std::path::{Path, PathBuf};

use jiff::{Timestamp, tz::TimeZone};
use serde_json::{Map, Value};

use crate::floor;

/// `read_file` gives at most this many bytes of a file.
pub const MAX_READ_BYTES: u64 = 100_000;

#[derive(Debug, Clone)]
pub struct Tools {
    pub home: PathBuf,
    /// The granted folders; a read inside one skips the hidden-folder and name rules (as in the TypeScript floor).
    pub roots: Vec<PathBuf>,
    pub cwd: PathBuf,
}

/// `(name, description)` of each tool, for a tool list.
pub const TOOL_LIST: &[(&str, &str)] = &[
    ("current_time", "Gets the current date and time on this Mac. Optional input: timezone (IANA name, e.g. Asia/Tokyo)."),
    ("read_file", "Reads a text file inside the folders this task may use. Input: path."),
];

/// The time as `Thursday, 12 November 2026 at 20:01:02 JST`, in `zone` (an IANA name) or this Mac's zone.
pub fn current_time(now: Timestamp, zone: Option<&str>) -> Result<String, String> {
    let tz = match zone {
        Some(name) => TimeZone::get(name).map_err(|_| format!("\"{name}\" is not a time zone name"))?,
        None => TimeZone::system(),
    };
    Ok(now.to_zoned(tz).strftime("%A, %-d %B %Y at %H:%M:%S %Z").to_string())
}

impl Tools {
    pub fn call(&self, name: &str, input: &Map<String, Value>) -> Result<String, String> {
        match name {
            "current_time" => current_time(Timestamp::now(), input.get("timezone").and_then(Value::as_str)),
            "read_file" => self.read_file(input.get("path").and_then(Value::as_str).ok_or("read_file needs a path")?),
            other => Err(format!("unknown tool {other}")),
        }
    }

    fn read_file(&self, raw: &str) -> Result<String, String> {
        if let Some(problem) = floor::floor_problem(&self.home, &self.roots, &self.cwd, raw, false) {
            return Err(problem);
        }
        let expanded = ark_core::policy::expand_home(raw, &self.home.to_string_lossy());
        let real = floor::realish(&self.cwd.join(&expanded));
        if let Some(problem) = floor::secret_problem(&self.home, &real) {
            return Err(problem);
        }
        read_capped(&real)
    }
}

fn read_capped(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err(format!("{} is not a file", path.display()));
    }
    let mut bytes = Vec::new();
    file.take(MAX_READ_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    let cut = bytes.len() as u64 > MAX_READ_BYTES;
    bytes.truncate(MAX_READ_BYTES as usize);
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if cut {
        text.push_str("\n[cut: the file is longer than 100000 bytes]");
    }
    Ok(text)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn time_in_a_zone() {
        let at = "2026-11-12T11:01:02Z".parse::<Timestamp>().unwrap();
        assert_eq!(current_time(at, Some("Asia/Tokyo")).unwrap(), "Thursday, 12 November 2026 at 20:01:02 JST");
        assert_eq!(current_time(at, Some("UTC")).unwrap(), "Thursday, 12 November 2026 at 11:01:02 UTC");
        assert_eq!(current_time(at, Some("Mars/Base")).unwrap_err(), "\"Mars/Base\" is not a time zone name");
        assert!(current_time(at, None).is_ok());
    }

    #[test]
    fn read_file_obeys_the_floor() {
        let dir = std::env::temp_dir().join(format!("ark-tools-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let home = floor::realish(&dir);
        std::fs::create_dir_all(home.join(".ssh")).unwrap();
        std::fs::create_dir_all(home.join("proj")).unwrap();
        std::fs::write(home.join("proj/a.txt"), "hello").unwrap();
        std::fs::write(home.join(".ssh/key"), "secret").unwrap();
        std::fs::write(home.join("big.txt"), "x".repeat(MAX_READ_BYTES as usize + 5)).unwrap();
        let tools = Tools { home: home.clone(), roots: vec![home.join("proj")], cwd: home.clone() };
        let read = |p: &str| tools.call("read_file", &input(json!({ "path": p })));
        assert_eq!(read("proj/a.txt").unwrap(), "hello");
        assert!(read(".ssh/key").is_err());
        assert!(read("/etc/hosts").is_err());
        assert!(read("proj").unwrap_err().contains("not a file"));
        assert!(read("big.txt").unwrap().ends_with("[cut: the file is longer than 100000 bytes]"));
        assert!(tools.call("read_file", &input(json!({}))).is_err());
        assert!(tools.call("nope", &input(json!({}))).is_err());
        // A granted folder that holds a secret folder still refuses the secret folder.
        let wide = Tools { roots: vec![home.clone()], ..tools };
        assert!(wide.call("read_file", &input(json!({ "path": ".ssh/key" }))).is_err());
        std::fs::remove_dir_all(dir).ok();
    }
}
