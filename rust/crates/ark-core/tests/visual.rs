//! apps/mac/island/Tests/ArkIslandCoreTests/ArkVisualTests.swift, one for one. The Select text case needs the chat
//! transcript (not in Phase 1) and is not ported.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_core::visual::*;

const SAMPLE: &str = r#"
{"title":"Test run","blocks":[
  {"type":"stats","items":[{"label":"Passed","value":19,"tone":"good"},{"label":"Failed","value":"2","note":"2 flaky","tone":"bad"},{"label":"Duration","value":"3.4s"}]},
  {"type":"bar","title":"Slowest tests","unit":"ms","data":[{"label":"checkout","value":1200},{"label":"login","value":340.5}]},
  {"type":"line","data":[{"label":"Mon","value":1},{"label":"Tue","value":3}]},
  {"type":"table","title":"Failures","columns":["Test","Error"],"rows":[["cart total","expected 3, got 2"],["retry",408]]}
]}
"#;

fn s(text: &str) -> String {
    text.to_string()
}

fn point(label: &str, value: f64) -> Point {
    Point { label: s(label), value }
}

fn stat(label: &str, value: &str, note: Option<&str>, tone: Tone) -> Stat {
    Stat { label: s(label), value: s(value), note: note.map(s), tone }
}

#[test]
fn a_whole_card_parses() {
    let visual = ArkVisual::parse(SAMPLE).unwrap();
    assert_eq!(visual.title, "Test run");
    assert_eq!(visual.blocks.len(), 4);
    assert_eq!(visual.blocks[0], Block::Stats { title: None, items: vec![
        stat("Passed", "19", None, Tone::Good),
        stat("Failed", "2", Some("2 flaky"), Tone::Bad),
        stat("Duration", "3.4s", None, Tone::Neutral),
    ] });
    assert_eq!(visual.blocks[1], Block::Bar { title: Some(s("Slowest tests")), unit: Some(s("ms")), data: vec![point("checkout", 1200.0), point("login", 340.5)] });
    assert_eq!(visual.blocks[2], Block::Line { title: None, unit: None, data: vec![point("Mon", 1.0), point("Tue", 3.0)] });
    assert_eq!(visual.blocks[3], Block::Table { title: Some(s("Failures")), columns: vec![s("Test"), s("Error")], rows: vec![vec![s("cart total"), s("expected 3, got 2")], vec![s("retry"), s("408")]] });
}

