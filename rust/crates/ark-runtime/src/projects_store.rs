//! The project rows (ADR-278 Phase 3): a port of `openProjects` in `services/memory/src/projects.ts` for rename, archive, web and the
//! model reset. Same table, same rules and the same messages. Adding and removing a project need folder grants and the project's Agent,
//! so Node still does those.

use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

const MAX_PROJECTS: i64 = 20;
const NO_PROJECT: &str = "There is no such project.";

fn now() -> String {
    jiff::Timestamp::now().strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// `cleanProjectName`: one line, not empty.
pub fn clean_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("The project needs a name.".into());
    }
    if name.chars().any(|c| matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}' | '\u{2028}' | '\u{2029}')) {
        return Err("A project name is one line.".into());
    }
    Ok(name.to_string())
}

fn db_error(e: rusqlite::Error) -> String {
    format!("That did not work. Try again. ({e})")
}

fn update(conn: &Connection, set: &str, args: &[&dyn rusqlite::ToSql]) -> Result<(), String> {
    let changed = conn.execute(&format!("UPDATE projects SET {set}, updated_at = ? WHERE id = ?"), args).map_err(db_error)?;
    if changed > 0 { Ok(()) } else { Err(NO_PROJECT.into()) }
}

pub fn rename(conn: &Connection, id: &str, raw: &str) -> Result<(), String> {
    let name = clean_name(raw)?;
    let taken: Option<String> = conn.query_row("SELECT id FROM projects WHERE lower(name) = lower(?) AND id <> ?", [&name, id], |r| r.get(0)).optional().map_err(db_error)?;
    if taken.is_some() {
        return Err("Another project has that name.".into());
    }
    update(conn, "name = ?", &[&name, &now(), &id])
}

pub fn archive(conn: &Connection, id: &str, archived: bool) -> Result<(), String> {
    let row: Option<i64> = conn.query_row("SELECT archived FROM projects WHERE id = ?", [id], |r| r.get(0)).optional().map_err(db_error)?;
    if row == Some(1) && !archived {
        let open: i64 = conn.query_row("SELECT COUNT(*) FROM projects WHERE archived = 0", [], |r| r.get(0)).map_err(db_error)?;
        if open >= MAX_PROJECTS {
            return Err(format!("There are already {MAX_PROJECTS} projects. Archive or remove one first."));
        }
    }
    update(conn, "archived = ?", &[&i64::from(archived), &now(), &id])
}

pub fn set_web(conn: &Connection, id: &str, web: bool) -> Result<(), String> {
    update(conn, "web = ?", &[&i64::from(web), &now(), &id])
}

/// The model goes back to the global one.
pub fn clear_model(conn: &Connection, id: &str) -> Result<(), String> {
    update(conn, "provider = NULL, model = NULL", &[&now(), &id])
}

/// Puts the live rows into the project items Node wrote (its folder label, missing flag and Agent stay): name, archived, web, model and chat count.
pub fn refresh(conn: &Connection, items: &[Value]) -> Vec<Value> {
    items
        .iter()
        .map(|item| {
            let Some(id) = item["id"].as_str() else { return item.clone() };
            let row = conn
                .query_row(
                    "SELECT name, archived, web, provider, model, (SELECT COUNT(*) FROM chats c WHERE c.project_id = projects.id) FROM projects WHERE id = ?",
                    params![id],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, i64>(5)?)),
                )
                .optional()
                .ok()
                .flatten();
            let (Some((name, archived, web, provider, model, count)), Some(fields)) = (row, item.as_object()) else { return item.clone() };
            let mut fields = fields.clone();
            fields.insert("name".into(), json!(name));
            fields.insert("archived".into(), json!(archived == 1));
            fields.insert("web".into(), json!(web == 1));
            fields.insert("chatCount".into(), json!(count));
            match (provider, model) {
                (Some(p), Some(m)) => {
                    fields.insert("provider".into(), json!(p));
                    fields.insert("model".into(), json!(m));
                }
                _ => {
                    fields.remove("provider");
                    fields.remove("model");
                }
            }
            Value::Object(fields)
        })
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, folders TEXT NOT NULL, helper TEXT, provider TEXT, model TEXT, kit TEXT NOT NULL DEFAULT 'folders', web INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE chats (id TEXT PRIMARY KEY, project_id TEXT);
             INSERT INTO projects (id, name, folders, provider, model, created_at, updated_at) VALUES ('p-1','Alpha','[]','claude','x','t','t'),('p-2','Beta','[]',NULL,NULL,'t','t');
             INSERT INTO chats VALUES ('c1','p-1'),('c2','p-1');",
        )
        .unwrap();
        conn
    }

    #[test]
    fn rename_archive_web_and_model_follow_the_typescript_rules() {
        let conn = db();
        assert_eq!(rename(&conn, "p-1", "  "), Err("The project needs a name.".into()));
        assert_eq!(rename(&conn, "p-1", "a\nb"), Err("A project name is one line.".into()));
        assert_eq!(rename(&conn, "p-1", "BETA"), Err("Another project has that name.".into()));
        assert_eq!(rename(&conn, "p-9", "New"), Err(NO_PROJECT.into()));
        assert_eq!(rename(&conn, "p-1", " ALPHA "), Ok(()), "its own name, other case, is free");
        assert!(archive(&conn, "p-2", true).is_ok() && set_web(&conn, "p-2", true).is_ok() && clear_model(&conn, "p-1").is_ok());
        let items = refresh(&conn, &[json!({"id":"p-1","name":"x","folderLabel":"~/a","missing":false,"archived":false,"chatCount":0,"web":false,"provider":"claude","model":"x"}), json!({"id":"p-2","folderLabel":"~/b"})]);
        assert_eq!((items[0]["name"].clone(), items[0]["chatCount"].clone(), items[0]["folderLabel"].clone()), (json!("ALPHA"), json!(2), json!("~/a")));
        assert!(items[0].get("provider").is_none(), "the model is cleared");
        assert_eq!((items[1]["archived"].clone(), items[1]["web"].clone()), (json!(true), json!(true)));
    }

    #[test]
    fn unarchiving_with_twenty_open_projects_is_refused() {
        let conn = db();
        for i in 0..20 {
            conn.execute("INSERT INTO projects (id, name, folders, created_at, updated_at) VALUES (?, ?, '[]', 't', 't')", params![format!("q-{i}"), format!("Q{i}")]).unwrap();
        }
        archive(&conn, "p-2", true).unwrap();
        assert!(archive(&conn, "p-2", false).unwrap_err().contains("20 projects"));
    }
}
