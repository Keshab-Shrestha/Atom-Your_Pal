//! More parts of the Helpers page that come from `helpers.db` (ADR-278 Phase 4, slice 5): the large-model switch, the MCP
//! servers, and the skill drafts and edits. Ports of `allowLarge` (`store.ts`), `mcpTable` (`mcp.ts`), `skillDrafts`,
//! `skillEdits` (`skill-drafts.ts`) and the matching lists in `apps/mac/src/island-helpers.ts`.

// The SQL rows are read as plain tuples, one per column.
#![allow(clippy::type_complexity)]

use rusqlite::{Connection, OptionalExtension};
use serde::de::{IgnoredAny, MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};

use crate::helpers_tests::{cut_to, tests_of};

/// The tables and columns these views read.
pub const SCHEMA: &[(&str, &[&str])] = &[
    ("mcp_servers", &["id", "name", "kind", "command", "args", "env", "url", "transport", "headers", "enabled", "trusted", "workers", "tools", "tested_at", "problem"]),
    ("skill_drafts", &["id", "job_id", "helper", "name", "description", "body", "state", "created_at"]),
    ("skill_edits", &["id", "skill", "job_id", "old_body", "new_body", "reason", "state", "created_at"]),
    ("helper_settings", &["key", "value"]),
];

const PREVIEW_CHARS: usize = 400;
const CHANGE_LINES: usize = 6;
const SKILL_ITEMS_LISTED: i64 = 5;

/// Whether jobs may use the large model (default true).
pub fn allow_large(conn: &Connection) -> Option<bool> {
    let value: Option<String> = conn.query_row("SELECT value FROM helper_settings WHERE key = 'allowLarge'", [], |r| r.get(0)).optional().ok()?;
    Some(value.as_deref() != Some("false"))
}

/// The keys of a JSON object in the order JavaScript's `Object.keys` gives them: whole-number keys first, ascending, then the rest as written.
struct Keys(Vec<String>);

impl<'de> Deserialize<'de> for Keys {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Keys;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("an object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Keys, A::Error> {
                let mut keys: Vec<String> = Vec::new();
                while let Some((key, _)) = map.next_entry::<String, IgnoredAny>()? {
                    if let Some(at) = keys.iter().position(|k| *k == key) {
                        keys.remove(at); // a repeated key keeps its first place in JavaScript
                    }
                    keys.push(key);
                }
                Ok(Keys(keys))
            }
        }
        d.deserialize_map(V)
    }
}

fn object_keys(text: &str) -> Option<Vec<String>> {
    let Keys(keys) = serde_json::from_str(text).ok()?;
    let index = |k: &str| k.parse::<u32>().ok().filter(|n| *n != u32::MAX && n.to_string() == k);
    let (mut numeric, rest): (Vec<String>, Vec<String>) = keys.into_iter().partition(|k| index(k).is_some());
    numeric.sort_by_key(|k| index(k));
    numeric.extend(rest);
    Some(numeric)
}

fn iso(text: &str) -> Option<String> {
    let t: jiff::Timestamp = text.parse().ok()?;
    Some(t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())
}