#[test]
fn limits_hold() {
    let bar = |n: usize| {
        let data: Vec<String> = (0..n).map(|i| format!(r#"{{"label":"L{i}","value":{i}}}"#)).collect();
        format!(r#"{{"title":"T","blocks":[{{"type":"bar","data":[{}]}}]}}"#, data.join(","))
    };
    assert!(ArkVisual::parse(&bar(MAX_POINTS)).is_some());
    assert!(ArkVisual::parse(&bar(MAX_POINTS + 1)).is_none());
    let blocks = |n: usize| {
        let one = r#"{"type":"stats","items":[{"label":"A","value":"1"}]}"#;
        format!(r#"{{"title":"T","blocks":[{}]}}"#, vec![one; n].join(","))
    };
    assert!(ArkVisual::parse(&blocks(MAX_BLOCKS)).is_some());
    assert!(ArkVisual::parse(&blocks(MAX_BLOCKS + 1)).is_none());
    let table = |n: usize| format!(r#"{{"title":"T","blocks":[{{"type":"table","columns":["A"],"rows":[{}]}}]}}"#, vec![r#"["x"]"#; n].join(","));
    assert!(ArkVisual::parse(&table(MAX_ROWS)).is_some());
    assert!(ArkVisual::parse(&table(MAX_ROWS + 1)).is_none());
    let long = "a".repeat(MAX_SHORT + 1);
    assert!(ArkVisual::parse(&format!(r#"{{"title":"{long}","blocks":[{{"type":"stats","items":[{{"label":"A","value":"1"}}]}}]}}"#)).is_none());
    let card = r#"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#;
    assert!(ArkVisual::parse(&format!("{card}{}", " ".repeat(MAX_BYTES - card.len()))).is_some());
    assert!(ArkVisual::parse(&format!("{card}{}", " ".repeat(MAX_BYTES - card.len() + 1))).is_none());
}

#[test]
fn a_stats_block_may_have_a_title() {
    let visual = ArkVisual::parse(r#"{"title":"T","blocks":[{"type":"stats","title":"Summary","items":[{"label":"A","value":"1"}]}]}"#).unwrap();
    assert_eq!(visual.blocks, [Block::Stats { title: Some(s("Summary")), items: vec![stat("A", "1", None, Tone::Neutral)] }]);
    assert!(visual.markdown().starts_with("## T\n\n**Summary**\n\n| Stat | Value |"));
    assert_eq!(visual.accessibility_summary(), "T. Summary: A 1.");
}

/// Keep equal to ARK_VISUAL_EXAMPLE in apps/mac/src/native-core.test.ts.
const PROMPT_EXAMPLE: &str = r#"{"title":"Tests","blocks":[{"type":"stats","items":[{"label":"Failed","value":"2","tone":"bad"}]},{"type":"bar","unit":"ms","data":[{"label":"api","value":420}]}]}"#;

#[test]
fn the_prompt_example_parses() {
    assert!(ArkVisual::parse(PROMPT_EXAMPLE).is_some());
}

#[test]
fn deep_nesting_falls_back_to_code() {
    let deep = format!("{}1{}", "[".repeat(200), "]".repeat(200));
    assert!(ArkVisual::parse(&format!(r#"{{"title":"T","blocks":[{deep}]}}"#)).is_none());
    assert!(ArkVisual::parse(&format!(r#"{{"title":"T","blocks":[{{"type":"table","columns":["A"],"rows":[[{deep}]]}}]}}"#)).is_none());
}

#[test]
fn anything_outside_the_grammar_falls_back_to_code() {
    let rejected = [
        r#"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":1"#,
        r#"not json"#,
        r#"[1,2]"#,
        r#"{"blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#,
        r#"{"title":"T","blocks":[]}"#,
        r#"{"title":"T","blocks":[{"type":"pie","data":[{"label":"a","value":1}]}]}"#,
        r#"{"title":"T","color":"red","blocks":[{"type":"stats","items":[{"label":"A","value":"1"}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A","value":"1","tone":"great"}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":"1"}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":true}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":1},{"label":"a","value":2}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"table","columns":["A","B"],"rows":[["only one"]]}]}"#,
        r#"{"title":"T","blocks":[{"type":"table","columns":["A"],"rows":[[null]]}]}"#,
        r#"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A\nB","value":"1"}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"bar","data":[{"label":"a","value":1e400}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"stats","items":[{"label":"A","value":1e400}]}]}"#,
        r#"{"title":"T","blocks":[{"type":"stats","title":"S\nT","items":[{"label":"A","value":"1"}]}]}"#,
        "{\"title\":\"T\",\"blocks\":[{\"type\":\"stats\",\"items\":[{\"label\":\"A\",\"value\":\"\u{202E}1\"}]}]}",
        "{\"title\":\"T\",\"blocks\":[{\"type\":\"table\",\"columns\":[\"A\"],\"rows\":[[\"x\u{202E}y\"]]}]}",
        "{\"title\":\"T\u{202E}\",\"blocks\":[{\"type\":\"stats\",\"items\":[{\"label\":\"A\",\"value\":\"1\"}]}]}",
        r#"{"title":"T","blocks":[{"type":"table","columns":["A"],"rows":[["x\u202Ey"]]}]}"#,
        r#"<script>alert(1)</script>"#,
    ];
    for json in rejected {
        assert!(ArkVisual::parse(json).is_none(), "{json}");
    }
}

#[test]
fn copy_is_markdown_tables() {
    let text = ArkVisual::parse(SAMPLE).unwrap().markdown();
    assert!(text.starts_with("## Test run\n\n| Stat | Value | Note |\n| --- | --- | --- |\n| Passed | 19 |  |\n| Failed | 2 | 2 flaky |"));
    assert!(text.contains("**Slowest tests**\n\n| Label | Value (ms) |\n| --- | --- |\n| checkout | 1200 |\n| login | 340.5 |"));
    assert!(text.contains("**Failures**\n\n| Test | Error |\n| --- | --- |\n| cart total | expected 3, got 2 |"));
}

#[test]
fn accessibility_summary_names_the_shape() {
    assert_eq!(
        ArkVisual::parse(SAMPLE).unwrap().accessibility_summary(),
        "Test run. Passed 19. Failed 2, 2 flaky. Duration 3.4s. Bar chart Slowest tests with 2 bars, largest checkout 1200 ms. \
         Line chart with 2 points, largest Tue 3. Table Failures with 2 rows: Test, Error."
    );
}
