//! Replies with ```ark-visual blocks: the text between them is Markdown, each block is a card (ArkVisualCard.swift).
//! The parsing and limits come from `ark_core::visual`.

use ark_core::visual::{ArkVisual, Block, LANGUAGE, Tone, number_text};
use rune::{El, col, row, text};
use rune_kit::Kit;

#[derive(Debug, Clone, PartialEq)]
pub enum Piece {
    Text(String),
    Visual(ArkVisual),
}

/// Splits a reply into Markdown pieces and visual cards. A block that does not parse stays text.
pub fn split(reply: &str) -> Vec<Piece> {
    let fence = format!("```{LANGUAGE}");
    let mut out = Vec::new();
    let mut rest = reply;
    while let Some(start) = rest.find(&fence) {
        let after = &rest[start + fence.len()..];
        let Some(end) = after.find("```") else { break };
        let json = after[..end].trim();
        match ArkVisual::parse(json) {
            Some(v) => {
                if !rest[..start].trim().is_empty() {
                    out.push(Piece::Text(rest[..start].to_owned()));
                }
                out.push(Piece::Visual(v));
            }
            None => out.push(Piece::Text(rest[..start + fence.len() + end + 3].to_owned())),
        }
        rest = &after[end + 3..];
    }
    if !rest.trim().is_empty() {
        out.push(Piece::Text(rest.to_owned()));
    }
    out
}

fn tone(t: Tone, k: &Kit) -> rune::Color {
    match t {
        Tone::Good => k.c.success.fg,
        Tone::Bad => k.c.danger.fg,
        Tone::Neutral => k.c.text_base,
    }
}

fn title(t: &Option<String>, k: &Kit) -> Option<El> {
    t.as_ref().map(|t| text(t.clone()).font(k.ty.ui_medium).color(k.c.text_base))
}

fn bars(data: &[ark_core::visual::Point], unit: &Option<String>, k: &Kit) -> El {
    let max = data.iter().map(|p| p.value.abs()).fold(0.0_f64, f64::max).max(f64::MIN_POSITIVE);
    let unit = unit.clone().unwrap_or_default();
    let mut c = col().w_full().gap(4.0);
    for p in data {
        let width = (160.0 * (p.value.abs() / max) as f32).max(2.0);
        c = c.child(
            row().w_full().gap(8.0).items_center()
                .child(col().w(120.0).child(text(p.label.clone()).font(k.ty.small).color(k.c.text_muted)))
                .child(col().w(width).h(10.0).radius(k.radius.sm).fill(k.c.text_base))
                .child(text(format!("{}{unit}", number_text(p.value))).font(k.ty.small).color(k.c.text_base)),
        );
    }
    c
}

fn block(b: &Block, k: &Kit) -> El {
    let mut c = col().w_full().gap(6.0);
    match b {
        Block::Stats { title: t, items } => {
            if let Some(h) = title(t, k) {
                c = c.child(h);
            }
            let mut r = row().w_full().gap(10.0).wrap();
            for s in items {
                let mut tile = col().gap(2.0).padding(10.0).radius(k.radius.md).border(1.0, k.c.border_weak).child(text(s.value.clone()).font(k.ty.body_medium).color(tone(s.tone, k))).child(text(s.label.clone()).font(k.ty.small).color(k.c.text_muted));
                if let Some(n) = &s.note {
                    tile = tile.child(text(n.clone()).font(k.ty.small).color(k.c.text_faint));
                }
                r = r.child(tile);
            }
            c = c.child(r);
        }
        Block::Bar { title: t, unit, data } | Block::Line { title: t, unit, data } => {
            if let Some(h) = title(t, k) {
                c = c.child(h);
            }
            c = c.child(bars(data, unit, k));
        }
        Block::Table { title: t, columns, rows } => {
            if let Some(h) = title(t, k) {
                c = c.child(h);
            }
            c = c.child(text(columns.join("  |  ")).font(k.ty.ui_medium).color(k.c.text_muted).wrap());
            for r in rows {
                c = c.child(text(r.join("  |  ")).font(k.ty.ui).color(k.c.text_base).wrap());
            }
        }
    }
    c
}

pub fn card(v: &ArkVisual, key: String, k: &Kit) -> El {
    let mut c = col().key(key).w_full().gap(10.0).padding(14.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_weak).child(text(v.title.clone()).font(k.ty.ui_medium).color(k.c.text_base));
    for b in &v.blocks {
        c = c.child(block(b, k));
    }
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_splits_around_a_visual_block() {
        let reply = "Before\n```ark-visual\n{\"title\":\"Sales\",\"blocks\":[{\"type\":\"stats\",\"items\":[{\"label\":\"Total\",\"value\":\"4\"}]}]}\n```\nAfter";
        let pieces = split(reply);
        assert_eq!(pieces.len(), 3);
        assert!(matches!(&pieces[1], Piece::Visual(v) if v.title == "Sales"));
        assert!(matches!(&split("```ark-visual\nnot json\n```")[0], Piece::Text(_)));
    }
}
