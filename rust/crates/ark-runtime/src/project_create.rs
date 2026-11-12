//! `project.create` (ADR-278): a port of `createProjectSource` in `apps/mac/src/project-sources.ts`. The folder, new, Git and GitHub
//! sources make a project. A Git source is cloned with no shell, no inherited Git config, no credential helper and no prompt. A scan
//! every 100 ms watches the size, the file count, the time and the folder identity. A cancel, a limit or a change stops Git and
//! leaves a partial folder for the owner to inspect. It never overwrites a folder. Registering the project is `projects_add::add`.

use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::{Connection, OptionalExtension};
use serde_json::{Value, json};

use crate::projects_add::{Outcome, add, check_grant};

const MAX_PROJECTS: i64 = 20;
const OUTPUT_BUDGET: usize = 128 * 1024;
const TICK: Duration = Duration::from_millis(100);
const CANCELLED: &str = "Project creation cancelled.";
const PARTIAL: &str = " A partial folder remains at the selected destination; inspect it before retrying.";
const GENERIC: &str = "Project creation failed. Check the destination and try again.";
const GIT_CONFIG: [&str; 20] = [
    "-c", "core.hooksPath=/dev/null", "-c", "init.templateDir=", "-c", "credential.helper=", "-c", "core.askPass=/usr/bin/false", "-c", "protocol.allow=never",
    "-c", "protocol.https.allow=always", "-c", "submodule.recurse=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "-c", "http.followRedirects=false",
];

/// The budgets of one creation: bytes on disk, entries and milliseconds.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub bytes: u64,
    pub entries: u64,
    pub ms: u64,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits { bytes: 256 * 1024 * 1024, entries: 20_000, ms: 120_000 }
    }
}

/// A valid `project.create` command (the same checks as `island-commands.ts`). `None` means: Node must refuse it with its words.
#[derive(Debug, Clone)]
pub struct Request {
    pub request: String,
    pub source: String,
    pub name: String,
    pub path: String,
    pub remote: Option<String>,
}

impl Request {
    pub fn parse(command: &Value) -> Option<Request> {
        let text = |key: &str| command.get(key).and_then(Value::as_str);
        let request = text("request").filter(|r| r.len() == 36 && r.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'))?;
        let source = text("source").filter(|s| matches!(*s, "folder" | "new" | "git" | "github"))?;
        let path = text("path").filter(|p| p.starts_with('/') && !p.chars().any(|c| matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}')) && !p.split('/').any(|s| s == ".."))?;
        let remote = match command.get("remote") {
            None => None,
            Some(v) => Some(v.as_str()?.to_string()),
        };
        Some(Request { request: request.into(), source: source.into(), name: text("name")?.into(), path: path.into(), remote })
    }
}

/// `repositoryURL`: an HTTPS repository URL with no credentials, query or fragment (GitHub also takes `owner/repository`).
pub fn repository_url(source: &str, raw: &str) -> Result<String, String> {
    let bad = || "Use an HTTPS repository URL without credentials, query parameters or fragments. GitHub accepts owner/repository.".to_string();
    let mut input = raw.trim().to_string();
    let short = !input.is_empty() && input.matches('/').count() == 1 && input.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | '/'));
    if source == "github" && short && !input.starts_with('/') && !input.ends_with('/') {
        input = format!("https://github.com/{input}");
    }
    let url = url::Url::parse(&input).map_err(|_| "Enter an HTTPS repository URL, or owner/repository for GitHub.".to_string())?;
    let lower = input.to_lowercase();
    let path = url.path();
    let github_path = path.trim_end_matches('/').split('/').skip(1).collect::<Vec<_>>();
    let github_ok = github_path.len() == 2 && path.matches('/').count() <= 3 && github_path.iter().all(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')));
    if url.scheme() != "https" || url.host_str().is_none_or(str::is_empty) || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some()
        || input.chars().any(|c| c <= ' ' || c == '\u{7f}') || lower.contains("%0a") || lower.contains("%0d") || path == "/"
        || (source == "github" && (url.host_str() != Some("github.com") || url.port().is_some() || !github_ok))
    {
        return Err(bad());
    }
    Ok(url.as_str().trim_end_matches('/').to_string())
}

/// The folder walk of `sizeCheck`: symbolic links are skipped, a file that goes away is not an error.
fn size_check(root: &Path, limits: &Limits) -> Result<(), String> {
    let (mut total, mut count) = (0u64, 0u64);
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("The destination could not be checked.".into()),
        };
        for entry in entries.flatten() {
            count += 1;
            if count > limits.entries {
                return Err("The repository exceeds the file-count budget.".into());
            }
            let Ok(meta) = std::fs::symlink_metadata(entry.path()) else { continue };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                stack.push(entry.path());
            } else {
                total += meta.len();
                if total > limits.bytes {
                    return Err("The repository exceeds the disk budget.".into());
                }
            }
        }
    }
    Ok(())
}

