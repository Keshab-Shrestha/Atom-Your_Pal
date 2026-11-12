//! Text diffs: the hunk engine of `TextDiff.swift` (lines by Myers, then words inside a changed block; UTF-16
//! offsets), the unified diff card of `UnifiedDiff.swift` (hunks with three context lines, intra-line changed ranges,
//! visible marks for hidden characters) and the inline pieces of `InlineDiff.swift`. All in
//! `apps/mac/island/Sources/ArkIslandCore`.

use std::collections::HashMap;
use std::ops::Range;

use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;

use crate::js;

/// Above this many lines in either text, only lines are compared.
pub const MAX_REFINED_LINES: usize = 5_000;
/// A text that differs from the other by more than this many lines (or words) is one change.
pub const MAX_EDITS: usize = 2_000;
/// A changed block with more words than this on either side is one change.
pub const MAX_REFINED_TOKENS: usize = 20_000;

/// One change: `old_range` of the old text becomes `new_text`. Offsets are UTF-16 units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffHunk {
    pub id: usize,
    pub old_range: Range<usize>,
    pub new_range: Range<usize>,
    pub old_text: String,
    pub new_text: String,
}

/// `a[a0..a1]` is replaced by `b[b0..b1]`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChangeBlock {
    pub a0: usize,
    pub a1: usize,
    pub b0: usize,
    pub b1: usize,
}

