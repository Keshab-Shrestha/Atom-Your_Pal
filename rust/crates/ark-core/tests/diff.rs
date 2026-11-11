//! apps/mac/island/Tests/ArkIslandCoreTests/TextDiffTests.swift and the UnifiedDiff cases of
//! TranscriptCardsTests.swift, one for one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use ark_core::diff::*;
use unicode_segmentation::UnicodeSegmentation;

/// The independent check: apply the chosen hunks to the old text by hand.
fn apply(old: &str, hunks: &[DiffHunk], accepting: impl Fn(&DiffHunk) -> bool) -> String {
    let o: Vec<u16> = old.encode_utf16().collect();
    let mut out: Vec<u16> = Vec::new();
    let mut cursor = 0;
    for h in hunks {
        out.extend(&o[cursor..h.old_range.start]);
        if accepting(h) {
            out.extend(h.new_text.encode_utf16());
        } else {
            out.extend(&o[h.old_range.clone()]);
        }
        cursor = h.old_range.end;
    }
    out.extend(&o[cursor..]);
    String::from_utf16(&out).unwrap()
}

fn check(old: &str, new: &str) {
    let hunks = hunks(old, new);
    assert_eq!(apply(old, &hunks, |_| true), new, "accept all is the new text");
    assert_eq!(apply(old, &hunks, |_| false), old, "deny all is the old text");
    let o: Vec<u16> = old.encode_utf16().collect();
    let n: Vec<u16> = new.encode_utf16().collect();
    let mut old_end = 0;
    for h in &hunks {
        assert!(h.old_range.start >= old_end && h.old_range.end <= o.len(), "ordered, inside the old text");
        assert!(h.new_range.end <= n.len());
        assert_eq!(h.old_text, String::from_utf16(&o[h.old_range.clone()]).unwrap());
        assert_eq!(h.new_text, String::from_utf16(&n[h.new_range.clone()]).unwrap());
        assert!(!(h.old_range.is_empty() && h.new_range.is_empty()), "a hunk changes something");
        old_end = h.old_range.end;
    }
    assert!(hunks.iter().enumerate().all(|(i, h)| h.id == i), "ids are the positions");
}

/// UTF-16 offsets of the character boundaries (EditRequest.boundaries).
fn boundaries(text: &str) -> Vec<usize> {
    let mut out = vec![0];
    for g in text.graphemes(true) {
        out.push(out[out.len() - 1] + g.encode_utf16().count());
    }
    out
}

#[test]
fn identical_texts_have_no_hunks() {
    assert!(hunks("same\ntext", "same\ntext").is_empty());
    assert!(hunks("", "").is_empty());
}

#[test]
fn an_insertion_and_a_deletion_of_whole_lines() {
    let inserted = hunks("a\nc\n", "a\nb\nc\n");
    assert_eq!(inserted.len(), 1);
    assert!(inserted[0].old_text.is_empty() && inserted[0].new_text == "b\n");
    assert!(inserted[0].old_range == (2..2) && inserted[0].new_range == (2..4));
    let deleted = hunks("a\nb\nc\n", "a\nc\n");
    assert_eq!(deleted.len(), 1);
    assert!(deleted[0].old_text == "b\n" && deleted[0].new_text.is_empty());
    check("a\nc\n", "a\nb\nc\n");
    check("a\nb\nc\n", "a\nc\n");
}

#[test]
fn a_replaced_line_shows_the_changed_words_only() {
    let h = hunks("Buy milk today\nCall Sam\n", "Buy oat milk today\nCall Sam\n");
    assert_eq!(h.len(), 1);
    assert!(h[0].old_text.is_empty() && h[0].new_text.trim() == "oat", "the word, with one space");
    let swap = hunks("The quick brown fox", "The slow brown fox");
    assert!(swap.len() == 1 && swap[0].old_text == "quick" && swap[0].new_text == "slow");
    check("Buy milk today\nCall Sam\n", "Buy oat milk today\nCall Sam\n");
    check("The quick brown fox", "The slow brown fox");
}