/// The check that runs while Git works: `Err` stops Git.
pub type Tick<'a> = dyn FnMut() -> Result<(), String> + 'a;

/// Runs Git with no shell and a clean environment. `tick` runs every 100 ms; an `Err` kills Git's process group.
pub fn run_git(args: &[String], cwd: &Path, tick: &mut Tick<'_>) -> Result<(), String> {
    let path = std::env::var("PATH").unwrap_or_else(|_| "/usr/bin:/bin".into());
    let mut command = Command::new("git");
    command
        .args(GIT_CONFIG)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .envs([("PATH", path.as_str()), ("LANG", "C"), ("LC_ALL", "C"), ("GIT_CONFIG_NOSYSTEM", "1"), ("GIT_CONFIG_SYSTEM", "/dev/null"), ("GIT_CONFIG_GLOBAL", "/dev/null"), ("GIT_ATTR_NOSYSTEM", "1"), ("GIT_TERMINAL_PROMPT", "0"), ("GIT_ASKPASS", "/usr/bin/false"), ("SSH_ASKPASS", "/usr/bin/false"), ("GIT_LFS_SKIP_SMUDGE", "1")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let mut child = command.spawn().map_err(|_| "Git could not start. Install Git and try again.".to_string())?;
    let bytes = Arc::new(AtomicUsize::new(0));
    for pipe in [child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>), child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>)].into_iter().flatten() {
        let (bytes, mut pipe) = (bytes.clone(), pipe);
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = pipe.read(&mut buf) {
                if n == 0 {
                    break;
                }
                bytes.fetch_add(n, Ordering::SeqCst);
            }
        });
    }
    let pid = child.id() as i32;
    let kill = |child: &mut std::process::Child| {
        // SAFETY: SIGKILL to the process group that `process_group(0)` made for this child.
        unsafe { libc::kill(-pid, libc::SIGKILL) };
        child.wait().ok();
    };
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return if status.success() { Ok(()) } else { Err("Git did not finish. Check the HTTPS repository and access. Credential prompts and private sign-in are not supported here.".into()) },
            Ok(None) => {}
            Err(_) => {
                kill(&mut child);
                return Err(GENERIC.into());
            }
        }
        if bytes.load(Ordering::SeqCst) > OUTPUT_BUDGET {
            kill(&mut child);
            return Err("Git exceeded its output budget.".into());
        }
        if let Err(problem) = tick() {
            kill(&mut child);
            return Err(problem);
        }
        std::thread::sleep(TICK);
    }
}

/// What the registration needs: the files and the stores that `project.add` writes.
pub struct World<'a> {
    pub memory: &'a Connection,
    pub helpers: &'a Connection,
    pub agents: &'a Path,
    pub home: &'a Path,
    pub state: &'a Path,
}

/// The git runner: arguments, folder and the tick.
pub type Git<'a> = dyn Fn(&[String], &Path, &mut Tick<'_>) -> Result<(), String> + 'a;

/// `validate`: the name and the limits, before any network or disk work.
fn validate(memory: &Connection, name: &str) -> Result<(), String> {
    if memory.query_row("SELECT id FROM projects WHERE lower(name) = lower(?)", [name], |r| r.get::<_, String>(0)).optional().map_err(|_| GENERIC.to_string())?.is_some() {
        return Err("A project with this name exists.".into());
    }
    let open: i64 = memory.query_row("SELECT COUNT(*) FROM projects WHERE archived = 0", [], |r| r.get(0)).map_err(|_| GENERIC.to_string())?;
    if open >= MAX_PROJECTS {
        return Err("Archive a project before adding another.".into());
    }
    Ok(())
}

/// `register`: the project row, the coder Agent and the list, then the id of the project.
fn register(world: &World<'_>, name: &str, path: &str) -> Result<String, String> {
    match add(world.memory, world.helpers, world.agents, world.home, world.state, name, path) {
        Outcome::Done => {}
        Outcome::Refused(message) => return Err(message),
        Outcome::Forward => return Err("Project registration was not confirmed. Refresh projects.".into()),
    }
    let folders = json!([path]).to_string();
    world.memory.query_row("SELECT id FROM projects WHERE name = ? AND folders = ?", [name, folders.as_str()], |r| r.get(0)).map_err(|_| "Project registration was not confirmed. Refresh projects.".to_string())
}

/// The absolute path must be written in its plain form: no `.`, no `..`, no empty part, no trailing slash.
fn is_plain(path: &str) -> bool {
    path == "/" || (path.starts_with('/') && !path.ends_with('/') && Path::new(path).components().skip(1).all(|c| matches!(c, Component::Normal(_))) && !path.contains("//"))
}

