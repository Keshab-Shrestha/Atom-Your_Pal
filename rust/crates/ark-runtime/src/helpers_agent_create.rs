//! `agent.create` (ADR-278 Phase 4): a port of `createAgent` in `services/helpers/src/store.ts` and `formatSoulMd`, `agentId` in
//! `agents.ts`. Writes `agents/<id>/soul.md`, soul version 1 and the audit row. `None` for a refusal or for what Rust does not port
//! (a name with letters that need Unicode folding, an agent that reports to a Manager): Node then gives the words of the refusal.

use std::path::Path;

use rusqlite::{Connection, params};
use serde_json::{Value, json};

use crate::helpers_roster::{self, Soul};
use crate::helpers_write::{audit_detail, iso_now};

const MAX_AGENTS: usize = 20;
/// The ids of Claude Code's own agents (`RESERVED_AGENT_IDS`).
const RESERVED_IDS: [&str; 7] = ["general-purpose", "claude", "explore", "plan", "statusline-setup", "fork", "output-style-setup"];
const KITS: [&str; 3] = ["research", "folders", "think"];

/// `escapeBody`: a line that starts with backslashes and `##` and a space gets one more backslash.
fn escape_body(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            let hashes = line.trim_start_matches('\\');
            match hashes.strip_prefix("##") {
                Some(after) if after.chars().next().is_some_and(|c| c.is_whitespace() || c == '\u{feff}') => format!("\\{line}"),
                _ => line.to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `formatSoulMd` for an Agent with no Manager.
pub fn format_soul_md(role: &str, kit: &str, soul: &Soul) -> String {
    let mut text = format!("---\nname: {}\nrole: {role}\nkit: {kit}\n---\n", soul.name);
    for (title, body) in [("Personality", &soul.personality), ("How it works", &soul.how_it_works), ("Rules", &soul.rules), ("Lessons", &soul.lessons)] {
        text.push_str(&format!("\n## {title}\n{}\n", escape_body(body)));
    }
    text
}

/// `agentId` for an ASCII name: lower case letters and digits, one dash between runs, at most 24 characters, unique among `taken`.
pub fn agent_id(name: &str, taken: &[String]) -> String {
    let mut base = String::new();
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            base.push(c);
        } else if !base.ends_with('-') {
            base.push('-');
        }
    }
    let base = base.trim_matches('-');
    let base: String = base.chars().take(24).collect();
    let base = if base.is_empty() { "agent".to_string() } else { base };
    let start = if base.starts_with(|c: char| c.is_ascii_lowercase()) { base } else { format!("a-{base}") };
    let mut id = start.clone();
    let mut n = 2;
    while taken.contains(&id) {
        id = format!("{start}-{n}");
        n += 1;
    }
    id
}

/// The create command, written. `Some(id)` when the agent exists now.
pub fn create(conn: &Connection, agents: &Path, command: &Value) -> Option<String> {
    if command["reportsTo"].as_str().is_some_and(|r| !r.is_empty()) || !command["name"].as_str()?.is_ascii() {
        return None;
    }
    let (members, _) = helpers_roster::roster(conn, agents)?;
    if members.iter().filter(|m| m.custom).count() >= MAX_AGENTS {
        return None;
    }
    let role = helpers_roster::clean_role(command["role"].as_str()?).ok()?;
    let kit = command["kit"].as_str().filter(|k| KITS.contains(k))?;
    let text = |key: &str| command[key].as_str().map(str::to_string);
    let input = Soul { name: text("name")?, personality: text("personality")?, how_it_works: text("howItWorks")?, rules: text("rules")?, lessons: String::new() };
    let names: Vec<String> = members.iter().map(|m| helpers_roster::current(conn, &m.id).map(|(s, _)| s.name)).collect::<Option<_>>()?;
    let soul = helpers_roster::clean_soul(&input, &names).ok()?;
    let mut taken: Vec<String> = members.iter().map(|m| m.id.clone()).collect();
    taken.extend(std::fs::read_dir(agents).into_iter().flatten().filter_map(|e| e.ok()?.file_name().into_string().ok()));
    if RESERVED_IDS.contains(&agent_id(&soul.name, &[]).as_str()) {
        return None;
    }
    let id = agent_id(&soul.name, &taken);
    if id.len() > 32 {
        return None;
    }
    std::fs::create_dir_all(agents.join(&id)).ok()?;
    let written = std::fs::write(agents.join(&id).join("soul.md"), format_soul_md(&role, kit, &soul)).is_ok()
        && conn
            .execute(
                "INSERT INTO souls (helper, version, name, personality, how_it_works, rules, lessons, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)",
                params![id, soul.name, soul.personality, soul.how_it_works, soul.rules, soul.lessons, iso_now()],
            )
            .is_ok();
    if !written || audit_detail(conn, "agent", &json!({ "helper": id, "added": true })).is_none() {
        std::fs::remove_dir_all(agents.join(&id)).ok();
        conn.execute("DELETE FROM souls WHERE helper = ?", [&id]).ok();
        return None;
    }
    Some(id)
}

/// `agent.create` as a helpers command.
pub fn apply(conn: &Connection, command: &Value, agents: &Path) -> Option<()> {
    (command["type"].as_str()? == "agent.create").then(|| create(conn, agents, command)).flatten().map(|_| ())
}