/// The MCP servers as the window gets them: the keys of the env and headers, never their values.
pub fn mcp(conn: &Connection) -> Option<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id, name, kind, command, args, env, url, transport, headers, enabled, trusted, workers, tools, tested_at, problem FROM mcp_servers ORDER BY id").ok()?;
    let rows = stmt
        .query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, String>(4)?, r.get::<_, String>(5)?, r.get::<_, Option<String>>(6)?, r.get::<_, String>(7)?, r.get::<_, String>(8)?, r.get::<_, i64>(9)?, r.get::<_, i64>(10)?, r.get::<_, String>(11)?, r.get::<_, String>(12)?, r.get::<_, Option<String>>(13)?, r.get::<_, Option<String>>(14)?))
        })
        .ok()?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, kind, command, args, env, url, transport, headers, enabled, trusted, workers, tools, tested_at, problem) = row.ok()?;
        let mut v = Map::new();
        v.insert("id".into(), json!(id));
        v.insert("name".into(), json!(name));
        v.insert("kind".into(), json!(kind));
        if let Some(c) = command.filter(|c| !c.is_empty()) {
            v.insert("command".into(), json!(c));
        }
        v.insert("args".into(), serde_json::from_str(&args).ok()?);
        if let Some(u) = url.filter(|u| !u.is_empty()) {
            v.insert("url".into(), json!(u));
        }
        v.insert("transport".into(), json!(transport));
        v.insert("envKeys".into(), json!(object_keys(&env)?));
        v.insert("headerKeys".into(), json!(object_keys(&headers)?));
        v.insert("enabled".into(), json!(enabled == 1));
        v.insert("trusted".into(), json!(trusted == 1));
        v.insert("workers".into(), serde_json::from_str(&workers).ok()?);
        v.insert("tools".into(), serde_json::from_str(&tools).ok()?);
        if let Some(t) = tested_at.filter(|t| !t.is_empty()) {
            v.insert("testedAt".into(), json!(iso(&t)?));
        }
        if let Some(p) = problem.filter(|p| !p.is_empty()) {
            v.insert("problem".into(), json!(p));
        }
        out.push(Value::Object(v));
    }
    Some(out)
}

/// The listed skill drafts: every pending one and the newest others, newest first.
pub fn skill_drafts(conn: &Connection) -> Option<Vec<Value>> {
    let mut stmt = conn
        .prepare("SELECT id, job_id, helper, name, description, body, state, created_at FROM skill_drafts WHERE state = 'pending' OR id IN (SELECT id FROM skill_drafts ORDER BY id DESC LIMIT ?) ORDER BY id DESC")
        .ok()?;
    let rows: Vec<(i64, i64, String, String, String, String, String, String)> =
        stmt.query_map([SKILL_ITEMS_LISTED], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))).ok()?.collect::<Result<_, _>>().ok()?;
    rows.into_iter()
        .map(|(id, job, helper, name, description, body, state, at)| {
            Some(json!({ "id": id, "jobId": job, "helper": helper, "name": name, "description": description, "preview": cut_to(&body, PREVIEW_CHARS), "state": state, "createdAt": iso(&at)? }))
        })
        .collect()
}

/// A compact before and after: from the first line that differs, a few lines of each.
fn compact_change(before: &str, after: &str) -> (String, String) {
    let (a, b): (Vec<&str>, Vec<&str>) = (before.split('\n').collect(), after.split('\n').collect());
    let i = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let part = |lines: &[&str]| cut_to(&lines.iter().skip(i).take(CHANGE_LINES).copied().collect::<Vec<_>>().join("\n"), PREVIEW_CHARS);
    (part(&a), part(&b))
}

/// The listed skill edits: every pending one and the newest others, newest first.
pub fn skill_edits(conn: &Connection) -> Option<Vec<Value>> {
    let mut stmt = conn
        .prepare("SELECT id, skill, job_id, old_body, new_body, reason, state, created_at FROM skill_edits WHERE state = 'pending' OR id IN (SELECT id FROM skill_edits ORDER BY id DESC LIMIT ?) ORDER BY id DESC")
        .ok()?;
    let rows: Vec<(i64, String, i64, String, String, String, String, String)> =
        stmt.query_map([SKILL_ITEMS_LISTED], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?))).ok()?.collect::<Result<_, _>>().ok()?;
    let mut out = Vec::new();
    for (id, skill, job, old, new, reason, state, at) in rows {
        let (before, after) = compact_change(&old, &new);
        let mut v = json!({ "id": id, "skill": skill, "jobId": job, "reason": reason, "before": before, "after": after, "state": state, "createdAt": iso(&at)? });
        if let Some(tests) = tests_of(conn, "skill", id)? {
            v["tests"] = tests;
        }
        out.push(v);
    }
    Some(out)
}
