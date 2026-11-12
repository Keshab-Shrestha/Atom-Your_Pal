//! The macOS status item (menu bar icon). Rune has no API for it, so this uses AppKit through objc2.
//! A click on a menu item queues an `Action`; the app takes the queue in its poll hook.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use ark_core::shortcuts::{KeyInput, Modifiers, ShortcutAction, ShortcutMatcher, ShortcutTrigger};

use objc2::rc::Retained;
use objc2::runtime::NSObject;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{NSApplication, NSMenu, NSMenuItem, NSStatusBar, NSVariableStatusItemLength};
use objc2_foundation::NSString;

/// What a status item click asks the app to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Show,
    NewChat,
    /// Right Command and Right Option went down: start dictating.
    DictateStart,
    /// One of them came up: send what was said.
    DictateSend,
    /// The hold was spoiled or Esc was pressed: drop what was said.
    DictateCancel,
}

static QUEUE: Mutex<Vec<Action>> = Mutex::new(Vec::new());
static WAKE: OnceLock<rune::Waker> = OnceLock::new();

fn push(action: Action) {
    QUEUE.lock().unwrap_or_else(|e| e.into_inner()).push(action);
    if let Some(wake) = WAKE.get() {
        wake();
    }
}

/// Takes the clicks and shortcuts since the last call.
pub fn take_actions() -> Vec<Action> {
    std::mem::take(&mut *QUEUE.lock().unwrap_or_else(|e| e.into_inner()))
}

/// The shortcut matcher from ark-core, with ARK's default shortcuts (hold Right Command + Right Option dictates).
fn matcher() -> &'static Mutex<ShortcutMatcher> {
    static M: OnceLock<Mutex<ShortcutMatcher>> = OnceLock::new();
    M.get_or_init(|| {
        let mut m = ShortcutMatcher::new(0.0, HashMap::from([(ShortcutAction::Dictate, 0.08)]));
        m.set_shortcuts(ShortcutAction::ALL.iter().map(|a| (*a, a.default_combo())).collect());
        Mutex::new(m)
    })
}

/// What a shortcut trigger asks the app to do, if anything.
pub fn action_for(trigger: ShortcutTrigger) -> Option<Action> {
    use ShortcutAction::{Cancel, Dictate, Talk, ToggleIsland};
    match trigger {
        ShortcutTrigger::HoldBegan(Dictate | Talk) => Some(Action::DictateStart),
        ShortcutTrigger::HoldEnded(Dictate | Talk) => Some(Action::DictateSend),
        ShortcutTrigger::HoldCancelled(Dictate | Talk) | ShortcutTrigger::Pressed(Cancel) => Some(Action::DictateCancel),
        ShortcutTrigger::Pressed(ToggleIsland) => Some(Action::Show),
        _ => None,
    }
}

/// Replaces the matcher's shortcuts (the defaults with the owner's changes on top).
pub fn apply_shortcuts(map: HashMap<ShortcutAction, ark_core::shortcuts::KeyCombo>) {
    let triggers = matcher().lock().unwrap_or_else(|e| e.into_inner()).set_shortcuts(map);
    triggers.into_iter().filter_map(action_for).for_each(push);
}

static RECORDING: Mutex<Option<(ShortcutAction, crate::recorder::Recorder)>> = Mutex::new(None);
static RECORDED: Mutex<Vec<(ShortcutAction, Option<ark_core::shortcuts::KeyCombo>)>> = Mutex::new(Vec::new());

/// The next key press in this app becomes the shortcut for `action`.
pub fn start_recording(action: ShortcutAction) {
    *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = Some((action, crate::recorder::Recorder::default()));
}

