//! The installed apps and the skills lists of the Helpers page (ADR-278 Phase 4, slice 8), read from the folders. Ports of
//! `installedApps` (`services/tool-engine/src/tools/apps.ts`) and `listSkills` (`apps/mac/src/skills.ts`). Both sort with
//! `localeCompare`; `locale_compare` below reads that order for names of letters, digits and ASCII marks.

use std::cmp::Ordering;
use std::path::Path;

use serde_json::{Value, json};

/// The folders of apps (`APP_DIRS`); the home folder's `Applications` comes last.
pub const APP_DIRS: [&str; 4] = ["/Applications", "/System/Applications", "/System/Applications/Utilities", "/Applications/Utilities"];

/// Marks in the order of the Unicode root collation (after white space, before digits).
const MARKS: &str = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

/// The primary weight of a character: white space, then marks, then digits, then letters (without case).
fn weight(c: char) -> (u8, u32) {
    if c.is_whitespace() {
        (0, 0)
    } else if let Some(at) = MARKS.find(c) {
        (1, at as u32)
    } else if c.is_ascii_digit() {
        (2, u32::from(c))
    } else if c.is_alphanumeric() {
        (3, c.to_lowercase().next().map_or(0, u32::from))
    } else {
        (1, 1000 + u32::from(c))
    }
}

// ponytail: this is not the whole ICU collation (accents and non-Latin scripts sort by code point); names of apps and skills are plain.
/// `a.localeCompare(b)` for plain names: letters without case first, then lower case before upper case.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    let primary = a.chars().map(weight).cmp(b.chars().map(weight));
    primary.then_with(|| {
        let first = a.chars().zip(b.chars()).find(|(x, y)| x != y);
        match first {
            Some((x, _)) if x.is_lowercase() => Ordering::Less,
            Some(_) => Ordering::Greater,
            None => Ordering::Equal,
        }
    })
}

/// Names of installed apps, without `.app`: Finder and every `.app` in the folders.
pub fn installed_apps(dirs: &[&Path], home: Option<&Path>) -> Vec<String> {
    let mut names = vec!["Finder".to_string()];
    let own = home.map(|h| h.join("Applications"));
    for dir in dirs.iter().copied().chain(own.as_deref()) {
        let Ok(read) = std::fs::read_dir(dir) else { continue };
        for entry in read.filter_map(Result::ok) {
            if let Some(name) = entry.file_name().to_str().and_then(|n| n.strip_suffix(".app"))
                && !names.iter().any(|n| n == name)
            {
                names.push(name.to_string());
            }
        }
    }
    names
}

/// The `apps` of the event: sorted by name.
pub fn apps(dirs: &[&Path], home: Option<&Path>) -> Value {
    let mut names = installed_apps(dirs, home);
    names.sort_by(|a, b| locale_compare(a, b));
    json!(names)
}

fn is_skill_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 64 && chars.next().is_some_and(|c| c.is_ascii_alphanumeric()) && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

/// A SKILL.md's `description` from its front matter, cut to one line of at most 200 characters.
fn describe(file: &Path) -> String {
    let Ok(text) = std::fs::read_to_string(file) else { return String::new() };
    let head: String = text.chars().take(4000).collect();
    let Some(rest) = head.strip_prefix("---") else { return String::new() };
    let rest = rest.trim_start_matches(char::is_whitespace);
    // The first line is `^---\s*\n`; the front matter ends at the next `\n---`.
    let Some(end) = rest.find("\n---") else { return String::new() };
    let front = &rest[..end];
    let Some(line) = front.split('\n').find(|l| l.starts_with("description") && l[11..].trim_start().starts_with(':')) else { return String::new() };
    let value = line[11..].trim_start().strip_prefix(':').unwrap_or("").trim_start();
    let value = value.strip_prefix(['"', '\'']).unwrap_or(value);
    let value = value.strip_suffix(['"', '\'']).unwrap_or(value);
    value.chars().take(200).collect()
}

/// Folders with a SKILL.md and a plain name.
fn skill_names(dir: Option<&Path>) -> Vec<String> {
    let Some(dir) = dir else { return Vec::new() };
    let Ok(read) = std::fs::read_dir(dir) else { return Vec::new() };
    read.filter_map(|e| e.ok()?.file_name().into_string().ok()).filter(|n| is_skill_name(n) && dir.join(n).join("SKILL.md").exists()).collect()
}

/// The `skills` of the event: the owner's skills and ARK's (those whose name is not one of his), sorted by name.
pub fn skills(user_dir: &Path, ark_dir: Option<&Path>, hub: &[String]) -> Value {
    let yours = skill_names(Some(user_dir));
    let ark: Vec<String> = skill_names(ark_dir).into_iter().filter(|n| !yours.contains(n)).collect();
    let mut all: Vec<(String, String, &str)> = yours.iter().map(|n| (n.clone(), describe(&user_dir.join(n).join("SKILL.md")), "yours")).collect();
    if let Some(dir) = ark_dir {
        all.extend(ark.iter().map(|n| (n.clone(), describe(&dir.join(n).join("SKILL.md")), if hub.contains(n) { "hub" } else { "ark" })));
    }
    all.sort_by(|a, b| locale_compare(&a.0, &b.0));
    Value::Array(all.into_iter().map(|(name, description, source)| json!({ "name": name, "description": description, "source": source })).collect())
}
