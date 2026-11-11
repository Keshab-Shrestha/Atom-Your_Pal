//! The ChatQuestions cases of apps/mac/island/Tests/ArkIslandCoreTests/TranscriptCardsTests.swift and the parse
//! cases of apps/mac/src/chat-work.test.ts (on the parser alone, without the tool runner), one for one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_core::questions::*;
use serde_json::{Map, Value, json};

fn strings(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

fn input(value: Value) -> Map<String, Value> {
    value.as_object().unwrap().clone()
}

#[test]
fn choice_lines_become_options_with_a_sub_line_a_recommended_mark_and_letter_keys() {
    let options = options(&strings(&["Postgres | Fits the current stack (recommended)", "SQLite", "  | only a reason"]));
    assert_eq!(options.iter().map(|o| o.label.as_str()).collect::<Vec<_>>(), ["Postgres", "SQLite", "| only a reason"]);
    assert!(options[0].detail.as_deref() == Some("Fits the current stack") && options[0].recommended);
    assert!(options[1].detail.is_none() && !options[1].recommended);
    assert_eq!(options.iter().map(|o| o.key).collect::<Vec<_>>(), ['a', 'b', 'c']);
    assert_eq!(other_key(&options), 'd');
    assert_eq!(
        ark_core::questions::options(&strings(&["Keep it (Recommended)"]))[0],
        QuestionOption { label: "Keep it".into(), detail: None, recommended: true, key: 'a' }
    );
}

#[test]
fn letter_and_arrow_keys_pick_rows_and_the_answer_follows_the_pick_and_the_note() {
    let options = options(&strings(&["Yes", "No"]));
    assert_eq!(pick('a', &options), Some(0));
    assert_eq!(pick('B', &options), Some(1));
    assert_eq!(pick('c', &options), Some(2), "c is Other");
    assert_eq!(pick('d', &options), None);
    assert_eq!(pick('a', &[]), None, "no options: letters type into the note");
    assert_eq!(move_pick(None, 1, &options), Some(0));
    assert_eq!(move_pick(None, -1, &options), Some(2));
    assert!(move_pick(Some(2), 1, &options) == Some(2) && move_pick(Some(0), -1, &options) == Some(0));
    assert_eq!(answer(&options, Some(0), " ").as_deref(), Some("Yes"));
    assert_eq!(answer(&options, Some(1), "after Friday").as_deref(), Some("No. after Friday"));
    assert_eq!(answer(&options, Some(2), "").as_deref(), Some("None of these"));
    assert_eq!(answer(&options, Some(2), "Maybe later").as_deref(), Some("Maybe later"));
    assert_eq!(answer(&options, None, ""), None, "blank is sent as unanswered");
    assert_eq!(answer(&[], None, "Thursday").as_deref(), Some("Thursday"));
    assert_eq!(count_text(2), "2 questions");
}

#[test]
fn one_call_with_questions_keeps_every_question_and_its_choice_lines() {
    let text = json!([
        { "question": "Which database?", "choices": "Postgres | Fits the stack (recommended)\nSQLite" },
        { "question": "When?" },
    ])
    .to_string();
    let asked = parse_questions(&input(json!({ "questions": text }))).unwrap();
    assert_eq!(asked.len(), 2);
    assert_eq!(asked[0].choices, ["Postgres | Fits the stack (recommended)", "SQLite"]);
    assert_eq!(parse_questions(&input(json!({ "question": "Ship today?", "choices": "Yes\nNo" }))).unwrap()[0].choices, ["Yes", "No"]);
}

#[test]
fn bad_inputs_are_refused() {
    let refused = |v: Value| parse_questions(&input(v)).is_err();
    assert!(refused(json!({ "question": "A?", "questions": "[]" })), "not both forms");
    assert!(refused(json!({ "questions": "not json" })));
    let five: Vec<Value> = (1..=5).map(|n| json!({ "question": format!("Q{n}?") })).collect();
    assert!(refused(json!({ "questions": Value::Array(five).to_string() })), "at most four");
    assert!(refused(json!({ "questions": json!([{ "question": "A?", "extra": 1 }]).to_string() })));
    assert!(refused(json!({ "question": "A?", "choices": "x".repeat(161) })), "a choice is at most 160 characters");
}

#[test]
fn control_and_invisible_bidi_and_format_characters_are_removed() {
    let asked = parse_questions(&input(json!({
        "question": "Del\u{202E}ete\u{200B} the\u{7} file?\nWhy",
        "choices": "Ye\u{2066}s\u{FEFF}\n\u{200F}\nN\u{0}o",
    })))
    .unwrap();
    assert_eq!(asked[0].prompt, "Delete the file?\nWhy");
    assert_eq!(asked[0].choices, ["Yes", "No"]);
    assert!(parse_questions(&input(json!({ "question": "\u{202E}\u{200B}" }))).is_err(), "a prompt of only hidden characters is refused");
}