pub fn stop_recording() {
    *RECORDING.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// Takes the finished recordings (`None`: cancelled) since the last call.
pub fn take_recorded() -> Vec<(ShortcutAction, Option<ark_core::shortcuts::KeyCombo>)> {
    std::mem::take(&mut *RECORDED.lock().unwrap_or_else(|e| e.into_inner()))
}

/// Feeds a key event of this app to a recording in progress. True when the recording used the event.
fn record(input: KeyInput, name: Option<String>) -> bool {
    use crate::recorder::Step;
    let mut slot = RECORDING.lock().unwrap_or_else(|e| e.into_inner());
    let Some((action, rec)) = slot.as_mut() else { return false };
    let action = *action;
    let done = match rec.step(input) {
        Step::Waiting => return true,
        Step::Cancelled => None,
        Step::Done(mut combo) => {
            combo.key_name = combo.key_name.or(name);
            Some(combo)
        }
    };
    *slot = None;
    drop(slot);
    RECORDED.lock().unwrap_or_else(|e| e.into_inner()).push((action, done));
    if let Some(wake) = WAKE.get() {
        wake();
    }
    true
}

fn now() -> f64 {
    static START: OnceLock<std::time::Instant> = OnceLock::new();
    START.get_or_init(std::time::Instant::now).elapsed().as_secs_f64()
}

/// Feeds one key event to the matcher and queues what it asks. A hold that waits for its arm delay is ticked from a short thread.
fn drive(input: KeyInput) {
    let (triggers, deadline) = {
        let mut m = matcher().lock().unwrap_or_else(|e| e.into_inner());
        let t = m.handle(input, now());
        (t, m.next_deadline())
    };
    triggers.into_iter().filter_map(action_for).for_each(push);
    if let Some(at) = deadline {
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs_f64((at - now()).max(0.0) + 0.005));
            let t = matcher().lock().unwrap_or_else(|e| e.into_inner()).tick(now());
            t.into_iter().filter_map(action_for).for_each(push);
        });
    }
}

fn modifiers_of(flags: objc2_app_kit::NSEventModifierFlags) -> Modifiers {
    use objc2_app_kit::NSEventModifierFlags as F;
    let mut bits = 0;
    for (flag, m) in [(F::Control, Modifiers::CONTROL), (F::Option, Modifiers::OPTION), (F::Shift, Modifiers::SHIFT), (F::Command, Modifiers::COMMAND), (F::Function, Modifiers::FUNCTION)] {
        if flags.contains(flag) {
            bits |= m.0;
        }
    }
    Modifiers(bits)
}

/// Watches the keys in every app. macOS asks for Input Monitoring the first time; without it no event arrives.
fn watch_keys() {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
    let handler = block2::RcBlock::new(|event: std::ptr::NonNull<NSEvent>| {
        // SAFETY: AppKit passes a live event for the duration of the call.
        let e = unsafe { event.as_ref() };
        let code = e.keyCode();
        let input = match e.r#type() {
            NSEventType::FlagsChanged => KeyInput::FlagsChanged { key_code: code, modifiers: modifiers_of(e.modifierFlags()) },
            NSEventType::KeyDown => KeyInput::KeyDown { key_code: code, modifiers: modifiers_of(e.modifierFlags()), is_repeat: e.isARepeat() },
            NSEventType::KeyUp => KeyInput::KeyUp { key_code: code },
            _ => return,
        };
        drive(input);
    });
    let monitor = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged | NSEventMask::KeyDown | NSEventMask::KeyUp, &handler);
    KEEP.with(|k| {
        if let Some(m) = monitor {
            // SAFETY: the monitor is an opaque AppKit token that only needs to stay alive.
            k.borrow_mut().push(unsafe { Retained::cast_unchecked(m) });
        }
    });
}

