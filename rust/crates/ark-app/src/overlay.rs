//! A small pill at the top of the screen that shows the status ("Listening", "Thinking", "Needs you"),
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
type Shown = (Option<LoopState>, bool, Option<String>);
static LAST: Mutex<Option<Shown>> = Mutex::new(None);

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

/// The words for the status, or None when the pill stays hidden. An approval that waits comes first, then the
/// computer agent's step, then the voice and thinking states.
pub fn label(state: Option<LoopState>, needs_you: bool, step: Option<&str>) -> Option<String> {
    if needs_you {
        return Some("Needs you".into());
    }
    if let Some(step) = step.filter(|s| !s.trim().is_empty()) {
        return Some(step.chars().take(28).collect());
    }
    let words = match state? {
        LoopState::Listening => "Listening…",
        LoopState::Transcribing => "Transcribing…",
        LoopState::Thinking => "Thinking…",
        LoopState::Speaking => "Speaking…",
        LoopState::Idle => return None,
    };
    Some(words.into())
}

/// Shows, updates or hides the pill when the loop state changes. Cheap to call every frame.
pub fn sync(state: Option<LoopState>, needs_you: bool, step: Option<&str>) {
    let Some(handle) = HANDLE.get() else { return };
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    let key = (state, needs_you, step.map(str::to_owned));
    if last.as_ref() == Some(&key) {
        return;
    }
    *last = Some(key);
    match label(state, needs_you, step) {
        Some(words) => {
            handle.update(move |p, _| p.label = words);
            handle.show();
        }
        None => handle.hide(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pill_follows_the_status_with_approval_first_then_the_agent_step() {
        assert_eq!(label(Some(LoopState::Listening), false, None).as_deref(), Some("Listening…"));
        assert_eq!(label(Some(LoopState::Thinking), false, None).as_deref(), Some("Thinking…"));
        assert_eq!(label(Some(LoopState::Idle), false, None), None);
        assert_eq!(label(None, false, None), None);
        assert_eq!(label(Some(LoopState::Idle), true, Some("Opening Mail")).as_deref(), Some("Needs you"));
        assert_eq!(label(Some(LoopState::Thinking), false, Some("Opening Mail")).as_deref(), Some("Opening Mail"));
    }
}
