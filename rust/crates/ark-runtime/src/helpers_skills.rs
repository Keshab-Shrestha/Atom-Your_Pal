//! The decisions on ARK's own skills (ADR-278 Phase 4): `skill.approve`, `skill.edit.accept` and `skill.edit.undo`. Ports of
//! `approveSkillDraft`, `acceptSkillEdit` and `undoSkillEdit` in `services/helpers/src/skill-drafts.ts`, with `writeSkill`,
//! `skillFile` and `parseSkillFile`. Every refusal checks before it writes, so a refused call changes nothing: the function
//! gives `None` and the caller sends the command to Node, which says why. `~/.claude/skills` is never written.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::helpers_write::{audit_detail, iso_now};

/// What a SKILL.md says: its description and its steps (`parseSkillFile`).
#[derive(Debug, PartialEq, Eq)]
pub struct Parsed {
    pub description: String,
    pub body: String,
}

/// A SKILL.md: front matter with its name and a one-line description, then the steps (`skillFile`).
pub fn skill_file(name: &str, description: &str, body: &str) -> String {
    let one_line = description.split_whitespace().collect::<Vec<_>>().join(" ");
    format!("---\nname: {name}\ndescription: {}\n---\n\n{}\n", Value::String(one_line), body.trim())
}

/// The front matter of `text`: what lies between the two `---` lines, and the rest after the closing line (the regex of `parseSkillFile`).
fn front_matter(text: &str) -> Option<(&str, &str)> {
    let after = text.strip_prefix("---")?;
    let spaces = after.len() - after.trim_start().len();
    let start = after[..spaces].rfind('\n')? + 1; // `\s*\n`: the whitespace gives back up to its last newline
    let inner = &after[start..];
    let mut from = 0;
    while let Some(at) = inner[from..].find("\n---") {
        let close = from + at + 4;
        let tail = &inner[close..];
        let blanks = tail.len() - tail.trim_start_matches([' ', '\t']).len();
        let rest = &tail[blanks..];
        if rest.is_empty() {
            return Some((&inner[..from + at], ""));
        }
        if let Some(rest) = rest.strip_prefix('\n') {
            return Some((&inner[..from + at], rest));
        }
        from += at + 1;
    }
    None
}

/// `s.replace(/^q|q$/g, "")`: a quote at the start and a quote at the end, each on its own.
fn unquote(s: &str, quote: char) -> String {
    let s = s.strip_prefix(quote).unwrap_or(s);
    s.strip_suffix(quote).unwrap_or(s).to_string()
}

/// `parseSkillFile`.
pub fn parse_skill_file(text: &str) -> Parsed {
    let matter = front_matter(text);
    let line = matter
        .and_then(|(inner, _)| inner.split('\n').find(|l| l.strip_prefix("description").is_some_and(|r| r.trim_start().starts_with(':'))))
        .map(|l| l["description".len()..].trim_start()[1..].trim_start())
        .unwrap_or("");
    let description = match line.chars().next() {
        Some('"') => serde_json::from_str::<String>(line).unwrap_or_else(|_| unquote(line, '"')),
        _ => unquote(line, '\''),
    };
    Parsed { description, body: matter.map_or(text, |(_, rest)| rest).trim().to_string() }
}

/// `writeSkill`: the file whole or not at all.
fn write_skill(dir: &Path, name: &str, description: &str, body: &str) -> Option<()> {
    let folder = dir.join(name);
    std::fs::create_dir_all(&folder).ok()?;
    let file = folder.join("SKILL.md");
    let temp = folder.join("SKILL.md.tmp");
    std::fs::write(&temp, skill_file(name, description, body)).ok()?;
    std::fs::rename(&temp, &file).ok()
}

/// A skill name ARK reads: a plain folder name, never a path.
fn any_skill_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 64 && chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// One of ARK's own skills: in its folder, not shadowed by one of the owner's of the same name, and not from the hub.
fn is_ark(conn: &Connection, ark: &Path, user: &Path, name: &str) -> Option<bool> {
    if !any_skill_name(name) {
        return Some(false);
    }
    let hub: i64 = conn.query_row("SELECT COUNT(*) FROM skill_hub WHERE name = ?", [name], |r| r.get(0)).ok()?;
    Some(ark.join(name).join("SKILL.md").exists() && !user.join(name).join("SKILL.md").exists() && hub == 0)
}