fn decode(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// Gives each distinct key a small id, in order of first sight.
struct Ids<K> {
    table: HashMap<K, usize>,
}

impl<K: std::hash::Hash + Eq> Ids<K> {
    fn new() -> Self {
        Ids { table: HashMap::new() }
    }

    fn id(&mut self, key: K) -> usize {
        let next = self.table.len();
        *self.table.entry(key).or_insert(next)
    }
}

/// The hunks that turn `old` into `new`, in order, not touching each other. Empty when the texts are the same.
pub fn hunks(old: &str, new: &str) -> Vec<DiffHunk> {
    let o: Vec<u16> = old.encode_utf16().collect();
    let n: Vec<u16> = new.encode_utf16().collect();
    if o == n {
        return Vec::new();
    }
    let o_starts = line_starts(&o);
    let n_starts = line_starts(&n);
    let (o_lines, n_lines) = (o_starts.len() - 1, n_starts.len() - 1);
    let mut ids = Ids::new();
    let a: Vec<usize> = (0..o_lines).map(|i| ids.id(&o[o_starts[i]..o_starts[i + 1]])).collect();
    let b: Vec<usize> = (0..n_lines).map(|i| ids.id(&n[n_starts[i]..n_starts[i + 1]])).collect();
    let refine = o_lines <= MAX_REFINED_LINES && n_lines <= MAX_REFINED_LINES;
    let mut out: Vec<DiffHunk> = Vec::new();
    for block in myers(&a, &b) {
        let old_range = o_starts[block.a0]..o_starts[block.a1];
        let new_range = n_starts[block.b0]..n_starts[block.b1];
        if refine && !old_range.is_empty() && !new_range.is_empty() {
            let words = refined(&decode(&o[old_range.clone()]), &decode(&n[new_range.clone()]));
            if !words.is_empty() {
                for w in words {
                    out.push(DiffHunk {
                        id: out.len(),
                        old_range: old_range.start + w.old.start..old_range.start + w.old.end,
                        new_range: new_range.start + w.new.start..new_range.start + w.new.end,
                        old_text: w.old_text,
                        new_text: w.new_text,
                    });
                }
                continue;
            }
        }
        out.push(DiffHunk {
            id: out.len(),
            old_text: decode(&o[old_range.clone()]),
            new_text: decode(&n[new_range.clone()]),
            old_range,
            new_range,
        });
    }
    out
}

/// Where each line starts (a line ends after its "\n"), and the end of the text last.
fn line_starts(u: &[u16]) -> Vec<usize> {
    let mut starts = vec![0];
    starts.extend(u.iter().enumerate().filter(|(_, c)| **c == 10).map(|(i, _)| i + 1));
    if starts.last() != Some(&u.len()) {
        starts.push(u.len());
    }
    starts
}

struct Part {
    old: Range<usize>,
    new: Range<usize>,
    old_text: String,
    new_text: String,
}

/// Swift's `Character.isWhitespace`.
fn is_whitespace(grapheme: &str) -> bool {
    grapheme.chars().next().is_some_and(char::is_whitespace)
}

/// The words of a changed block that differ, as offsets inside the block. Empty when the block cannot be refined.
fn refined(old: &str, new: &str) -> Vec<Part> {
    let ot = tokens(old);
    let nt = tokens(new);
    if ot.len() > MAX_REFINED_TOKENS || nt.len() > MAX_REFINED_TOKENS {
        return Vec::new();
    }
    let mut ids = Ids::new();
    let a: Vec<usize> = ot.iter().map(|t| ids.id(t.as_str())).collect();
    let b: Vec<usize> = nt.iter().map(|t| ids.id(t.as_str())).collect();
    // Two changes with only spaces between them read better as one.
    let mut merged: Vec<ChangeBlock> = Vec::new();
    for block in myers(&a, &b) {
        match merged.last_mut() {
            Some(last) if last.a1 < block.a0 && ot[last.a1..block.a0].iter().all(|t| t.graphemes(true).all(is_whitespace)) => {
                last.a1 = block.a1;
                last.b1 = block.b1;
            }
            _ => merged.push(block),
        }
    }
    let o_starts = offsets(&ot);
    let n_starts = offsets(&nt);
    let o_u: Vec<u16> = old.encode_utf16().collect();
    let n_u: Vec<u16> = new.encode_utf16().collect();
    merged
        .iter()
        .map(|blk| {
            let old = o_starts[blk.a0]..o_starts[blk.a1];
            let new = n_starts[blk.b0]..n_starts[blk.b1];
            Part { old_text: decode(&o_u[old.clone()]), new_text: decode(&n_u[new.clone()]), old, new }
        })
        .collect()
}

/// Words, and between them runs of spaces and single other characters. Joined, the tokens are the text.
// ponytail: words by Unicode UAX #29 (unicode-segmentation); Apple's `.byWords` also uses a dictionary for CJK, so a
// Japanese change can be cut into different words. Every hunk still stays on character boundaries.
fn tokens(s: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let gap = |part: &str, out: &mut Vec<String>| {
        let mut run = String::new();
        for g in part.graphemes(true) {
            if is_whitespace(g) {
                run.push_str(g);
            } else {
                if !run.is_empty() {
                    out.push(std::mem::take(&mut run));
                }
                out.push(g.to_string());
            }
        }
        if !run.is_empty() {
            out.push(run);
        }
    };
    let mut cursor = 0;
    for (at, word) in s.unicode_word_indices() {
        if cursor < at {
            gap(&s[cursor..at], &mut out);
        }
        out.push(word.to_string());
        cursor = at + word.len();
    }
    if cursor < s.len() {
        gap(&s[cursor..], &mut out);
    }
    out
}

/// UTF-16 offset of each token's start, and the end last.
fn offsets(tokens: &[String]) -> Vec<usize> {
    let mut starts = Vec::with_capacity(tokens.len() + 1);
    starts.push(0);
    for t in tokens {
        starts.push(starts[starts.len() - 1] + js::utf16_len(t));
    }
    starts
}

/// The shortest edit script between two lists of ids (Myers, 1986), as change blocks in order, never touching. A
/// pair that needs more than MAX_EDITS edits is one block.
pub fn myers(a: &[usize], b: &[usize]) -> Vec<ChangeBlock> {
    let mut pre = 0;
    while pre < a.len() && pre < b.len() && a[pre] == b[pre] {
        pre += 1;
    }
    let mut suf = 0;
    while suf < a.len() - pre && suf < b.len() - pre && a[a.len() - 1 - suf] == b[b.len() - 1 - suf] {
        suf += 1;
    }
    let n = a.len() - pre - suf;
    let m = b.len() - pre - suf;
    if n == 0 && m == 0 {
        return Vec::new();
    }
    let whole = vec![ChangeBlock { a0: pre, a1: pre + n, b0: pre, b1: pre + m }];
    if n == 0 || m == 0 {
        return whole;
    }
    let Some(ops) = edit_script(&a[pre..pre + n], &b[pre..pre + m]) else { return whole };
    let mut blocks: Vec<ChangeBlock> = Vec::new();
    let (mut ai, mut bi) = (0, 0);
    let mut current: Option<ChangeBlock> = None;
    for op in ops {
        match op {
            Op::Keep => {
                blocks.extend(current.take());
                ai += 1;
                bi += 1;
            }
            Op::Delete => {
                ai += 1;
                current.get_or_insert(ChangeBlock { a0: ai - 1, a1: ai - 1, b0: bi, b1: bi }).a1 = ai;
            }
            Op::Insert => {
                bi += 1;
                current.get_or_insert(ChangeBlock { a0: ai, a1: ai, b0: bi - 1, b1: bi - 1 }).b1 = bi;
            }
        }
    }
    blocks.extend(current);
    blocks.iter().map(|c| ChangeBlock { a0: c.a0 + pre, a1: c.a1 + pre, b0: c.b0 + pre, b1: c.b1 + pre }).collect()
}

#[derive(Clone, Copy)]
enum Op {
    Keep,
    Delete,
    Insert,
}

/// Myers' forward search and walk back over two lists with no common prefix or suffix. `None`: more than MAX_EDITS.
fn edit_script(a: &[usize], b: &[usize]) -> Option<Vec<Op>> {
    let (n, m) = (a.len() as isize, b.len() as isize);
    let limit = (n + m).min(MAX_EDITS as isize);
    let off = limit + 1;
    let at = |k: isize| (off + k) as usize;
    let mut v = vec![0isize; (2 * limit + 3) as usize];
    let mut trace: Vec<Vec<isize>> = Vec::new();
    let mut found = None;
    'search: for d in 0..=limit {
        trace.push(v[at(-d)..=at(d)].to_vec()); // the diagonals -d..=d before this round
        let mut k = -d;
        while k <= d {
            let mut x = if k == -d || (k != d && v[at(k - 1)] < v[at(k + 1)]) { v[at(k + 1)] } else { v[at(k - 1)] + 1 };
            let mut y = x - k;
            while x < n && y < m && a[x as usize] == b[y as usize] {
                x += 1;
                y += 1;
            }
            v[at(k)] = x;
            if x >= n && y >= m {
                found = Some(d);
                break 'search;
            }
            k += 2;
        }
    }
    let mut d = found?;
    // Walk back from the end.
    let mut ops: Vec<Op> = Vec::new();
    let (mut x, mut y) = (n, m);
    while d > 0 {
        let before = &trace[d as usize];
        let k = x - y;
        let get = |k: isize| before[(k + d) as usize];
        let previous = if k == -d || (k != d && get(k - 1) < get(k + 1)) { k + 1 } else { k - 1 };
        let px = get(previous);
        let py = px - previous;
        while x > px && y > py {
            ops.push(Op::Keep);
            x -= 1;
            y -= 1;
        }
        if x == px {
            ops.push(Op::Insert);
        } else {
            ops.push(Op::Delete);
        }
        x = px;
        y = py;
        d -= 1;
    }
    while x > 0 && y > 0 {
        ops.push(Op::Keep);
        x -= 1;
        y -= 1;
    }
    ops.reverse();
    Some(ops)
}

