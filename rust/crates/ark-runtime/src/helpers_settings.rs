//! The switches of the Helpers page that are one row of `helper_settings` (ADR-278 Phase 4): `helper.planFirst`, `helper.browser`,
//! `agent.pause` and `helpers.settings` (allowLarge). Ports of `setPlanFirst`, `setBrowser`, `setPaused` and `setAllowLarge` in
//! `store.ts`. `None` for another command or a refusal: the caller sends the line to Node, which gives the words of the refusal.

use rusqlite::{Connection, params};
use serde_json::Value;

fn put(conn: &Connection, key: &str, on: bool) -> Option<()> {
    conn.execute("INSERT INTO helper_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params![key, on.to_string()]).ok()?;
    Some(())
}

fn known(conn: &Connection, helper: &str) -> Option<()> {
    conn.query_row("SELECT COUNT(*) FROM souls WHERE helper = ?", [helper], |r| r.get::<_, i64>(0)).ok().filter(|n| *n > 0).map(|_| ())
}

/// The write that `command` asks for.
pub fn apply(conn: &Connection, command: &Value) -> Option<()> {
    match command["type"].as_str()? {
        "helper.planFirst" | "helper.browser" => {
            let helper = command["helper"].as_str()?;
            known(conn, helper)?;
            let kind = if command["type"] == "helper.planFirst" { "planFirst" } else { "browser" };
            put(conn, &format!("{kind}:{helper}"), command["on"].as_bool()?)
        }
        "agent.pause" => {
            let id = command["id"].as_str()?;
            known(conn, id)?;
            put(conn, &format!("paused:{id}"), command["paused"].as_bool()?)
        }
        "helpers.settings" => put(conn, "allowLarge", command["allowLarge"].as_bool()?),
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn it_writes_the_switch_rows_and_refuses_an_unknown_helper() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE helper_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE souls (helper TEXT); INSERT INTO souls VALUES ('sid')").unwrap();
        let get = |k: &str| conn.query_row("SELECT value FROM helper_settings WHERE key = ?", [k], |r| r.get::<_, String>(0)).unwrap();
        apply(&conn, &json!({"type": "helper.planFirst", "helper": "sid", "on": true})).unwrap();
        apply(&conn, &json!({"type": "agent.pause", "id": "sid", "paused": true})).unwrap();
        apply(&conn, &json!({"type": "agent.pause", "id": "sid", "paused": false})).unwrap();
        apply(&conn, &json!({"type": "helpers.settings", "allowLarge": true})).unwrap();
        assert_eq!((get("planFirst:sid").as_str(), get("paused:sid").as_str(), get("allowLarge").as_str()), ("true", "false", "true"));
        assert!(apply(&conn, &json!({"type": "helper.browser", "helper": "nobody", "on": true})).is_none());
        assert!(apply(&conn, &json!({"type": "agent.pause", "id": "sid", "paused": "yes"})).is_none(), "needs a boolean");
    }
}
