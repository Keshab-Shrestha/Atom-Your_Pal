//! The command sandbox: `run_command` runs under macOS `sandbox-exec` with a profile that gives least privilege
//! (CLAUDE.md rule 13). The command may read most files, but it
//! - writes only inside the folders the chat may change, the temporary folders and `/dev/null`;
//! - has no network;
//! - cannot read the owner's secret folders (`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `~/.netrc`, keychains, ARK's own data);
//! - gets a small environment: no tokens or keys.
//!
//! No sandbox, no command: when `sandbox-exec` is missing the command is refused.

use std::path::{Path, PathBuf};
use std::process::Command;

pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// Folders a command may not read, below the home folder.
const SECRET_DIRS: &[&str] = &[".ssh", ".aws", ".gnupg", ".config/gh", "Library/Keychains", ".claude", ".hermes", ".docker"];
const SECRET_FILES: &[&str] = &[".netrc", ".npmrc", ".pypirc"];
/// Writable besides the chat's folders: temporary space (`/private/tmp`, the per-user folders) and a few devices.
const TEMP_DIRS: &[&str] = &["/private/tmp", "/private/var/folders"];
const DEVICES: &[&str] = &["/dev/null", "/dev/dtracehelper", "/dev/tty"];
/// The environment a command gets.
const KEEP_ENV: &[&str] = &["PATH", "HOME", "LANG", "LC_ALL", "TERM", "TMPDIR", "USER", "SHELL"];

/// A string as an SBPL literal.
fn quote(path: &Path) -> String {
    format!("\"{}\"", path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\""))
}

/// The profile. `writable` and `home` must be real paths (the sandbox matches real paths: `/tmp` is `/private/tmp`).
pub fn profile(writable: &[PathBuf], home: &Path) -> String {
    let mut p = String::from("(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)\n(allow file-write*");
    for dir in TEMP_DIRS.iter().map(Path::new).chain(writable.iter().map(PathBuf::as_path)) {
        p.push_str(&format!(" (subpath {})", quote(dir)));
    }
    for device in DEVICES {
        p.push_str(&format!(" (literal {})", quote(Path::new(device))));
    }
    p.push_str(")\n(deny file-read*");
    for dir in SECRET_DIRS {
        p.push_str(&format!(" (subpath {})", quote(&home.join(dir))));
    }
    for file in SECRET_FILES {
        p.push_str(&format!(" (literal {})", quote(&home.join(file))));
    }
    p.push_str(")\n");
    p
}

/// `/bin/sh -c command` under the profile, with a small environment. `None` when the sandbox is not available here.
pub fn command(command: &str, writable: &[PathBuf], home: &Path, cwd: &Path) -> Option<Command> {
    if !Path::new(SANDBOX_EXEC).exists() {
        return None;
    }
    let real = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let writable: Vec<PathBuf> = writable.iter().map(|p| real(p)).collect();
    let mut cmd = Command::new(SANDBOX_EXEC);
    cmd.arg("-p").arg(profile(&writable, &real(home))).args(["/bin/sh", "-c", command]).current_dir(cwd).env_clear();
    for name in KEEP_ENV {
        if let Ok(value) = std::env::var(name) {
            cmd.env(name, value);
        }
    }
    Some(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_profile_denies_first_and_allows_the_listed_places() {
        let p = profile(&[PathBuf::from("/Users/a/work \"x\"")], Path::new("/Users/a"));
        assert!(p.starts_with("(version 1)\n(allow default)\n(deny network*)\n(deny file-write*)"));
        assert!(p.contains("(subpath \"/Users/a/work \\\"x\\\"\")"));
        assert!(p.contains("(subpath \"/private/tmp\")") && p.contains("(literal \"/dev/null\")"));
        assert!(p.contains("(subpath \"/Users/a/.ssh\")") && p.contains("(literal \"/Users/a/.netrc\")"));
    }
}
