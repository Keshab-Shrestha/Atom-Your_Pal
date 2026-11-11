//! The pure parts of the safety policy: `services/helpers/src/grants.ts` (command classes, tool paths, the folder
//! offered for a task, important names) and `services/helpers/src/write-scopes.ts` (declared write scopes and their
//! overlap). The checks that read the disk (`realish`, `checkGrant`, `pathProblem`, `floorProblem`, scope binding)
//! and the stateful gate in `native-safety.ts` move in Phase 2.

use std::sync::LazyLock;

use fancy_regex::Regex;
use serde_json::{Map, Value};
use unicode_normalization::UnicodeNormalization;

use crate::js;

pub const MAX_GRANTS: usize = 8;

/// Folders inside the home folder that hold keys, tokens and other apps' secrets.
pub const DENY_READ_DIRS: &[&str] = &[
    ".ssh", ".aws", ".gnupg", ".config", ".netrc", ".npmrc", ".docker", ".kube", ".azure", ".claude", ".codex", ".hermes",
    "Library/Keychains", "Library/Cookies", ".zsh_history", ".bash_history", ".zsh_sessions", ".git-credentials",
    ".python_history", ".node_repl_history", ".viminfo", ".lesshst", ".pypirc", "Library/Mail", "Library/Messages",
    "Library/Safari", "Library/Calendars", "Library/Group Containers", "Library/Containers",
    "Library/Application Support/Google", "Library/Application Support/Firefox",
    "Library/Application Support/BraveSoftware", "Library/Application Support/Arc",
    "Library/Application Support/Microsoft Edge", "Library/Application Support/AddressBook",
];

/// File tools that change files.
pub const WRITE_TOOLS: &[&str] = &["Write", "Edit", "MultiEdit", "NotebookEdit"];

/// A command longer than this (UTF-16 units, as JavaScript counts) is refused unread.
pub const MAX_COMMAND_CHARS: usize = 8_000;

/// Does the path have a folder or file named `.git`, in any case?
pub fn has_git_part(p: &str) -> bool {
    p.split(['\\', '/']).any(|part| part.to_lowercase() == ".git")
}

pub fn is_inside(root: &str, p: &str) -> bool {
    p == root || p.starts_with(&if root.ends_with('/') { root.to_string() } else { format!("{root}/") })
}

/// "~" and "~/x" as a shell reads them.
pub fn expand_home(p: &str, home: &str) -> String {
    if p == "~" {
        home.to_string()
    } else if let Some(rest) = p.strip_prefix("~/") {
        js::join(&[home, rest])
    } else {
        p.to_string()
    }
}

fn re(pattern: &str, ignore_case: bool) -> Regex {
    js::js_regex(pattern, ignore_case)
}

/// A match, failing closed: a pattern that gives up (the backtrack limit) counts as a match.
fn hits(regex: &Regex, text: &str) -> bool {
    regex.is_match(text).unwrap_or(true)
}

static IMPORTANT_NAME: LazyLock<Regex> = LazyLock::new(|| {
    re(r"(^|[^a-z])(passport|visa|citizenship|national[ _-]?id|id[ _-]?card|birth[ _-]?certificate|bank|tax|insurance|medical|ssn|payslip|salary)([^a-z]|$)", true)
});

/// ADR-123: names of important personal documents (a net, not a guarantee).
pub fn is_important_name(name: &str) -> bool {
    hits(&IMPORTANT_NAME, &js::ascii_case_guard(name))
}

/// `pattern.replace(/[*?[{].*$/, "")`: from the first wildcard whose rest of the text has no line break.
fn strip_glob(pattern: &str) -> &str {
    for (i, c) in pattern.char_indices() {
        if matches!(c, '*' | '?' | '[' | '{') && !pattern[i..].chars().any(js::is_js_line_terminator) {
            return &pattern[..i];
        }
    }
    pattern
}

