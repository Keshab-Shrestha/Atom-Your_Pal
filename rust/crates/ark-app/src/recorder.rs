//! Records a new shortcut from key events (ShortcutRecorder.swift): a key with modifiers, or modifiers alone
//! (hold, then let go). The key events come from AppKit, so this logic has no window code and is tested alone.

use ark_core::shortcuts::{KeyCombo, KeyInput, Modifiers};
use std::collections::HashSet;

/// macOS key codes of the right-hand modifier keys: Command, Shift, Option, Control.
const RIGHT_KEYS: [u16; 4] = [54, 60, 61, 62];
/// Escape cancels a recording.
pub const ESCAPE: u16 = 53;

#[derive(Debug, Default)]
pub struct Recorder {
    peak: Modifiers,
    keys: HashSet<u16>,
}

/// What one event did to a recording.
#[derive(Debug, PartialEq, Eq)]
pub enum Step {
    Waiting,
    Cancelled,
    Done(KeyCombo),
}

impl Recorder {
    pub fn step(&mut self, input: KeyInput) -> Step {
        match input {
            KeyInput::KeyDown { key_code: ESCAPE, .. } => Step::Cancelled,
            KeyInput::KeyDown { key_code, modifiers, is_repeat: false } => Step::Done(KeyCombo::keyed(modifiers, key_code, None)),
            KeyInput::FlagsChanged { key_code, modifiers } => {
                if modifiers.is_empty() {
                    if self.peak.is_empty() {
                        return Step::Waiting;
                    }
                    let right = !self.keys.is_empty() && self.keys.iter().all(|k| RIGHT_KEYS.contains(k));
                    return Step::Done(KeyCombo::modifiers_only(self.peak, right));
                }
                self.keys.insert(key_code);
                self.peak = Modifiers(self.peak.0 | modifiers.0);
                Step::Waiting
            }
            _ => Step::Waiting,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_keyed_shortcut_and_a_right_hand_hold_are_recorded() {
        let mut r = Recorder::default();
        let ctrl_opt = Modifiers::CONTROL | Modifiers::OPTION;
        assert_eq!(r.step(KeyInput::KeyDown { key_code: 6, modifiers: ctrl_opt, is_repeat: false }), Step::Done(KeyCombo::keyed(ctrl_opt, 6, None)));
        let mut r = Recorder::default();
        assert_eq!(r.step(KeyInput::FlagsChanged { key_code: 54, modifiers: Modifiers::COMMAND }), Step::Waiting);
        assert_eq!(r.step(KeyInput::FlagsChanged { key_code: 61, modifiers: Modifiers::COMMAND | Modifiers::OPTION }), Step::Waiting);
        assert_eq!(r.step(KeyInput::FlagsChanged { key_code: 61, modifiers: Modifiers::NONE }), Step::Done(KeyCombo::modifiers_only(Modifiers::COMMAND | Modifiers::OPTION, true)));
        assert_eq!(Recorder::default().step(KeyInput::KeyDown { key_code: ESCAPE, modifiers: Modifiers::NONE, is_repeat: false }), Step::Cancelled);
    }
}
