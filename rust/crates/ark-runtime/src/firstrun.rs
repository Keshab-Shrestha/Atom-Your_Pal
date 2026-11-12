//! First run on a clean Mac, with no Node to make the files (ADR-278 Phase 4): the data folders, `memory.db` and `helpers.db`
//! with the schema of the TypeScript stores (`schema/*.sql` come from `.schema` of the stores' own files, and a test compares
//! them), the built-in souls, and `ui-state.json`. A file that exists is never touched.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

const MEMORY_SCHEMA: &str = include_str!("../schema/memory.sql");
const HELPERS_SCHEMA: &str = include_str!("../schema/helpers.sql");
/// The first `ui-state.json`: the Settings default until the user picks a model.
const UI_STATE: &str = r#"{"current":{"provider":"claude-plan","model":"claude-sonnet-5-5"},"reasoning":[],"projects":[]}"#;

fn make_db(path: &Path, schema: &str, seed: impl FnOnce(&Connection) -> rusqlite::Result<()>) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    let conn = Connection::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(())).map_err(|e| e.to_string())?;
    conn.execute_batch(schema).and_then(|()| seed(&conn)).map_err(|e| format!("{}: {e}", path.display()))
}

/// Makes what is missing under `folder`. `memory` and `helpers` are the file paths (relative to `folder`, as the environment gives them).
pub fn ensure(folder: &Path, memory: &str, helpers: &str) -> Result<(), String> {
    let (memory, helpers): (PathBuf, PathBuf) = (folder.join(memory), folder.join(helpers));
    for file in [&memory, &helpers] {
        let dir = file.parent().unwrap_or(folder);
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    let agents = helpers.parent().unwrap_or(folder).join("agents");
    std::fs::create_dir_all(&agents).map_err(|e| format!("{}: {e}", agents.display()))?;
    make_db(&memory, MEMORY_SCHEMA, |_| Ok(()))?;
    make_db(&helpers, HELPERS_SCHEMA, crate::helpers_roster::seed_souls)?;
    let ui = memory.parent().unwrap_or(folder).join("ui-state.json");
    if !ui.exists() {
        std::fs::write(&ui, UI_STATE).map_err(|e| format!("{}: {e}", ui.display()))?;
    }
    Ok(())
}

/// `ensure` with the paths of the environment (`ARK_MEMORY_FILE`, `ARK_HELPERS_FILE`; the defaults of `native.rs`).
pub fn ensure_from_environment(folder: &Path, env: impl Fn(&str) -> Option<String>) -> Result<(), String> {
    let memory = ["ARK_MEMORY_FILE", "ATOM_MEMORY_FILE", "ZENO_MEMORY_FILE"].iter().find_map(|n| env(n)).unwrap_or_else(|| "data/memory.db".into());
    ensure(folder, &memory, &env("ARK_HELPERS_FILE").unwrap_or_else(|| "data/helpers.db".into()))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn shape(path: &Path) -> Vec<(String, String, String)> {
        let conn = Connection::open(path).unwrap();
        let mut stmt = conn.prepare("SELECT type, name, COALESCE(sql, '') FROM sqlite_master ORDER BY type, name").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect()
    }

    #[test]
    fn an_empty_folder_gets_the_files_and_the_same_shape_as_the_typescript_stores() {
        let dir = std::env::temp_dir().join(format!("ark-firstrun-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        ensure_from_environment(&dir, |_| None).unwrap();
        let fixtures = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
        assert_eq!(shape(&dir.join("data/memory.db")), shape(&Path::new(fixtures).join("memory.db")));
        assert_eq!(shape(&dir.join("data/helpers.db")), shape(&Path::new(fixtures).join("helpers/helpers.db")));
        assert!(dir.join("data/agents").is_dir());
        assert!(crate::chats::UiState::read(&dir.join("data/ui-state.json")).is_some());
        let helpers = Connection::open(dir.join("data/helpers.db")).unwrap();
        assert_eq!(helpers.query_row("SELECT COUNT(*) FROM souls", [], |r| r.get::<_, i64>(0)).unwrap(), 7);
        assert!(crate::helpers_roster::roster(&helpers, &dir.join("data/agents")).is_some(), "the team reads from the new file");
        // A second run changes nothing.
        helpers.execute("UPDATE souls SET lessons = 'kept' WHERE helper = 'sid'", []).unwrap();
        ensure_from_environment(&dir, |_| None).unwrap();
        assert_eq!(helpers.query_row("SELECT lessons FROM souls WHERE helper = 'sid'", [], |r| r.get::<_, String>(0)).unwrap(), "kept");
    }
}