/// The paths a file tool's input names, for checking.
pub fn tool_paths(name: &str, input: &Map<String, Value>) -> Vec<String> {
    let text = |key: &str| match input.get(key) {
        Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
        _ => Vec::new(),
    };
    match name {
        "Read" | "Write" | "Edit" | "MultiEdit" => text("file_path"),
        "NotebookEdit" => text("notebook_path"),
        "Glob" | "Grep" => {
            let mut out = text("path");
            for pattern in text("pattern").into_iter().filter(|p| js::is_absolute(p)) {
                let head = strip_glob(&pattern);
                out.push(if head.is_empty() { "/".into() } else { head.into() });
            }
            out
        }
        _ => Vec::new(),
    }
}

/// A sandboxed command's fate. `outside`: on Allow the command runs outside the sandbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandVerdict {
    Allow,
    Ask { reason: String, outside: bool },
    Refuse { reason: String },
}

const GIT: &str = r"\bgit(?:\s+(?:-[cC]\s+\S+|--[\w-]+(?:=\S+)?|-[abd-zABD-Z]))*\s+";

/// A reason that names the owner is built when the command is refused.
enum Reason {
    Text(&'static str),
    UseTrash,
}

static REFUSED: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        (re(&format!(r"{GIT}push\b"), false), "Pushing is never done: the work stays on its branch on this Mac."),
        (re(&format!(r"{GIT}remote\s+(?:add|set-url|rename|remove|rm)\b"), false), "Changing the repository's remotes is not allowed."),
        (re(r"\bsecurity\s+(?:find|dump|export)", false), "Keychains are out of reach."),
    ]
});

static OUTSIDE: LazyLock<Vec<(Regex, &'static str)>> = LazyLock::new(|| {
    vec![
        (re(r"\bcurl\b|\bwget\b|\bssh\b|\bscp\b|\brsync\b.*:|\bnc\b", false), "uses the network"),
        (re(&format!(r"{GIT}(?:fetch|pull|clone|ls-remote)\b"), false), "uses the network"),
        (re(r"\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add)\b|\bpip3?\s+install\b|\bbrew\s+install\b|\bcargo\s+install\b|\bgem\s+install\b", false), "installs software from the network"),
        (re(r"(?:^|[;&|(\n]\s*|\b(?:env|xargs|command|exec|nohup|time)\s+)(?:sudo|doas|su)\b", false), "runs as an administrator (sudo cannot ask for a password here, so it works only where none is needed)"),
        (re(r"\bdefaults\s+write\b|\blaunchctl\b|\bosascript\b", false), "changes system settings or controls other apps"),
        (re(&format!(r"{GIT}(?:checkout|switch)(?:\s+-\S+)*\s+(?:main|master)\b|{GIT}(?:reset\s+--hard|rebase|filter-branch|update-ref)\b"), false), "rewrites git history or leaves the task's branch"),
    ]
});

