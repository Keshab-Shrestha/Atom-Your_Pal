//! The agent cursor and the point-at ring (AgentCursorController.swift, IslandController+Pointing.swift).
//! Both are click-through overlay windows. The cursor sits where the computer agent works (`computer.cursor`).
//! The ring and its label show a place on screen (`computer.point`). Neither moves the real pointer or sends input.
//! Coordinates are points from the top-left of the main display, the space Rune's `OverlayPlacement::Rect` uses.
//! Headless runs skip overlays.

use std::sync::{Mutex, OnceLock};

use rune::{Align, Cx, El, OverlayHandle, OverlayPlacement, OverlaySpec, ScreenEdge, col, text};

const CURSOR_SIZE: f32 = 26.0;
/// The ring is this far outside the element; the label sits above it.
const RING_GAP: f32 = 6.0;
const LABEL_HEIGHT: f32 = 30.0;
/// A point-at label is cut to this many characters.
const LABEL_MAX: usize = 60;

#[derive(Debug, Default)]
pub struct Cursor;

#[derive(Debug, Default)]
pub struct Ring {
    pub label: String,
    /// The ring's size, in points (the target plus the gap).
    pub size: (f32, f32),
}

static CURSOR: OnceLock<OverlayHandle<Cursor>> = OnceLock::new();
static RING: OnceLock<OverlayHandle<Ring>> = OnceLock::new();
type Seen = (Option<(f64, f64)>, Option<Target>);
static LAST: Mutex<Seen> = Mutex::new((None, None));

/// x, y, w, h and the label of a point-at target.
pub type Target = (f64, f64, f64, f64, String);

fn cursor_view(_: &Cursor, _: &mut Cx<Cursor>) -> El {
    let k = rune_theme_opencode::kit(true);
    // A dot with a ring: the agent's pointer. It is drawn, not the real one.
    col().key("agent-cursor").w(CURSOR_SIZE).h(CURSOR_SIZE).radius(CURSOR_SIZE / 2.0).fill(k.c.bg_accent).border(2.0, k.c.text_inverse)
}

fn ring_view(ring: &Ring, _: &mut Cx<Ring>) -> El {
    let k = rune_theme_opencode::kit(true);
    let bubble = col().key("point-label").padding(6.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_base).child(text(ring.label.clone()).font(k.ty.ui_medium).color(k.c.text_base));
    let target = col().key("point-ring").w(ring.size.0).h(ring.size.1).radius(k.radius.md).border(3.0, k.c.bg_accent);
    col().gap(4.0).child(bubble).child(target)
}

pub fn cursor_spec() -> OverlaySpec<Cursor> {
    OverlaySpec { name: "ARK cursor", size: (CURSOR_SIZE, CURSOR_SIZE), edge: ScreenEdge::Top, margin: 0.0, align: Align::Center, inset: 0.0, interactive: false, view: cursor_view }
}

pub fn ring_spec() -> OverlaySpec<Ring> {
    OverlaySpec { name: "ARK point", size: (200.0, 100.0), edge: ScreenEdge::Top, margin: 0.0, align: Align::Center, inset: 0.0, interactive: false, view: ring_view }
}

pub fn install(cursor: OverlayHandle<Cursor>, ring: OverlayHandle<Ring>) {
    drop(CURSOR.set(cursor));
    drop(RING.set(ring));
}

/// The cursor window: centred on the point, so the dot sits on the element.
pub fn cursor_rect(x: f64, y: f64) -> (f32, f32, f32, f32) {
    (x as f32 - CURSOR_SIZE / 2.0, y as f32 - CURSOR_SIZE / 2.0, CURSOR_SIZE, CURSOR_SIZE)
}

/// The ring window: the target with a gap, and the label above. Returns the window rect and the ring size.
pub fn ring_rect(t: &Target) -> ((f32, f32, f32, f32), (f32, f32)) {
    let ring = (t.2 as f32 + 2.0 * RING_GAP, t.3 as f32 + 2.0 * RING_GAP);
    let width = ring.0.max(160.0);
    let window = (t.0 as f32 - RING_GAP - (width - ring.0) / 2.0, t.1 as f32 - RING_GAP - LABEL_HEIGHT - 4.0, width, ring.1 + LABEL_HEIGHT + 4.0);
    (window, ring)
}

/// A label the owner sees: one line, cut short.
pub fn clean_label(label: &str) -> String {
    let one = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= LABEL_MAX { one } else { format!("{}…", one.chars().take(LABEL_MAX - 1).collect::<String>()) }
}

/// Shows, moves or hides both overlays when the model changes. Cheap to call every frame.
pub fn sync(cursor: Option<(f64, f64)>, point: Option<&Target>) {
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if last.0 == cursor && last.1.as_ref() == point {
        return;
    }
    if let (true, Some(handle)) = (last.0 != cursor, CURSOR.get()) {
        {
            match cursor {
                Some((x, y)) => {
                    let (rx, ry, width, height) = cursor_rect(x, y);
                    handle.set_placement(Some(OverlayPlacement::Rect { x: rx, y: ry, width, height }));
                    handle.show();
                }
                None => handle.hide(),
            }
        }
    }
    if let (true, Some(handle)) = (last.1.as_ref() != point, RING.get()) {
        {
            match point {
                Some(t) => {
                    let ((x, y, width, height), size) = ring_rect(t);
                    let label = clean_label(&t.4);
                    handle.update(move |r, _| *r = Ring { label, size });
                    handle.set_placement(Some(OverlayPlacement::Rect { x, y, width, height }));
                    handle.show();
                }
                None => handle.hide(),
            }
        }
    }
    *last = (cursor, point.cloned());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cursor_dot_is_centred_on_the_point() {
        let (x, y, w, h) = cursor_rect(100.0, 50.0);
        assert_eq!((x + w / 2.0, y + h / 2.0), (100.0, 50.0));
    }

    #[test]
    fn the_ring_surrounds_the_target_and_the_label_sits_above() {
        let t: Target = (200.0, 300.0, 80.0, 40.0, "the button".into());
        let ((wx, wy, ww, wh), (rw, rh)) = ring_rect(&t);
        assert_eq!((rw, rh), (92.0, 52.0));
        assert!(wx <= 194.0 && wx + ww >= 286.0, "the window holds the ring");
        assert!(wy < 294.0 && wy + wh >= 346.0, "the window reaches above and below the ring");
    }

    #[test]
    fn labels_are_one_short_line() {
        assert_eq!(clean_label("the  settings\nbutton"), "the settings button");
        assert_eq!(clean_label(&"x".repeat(100)).chars().count(), LABEL_MAX);
    }
}
