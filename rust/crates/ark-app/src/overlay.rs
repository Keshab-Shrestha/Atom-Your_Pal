//! A small pill at the top of the screen that shows the voice state ("Listening", "Transcribing"),
//! also when ARK is behind other apps, so the user knows the microphone is live.
//! Rune draws overlays only in a real window run; headless runs skip them.

use std::sync::{Mutex, OnceLock};

use ark_protocol::events::LoopState;
use rune::{Align, Cx, El, OverlayHandle, OverlaySpec, ScreenEdge, col, text};

/// What the pill says; empty hides it.
#[derive(Debug, Default)]
pub struct Pill {
    pub label: String,
}

static HANDLE: OnceLock<OverlayHandle<Pill>> = OnceLock::new();
static LAST: Mutex<Option<LoopState>> = Mutex::new(None);

fn view(pill: &Pill, _: &mut Cx<Pill>) -> El {
    let kit = rune_theme_opencode::kit(true);
    col()
        .key("pill")
        .padding(10.0)
        .radius(kit.radius.md)
        .fill(kit.c.layer_01)
        .border(1.0, kit.c.border_weak)
        .child(text(pill.label.clone()).font(kit.ty.ui_medium).color(kit.c.text_base))
}

/// The spec for `rune::App::overlay`; keep the returned handle with `install`.
pub fn spec() -> OverlaySpec<Pill> {
    OverlaySpec { name: "ARK voice", size: (180.0, 44.0), edge: ScreenEdge::Top, margin: 12.0, align: Align::Center, inset: 0.0, interactive: false, view }
}

pub fn install(handle: OverlayHandle<Pill>) {
    drop(HANDLE.set(handle));
}

/// The words for a loop state, or None when the pill stays hidden.
pub fn label(state: Option<LoopState>) -> Option<&'static str> {
    match state? {
        LoopState::Listening => Some("Listening…"),
        LoopState::Transcribing => Some("Transcribing…"),
        _ => None,
    }
}

/// Shows, updates or hides the pill when the loop state changes. Cheap to call every frame.
pub fn sync(state: Option<LoopState>) {
    let Some(handle) = HANDLE.get() else { return };
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if *last == state {
        return;
    }
    *last = state;
    match label(state) {
        Some(words) => {
            handle.update(move |p, _| p.label = words.to_owned());
            handle.show();
        }
        None => handle.hide(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_voice_states_show_a_pill() {
        assert_eq!(label(Some(LoopState::Listening)), Some("Listening…"));
        assert_eq!(label(Some(LoopState::Thinking)), None);
        assert_eq!(label(None), None);
    }
}
