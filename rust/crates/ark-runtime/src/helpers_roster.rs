//! The team of the Helpers page (ADR-278 Phase 4, slice 1): the built-in workers, the agent folders (`soul.md`), the kept
//! soul versions and the per-worker settings. A port of `roster`, `list` and `loadAgents` in `services/helpers/src/store.ts`
//! and `agents.ts`. Rust only reads: when a soul file is newer than the last kept version, Node must keep a new version
//! first, so `roster` gives `None` and the caller forwards the command to Node.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

/// The tables and columns the team reads.
pub const SCHEMA: &[(&str, &[&str])] = &[
    ("souls", &["helper", "version", "name", "personality", "how_it_works", "rules", "lessons", "created_at"]),
    ("helper_apps", &["helper", "app"]),
    ("helper_models", &["helper", "model"]),
    ("helper_codex_models", &["helper", "model"]),
    ("helper_settings", &["key", "value"]),
    ("grants", &["helper", "path"]),
    ("helper_skills", &["helper", "skill"]),
];

const SOUL_VERSIONS_LISTED: i64 = 10;
const MAX_AGENTS: usize = 20;
const RESERVED_NAMES: [&str; 4] = ["ark", "pal", "atom", "zeno"];

/// A soul: who a worker is.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Soul {
    pub name: String,
    pub personality: String,
    pub how_it_works: String,
    pub rules: String,
    pub lessons: String,
}

impl Soul {
    fn json(&self) -> Value {
        json!({ "name": self.name, "personality": self.personality, "howItWorks": self.how_it_works, "rules": self.rules, "lessons": self.lessons })
    }
}

/// One worker of the team.
#[derive(Clone, Debug)]
pub struct Member {
    pub id: String,
    pub available: bool,
    pub role: String,
    pub kit: String,
    pub custom: bool,
}

/// The built-in workers, in the window's order: id, available, role, personality, how it works, rules (`jobs.ts` HELPERS).
const BUILT_INS: [(&str, bool, &str, &str, &str, &str); 7] = [
    ("sid", true, "researcher", "Curious and thorough. Always cites sources.", "Searches more than once, reads several good pages, compares what they say, and prefers primary and reputable sources.", "Say plainly when sources disagree or when something could not be confirmed."),
    ("kame", true, "coder", "Steady and careful.", "Reads the code first, writes a test first, and makes small changes.", "Never changes more than the task needs."),
    ("puff", true, "designer", "Playful and visual. Explains every choice.", "Sketches options as HTML, CSS or SVG mock-ups and says why each one works.", "Keeps to the look the project already has unless asked to change it."),
    ("quill", true, "documenter", "Clear and plain.", "Writes in plain English with short sentences, one idea per sentence.", "Never claims something the sources or the code do not show."),
    ("penny", true, "financial adviser", "Cautious. Numbers first.", "Finds current figures from reputable sources, shows the numbers, and states every assumption.", "Says how old each figure is and where it comes from."),
    ("hana", true, "hr", "Warm, fair and discreet.", "Looks for current, reputable guidance and gives balanced, practical answers.", "Notes when the answer depends on the country or the employer's own rules."),
    ("tinker", false, "improver", "Reflective and specific.", "Reads failed and poorly rated jobs and proposes one concrete change to a worker's soul, with the reason.", "Proposes changes only; the user decides."),
];

/// Version 1 of every built-in soul, when it has none (the first run of a new `helpers.db`; `putSoul` of `store.ts`).
pub(crate) fn seed_souls(conn: &Connection) -> rusqlite::Result<()> {
    let at = jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string();
    for (id, _, _, personality, how, rules) in BUILT_INS {
        let name: String = id.chars().enumerate().map(|(i, c)| if i == 0 { c.to_ascii_uppercase() } else { c }).collect();
        conn.execute("INSERT INTO souls (helper, version, name, personality, how_it_works, rules, lessons, created_at) SELECT ?1, 1, ?2, ?3, ?4, ?5, '', ?6 WHERE NOT EXISTS (SELECT 1 FROM souls WHERE helper = ?1)", rusqlite::params![id, name, personality, how, rules, at])?;
    }
    Ok(())
}