/// Watches this app's own keys, only to record a shortcut. The event is consumed while a recording runs.
fn watch_own_keys() {
    use objc2_app_kit::{NSEvent, NSEventMask, NSEventType};
    let handler = block2::RcBlock::new(|event: std::ptr::NonNull<NSEvent>| -> *mut NSEvent {
        // SAFETY: AppKit passes a live event for the duration of the call.
        let e = unsafe { event.as_ref() };
        let code = e.keyCode();
        let (input, name) = match e.r#type() {
            NSEventType::FlagsChanged => (KeyInput::FlagsChanged { key_code: code, modifiers: modifiers_of(e.modifierFlags()) }, None),
            NSEventType::KeyDown => (
                KeyInput::KeyDown { key_code: code, modifiers: modifiers_of(e.modifierFlags()), is_repeat: e.isARepeat() },
                e.charactersIgnoringModifiers().map(|s| s.to_string().to_uppercase()),
            ),
            _ => return event.as_ptr(),
        };
        if record(input, name) { std::ptr::null_mut() } else { event.as_ptr() }
    });
    // SAFETY: the handler returns the event it was given or null, as AppKit requires of a local monitor.
    let monitor = unsafe { NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::FlagsChanged | NSEventMask::KeyDown, &handler) };
    KEEP.with(|k| {
        if let Some(m) = monitor {
            // SAFETY: an opaque AppKit token that only needs to stay alive.
            k.borrow_mut().push(unsafe { Retained::cast_unchecked(m) });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(inputs: &[(KeyInput, f64)]) -> Vec<Action> {
        let mut m = ShortcutMatcher::new(0.0, HashMap::from([(ShortcutAction::Dictate, 0.08)]));
        m.set_shortcuts(ShortcutAction::ALL.iter().map(|a| (*a, a.default_combo())).collect());
        let mut out = Vec::new();
        for (i, t) in inputs {
            out.extend(m.handle(*i, *t).into_iter().filter_map(action_for));
            out.extend(m.tick(*t + 0.1).into_iter().filter_map(action_for));
        }
        out
    }

    #[test]
    fn holding_right_command_and_option_dictates_and_releasing_sends() {
        let both = Modifiers::COMMAND | Modifiers::OPTION;
        let got = run(&[
            (KeyInput::FlagsChanged { key_code: 54, modifiers: Modifiers::COMMAND }, 0.0),
            (KeyInput::FlagsChanged { key_code: 61, modifiers: both }, 0.01),
            (KeyInput::FlagsChanged { key_code: 61, modifiers: Modifiers::COMMAND }, 1.0),
        ]);
        assert_eq!(got, [Action::DictateStart, Action::DictateSend]);
    }
}
define_class!(
    /// The target of the status menu items.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "ArkStatusTarget"]
    struct Target;

    impl Target {
        #[unsafe(method(show:))]
        fn show(&self, _: &NSMenuItem) {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).activate();
            }
            push(Action::Show);
        }
        #[unsafe(method(newChat:))]
        fn new_chat(&self, _: &NSMenuItem) {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).activate();
            }
            push(Action::NewChat);
        }
        #[unsafe(method(quit:))]
        fn quit(&self, _: &NSMenuItem) {
            if let Some(mtm) = MainThreadMarker::new() {
                NSApplication::sharedApplication(mtm).terminate(None);
            }
        }
    }
);

thread_local! {
    /// The status item and its target live as long as the app.
    static KEEP: std::cell::RefCell<Vec<Retained<NSObject>>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Adds the "ARK" status item. Does nothing off the main thread.
pub fn install(wake: rune::Waker) {
    let Some(mtm) = MainThreadMarker::new() else { return };
    WAKE.get_or_init(|| wake);
    let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
    if let Some(button) = item.button(mtm) {
        button.setTitle(&NSString::from_str("ARK"));
    }
    // SAFETY: plain NSObject init on a freshly allocated object.
    let target: Retained<Target> = unsafe { msg_send![Target::alloc(mtm), init] };
    let menu = NSMenu::new(mtm);
    for (title, action) in [("Show ARK", sel!(show:)), ("New chat", sel!(newChat:)), ("Quit ARK", sel!(quit:))] {
        // SAFETY: each selector is defined on `Target` above with the matching signature.
        let entry = unsafe { NSMenuItem::initWithTitle_action_keyEquivalent(mtm.alloc(), &NSString::from_str(title), Some(action), &NSString::from_str("")) };
        // SAFETY: the target is kept in KEEP for the whole run.
        unsafe { entry.setTarget(Some(&target)) };
        menu.addItem(&entry);
    }
    item.setMenu(Some(&menu));
    watch_keys();
    watch_own_keys();
    KEEP.with(|k| {
        let mut k = k.borrow_mut();
        k.push(target.into_super());
        k.push(item.into_super());
    });
}
