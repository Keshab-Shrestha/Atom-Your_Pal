//! The change bus of the Helpers store (ADR-278 Phase 4, step 1). Port of `HelperStore.onChange`: a listener hears every
//! change as `{"action": ..., "helper": ..., "job": ...}`. Two sources feed it:
//! - `Tail` reads the rows that the audit log gained since the last poll. Node writes them and so do the Rust writes, so a
//!   listener hears both. Every audited change comes this way, and only this way (never twice).
//! - `Bus::emit` is for the noisy kinds that the audit log skips (`step`, `toolCall`, `usage`, `checkpoint`, `settings`).

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use serde_json::{Map, Value};

/// A change, as the TypeScript `HelperChange` reads in JSON.
pub type Change = Value;

type Listener = Arc<dyn Fn(&Change) + Send + Sync>;

/// The kinds that the audit log does not keep (`SKIPPED` in `audit.ts`).
pub const NOT_AUDITED: [&str; 5] = ["step", "usage", "toolCall", "checkpoint", "settings"];

/// The listeners. A listener that panics does not stop the others.
#[derive(Default)]
pub struct Bus {
    listeners: Mutex<Vec<(u64, Listener)>>,
    next: Mutex<u64>,
}

impl std::fmt::Debug for Bus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Bus")
    }
}

impl Bus {
    /// Adds a listener; the number it returns goes to `unsubscribe`.
    pub fn subscribe(&self, listener: impl Fn(&Change) + Send + Sync + 'static) -> u64 {
        let (Ok(mut next), Ok(mut all)) = (self.next.lock(), self.listeners.lock()) else { return 0 };
        *next += 1;
        all.push((*next, Arc::new(listener)));
        *next
    }

    pub fn unsubscribe(&self, id: u64) {
        if let Ok(mut all) = self.listeners.lock() {
            all.retain(|(i, _)| *i != id);
        }
    }

    /// Tells every listener. The listeners run outside the lock, so one may subscribe or emit again.
    pub fn emit(&self, change: &Change) {
        let all: Vec<Listener> = self.listeners.lock().map(|l| l.iter().map(|(_, f)| f.clone()).collect()).unwrap_or_default();
        for listener in all {
            if catch_unwind(AssertUnwindSafe(|| listener(change))).is_err() {
                continue; // a bad listener is skipped, the next one still hears
            }
        }
    }
}

/// Follows the audit log: the rows after the last one seen.
#[derive(Debug, Default)]
pub struct Tail {
    last: Option<i64>,
}

impl Tail {
    /// Sends the new rows to `bus` and gives how many. The first call only remembers where the log ends.
    pub fn poll(&mut self, conn: &Connection, bus: &Bus) -> usize {
        let Some(last) = self.last else {
            self.last = conn.query_row("SELECT COALESCE(MAX(id), 0) FROM audit_log", [], |r| r.get(0)).ok();
            return 0;
        };
        let Ok(mut stmt) = conn.prepare("SELECT id, action, detail FROM audit_log WHERE id > ? ORDER BY id") else { return 0 };
        let rows: Vec<(i64, String, String)> = match stmt.query_map([last], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))) {
            Ok(rows) => rows.flatten().collect(),
            Err(_) => return 0,
        };
        for (id, action, detail) in &rows {
            self.last = Some(*id);
            let mut change: Map<String, Value> = serde_json::from_str(detail).unwrap_or_default();
            change.insert("action".into(), Value::String(action.clone()));
            bus.emit(&Value::Object(change));
        }
        rows.len()
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL)").unwrap();
        conn
    }

    fn row(conn: &Connection, action: &str, detail: &str) {
        conn.execute("INSERT INTO audit_log (at, action, detail) VALUES ('t', ?, ?)", [action, detail]).unwrap();
    }

    #[test]
    fn it_gives_each_new_audit_row_once_and_skips_the_old_ones() {
        let conn = db();
        row(&conn, "job", r#"{"helper":"a","job":1,"state":"queued"}"#);
        let (bus, mut tail) = (Bus::default(), Tail::default());
        let heard = Arc::new(Mutex::new(Vec::<Change>::new()));
        let sink = heard.clone();
        let id = bus.subscribe(move |c| sink.lock().unwrap().push(c.clone()));
        assert_eq!(tail.poll(&conn, &bus), 0, "the first poll only marks the end");
        row(&conn, "job", r#"{"helper":"a","job":2,"state":"running"}"#);
        row(&conn, "deleted", r#"{"helper":"a","job":1}"#);
        assert_eq!(tail.poll(&conn, &bus), 2);
        assert_eq!(tail.poll(&conn, &bus), 0, "no row twice");
        let heard_now = heard.lock().unwrap().clone();
        assert_eq!(heard_now[0], serde_json::json!({"action":"job","helper":"a","job":2,"state":"running"}));
        assert_eq!(heard_now[1]["action"], "deleted");
        bus.unsubscribe(id);
        row(&conn, "plan", "{}");
        tail.poll(&conn, &bus);
        assert_eq!(heard.lock().unwrap().len(), 2, "an unsubscribed listener hears nothing");
    }

    #[test]
    fn a_listener_that_panics_does_not_stop_the_next_one() {
        let bus = Bus::default();
        let count = Arc::new(AtomicUsize::new(0));
        bus.subscribe(|_| panic!("bad listener"));
        let c = count.clone();
        bus.subscribe(move |_| {
            c.fetch_add(1, Ordering::SeqCst);
        });
        bus.emit(&serde_json::json!({"action": "step", "helper": "a", "job": 1}));
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }
}