// ---- UnifiedDiff.swift ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineKind {
    Context,
    Added,
    Removed,
    /// "\ No newline at end of file", after the line it is about.
    Note,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiffLine {
    pub id: usize,
    pub kind: LineKind,
    /// The line's number in the old text; `None` for an added line.
    pub old: Option<usize>,
    /// The line's number in the new text; `None` for a removed line.
    pub new: Option<usize>,
    pub text: String,
    /// The changed characters (grapheme offsets in `text`) when this line pairs with a line of the other kind.
    pub changed: Option<Range<usize>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    pub id: usize,
    /// "@@ -3,4 +3,6 @@", as `diff -u` writes it.
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnifiedDiff {
    pub hunks: Vec<Hunk>,
    pub added: usize,
    pub removed: usize,
}

pub const CONTEXT: usize = 3;
pub const NO_NEWLINE: &str = "\\ No newline at end of file";

/// Swift's `text.hasSuffix("\n")`: by characters, so a text that ends in "\r\n" (one character) does not.
fn ends_with_newline(text: &str) -> bool {
    text.ends_with('\n') && !text.ends_with("\r\n")
}

/// The text's lines without their "\n"; a final "\n" ends the last line and adds no empty one.
fn lines(text: &str) -> Vec<&str> {
    if text.is_empty() {
        return Vec::new();
    }
    let mut parts: Vec<&str> = text.split('\n').collect();
    if ends_with_newline(text) {
        parts.pop();
    }
    parts
}

/// Builds one hunk's rows; `next` numbers the rows of the whole diff.
struct Rows<'a> {
    out: Vec<DiffLine>,
    next: &'a mut usize,
}

impl Rows<'_> {
    fn line(&mut self, kind: LineKind, text: &str, old: Option<usize>, new: Option<usize>, last: bool, changed: Option<Range<usize>>) {
        self.out.push(DiffLine { id: *self.next, kind, old: old.map(|o| o + 1), new: new.map(|n| n + 1), text: text.into(), changed });
        *self.next += 1;
        if last {
            self.out.push(DiffLine { id: *self.next, kind: LineKind::Note, old: None, new: None, text: NO_NEWLINE.into(), changed: None });
            *self.next += 1;
        }
    }
}

