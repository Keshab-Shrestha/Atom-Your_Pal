/// Telegram's limit for one message, in characters.
pub const MESSAGE_LIMIT: usize = 4096;

/// Splits text into parts of at most `MESSAGE_LIMIT` characters, at a line break when one is in the second half of a part.
/// A part is never blank (Telegram answers 400). Splits fall on character boundaries, so an emoji is never cut.
pub fn split_message(text: &str) -> Vec<String> {
    let mut rest = text.trim();
    if rest.is_empty() {
        rest = "…";
    }
    let mut parts = Vec::new();
    while rest.chars().count() > MESSAGE_LIMIT {
        let end = rest.char_indices().nth(MESSAGE_LIMIT).map_or(rest.len(), |(i, _)| i);
        let cut = rest[..end].rfind('\n').filter(|&i| rest[..i].chars().count() > MESSAGE_LIMIT / 2).unwrap_or(end);
        parts.push(rest[..cut].to_string());
        rest = rest[cut..].strip_prefix('\n').unwrap_or(&rest[cut..]);
    }
    if !rest.trim().is_empty() || parts.is_empty() {
        parts.push(rest.to_string());
    }
    parts
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn splits_at_line_breaks_and_never_cuts_an_emoji() {
        assert_eq!(split_message("  "), vec!["…"]);
        assert_eq!(split_message("hi"), vec!["hi"]);
        let text = format!("{}\n{}", "a".repeat(3000), "b".repeat(3000));
        let parts = split_message(&text);
        assert_eq!((parts[0].len(), parts[1].len()), (3000, 3000));
        let emoji = "😀".repeat(MESSAGE_LIMIT + 5);
        let parts = split_message(&emoji);
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].chars().count(), MESSAGE_LIMIT);
        assert!(parts.iter().all(|p| p.chars().all(|c| c == '😀')));
    }
}
