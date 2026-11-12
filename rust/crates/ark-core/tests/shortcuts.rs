//! apps/mac/island/Tests/ArkIslandCoreTests/ShortcutMatcherTests.swift, one for one.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::HashMap;

use ark_core::shortcuts::ShortcutAction::{Dictate, Talk, ToggleIsland};
use ark_core::shortcuts::ShortcutTrigger::{HoldBegan, HoldCancelled, HoldEnded, Pressed};
use ark_core::shortcuts::*;

const LEFT_CONTROL: u16 = 59;
const LEFT_OPTION: u16 = 58;
const RIGHT_OPTION: u16 = 61;
const LEFT_SHIFT: u16 = 56;
const LEFT_COMMAND: u16 = 55;
const RIGHT_COMMAND: u16 = 54;
const FN: u16 = 63;
const Z: u16 = 6;
const A: u16 = 0;
const LEFT_ARROW: u16 = 123;
const SPACE: u16 = 49;

const C: Modifiers = Modifiers::CONTROL;
const O: Modifiers = Modifiers::OPTION;
const CMD: Modifiers = Modifiers::COMMAND;
const F: Modifiers = Modifiers::FUNCTION;
const NONE: Modifiers = Modifiers::NONE;

fn defaults() -> HashMap<ShortcutAction, KeyCombo> {
    ShortcutAction::ALL.iter().map(|a| (*a, a.default_combo())).collect()
}

fn right_option_alone() -> HashMap<ShortcutAction, KeyCombo> {
    let mut all = defaults();
    all.insert(Dictate, KeyCombo::modifiers_only(O, true));
    all
}

/// Drives a matcher with a fake clock.
struct Keyboard {
    matcher: ShortcutMatcher,
    now: f64,
    fired: Vec<ShortcutTrigger>,
}

impl Keyboard {
    fn new(shortcuts: HashMap<ShortcutAction, KeyCombo>) -> Self {
        let mut matcher = ShortcutMatcher::new(0.2, HashMap::new());
        matcher.set_shortcuts(shortcuts);
        Keyboard { matcher, now: 0.0, fired: Vec::new() }
    }

    fn handle(&mut self, input: KeyInput) {
        let out = self.matcher.handle(input, self.now);
        self.fired.extend(out);
    }

    fn flags(&mut self, key_code: u16, modifiers: Modifiers) {
        self.handle(KeyInput::FlagsChanged { key_code, modifiers });
    }

    fn down(&mut self, key_code: u16, modifiers: Modifiers) {
        self.handle(KeyInput::KeyDown { key_code, modifiers, is_repeat: false });
    }

    fn repeat(&mut self, key_code: u16, modifiers: Modifiers) {
        self.handle(KeyInput::KeyDown { key_code, modifiers, is_repeat: true });
    }

    fn up(&mut self, key_code: u16) {
        self.handle(KeyInput::KeyUp { key_code });
    }

    /// Lets time pass, ticking like the app's timer does.
    fn wait(&mut self, seconds: f64) {
        let end = self.now + seconds;
        while let Some(deadline) = self.matcher.next_deadline().filter(|d| *d <= end) {
            self.now = deadline;
            let out = self.matcher.tick(self.now);
            self.fired.extend(out);
        }
        self.now = end;
    }

    fn hold_control_option(&mut self) {
        self.flags(LEFT_CONTROL, C);
        self.flags(LEFT_OPTION, C | O);
    }

    fn release_all(&mut self) {
        self.flags(LEFT_OPTION, C);
        self.flags(LEFT_CONTROL, NONE);
    }
}

fn kb() -> Keyboard {
    Keyboard::new(defaults())
}

// ---- hold to talk ----

#[test]
fn hold_starts_after_the_delay_and_release_sends() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.1);
    assert!(kb.fired.is_empty(), "not before the delay");
    kb.wait(0.2);
    assert_eq!(kb.fired, [HoldBegan(Talk)]);
    kb.wait(3.0);
    kb.release_all();
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldEnded(Talk)]);
}

#[test]
fn releasing_one_modifier_sends() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.flags(LEFT_OPTION, C);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldEnded(Talk)]);
    kb.flags(LEFT_CONTROL, NONE);
    assert_eq!(kb.fired.len(), 2, "nothing more when the last modifier goes up");
}

#[test]
fn quick_tap_does_nothing() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.05);
    kb.release_all();
    kb.wait(1.0);
    assert!(kb.fired.is_empty());
}

#[test]
fn chord_on_the_way_to_a_key_never_starts() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.08);
    kb.down(LEFT_ARROW, C | O | F);
    kb.up(LEFT_ARROW);
    kb.wait(1.0);
    kb.release_all();
    assert!(kb.fired.is_empty());
}

#[test]
fn key_while_holding_cancels() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.down(LEFT_ARROW, C | O | F);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk)]);
    kb.up(LEFT_ARROW);
    kb.wait(1.0);
    kb.release_all();
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk)], "nothing restarts until every modifier is up");
}

#[test]
fn adding_a_modifier_cancels() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.flags(LEFT_SHIFT, C | O | Modifiers::SHIFT);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk)]);
}

