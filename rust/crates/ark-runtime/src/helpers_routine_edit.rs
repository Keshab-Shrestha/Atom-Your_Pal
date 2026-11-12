//! The routine commands of the Helpers page (ADR-278 Phase 4): `routine.add`, `.update`, `.pause` and `.delete`. Ports of
//! `routineMethods` in `services/helpers/src/store-routines.ts` and `routineTable` in `routines.ts`. `None` for another command or
//! a refusal: the caller sends the line to Node, which gives the words of the refusal.

use std::path::Path;

use jiff::Timestamp;
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::helpers_write::{audit_detail, iso_now};
use crate::{helpers_roster, helpers_routines::Schedule};

const MAX_ROUTINES: i64 = 20;
const MAX_EVERY_HOURS: i64 = 168;
const HOUR_MS: i64 = 3_600_000;
const YEAR_MS: i64 = 366 * 86_400_000;

/// `checkSchedule` and `JSON.stringify` of the result.
fn schedule_json(command: &Value) -> Option<(Schedule, String)> {
    let int = |key: &str| command[key].as_i64().unwrap_or(-1);
    let minute_ok = |m: i64| (0..24 * 60).contains(&m);
    match command["kind"].as_str()? {
        "daily" if minute_ok(int("minute")) => Some((Schedule::Daily { minute: int("minute") }, format!("{{\"kind\":\"daily\",\"minute\":{}}}", int("minute")))),
        "weekly" if minute_ok(int("minute")) && (0..=6).contains(&int("weekday")) => {
            Some((Schedule::Weekly { weekday: int("weekday"), minute: int("minute") }, format!("{{\"kind\":\"weekly\",\"weekday\":{},\"minute\":{}}}", int("weekday"), int("minute"))))
        }
        "hours" if (1..=MAX_EVERY_HOURS).contains(&int("every")) => Some((Schedule::Hours { every: int("every") }, format!("{{\"kind\":\"hours\",\"every\":{}}}", int("every")))),
        _ => None,
    }
}

