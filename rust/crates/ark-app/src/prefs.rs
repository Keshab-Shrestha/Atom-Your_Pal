//! The app's own saved choices: new-chat defaults and appearance. One small JSON file; a missing or broken file gives the defaults.

use ark_core::shortcuts::{Modifiers, ShortcutAction};
use serde_json::{Value, json};
use std::path::PathBuf;

/// Access modes for new chats: (value in `chat.defaults`, label).
pub const ACCESS: [(&str, &str); 4] = [("checked", "Saved permissions"), ("chat-only", "Chat only"), ("ask-changes", "Ask before changes"), ("full", "Full access")];
/// Thinking effort for new chats: (value, label). The empty value is the model's own default.
pub const EFFORT: [(&str, &str); 6] = [("", "Model default"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")];

/// How the window looks: follow the system, or force light or dark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prefs {
    pub access: String,
    pub effort: String,
    pub theme: Theme,
    /// What ARK calls the owner; empty until set.
    pub owner: String,
    /// The welcome window was answered (saved or skipped).
    pub welcomed: bool,
    /// The window is transparent where the app draws nothing (ADR-277). Read when the window opens.
    pub translucent: bool,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { access: "checked".into(), effort: String::new(), theme: Theme::System, owner: String::new(), welcomed: false, translucent: false }
    }
}

fn path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("ARK_UI_PREFS") {
        return Some(PathBuf::from(p));
    }
    Some(PathBuf::from(std::env::var_os("HOME")?).join("Library/Application Support/ARK/ui-prefs.json"))
}

impl Prefs {
    pub fn parse(text: &str) -> Prefs {
        let v: Value = serde_json::from_str(text).unwrap_or(Value::Null);
        let pick = |key: &str, ok: &[(&str, &str)], fallback: &str| {
            v[key].as_str().filter(|s| ok.iter().any(|(id, _)| id == s)).unwrap_or(fallback).to_owned()
        };
        Prefs {
            access: pick("access", &ACCESS, "checked"),
            effort: pick("effort", &EFFORT, ""),
            owner: v["owner"].as_str().unwrap_or_default().chars().take(40).collect(),
            welcomed: v["welcomed"].as_bool().unwrap_or(false),
            translucent: v["translucent"].as_bool().unwrap_or(false),
            theme: match v["theme"].as_str() {
                Some("light") => Theme::Light,
                Some("dark") => Theme::Dark,
                _ => Theme::System,
            },
        }
    }

    pub fn to_json(&self) -> String {
        let theme = match self.theme {
            Theme::System => "system",
            Theme::Light => "light",
            Theme::Dark => "dark",
        };
        json!({ "access": self.access, "effort": self.effort, "theme": theme, "owner": self.owner, "welcomed": self.welcomed, "translucent": self.translucent }).to_string()
    }

    pub fn load() -> Prefs {
        path().and_then(|p| std::fs::read_to_string(p).ok()).map(|t| Prefs::parse(&t)).unwrap_or_default()
    }

    /// Writes the file. A failure is only logged: a lost preference must not stop the app.
    pub fn save(&self) {
        let Some(p) = path() else { return };
        if let Some(dir) = p.parent() {
            if let Err(e) = std::fs::create_dir_all(dir) {
                eprintln!("ark-app: prefs folder: {e}");
                return;
            }
        }
        if let Err(e) = std::fs::write(&p, self.to_json()) {
            eprintln!("ark-app: prefs file: {e}");
        }
    }
}

/// The words for a key combination, such as "Control + Option + Z" or "Hold Right Command + Right Option".
pub fn describe(action: ShortcutAction) -> String {
    let combo = action.default_combo();
    let side = if combo.right_side_only { "Right " } else { "" };
    let mut parts: Vec<String> = Vec::new();
    for (m, name) in [(Modifiers::FUNCTION, "Fn"), (Modifiers::CONTROL, "Control"), (Modifiers::OPTION, "Option"), (Modifiers::SHIFT, "Shift"), (Modifiers::COMMAND, "Command")] {
        if combo.modifiers.contains(m) {
            parts.push(format!("{side}{name}"));
        }
    }
    if let Some(key) = &combo.key_name {
        parts.push(key.clone());
    }
    format!("{}{}", if action.is_hold() { "Hold " } else { "" }, parts.join(" + "))
}

/// The title of each shortcut action.
pub fn action_title(action: ShortcutAction) -> &'static str {
    match action {
        ShortcutAction::Talk => "Talk",
        ShortcutAction::Dictate => "Dictate",
        ShortcutAction::ToggleIsland => "Show or hide ARK",
        ShortcutAction::Cancel => "Cancel",
        ShortcutAction::QuickAction => "Quick action",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_are_described_in_words() {
        assert_eq!(describe(ShortcutAction::Dictate), "Hold Right Option + Right Command");
        assert_eq!(describe(ShortcutAction::ToggleIsland), "Control + Option + Z");
    }

    #[test]
    fn round_trips_and_ignores_bad_values() {
        let p = Prefs { access: "full".into(), effort: "high".into(), theme: Theme::Dark, owner: "Keshab".into(), welcomed: true, translucent: true };
        assert_eq!(Prefs::parse(&p.to_json()), p);
        assert_eq!(Prefs::parse(r#"{"access":"root","effort":"High!","theme":"neon"}"#), Prefs::default());
        assert_eq!(Prefs::parse("not json"), Prefs::default());
    }
}
