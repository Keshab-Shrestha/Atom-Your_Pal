//! The deterministic gate for the `computer` tool (CLAUDE.md rules 8 and 12).

use ark_agent::{Decision, Policy};
use serde_json::{Map, Value};

use crate::action::{Action, parse_action};

/// Key combos that end the session, lock the Mac or quit apps without asking. ARK never presses them, even with a yes.
const REFUSED_COMBOS: &[&str] = &["cmd+q", "cmd+opt+q", "cmd+shift+q", "ctrl+cmd+q", "cmd+opt+esc", "cmd+opt+escape", "ctrl+cmd+power", "cmd+ctrl+q"];

/// The modifiers sorted, so `shift+cmd+q` and `cmd+shift+q` are the same.
pub(crate) fn normalized(combo: &str) -> String {
    let mut parts: Vec<&str> = combo.split('+').map(str::trim).collect();
    let key = parts.pop().unwrap_or("");
    parts.sort_unstable();
    parts.push(key);
    parts.join("+")
}

fn refused(combo: &str) -> bool {
    let want = normalized(combo);
    REFUSED_COMBOS.iter().any(|c| normalized(c) == want)
}

#[derive(Debug, Clone, Default)]
pub struct ComputerPolicy;

impl Policy for ComputerPolicy {
    fn check(&self, tool: &str, input: &Map<String, Value>) -> Decision {
        if tool != "computer" {
            return Decision::Deny(format!("the tool {tool} is not allowed"));
        }
        let action = match parse_action(input) {
            Ok(a) => a,
            Err(message) => return Decision::Deny(message),
        };
        let ask = |summary: String| Decision::Ask { summary, reason: "ARK moves the mouse and keys on your Mac only after you say yes.".into() };
        match action {
            Action::Status | Action::Screen => Decision::Allow,
            Action::Move { x, y } => ask(format!("Move the pointer to ({x:.0}, {y:.0})")),
            Action::Click { x, y, double } => ask(format!("{} at ({x:.0}, {y:.0})", if double { "Double-click" } else { "Click" })),
            Action::Type { text } => ask(format!("Type {} characters", text.chars().count())),
            Action::Key { combo } if refused(&combo) => Decision::Deny(format!("ARK never presses {combo}: it quits apps or ends the session.")),
            Action::Key { combo } => ask(format!("Press {combo}")),
            Action::Scroll { dx, dy } => ask(format!("Scroll by ({dx}, {dy})")),
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn check(v: Value) -> Decision {
        ComputerPolicy.check("computer", v.as_object().unwrap())
    }

    #[test]
    fn reading_is_allowed_input_asks_and_system_keys_are_refused() {
        assert_eq!(check(json!({"action": "status"})), Decision::Allow);
        assert!(matches!(check(json!({"action": "click", "x": 1, "y": 2})), Decision::Ask { .. }));
        assert!(matches!(check(json!({"action": "type", "text": "hi"})), Decision::Ask { summary, .. } if summary == "Type 2 characters"));
        assert!(matches!(check(json!({"action": "key", "keys": "Shift+Cmd+Q"})), Decision::Deny(_)));
        assert!(matches!(check(json!({"action": "key", "keys": "cmd+c"})), Decision::Ask { .. }));
        assert!(matches!(check(json!({"action": "nope"})), Decision::Deny(_)));
        assert!(matches!(ComputerPolicy.check("run_command", &Map::new()), Decision::Deny(_)));
    }
}