#[test]
fn changes_separated_only_by_a_space_are_one() {
    let h = hunks("one two three", "uno dos three");
    assert_eq!(h.len(), 1);
    assert!(h[0].old_text == "one two" && h[0].new_text == "uno dos");
}

#[test]
fn moved_lines_are_a_delete_and_an_insert() {
    check("a\nb\nc\nd\n", "d\nb\nc\na\n");
    check("a\nb\nc\n", "c\nb\na\n");
}

#[test]
fn trailing_newlines_and_empty_texts() {
    check("a\nb", "a\nb\n");
    check("a\nb\n", "a\nb");
    check("", "new text\n");
    check("old text\n", "");
    check("\n\n", "\n");
    check("a\r\nb\r\n", "a\r\nc\r\n");
}

#[test]
fn emoji_and_japanese_are_never_split() {
    check("今日は天気がいいですね。\nありがとう", "今日は天気が悪いですね。\nありがとうございます");
    check("I like 🍎 and 👨‍👩‍👧‍👦 very much", "I like 🍌 and 👨‍👩‍👧‍👦 very much");
    check("🍎", "🍎🍎");
    let family = "👨‍👩‍👧‍👦";
    let old = format!("a {family} b");
    let marks = boundaries(&old);
    for h in hunks(&old, &format!("a {family}{family} b")) {
        assert!(marks.contains(&h.old_range.start) && marks.contains(&h.old_range.end), "every offset is on a character boundary");
    }
}

#[test]
fn random_edits_always_round_trip() {
    let mut seed: u64 = 42;
    let mut next = |n: usize| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((seed >> 33) % n as u64) as usize
    };
    let words = ["alpha", "beta", "gamma", "delta", "今日", "天気", "🍎", "x", "the", "a"];
    let text = |next: &mut dyn FnMut(usize) -> usize| {
        let lines: Vec<String> = (0..next(8))
            .map(|_| {
                let picked: Vec<&str> = (0..1 + next(5)).map(|_| words[next(words.len())]).collect();
                picked.join(if next(5) == 0 { "" } else { " " })
            })
            .collect();
        lines.join(if next(6) == 0 { "\r\n" } else { "\n" })
    };
    for _ in 0..200 {
        let old = text(&mut next);
        let new = if next(3) == 0 {
            text(&mut next)
        } else {
            let (from, to) = (words[next(words.len())], words[next(words.len())]);
            old.replace(from, to)
        };
        check(&old, &new);
    }
}

#[test]
fn a_large_text_with_a_few_edits_is_fast() {
    let lines: Vec<String> = (0..2_000).map(|i| format!("Line {i}: the quick brown fox jumps over the lazy dog")).collect();
    let mut changed = lines.clone();
    for i in (50..2_000).step_by(100) {
        changed[i] = format!("Line {i}: the slow brown fox jumps over the lazy cat");
    }
    let (old, new) = (lines.join("\n"), changed.join("\n"));
    assert!(old.encode_utf16().count() > 100_000);
    let start = std::time::Instant::now();
    let h = hunks(&old, &new);
    assert!(start.elapsed().as_secs() < 3);
    assert_eq!(h.len(), 40, "two words change on each of 20 lines, and the words between them stay");
    assert_eq!(apply(&old, &h, |_| true), new);
}

#[test]
fn a_whole_new_text_is_one_change_not_a_million_steps() {
    let old = (0..3_000).map(|i| format!("old {i}")).collect::<Vec<_>>().join("\n");
    let new = (0..3_000).map(|i| format!("new line {}", i * 7)).collect::<Vec<_>>().join("\n");
    let start = std::time::Instant::now();
    let h = hunks(&old, &new);
    // Debug builds are slower than Swift's release test; 5 s holds there as well.
    assert!(start.elapsed().as_secs() < 5 * 4);
    assert_eq!(apply(&old, &h, |_| true), new);
}

