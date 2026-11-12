//! The MCP server commands of the Helpers page (ADR-278 Phase 4): `mcp.add`, `mcp.remove` and `mcp.set`. Ports of `cleanMcpInput`
//! and `mcpTable` in `services/helpers/src/mcp.ts` and `mcpMethods` in `store-mcp.ts`. `mcp.test` starts the server, so Node keeps it.
//! `None` for another command or a refusal: the caller sends the line to Node, which gives the words of the refusal.

use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::helpers_roster;
use crate::helpers_write::audit_detail;

const MAX_MCP_SERVERS: usize = 20;
const RESERVED: [&str; 6] = ["ark", "ark-browser", "atom", "atom-browser", "zeno", "zeno-browser"];

fn is_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 32 && chars.next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit()) && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// What `JSON.stringify` writes for an object made by `Object.fromEntries`: whole-number keys first and ascending, then the others in
/// the order they came; a repeated key keeps its first place and its last value.
fn object_json(pairs: Vec<(String, String)>) -> String {
    let mut merged: Vec<(String, String)> = Vec::new();
    for (k, v) in pairs {
        match merged.iter_mut().find(|(have, _)| *have == k) {
            Some(slot) => slot.1 = v,
            None => merged.push((k, v)),
        }
    }
    let index = |k: &str| k.parse::<u32>().ok().filter(|n| *n < u32::MAX && n.to_string() == k);
    let (mut numbers, others): (Vec<_>, Vec<_>) = merged.into_iter().partition(|(k, _)| index(k).is_some());
    numbers.sort_by_key(|(k, _)| index(k));
    let body: Vec<String> = numbers.into_iter().chain(others).map(|(k, v)| format!("{}:{}", json!(k), json!(v))).collect();
    format!("{{{}}}", body.join(","))
}

/// `pairs`: lines `KEY<sep>value` whose key passes `key_ok`. `None` for a line that is not one.
fn pairs(lines: &Value, sep: char, key_ok: fn(&str) -> bool) -> Option<Vec<(String, String)>> {
    let mut out = Vec::new();
    for line in lines.as_array().map(Vec::as_slice).unwrap_or_default() {
        let line = line.as_str()?.trim();
        if line.is_empty() {
            continue;
        }
        let at = line.find(sep).filter(|at| *at > 0)?;
        let key = line[..at].trim();
        if !key_ok(key) {
            return None;
        }
        out.push((key.to_string(), line[at + sep.len_utf8()..].trim().to_string()));
    }
    Some(out)
}