fn read_ark(ark: &Path, name: &str) -> Option<Parsed> {
    Some(parse_skill_file(&std::fs::read_to_string(ark.join(name).join("SKILL.md")).ok()?))
}

/// `skill.approve`: a pending draft becomes a skill in ARK's folder.
fn approve_draft(conn: &Connection, ark: &Path, user: &Path, id: i64) -> Option<()> {
    let (job, name, description, body): (i64, String, String, String) =
        conn.query_row("SELECT job_id, name, description, body FROM skill_drafts WHERE id = ? AND state = 'pending'", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().ok()??;
    if !any_skill_name(&name) || user.join(&name).exists() || ark.join(&name).exists() {
        return None;
    }
    write_skill(ark, &name, &description, &body)?;
    conn.execute("UPDATE skill_drafts SET state = 'approved', decided_at = ? WHERE id = ?", params![iso_now(), id]).ok()?;
    audit_detail(conn, "skillDraft", &json!({ "draft": id, "job": job, "skill": name, "state": "approved" }))
}

/// The pending or accepted edit `id` as (skill, job, old body, new body).
fn edit_in(conn: &Connection, id: i64, state: &str) -> Option<(String, i64, String, String)> {
    conn.query_row("SELECT skill, job_id, old_body, new_body FROM skill_edits WHERE id = ? AND state = ?", params![id, state], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().ok()?
}

/// `skill.edit.accept`: writes the new steps; Undo restores exactly what was there just before.
fn accept_edit(conn: &Connection, ark: &Path, user: &Path, id: i64) -> Option<()> {
    let (skill, job, _, new_body) = edit_in(conn, id, "pending")?;
    if !is_ark(conn, ark, user, &skill)? {
        return None;
    }
    let before = read_ark(ark, &skill)?;
    write_skill(ark, &skill, &before.description, &new_body)?;
    conn.execute("UPDATE skill_edits SET state = 'accepted', old_body = ? WHERE id = ?", params![before.body, id]).ok()?;
    audit_detail(conn, "skillEdit", &json!({ "edit": id, "job": job, "skill": skill, "state": "accepted" }))
}

/// `skill.edit.undo`: puts the steps back, unless they changed since the edit.
fn undo_edit(conn: &Connection, ark: &Path, user: &Path, id: i64) -> Option<()> {
    let (skill, job, old_body, new_body) = edit_in(conn, id, "accepted")?;
    if !is_ark(conn, ark, user, &skill)? {
        return None;
    }
    let current = read_ark(ark, &skill)?;
    if current.body.trim() != new_body.trim() {
        return None;
    }
    write_skill(ark, &skill, &current.description, &old_body)?;
    conn.execute("UPDATE skill_edits SET state = 'undone' WHERE id = ?", [id]).ok()?;
    audit_detail(conn, "skillEdit", &json!({ "edit": id, "job": job, "skill": skill, "state": "undone" }))
}

/// The tables and columns the hub part of the event reads.
pub const HUB_SCHEMA: &[(&str, &[&str])] = &[
    ("skill_hub_installs", &["id", "kind", "name", "description", "repo", "path", "sha", "text", "flags"]),
    ("skill_hub", &["name", "repo", "path", "sha"]),
];

/// The `skillHub` part of the helpers list (`payload` of `hub-commands.ts`): what waits for approval and what is installed, from the file.
/// The search results and the message live in Node's memory; they come from `cached` (the `skillHub` of Node's last event).
/// `Some(None)` when there is nothing to show.
pub fn hub_payload(conn: &Connection, cached: Option<&Value>) -> Option<Option<Value>> {
    let mut stmt = conn.prepare("SELECT id, kind, name, description, repo, path, sha, text, flags FROM skill_hub_installs ORDER BY id").ok()?;
    let pending: Vec<Value> = stmt
        .query_map([], |r| {
            let flags: String = r.get(8)?;
            Ok((json!({ "id": r.get::<_, i64>(0)?, "kind": r.get::<_, String>(1)?, "name": r.get::<_, String>(2)?, "description": r.get::<_, String>(3)?, "repo": r.get::<_, String>(4)?, "path": r.get::<_, String>(5)?, "sha": r.get::<_, String>(6)?, "text": r.get::<_, String>(7)? }), flags))
        })
        .ok()?
        .collect::<Result<Vec<_>, _>>()
        .ok()?
        .into_iter()
        .map(|(mut item, flags)| {
            item["flags"] = serde_json::from_str(&flags).ok()?;
            Some(item)
        })
        .collect::<Option<_>>()?;
    let mut stmt = conn.prepare("SELECT name, repo, path, sha FROM skill_hub ORDER BY name").ok()?;
    let installed: Vec<Value> = stmt.query_map([], |r| Ok(json!({ "name": r.get::<_, String>(0)?, "repo": r.get::<_, String>(1)?, "path": r.get::<_, String>(2)?, "sha": r.get::<_, String>(3)? }))).ok()?.collect::<Result<_, _>>().ok()?;
    let results = cached.and_then(|c| c.get("results")).cloned().unwrap_or_else(|| json!([]));
    let message = cached.and_then(|c| c.get("message")).filter(|m| m.as_str().is_some_and(|m| !m.is_empty()));
    if results.as_array().is_none_or(Vec::is_empty) && pending.is_empty() && installed.is_empty() && message.is_none() {
        return Some(None);
    }
    let mut item = json!({ "results": results, "pending": pending, "installed": installed });
    if let Some(message) = message {
        item["message"] = message.clone();
    }
    Some(Some(item))
}

/// The write that `command` asks for, or `None` for another command or a call Node must answer.
pub fn apply(conn: &Connection, command: &Value, ark: &Path, user: &Path) -> Option<()> {
    let id = command["id"].as_i64()?;
    match command["type"].as_str()? {
        "skill.approve" => approve_draft(conn, ark, user, id),
        "skill.edit.accept" => accept_edit(conn, ark, user, id),
        "skill.edit.undo" => undo_edit(conn, ark, user, id),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn the_hub_part_keeps_nodes_results_and_message_and_hides_when_empty() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE skill_hub_installs (id INTEGER PRIMARY KEY, kind TEXT, name TEXT, description TEXT, repo TEXT, path TEXT, sha TEXT, text TEXT, flags TEXT); CREATE TABLE skill_hub (name TEXT, repo TEXT, path TEXT, sha TEXT);").unwrap();
        assert_eq!(hub_payload(&conn, None), Some(None));
        assert_eq!(hub_payload(&conn, Some(&json!({ "results": [], "message": "No skill has that in its name." }))).unwrap().unwrap()["message"], "No skill has that in its name.");
        conn.execute("INSERT INTO skill_hub VALUES ('b', 'r', 'p', 's'), ('a', 'r', 'p', 's')", []).unwrap();
        let item = hub_payload(&conn, Some(&json!({ "results": [{ "name": "x" }] }))).unwrap().unwrap();
        assert_eq!((item["installed"][0]["name"].as_str(), item["results"][0]["name"].as_str(), item.get("message")), (Some("a"), Some("x"), None));
    }

    #[test]
    fn a_skill_file_reads_back_what_was_written() {
        let text = skill_file("x", "Say \"hi\"\n  twice\tplease", "  Step one.\n\n");
        assert_eq!(text, "---\nname: x\ndescription: \"Say \\\"hi\\\" twice please\"\n---\n\nStep one.\n");
        assert_eq!(parse_skill_file(&text), Parsed { description: "Say \"hi\" twice please".into(), body: "Step one.".into() });
    }

    #[test]
    fn it_reads_quoted_plain_and_missing_front_matter() {
        assert_eq!(parse_skill_file("---\ndescription: 'Quoted'\n---\nBody").description, "Quoted");
        assert_eq!(parse_skill_file("---\nname: a\ndescription : Plain words\n---  \nBody\n").body, "Body");
        let none = parse_skill_file("  just steps ");
        assert_eq!((none.description.as_str(), none.body.as_str()), ("", "just steps"));
        assert_eq!(parse_skill_file("---\ndescription: \"broken\n---\nB").description, "broken");
    }
}
