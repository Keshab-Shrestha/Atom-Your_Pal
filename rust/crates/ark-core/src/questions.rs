//! ADR-275: the questions card. The runtime side of `apps/mac/src/chat-work.ts` (the `ask_user` input: one question
//! or 2–4 from the `questions` JSON string, cleaned of hidden characters; the work strip's tool name) and the window
//! side of `apps/mac/island/Sources/ArkIslandCore/ChatQuestions.swift` (option rows, letter keys, the answer text).

use serde_json::{Map, Value};
use unicode_segmentation::UnicodeSegmentation;

use crate::js;

// ---- chat-work.ts ----

/// One question as the card shows it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Question {
    pub prompt: String,
    pub choices: Vec<String>,
}

/// Control characters (a prompt keeps its line breaks) and the invisible bidi and format characters.
fn is_hidden(c: char) -> bool {
    matches!(c as u32, 0x00..=0x09 | 0x0B..=0x1F | 0x7F..=0x9F | 0x200B..=0x200F | 0x202A..=0x202E | 0x2066..=0x2069 | 0xFEFF)
}

/// The text without hidden characters, trimmed.
pub fn clean(text: &str) -> String {
    let kept: String = text.chars().filter(|c| !is_hidden(*c)).collect();
    js::trim(&kept).to_string()
}

const ONLY_KEYS: &str = "Use only question, choices or questions.";
const NOT_BOTH: &str = "Use either question (+ choices) or questions, not both.";
const JSON_STRING: &str = "questions must be a JSON array string of at most 4000 characters.";
const VALID_JSON: &str = "questions must be valid JSON: an array of {\"question\", \"choices\"} objects.";
const ONE_TO_FOUR: &str = "questions must be an array of one to four objects.";
const AN_OBJECT: &str = "Each question is an object with question and optional choices.";
const SHORT: &str = "Use questions of at most 600 characters and up to four short newline-separated choices.";
const CHOICES: &str = "Use at most four distinct choices per question, each at most 160 characters.";

/// One item of the questions list: its question and choices. `Err`: not an object of those keys.
// JavaScript reads an empty array as an object with no keys, and a non-empty one as an object with keys "0", "1"…
fn fields(item: &Value) -> Result<(Option<&Value>, Option<&Value>), &'static str> {
    match item {
        Value::Object(o) if o.keys().all(|k| k == "question" || k == "choices") => Ok((o.get("question"), o.get("choices"))),
        Value::Array(a) if a.is_empty() => Ok((None, None)),
        _ => Err(AN_OBJECT),
    }
}

fn question(prompt: Option<&Value>, suggestions: Option<&Value>) -> Result<Question, &'static str> {
    let Some(Value::String(prompt)) = prompt else { return Err(SHORT) };
    let suggestions = match suggestions {
        None => None,
        Some(Value::String(s)) if js::utf16_len(s) <= 643 => Some(s),
        Some(_) => return Err(SHORT),
    };
    if clean(prompt).is_empty() || js::utf16_len(prompt) > 600 {
        return Err(SHORT);
    }
    let choices: Vec<String> = suggestions.map(|s| s.split('\n').map(clean).filter(|c| !c.is_empty()).collect()).unwrap_or_default();
    let distinct: std::collections::HashSet<&String> = choices.iter().collect();
    if choices.len() > 4 || choices.iter().any(|c| js::utf16_len(c) > 160) || distinct.len() != choices.len() {
        return Err(CHOICES);
    }
    Ok(Question { prompt: clean(prompt), choices })
}

/// ADR-275: the `ask_user` input as questions, or the refusal to send back.
// ponytail: serde_json refuses a lone surrogate escape and a number past f64 that JSON.parse accepts; such a string
// gets the "valid JSON" refusal here instead of a later one.
pub fn parse_questions(input: &Map<String, Value>) -> Result<Vec<Question>, &'static str> {
    if input.keys().any(|k| !matches!(k.as_str(), "question" | "choices" | "questions")) {
        return Err(ONLY_KEYS);
    }
    let Some(questions) = input.get("questions") else {
        return question(input.get("question"), input.get("choices")).map(|q| vec![q]);
    };
    if input.contains_key("question") || input.contains_key("choices") {
        return Err(NOT_BOTH);
    }
    let Value::String(text) = questions else { return Err(JSON_STRING) };
    if js::utf16_len(text) > 4_000 {
        return Err(JSON_STRING);
    }
    let raw: Value = serde_json::from_str(text).map_err(|_| VALID_JSON)?;
    let items = raw.as_array().filter(|a| (1..=4).contains(&a.len())).ok_or(ONE_TO_FOUR)?;
    items
        .iter()
        .map(|item| {
            let (prompt, choices) = fields(item)?;
            question(prompt, choices)
        })
        .collect()
}

