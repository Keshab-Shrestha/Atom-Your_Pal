//! Undo of the file copies of a task (ADR-278 Phase 4): `job.undo` and the removal of the copies of a deleted task. A port of
//! `undo`, `restore` and `drop` in `services/helpers/src/checkpoints.ts` and `undoCheckpoints` in `store-checkpoints.ts`. The copies
//! live in `<checkpoints>/<job>/<n>`. Rust only undoes; Node (or the Rust runner later) makes the copies. A call that would end
//! in a refusal (a changed file, a missing file, a guarded preview row) does nothing here: the caller sends it to Node, which gives
//! the exact words and the exact partial result.

use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Component, Path, PathBuf};

use rusqlite::{Connection, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

use crate::helpers_write::audit_detail;

/// The most links followed when a path ends in links that point at files not made yet.
const MAX_LINK_HOPS: usize = 32;

/// The result of one file (`UndoResult` of the TypeScript).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoResult {
    pub path: String,
    pub result: &'static str,
    pub reason: Option<&'static str>,
}

impl UndoResult {
    pub fn to_json(&self) -> Value {
        match self.reason {
            Some(reason) => json!({ "path": self.path, "result": self.result, "reason": reason }),
            None => json!({ "path": self.path, "result": self.result }),
        }
    }
    /// A file that is back, or one that needed nothing.
    fn is_fine(&self) -> bool {
        matches!(self.result, "restored" | "skipped")
    }
}

#[derive(Debug)]
struct Row {
    id: i64,
    path: String,
    rel: String,
    kind: String,
    state: String,
    reason: Option<String>,
    sha_before: Option<String>,
    sha_after: Option<String>,
    snap: Option<String>,
    guarded: bool,
}

/// `resolve`: the path without `.` and `..` parts.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in p.components() {
        match part {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// `realish`: the real path of `p`, or of its nearest existing ancestor joined with the rest. A dangling link is followed to where it points.
pub fn realish(p: &Path) -> PathBuf {
    realish_hops(p, 0)
}

fn realish_hops(p: &Path, hops: usize) -> PathBuf {
    let mut head = normalize(p);
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(real) = std::fs::canonicalize(&head) {
            return tail.iter().fold(real, |acc, part| acc.join(part));
        }
        if hops < MAX_LINK_HOPS
            && std::fs::symlink_metadata(&head).is_ok_and(|m| m.file_type().is_symlink())
            && let Ok(target) = std::fs::read_link(&head)
        {
            let base = head.parent().unwrap_or(Path::new("/")).join(target);
            return realish_hops(&tail.iter().fold(base, |acc, part| acc.join(part)), hops + 1);
        }
        let (Some(parent), Some(name)) = (head.parent().map(Path::to_path_buf), head.file_name().map(std::ffi::OsStr::to_os_string)) else { return normalize(p) };
        tail.insert(0, name);
        head = parent;
    }
}

fn has_git_part(p: &Path) -> bool {
    p.to_string_lossy().split(['/', '\\']).any(|part| part.eq_ignore_ascii_case(".git"))
}

/// `pathProblem(roots, "/", path, true)`: the path is outside the folders, or it is git's own file.
fn path_problem(roots: &[PathBuf], path: &str) -> bool {
    let real = realish(Path::new(path));
    !roots.iter().any(|root| real.starts_with(root)) || has_git_part(&real)
}

