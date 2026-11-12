//! Token usage of the Helpers page (ADR-278 Phase 4, slice 5): today, the last 7 days, the last 90 days, by worker and by
//! model, and the newest runs. A port of `summary` in `services/helpers/src/usage.ts` and `usage` in `island-helpers.ts`.
//! Days are local days of the zone of `now`; sums follow the row order of the TypeScript, so the floats are the same.

use jiff::civil::Date;
use jiff::{Span, Timestamp, Zoned};
use rusqlite::Connection;
use serde_json::{Value, json};

/// The columns the usage summary reads.
pub const SCHEMA: &[(&str, &[&str])] = &[("usage", &["id", "at", "source", "helper", "model", "input", "output", "cache_read", "cache_write", "dollars", "gap_ms"])];

const USAGE_KEEP_DAYS: i64 = 90;
const RECENT_RUNS: i64 = 8;
const COLD_CACHE_RUNS: i64 = 3;
const OVERHEAD_HELPER: &str = "claude-code";

#[derive(Clone, Default)]
struct Totals {
    input: i64,
    output: i64,
    cache_read: i64,
    cache_write: i64,
    dollars: f64,
    runs: i64,
}

impl Totals {
    fn add(&mut self, row: &Totals) {
        self.input += row.input;
        self.output += row.output;
        self.cache_read += row.cache_read;
        self.cache_write += row.cache_write;
        self.dollars += row.dollars;
        self.runs += 1;
    }

    fn tokens(&self) -> i64 {
        self.input + self.output + self.cache_read + self.cache_write
    }

    /// A number as JavaScript prints it: a whole value has no decimal point.
    fn dollars_json(&self) -> Value {
        if self.dollars.fract() == 0.0 && self.dollars.abs() < 1e15 { json!(self.dollars as i64) } else { json!(self.dollars) }
    }

    fn json(&self, extra: &[(&str, Value)]) -> Value {
        let mut v = json!({ "input": self.input, "output": self.output, "cacheRead": self.cache_read, "cacheWrite": self.cache_write, "dollars": self.dollars_json(), "runs": self.runs });
        for (key, value) in extra {
            v[*key] = value.clone();
        }
        v
    }
}

fn local_day(at: &Zoned) -> Date {
    at.date()
}

fn iso(t: Timestamp) -> String {
    t.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// The usage summary. `names` gives a worker's name; `None` when a row is of another shape.
pub fn summary(conn: &Connection, now: &Zoned, name_of: &dyn Fn(&str) -> String) -> Option<Value> {
    let tz = now.time_zone().clone();
    let today = local_day(now);
    let day_before = |n: i64| today.checked_sub(Span::new().days(n)).ok();
    let mut days: Vec<(Date, Totals)> = (0..7).map(|i| Some((day_before(6 - i)?, Totals::default()))).collect::<Option<_>>()?;
    let mut history: Vec<(Date, Totals)> = (0..USAGE_KEEP_DAYS).map(|i| Some((day_before(USAGE_KEEP_DAYS - 1 - i)?, Totals::default()))).collect::<Option<_>>()?;
    let first = iso(history.first()?.0.to_zoned(tz.clone()).ok()?.timestamp());
    let mut week = Totals::default();
    let mut workers: Vec<(Option<String>, Totals)> = Vec::new();
    let mut models: Vec<(String, Totals)> = Vec::new();
    let mut stmt = conn.prepare("SELECT at, helper, source, model, input, output, cache_read, cache_write, dollars FROM usage WHERE at >= ? ORDER BY at").ok()?;
    let rows = stmt
        .query_map([first], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, Totals { input: r.get(4)?, output: r.get(5)?, cache_read: r.get(6)?, cache_write: r.get(7)?, dollars: r.get(8)?, runs: 0 }))
        })
        .ok()?;
    for row in rows {
        let (at, helper, source, model, t) = row.ok()?;
        let day = local_day(&at.parse::<Timestamp>().ok()?.to_zoned(tz.clone()));
        if let Some(h) = history.iter_mut().find(|h| h.0 == day) {
            h.1.add(&t);
        }
        let Some(d) = days.iter_mut().find(|d| d.0 == day) else { continue };
        d.1.add(&t);
        week.add(&t);
        let who = if source == "chat" { None } else { helper };
        match workers.iter_mut().find(|w| w.0 == who) {
            Some(w) => w.1.add(&t),
            None => {
                let mut totals = Totals::default();
                totals.add(&t);
                workers.push((who, totals));
            }
        }
        match models.iter_mut().find(|m| m.0 == model) {
            Some(m) => m.1.add(&t),
            None => {
                let mut totals = Totals::default();
                totals.add(&t);
                models.push((model, totals));
            }
        }
    }
    workers.sort_by_key(|w| std::cmp::Reverse(w.1.tokens()));
    models.sort_by_key(|m| std::cmp::Reverse(m.1.tokens()));
    let with_day = |(d, t): &(Date, Totals)| t.json(&[("day", json!(d.to_string()))]);
    let recent = recent_runs(conn)?;
    let last: Vec<i64> = conn.prepare("SELECT cache_read FROM usage WHERE source = 'chat' ORDER BY id DESC LIMIT ?").ok()?.query_map([COLD_CACHE_RUNS], |r| r.get(0)).ok()?.collect::<Result<_, _>>().ok()?;
    Some(json!({
        "today": with_day(days.last()?),
        "week": week.json(&[]),
        "days": days.iter().map(with_day).collect::<Vec<_>>(),
        "history": history.iter().map(with_day).collect::<Vec<_>>(),
        "byWorker": workers.iter().map(|(h, t)| t.json(&[("helper", json!(h)), ("name", json!(h.as_deref().map_or_else(|| "ARK chat".to_string(), name_of)))])).collect::<Vec<_>>(),
        "byModel": models.iter().map(|(m, t)| t.json(&[("model", json!(m))])).collect::<Vec<_>>(),
        "recent": recent,
        "chatCacheCold": i64::try_from(last.len()).ok()? == COLD_CACHE_RUNS && last.iter().all(|c| *c == 0),
    }))
}

fn recent_runs(conn: &Connection) -> Option<Vec<Value>> {
    let mut stmt = conn.prepare("SELECT at, source, helper, model, input, output, cache_read, cache_write, gap_ms FROM usage ORDER BY id DESC LIMIT ?").ok()?;
    let rows = stmt
        .query_map([RECENT_RUNS], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?, r.get::<_, String>(3)?, r.get::<_, i64>(4)?, r.get::<_, i64>(5)?, r.get::<_, i64>(6)?, r.get::<_, i64>(7)?, r.get::<_, Option<i64>>(8)?))
        })
        .ok()?;
    rows.map(|row| {
        let (at, source, helper, model, input, output, cache_read, cache_write, gap) = row.ok()?;
        let kind = match (source.as_str(), helper.as_deref()) {
            ("job", _) => "job",
            (_, Some("note")) => "note",
            (_, Some(OVERHEAD_HELPER)) => "other",
            _ => "turn",
        };
        let mut v = json!({ "at": at, "kind": kind, "model": model, "input": input, "output": output, "cacheRead": cache_read, "cacheWrite": cache_write });
        if let Some(g) = gap {
            v["gapMs"] = json!(g);
        }
        Some(v)
    })
    .collect()
}