/// The tool name the work strip shows: a plain name without ARK's prefixes, or "Provider tool".
pub fn tool_name(name: Option<&Value>) -> String {
    let Some(Value::String(name)) = name else { return "Provider tool".into() };
    let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | ':' | '-');
    let length = name.chars().count();
    if !(1..=100).contains(&length) || !name.chars().all(plain) {
        return "Provider tool".into();
    }
    name.strip_prefix("mcp__ark__").or_else(|| name.strip_prefix("ark_")).unwrap_or(name).to_string()
}

// ---- ChatQuestions.swift ----

pub const KEYS: [char; 8] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
pub const MARKER: &str = "(recommended)";
pub const OTHER_LABEL: &str = "Other / none of these";

/// One option row: its label, the dim line under it, the Recommended mark, the letter that picks it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuestionOption {
    pub label: String,
    pub detail: Option<String>,
    pub recommended: bool,
    pub key: char,
}

/// Swift's `.whitespaces`: tab and the space separators (Zs).
fn is_swift_space(c: char) -> bool {
    matches!(c, '\t' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}')
}

/// Swift's `.whitespacesAndNewlines`.
fn is_swift_space_or_newline(c: char) -> bool {
    is_swift_space(c) || matches!(c, '\n' | '\u{0B}' | '\u{0C}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}')
}

/// The text with every "(recommended)" removed, in any ASCII case, and whether there was one.
fn without_marker(line: &str) -> (String, bool) {
    let mut out = line.to_string();
    let mut found = false;
    while let Some(at) = out.to_ascii_lowercase().find(MARKER) {
        out.replace_range(at..at + MARKER.len(), "");
        found = true;
    }
    (out, found)
}

/// Swift's `split(separator: "|", maxSplits: 1)` (empty pieces left out).
fn split_once_bar(line: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut start = 0;
    for (at, g) in line.grapheme_indices(true) {
        if !parts.is_empty() {
            break;
        }
        if g == "|" {
            if at > start {
                parts.push(&line[start..at]);
            }
            start = at + 1;
        }
    }
    if start < line.len() {
        parts.push(&line[start..]);
    }
    parts
}

/// One option per choice line, in order, with letter keys from "a".
pub fn options(choices: &[String]) -> Vec<QuestionOption> {
    choices
        .iter()
        .take(KEYS.len() - 1)
        .enumerate()
        .map(|(index, raw)| {
            let (line, recommended) = without_marker(raw);
            let parts: Vec<&str> = split_once_bar(&line).into_iter().map(|p| p.trim_matches(is_swift_space)).collect();
            let label = parts.first().filter(|p| !p.is_empty()).map_or_else(|| raw.trim_matches(is_swift_space).to_string(), |p| p.to_string());
            let detail = parts.get(1).filter(|p| !p.is_empty()).map(|p| p.to_string());
            QuestionOption { label, detail, recommended, key: KEYS[index] }
        })
        .collect()
}

/// The letter of the "Other / none of these" row: the one after the last option.
pub fn other_key(options: &[QuestionOption]) -> char {
    KEYS[options.len().min(KEYS.len() - 1)]
}

/// The row a letter picks: an option's index, `options.len()` for "Other", `None` for any other key.
pub fn pick(key: char, options: &[QuestionOption]) -> Option<usize> {
    if options.is_empty() {
        return None;
    }
    let lower: Vec<char> = key.to_lowercase().collect();
    let index = KEYS.iter().position(|k| lower == [*k])?;
    (index <= options.len()).then_some(index)
}

/// The pick after an arrow key: down from nothing picks the first row; the ends stop.
pub fn move_pick(pick: Option<usize>, step: i64, options: &[QuestionOption]) -> Option<usize> {
    if options.is_empty() {
        return None;
    }
    let Some(pick) = pick else { return Some(if step > 0 { 0 } else { options.len() }) };
    let moved = i64::try_from(pick).unwrap_or(i64::MAX).saturating_add(step);
    Some(usize::try_from(moved.max(0)).unwrap_or(0).min(options.len()))
}

/// What the owner answers: the picked label (and the note after it), only the note for "Other" or with no pick, and
/// `None` (sent as unanswered) when nothing is picked and the note is blank.
pub fn answer(options: &[QuestionOption], pick: Option<usize>, note: &str) -> Option<String> {
    let note = note.trim_matches(is_swift_space_or_newline);
    match pick {
        Some(p) if p < options.len() => {
            Some(if note.is_empty() { options[p].label.clone() } else { format!("{}. {note}", options[p].label) })
        }
        Some(p) if p == options.len() && !options.is_empty() => {
            Some(if note.is_empty() { "None of these".into() } else { note.into() })
        }
        _ => (!note.is_empty()).then(|| note.to_string()),
    }
}

/// "1 question", "2 questions".
pub fn count_text(n: usize) -> String {
    if n == 1 { "1 question".into() } else { format!("{n} questions") }
}