/// SHA-256 of a file in hex, read in chunks.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut chunk = vec![0u8; 64 * 1024];
    loop {
        let n = file.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        hash.update(&chunk[..n]);
    }
    Ok(hash.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn rows(conn: &Connection, job: i64) -> Option<Vec<Row>> {
    let mut stmt = conn.prepare("SELECT id, path, rel, kind, state, reason, sha_before, sha_after, snap, guarded FROM checkpoints WHERE job_id = ? ORDER BY id").ok()?;
    let mapped = stmt
        .query_map([job], |r| Ok(Row { id: r.get(0)?, path: r.get(1)?, rel: r.get(2)?, kind: r.get(3)?, state: r.get(4)?, reason: r.get(5)?, sha_before: r.get(6)?, sha_after: r.get(7)?, snap: r.get(8)?, guarded: r.get::<_, i64>(9)? != 0 }))
        .ok()?;
    mapped.collect::<Result<Vec<_>, _>>().ok()
}

/// `restore`: copies the snapshot beside the file, then renames it over the file, keeping the file's mode. `dry` only checks the snapshot.
fn restore(row: &Row, dir: &Path, job: i64, mode: Option<u32>, dry: bool) -> Result<(), std::io::Error> {
    let snap = dir.join(job.to_string()).join(row.snap.as_deref().unwrap_or(""));
    if !snap.exists() || Some(sha256_file(&snap)?) != row.sha_before {
        return Err(std::io::Error::other("snapshot damaged"));
    }
    if dry {
        return Ok(());
    }
    let temp = Path::new(&row.path).parent().unwrap_or(Path::new("/")).join(format!(".ark-undo-{}-{}", std::process::id(), row.id));
    let copied = std::fs::copy(&snap, &temp).and_then(|_| std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(mode.map_or(0o644, |m| m & 0o7777)))).and_then(|()| std::fs::rename(&temp, &row.path));
    if copied.is_err() {
        std::fs::remove_file(&temp).ok();
    }
    copied
}

/// `undo` of the store: puts files back. `roots` are the folders the task may write now. `dry` changes nothing and says what would happen.
/// `None` for a call this port leaves to Node (a guarded preview row).
pub fn undo(conn: &Connection, dir: &Path, roots: &[PathBuf], job: i64, path: Option<&str>, force: bool, dry: bool) -> Option<Vec<UndoResult>> {
    let roots: Vec<PathBuf> = roots.iter().map(|r| realish(r)).collect();
    let chosen: Vec<Row> = rows(conn, job)?.into_iter().filter(|r| path.map_or(r.state == "ready", |p| r.rel == p)).collect();
    if chosen.iter().any(|r| r.guarded) {
        return None;
    }
    let mut out = Vec::new();
    for row in &chosen {
        let say = |result, reason| UndoResult { path: row.rel.clone(), result, reason };
        if row.state == "undone" {
            out.push(say("skipped", Some("already undone")));
            continue;
        }
        if row.state == "skipped" {
            // The TypeScript says the kept reason; Rust has the text only as a String, so such a call goes to Node.
            if row.reason.is_some() {
                return None;
            }
            out.push(say("skipped", Some("not kept")));
            continue;
        }
        if path_problem(&roots, &row.path) {
            out.push(say("refused", Some("grant revoked")));
            continue;
        }
        let current = std::fs::symlink_metadata(&row.path).ok();
        if current.as_ref().is_some_and(|m| !m.is_file()) {
            out.push(say("refused", Some("not a regular file")));
            continue;
        }
        let now = current.as_ref().and_then(|_| sha256_file(Path::new(&row.path)).ok());
        if current.is_none() {
            if row.kind == "created" {
                out.push(say("missing", Some("already gone")));
                if !dry {
                    mark(conn, row.id, None)?;
                }
                continue;
            }
            if !force {
                out.push(say("missing", Some("the file is gone")));
                continue;
            }
        } else if !force && now != row.sha_after {
            out.push(say("conflict", Some("changed since the run")));
            continue;
        }
        let done = if row.kind == "created" {
            if dry { Ok(()) } else { std::fs::remove_file(&row.path) }
        } else {
            restore(row, dir, job, current.as_ref().map(|m| m.permissions().mode()), dry)
        };
        if let Err(error) = done {
            let reason = if error.kind() == std::io::ErrorKind::NotFound { "the folder is gone" } else { "could not write" };
            out.push(say("refused", Some(reason)));
            continue;
        }
        if !dry {
            let after = if row.kind == "created" { None } else { row.sha_before.as_deref() };
            mark(conn, row.id, after)?;
        }
        out.push(say("restored", None));
    }
    Some(out)
}

/// The row after an undo: "undone", no reason, and "after" is the original hash (none for a created file).
fn mark(conn: &Connection, id: i64, after: Option<&str>) -> Option<()> {
    conn.execute("UPDATE checkpoints SET state = 'undone', reason = NULL, sha_after = ? WHERE id = ?", params![after, id]).ok()?;
    Some(())
}