fn env_key(k: &str) -> bool {
    k.len() <= 64 && k.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn header_key(k: &str) -> bool {
    (1..=64).contains(&k.len()) && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// The cleaned columns of a new server: name, kind, command, args, env, url, transport, headers.
type Columns = (String, &'static str, Option<String>, String, String, Option<String>, &'static str, String);

fn clean(command: &Value, taken: &[String]) -> Option<Columns> {
    let name = command["name"].as_str()?.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join("-");
    if !is_name(&name) || RESERVED.contains(&name.as_str()) || taken.contains(&name) {
        return None;
    }
    match command["kind"].as_str()? {
        "command" => {
            let cmd = command["command"].as_str().unwrap_or("").trim();
            if cmd.is_empty() || cmd.chars().count() > 500 || cmd.contains(['\n', '\0']) {
                return None;
            }
            let args: Vec<String> = command["args"].as_array().map(Vec::as_slice).unwrap_or_default().iter().map(|a| a.as_str().map(|s| s.trim().to_string())).collect::<Option<_>>()?;
            let args: Vec<String> = args.into_iter().filter(|a| !a.is_empty()).collect();
            if args.len() > 30 || args.iter().any(|a| a.chars().count() > 500) {
                return None;
            }
            Some((name, "command", Some(cmd.to_string()), json!(args).to_string(), object_json(pairs(&command["env"], '=', env_key)?), None, "http", "{}".into()))
        }
        "url" => {
            let parsed = url::Url::parse(command["url"].as_str().unwrap_or("").trim()).ok()?;
            let secret = parsed.query().is_some_and(|q| ["token", "key", "secret"].iter().any(|w| q.to_lowercase().contains(w)));
            if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() || parsed.password().is_some() || secret {
                return None;
            }
            let transport = if command["transport"] == "sse" { "sse" } else { "http" };
            Some((name, "url", None, "[]".into(), "{}".into(), Some(parsed.to_string()), transport, object_json(pairs(&command["headers"], ':', header_key)?)))
        }
        _ => None,
    }
}

fn add(conn: &Connection, command: &Value) -> Option<i64> {
    let taken: Vec<String> = conn.prepare("SELECT name FROM mcp_servers").ok()?.query_map([], |r| r.get(0)).ok()?.collect::<Result<_, _>>().ok()?;
    if taken.len() >= MAX_MCP_SERVERS {
        return None;
    }
    let (name, kind, program, args, env, url, transport, headers) = clean(command, &taken)?;
    conn.execute("INSERT INTO mcp_servers (name, kind, command, args, env, url, transport, headers) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", params![name, kind, program, args, env, url, transport, headers]).ok()?;
    Some(conn.last_insert_rowid())
}

fn set(conn: &Connection, agents: &Path, command: &Value, id: i64) -> Option<()> {
    let (enabled, trusted, workers, tested_at, problem): (i64, i64, String, Option<String>, Option<String>) =
        conn.query_row("SELECT enabled, trusted, workers, tested_at, problem FROM mcp_servers WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional().ok()??;
    let team: Vec<String> = helpers_roster::roster(conn, agents)?.0.into_iter().map(|m| m.id).collect();
    let workers: Vec<String> = match command["workers"].as_array() {
        Some(list) => {
            let mut unique: Vec<String> = Vec::new();
            for w in list {
                let w = w.as_str()?.to_string();
                if !unique.contains(&w) {
                    unique.push(w);
                }
            }
            unique
        }
        None => serde_json::from_str(&workers).ok()?,
    };
    if workers.iter().any(|w| !team.contains(w)) {
        return None;
    }
    let flag = |key: &str, old: i64| match &command[key] {
        Value::Null => Some(old),
        Value::Bool(b) => Some(i64::from(*b)),
        _ => None,
    };
    let (now_enabled, now_trusted) = (flag("enabled", enabled)?, flag("trusted", trusted)?);
    if now_enabled == 1 && enabled == 0 && (tested_at.is_none() || problem.is_some_and(|p| !p.is_empty())) {
        return None;
    }
    conn.execute("UPDATE mcp_servers SET enabled = ?, trusted = ?, workers = ? WHERE id = ?", params![now_enabled, now_trusted, json!(workers).to_string(), id]).ok()?;
    audit_detail(conn, "mcp", &json!({ "server": id, "change": "set" }))
}

/// The write that `command` asks for.
pub fn apply(conn: &Connection, command: &Value, agents: &Path) -> Option<()> {
    match command["type"].as_str()? {
        "mcp.add" => audit_detail(conn, "mcp", &json!({ "server": add(conn, command)?, "change": "added" })),
        "mcp.remove" => {
            let id = command["id"].as_i64()?;
            // An unknown server is ignored (the page is sent again).
            if conn.execute("DELETE FROM mcp_servers WHERE id = ?", [id]).ok()? > 0 {
                audit_detail(conn, "mcp", &json!({ "server": id, "change": "removed" }))?;
            }
            Some(())
        }
        "mcp.set" => set(conn, agents, command, command["id"].as_i64()?),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn fixture() -> (Connection, std::path::PathBuf) {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("ark-mcp-edit-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        let file = dir.join("helpers.db");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/helpers.db"), &file).unwrap();
        (Connection::open(file).unwrap(), dir.join("agents"))
    }

    type Row = (String, String, String, Option<String>, String, String);

    fn row(conn: &Connection, name: &str) -> Row {
        conn.query_row("SELECT kind, args, env, url, transport, headers FROM mcp_servers WHERE name = ?", [name], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).unwrap()
    }

    #[test]
    fn it_cleans_and_stores_the_two_kinds_like_the_typescript() {
        let (conn, agents) = fixture();
        apply(&conn, &json!({"type": "mcp.add", "name": "  My  Tool ", "kind": "command", "command": " npx ", "args": [" -y ", "", "pkg"], "env": ["B=2", "A = x=y", " "]}), &agents).unwrap();
        let (kind, args, env, url, transport, headers) = row(&conn, "my-tool");
        assert_eq!((kind.as_str(), args.as_str(), env.as_str(), url, transport.as_str(), headers.as_str()), ("command", "[\"-y\",\"pkg\"]", "{\"B\":\"2\",\"A\":\"x=y\"}", None, "http", "{}"));
        apply(&conn, &json!({"type": "mcp.add", "name": "web", "kind": "url", "url": " https://Example.com ", "transport": "sse", "headers": ["Zeta: 1", "7: c", "Auth: b", "Zeta: 9"]}), &agents).unwrap();
        let (kind, _, _, url, transport, headers) = row(&conn, "web");
        assert_eq!((kind.as_str(), url.as_deref(), transport.as_str(), headers.as_str()), ("url", Some("https://example.com/"), "sse", "{\"7\":\"c\",\"Zeta\":\"9\",\"Auth\":\"b\"}"));
        let last: String = conn.query_row("SELECT detail FROM audit_log WHERE action = 'mcp' ORDER BY id DESC LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&last).unwrap()["change"], "added");
    }

    #[test]
    fn it_refuses_what_the_typescript_refuses() {
        let (conn, agents) = fixture();
        let bad = [
            json!({"name": "ark", "kind": "command", "command": "x"}),
            json!({"name": "Bad!", "kind": "command", "command": "x"}),
            json!({"name": "files", "kind": "command", "command": "x"}),
            json!({"name": "a", "kind": "command", "command": ""}),
            json!({"name": "a", "kind": "command", "command": "x", "env": ["1BAD=x"]}),
            json!({"name": "a", "kind": "url", "url": "ftp://x.com"}),
            json!({"name": "a", "kind": "url", "url": "https://x.com/?api_key=1"}),
            json!({"name": "a", "kind": "url", "url": "https://u:p@x.com/"}),
            json!({"name": "a", "kind": "url", "url": "https://x.com", "headers": ["no colon"]}),
        ];
        for mut command in bad {
            command["type"] = json!("mcp.add");
            assert!(apply(&conn, &command, &agents).is_none(), "{command}");
        }
        assert_eq!(conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM mcp_servers", [], |r| r.get(0)).unwrap(), 2);
    }

    #[test]
    fn set_needs_a_good_test_before_it_turns_on_and_known_workers() {
        let (conn, agents) = fixture();
        let state = |id: i64| conn.query_row::<(i64, i64, String), _, _>("SELECT enabled, trusted, workers FROM mcp_servers WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        // Server 2 has a failed test: it stays off. Server 1 was tested well.
        assert!(apply(&conn, &json!({"type": "mcp.set", "id": 2, "enabled": true}), &agents).is_none());
        assert!(apply(&conn, &json!({"type": "mcp.set", "id": 1, "workers": ["nobody"]}), &agents).is_none());
        apply(&conn, &json!({"type": "mcp.set", "id": 2, "trusted": true, "workers": ["sid", "sid", "kame"]}), &agents).unwrap();
        assert_eq!(state(2), (0, 1, "[\"sid\",\"kame\"]".into()));
        apply(&conn, &json!({"type": "mcp.set", "id": 1, "enabled": false}), &agents).unwrap();
        assert_eq!(state(1).0, 0);
        apply(&conn, &json!({"type": "mcp.set", "id": 1, "enabled": true}), &agents).unwrap();
        assert_eq!(state(1).0, 1);
        apply(&conn, &json!({"type": "mcp.remove", "id": 2}), &agents).unwrap();
        apply(&conn, &json!({"type": "mcp.remove", "id": 2}), &agents).unwrap();
        assert_eq!(conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM mcp_servers", [], |r| r.get(0)).unwrap(), 1);
    }
}
