//! Shared database access (ADR-278 section 5f). Node and Rust both open a database in WAL mode with a busy timeout, so
//! the two writers take turns. Rust checks that the tables it needs exist with the columns it uses; on a mismatch it refuses.

use std::path::Path;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

/// How long a write waits for the other writer (Node uses the same value).
pub const BUSY_TIMEOUT: Duration = Duration::from_millis(5000);

/// Opens `path` for reading and writing. The file must exist (Node owns the schema).
pub fn open_read_write(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    conn.busy_timeout(BUSY_TIMEOUT)?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))?;
    Ok(conn)
}

/// The tables and columns the brain commands use.
pub const BRAIN_SCHEMA: &[(&str, &[&str])] = &[
    ("brain_notes", &["id", "title", "body", "kind", "ref", "ghost", "created_at", "updated_at"]),
    ("brain_links", &["src", "dst", "auto"]),
    ("brain_tags", &["note", "tag"]),
];

/// `Err` names the first missing table or column.
pub fn check_schema(conn: &Connection, expected: &[(&str, &[&str])]) -> Result<(), String> {
    for (table, columns) in expected {
        let have: Vec<String> = conn
            .prepare("SELECT name FROM pragma_table_info(?)")
            .and_then(|mut s| s.query_map([table], |r| r.get::<_, String>(0))?.collect())
            .map_err(|e| e.to_string())?;
        if have.is_empty() {
            return Err(format!("table {table} is missing"));
        }
        if let Some(column) = columns.iter().find(|c| !have.iter().any(|h| h == *c)) {
            return Err(format!("column {table}.{column} is missing"));
        }
    }
    Ok(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("ark-store-{name}-{}.db", std::process::id()));
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", path.display())).ok();
        }
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/brain.db"), &path).unwrap();
        path
    }

    #[test]
    fn the_fixture_has_the_brain_schema_and_a_wrong_one_is_refused() {
        let path = fixture("schema");
        let conn = open_read_write(&path).unwrap();
        assert_eq!(check_schema(&conn, BRAIN_SCHEMA), Ok(()));
        assert_eq!(check_schema(&conn, &[("brain_notes", &["nope"])]), Err("column brain_notes.nope is missing".into()));
        assert_eq!(check_schema(&conn, &[("nothing", &["a"])]), Err("table nothing is missing".into()));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn two_writers_take_turns_and_a_reader_sees_the_change() {
        let path = fixture("writers");
        let a = open_read_write(&path).unwrap();
        let b = open_read_write(&path).unwrap();
        let holder = std::thread::spawn(move || {
            a.execute_batch("BEGIN IMMEDIATE; UPDATE brain_notes SET title = 'A' WHERE id = 1;").unwrap();
            std::thread::sleep(Duration::from_millis(300));
            a.execute_batch("COMMIT").unwrap();
        });
        std::thread::sleep(Duration::from_millis(100));
        // B waits for A's lock (busy timeout) instead of failing at once.
        b.execute("UPDATE brain_notes SET title = 'B' WHERE id = 2", []).unwrap();
        holder.join().unwrap();
        let title: String = b.query_row("SELECT title FROM brain_notes WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "A");
        for ext in ["", "-wal", "-shm"] {
            std::fs::remove_file(format!("{}{ext}", path.display())).ok();
        }
    }
}