/// Removes the folder of a task's copies.
pub fn forget_dir(dir: &Path, job: i64) {
    std::fs::remove_dir_all(dir.join(job.to_string())).ok();
}

/// `job.undo` (`undoCheckpoints` and the audit row). `None` when it is for Node: an unknown or running task, or any file that
/// would not come back (Node then does the whole call and says why). Nothing changes in that case.
pub fn undo_job(conn: &Connection, dir: &Path, home: &Path, command: &Value) -> Option<()> {
    let id = command["id"].as_i64()?;
    let (helper, state): (String, String) = conn.query_row("SELECT helper, state FROM jobs WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?))).ok()?;
    if state == "running" {
        return None;
    }
    let mut roots: Vec<PathBuf> = {
        let mut stmt = conn.prepare("SELECT path FROM grants WHERE helper = ?").ok()?;
        stmt.query_map([&helper], |r| r.get::<_, String>(0)).ok()?.filter_map(Result::ok).map(PathBuf::from).collect()
    };
    roots.push(home.to_path_buf()); // ADR-122: agents write anywhere under home, so the undo restores anywhere under home too
    let (path, force) = (command["path"].as_str(), command["force"].as_bool().unwrap_or(false));
    if !undo(conn, dir, &roots, id, path, force, true)?.iter().all(UndoResult::is_fine) {
        return None;
    }
    let results = undo(conn, dir, &roots, id, path, force, false)?;
    if !results.iter().all(UndoResult::is_fine) {
        return None; // a race after the check: Node answers for the rest (the files done read as undone)
    }
    if !results.is_empty() {
        let count = results.iter().filter(|r| r.result == "restored").count();
        audit_detail(conn, "checkpoint", &json!({ "helper": helper, "job": id, "change": "undone", "count": count }))?;
    }
    Some(())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn setup(name: &str) -> (PathBuf, Connection, PathBuf) {
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("ark-ckpt-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("copies/1")).unwrap();
        std::fs::create_dir_all(dir.join("work")).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE checkpoints (id INTEGER PRIMARY KEY, job_id INTEGER, path TEXT, rel TEXT, kind TEXT, state TEXT, reason TEXT, size INTEGER, sha_before TEXT, sha_after TEXT, snap TEXT, guarded INTEGER DEFAULT 0);").unwrap();
        (dir.clone(), conn, dir.join("work"))
    }

    #[test]
    fn it_restores_a_modified_file_and_removes_a_created_one() {
        let (dir, conn, work) = setup("basic");
        std::fs::write(dir.join("copies/1/1"), "old").unwrap();
        std::fs::write(work.join("a.txt"), "new").unwrap();
        std::fs::write(work.join("b.txt"), "made").unwrap();
        let (old, new, made) = (sha256_file(&dir.join("copies/1/1")).unwrap(), sha256_file(&work.join("a.txt")).unwrap(), sha256_file(&work.join("b.txt")).unwrap());
        conn.execute("INSERT INTO checkpoints (job_id, path, rel, kind, state, sha_before, sha_after, snap) VALUES (1, ?, 'a.txt', 'modified', 'ready', ?, ?, '1')", params![work.join("a.txt").to_str().unwrap(), old, new]).unwrap();
        conn.execute("INSERT INTO checkpoints (job_id, path, rel, kind, state, sha_after) VALUES (1, ?, 'b.txt', 'created', 'ready', ?)", params![work.join("b.txt").to_str().unwrap(), made]).unwrap();
        let roots = [work.clone()];
        let dry = undo(&conn, &dir.join("copies"), &roots, 1, None, false, true).unwrap();
        assert!(dry.iter().all(|r| r.result == "restored") && std::fs::read_to_string(work.join("a.txt")).unwrap() == "new", "a dry run changes nothing");
        let got = undo(&conn, &dir.join("copies"), &roots, 1, None, false, false).unwrap();
        assert_eq!(got.iter().map(|r| r.result).collect::<Vec<_>>(), ["restored", "restored"]);
        assert_eq!(std::fs::read_to_string(work.join("a.txt")).unwrap(), "old");
        assert!(!work.join("b.txt").exists());
        let again = undo(&conn, &dir.join("copies"), &roots, 1, Some("a.txt"), false, false).unwrap();
        assert_eq!((again[0].result, again[0].reason), ("skipped", Some("already undone")));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn it_reports_a_conflict_a_missing_file_and_a_revoked_folder() {
        let (dir, conn, work) = setup("refused");
        std::fs::write(dir.join("copies/1/1"), "old").unwrap();
        std::fs::write(work.join("a.txt"), "edited later").unwrap();
        let old = sha256_file(&dir.join("copies/1/1")).unwrap();
        conn.execute("INSERT INTO checkpoints (job_id, path, rel, kind, state, sha_before, sha_after, snap) VALUES (1, ?, 'a.txt', 'modified', 'ready', ?, 'deadbeef', '1')", params![work.join("a.txt").to_str().unwrap(), old]).unwrap();
        conn.execute("INSERT INTO checkpoints (job_id, path, rel, kind, state, sha_before, snap) VALUES (1, ?, 'gone.txt', 'modified', 'ready', ?, '1')", params![work.join("gone.txt").to_str().unwrap(), old]).unwrap();
        let roots = [work.clone()];
        let r = |roots: &[PathBuf], force| undo(&conn, &dir.join("copies"), roots, 1, None, force, true).unwrap().iter().map(|r| (r.result, r.reason.unwrap_or(""))).collect::<Vec<_>>();
        assert_eq!(r(&roots, false), [("conflict", "changed since the run"), ("missing", "the file is gone")]);
        assert_eq!(r(&roots, true), [("restored", ""), ("restored", "")], "force restores both");
        assert_eq!(r(&[dir.join("elsewhere")], false), [("refused", "grant revoked"), ("refused", "grant revoked")]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn the_command_undoes_an_ended_task_and_leaves_a_running_or_refused_one_to_node() {
        let (dir, conn, work) = setup("command");
        conn.execute_batch("CREATE TABLE jobs (id INTEGER PRIMARY KEY, helper TEXT, state TEXT); CREATE TABLE grants (helper TEXT, path TEXT); CREATE TABLE audit_log (id INTEGER PRIMARY KEY, at TEXT, action TEXT, detail TEXT); INSERT INTO jobs VALUES (1, 'sid', 'done'), (2, 'sid', 'running');").unwrap();
        std::fs::write(dir.join("copies/1/1"), "old").unwrap();
        std::fs::write(work.join("a.txt"), "new").unwrap();
        let (old, new) = (sha256_file(&dir.join("copies/1/1")).unwrap(), sha256_file(&work.join("a.txt")).unwrap());
        conn.execute("INSERT INTO checkpoints (job_id, path, rel, kind, state, sha_before, sha_after, snap) VALUES (1, ?, 'a.txt', 'modified', 'ready', ?, ?, '1')", params![work.join("a.txt").to_str().unwrap(), old, new]).unwrap();
        assert!(undo_job(&conn, &dir.join("copies"), &dir, &json!({"type": "job.undo", "id": 2})).is_none(), "a running task goes to Node");
        undo_job(&conn, &dir.join("copies"), &dir, &json!({"type": "job.undo", "id": 1})).unwrap();
        assert_eq!(std::fs::read_to_string(work.join("a.txt")).unwrap(), "old");
        let detail: String = conn.query_row("SELECT detail FROM audit_log WHERE action = 'checkpoint'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&detail).unwrap(), json!({"helper": "sid", "job": 1, "change": "undone", "count": 1}));
        std::fs::write(work.join("a.txt"), "edited").unwrap();
        conn.execute("UPDATE checkpoints SET state = 'ready', sha_after = 'x'", []).unwrap();
        assert!(undo_job(&conn, &dir.join("copies"), &dir, &json!({"type": "job.undo", "id": 1})).is_none(), "a conflict goes to Node");
        assert_eq!(std::fs::read_to_string(work.join("a.txt")).unwrap(), "edited", "and changes nothing");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
