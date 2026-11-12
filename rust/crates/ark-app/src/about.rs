//! The "About and support" settings: the build line, the problem report link, open at login, and the update check
//! (BuildInfo.swift, ProblemReport.swift, LoginItem.swift, AppUpdater.swift). Pure helpers first; the actions run commands.

use std::path::{Path, PathBuf};

const REPOSITORY: &str = "https://github.com/Keshab-Shrestha/Atom-Your_Pal";
/// The Launch Agent that opens ARK at login.
const AGENT_LABEL: &str = "dev.ark.island.login";

pub fn build_line() -> String {
    format!("ARK {} (Rust app){}", env!("CARGO_PKG_VERSION"), option_env!("ARK_BUILD_SHA").map(|s| format!(" · {s}")).unwrap_or_default())
}

/// Percent-encodes everything but letters, digits and `-_.~`.
fn encode(text: &str) -> String {
    text.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// The new-issue link with only the ARK and macOS versions filled in. No log or chat is attached.
pub fn problem_url(ark: &str, macos: &str) -> String {
    let body = format!("**What happened**\n\n\n**What I expected**\n\n\n---\nARK {ark} · macOS {macos}\n(No logs or chats are attached. Add them only if you want to.)\n");
    format!("{REPOSITORY}/issues/new?title=&body={}", encode(&body))
}

pub fn macos_version() -> String {
    std::process::Command::new("sw_vers").arg("-productVersion").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).map_or_else(|| "unknown".into(), |s| s.trim().to_owned())
}

pub fn open_url(url: &str) {
    if let Err(e) = std::process::Command::new("open").arg(url).spawn() {
        eprintln!("ark-app: could not open the link: {e}");
    }
}

fn agent_path() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("HOME")?).join("Library/LaunchAgents").join(format!("{AGENT_LABEL}.plist")))
}

pub fn login_enabled() -> bool {
    agent_path().is_some_and(|p| p.exists())
}

/// The Launch Agent file text for an app binary.
pub fn agent_plist(binary: &Path) -> String {
    let path = binary.to_string_lossy().replace('&', "&amp;").replace('<', "&lt;");
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n<plist version=\"1.0\"><dict>\n<key>Label</key><string>{AGENT_LABEL}</string>\n<key>ProgramArguments</key><array><string>{path}</string></array>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n")
}

/// Turns "open at login" on or off by writing or removing the Launch Agent. It takes effect at the next login.
pub fn set_login(on: bool) -> Result<(), String> {
    let path = agent_path().ok_or("There is no home folder.")?;
    if !on {
        return match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("Could not remove the login item: {e}")),
        };
    }
    let exe = std::env::current_exe().map_err(|e| format!("Could not find this app: {e}"))?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Could not make the folder: {e}"))?;
    }
    std::fs::write(&path, agent_plist(&exe)).map_err(|e| format!("Could not write the login item: {e}"))
}

/// How many commits `origin/main` has that this copy lacks, from `git rev-list --count` output.
pub fn parse_behind(output: &str) -> Option<u64> {
    output.trim().parse().ok()
}

/// Looks at origin/main in the source folder of this copy (fetch, then count). Slow: call it off the window thread.
pub fn check_updates(root: &Path) -> String {
    let git = |args: &[&str]| std::process::Command::new("git").arg("-C").arg(root).args(args).output();
    match git(&["fetch", "--quiet", "origin", "main"]) {
        Ok(o) if o.status.success() => {}
        Ok(o) => return format!("Could not look for updates: {}", String::from_utf8_lossy(&o.stderr).trim()),
        Err(e) => return format!("Could not run git: {e}"),
    }
    match git(&["rev-list", "--count", "HEAD..origin/main"]).ok().and_then(|o| parse_behind(&String::from_utf8_lossy(&o.stdout))) {
        Some(0) => "ARK is up to date.".into(),
        Some(n) => format!("{n} new commit{} on origin/main. Pull them and run scripts/setup.sh to rebuild.", if n == 1 { "" } else { "s" }),
        None => "Could not count the new commits.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_report_link_holds_only_versions() {
        let url = problem_url("0.0.1", "15.1");
        assert!(url.starts_with("https://github.com/Keshab-Shrestha/Atom-Your_Pal/issues/new?title=&body="));
        assert!(url.contains("ARK%200.0.1%20%C2%B7%20macOS%2015.1"));
        assert!(!url.contains(' ') && !url.contains('\n'));
    }

    #[test]
    fn the_login_agent_runs_the_binary_at_load() {
        let p = agent_plist(Path::new("/Apps/A&B/ARK"));
        assert!(p.contains("<string>/Apps/A&amp;B/ARK</string>") && p.contains("<key>RunAtLoad</key><true/>"));
        assert_eq!(parse_behind("3\n"), Some(3));
        assert_eq!(parse_behind("x"), None);
    }
}
