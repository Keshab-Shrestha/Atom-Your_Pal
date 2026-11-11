//! ADR-276: the ```ark-visual result card of `apps/mac/island/Sources/ArkIslandCore/ArkVisual.swift`. One strict
//! JSON object becomes stat tiles, bar and line charts and tables. Pure and total: `parse` returns `None` for anything
//! outside the grammar or its limits, and the window then shows the source as code. Also ported, because the card
//! needs them: the hidden-character count of `HiddenCharacters.strip` (ComposerText.swift), `ReplyChart.number`
//! (ReplyMedia.swift) and the Markdown table of `MarkdownCopy.table` (MarkdownCopy.swift).

use serde_json::{Map, Value};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

pub const LANGUAGE: &str = "ark-visual";
pub const MAX_BYTES: usize = 64_000;
pub const MAX_BLOCKS: usize = 6;
pub const MAX_POINTS: usize = 40;
pub const MAX_STATS: usize = 12;
pub const MAX_ROWS: usize = 200;
pub const MAX_COLUMNS: usize = 8;
pub const MAX_SHORT: usize = 80;
pub const MAX_CELL: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tone {
    Good,
    Bad,
    Neutral,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Stat {
    pub label: String,
    pub value: String,
    pub note: Option<String>,
    pub tone: Tone,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Point {
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Stats { title: Option<String>, items: Vec<Stat> },
    Bar { title: Option<String>, unit: Option<String>, data: Vec<Point> },
    Line { title: Option<String>, unit: Option<String>, data: Vec<Point> },
    Table { title: Option<String>, columns: Vec<String>, rows: Vec<Vec<String>> },
}

#[derive(Debug, Clone, PartialEq)]
pub struct ArkVisual {
    pub title: String,
    pub blocks: Vec<Block>,
}

/// How many characters `HiddenCharacters.strip` removes: bidi controls, zero-width marks and tags (a tagged flag
/// emoji keeps its tags).
pub fn hidden_count(text: &str) -> usize {
    text.graphemes(true)
        .map(|g| {
            let first = g.chars().next().map(u32::from);
            let last = g.chars().last().map(u32::from);
            let flag = first == Some(0x1F3F4) && last == Some(0xE007F);
            g.chars()
                .filter(|c| {
                    let v = u32::from(*c);
                    matches!(v, 0 | 0x061C | 0x200B | 0x200E | 0x200F | 0x2060 | 0xFEFF | 0x202A..=0x202E | 0x2066..=0x2069)
                        || (!flag && (v == 0xE0001 || (0xE0020..=0xE007F).contains(&v)))
                })
                .count()
        })
        .sum()
}

/// Swift's `Character.isNewline`.
fn is_newline(c: char) -> bool {
    matches!(c, '\n' | '\u{0B}' | '\u{0C}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}')
}

/// Swift's `String.count`: grapheme clusters.
pub fn count(text: &str) -> usize {
    text.graphemes(true).count()
}

/// C's `%.<precision>g`.
fn format_g(value: f64, precision: usize) -> String {
    let p = precision.max(1);
    let sci = format!("{:.*e}", p - 1, value);
    let (mantissa, exponent) = sci.split_once('e').unwrap_or((&sci, "0"));
    let exp: i32 = exponent.parse().unwrap_or(0);
    let strip = |s: &str| if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s.to_string() };
    if exp < -4 || exp >= p as i32 {
        let sign = if exp < 0 { '-' } else { '+' };
        format!("{}e{sign}{:02}", strip(mantissa), exp.abs())
    } else {
        let decimals = (p as i32 - 1 - exp).max(0) as usize;
        strip(&format!("{value:.decimals$}"))
    }
}

/// `ReplyChart.number`: a whole number below 1e15 as an integer, else four significant digits.
pub fn number_text(value: f64) -> String {
    if value.round() == value && value.abs() < 1e15 {
        // A whole number below 1e15 fits an i64 exactly.
        #[allow(clippy::cast_possible_truncation)]
        let whole = value as i64;
        whole.to_string()
    } else {
        format_g(value, 4)
    }
}

/// One line with no hidden characters (a U+202E would reverse what the card shows).
fn plain(s: &str) -> bool {
    !s.chars().any(is_newline) && hidden_count(s) == 0
}

/// A one-line text within MAX_SHORT.
fn short(value: Option<&Value>) -> Option<String> {
    let s = value?.as_str()?;
    (count(s) <= MAX_SHORT && plain(s)).then(|| s.to_string())
}

/// An absent title or unit is fine (`Some(None)`); a present one must be valid, else `None`.
fn optional(value: Option<&Value>) -> Option<Option<String>> {
    match value {
        None => Some(None),
        some => short(some).map(Some),
    }
}

/// A finite JSON number (never a boolean).
fn number(value: Option<&Value>) -> Option<f64> {
    value?.as_f64().filter(|n| n.is_finite())
}

/// A table cell or stat value: text, or a number written as ARK writes numbers.
fn cell(value: Option<&Value>, limit: usize) -> Option<String> {
    if let Some(s) = value.and_then(Value::as_str) {
        return (count(s) <= limit && plain(s)).then(|| s.to_string());
    }
    number(value).map(number_text)
}

fn keys_within(object: &Map<String, Value>, allowed: &[&str]) -> bool {
    object.keys().all(|k| allowed.contains(&k.as_str()))
}

fn sized(value: Option<&Value>, max: usize) -> Option<&Vec<Value>> {
    value?.as_array().filter(|a| (1..=max).contains(&a.len()))
}

fn stats_block(b: &Map<String, Value>) -> Option<Block> {
    if !keys_within(b, &["type", "title", "items"]) {
        return None;
    }
    let title = optional(b.get("title"))?;
    let mut items = Vec::new();
    for entry in sized(b.get("items"), MAX_STATS)? {
        let s = entry.as_object().filter(|s| keys_within(s, &["label", "value", "note", "tone"]))?;
        let label = short(s.get("label"))?;
        let value = cell(s.get("value"), MAX_SHORT)?;
        let note = match s.get("note") {
            None => None,
            some => Some(short(some)?),
        };
        let tone = match s.get("tone") {
            None => Tone::Neutral,
            Some(t) => match t.as_str()? {
                "good" => Tone::Good,
                "bad" => Tone::Bad,
                "neutral" => Tone::Neutral,
                _ => return None,
            },
        };
        items.push(Stat { label, value, note, tone });
    }
    Some(Block::Stats { title, items })
}

fn chart_block(b: &Map<String, Value>, bar: bool) -> Option<Block> {
    if !keys_within(b, &["type", "title", "unit", "data"]) {
        return None;
    }
    let title = optional(b.get("title"))?;
    let unit = optional(b.get("unit"))?;
    let mut data = Vec::new();
    for entry in sized(b.get("data"), MAX_POINTS)? {
        let p = entry.as_object().filter(|p| p.len() == 2 && p.contains_key("label") && p.contains_key("value"))?;
        data.push(Point { label: short(p.get("label"))?, value: number(p.get("value"))? });
    }
    // A repeated label would merge on the axis. Swift compares strings by canonical equivalence.
    let labels: std::collections::HashSet<String> = data.iter().map(|p| p.label.nfc().collect()).collect();
    if labels.len() != data.len() {
        return None;
    }
    Some(if bar { Block::Bar { title, unit, data } } else { Block::Line { title, unit, data } })
}

fn table_block(b: &Map<String, Value>) -> Option<Block> {
    if !keys_within(b, &["type", "title", "columns", "rows"]) {
        return None;
    }
    let title = optional(b.get("title"))?;
    let columns: Vec<String> = sized(b.get("columns"), MAX_COLUMNS)?.iter().map(|c| short(Some(c))).collect::<Option<_>>()?;
    let mut rows = Vec::new();
    for entry in sized(b.get("rows"), MAX_ROWS)? {
        let r = entry.as_array().filter(|r| r.len() == columns.len())?;
        rows.push(r.iter().map(|c| cell(Some(c), MAX_CELL)).collect::<Option<Vec<_>>>()?);
    }
    Some(Block::Table { title, columns, rows })
}

fn block(b: &Map<String, Value>) -> Option<Block> {
    match b.get("type")?.as_str()? {
        "stats" => stats_block(b),
        "bar" => chart_block(b, true),
        "line" => chart_block(b, false),
        "table" => table_block(b),
        _ => None,
    }
}

impl ArkVisual {
    pub fn parse(json: &str) -> Option<ArkVisual> {
        if json.len() > MAX_BYTES {
            return None;
        }
        let root: Value = serde_json::from_str(json).ok()?;
        let root = root.as_object().filter(|r| keys_within(r, &["title", "blocks"]))?;
        let title = short(root.get("title")).filter(|t| !t.is_empty())?;
        let blocks = sized(root.get("blocks"), MAX_BLOCKS)?.iter().map(|b| b.as_object().and_then(block)).collect::<Option<Vec<_>>>()?;
        Some(ArkVisual { title, blocks })
    }

    /// Each block as rows, for Copy and for the Select text page: (title, header, rows).
    pub fn table_of(block: &Block) -> (Option<&str>, Vec<String>, Vec<Vec<String>>) {
        match block {
            Block::Stats { title, items } => {
                let notes = items.iter().any(|s| s.note.is_some());
                let header = if notes { vec!["Stat", "Value", "Note"] } else { vec!["Stat", "Value"] };
                let rows = items
                    .iter()
                    .map(|s| {
                        let mut row = vec![s.label.clone(), s.value.clone()];
                        if notes {
                            row.push(s.note.clone().unwrap_or_default());
                        }
                        row
                    })
                    .collect();
                (title.as_deref(), header.into_iter().map(String::from).collect(), rows)
            }
            Block::Bar { title, unit, data } | Block::Line { title, unit, data } => {
                let value = unit.as_ref().map_or_else(|| "Value".to_string(), |u| format!("Value ({u})"));
                let rows = data.iter().map(|p| vec![p.label.clone(), number_text(p.value)]).collect();
                (title.as_deref(), vec!["Label".into(), value], rows)
            }
            Block::Table { title, columns, rows } => (title.as_deref(), columns.clone(), rows.clone()),
        }
    }

    /// What Copy puts on the clipboard: the title, then each block as a Markdown table under its own title.
    pub fn markdown(&self) -> String {
        let mut parts = vec![format!("## {}", self.title)];
        for block in &self.blocks {
            let (heading, header, rows) = Self::table_of(block);
            let text = markdown_table(&header, &rows);
            parts.push(match heading {
                Some(h) => format!("**{h}**\n\n{text}"),
                None => text,
            });
        }
        parts.join("\n\n")
    }

    /// What VoiceOver reads: the title, each stat, and the shape of each chart and table, never every row.
    pub fn accessibility_summary(&self) -> String {
        let mut parts = vec![self.title.clone()];
        for block in &self.blocks {
            parts.push(match block {
                Block::Stats { title, items } => {
                    let stats: Vec<String> = items
                        .iter()
                        .map(|s| format!("{} {}{}", s.label, s.value, s.note.as_ref().map(|n| format!(", {n}")).unwrap_or_default()))
                        .collect();
                    format!("{}{}", title.as_ref().map(|t| format!("{t}: ")).unwrap_or_default(), stats.join(". "))
                }
                Block::Bar { title, unit, data } => {
                    let n = if data.len() == 1 { "1 bar".into() } else { format!("{} bars", data.len()) };
                    chart("Bar chart", title.as_deref(), &n, largest(data), unit.as_deref())
                }
                Block::Line { title, unit, data } => {
                    let n = if data.len() == 1 { "1 point".into() } else { format!("{} points", data.len()) };
                    chart("Line chart", title.as_deref(), &n, largest(data), unit.as_deref())
                }
                Block::Table { title, columns, rows } => format!(
                    "Table{} with {} {}: {}",
                    title.as_ref().map(|t| format!(" {t}")).unwrap_or_default(),
                    rows.len(),
                    if rows.len() == 1 { "row" } else { "rows" },
                    columns.join(", ")
                ),
            });
        }
        format!("{}.", parts.join(". "))
    }
}

/// Swift's `max(by:)`: the first of the largest values.
fn largest(data: &[Point]) -> Option<&Point> {
    data.iter().fold(None, |best: Option<&Point>, p| match best {
        Some(b) if b.value >= p.value || p.value.is_nan() => Some(b),
        _ => Some(p),
    })
}

fn chart(kind: &str, title: Option<&str>, count: &str, top: Option<&Point>, unit: Option<&str>) -> String {
    let largest = top
        .map(|p| format!(", largest {} {}{}", p.label, number_text(p.value), unit.map(|u| format!(" {u}")).unwrap_or_default()))
        .unwrap_or_default();
    format!("{kind}{} with {count}{largest}", title.map(|t| format!(" {t}")).unwrap_or_default())
}

/// `MarkdownCopy.table` in Markdown format, with no column alignment.
pub fn markdown_table(header: &[String], rows: &[Vec<String>]) -> String {
    let row = |cells: &[String]| format!("| {} |", cells.iter().map(|c| markdown_cell(c)).collect::<Vec<_>>().join(" | "));
    let marks: Vec<String> = header.iter().map(|_| "---".to_string()).collect();
    let mut lines = vec![row(header), row(&marks)];
    for r in rows {
        let mut padded: Vec<String> = r.iter().take(header.len()).cloned().collect();
        padded.resize(header.len(), String::new());
        lines.push(row(&padded));
    }
    lines.join("\n")
}

/// One table cell: line breaks become spaces and an unescaped "|" is escaped.
fn markdown_cell(text: &str) -> String {
    let line = text.replace("\r\n", " ").replace(['\n', '\r'], " ");
    let mut out = String::with_capacity(line.len());
    let mut escaped = false;
    for g in line.graphemes(true) {
        if g == "|" && !escaped {
            out.push('\\');
        }
        out.push_str(g);
        escaped = if g == "\\" { !escaped } else { false };
    }
    // A trailing odd backslash must not escape the table's closing separator.
    if escaped {
        out.push('\\');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_read_like_swift() {
        assert_eq!(number_text(1200.0), "1200");
        assert_eq!(number_text(340.5), "340.5");
        assert_eq!(number_text(-0.0), "0");
        assert_eq!(number_text(0.000_12), "0.00012");
        assert_eq!(number_text(1e15), "1e+15");
        assert_eq!(number_text(1.23456), "1.235");
        assert_eq!(number_text(0.000_012_3), "1.23e-05");
        assert_eq!(number_text(99_999.5), "1e+05");
    }
}