#[test]
fn extra_modifier_before_the_delay_never_starts() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.05);
    kb.flags(LEFT_COMMAND, C | O | CMD);
    kb.wait(1.0);
    kb.flags(LEFT_COMMAND, C | O);
    kb.wait(1.0);
    assert!(kb.fired.is_empty());
}

#[test]
fn works_again_after_everything_is_released() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.down(A, C | O);
    kb.release_all();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.release_all();
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk), HoldBegan(Talk), HoldEnded(Talk)]);
}

#[test]
fn key_repeat_is_ignored() {
    let mut kb = Keyboard::new(HashMap::from([(ToggleIsland, KeyCombo::keyed(F, Z, None))]));
    kb.flags(FN, F);
    kb.down(Z, F);
    kb.repeat(Z, F);
    kb.repeat(Z, F);
    assert_eq!(kb.fired, [Pressed(ToggleIsland)]);
}

#[test]
fn chord_fired_elsewhere_spoils_the_hold() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.handle(KeyInput::OtherKey);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk)]);
}

#[test]
fn reset_cancels_and_forgets_held_keys() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.handle(KeyInput::Reset);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk)]);
    kb.hold_control_option();
    kb.wait(0.5);
    assert_eq!(kb.fired.last(), Some(&HoldBegan(Talk)));
}

// ---- Right ⌘ + Right ⌥ dictates ----

#[test]
fn both_right_keys_dictate_in_either_order() {
    let mut kb = kb();
    kb.flags(RIGHT_COMMAND, CMD);
    kb.flags(RIGHT_OPTION, CMD | O);
    kb.wait(0.5);
    kb.flags(RIGHT_OPTION, CMD);
    kb.flags(RIGHT_COMMAND, NONE);
    assert_eq!(kb.fired, [HoldBegan(Dictate), HoldEnded(Dictate)]);

    let mut other = Keyboard::new(defaults());
    other.flags(RIGHT_OPTION, O);
    other.flags(RIGHT_COMMAND, CMD | O);
    other.wait(0.5);
    other.flags(RIGHT_COMMAND, O);
    other.flags(RIGHT_OPTION, NONE);
    assert_eq!(other.fired, [HoldBegan(Dictate), HoldEnded(Dictate)]);
}

#[test]
fn one_key_alone_does_nothing() {
    let mut kb = kb();
    kb.flags(RIGHT_COMMAND, CMD);
    kb.wait(1.0);
    kb.flags(RIGHT_COMMAND, NONE);
    kb.flags(RIGHT_OPTION, O);
    kb.wait(1.0);
    kb.flags(RIGHT_OPTION, NONE);
    assert!(kb.fired.is_empty());
}

#[test]
fn left_command_with_right_option_does_not_dictate() {
    let mut kb = kb();
    kb.flags(LEFT_COMMAND, CMD);
    kb.flags(RIGHT_OPTION, CMD | O);
    kb.wait(0.5);
    assert!(kb.fired.is_empty());
}

#[test]
fn another_key_cancels_dictation() {
    let mut kb = kb();
    kb.flags(RIGHT_COMMAND, CMD);
    kb.flags(RIGHT_OPTION, CMD | O);
    kb.wait(0.5);
    kb.down(Z, CMD | O);
    kb.flags(RIGHT_OPTION, CMD);
    kb.flags(RIGHT_COMMAND, NONE);
    assert_eq!(kb.fired, [HoldBegan(Dictate), HoldCancelled(Dictate)]);
}

#[test]
fn a_key_before_the_hold_starts_prevents_it() {
    let mut kb = kb();
    kb.flags(RIGHT_COMMAND, CMD);
    kb.down(Z, CMD);
    kb.flags(RIGHT_OPTION, CMD | O);
    kb.wait(1.0);
    assert!(kb.fired.is_empty());
}

#[test]
fn dictation_starts_sooner_than_talk() {
    let mut matcher = ShortcutMatcher::new(0.2, HashMap::from([(Dictate, 0.08)]));
    matcher.set_shortcuts(defaults());
    matcher.handle(KeyInput::FlagsChanged { key_code: RIGHT_COMMAND, modifiers: CMD }, 0.0);
    matcher.handle(KeyInput::FlagsChanged { key_code: RIGHT_OPTION, modifiers: CMD | O }, 0.0);
    assert_eq!(matcher.next_deadline(), Some(0.08));
    assert!(matcher.tick(0.05).is_empty());
    assert_eq!(matcher.tick(0.09), [HoldBegan(Dictate)]);

    let mut talk = ShortcutMatcher::new(0.2, HashMap::from([(Dictate, 0.08)]));
    talk.set_shortcuts(defaults());
    talk.handle(KeyInput::FlagsChanged { key_code: LEFT_CONTROL, modifiers: C }, 0.0);
    talk.handle(KeyInput::FlagsChanged { key_code: LEFT_OPTION, modifiers: C | O }, 0.0);
    assert_eq!(talk.next_deadline(), Some(0.2));
}