/// What each built-in role may use (`BUILT_IN_KITS`).
fn built_in_kit(role: &str) -> &'static str {
    match role {
        "researcher" | "financial adviser" | "hr" => "research",
        "coder" | "designer" | "documenter" => "folders",
        _ => "think",
    }
}

/// A soul.md read back: the front matter and the four sections.
pub struct AgentFile {
    pub id: String,
    pub role: String,
    pub kit: String,
    pub soul: Soul,
}

/// One JavaScript `\s` character (close enough: Unicode white space).
fn is_space(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

fn unescape_body(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let last = lines.len() - 1;
    let fixed: Vec<String> = lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            let Some(rest) = line.strip_prefix('\\') else { return (*line).to_string() };
            let hashes = rest.trim_start_matches('\\');
            match hashes.strip_prefix("##") {
                Some(after) if after.chars().next().is_some_and(is_space) || (after.is_empty() && i != last) => rest.to_string(),
                _ => (*line).to_string(),
            }
        })
        .collect();
    fixed.join("\n")
}

/// The heading of a `## Title` line, as the regex `^##\s+(.+?)\s*$` reads it.
fn heading(line: &str) -> Option<String> {
    let rest = line.strip_prefix("##")?;
    let after_space = rest.trim_start_matches(is_space);
    let run = rest.chars().count() - after_space.chars().count();
    if run == 0 {
        return None;
    }
    let title = after_space.trim_end_matches(is_space);
    if !title.is_empty() {
        return Some(title.to_string());
    }
    // Only spaces follow: the lazy group takes the last one of a run of two or more.
    if run >= 2 { rest.chars().last().map(String::from) } else { None }
}

/// The front matter and the body of `text` (`^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$`).
fn split_front(text: &str) -> Option<(&str, &str)> {
    let after = text.strip_prefix("---")?;
    let run_end = after.len() - after.trim_start_matches(is_space).len();
    // The first `\n` of the pattern is the last character of a run of space that ends in one; the longest run is tried first.
    let starts: Vec<usize> = after[..run_end].char_indices().filter(|(_, c)| *c == '\n').map(|(i, _)| i + 1).collect();
    for start in starts.into_iter().rev() {
        if let Some(at) = after[start..].find("\n---") {
            let front = &after[start..start + at];
            let body = after[start + at + 4..].trim_start_matches(is_space);
            return Some((front, body));
        }
    }
    None
}

/// soul.md read back. `Err` is the message of the TypeScript `HelperError`. A Manager's file reads as `Ok(None)` (it is not read).
pub fn parse_soul_file(id: &str, raw: &str) -> Result<Option<AgentFile>, String> {
    let text = raw.replace("\r\n", "\n").replace('\r', "\n");
    let (front_text, body) = split_front(&text).ok_or("soul.md needs front matter (name, role, kit) between --- lines.")?;
    let mut front = std::collections::HashMap::new();
    for line in front_text.split('\n') {
        let line = line.trim();
        let key_len = line.bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
        if key_len == 0 {
            continue;
        }
        let Some(value) = line[key_len..].trim_start_matches(is_space).strip_prefix(':') else { continue };
        let value = value.trim();
        let value = value.strip_prefix(['"', '\'']).unwrap_or(value);
        let value = value.strip_suffix(['"', '\'']).unwrap_or(value);
        front.insert(line[..key_len].to_lowercase(), value.to_string());
    }
    let mut sections = std::collections::HashMap::new();
    let mut current: Option<String> = None;
    let mut lines: Vec<&str> = Vec::new();
    let mut flush = |current: &mut Option<String>, lines: &mut Vec<&str>| {
        if let Some(name) = current.take() {
            sections.insert(name, unescape_body(&lines.join("\n")).trim().to_string());
        }
        lines.clear();
    };
    for line in body.split('\n') {
        if let Some(title) = heading(line) {
            flush(&mut current, &mut lines);
            current = Some(title.to_lowercase());
        } else {
            lines.push(line);
        }
    }
    flush(&mut current, &mut lines);
    let section = |title: &str| sections.get(title).cloned().unwrap_or_default();
    let soul = Soul { name: front.get("name").cloned().unwrap_or_default(), personality: section("personality"), how_it_works: section("how it works"), rules: section("rules"), lessons: section("lessons") };
    if front.get("kind").map(String::as_str) == Some("manager") {
        if front.contains_key("kit") {
            return Err("A Manager has no kit: its Agents do the work.".into());
        }
        if front.contains_key("manager") {
            return Err("A Manager cannot be under another Manager.".into());
        }
        if front.contains_key("role") {
            return Err("A Manager has no role: it runs a team of Agents.".into());
        }
        return Ok(None);
    }
    if let Some(kind) = front.get("kind").filter(|k| *k != "agent") {
        return Err(format!("\"kind\" is agent or manager, not \"{}\".", kind.chars().take(20).collect::<String>()));
    }
    let kit = match front.get("kit").map(String::as_str) {
        Some(k @ ("research" | "folders" | "think")) => k.to_string(),
        _ => "think".into(),
    };
    Ok(Some(AgentFile { id: id.to_string(), role: front.get("role").cloned().unwrap_or_default(), kit, soul }))
}

