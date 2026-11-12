//! Provider API keys in the macOS Keychain (service `dev.ark.island`, account = the environment variable name).
//! A key is never written to a file or a log, and never shown again after it is saved: the page shows only "Saved".
//! The runtime child gets the keys in its environment at start.

/// The keys the app can hold: (environment variable, label).
pub const KEYS: [(&str, &str); 2] = [("ANTHROPIC_API_KEY", "Anthropic (Claude)"), ("GEMINI_API_KEY", "Google (Gemini)")];

#[cfg(target_os = "macos")]
const SERVICE: &str = "dev.ark.island";

/// A key has no spaces or line breaks and a sane length, as the Swift app checks it.
pub fn valid(key: &str) -> bool {
    (16..=4096).contains(&key.len()) && key.bytes().all(|b| (33..=126).contains(&b))
}

#[cfg(target_os = "macos")]
pub fn save(name: &str, key: &str) -> Result<(), String> {
    if !valid(key) {
        return Err("Enter the API key without spaces or line breaks.".into());
    }
    security_framework::passwords::set_generic_password(SERVICE, name, key.as_bytes()).map_err(|e| format!("macOS could not save the key in Keychain ({})", e.code()))
}

#[cfg(target_os = "macos")]
pub fn get(name: &str) -> Option<String> {
    security_framework::passwords::get_generic_password(SERVICE, name).ok().and_then(|b| String::from_utf8(b).ok())
}

#[cfg(target_os = "macos")]
pub fn remove(name: &str) -> Result<(), String> {
    security_framework::passwords::delete_generic_password(SERVICE, name).map_err(|e| format!("macOS could not remove the key ({})", e.code()))
}

#[cfg(not(target_os = "macos"))]
pub fn save(_: &str, _: &str) -> Result<(), String> {
    Err("Keychain is available on macOS only.".into())
}
#[cfg(not(target_os = "macos"))]
pub fn get(_: &str) -> Option<String> {
    None
}
#[cfg(not(target_os = "macos"))]
pub fn remove(_: &str) -> Result<(), String> {
    Ok(())
}

/// The saved keys as environment pairs for the runtime child. A variable already in the environment wins.
pub fn env_pairs(already: &dyn Fn(&str) -> Option<String>) -> Vec<(String, String)> {
    KEYS.iter().filter(|(name, _)| already(name).is_none()).filter_map(|(name, _)| get(name).map(|k| ((*name).to_owned(), k))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_with_a_space_or_a_short_key_is_refused() {
        assert!(valid("sk-ant-0123456789abcdef"));
        assert!(!valid("short"));
        assert!(!valid("sk-ant-0123456789 abcdef"));
    }
}
