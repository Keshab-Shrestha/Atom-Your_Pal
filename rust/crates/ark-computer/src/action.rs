//! One `computer` call, parsed and bounded.

use serde_json::{Map, Value};

pub const MAX_TYPE_CHARS: usize = 2000;
pub const MAX_COORD: f64 = 100_000.0;
pub const MAX_SCROLL: i32 = 200;

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Status,
    Screen,
    Move { x: f64, y: f64 },
    Click { x: f64, y: f64, double: bool },
    Type { text: String },
    /// A key with its modifiers: `cmd+shift+4`. Stored lowercase.
    Key { combo: String },
    Scroll { dx: i32, dy: i32 },
}

fn number(input: &Map<String, Value>, key: &str) -> Result<f64, String> {
    let n = input.get(key).and_then(Value::as_f64).ok_or_else(|| format!("\"{key}\" is a number"))?;
    if !n.is_finite() || !(0.0..=MAX_COORD).contains(&n) {
        return Err(format!("\"{key}\" is outside the screen"));
    }
    Ok(n)
}

pub fn parse_action(input: &Map<String, Value>) -> Result<Action, String> {
    let name = input.get("action").and_then(Value::as_str).ok_or("The computer tool needs an \"action\".")?;
    Ok(match name {
        "status" => Action::Status,
        "screen" => Action::Screen,
        "move" => Action::Move { x: number(input, "x")?, y: number(input, "y")? },
        "click" | "double_click" => Action::Click { x: number(input, "x")?, y: number(input, "y")?, double: name == "double_click" },
        "type" => {
            let text = input.get("text").and_then(Value::as_str).ok_or("\"type\" needs \"text\".")?;
            if text.is_empty() || text.chars().count() > MAX_TYPE_CHARS {
                return Err(format!("\"text\" is 1 to {MAX_TYPE_CHARS} characters."));
            }
            Action::Type { text: text.to_string() }
        }
        "key" => Action::Key { combo: input.get("keys").and_then(Value::as_str).filter(|k| !k.trim().is_empty()).ok_or("\"key\" needs \"keys\", like \"cmd+c\".")?.trim().to_lowercase() },
        "scroll" => {
            let axis = |k: &str| input.get(k).and_then(Value::as_i64).unwrap_or(0).clamp(-i64::from(MAX_SCROLL), i64::from(MAX_SCROLL)) as i32;
            Action::Scroll { dx: axis("dx"), dy: axis("dy") }
        }
        other => return Err(format!("\"{other}\" is not a computer action. Use: status, screen, move, click, double_click, type, key, scroll.")),
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse(v: Value) -> Result<Action, String> {
        parse_action(v.as_object().unwrap())
    }

    #[test]
    fn it_parses_the_actions_and_refuses_bad_input() {
        assert_eq!(parse(json!({"action": "double_click", "x": 10, "y": 20.5})).unwrap(), Action::Click { x: 10.0, y: 20.5, double: true });
        assert_eq!(parse(json!({"action": "key", "keys": " CMD+C "})).unwrap(), Action::Key { combo: "cmd+c".into() });
        assert_eq!(parse(json!({"action": "scroll", "dy": 9999})).unwrap(), Action::Scroll { dx: 0, dy: MAX_SCROLL });
        assert!(parse(json!({"action": "click", "x": -1, "y": 0})).is_err());
        assert!(parse(json!({"action": "type", "text": ""})).is_err());
        assert!(parse(json!({"action": "type", "text": "a".repeat(MAX_TYPE_CHARS + 1)})).is_err());
        assert!(parse(json!({"action": "shell"})).unwrap_err().contains("not a computer action"));
    }
}
