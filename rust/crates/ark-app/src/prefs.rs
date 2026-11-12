//! The app's own saved choices: new-chat defaults and appearance. One small JSON file; a missing or broken file gives the defaults.

use ark_core::shortcuts::{KeyCombo, Modifiers, ShortcutAction};
use std::collections::BTreeMap;
use serde_json::{Value, json};
use std::path::PathBuf;

/// Access modes for new chats: (value in `chat.defaults`, label).
pub const ACCESS: [(&str, &str); 4] = [("checked", "Saved permissions"), ("chat-only", "Chat only"), ("ask-changes", "Ask before changes"), ("full", "Full access")];
/// Thinking effort for new chats: (value, label). The empty value is the model's own default.
pub const EFFORT: [(&str, &str); 6] = [("", "Model default"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra high"), ("max", "Max")];

/// The page names saved in the prefs.
pub const SCREENS: [&str; 9] = ["chat", "settings", "agents", "tasks", "memory", "projects", "branches", "dashboard", ""];

/// How the window looks: follow the system, or force light or dark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq)]
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
    /// The page and sidebar width at the last quit, restored at the next start.
    pub screen: String,
    pub sidebar_width: f32,
    pub sidebar_open: bool,
    /// Shortcuts the owner changed, by action id; the others keep their default.
    pub shortcuts: BTreeMap<String, KeyCombo>,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { access: "checked".into(), effort: String::new(), theme: Theme::System, owner: String::new(), welcomed: false, translucent: false, screen: "chat".into(), sidebar_width: 260.0, sidebar_open: true, shortcuts: BTreeMap::new() }
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
            screen: v["screen"].as_str().filter(|s| SCREENS.contains(s)).unwrap_or("chat").to_owned(),
            sidebar_width: v["sidebarWidth"].as_f64().map_or(260.0, |w| (w as f32).clamp(180.0, 420.0)),
            sidebar_open: v["sidebarOpen"].as_bool().unwrap_or(true),
            shortcuts: v["shortcuts"].as_object().map(|o| o.iter().filter_map(|(k, c)| Some((k.clone(), combo_from_json(c)?))).filter(|(k, _)| ShortcutAction::ALL.iter().any(|a| action_id(*a) == k)).collect()).unwrap_or_default(),
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
        json!({ "access": self.access, "effort": self.effort, "theme": theme, "owner": self.owner, "welcomed": self.welcomed, "translucent": self.translucent, "screen": self.screen, "sidebarWidth": self.sidebar_width, "sidebarOpen": self.sidebar_open, "shortcuts": self.shortcuts.iter().map(|(k, c)| (k.clone(), combo_to_json(c))).collect::<serde_json::Map<_, _>>() }).to_string()
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

pub fn action_id(action: ShortcutAction) -> &'static str {
    match action {
        ShortcutAction::Talk => "talk",
        ShortcutAction::Dictate => "dictate",
        ShortcutAction::ToggleIsland => "toggle",
        ShortcutAction::Cancel => "cancel",
        ShortcutAction::QuickAction => "quick",
    }
}

fn combo_to_json(c: &KeyCombo) -> Value {
    json!({ "modifiers": c.modifiers.0, "keyCode": c.key_code, "keyName": c.key_name, "rightSideOnly": c.right_side_only })
}

fn combo_from_json(v: &Value) -> Option<KeyCombo> {
    Some(KeyCombo {
        modifiers: Modifiers(u8::try_from(v["modifiers"].as_u64()?).ok()?),
        key_code: v["keyCode"].as_u64().and_then(|c| u16::try_from(c).ok()),
        key_name: v["keyName"].as_str().map(str::to_owned),
        right_side_only: v["rightSideOnly"].as_bool().unwrap_or(false),
    })
}

impl Prefs {
    /// The shortcut in use: the owner's, else the default.
    pub fn combo(&self, action: ShortcutAction) -> KeyCombo {
        self.shortcuts.get(action_id(action)).cloned().unwrap_or_else(|| action.default_combo())
    }
}

/// The words for a key combination, such as "Control + Option + Z" or "Hold Right Command + Right Option".
pub fn describe(action: ShortcutAction, combo: &KeyCombo) -> String {
    let side = if combo.right_side_only { "Right " } else { "" };
    let mut parts: Vec<String> = Vec::new();
    for (m, name) in [(Modifiers::FUNCTION, "Fn"), (Modifiers::CONTROL, "Control"), (Modifiers::OPTION, "Option"), (Modifiers::SHIFT, "Shift"), (Modifiers::COMMAND, "Command")] {
        if combo.modifiers.contains(m) {
            parts.push(format!("{side}{name}"));
        }
    }
    match (&combo.key_name, combo.key_code) {
        (Some(key), _) => parts.push(key.clone()),
        (None, Some(code)) => parts.push(format!("key {code}")),
        (None, None) => {}
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
        assert_eq!(describe(ShortcutAction::Dictate, &ShortcutAction::Dictate.default_combo()), "Hold Right Option + Right Command");
        assert_eq!(describe(ShortcutAction::ToggleIsland, &ShortcutAction::ToggleIsland.default_combo()), "Control + Option + Z");
    }

    #[test]
    fn round_trips_and_ignores_bad_values() {
        let p = Prefs { access: "full".into(), effort: "high".into(), theme: Theme::Dark, owner: "Keshab".into(), welcomed: true, translucent: true, screen: "memory".into(), sidebar_width: 300.0, sidebar_open: false, shortcuts: BTreeMap::from([("dictate".to_owned(), KeyCombo::keyed(Modifiers::COMMAND, 2, Some("D")))]) };
        assert_eq!(Prefs::parse(&p.to_json()), p);
        assert_eq!(Prefs::parse(r#"{"access":"root","effort":"High!","theme":"neon"}"#), Prefs::default());
        assert_eq!(Prefs::parse("not json"), Prefs::default());
    }
}