impl UnifiedDiff {
    pub fn make(old: &str, new: &str) -> UnifiedDiff {
        let (a, b) = (lines(old), lines(new));
        // A last line with no "\n" is a different line from the same text with one ("\n" never occurs in a line).
        let a_end = if ends_with_newline(old) { None } else { a.len().checked_sub(1) };
        let b_end = if ends_with_newline(new) { None } else { b.len().checked_sub(1) };
        let key = |lines: &[&str], end: Option<usize>, i: usize| if Some(i) == end { format!("{}\n", lines[i]) } else { lines[i].to_string() };
        let mut ids = Ids::new();
        let a_ids: Vec<usize> = (0..a.len()).map(|i| ids.id(key(&a, a_end, i))).collect();
        let b_ids: Vec<usize> = (0..b.len()).map(|i| ids.id(key(&b, b_end, i))).collect();
        // Changes closer than two contexts apart share a hunk.
        let mut groups: Vec<Vec<ChangeBlock>> = Vec::new();
        for block in myers(&a_ids, &b_ids) {
            match groups.last_mut() {
                Some(group) if group.last().is_some_and(|last| block.a0 - last.a1 <= 2 * CONTEXT) => group.push(block),
                _ => groups.push(vec![block]),
            }
        }
        let (mut hunks, mut added, mut removed, mut next) = (Vec::new(), 0, 0, 0);
        for group in groups {
            let (first, last) = (group[0], group[group.len() - 1]);
            let lead = CONTEXT.min(first.a0);
            let trail = CONTEXT.min(a.len() - last.a1).min(b.len() - last.b1);
            let (mut oi, mut ni) = (first.a0 - lead, first.b0 - lead);
            let (old_start, new_start) = (oi, ni);
            let mut rows = Rows { out: Vec::new(), next: &mut next };
            for block in &group {
                while oi < block.a0 {
                    rows.line(LineKind::Context, a[oi], Some(oi), Some(ni), Some(oi) == a_end, None);
                    oi += 1;
                    ni += 1;
                }
                let (gone, came) = (&a[block.a0..block.a1], &b[block.b0..block.b1]);
                let pairs: Vec<ChangedRanges> = gone.iter().zip(came).map(|(o, n)| changed_ranges(o, n)).collect();
                for (j, text) in gone.iter().enumerate() {
                    let i = block.a0 + j;
                    rows.line(LineKind::Removed, text, Some(i), None, Some(i) == a_end, pairs.get(j).and_then(|p| p.0.clone()));
                }
                for (j, text) in came.iter().enumerate() {
                    let i = block.b0 + j;
                    rows.line(LineKind::Added, text, None, Some(i), Some(i) == b_end, pairs.get(j).and_then(|p| p.1.clone()));
                }
                removed += block.a1 - block.a0;
                added += block.b1 - block.b0;
                oi = block.a1;
                ni = block.b1;
            }
            for _ in 0..trail {
                rows.line(LineKind::Context, a[oi], Some(oi), Some(ni), Some(oi) == a_end, None);
                oi += 1;
                ni += 1;
            }
            let range = |start: usize, count: usize| match count {
                1 => format!("{}", start + 1),
                0 => format!("{start},0"),
                _ => format!("{},{count}", start + 1),
            };
            let lines = rows.out;
            hunks.push(Hunk { id: hunks.len(), header: format!("@@ -{} +{} @@", range(old_start, oi - old_start), range(new_start, ni - new_start)), lines });
        }
        UnifiedDiff { hunks, added, removed }
    }
}

/// The changed characters of a removed line and of its added pair.
pub type ChangedRanges = (Option<Range<usize>>, Option<Range<usize>>);

/// The changed characters (grapheme offsets) of a removed line and its added pair: what is left after the common
/// prefix and suffix. An empty side is `None`. Characters compare by canonical equivalence, as Swift does.
pub fn changed_ranges(old: &str, new: &str) -> ChangedRanges {
    let canon = |s: &str| s.graphemes(true).map(|g| g.nfc().collect::<String>()).collect::<Vec<_>>();
    let (o, n) = (canon(old), canon(new));
    let mut prefix = 0;
    while prefix < o.len() && prefix < n.len() && o[prefix] == n[prefix] {
        prefix += 1;
    }
    let mut suffix = 0;
    while suffix < o.len() - prefix && suffix < n.len() - prefix && o[o.len() - 1 - suffix] == n[n.len() - 1 - suffix] {
        suffix += 1;
    }
    let range = |count: usize| (prefix < count - suffix).then_some(prefix..count - suffix);
    (range(o.len()), range(n.len()))
}