fn iso(ts: Timestamp) -> String {
    ts.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// `anchorFor`: `None` when the start is not a time or lies more than a year ahead (`startOf` refuses it).
fn anchor(schedule: &Schedule, command: &Value, fallback: &str) -> Option<String> {
    let (Schedule::Hours { every }, Some(start)) = (schedule, command["startAt"].as_str().filter(|s| !s.is_empty())) else { return Some(fallback.to_string()) };
    let at: Timestamp = start.parse().ok()?;
    if at.as_millisecond() > Timestamp::now().as_millisecond() + YEAR_MS {
        return None;
    }
    Timestamp::from_millisecond(at.as_millisecond() - every * HOUR_MS).ok().map(iso)
}

/// `availableHelper`: the worker exists, is not Tinker, is not paused and is ready.
fn available(conn: &Connection, agents: &Path, helper: &str) -> Option<()> {
    let (members, _) = helpers_roster::roster(conn, agents)?;
    let member = members.iter().find(|m| m.id == helper)?;
    let core = helpers_roster::member_core(conn, member)?;
    (member.role != "improver" && core["available"] == true).then_some(())
}

fn flag(command: &Value, key: &str) -> Option<Option<i64>> {
    match &command[key] {
        Value::Null => Some(None),
        Value::Bool(b) => Some(Some(i64::from(*b))),
        _ => None,
    }
}

fn routine_audit(conn: &Connection, helper: &str, id: i64, outcome: &str) -> Option<()> {
    audit_detail(conn, "routine", &json!({ "helper": helper, "routine": id, "outcome": outcome }))
}

fn row(conn: &Connection, id: i64) -> Option<(String, String, String, i64)> {
    conn.query_row("SELECT helper, schedule, created_at, COALESCE(paused, 0) FROM routines WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional().ok()?
}

fn write(conn: &Connection, command: &Value, id: Option<i64>, agents: &Path) -> Option<()> {
    let helper = command["helper"].as_str().filter(|h| !h.is_empty())?;
    let task = command["task"].as_str()?.trim();
    if task.is_empty() {
        return None;
    }
    available(conn, agents, helper)?;
    let (schedule, text) = schedule_json(command)?;
    let (notify, webhook) = (flag(command, "notifyTelegram")?, flag(command, "webhook")?);
    let now = iso_now();
    let outcome = match id {
        None => {
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM routines", [], |r| r.get(0)).ok()?;
            if count >= MAX_ROUTINES {
                return None;
            }
            conn.execute("INSERT INTO routines (helper, task, schedule, created_at) VALUES (?, ?, ?, ?)", params![helper, task, text, anchor(&schedule, command, &now)?]).ok()?;
            let new = conn.last_insert_rowid();
            if notify == Some(1) {
                conn.execute("UPDATE routines SET notify_telegram = 1 WHERE id = ?", [new]).ok()?;
            }
            if webhook == Some(1) {
                conn.execute("UPDATE routines SET webhook = 1 WHERE id = ?", [new]).ok()?;
            }
            (new, "added")
        }
        Some(id) => {
            let (_, old_schedule, created, _) = row(conn, id)?;
            // The hourly anchor moves only when the schedule or its start changes; the text alone keeps the times.
            let same = old_schedule == text && command["startAt"].as_str().is_none_or(str::is_empty);
            let created = if same { created } else { anchor(&schedule, command, &now)? };
            conn.execute("UPDATE routines SET helper = ?, task = ?, schedule = ?, created_at = ?, resumed_at = ? WHERE id = ?", params![helper, task, text, created, now, id]).ok()?;
            if let Some(on) = notify {
                conn.execute("UPDATE routines SET notify_telegram = ? WHERE id = ?", params![on, id]).ok()?;
            }
            if let Some(on) = webhook {
                conn.execute("UPDATE routines SET webhook = ? WHERE id = ?", params![on, id]).ok()?;
            }
            (id, "changed")
        }
    };
    routine_audit(conn, helper, outcome.0, outcome.1)
}

/// The write that `command` asks for.
pub fn apply(conn: &Connection, command: &Value, agents: &Path) -> Option<()> {
    match command["type"].as_str()? {
        "routine.add" => write(conn, command, None, agents),
        "routine.update" => write(conn, command, Some(command["id"].as_i64()?), agents),
        "routine.pause" => {
            let id = command["id"].as_i64()?;
            let paused = command["paused"].as_bool()?;
            let (helper, _, _, now_paused) = row(conn, id)?;
            if (now_paused == 1) == paused {
                return Some(());
            }
            let at = (!paused).then(iso_now);
            conn.execute("UPDATE routines SET paused = ?, resumed_at = COALESCE(?, resumed_at) WHERE id = ?", params![i64::from(paused), at, id]).ok()?;
            routine_audit(conn, &helper, id, if paused { "paused" } else { "resumed" })
        }
        // An unknown routine is ignored (the page is sent again).
        "routine.delete" => {
            let id = command["id"].as_i64()?;
            if let Some((helper, ..)) = row(conn, id) {
                conn.execute("DELETE FROM routines WHERE id = ?", [id]).ok()?;
                routine_audit(conn, &helper, id, "removed")?;
            }
            Some(())
        }
        _ => None,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn fixture() -> (Connection, std::path::PathBuf) {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("ark-routine-edit-{}-{}", std::process::id(), N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)));
        std::fs::create_dir_all(dir.join("agents")).unwrap();
        let file = dir.join("helpers.db");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/helpers/helpers.db"), &file).unwrap();
        (Connection::open(file).unwrap(), dir.join("agents"))
    }

    fn routine(conn: &Connection, id: i64) -> (String, String, String, Option<i64>) {
        conn.query_row("SELECT task, schedule, created_at, notify_telegram FROM routines WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap()
    }

    #[test]
    fn add_update_pause_and_delete_follow_the_typescript_rules() {
        let (conn, agents) = fixture();
        let before: i64 = conn.query_row("SELECT COUNT(*) FROM routines", [], |r| r.get(0)).unwrap();
        let start = Timestamp::from_millisecond(Timestamp::now().as_millisecond() / 1000 * 1000 + 2 * 86_400_000).unwrap();
        let anchor = iso(Timestamp::from_millisecond(start.as_millisecond() - 3 * HOUR_MS).unwrap());
        let add = json!({"type": "routine.add", "helper": "sid", "task": "  Read the news ", "kind": "hours", "every": 3, "startAt": iso(start)});
        apply(&conn, &add, &agents).unwrap();
        let id: i64 = conn.query_row("SELECT MAX(id) FROM routines", [], |r| r.get(0)).unwrap();
        // The first time is one period after the anchor.
        assert_eq!(routine(&conn, id), ("Read the news".into(), "{\"kind\":\"hours\",\"every\":3}".into(), anchor.clone(), None));
        // A new text alone keeps the anchor; a flag is stored.
        apply(&conn, &json!({"type": "routine.update", "id": id, "helper": "sid", "task": "Other", "kind": "hours", "every": 3, "notifyTelegram": true}), &agents).unwrap();
        assert_eq!(routine(&conn, id), ("Other".into(), "{\"kind\":\"hours\",\"every\":3}".into(), anchor, Some(1)));
        apply(&conn, &json!({"type": "routine.pause", "id": id, "paused": true}), &agents).unwrap();
        assert_eq!(row(&conn, id).unwrap().3, 1);
        apply(&conn, &json!({"type": "routine.delete", "id": id}), &agents).unwrap();
        assert!(row(&conn, id).is_none());
        let outcomes: Vec<String> = conn.prepare("SELECT detail FROM audit_log WHERE action = 'routine' ORDER BY id DESC LIMIT 4").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().map(|d| serde_json::from_str::<Value>(&d.unwrap()).unwrap()["outcome"].as_str().unwrap().to_string()).collect();
        assert_eq!(outcomes, ["removed", "paused", "changed", "added"]);
        assert_eq!(conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM routines", [], |r| r.get(0)).unwrap(), before);
    }

    #[test]
    fn a_refusal_changes_nothing() {
        let (conn, agents) = fixture();
        let count = |c: &Connection| c.query_row::<i64, _, _>("SELECT COUNT(*) FROM routines", [], |r| r.get(0)).unwrap();
        let before = count(&conn);
        let base = json!({"type": "routine.add", "helper": "sid", "task": "x", "kind": "daily", "minute": 480});
        for patch in [json!({"minute": 1440}), json!({"task": " "}), json!({"helper": "nobody"}), json!({"helper": "tinker"}), json!({"kind": "hours", "every": 169}), json!({"kind": "hours", "every": 2, "startAt": "2999-01-01T00:00:00Z"})] {
            let mut command = base.clone();
            command.as_object_mut().unwrap().extend(patch.as_object().unwrap().clone());
            assert!(apply(&conn, &command, &agents).is_none(), "{command}");
        }
        assert!(apply(&conn, &json!({"type": "routine.pause", "id": 9999, "paused": true}), &agents).is_none());
        assert_eq!(count(&conn), before);
    }
}