#[test]
fn a_text_over_five_thousand_lines_is_compared_by_lines() {
    let rows: Vec<String> = (0..5_100).map(|i| format!("row {i}")).collect();
    let mut changed = rows.clone();
    changed[10] = "row ten".into();
    let h = hunks(&rows.join("\n"), &changed.join("\n"));
    assert_eq!(h.len(), 1);
    assert!(h[0].old_text == "row 10\n" && h[0].new_text == "row ten\n", "whole lines, no words");
}

// ---- TranscriptCardsTests.swift (UnifiedDiff) ----

fn kinds(lines: &[DiffLine]) -> Vec<LineKind> {
    lines.iter().map(|l| l.kind).collect()
}

#[test]
fn a_change_becomes_hunks_with_two_gutters_and_counts() {
    let old = (1..=10).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n") + "\n";
    let new = old.replace("line 5\n", "line five\nline 5b\n");
    let diff = UnifiedDiff::make(&old, &new);
    assert!(diff.added == 2 && diff.removed == 1);
    assert_eq!(diff.hunks.len(), 1);
    let hunk = &diff.hunks[0];
    assert_eq!(hunk.header, "@@ -2,7 +2,8 @@");
    use LineKind::*;
    assert_eq!(kinds(&hunk.lines), [Context, Context, Context, Removed, Added, Added, Context, Context, Context]);
    assert!(hunk.lines[0].old == Some(2) && hunk.lines[0].new == Some(2));
    assert!(hunk.lines[3].old == Some(5) && hunk.lines[3].new.is_none() && hunk.lines[3].text == "line 5");
    assert!(hunk.lines[5].old.is_none() && hunk.lines[5].new == Some(6) && hunk.lines[5].text == "line 5b");
    assert!(hunk.lines[6].old == Some(6) && hunk.lines[6].new == Some(7));
}

#[test]
fn far_changes_are_two_hunks_near_ones_share_one_a_new_file_starts_at_0() {
    use LineKind::*;
    let old = (1..=30).map(|i| format!("l{i}")).collect::<Vec<_>>().join("\n");
    let far = old.replace("l2\n", "x\n").replace("l28\n", "y\n");
    let two = UnifiedDiff::make(&old, &far).hunks;
    assert_eq!(two.len(), 2);
    assert_eq!(two[0].header, "@@ -1,5 +1,5 @@");
    assert_eq!(two[1].header, "@@ -25,6 +25,6 @@");
    assert_eq!(kinds(&two[1].lines), [Context, Context, Context, Removed, Added, Context, Context, Note]);
    assert!(two[1].lines[0].old == Some(25) && two[1].lines[0].new == Some(25) && two[1].lines[0].text == "l25");
    assert!(two[1].lines[3].old == Some(28) && two[1].lines[3].text == "l28" && two[1].lines[4].new == Some(28) && two[1].lines[4].text == "y");
    assert!(two[1].lines[6].old == Some(30) && two[1].lines[6].new == Some(30), "no final newline, so a note follows l30");
    let near = old.replace("l2\n", "x\n").replace("l7\n", "y\n");
    assert_eq!(UnifiedDiff::make(&old, &near).hunks.len(), 1);
    let created = UnifiedDiff::make("", "a\nb\n");
    assert!(created.hunks[0].header == "@@ -0,0 +1,2 @@" && created.added == 2 && created.removed == 0);
    assert!(UnifiedDiff::make("same\n", "same\n").hunks.is_empty());
}