fn is_agent_id(id: &str) -> bool {
    let mut chars = id.chars();
    id.len() <= 32 && chars.next().is_some_and(|c| c.is_ascii_lowercase()) && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Every agent folder with a readable soul.md, by folder name, and the folders that could not be read.
pub fn load_agents(dir: &Path) -> (Vec<AgentFile>, Vec<(String, String)>) {
    let Ok(read) = std::fs::read_dir(dir) else { return (Vec::new(), Vec::new()) };
    let mut ids: Vec<String> = read.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect();
    ids.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    let (mut agents, mut problems) = (Vec::new(), Vec::new());
    for id in ids {
        let file = dir.join(&id).join("soul.md");
        if !is_agent_id(&id) || !file.exists() {
            continue;
        }
        match std::fs::read_to_string(&file).map_err(|e| e.to_string()).and_then(|t| parse_soul_file(&id, &t)) {
            Ok(Some(agent)) => agents.push(agent),
            Ok(None) => {}
            Err(problem) => problems.push((id, problem)),
        }
    }
    agents.truncate(MAX_AGENTS);
    (agents, problems)
}

/// A role in the owner's words, checked (`cleanRole`).
pub fn clean_role(raw: &str) -> Result<String, String> {
    let role = raw.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    if role.is_empty() {
        return Err("The role is empty.".into());
    }
    if !letters_then(&role) {
        return Err("A role needs letters only (spaces and hyphens are fine).".into());
    }
    if role == "improver" {
        return Err("That role is Tinker's.".into());
    }
    Ok(role)
}

// ponytail: `\p{L}` is read as `char::is_alphabetic`, which also takes a few letter-like marks; the difference does not show in names people type.
fn letters_then(text: &str) -> bool {
    let mut chars = text.chars();
    chars.next().is_some_and(char::is_alphabetic) && chars.all(|c| c.is_alphabetic() || c == ' ' || c == '-' || c == '\'')
}

/// A soul checked and trimmed (`cleanSoul`); `others` are the names already taken.
pub fn clean_soul(input: &Soul, others: &[String]) -> Result<Soul, String> {
    let fix = |s: &str| s.trim().replace("\r\n", "\n").replace('\r', "\n");
    let mut soul = Soul { name: fix(&input.name), personality: fix(&input.personality), how_it_works: fix(&input.how_it_works), rules: fix(&input.rules), lessons: fix(&input.lessons) };
    soul.name = soul.name.split(is_space).filter(|p| !p.is_empty()).collect::<Vec<_>>().join(" ");
    if !letters_then(&soul.name) {
        return Err("A name needs letters only (spaces, hyphens and apostrophes are fine).".into());
    }
    if RESERVED_NAMES.contains(&soul.name.to_lowercase().as_str()) {
        return Err(format!("\"{}\" is taken by ARK itself.", soul.name));
    }
    if others.iter().any(|n| n.to_lowercase() == soul.name.to_lowercase()) {
        return Err(format!("Another worker is already called {}.", soul.name));
    }
    if soul.personality.is_empty() {
        return Err("The personality is empty.".into());
    }
    Ok(soul)
}

/// The latest kept soul of a worker and its version.
pub fn current(conn: &Connection, id: &str) -> Option<(Soul, i64)> {
    conn.query_row("SELECT name, personality, how_it_works, rules, lessons, version FROM souls WHERE helper = ? ORDER BY version DESC LIMIT 1", [id], |r| {
        Ok((Soul { name: r.get(0)?, personality: r.get(1)?, how_it_works: r.get(2)?, rules: r.get(3)?, lessons: r.get(4)? }, r.get(5)?))
    })
    .optional()
    .ok()?
}

/// The team and the folders that could not be loaded. `None` when a write is due first (a soul file differs from its last kept
/// version, or a worker has no kept soul): Node answers then.
pub fn roster(conn: &Connection, agents_dir: &Path) -> Option<(Vec<Member>, Vec<Value>)> {
    let mut members: Vec<Member> = BUILT_INS.iter().map(|b| Member { id: b.0.into(), available: b.1, role: b.2.into(), kit: built_in_kit(b.2).into(), custom: false }).collect();
    let mut names = Vec::new();
    for m in &members {
        names.push(current(conn, &m.id)?.0.name);
    }
    let (agents, file_problems) = load_agents(agents_dir);
    let mut problems: Vec<Value> = file_problems.into_iter().map(|(id, problem)| json!({ "id": id, "problem": problem })).collect();
    for agent in agents {
        if members.iter().any(|m| m.id == agent.id) {
            continue;
        }
        let checked = clean_role(if agent.role.is_empty() { "assistant" } else { &agent.role }).and_then(|role| clean_soul(&agent.soul, &names).map(|soul| (role, soul)));
        let (role, soul) = match checked {
            Ok(ok) => ok,
            Err(problem) => {
                problems.push(json!({ "id": agent.id, "problem": problem }));
                continue;
            }
        };
        if current(conn, &agent.id)?.0 != soul {
            return None;
        }
        names.push(soul.name);
        members.push(Member { id: agent.id, available: true, role, kit: agent.kit, custom: true });
    }
    Some((members, problems))
}

fn one(conn: &Connection, sql: &str, id: &str) -> Option<String> {
    conn.query_row(sql, [id], |r| r.get::<_, String>(0)).optional().ok().flatten()
}

fn column(conn: &Connection, sql: &str, id: &str) -> Option<Vec<String>> {
    conn.prepare(sql).ok()?.query_map([id], |r| r.get::<_, String>(0)).ok()?.collect::<Result<_, _>>().ok()
}

/// A setting of the form `<prefix>:<id>` is on when its value is "true".
fn setting_on(conn: &Connection, prefix: &str, id: &str) -> bool {
    one(conn, "SELECT value FROM helper_settings WHERE key = ?", &format!("{prefix}:{id}")).as_deref() == Some("true")
}

/// A member as the list shows it, without its routines, proposals and tasks (those come from the later slices).
pub fn member_core(conn: &Connection, m: &Member) -> Option<Value> {
    let (soul, version) = current(conn, &m.id)?;
    let paused = setting_on(conn, "paused", &m.id);
    let versions: Vec<Value> = conn
        .prepare("SELECT version, created_at FROM souls WHERE helper = ? ORDER BY version DESC LIMIT ?")
        .ok()?
        .query_map(rusqlite::params![m.id, SOUL_VERSIONS_LISTED], |r| Ok(json!({ "version": r.get::<_, i64>(0)?, "createdAt": r.get::<_, String>(1)? })))
        .ok()?
        .collect::<Result<_, _>>()
        .ok()?;
    let mut view = json!({
        "id": m.id, "name": soul.name, "available": m.available && !paused, "paused": paused, "role": m.role, "kit": m.kit, "custom": m.custom,
        "soul": soul.json(), "soulVersion": version, "soulVersions": versions,
        "app": one(conn, "SELECT app FROM helper_apps WHERE helper = ?", &m.id),
        "pinnedModel": one(conn, "SELECT model FROM helper_models WHERE helper = ?", &m.id),
        "planFirst": setting_on(conn, "planFirst", &m.id), "browser": setting_on(conn, "browser", &m.id),
        "grants": column(conn, "SELECT path FROM grants WHERE helper = ? ORDER BY rowid", &m.id)?,
        "skills": column(conn, "SELECT skill FROM helper_skills WHERE helper = ? ORDER BY skill", &m.id)?,
    });
    if let Some(codex) = one(conn, "SELECT model FROM helper_codex_models WHERE helper = ?", &m.id).filter(|m| !m.is_empty()) {
        view["codexPinnedModel"] = Value::String(codex);
    }
    Some(view)
}
