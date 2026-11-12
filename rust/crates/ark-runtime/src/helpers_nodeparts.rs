//! The two parts of the `helpers` event that only Node's memory had (ADR-278 Phase 4): the plan's `models` and the `paperclip`
//! issues. With them in Rust, `helpers.list` needs no `helpers` event from Node first. Ports of `tieredModels` (`models.ts`),
//! `paperclipBase` and `issueTracker.list` (`apps/mac/src/paperclip.ts`) and `withPaperclip` (`island-wiring.ts`).
//! Node's live model list (ADR-097) still wins when Node has sent one; without it the table of the Claude plan is used
//! (`PROVIDERS["claude-plan"].models` in `packages/shared/src/config.ts`).

use std::path::Path;

use serde_json::{Value, json};

/// The Claude plan's models, newest first, and the family that puts each in a tier (`FAMILIES` of `models.ts`, large to small order does not matter here).
const CLAUDE_PLAN_MODELS: [(&str, &str); 3] = [("claude-opus-5-5", "Claude Opus 5.5"), ("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-haiku-4-5-20251001", "Claude Haiku 4.5")];
/// The tiers in the order of `TIERS` (small to large) and the family name of each.
const FAMILIES: [(&str, &str); 3] = [("small", "haiku"), ("medium", "sonnet"), ("large", "opus")];

/// `tieredModels(offered)`: the models of a known family, with their tier; others are left out.
pub fn tiered_models(offered: &[(String, String)]) -> Value {
    Value::Array(
        offered
            .iter()
            .filter_map(|(id, name)| {
                let lower = id.to_lowercase();
                FAMILIES.iter().find(|(_, family)| lower.contains(family)).map(|(tier, _)| json!({ "id": id, "name": name, "tier": tier }))
            })
            .collect(),
    )
}

/// The `models` of the event: Node's live list when it sent one, else the table of the Claude plan.
pub fn models(cached: &Value) -> Value {
    match cached.get("models") {
        Some(live) if live.is_array() => live.clone(),
        _ => tiered_models(&CLAUDE_PLAN_MODELS.map(|(id, name)| (id.to_string(), name.to_string()))),
    }
}

/// `paperclipBase(raw)` is defined: a loopback `http` or `https` URL without a user name or password.
pub fn is_loopback_url(raw: &str) -> bool {
    let raw = raw.trim();
    let Some((scheme, rest)) = raw.split_once("://") else { return false };
    if !scheme.eq_ignore_ascii_case("http") && !scheme.eq_ignore_ascii_case("https") {
        return false;
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return false;
    }
    let host = if authority.starts_with('[') { authority.split_once(']').map_or("", |(h, _)| &authority[..=h.len()]) } else { authority.split(':').next().unwrap_or("") };
    matches!(host.to_ascii_lowercase().as_str(), "localhost" | "127.0.0.1" | "[::1]")
}

/// The `paperclip` of the event: the issues in `tracker` (a missing or odd file reads as none), each without `told`. `None` when the
/// connection is off: no loopback `ARK_PAPERCLIP_URL`, and Node has not said that it is on.
pub fn paperclip(tracker: &Path, url: Option<&str>, cached: &Value) -> Option<Value> {
    if !url.is_some_and(is_loopback_url) && cached.get("paperclip").is_none() {
        return None;
    }
    let mut issues = std::fs::read_to_string(tracker).ok().and_then(|text| serde_json::from_str::<Vec<Value>>(&text).ok()).unwrap_or_default();
    for issue in &mut issues {
        if let Some(object) = issue.as_object_mut() {
            object.remove("told");
        }
    }
    Some(json!({ "issues": issues }))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn the_plan_models_have_tiers_and_nodes_live_list_wins() {
        let table = models(&Value::Null);
        assert_eq!(table.as_array().unwrap().iter().map(|m| (m["id"].as_str().unwrap(), m["tier"].as_str().unwrap())).collect::<Vec<_>>(), [("claude-opus-5-5", "large"), ("claude-sonnet-5-5", "medium"), ("claude-haiku-4-5-20251001", "small")]);
        assert_eq!(models(&json!({ "models": [{ "id": "x", "name": "X", "tier": "small" }] }))[0]["id"], "x");
        assert_eq!(tiered_models(&[("gpt-5".into(), "GPT".into())]), json!([]));
    }

    #[test]
    fn only_a_loopback_url_turns_paperclip_on() {
        for ok in ["http://localhost:3100", "https://127.0.0.1/x", " http://[::1]:80 ", "HTTP://LOCALHOST"] {
            assert!(is_loopback_url(ok), "{ok}");
        }
        for bad in ["", "ftp://localhost", "http://example.com", "http://user:pw@localhost", "http://localhost.evil.com", "localhost"] {
            assert!(!is_loopback_url(bad), "{bad}");
        }
    }

    #[test]
    fn the_issues_come_from_the_file_without_the_told_flag() {
        let file = std::env::temp_dir().join(format!("ark-paperclip-{}.json", std::process::id()));
        assert_eq!(paperclip(&file, None, &Value::Null), None, "off");
        assert_eq!(paperclip(&file, Some("http://localhost:1"), &Value::Null), Some(json!({ "issues": [] })), "a missing file reads as none");
        std::fs::write(&file, r#"[{"id":"a","title":"T","agent":"x","status":"open","createdAt":"c","told":true,"result":"r"}]"#).unwrap();
        assert_eq!(paperclip(&file, None, &json!({ "paperclip": { "issues": [] } })).unwrap()["issues"][0], json!({ "id": "a", "title": "T", "agent": "x", "status": "open", "createdAt": "c", "result": "r" }));
        std::fs::write(&file, "{}").unwrap();
        assert_eq!(paperclip(&file, Some("http://localhost:1"), &Value::Null), Some(json!({ "issues": [] })), "a file with an object reads as none");
        std::fs::remove_file(&file).unwrap();
    }
}