#[test]
fn talk_and_dictate_do_not_interfere() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    kb.release_all();
    kb.flags(RIGHT_COMMAND, CMD);
    kb.flags(RIGHT_OPTION, CMD | O);
    kb.wait(0.5);
    kb.flags(RIGHT_OPTION, CMD);
    kb.flags(RIGHT_COMMAND, NONE);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldEnded(Talk), HoldBegan(Dictate), HoldEnded(Dictate)]);
}

// ---- sides, fn and changes ----

#[test]
fn right_option_dictates() {
    let mut kb = Keyboard::new(right_option_alone());
    kb.flags(RIGHT_OPTION, O);
    kb.wait(0.5);
    kb.flags(RIGHT_OPTION, NONE);
    assert_eq!(kb.fired, [HoldBegan(Dictate), HoldEnded(Dictate)]);
}

#[test]
fn left_option_does_not_dictate() {
    let mut kb = Keyboard::new(right_option_alone());
    kb.flags(LEFT_OPTION, O);
    kb.wait(0.5);
    kb.flags(LEFT_OPTION, NONE);
    assert!(kb.fired.is_empty());
}

#[test]
fn both_options_do_not_dictate() {
    let mut kb = Keyboard::new(right_option_alone());
    kb.flags(RIGHT_OPTION, O);
    kb.flags(LEFT_OPTION, O);
    kb.wait(0.5);
    assert!(kb.fired.is_empty());
}

#[test]
fn right_option_then_control_is_talk_not_dictate() {
    let mut kb = Keyboard::new(right_option_alone());
    kb.flags(RIGHT_OPTION, O);
    kb.wait(0.05);
    kb.flags(LEFT_CONTROL, C | O);
    kb.wait(0.5);
    assert_eq!(kb.fired, [HoldBegan(Talk)]);
}

#[test]
fn right_option_typing_a_special_character_cancels() {
    let mut kb = Keyboard::new(right_option_alone());
    kb.flags(RIGHT_OPTION, O);
    kb.wait(0.05);
    kb.down(14, O);
    kb.up(14);
    kb.wait(1.0);
    kb.flags(RIGHT_OPTION, NONE);
    assert!(kb.fired.is_empty());
}

#[test]
fn fn_hold_on_its_own() {
    let mut kb = Keyboard::new(HashMap::from([(Talk, KeyCombo::modifiers_only(F, false))]));
    kb.flags(FN, F);
    kb.wait(0.5);
    kb.flags(FN, NONE);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldEnded(Talk)]);
}

#[test]
fn keyed_hold_ends_on_key_up() {
    let mut kb = Keyboard::new(HashMap::from([(Talk, KeyCombo::keyed(F, SPACE, None))]));
    kb.flags(FN, F);
    kb.down(SPACE, F);
    kb.wait(2.0);
    kb.up(SPACE);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldEnded(Talk)]);
}

#[test]
fn chords_without_fn_are_left_to_system_hot_keys() {
    let mut kb = kb();
    kb.flags(LEFT_CONTROL, C);
    kb.flags(LEFT_OPTION, C | O);
    kb.down(Z, C | O);
    assert!(kb.fired.is_empty());
    assert!(ShortcutMatcher::needs_key_tracking(&Talk.default_combo()));
    assert!(ShortcutMatcher::needs_key_tracking(&Dictate.default_combo()));
    assert!(!ShortcutMatcher::needs_key_tracking(&ToggleIsland.default_combo()));
    assert!(!ShortcutMatcher::needs_key_tracking(&ShortcutAction::Cancel.default_combo()));
}

#[test]
fn cleared_shortcut_never_fires() {
    let mut shortcuts = defaults();
    shortcuts.remove(&Talk);
    let mut kb = Keyboard::new(shortcuts);
    kb.hold_control_option();
    kb.wait(1.0);
    kb.release_all();
    assert!(kb.fired.is_empty());
}

#[test]
fn changing_a_held_shortcut_cancels_it() {
    let mut kb = kb();
    kb.hold_control_option();
    kb.wait(0.5);
    let mut changed = defaults();
    changed.insert(Talk, KeyCombo::modifiers_only(C | CMD, false));
    let out = kb.matcher.set_shortcuts(changed);
    kb.fired.extend(out);
    assert_eq!(kb.fired, [HoldBegan(Talk), HoldCancelled(Talk)]);
    kb.release_all();
    assert_eq!(kb.fired.len(), 2);
}

#[test]
fn new_shortcut_works_at_once() {
    let mut changed = defaults();
    changed.insert(Talk, KeyCombo::modifiers_only(C | CMD, false));
    let mut kb = Keyboard::new(changed);
    kb.flags(LEFT_CONTROL, C);
    kb.flags(LEFT_COMMAND, C | CMD);
    kb.wait(0.5);
    assert_eq!(kb.fired, [HoldBegan(Talk)]);
}

#[test]
fn no_deadline_when_nothing_is_waiting() {
    let mut kb = kb();
    assert_eq!(kb.matcher.next_deadline(), None);
    kb.hold_control_option();
    assert_eq!(kb.matcher.next_deadline(), Some(0.2));
    kb.wait(0.3);
    assert_eq!(kb.matcher.next_deadline(), None);
}
