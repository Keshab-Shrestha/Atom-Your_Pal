//! Deleting a chat (ADR-278 Phase 3): the same rows Node's `forgetChat` and `chats.remove` clear, in one transaction,
//! plus the chat's attachment folder. Used only when Rust owns the stores (native mode).

use std::path::Path;

use rusqlite::{Connection, params};

/// The owner column Node writes for the one local user.
const LOCAL_OWNER: &str = "local";

fn table_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row("SELECT 1 FROM sqlite_master WHERE name = ?", [name], |_| Ok(())).is_ok()
}

/// Runs `sql` with `args` when `table` exists (a store Node never opened has no table).
fn run(conn: &Connection, table: &str, sql: &str, args: impl rusqlite::Params) -> rusqlite::Result<usize> {
    if table_exists(conn, table) { conn.execute(sql, args) } else { Ok(0) }
}

/// Removes the chat, its messages, settings, kept copy, summaries, recall receipts and session note, and its files.
/// `Ok(false)` when no chat had this id.
pub fn delete_chat(conn: &Connection, attachments: &Path, id: &str) -> rusqlite::Result<bool> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = (|| {
        // The kept copy (`chat-index.ts`): words first, since they are found through the sections and lines.
        run(conn, "kept_fts", "DELETE FROM kept_fts WHERE level = 3 AND ref IN (SELECT CAST(l.id AS TEXT) FROM kept_lines l JOIN kept_sections s ON s.id = l.section_id WHERE s.chat_id = ?)", [id])?;
        run(conn, "kept_lines", "DELETE FROM kept_lines WHERE section_id IN (SELECT id FROM kept_sections WHERE chat_id = ?)", [id])?;
        run(conn, "kept_fts", "DELETE FROM kept_fts WHERE level = 2 AND ref IN (SELECT CAST(id AS TEXT) FROM kept_sections WHERE chat_id = ?)", [id])?;
        run(conn, "kept_sections", "DELETE FROM kept_sections WHERE chat_id = ?", [id])?;
        run(conn, "kept_fts", "DELETE FROM kept_fts WHERE level = 1 AND ref = ?", [id])?;
        run(conn, "kept_chats", "DELETE FROM kept_chats WHERE chat_id = ?", [id])?;
        run(conn, "chat_recall_receipts", "DELETE FROM chat_recall_receipts WHERE owner = ? AND chat = ?", params![LOCAL_OWNER, id])?;
        run(conn, "episodes", "DELETE FROM episodes WHERE owner = ? AND session_id = ?", params![LOCAL_OWNER, id])?;
        // The chat (`chats.remove`). The triggers also clear access, reasoning and continuity; Node deletes them by hand too.
        run(conn, "chat_navigation", "DELETE FROM chat_navigation WHERE chat_id = ?", [id])?;
        run(conn, "chat_messages", "DELETE FROM chat_messages WHERE chat_id = ?", [id])?;
        run(conn, "pending_chat_models", "DELETE FROM pending_chat_models WHERE chat_id = ?", [id])?;
        run(conn, "chat_access", "DELETE FROM chat_access WHERE chat_id = ?", [id])?;
        run(conn, "chat_reasoning", "DELETE FROM chat_reasoning WHERE chat_id = ?", [id])?;
        run(conn, "chat_continuity", "DELETE FROM chat_continuity WHERE chat_id = ?", [id])?;
        run(conn, "chats", "DELETE FROM chats WHERE id = ?", [id])
    })();
    match result {
        Ok(changed) => {
            conn.execute_batch("COMMIT")?;
            remove_files(attachments, id);
            Ok(changed > 0)
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK").ok();
            Err(e)
        }
    }
}

/// `attachments.ts` `folder`: the id with every character outside `[A-Za-z0-9_-]` replaced by `_`; an empty id gets `_`.
pub fn attachment_folder(root: &Path, id: &str) -> std::path::PathBuf {
    let name: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
    root.join(if name.is_empty() { "_" } else { &name })
}

fn remove_files(root: &Path, id: &str) {
    std::fs::remove_dir_all(attachment_folder(root, id)).ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deleting_a_chat_clears_every_store_and_keeps_the_others() {
        let dir = std::env::temp_dir().join(format!("ark-chat-del-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(dir.join("attachments/a-1")).unwrap();
        std::fs::write(dir.join("attachments/a-1/f.txt"), "x").unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT); CREATE TABLE chat_messages (chat_id TEXT, seq INTEGER, role TEXT, content TEXT);
             CREATE TABLE kept_chats (chat_id TEXT PRIMARY KEY); CREATE TABLE kept_sections (id INTEGER PRIMARY KEY, chat_id TEXT);
             CREATE TABLE kept_lines (id INTEGER PRIMARY KEY, section_id INTEGER); CREATE VIRTUAL TABLE kept_fts USING fts5(text, level UNINDEXED, ref UNINDEXED);
             CREATE TABLE chat_recall_receipts (owner TEXT, chat TEXT); CREATE TABLE episodes (owner TEXT, session_id TEXT);
             INSERT INTO chats VALUES ('a-1','A'),('b-2','B'); INSERT INTO chat_messages VALUES ('a-1',0,'user','hi'),('b-2',0,'user','yo');
             INSERT INTO kept_chats VALUES ('a-1'),('b-2'); INSERT INTO kept_sections VALUES (1,'a-1'),(2,'b-2'); INSERT INTO kept_lines VALUES (1,1),(2,2);
             INSERT INTO kept_fts VALUES ('w',1,'a-1'),('w',2,'1'),('w',3,'1'),('w',1,'b-2'),('w',2,'2'),('w',3,'2');
             INSERT INTO chat_recall_receipts VALUES ('local','a-1'),('local','b-2'); INSERT INTO episodes VALUES ('local','a-1'),('local','b-2');",
        )
        .unwrap();
        assert!(delete_chat(&conn, &dir.join("attachments"), "a-1").unwrap());
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        for table in ["chats", "chat_messages", "kept_chats", "kept_sections", "kept_lines", "kept_fts", "chat_recall_receipts", "episodes"] {
            assert_eq!(count(&format!("SELECT COUNT(*) FROM {table}")), 1, "{table} keeps only the other chat");
        }
        assert!(!dir.join("attachments/a-1").exists());
        assert!(!delete_chat(&conn, &dir.join("attachments"), "a-1").unwrap(), "a second delete finds nothing");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn the_folder_name_matches_typescript() {
        assert_eq!(attachment_folder(Path::new("/r"), "a/b c"), Path::new("/r/a_b_c"));
        assert_eq!(attachment_folder(Path::new("/r"), ""), Path::new("/r/_"));
    }
}
