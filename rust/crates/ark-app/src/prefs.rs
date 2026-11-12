//! The app's own saved choices: new-chat defaults and appearance. One small JSON file; a missing or broken file gives the defaults.

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
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { access: "checked".into(), effort: String::new(), theme: Theme::System }
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
        json!({ "access": self.access, "effort": self.effort, "theme": theme }).to_string()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_ignores_bad_values() {
        let p = Prefs { access: "full".into(), effort: "high".into(), theme: Theme::Dark };
        assert_eq!(Prefs::parse(&p.to_json()), p);
        assert_eq!(Prefs::parse(r#"{"access":"root","effort":"High!","theme":"neon"}"#), Prefs::default());
        assert_eq!(Prefs::parse("not json"), Prefs::default());
    }
}