static DELETE_AND_HARM: LazyLock<Vec<(Regex, Reason)>> = LazyLock::new(|| {
    vec![
        (re(r"(?<![\w.\-])\\?(?:\/(?:usr\/)?(?:local\/)?bin\/)?(?:rm|rmdir|unlink|trash|shred|srm)(?=\s|$|;|&|\|)", false), Reason::UseTrash),
        (re(r"(?<![\w.\-])(?:sh|bash|zsh|dash|ksh|fish)\s+(?:-[a-zA-Z]*c\b|--command)|(?<![\w.\-])eval\s|(?<![\w.\-])(?:node|nodejs|deno|bun)\s+(?:-e\b|--eval\b|-p\b|--print\b)|(?<![\w.\-])python[0-9.]*\s+-[a-zA-Z]*c\b|(?<![\w.\-])(?:perl|ruby|php)\s+-[a-zA-Z]*[er]\b", false), Reason::Text("Run a script file, not inline code: inline code cannot be checked.")),
        (re(r"\b(?:rmSync|unlinkSync|rmdirSync|fs\.rm|fs\.unlink|fs\.rmdir|rmtree|os\.remove|os\.unlink|os\.rmdir|shutil\.rmtree|FileUtils\.rm|File\.delete|Files\.delete|unlink\s*\()", false), Reason::UseTrash),
        (re(r"\bmv\b[^\n;|&]*\/dev\/null|(?<![\w.\-])truncate\s", false), Reason::Text("Emptying files is never done by an agent.")),
        (re(&format!(r"{GIT}(?:stash\s+(?:clear|drop)|worktree\s+(?:remove|prune)|gc\s+--prune|reflog\s+expire|prune\b|replace\b)"), false), Reason::Text("That git command throws work away and is never run by an agent.")),
        (re(r"(?:^|[;&|(\n]\s*|\b(?:env|xargs|command|exec|nohup|time|sudo)\s+)(?:rm|rmdir|unlink|trash|shred|srm)\b|\bfind\b[^\n;|&]*(?:-delete\b|-exec\s+(?:rm|rmdir|unlink)\b)", false), Reason::UseTrash),
        (re(&format!(r"{GIT}(?:clean|rm)\b|{GIT}branch\s+(?:-[dD]|--delete)\b"), false), Reason::Text("Deleting files or branches is never done by an agent.")),
        (re(r"(?:^|[;&|(\n]\s*|\b(?:env|xargs|command|exec|nohup|time|sudo)\s+)(?:dd|mkfs\S*|diskutil|hdiutil|fdisk|newfs\S*|chown|chgrp|kill|killall|pkill|shutdown|reboot|halt|pmset|networksetup|scutil|csrutil|spctl|tccutil|nvram|systemsetup|dscl|fdesetup)\b", false), Reason::Text("That command changes the system and is never run by an agent.")),
        (re(r"\bchmod\s+(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)\b", false), Reason::Text("Changing permissions of whole folders is never done by an agent.")),
        (re(r">>?\s*\/(?:System|Library|usr|etc|bin|sbin|private|Applications|var)\b|\btee\s+(?:-a\s+)?\/(?:System|Library|usr|etc|bin|sbin|private|Applications|var)\b", false), Reason::Text("System folders are never written by an agent.")),
        (re(r":\s*\(\s*\)\s*\{[^}]*:\s*\|\s*:", false), Reason::Text("A fork bomb.")),
    ]
});

static PUSH: LazyLock<Regex> = LazyLock::new(|| re(&format!(r"{GIT}push\b"), false));

/// A `git push` in any of its spellings.
pub fn is_push_command(command: &str) -> bool {
    hits(&PUSH, command)
}

/// A sandboxed command's fate, in code. `owner` is the name the trash rule names ("the user" until one is set).
pub fn classify_command(command: &str, owner: &str) -> CommandVerdict {
    if js::utf16_len(command) > MAX_COMMAND_CHARS {
        return CommandVerdict::Refuse { reason: format!("The command is longer than {MAX_COMMAND_CHARS} characters. Put it in a script file.") };
    }
    if let Some((_, reason)) = REFUSED.iter().find(|(re, _)| hits(re, command)) {
        return CommandVerdict::Refuse { reason: (*reason).into() };
    }
    if let Some((_, reason)) = DELETE_AND_HARM.iter().find(|(re, _)| hits(re, command)) {
        let reason = match reason {
            Reason::Text(text) => (*text).to_string(),
            Reason::UseTrash => format!("Commands do not delete files. Use the trash_file tool: it asks {owner} and moves the file to the Trash."),
        };
        return CommandVerdict::Refuse { reason };
    }
    if let Some((_, reason)) = OUTSIDE.iter().find(|(re, _)| hits(re, command)) {
        return CommandVerdict::Ask { reason: (*reason).into(), outside: true };
    }
    CommandVerdict::Allow
}

