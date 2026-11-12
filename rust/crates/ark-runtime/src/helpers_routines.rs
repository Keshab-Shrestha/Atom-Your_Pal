//! Routines of the Helpers page (ADR-278 Phase 4, slice 2): the schedule text and the next time each one comes due.
//! A port of `describeSchedule`, `nextDue` and `lastDue` in `services/helpers/src/routines.ts`, and of the routine
//! part of `list` in `apps/mac/src/island-helpers.ts`. Times of a daily or weekly routine are in the local zone.

use jiff::{Span, Timestamp, Zoned};
use rusqlite::Connection;
use serde_json::{Map, Value, json};

/// The columns the routines read.
pub const SCHEMA: &[(&str, &[&str])] =
    &[("routines", &["id", "helper", "task", "schedule", "created_at", "last_at", "last_task_id", "last_skipped", "paused", "resumed_at", "notify_telegram", "webhook"])];

const HOUR_MS: i64 = 3_600_000;
const WEEKDAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/// The three shapes of a schedule.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Schedule {
    Daily { minute: i64 },
    Weekly { weekday: i64, minute: i64 },
    Hours { every: i64 },
}

impl Schedule {
    /// The stored JSON (`{"kind":"daily","minute":485}`), or `None` for any other shape.
    pub fn from_json(value: &Value) -> Option<Schedule> {
        let int = |key: &str| value.get(key).and_then(Value::as_i64);
        match value.get("kind")?.as_str()? {
            "daily" => Some(Schedule::Daily { minute: int("minute")? }),
            "weekly" => Some(Schedule::Weekly { weekday: int("weekday")?, minute: int("minute")? }),
            "hours" => Some(Schedule::Hours { every: int("every")? }),
            _ => None,
        }
    }
}

/// `8:05 AM`, `12:00 PM`.
fn clock(minute: i64) -> String {
    let h = minute / 60;
    let twelve = if h % 12 == 0 { 12 } else { h % 12 };
    format!("{twelve}:{:02} {}", minute % 60, if h < 12 { "AM" } else { "PM" })
}

/// "Every day at 8:00 AM", "Every Monday at 9:30 AM", "Every 3 hours".
pub fn describe_schedule(s: &Schedule) -> Option<String> {
    Some(match *s {
        Schedule::Hours { every: 1 } => "Every hour".into(),
        Schedule::Hours { every } => format!("Every {every} hours"),
        Schedule::Daily { minute } => format!("Every day at {}", clock(minute)),
        Schedule::Weekly { weekday, minute } => format!("Every {} at {}", WEEKDAYS.get(usize::try_from(weekday).ok()?)?, clock(minute)),
    })
}

/// The latest time a daily or weekly schedule came due at or before `to` (`lastDue`).
fn last_due_local(s: &Schedule, to: &Zoned) -> Option<Zoned> {
    let (minute, weekday) = match *s {
        Schedule::Daily { minute } => (minute, None),
        Schedule::Weekly { weekday, minute } => (minute, Some(weekday)),
        Schedule::Hours { .. } => return None,
    };
    let at = to.with().hour(i8::try_from(minute / 60).ok()?).minute(i8::try_from(minute % 60).ok()?).second(0).subsec_nanosecond(0).build().ok()?;
    let later = at > *to;
    let back = match weekday {
        None => i64::from(later),
        Some(w) => {
            let diff = (i64::from(at.weekday().to_sunday_zero_offset()) - w + 7) % 7;
            if diff != 0 { diff } else if later { 7 } else { 0 }
        }
    };
    at.checked_sub(Span::new().days(back)).ok()
}

/// The first time the schedule comes due after `from` (`nextDue`); `created_at` anchors an hourly one.
pub fn next_due(s: &Schedule, created_at: Timestamp, from: &Zoned) -> Option<Timestamp> {
    if let Schedule::Hours { every } = *s {
        let period = every.checked_mul(HOUR_MS)?;
        let k = ((from.timestamp().as_millisecond() - created_at.as_millisecond()).div_euclid(period)).max(0);
        return Timestamp::from_millisecond(created_at.as_millisecond().checked_add((k + 1).checked_mul(period)?)?).ok();
    }
    let at = last_due_local(s, from)?;
    let days = if matches!(s, Schedule::Daily { .. }) { 1 } else { 7 };
    Some(at.checked_add(Span::new().days(days)).ok()?.timestamp())
}

/// `toISOString`.
pub fn iso(t: Timestamp) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// The routines of one worker as the window gets them (oldest first). `None` for a row of another shape.
pub fn routines_of(conn: &Connection, helper: &str, now: &Zoned) -> Option<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT id, task, schedule, created_at, last_at, last_skipped, paused, notify_telegram, webhook FROM routines WHERE helper = ? ORDER BY id").ok()?;
    let rows = stmt
        .query_map([helper], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, i64>(5)?, r.get::<_, Option<i64>>(6)?, r.get::<_, Option<i64>>(7)?, r.get::<_, Option<i64>>(8)?))
        })
        .ok()?;
    let mut out = Vec::new();
    for row in rows {
        let (id, task, schedule_text, created_at, last_at, last_skipped, paused, notify, webhook) = row.ok()?;
        let schedule_json: Value = serde_json::from_str(&schedule_text).ok()?;
        let schedule = Schedule::from_json(&schedule_json)?;
        let mut view = Map::new();
        view.insert("id".into(), json!(id));
        view.insert("task".into(), json!(task));
        view.insert("when".into(), json!(describe_schedule(&schedule)?));
        view.insert("schedule".into(), schedule_json);
        if let Some(at) = last_at.filter(|a| !a.is_empty()) {
            view.insert("lastAt".into(), json!(iso(at.parse().ok()?)));
        }
        if last_skipped == 1 {
            view.insert("lastSkipped".into(), json!(true));
        }
        if paused == Some(1) {
            view.insert("paused".into(), json!(true));
        } else {
            view.insert("nextAt".into(), json!(iso(next_due(&schedule, created_at.parse().ok()?, now)?)));
        }
        if notify == Some(1) {
            view.insert("notifyTelegram".into(), json!(true));
        }
        if webhook == Some(1) {
            view.insert("webhook".into(), json!(true));
        }
        out.push(Value::Object(view));
    }
    Some(out)
}