#[test]
fn a_change_to_only_the_final_newline_shows_a_no_newline_note() {
    use LineKind::*;
    let dropped = UnifiedDiff::make("a\nb\n", "a\nb");
    assert!(dropped.added == 1 && dropped.removed == 1);
    assert_eq!(dropped.hunks[0].header, "@@ -1,2 +1,2 @@");
    assert_eq!(kinds(&dropped.hunks[0].lines), [Context, Removed, Added, Note]);
    assert_eq!(dropped.hunks[0].lines.last().unwrap().text, NO_NEWLINE);
    let added = UnifiedDiff::make("a\nb", "a\nb\n");
    assert_eq!(kinds(&added.hunks[0].lines), [Context, Removed, Note, Added]);
    assert!(UnifiedDiff::make("a\nb", "a\nb").hunks.is_empty());
}

#[test]
fn a_removed_line_and_its_added_pair_mark_only_the_changed_characters() {
    use LineKind::*;
    assert_eq!(changed_ranges("Date: Thursday", "Date: Thursday 10:00"), (None, Some(14..20)));
    assert_eq!(changed_ranges("let rate = 10", "let rate = 15"), (Some(12..13), Some(12..13)));
    assert_eq!(changed_ranges("abc", "xyz"), (Some(0..3), Some(0..3)));
    assert_eq!(changed_ranges("aa", "aaa"), (None, Some(2..3)), "a repeated character is not counted twice");
    let diff = UnifiedDiff::make("x\nlet rate = 10\nlet name = a\ny\n", "x\nlet rate = 15\ny\n");
    let lines = &diff.hunks[0].lines;
    assert_eq!(kinds(lines), [Context, Removed, Removed, Added, Context]);
    assert!(lines[1].changed == Some(12..13) && lines[3].changed == Some(12..13), "pairs by position in the change");
    assert_eq!(lines[2].changed, None, "a removed line with no added pair is not marked");
}

fn seg(text: &str, changed: bool, mark: bool) -> Segment {
    Segment { text: text.into(), changed, mark }
}

#[test]
fn hidden_characters_become_visible_marks_and_tabs_and_emoji_stay() {
    assert_eq!(segments("ab\u{202E}c", None), [seg("ab", false, false), seg("⟨U+202E⟩", false, true), seg("c", false, false)]);
    assert_eq!(segments("a\r", Some(1..2)), [seg("a", false, false), seg("␍", true, true)]);
    assert_eq!(segments("x\u{200B}\u{0}\u{7F}", None).iter().map(|s| s.text.as_str()).collect::<Vec<_>>(), ["x", "⟨U+200B⟩␀␡"]);
    assert_eq!(segments("\tok 👨‍👩‍👧", None), [seg("\tok 👨‍👩‍👧", false, false)]);
    assert_eq!(segments("abc", Some(1..2)).iter().map(|s| s.changed).collect::<Vec<_>>(), [false, true, false]);
}

#[test]
fn the_mini_squares_follow_the_counts_and_the_path_splits() {
    assert_eq!(squares(2, 0, 5), (2, 0));
    assert_eq!(squares(40, 10, 5), (4, 1));
    assert_eq!(squares(1, 99, 5), (1, 4), "a side with changes keeps one square");
    assert_eq!(squares(99, 1, 5), (4, 1));
    assert_eq!(squares(0, 0, 5), (0, 0));
    assert_eq!(split_path("/tmp/cedar/launch.md"), ("launch.md", "/tmp/cedar"));
    assert_eq!(split_path("/launch.md"), ("launch.md", "/"));
    assert_eq!(split_path("launch.md"), ("launch.md", ""));
}

#[test]
fn inline_pieces_rebuild_both_texts() {
    let pieces = inline_segments("Steady and careful.", "Steady, careful and kind.");
    let new: String = pieces.iter().filter(|(k, _)| *k != SegmentKind::Removed).map(|(_, t)| t.as_str()).collect();
    let old: String = pieces.iter().filter(|(k, _)| *k != SegmentKind::Added).map(|(_, t)| t.as_str()).collect();
    assert_eq!(new, "Steady, careful and kind.");
    assert_eq!(old, "Steady and careful.");
    assert!(inline_segments("", "").is_empty());
}
