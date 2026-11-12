//! The disk-reading half of the file policy: `realish` and `floorProblem` of services/helpers/src/grants.ts
//! (ADR-122, read side). The pure parts come from `ark_core::policy`.

use std::path::{Component, Path, PathBuf};

use ark_core::policy::{DENY_READ_DIRS, expand_home, has_git_part, is_important_name, is_inside};

const MAX_LINK_HOPS: usize = 40;

/// `path.resolve`: absolute, with `.` and `..` folded, no disk access.
fn resolve(base: &Path, p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for part in base.join(p).components() {
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

/// The real path of `p` even when its tail does not exist yet: the longest existing head is resolved (links too), the rest is appended.
pub fn realish(p: &Path) -> PathBuf {
    realish_hops(&resolve(Path::new("/"), p), 0)
}

fn realish_hops(p: &Path, hops: usize) -> PathBuf {
    let mut head = p.to_path_buf();
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    loop {
        if let Ok(real) = std::fs::canonicalize(&head) {
            return tail.iter().rev().fold(real, |acc, name| acc.join(name));
        }
        if hops < MAX_LINK_HOPS
            && let Ok(target) = std::fs::read_link(&head)
        {
            let base = head.parent().unwrap_or(Path::new("/"));
            let next = tail.iter().rev().fold(resolve(base, &target), |acc, name| acc.join(name));
            return realish_hops(&next, hops + 1);
        }
        let Some(parent) = head.parent().map(Path::to_path_buf) else { return p.to_path_buf() };
        let Some(name) = head.file_name() else { return p.to_path_buf() };
        tail.push(name.to_os_string());
        head = parent;
    }
}

fn text(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Why a file tool's path is refused for every agent, or `None` when it may be used. `roots` are the task's granted folders.
pub fn floor_problem(home: &Path, roots: &[PathBuf], cwd: &Path, raw: &str, writing: bool) -> Option<String> {
    if raw.contains(['$', '`']) {
        return Some("A path with $ or a backtick in it cannot be checked, so it is not used. Write the whole path.".into());
    }
    let expanded = expand_home(raw, &text(home));
    let real = realish(&resolve(cwd, Path::new(&expanded)));
    let home_real = realish(home);
    let real_text = text(&real);
    let in_root = roots.iter().any(|root| is_inside(&text(root), &real_text));
    let volumes = is_inside("/Volumes", &real_text);
    if !in_root && !volumes && !is_inside(&text(&home_real), &real_text) {
        return Some(format!("{expanded} is outside your home folder."));
    }
    if writing && has_git_part(&real_text) {
        return Some("Git's own files are not changed by hand: commit explicitly in Terminal.".into());
    }
    if in_root {
        return None;
    }
    let base = if volumes { Path::new("/Volumes") } else { home_real.as_path() };
    let parts: Vec<String> = real.strip_prefix(base).ok()?.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    if !volumes && parts.first().is_some_and(|p| p.to_lowercase() == "library") {
        return Some("~/Library holds apps' data and is never opened by an agent.".into());
    }
    if parts.iter().any(|p| p.starts_with('.')) {
        return Some("Hidden folders and files hold keys and settings and are never opened by an agent.".into());
    }
    if parts.iter().any(|p| is_important_name(p)) {
        return Some("This looks like an important personal document (identity, bank, tax, medical or similar) and is never opened by an agent.".into());
    }
    None
}

/// The secret-folder check the TypeScript caller adds (`DENY_READ_DIRS`), for a read. Applies inside granted folders too.
pub fn secret_problem(home: &Path, real: &Path) -> Option<String> {
    let home_real = realish(home);
    DENY_READ_DIRS
        .iter()
        .any(|dir| is_inside(&text(&home_real.join(dir)), &text(real)))
        .then(|| "That place holds keys or private data and is never opened by an agent.".to_string())
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn home() -> (PathBuf, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ark-floor-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let home = realish(&dir.join("home"));
        for d in ["proj", ".ssh", "Library/Mail", "docs"] {
            std::fs::create_dir_all(home.join(d)).unwrap();
        }
        std::fs::write(home.join("docs/note.txt"), "hi").unwrap();
        std::fs::write(home.join("docs/bank-statement.txt"), "x").unwrap();
        (dir, home)
    }

    #[test]
    fn follows_the_typescript_floor() {
        let (dir, home) = home();
        let proj = home.join("proj");
        let roots = vec![proj.clone()];
        let ask = |p: &str, writing| floor_problem(&home, &roots, &home, p, writing);
        assert_eq!(ask("docs/note.txt", false), None);
        assert_eq!(ask("~/docs/note.txt", false), None);
        assert!(ask("/etc/passwd", false).unwrap().contains("outside your home"));
        assert!(ask(".ssh/id_rsa", false).unwrap().contains("Hidden"));
        assert!(ask("Library/Mail/x", false).unwrap().contains("Library"));
        assert!(ask("docs/bank-statement.txt", false).unwrap().contains("important"));
        assert!(ask("$HOME/x", false).unwrap().contains("cannot be checked"));
        assert!(ask("../escape", false).is_some());
        // Inside a granted folder the hidden-folder rule does not apply, but git's own files stay closed for writing.
        std::fs::create_dir_all(proj.join(".git")).unwrap();
        assert_eq!(floor_problem(&home, &roots, &proj, ".git/config", false), None);
        assert!(floor_problem(&home, &roots, &proj, ".GIT/config", true).unwrap().contains("Git's own"));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn a_link_out_of_the_folder_is_followed() {
        let (dir, home) = home();
        std::os::unix::fs::symlink("/etc", home.join("proj/out")).unwrap();
        let roots = vec![home.join("proj")];
        assert!(floor_problem(&home, &roots, &home, "proj/out/hosts", false).unwrap().contains("outside"));
        // A dangling link target is resolved too.
        std::os::unix::fs::symlink(home.join(".ssh/new"), home.join("proj/dangling")).unwrap();
        assert!(realish(&home.join("proj/dangling")).ends_with(".ssh/new"));
        assert!(secret_problem(&home, &realish(&home.join("proj/dangling"))).is_some());
        std::fs::remove_dir_all(dir).ok();
    }
}
