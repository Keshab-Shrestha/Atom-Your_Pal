//! A file diff card (FileDiffCard.swift): the path, the counts and the changed lines. The diff comes from `ark_core::diff`.

use ark_core::diff::{LineKind, UnifiedDiff};
use rune::{El, col, row, text};
use rune_kit::Kit;

/// Lines drawn at most; the rest is counted.
const MAX_LINES: usize = 120;

pub fn card(path: &str, old: &str, new: &str, key: String, k: &Kit) -> El {
    let diff = UnifiedDiff::make(old, new);
    let (name, dir) = ark_core::diff::split_path(path);
    let mut c = col().key(key).w_full().gap(4.0).padding(12.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_weak).child(
        row().w_full().justify_between().gap(12.0)
            .child(text(if dir.is_empty() { name.to_owned() } else { format!("{dir}/{name}") }).font(k.ty.ui_medium).color(k.c.text_base))
            .child(text(format!("+{} -{}", diff.added, diff.removed)).font(k.ty.small).color(k.c.text_muted)),
    );
    let mut shown = 0;
    let mut hidden = 0;
    for hunk in &diff.hunks {
        c = c.child(text(hunk.header.clone()).font(k.ty.small).color(k.c.text_faint));
        for line in &hunk.lines {
            if shown >= MAX_LINES {
                hidden += 1;
                continue;
            }
            shown += 1;
            let (mark, ink) = match line.kind {
                LineKind::Added => ("+", k.c.success.fg),
                LineKind::Removed => ("-", k.c.danger.fg),
                LineKind::Context => (" ", k.c.text_muted),
                LineKind::Note => ("\\", k.c.text_faint),
            };
            c = c.child(text(format!("{mark} {}", line.text)).font(k.ty.small).color(ink));
        }
    }
    if hidden > 0 {
        c = c.child(text(format!("{hidden} more lines")).font(k.ty.small).color(k.c.text_faint));
    }
    c
}