static TASK_PATH: LazyLock<Regex> = LazyLock::new(|| re(r#"(?:^|\s)(~\/[^\s"']+|\/Users\/[^\s"']+)"#, false));
static TASK_FOLDER: LazyLock<Regex> = LazyLock::new(|| {
    re(r#"\bfolder (?:named|called) ["'“]?([\w][\w .-]{0,60}?)["'”]?(?=[\s,.;:!?]|$)"#, true)
});
static DESKTOP: LazyLock<Regex> = LazyLock::new(|| re(r"\bdesktop\b", true));
static DOCUMENTS: LazyLock<Regex> = LazyLock::new(|| re(r"\bdocuments\b", true));

/// The first match's group 1, read from `text` (the guard keeps offsets).
fn first_group(regex: &Regex, text: &str) -> Option<String> {
    let guarded = js::ascii_case_guard(text);
    let range = regex.captures(&guarded).ok().flatten()?.get(1)?.range();
    Some(text[range].to_string())
}

/// ADR-090: the folder to offer a file worker that has none: a path the task names inside the home folder, a folder it
/// names, or ~/Documents/ARK. Never the home folder itself, ~/Library or a hidden folder. `home` is absolute.
pub fn folder_for_task(task: &str, home: &str) -> String {
    let fallback = js::join(&[home, "Documents", "ARK"]);
    let home_resolved = js::resolve(home);
    let allowed = |p: &str| {
        let real = js::resolve(p);
        if !is_inside(home, &real) || real == home_resolved {
            return false;
        }
        let rest = real.get(home_resolved.len() + 1..).unwrap_or("");
        let mut parts = rest.split('/');
        parts.next().is_none_or(|first| first.to_lowercase() != "library") && !rest.split('/').any(|part| part.starts_with('.'))
    };
    let tidy = |p: &str| p.trim_end_matches(['.', ',', ';', ':', '!', '?', ')', '"', '\'', '’']).to_string();
    if let Some(path) = first_group(&TASK_PATH, task) {
        let full = tidy(&match path.strip_prefix("~/") {
            Some(rest) => js::join(&[home, rest]),
            None => path.clone(),
        });
        if allowed(&full) {
            return full;
        }
    }
    if let Some(named) = first_group(&TASK_FOLDER, task).filter(|n| !n.contains("..")) {
        let guarded = js::ascii_case_guard(task);
        let base = if hits(&DESKTOP, &guarded) {
            js::join(&[home, "Desktop"])
        } else if hits(&DOCUMENTS, &guarded) {
            js::join(&[home, "Documents"])
        } else {
            home.to_string()
        };
        let full = js::join(&[&base, &tidy(js::trim(&named))]);
        if allowed(&full) {
            return full;
        }
    }
    fallback
}

pub const WRITE_SCOPE_LIST: &str = "writeScope must list at most 32 literal relative files or folders.";
pub const WRITE_SCOPE_LITERAL: &str = "writeScope uses literal project-relative paths, not absolute paths, patterns or shell expressions.";
pub const WRITE_SCOPE_PARTS: &str = "writeScope cannot contain parent traversal, empty components or Git internals.";

fn bad_scope_char(c: char) -> bool {
    matches!(c, '\\' | '\u{0}'..='\u{1F}' | '\u{7F}' | '*' | '?' | '[' | ']' | '{' | '}' | '~' | '$')
}

/// `parseWriteScope`: literal relative file and folder declarations, deduplicated in order. `None` in: no declaration.
pub fn parse_write_scope(value: Option<&Value>) -> Result<Option<Vec<String>>, &'static str> {
    let Some(value) = value else { return Ok(None) };
    let Value::Array(items) = value else { return Err(WRITE_SCOPE_LIST) };
    if items.len() > 32 {
        return Err(WRITE_SCOPE_LIST);
    }
    let mut out: Vec<String> = Vec::new();
    for item in items {
        let Value::String(p) = item else { return Err(WRITE_SCOPE_LITERAL) };
        if p.is_empty() || p != js::trim(p) || js::is_absolute(p) || js::is_win32_absolute(p) || p.chars().any(bad_scope_char) {
            return Err(WRITE_SCOPE_LITERAL);
        }
        let path = if p == "." {
            p.clone()
        } else {
            let segments: Vec<&str> = p.trim_end_matches('/').split('/').collect();
            if segments.iter().any(|s| s.is_empty() || *s == "." || *s == ".." || s.to_lowercase() == ".git") {
                return Err(WRITE_SCOPE_PARTS);
            }
            segments.join("/")
        };
        if !out.contains(&path) {
            out.push(path);
        }
    }
    Ok(Some(out))
}

/// Component-aware, case- and Unicode-insensitive overlap of two bound scopes. `None`: an unknown scope (overlaps all).
pub fn write_scopes_overlap(a: Option<&[String]>, b: Option<&[String]>) -> bool {
    let (Some(a), Some(b)) = (a, b) else { return true };
    let key = |p: &str| p.nfc().collect::<String>().to_lowercase();
    a.iter().any(|x| b.iter().any(|y| is_inside(&key(x), &key(y)) || is_inside(&key(y), &key(x))))
}
