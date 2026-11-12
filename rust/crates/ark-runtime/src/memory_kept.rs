//! `memory.dropChat` (ADR-278 Phase 3): a port of `drop` in `services/memory/src/chat-index.ts`. The chat's kept summary, sections, lines
//! and words go in one transaction. `memory.keepChat` stays in Node: it asks the model for a digest and may make vectors.

use std::path::Path;

use rusqlite::Connection;

use crate::store;

const STEPS: [&str; 6] = [
    "DELETE FROM kept_fts WHERE level = 3 AND ref IN (SELECT CAST(l.id AS TEXT) FROM kept_lines l JOIN kept_sections s ON s.id = l.section_id WHERE s.chat_id = ?1)",
    "DELETE FROM kept_lines WHERE section_id IN (SELECT id FROM kept_sections WHERE chat_id = ?1)",
    "DELETE FROM kept_fts WHERE level = 2 AND ref IN (SELECT CAST(id AS TEXT) FROM kept_sections WHERE chat_id = ?1)",
    "DELETE FROM kept_sections WHERE chat_id = ?1",
    "DELETE FROM kept_fts WHERE level = 1 AND ref = ?1",
    "DELETE FROM kept_chats WHERE chat_id = ?1",
];

/// `Ok(true)` when the chat was kept and is dropped. `Ok(false)` when it was not kept (Node says so to the app).
pub fn drop_chat_in(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    conn.execute_batch("BEGIN")?;
    let done = STEPS.iter().try_fold(0, |_, sql| conn.execute(sql, [id]));
    match done {
        Ok(removed) => conn.execute_batch("COMMIT").map(|()| removed > 0),
        Err(e) => {
            conn.execute_batch("ROLLBACK")?;
            Err(e)
        }
    }
}

pub fn drop_chat(db: &Path, id: &str) -> Result<bool, String> {
    let conn = store::open_read_write(db).map_err(|e| e.to_string())?;
    drop_chat_in(&conn, id).map_err(|e| e.to_string())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn it_drops_one_kept_chat_with_its_parts_and_says_false_for_a_chat_that_is_not_kept() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE kept_chats (chat_id TEXT PRIMARY KEY); CREATE TABLE kept_sections (id INTEGER PRIMARY KEY, chat_id TEXT);
             CREATE TABLE kept_lines (id INTEGER PRIMARY KEY, section_id INTEGER); CREATE VIRTUAL TABLE kept_fts USING fts5(text, level UNINDEXED, ref UNINDEXED);
             INSERT INTO kept_chats VALUES ('a'),('b'); INSERT INTO kept_sections VALUES (1,'a'),(2,'b'); INSERT INTO kept_lines VALUES (1,1),(2,2);
             INSERT INTO kept_fts VALUES ('w',1,'a'),('w',2,'1'),('w',3,'1'),('w',1,'b'),('w',2,'2'),('w',3,'2');",
        )
        .unwrap();
        assert!(drop_chat_in(&conn, "a").unwrap());
        assert!(!drop_chat_in(&conn, "a").unwrap());
        let count = |t: &str| conn.query_row::<i64, _, _>(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap();
        assert_eq!((count("kept_chats"), count("kept_sections"), count("kept_lines"), count("kept_fts")), (1, 1, 1, 3));
    }
}
