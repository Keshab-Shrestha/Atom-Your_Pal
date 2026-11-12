//! Pal, the companion (PalView.swift, PetController.swift, PetBrain.swift): a small character in a click-through window
//! at the bottom right of the main display. It shows what ARK does: calm, listening, thinking, speaking, worried.
//! This is a simple vector drawing (a rounded body, ears, eyes, a mouth). The Swift Pal draws from `assets/pals/pal.json`
//! with sprites and idle motion; that drawing is not ported. Pal does not walk or follow the pointer.

use std::sync::{Mutex, OnceLock};

use ark_protocol::events::LoopState;
use rune::{Align, Cx, El, OverlayHandle, OverlaySpec, ScreenEdge, col, row, text};

/// PetBrain.Mood, without the moods that need the pointer (napping, carried).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mood {
    #[default]
    Floating,
    Listening,
    Thinking,
    Speaking,
    Worried,
}

#[derive(Debug, Default)]
pub struct Pet {
    pub mood: Mood,
    /// The words in the bubble; empty: no bubble.
    pub label: String,
}

const SIZE: (f32, f32) = (140.0, 150.0);
const EDGE_GAP: f32 = 24.0;

static HANDLE: OnceLock<OverlayHandle<Pet>> = OnceLock::new();
static LAST: Mutex<Option<(bool, Mood, String)>> = Mutex::new(None);

/// Pal's mood from the voice and loop state: a waiting approval or a problem makes Pal worried.
pub fn mood_of(state: Option<LoopState>, needs_you: bool, problem: bool) -> Mood {
    if needs_you || problem {
        return Mood::Worried;
    }
    match state {
        Some(LoopState::Listening) => Mood::Listening,
        Some(LoopState::Transcribing | LoopState::Thinking) => Mood::Thinking,
        Some(LoopState::Speaking) => Mood::Speaking,
        _ => Mood::Floating,
    }
}

fn view(pet: &Pet, _: &mut Cx<Pet>) -> El {
    let k = rune_theme_opencode::kit(true);
    let ring = match pet.mood {
        Mood::Worried => k.c.danger.fg,
        Mood::Floating => k.c.border_base,
        _ => k.c.bg_accent,
    };
    let ear = || col().w(14.0).h(20.0).radius(6.0).fill(k.c.layer_03).border(2.0, ring);
    let eye = |open: bool| col().w(10.0).h(if open { 12.0 } else { 3.0 }).radius(5.0).fill(k.c.text_base);
    let open = pet.mood != Mood::Thinking;
    let mouth = match pet.mood {
        Mood::Speaking => col().key("pal-mouth").w(16.0).h(10.0).radius(5.0).fill(k.c.text_base),
        Mood::Worried => col().key("pal-mouth").w(12.0).h(3.0).radius(2.0).fill(k.c.danger.fg),
        _ => col().key("pal-mouth").w(14.0).h(3.0).radius(2.0).fill(k.c.text_muted),
    };
    let face = col().key("pal-body").w(76.0).h(64.0).radius(22.0).fill(k.c.layer_03).border(3.0, ring).items_center().justify_center().gap(8.0).child(row().gap(14.0).child(eye(open)).child(eye(open))).child(mouth);
    let mut root = col().key("pal").w(SIZE.0).items_center().gap(2.0);
    if !pet.label.is_empty() {
        root = root.child(col().key("pal-bubble").padding(6.0).radius(k.radius.md).fill(k.c.layer_01).border(1.0, k.c.border_base).child(text(pet.label.clone()).font(k.ty.small).color(k.c.text_base)));
    }
    root.child(row().gap(34.0).child(ear()).child(ear())).child(face)
}

pub fn spec() -> OverlaySpec<Pet> {
    OverlaySpec { name: "ARK pal", size: SIZE, edge: ScreenEdge::Bottom, margin: EDGE_GAP, align: Align::End, inset: EDGE_GAP, interactive: false, view }
}

pub fn install(handle: OverlayHandle<Pet>) {
    drop(HANDLE.set(handle));
}

/// Shows, updates or hides Pal. Cheap to call every frame.
pub fn sync(on: bool, mood: Mood, label: Option<String>) {
    let Some(handle) = HANDLE.get() else { return };
    let key = (on, mood, label.clone().unwrap_or_default());
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if last.as_ref() == Some(&key) {
        return;
    }
    *last = Some(key);
    if on {
        handle.update(move |p, _| *p = Pet { mood, label: label.unwrap_or_default() });
        handle.show();
    } else {
        handle.hide();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pal_worries_first_then_follows_the_voice_state() {
        assert_eq!(mood_of(Some(LoopState::Speaking), true, false), Mood::Worried);
        assert_eq!(mood_of(Some(LoopState::Listening), false, false), Mood::Listening);
        assert_eq!(mood_of(Some(LoopState::Transcribing), false, false), Mood::Thinking);
        assert_eq!(mood_of(Some(LoopState::Speaking), false, false), Mood::Speaking);
        assert_eq!(mood_of(Some(LoopState::Idle), false, true), Mood::Worried);
        assert_eq!(mood_of(None, false, false), Mood::Floating);
    }
}