/// The folder must be the same one it was: same device and node, not a link, the same real path, still allowed.
fn unchanged(parent: &Path, parent_id: (u64, u64), path: &Path, root_id: (u64, u64), home: &Path) -> Result<(), String> {
    let changed = || "The destination changed during creation. Inspect it before trying again.".to_string();
    let (Ok(p), Ok(c)) = (std::fs::symlink_metadata(parent), std::fs::symlink_metadata(path)) else { return Err(changed()) };
    let real = std::fs::canonicalize(path).map_err(|_| changed())?;
    if (p.dev(), p.ino()) != parent_id || (c.dev(), c.ino()) != root_id || c.file_type().is_symlink() || real != path || check_grant(&path.to_string_lossy(), home).ok().as_deref() != Some(path) {
        return Err(changed());
    }
    Ok(())
}

/// Makes the project. Returns the `project.created` event.
pub fn create(request: &Request, world: &World<'_>, cancel: &AtomicBool, limits: Limits, git: &Git<'_>) -> Value {
    let mut partial = false;
    let outcome = make(request, world, cancel, limits, git, &mut partial);
    let mut event = json!({ "type": "project.created", "request": request.request });
    match outcome {
        Ok(project) => {
            event["ok"] = json!(true);
            event["project"] = json!(project);
        }
        Err(message) => {
            event["ok"] = json!(false);
            event["error"] = json!(if partial { format!("{message}{PARTIAL}") } else { message });
            if partial {
                event["partial"] = json!(true);
            }
        }
    }
    event
}

fn make(request: &Request, world: &World<'_>, cancel: &AtomicBool, limits: Limits, git: &Git<'_>, partial: &mut bool) -> Result<String, String> {
    let started = Instant::now();
    let stop = || -> Result<(), String> {
        if cancel.load(Ordering::SeqCst) {
            return Err(CANCELLED.into());
        }
        if started.elapsed() > Duration::from_millis(limits.ms) {
            return Err("Project creation timed out.".into());
        }
        Ok(())
    };
    stop()?;
    let name = crate::projects_store::clean_name(&request.name)?;
    validate(world.memory, &name)?;
    if !is_plain(&request.path) || request.path.chars().any(|c| matches!(c, '\u{0}'..='\u{1f}' | '\u{7f}')) {
        return Err("Choose an absolute destination without traversal or control characters.".into());
    }
    if request.source == "folder" {
        let path = check_grant(&request.path, world.home)?;
        stop()?;
        return register(world, &name, &path.to_string_lossy());
    }
    let remote = if matches!(request.source.as_str(), "git" | "github") { Some(repository_url(&request.source, request.remote.as_deref().unwrap_or(""))?) } else { None };
    let dest = Path::new(&request.path);
    let folder = dest.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let parent = dest.parent().and_then(|p| std::fs::canonicalize(p).ok()).ok_or_else(|| GENERIC.to_string())?;
    let home = std::fs::canonicalize(world.home).map_err(|_| GENERIC.to_string())?;
    if folder.is_empty() || folder.starts_with('.') || folder.chars().any(|c| matches!(c, '\\' | '/' | ':' | '\u{0}'..='\u{1f}' | '\u{7f}')) || (parent == home && folder.to_lowercase() == "library") {
        return Err("Choose a normal, non-hidden project folder name.".into());
    }
    if parent != home {
        check_grant(&parent.to_string_lossy(), world.home)?;
    }
    let parent_meta = std::fs::symlink_metadata(&parent).map_err(|_| GENERIC.to_string())?;
    let path: PathBuf = parent.join(&folder);
    stop()?;
    if std::fs::create_dir(&path).is_err() {
        return Err("The destination already exists or cannot be created. Choose a new folder.".into());
    }
    *partial = true;
    let root_meta = std::fs::symlink_metadata(&path).map_err(|_| GENERIC.to_string())?;
    let (parent_id, root_id) = ((parent_meta.dev(), parent_meta.ino()), (root_meta.dev(), root_meta.ino()));
    let scan = || -> Result<(), String> {
        unchanged(&parent, parent_id, &path, root_id, world.home)?;
        size_check(&path, &limits)
    };
    scan()?;
    let args: Vec<String> = match &remote {
        Some(url) => ["clone", "--quiet", "--depth=1", "--single-branch", "--no-tags", "--no-recurse-submodules", "--", url, "."].map(String::from).to_vec(),
        None => ["init", "--quiet", "--", "."].map(String::from).to_vec(),
    };
    git(&args, &path, &mut || {
        stop()?;
        scan()
    })?;
    stop()?;
    scan()?;
    stop()?;
    register(world, &name, &path.to_string_lossy())
}

/// The cancel flag for one creation.
pub type Cancel = Arc<AtomicBool>;
