//! A scripted fake runtime, so the UI is testable without Node (`ark-fake-runtime`).
//!
//! The script is a JSON-lines file. A line with a `when` key is a rule: it names a command type, may have
//! `if` (fields the command must have, equal) and has `emit`, the events to send. Any other line is an event
//! that the fake sends at the start. In `emit`, the string `"$text"` or `"$id"` becomes that field of the
//! command. The fake ends on `quit` or when stdin closes.

use std::io::{BufRead, Write};

use serde_json::Value;

pub struct Script {
    start: Vec<Value>,
    rules: Vec<Value>,
}

impl Script {
    pub fn parse(text: &str) -> Script {
        let (mut start, mut rules) = (Vec::new(), Vec::new());
        for value in text.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
            if value.get("when").is_some() { rules.push(value) } else { start.push(value) }
        }
        Script { start, rules }
    }

    /// The events to send at the start.
    pub fn start(&self) -> &[Value] {
        &self.start
    }

    /// The events to send after `command`.
    pub fn answer(&self, command: &Value) -> Vec<Value> {
        let kind = command.get("type").and_then(Value::as_str).unwrap_or_default();
        self.rules
            .iter()
            .filter(|r| r.get("when").and_then(Value::as_str) == Some(kind))
            .filter(|r| r.get("if").and_then(Value::as_object).is_none_or(|want| want.iter().all(|(k, v)| command.get(k) == Some(v))))
            .flat_map(|r| r.get("emit").and_then(Value::as_array).cloned().unwrap_or_default())
            .map(|event| fill(event, command))
            .collect()
    }
}

fn fill(value: Value, command: &Value) -> Value {
    match value {
        Value::String(s) if s == "$text" || s == "$id" => command.get(&s[1..]).cloned().unwrap_or(Value::Null),
        Value::Array(items) => Value::Array(items.into_iter().map(|v| fill(v, command)).collect()),
        Value::Object(map) => Value::Object(map.into_iter().map(|(k, v)| (k, fill(v, command))).collect()),
        other => other,
    }
}

/// Reads commands from `input`, writes events to `output`. Returns at `quit` or end of input.
pub fn run(script: &Script, input: impl BufRead, mut output: impl Write) -> std::io::Result<()> {
    for event in script.start() {
        writeln!(output, "{event}")?;
    }
    output.flush()?;
    for line in input.lines() {
        let Ok(command) = serde_json::from_str::<Value>(&line?) else { continue };
        if command.get("type").and_then(Value::as_str) == Some("quit") {
            break;
        }
        for event in script.answer(&command) {
            writeln!(output, "{event}")?;
        }
        output.flush()?;
    }
    Ok(())
}