/// A piece of a diff line as the card draws it: plain text, or a visible mark for a hidden character.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Segment {
    pub text: String,
    pub changed: bool,
    pub mark: bool,
}

/// Unicode's Emoji property, by block.
// ponytail: whole blocks, a superset of Emoji=Yes; it only decides whether a joiner inside a multi-scalar
// character stays unmarked.
fn is_emoji(c: char) -> bool {
    matches!(c as u32, 0xA9 | 0xAE | 0x203C | 0x2049 | 0x2122 | 0x2139 | 0x2194..=0x21AA | 0x231A..=0x23FA | 0x24C2
        | 0x25AA..=0x25FE | 0x2600..=0x27BF | 0x2934..=0x2935 | 0x2B05..=0x2B55 | 0x3030 | 0x303D | 0x3297 | 0x3299
        | 0x1F000..=0x1FAFF)
}

/// The visible stand-in for a character that would not show, or `None` for one that shows (a tab shows).
pub fn visible_mark(c: char) -> Option<String> {
    let v = c as u32;
    match v {
        0x09 => None,
        0x00..=0x1F => char::from_u32(0x2400 + v).map(String::from),
        0x7F => Some("\u{2421}".into()),
        _ if js::is_control_or_format(c) => Some(format!("⟨U+{v:04X}⟩")),
        _ => None,
    }
}

/// The line's text in pieces. A control character shows as its Control Pictures glyph; a bidi, zero-width or other
/// format character as "⟨U+202E⟩". A tab stays a tab. Joiners inside an emoji stay.
pub fn segments(text: &str, changed: Option<Range<usize>>) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    let mut add = |piece: &str, changed: bool, mark: bool| match out.last_mut() {
        Some(last) if last.changed == changed && last.mark == mark => last.text.push_str(piece),
        _ => out.push(Segment { text: piece.into(), changed, mark }),
    };
    for (offset, g) in text.graphemes(true).enumerate() {
        let inside = changed.as_ref().is_some_and(|r| r.contains(&offset));
        let emoji = g.chars().count() > 1 && g.chars().any(|c| is_emoji(c) && u32::from(c) > 0x7F);
        let mut plain = String::new();
        for c in g.chars() {
            match visible_mark(c).filter(|_| !(emoji && c == '\u{200D}')) {
                None => plain.push(c),
                Some(mark) => {
                    if !plain.is_empty() {
                        add(&std::mem::take(&mut plain), inside, false);
                    }
                    add(&mark, inside, true);
                }
            }
        }
        if !plain.is_empty() {
            add(&plain, inside, false);
        }
    }
    out
}

/// The five mini squares beside "+N −M": (green, red).
pub fn squares(added: i64, removed: i64, count: i64) -> (i64, i64) {
    let total = added.max(0) + removed.max(0);
    if total <= 0 {
        return (0, 0);
    }
    let filled = count.min(total);
    #[allow(clippy::cast_possible_truncation, clippy::cast_precision_loss)]
    let green = (filled as f64 * added.max(0) as f64 / total as f64).round() as i64;
    // A side with changes keeps at least one square.
    let g = if removed > 0 && green == filled {
        filled - 1
    } else if added > 0 && green == 0 {
        1
    } else {
        green
    };
    (g, filled - g)
}

/// "Sources/App/main.swift" splits into ("main.swift", "Sources/App").
pub fn split_path(path: &str) -> (&str, &str) {
    match path.rfind('/') {
        None => (path, ""),
        Some(0) => (&path[1..], "/"),
        Some(at) => (&path[at + 1..], &path[..at]),
    }
}

// ---- InlineDiff.swift ----

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegmentKind {
    Same,
    Removed,
    Added,
}

/// The pieces that turn `old` into `new`: unchanged text, text that goes, text that comes. Empty texts give no pieces.
pub fn inline_segments(old: &str, new: &str) -> Vec<(SegmentKind, String)> {
    let o: Vec<u16> = old.encode_utf16().collect();
    let mut out = Vec::new();
    let mut add = |kind: SegmentKind, text: String| {
        if !text.is_empty() {
            out.push((kind, text));
        }
    };
    let mut cursor = 0;
    for h in hunks(old, new) {
        add(SegmentKind::Same, decode(&o[cursor..h.old_range.start]));
        add(SegmentKind::Removed, h.old_text);
        add(SegmentKind::Added, h.new_text);
        cursor = h.old_range.end;
    }
    add(SegmentKind::Same, decode(&o[cursor..]));
    out
}
